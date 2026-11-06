-- Slotwise v0.1 schema for Supabase.
-- Run in the SQL editor of a fresh project. Then add the project URL and anon key
-- in the app (Settings > Connections) or as VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY.
--
-- Model: one document table (records) with row level security. Hosts read and write
-- their own rows. Invitees never read rows directly; they go through security definer
-- functions that return only what a booking page needs.

create table if not exists public.records (
  id text primary key,
  owner_id uuid not null references auth.users (id) on delete cascade,
  kind text not null,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

-- kinds: client kinds are written by the static app under RLS; webhook_delivery, audit and idempotency
-- are written only by the Edge Functions (service role). team_member is a member's own consent record.
alter table public.records drop constraint if exists records_kind_check;
alter table public.records add constraint records_kind_check check (kind in ('profile', 'event_type', 'schedule', 'booking', 'poll',
  'link', 'busy', 'outbox', 'workflow', 'routing_form', 'personal_link', 'team', 'team_member', 'webhook', 'webhook_delivery',
  'api_key', 'audit', 'idempotency'));

create index if not exists records_kind_owner on public.records (kind, owner_id);
create unique index if not exists records_username on public.records ((lower(data ->> 'username'))) where kind = 'profile';
create index if not exists records_booking_token on public.records ((data ->> 'token')) where kind = 'booking';
create index if not exists records_link_token on public.records ((data ->> 'token')) where kind = 'link';

alter table public.records enable row level security;

-- Hosts read all of their own rows, but may only write the client kinds. The service role bypasses RLS.
create or replace function public._client_kind(p_kind text) returns boolean
language sql immutable as $$
  select p_kind in ('profile', 'event_type', 'schedule', 'booking', 'poll', 'link', 'busy', 'outbox', 'workflow',
    'routing_form', 'personal_link', 'team', 'team_member', 'webhook', 'api_key')
$$;

drop policy if exists records_owner on public.records;
drop policy if exists records_select_own on public.records;
create policy records_select_own on public.records
  for select using (owner_id = auth.uid());

drop policy if exists records_insert_own on public.records;
create policy records_insert_own on public.records
  for insert with check (owner_id = auth.uid() and public._client_kind(kind)
    and (kind <> 'outbox' or octet_length(data::text) <= 16384));

drop policy if exists records_update_own on public.records;
create policy records_update_own on public.records
  for update using (owner_id = auth.uid() and public._client_kind(kind))
  with check (owner_id = auth.uid() and public._client_kind(kind)
    and (kind <> 'outbox' or octet_length(data::text) <= 16384));

drop policy if exists records_delete_own on public.records;
create policy records_delete_own on public.records
  for delete using (owner_id = auth.uid() and public._client_kind(kind));

-- co-hosts (collective team bookings) can read bookings they are part of
drop policy if exists records_cohost_read on public.records;
create policy records_cohost_read on public.records
  for select using (kind = 'booking' and data -> 'coHostIds' ? auth.uid()::text);

-- ---------- team consent ----------

-- A user may host an event type when they own it, or when the event type belongs to a team
-- (data.teamId) that lists them as a host, the team record (owned by the team owner) lists both
-- them and the event type owner as accepted members, and they wrote their own consent record:
--   kind 'team_member', id '<teamId>:<userId>', owner_id = userId, data {teamId, userId, accepted: true}.
create or replace function public._host_ok(p_et_id text, p_user text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from records e
    where e.kind = 'event_type' and e.id = p_et_id and (
      e.owner_id::text = p_user
      or (coalesce(e.data ->> 'teamId', '') <> ''
        and e.data -> 'hosts' @> jsonb_build_array(jsonb_build_object('userId', p_user))
        and exists (select 1 from records t where t.kind = 'team' and t.id = e.data ->> 'teamId'
          and (t.owner_id = e.owner_id or t.data -> 'members' @> jsonb_build_array(jsonb_build_object('userId', e.owner_id::text, 'accepted', true)))
          and (t.owner_id::text = p_user or t.data -> 'members' @> jsonb_build_array(jsonb_build_object('userId', p_user, 'accepted', true))))
        and exists (select 1 from records m where m.kind = 'team_member' and m.id = (e.data ->> 'teamId') || ':' || p_user
          and m.owner_id::text = p_user and m.data ->> 'teamId' = e.data ->> 'teamId' and m.data ->> 'userId' = p_user
          and m.data -> 'accepted' = 'true'::jsonb))))
$$;

-- Co-hosts are only allowed on collective team event types, and each must pass _host_ok.
-- Dynamic group links (no teamId) get no co-hosts on the server.
create or replace function public._cohosts_ok(p_et_id text, p_owner text, p_cohosts jsonb) returns boolean
language plpgsql stable security definer set search_path = public as $$
begin
  if p_cohosts is null or jsonb_typeof(p_cohosts) = 'null' or p_cohosts = '[]'::jsonb then return true; end if;
  if jsonb_typeof(p_cohosts) <> 'array' or jsonb_array_length(p_cohosts) > 5 then return false; end if;
  if not exists (select 1 from records e where e.kind = 'event_type' and e.id = p_et_id
      and e.data ->> 'schedulingType' = 'collective' and coalesce(e.data ->> 'teamId', '') <> '') then return false; end if;
  return not exists (select 1 from jsonb_array_elements(p_cohosts) x
    where jsonb_typeof(x) <> 'string' or x #>> '{}' = p_owner or not public._host_ok(p_et_id, x #>> '{}'));
end $$;

-- Integrity for client writes (PostgREST roles anon / authenticated outside the security definer RPCs,
-- which mark their transaction with slotwise.rpc = on; the service role and the RPCs are not checked):
--  * data.id, when present, equals the row id; data.ownerId, when present, equals owner_id
--  * bookings: coHostIds must pass _cohosts_ok; attendee.whatsappOptIn cannot be set by the host
--    (only the invitee opts in, through public_create_booking)
--  * team_member: id = teamId:userId and userId = owner_id
create or replace function public._records_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_role text := coalesce(current_setting('role', true), '');
begin
  if v_role not in ('anon', 'authenticated') or coalesce(current_setting('slotwise.rpc', true), '') = 'on' then return new; end if;
  if tg_op = 'INSERT' or new.id is distinct from old.id or new.data -> 'id' is distinct from old.data -> 'id'
     or new.data -> 'ownerId' is distinct from old.data -> 'ownerId' or new.owner_id is distinct from old.owner_id then
    if new.data ->> 'id' is not null and new.data ->> 'id' <> new.id then
      raise exception using errcode = '42501', message = 'records: data.id must equal the row id';
    end if;
    if new.data ->> 'ownerId' is not null and new.data ->> 'ownerId' <> new.owner_id::text then
      raise exception using errcode = '42501', message = 'records: data.ownerId must equal owner_id';
    end if;
  end if;
  if new.kind = 'booking' then
    if (tg_op = 'INSERT' or new.data -> 'coHostIds' is distinct from old.data -> 'coHostIds'
        or new.data -> 'eventTypeId' is distinct from old.data -> 'eventTypeId')
       and not public._cohosts_ok(new.data ->> 'eventTypeId', new.owner_id::text, new.data -> 'coHostIds') then
      raise exception using errcode = '42501', message = 'records: coHostIds not allowed for this event type';
    end if;
    if new.data -> 'attendee' ->> 'whatsappOptIn' = 'true'
       and (tg_op = 'INSERT' or coalesce(old.data -> 'attendee' ->> 'whatsappOptIn', 'false') <> 'true') then
      new.data := jsonb_set(new.data, '{attendee,whatsappOptIn}', 'false'::jsonb);
    end if;
  elsif new.kind = 'team_member' then
    if new.data ->> 'userId' is distinct from new.owner_id::text or new.id is distinct from (new.data ->> 'teamId') || ':' || (new.data ->> 'userId') then
      raise exception using errcode = '42501', message = 'records: team_member id must be teamId:userId owned by userId';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists records_guard on public.records;
create trigger records_guard before insert or update on public.records
  for each row execute function public._records_guard();

-- ---------- helpers ----------

-- Contact details are only public when the host opts in (profile data.showContact = true).
create or replace function public._public_user(p jsonb) returns jsonb
language sql immutable as $$
  select jsonb_build_object(
    'id', p ->> 'id', 'name', p ->> 'name', 'username', p ->> 'username', 'bio', p ->> 'bio',
    'avatarUrl', p ->> 'avatarUrl', 'timezone', p ->> 'timezone', 'locale', p ->> 'locale',
    'weekStart', p -> 'weekStart', 'timeFormat', p ->> 'timeFormat', 'brandColor', p ->> 'brandColor',
    'shabbat', p -> 'shabbat',
    'phone', case when p -> 'showContact' = 'true'::jsonb then coalesce(p ->> 'phone', '') else '' end,
    'email', case when p -> 'showContact' = 'true'::jsonb then coalesce(p ->> 'email', '') else '' end,
    'defaultScheduleId', p ->> 'defaultScheduleId', 'outOfOffice', coalesce(p -> 'outOfOffice', '[]'),
    'travel', coalesce(p -> 'travel', '[]'))
$$;

-- Hidden event types are only returned when asked for by slug / id, and never with their payment link.
create or replace function public._public_event_type(d jsonb) returns jsonb
language sql immutable as $$
  select case when d -> 'hidden' = 'true'::jsonb and jsonb_typeof(d -> 'price') = 'object' then d #- '{price,paymentLink}' else d end
$$;

-- What a booking page needs from a schedule: no notes or other host-only fields.
create or replace function public._public_schedule(p_id text, d jsonb) returns jsonb
language sql immutable as $$
  select jsonb_build_object('id', p_id, 'name', d ->> 'name', 'timezone', d ->> 'timezone',
    'weekly', coalesce(d -> 'weekly', '[]'),
    'overrides', coalesce((select jsonb_agg(jsonb_build_object('date', o ->> 'date', 'ranges', coalesce(o -> 'ranges', '[]')))
      from jsonb_array_elements(case when jsonb_typeof(d -> 'overrides') = 'array' then d -> 'overrides' else '[]' end) o), '[]'))
$$;

drop function if exists public._profile_bundle(uuid, text);
create or replace function public._profile_bundle(p_owner uuid, p_redirect text, p_include_slug text default null, p_include_ids jsonb default null)
returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'user', public._public_user((select data from records where kind = 'profile' and owner_id = p_owner limit 1)),
    'eventTypes', coalesce((select jsonb_agg(public._public_event_type(data) order by (data ->> 'position')::int) from records
      where kind = 'event_type' and owner_id = p_owner and coalesce(data ->> 'teamId', '') = ''
        and (coalesce(data -> 'hidden', 'false'::jsonb) <> 'true'::jsonb
          or (p_include_slug is not null and lower(data ->> 'slug') = lower(p_include_slug))
          or (jsonb_typeof(p_include_ids) = 'array' and p_include_ids ? id))), '[]'::jsonb),
    'schedules', coalesce((select jsonb_agg(public._public_schedule(id, data)) from records where kind = 'schedule' and owner_id = p_owner), '[]'::jsonb),
    'redirectedFrom', p_redirect)
$$;

-- ---------- public read ----------

create or replace function public._public_poll(p jsonb) returns jsonb
language sql immutable as $$
  select p || jsonb_build_object('voters', coalesce((select jsonb_agg(jsonb_build_object('id', '', 'name', v ->> 'name', 'email', '', 'votes', v -> 'votes', 'at', v ->> 'at'))
    from jsonb_array_elements(coalesce(p -> 'voters', '[]')) v), '[]'))
$$;


create or replace function public.public_profile(p_username text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_owner uuid; v_redirect text := null;
begin
  select owner_id into v_owner from records where kind = 'profile' and lower(data ->> 'username') = lower(p_username) limit 1;
  if v_owner is null then
    select owner_id into v_owner from records
      where kind = 'profile' and data -> 'previousUsernames' ? lower(p_username) limit 1;
    v_redirect := lower(p_username);
  end if;
  if v_owner is null then return null; end if;
  return public._profile_bundle(v_owner, v_redirect);
end $$;

-- Profile bundle plus one event type that may be hidden: matched by slug, or the event type of the
-- personal link with that slug. Use for /username/slug pages; public_profile lists visible types only.
create or replace function public.public_event_type(p_username text, p_slug text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_owner uuid; v_redirect text := null; v_ids jsonb;
begin
  select owner_id into v_owner from records where kind = 'profile' and lower(data ->> 'username') = lower(p_username) limit 1;
  if v_owner is null then
    select owner_id into v_owner from records
      where kind = 'profile' and data -> 'previousUsernames' ? lower(p_username) limit 1;
    v_redirect := lower(p_username);
  end if;
  if v_owner is null then return null; end if;
  select coalesce(jsonb_agg(data ->> 'eventTypeId'), '[]') into v_ids from records
    where kind = 'personal_link' and owner_id = v_owner and data ->> 'slug' = lower(p_slug);
  return public._profile_bundle(v_owner, v_redirect, p_slug, v_ids);
end $$;

create or replace function public.public_busy(p_owner uuid, p_from timestamptz, p_to timestamptz) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'bookings', coalesce((
      select jsonb_agg(jsonb_build_object('id', data ->> 'id', 'eventTypeId', data ->> 'eventTypeId', 'start', data ->> 'start', 'end', data ->> 'end'))
      from records where kind = 'booking' and (owner_id = p_owner or data -> 'coHostIds' ? p_owner::text)
        and data ->> 'status' in ('accepted', 'pending')
        and (data ->> 'start')::timestamptz < p_to and (data ->> 'end')::timestamptz > p_from), '[]'::jsonb),
    'busy', coalesce((
      select jsonb_agg(b) from records r, jsonb_array_elements(r.data -> 'blocks') b
      where r.kind = 'busy' and r.owner_id = p_owner
        and (b ->> 'start')::timestamptz < p_to and (b ->> 'end')::timestamptz > p_from), '[]'::jsonb))
$$;

create or replace function public.public_booking(p_token text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare b jsonb; v_owner uuid;
begin
  select data, owner_id into b, v_owner from records where kind = 'booking' and data ->> 'token' = p_token limit 1;
  if b is null then return null; end if;
  return jsonb_build_object(
    'booking', b - 'internalNotes',
    'eventType', (select public._public_event_type(data) from records where kind = 'event_type' and id = b ->> 'eventTypeId'),
    'user', public._public_user((select data from records where kind = 'profile' and owner_id = v_owner limit 1)));
end $$;

create or replace function public.public_poll(p_id text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('poll', public._public_poll(r.data), 'user', public._public_user(p.data))
  from records r join records p on p.kind = 'profile' and p.owner_id = r.owner_id
  where r.kind = 'poll' and r.id = p_id
$$;

create or replace function public.public_link(p_token text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('link', r.data, 'profile', public._profile_bundle(r.owner_id, null, null, jsonb_build_array(r.data ->> 'eventTypeId')))
  from records r where r.kind = 'link' and r.data ->> 'token' = p_token limit 1
$$;

-- ---------- public write ----------

create or replace function public._valid_email(p text) returns boolean
language sql immutable as $$
  select p is not null and length(p) <= 254 and p ~ '^[^[:space:]@,;<>"()\\[\]]+@[^[:space:]@,;<>"()\\[\]]+\.[A-Za-z]{2,}$'
$$;

create or replace function public._new_id(p_len int) returns text
language sql volatile as $$ select substr(replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''), 1, p_len) $$;

-- Builds the stored booking from an allow-list of client fields. Ids and tokens are generated here.
create or replace function public._clean_booking(p jsonb, et jsonb, v_owner uuid, p_source text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare att jsonb := coalesce(p -> 'attendee', '{}'); loc jsonb; guests jsonb; cohosts jsonb; utm jsonb;
begin
  if not public._valid_email(lower(trim(att ->> 'email'))) or coalesce(trim(att ->> 'name'), '') = '' then return null; end if;
  select l into loc from jsonb_array_elements(coalesce(et -> 'locations', '[]')) l
    where l ->> 'type' = p -> 'location' ->> 'type' and coalesce(l ->> 'value', '') = coalesce(p -> 'location' ->> 'value', '') limit 1;
  loc := coalesce(loc, et -> 'locations' -> 0, '{"type":"meet"}');
  select coalesce(jsonb_agg(lower(trim(g))), '[]') into guests from (
    select g from jsonb_array_elements_text(case when jsonb_typeof(p -> 'guests') = 'array' then p -> 'guests' else '[]' end) g
    where public._valid_email(lower(trim(g))) limit 10) q;
  select coalesce(jsonb_agg(x), '[]') into cohosts from (
    select distinct x from jsonb_array_elements_text(case when jsonb_typeof(p -> 'coHostIds') = 'array' then p -> 'coHostIds' else '[]' end) x
    where et ->> 'schedulingType' = 'collective' and coalesce(et ->> 'teamId', '') <> ''
      and x <> v_owner::text
      and exists (select 1 from records r where r.kind = 'profile' and r.owner_id::text = x)
      and public._host_ok(et ->> 'id', x)
    limit 5) q;
  select coalesce(jsonb_object_agg(key, left(value, 200)), '{}') into utm from (
    select key, value from jsonb_each_text(case when jsonb_typeof(p -> 'utm') = 'object' then p -> 'utm' else '{}' end) where key like 'utm\_%' limit 10) q;
  return jsonb_build_object(
    'id', public._new_id(16), 'token', public._new_id(32), 'ownerId', v_owner, 'eventTypeId', et ->> 'id', 'title', et ->> 'title',
    'start', p ->> 'start', 'end', p ->> 'end',
    'status', case when (et ->> 'requiresConfirmation')::boolean then 'pending' else 'accepted' end,
    'attendee', jsonb_build_object('name', left(trim(att ->> 'name'), 120), 'email', lower(trim(att ->> 'email')),
      'phone', left(regexp_replace(coalesce(att ->> 'phone', ''), '[^0-9+() -]', '', 'g'), 25),
      'timezone', left(coalesce(att ->> 'timezone', 'UTC'), 64),
      'locale', case when att ->> 'locale' in ('he', 'en') then att ->> 'locale' else 'he' end,
      'whatsappOptIn', coalesce(att -> 'whatsappOptIn' = 'true'::jsonb, false)),
    'guests', guests, 'notes', left(coalesce(p ->> 'notes', ''), 2000),
    'answers', case when jsonb_typeof(p -> 'answers') = 'object' and length((p -> 'answers')::text) < 8000 then p -> 'answers' else '{}' end,
    'location', loc, 'utm', utm, 'source', p_source,
    'coHostIds', cohosts, 'teamId', et ->> 'teamId',
    'personalLinkId', left(p ->> 'personalLinkId', 40), 'routingResponseId', left(p ->> 'routingResponseId', 40),
    'noShow', false, 'internalNotes', '', 'emailsSent', '[]'::jsonb, 'createdAt', now(),
    'history', jsonb_build_array(jsonb_build_object('at', now(), 'action', 'created', 'by', 'invitee')));
end $$;

-- Availability rules a host's schedule imposes (working hours, overrides, notice, window, daily/weekly limits).
-- Shabbat, holidays and out of office reach the server as busy blocks written by the host's sync.
create or replace function public._check_rules(p_host uuid, et jsonb, s timestamptz, e timestamptz, p_ignore text) returns text
language plpgsql security definer set search_path = public as $$
declare prof jsonb; sched jsonb; tz text; ls timestamp; le timestamp; d date; ov jsonb; ranges jsonb; lim jsonb;
  v_ws int; wk date; v_cnt int; v_min numeric;
begin
  select data into prof from records where kind = 'profile' and owner_id = p_host limit 1;
  select data into sched from records where kind = 'schedule' and owner_id = p_host
    and id = case when (et ->> 'ownerId')::uuid = p_host then et ->> 'scheduleId' else prof ->> 'defaultScheduleId' end;
  if sched is null then return 'conflict'; end if;
  tz := coalesce(sched ->> 'timezone', 'UTC');
  ls := s at time zone tz; le := e at time zone tz; d := ls::date;
  select o into ov from jsonb_array_elements(coalesce(sched -> 'overrides', '[]')) o where o ->> 'date' = d::text limit 1;
  ranges := case when ov is not null then ov -> 'ranges' else sched -> 'weekly' -> extract(dow from ls)::int end;
  if not exists (select 1 from jsonb_array_elements(coalesce(ranges, '[]')) r
      where ls >= d + (r ->> 'start')::time
        and le <= d + case when r ->> 'end' = '24:00' then interval '24 hours' else (r ->> 'end')::time::interval end) then
    return 'conflict';
  end if;
  if s < now() + make_interval(mins => coalesce((et ->> 'minNoticeMins')::int, 0)) - interval '2 minutes' then return 'conflict'; end if;
  if et -> 'window' ->> 'type' = 'rolling'
     and le > ((now() at time zone tz)::date + (et -> 'window' ->> 'days')::int + 1)::timestamp then return 'conflict'; end if;
  if et -> 'window' ->> 'type' = 'range'
     and (d < (et -> 'window' ->> 'start')::date or d > (et -> 'window' ->> 'end')::date) then return 'conflict'; end if;
  lim := coalesce(et -> 'limits', '{}');
  if coalesce((lim ->> 'perDay')::int, 0) > 0 or coalesce((lim ->> 'durationPerDay')::int, 0) > 0 then
    select count(*), coalesce(sum(extract(epoch from ((data ->> 'end')::timestamptz - (data ->> 'start')::timestamptz)) / 60), 0)
      into v_cnt, v_min from records
      where kind = 'booking' and owner_id = p_host and id <> coalesce(p_ignore, '') and data ->> 'eventTypeId' = et ->> 'id'
        and data ->> 'status' in ('accepted', 'pending') and ((data ->> 'start')::timestamptz at time zone tz)::date = d;
    if coalesce((lim ->> 'perDay')::int, 0) > 0 and v_cnt >= (lim ->> 'perDay')::int then return 'full'; end if;
    if coalesce((lim ->> 'durationPerDay')::int, 0) > 0
       and v_min + extract(epoch from (e - s)) / 60 > (lim ->> 'durationPerDay')::int then return 'full'; end if;
  end if;
  if coalesce((lim ->> 'perWeek')::int, 0) > 0 then
    v_ws := coalesce((prof ->> 'weekStart')::int, 0);
    wk := d - ((extract(dow from d)::int - v_ws + 7) % 7);
    select count(*) into v_cnt from records
      where kind = 'booking' and owner_id = p_host and id <> coalesce(p_ignore, '') and data ->> 'eventTypeId' = et ->> 'id'
        and data ->> 'status' in ('accepted', 'pending')
        and ((data ->> 'start')::timestamptz at time zone tz)::date >= wk and ((data ->> 'start')::timestamptz at time zone tz)::date < wk + 7;
    if v_cnt >= (lim ->> 'perWeek')::int then return 'full'; end if;
  end if;
  if coalesce((lim ->> 'perMonth')::int, 0) > 0 then
    select count(*) into v_cnt from records
      where kind = 'booking' and owner_id = p_host and id <> coalesce(p_ignore, '') and data ->> 'eventTypeId' = et ->> 'id'
        and data ->> 'status' in ('accepted', 'pending')
        and date_trunc('month', (data ->> 'start')::timestamptz at time zone tz) = date_trunc('month', ls);
    if v_cnt >= (lim ->> 'perMonth')::int then return 'full'; end if;
  end if;
  return null;
end $$;

-- Conflict and rule checks for one booking. Hosts = owner plus coHostIds.
create or replace function public._check_slot(p_owner uuid, b jsonb, p_ignore text) returns text
language plpgsql security definer set search_path = public as $$
declare et jsonb; prof jsonb; v_seats int; v_taken int; v_email text; v_domain text; v_hosts text[]; v_lim jsonb; v_h text; v_err text;
  s timestamptz := (b ->> 'start')::timestamptz; e timestamptz := (b ->> 'end')::timestamptz; bs timestamptz; be timestamptz;
begin
  if s is null or e is null or e <= s or s < now() - interval '5 minutes' then return 'conflict'; end if;
  if not public._host_ok(b ->> 'eventTypeId', p_owner::text) then return 'not_found'; end if;
  select data || jsonb_build_object('id', id) into et from records where kind = 'event_type' and id = b ->> 'eventTypeId';
  if et is null then return 'not_found'; end if;
  if not (et -> 'durations' @> to_jsonb((extract(epoch from (e - s)) / 60)::int)) then return 'conflict'; end if;
  select data into prof from records where kind = 'profile' and owner_id = p_owner limit 1;
  v_email := lower(b -> 'attendee' ->> 'email');
  v_domain := split_part(v_email, '@', 2);
  if exists (select 1 from jsonb_array_elements_text(coalesce(prof -> 'blockedEmails', '[]')) x
             where lower(x) in (v_email, v_domain, '@' || v_domain)) then return 'blocked'; end if;
  -- co-hosts that no longer pass the consent rule are ignored
  v_hosts := array[p_owner::text] || coalesce(array(select x from jsonb_array_elements_text(
    case when jsonb_typeof(b -> 'coHostIds') = 'array' then b -> 'coHostIds' else '[]' end) x
    where et ->> 'schedulingType' = 'collective' and public._host_ok(et ->> 'id', x)), '{}');
  foreach v_h in array v_hosts loop
    v_err := public._check_rules(v_h::uuid, et, s, e, p_ignore);
    if v_err is not null then return v_err; end if;
  end loop;
  v_lim := et -> 'perInviteeLimit';
  if v_lim is not null and jsonb_typeof(v_lim) = 'object' and coalesce((v_lim ->> 'count')::int, 0) > 0 then
    if (select count(*) from records where kind = 'booking' and id <> coalesce(p_ignore, '')
        and data ->> 'status' in ('accepted', 'pending') and data ->> 'eventTypeId' = et ->> 'id'
        and lower(data -> 'attendee' ->> 'email') = v_email
        and abs(extract(epoch from ((data ->> 'start')::timestamptz - s))) < (v_lim ->> 'days')::int * 86400
       ) >= (v_lim ->> 'count')::int then return 'limit'; end if;
  end if;
  v_seats := nullif(et ->> 'seats', '')::int;
  if v_seats is not null and v_seats > 0 then
    select count(*) into v_taken from records where kind = 'booking' and owner_id = p_owner and id <> coalesce(p_ignore, '')
      and data ->> 'status' in ('accepted', 'pending') and data ->> 'eventTypeId' = et ->> 'id'
      and (data ->> 'start')::timestamptz = s;
    if v_taken >= v_seats then return 'full'; end if;
  end if;
  bs := s - make_interval(mins => coalesce((et ->> 'bufferBefore')::int, 0));
  be := e + make_interval(mins => coalesce((et ->> 'bufferAfter')::int, 0));
  if exists (select 1 from records where kind = 'booking' and id <> coalesce(p_ignore, '')
      and (owner_id::text = any(v_hosts) or data -> 'coHostIds' ?| v_hosts)
      and data ->> 'status' in ('accepted', 'pending')
      and not (v_seats is not null and v_seats > 0 and data ->> 'eventTypeId' = et ->> 'id' and (data ->> 'start')::timestamptz = s)
      and (data ->> 'start')::timestamptz < be and (data ->> 'end')::timestamptz > bs) then return 'conflict'; end if;
  if exists (select 1 from records r, jsonb_array_elements(r.data -> 'blocks') x where r.kind = 'busy' and r.owner_id::text = any(v_hosts)
      and (x ->> 'start')::timestamptz < be and (x ->> 'end')::timestamptz > bs) then return 'conflict'; end if;
  return null;
end $$;

-- p_series: optional array of {start, end} for a recurring series (all or nothing, capped by recurring.maxCount).
create or replace function public.public_create_booking(p_booking jsonb, p_link_token text default null, p_series jsonb default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_owner uuid := (p_booking ->> 'ownerId')::uuid; v_err text; et jsonb; lk record; v_has_link boolean := false;
  base jsonb; b jsonb; occ jsonb; first jsonb := null; v_items jsonb; v_series_id text := null; i int := 0; v_host text; v_pay jsonb := null; v_source text;
begin
  perform set_config('slotwise.rpc', 'on', true);  -- trusted write: skips the client checks in _records_guard
  if coalesce(p_booking ->> 'hp', '') <> '' then return jsonb_build_object('ok', false, 'error', 'spam'); end if;
  -- the booking owner must be the event type owner or a consenting team host (_host_ok)
  if v_owner is null or not public._host_ok(p_booking ->> 'eventTypeId', v_owner::text) then
    return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  select data || jsonb_build_object('id', id) into et from records where kind = 'event_type' and id = p_booking ->> 'eventTypeId';
  if et is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if p_link_token is not null then
    select * into lk from records where kind = 'link' and data ->> 'token' = p_link_token and owner_id = v_owner for update;
    if not found or lk.data ->> 'eventTypeId' <> et ->> 'id' then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
    v_has_link := true;
    if lk.data ? 'usedBookingId' or (lk.data ->> 'expiresAt')::timestamptz < now() then
      return jsonb_build_object('ok', false, 'error', 'used'); end if;
  end if;
  v_source := case when v_has_link then 'link' when p_booking ->> 'source' in ('web', 'poll') then p_booking ->> 'source' else 'web' end;
  base := public._clean_booking(p_booking, et, v_owner, v_source);
  if base is null then return jsonb_build_object('ok', false, 'error', 'blocked'); end if;
  for v_host in select unnest(array[v_owner::text] || coalesce(array(select jsonb_array_elements_text(base -> 'coHostIds')), '{}')) order by 1 loop
    perform pg_advisory_xact_lock(hashtext(v_host));
  end loop;
  v_items := case when p_series is not null and jsonb_typeof(p_series) = 'array' and jsonb_array_length(p_series) > 1
    and jsonb_typeof(et -> 'recurring') = 'object'
    then (select jsonb_agg(x) from (select x from jsonb_array_elements(p_series) x limit coalesce((et -> 'recurring' ->> 'maxCount')::int, 1)) q)
    else jsonb_build_array(jsonb_build_object('start', p_booking ->> 'start', 'end', p_booking ->> 'end')) end;
  if jsonb_array_length(v_items) > 1 then v_series_id := public._new_id(16); end if;
  if jsonb_typeof(et -> 'price') = 'object' and coalesce((et -> 'price' ->> 'amount')::numeric, 0) > 0 then
    v_pay := jsonb_build_object('status', 'unpaid', 'currency', et -> 'price' ->> 'currency',
      'amount', case when et -> 'price' ->> 'mode' = 'deposit' and (et -> 'price' ->> 'depositAmount') is not null
        then (et -> 'price' ->> 'depositAmount')::numeric else (et -> 'price' ->> 'amount')::numeric end,
      'link', nullif(et -> 'price' ->> 'paymentLink', ''));
  end if;
  for occ in select * from jsonb_array_elements(v_items) loop
    b := base || jsonb_build_object('start', occ ->> 'start', 'end', occ ->> 'end');
    if i > 0 then b := b || jsonb_build_object('id', public._new_id(16), 'token', public._new_id(32)); end if;
    if v_pay is not null then b := b || jsonb_build_object('payment', v_pay); end if;
    if v_series_id is not null then b := b || jsonb_build_object('recurringId', v_series_id, 'recurringIndex', i); end if;
    v_err := public._check_slot(v_owner, b, null);
    if v_err is not null then raise exception using errcode = 'P0001', message = 'slotwise:' || v_err; end if;
    insert into records (id, owner_id, kind, data) values (b ->> 'id', v_owner, 'booking', b);
    if first is null then first := b; end if;
    i := i + 1;
  end loop;
  if v_has_link then
    update records set data = data || jsonb_build_object('usedBookingId', first ->> 'id'), updated_at = now() where id = lk.id;
  end if;
  return jsonb_build_object('ok', true, 'booking', first);
exception when sqlstate 'P0001' then
  if sqlerrm like 'slotwise:%' then return jsonb_build_object('ok', false, 'error', substr(sqlerrm, 10)); end if;
  raise;
end $$;

create or replace function public.public_cancel_booking(p_token text, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  perform set_config('slotwise.rpc', 'on', true);  -- trusted write: skips the client checks in _records_guard
  select * into r from records where kind = 'booking' and data ->> 'token' = p_token for update;
  if not found or r.data ->> 'status' not in ('accepted', 'pending') then return null; end if;
  update records set data = data || jsonb_build_object('status', 'cancelled', 'cancelReason', left(coalesce(p_reason, ''), 1000),
      'history', coalesce(data -> 'history', '[]') || jsonb_build_object('at', now(), 'action', 'cancelled', 'by', 'invitee', 'note', left(coalesce(p_reason, ''), 1000))),
    updated_at = now()
  where id = r.id returning data into r.data;
  return r.data - 'internalNotes';
end $$;

-- p_new: {start, end}. The new booking gets a fresh id and token; the Google event moves with it.
create or replace function public.public_reschedule_booking(p_token text, p_new jsonb, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r record; v_err text; nb jsonb; v_host text;
begin
  perform set_config('slotwise.rpc', 'on', true);  -- trusted write: skips the client checks in _records_guard
  select * into r from records where kind = 'booking' and data ->> 'token' = p_token for update;
  if not found or r.data ->> 'status' not in ('accepted', 'pending') then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  nb := (r.data - 'google' - 'reconfirmedAt' - 'workflowDone') || jsonb_build_object('start', p_new ->> 'start', 'end', p_new ->> 'end',
    'coHostIds', coalesce((select jsonb_agg(x) from jsonb_array_elements_text(
      case when jsonb_typeof(r.data -> 'coHostIds') = 'array' then r.data -> 'coHostIds' else '[]' end) x
      where public._cohosts_ok(r.data ->> 'eventTypeId', r.owner_id::text, jsonb_build_array(x))), '[]'));
  for v_host in select unnest(array[r.owner_id::text] || coalesce(array(select jsonb_array_elements_text(nb -> 'coHostIds')), '{}')) order by 1 loop
    perform pg_advisory_xact_lock(hashtext(v_host));
  end loop;
  v_err := public._check_slot(r.owner_id, nb, r.id);
  if v_err is not null then return jsonb_build_object('ok', false, 'error', v_err); end if;
  nb := nb || jsonb_build_object('id', public._new_id(16), 'token', public._new_id(32), 'rescheduledFromId', r.id,
    'rescheduleReason', left(coalesce(p_reason, ''), 1000), 'createdAt', now(), 'emailsSent', '[]'::jsonb,
    'status', case when (select (data ->> 'requiresConfirmation')::boolean from records where kind = 'event_type' and id = r.data ->> 'eventTypeId') then 'pending' else 'accepted' end,
    'history', coalesce(r.data -> 'history', '[]') || jsonb_build_object('at', now(), 'action', 'rescheduled', 'by', 'invitee', 'note', left(coalesce(p_reason, ''), 1000)));
  if r.data -> 'google' ->> 'eventId' is not null then
    nb := nb || jsonb_build_object('google', (r.data -> 'google') - 'syncedAt');
  end if;
  insert into records (id, owner_id, kind, data) values (nb ->> 'id', r.owner_id, 'booking', nb);
  update records set data = (data - 'google') || jsonb_build_object('status', 'cancelled', 'rescheduledToId', nb ->> 'id',
      'history', coalesce(data -> 'history', '[]') || jsonb_build_object('at', now(), 'action', 'rescheduled_away', 'by', 'invitee', 'note', left(coalesce(p_reason, ''), 1000))),
    updated_at = now() where id = r.id;
  return jsonb_build_object('ok', true, 'booking', nb - 'internalNotes');
end $$;

-- Voters are matched only by their secret id (kept in the voter's browser), never by email.
create or replace function public.public_vote_poll(p_id text, p_voter jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r record; voters jsonb; v_hit boolean := false; i int; v jsonb;
begin
  perform set_config('slotwise.rpc', 'on', true);  -- trusted write: skips the client checks in _records_guard
  if length(coalesce(p_voter ->> 'id', '')) < 12 or coalesce(trim(p_voter ->> 'name'), '') = '' then return null; end if;
  select * into r from records where kind = 'poll' and id = p_id for update;
  if not found or r.data ->> 'status' <> 'open' then return null; end if;
  v := jsonb_build_object('id', p_voter ->> 'id', 'name', left(trim(p_voter ->> 'name'), 80),
    'email', case when public._valid_email(lower(trim(p_voter ->> 'email'))) then lower(trim(p_voter ->> 'email')) else '' end,
    'votes', coalesce((select jsonb_agg(case when x in ('yes', 'maybe') then x else 'no' end)
      from (select jsonb_array_elements_text(case when jsonb_typeof(p_voter -> 'votes') = 'array' then p_voter -> 'votes' else '[]' end) x
            limit jsonb_array_length(coalesce(r.data -> 'options', '[]'))) q), '[]'),
    'at', now());
  voters := coalesce(r.data -> 'voters', '[]');
  for i in 0 .. jsonb_array_length(voters) - 1 loop
    if voters -> i ->> 'id' = v ->> 'id' then
      voters := jsonb_set(voters, array[i::text], v);
      v_hit := true;
    end if;
  end loop;
  if not v_hit then
    if jsonb_array_length(voters) >= 500 then return null; end if;
    voters := voters || jsonb_build_array(v);
  end if;
  update records set data = data || jsonb_build_object('voters', voters), updated_at = now() where id = r.id returning data into r.data;
  return public._public_poll(r.data);
end $$;

create or replace function public.public_reconfirm(p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  perform set_config('slotwise.rpc', 'on', true);  -- trusted write: skips the client checks in _records_guard
  select * into r from records where kind = 'booking' and data ->> 'token' = p_token for update;
  if not found or r.data ->> 'status' <> 'accepted' or (r.data ->> 'end')::timestamptz < now() then return null; end if;
  update records set data = data || jsonb_build_object('reconfirmedAt', now(),
      'history', coalesce(data -> 'history', '[]') || jsonb_build_object('at', now(), 'action', 'reconfirmed', 'by', 'invitee')),
    updated_at = now() where id = r.id returning data into r.data;
  return r.data - 'internalNotes';
end $$;

create or replace function public.public_personal_link(p_username text, p_slug text) returns jsonb
language sql stable security definer set search_path = public as $$
  select l.data from records l join records p on p.kind = 'profile' and p.owner_id = l.owner_id
  where l.kind = 'personal_link' and lower(p.data ->> 'username') = lower(p_username) and l.data ->> 'slug' = lower(p_slug) limit 1
$$;

create or replace function public.public_routing_form(p_username text, p_slug text) returns jsonb
language sql stable security definer set search_path = public as $$
  -- event types the form routes to are included even when hidden
  select jsonb_build_object('form', f.data - 'responses', 'profile', public._profile_bundle(f.owner_id, null, null,
    (select coalesce(jsonb_agg(t ->> 'eventTypeId'), '[]') from (
      select r -> 'target' as t from jsonb_array_elements(case when jsonb_typeof(f.data -> 'rules') = 'array' then f.data -> 'rules' else '[]' end) r
      union all select f.data -> 'fallback') q where t ->> 'type' = 'event')))
  from records f join records p on p.kind = 'profile' and p.owner_id = f.owner_id
  where f.kind = 'routing_form' and lower(p.data ->> 'username') = lower(p_username) and f.data ->> 'slug' = lower(p_slug) limit 1
$$;

-- Stores a sanitized response: at most 8KB, only answers whose keys are field ids of the form.
create or replace function public.public_submit_routing(p_form_id text, p_response jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare f record; v_ids text[]; v_answers jsonb;
begin
  perform set_config('slotwise.rpc', 'on', true);
  if p_response is null or jsonb_typeof(p_response) <> 'object' or octet_length(p_response::text) > 8192 then return; end if;
  select * into f from records where kind = 'routing_form' and id = p_form_id for update;
  if not found or jsonb_array_length(coalesce(f.data -> 'responses', '[]')) >= 5000 then return; end if;
  v_ids := array(select q ->> 'id' from jsonb_array_elements(case when jsonb_typeof(f.data -> 'fields') = 'array' then f.data -> 'fields' else '[]' end) q);
  select coalesce(jsonb_object_agg(key, value), '{}') into v_answers
    from jsonb_each(case when jsonb_typeof(p_response -> 'answers') = 'object' then p_response -> 'answers' else '{}' end)
    where key = any(v_ids);
  update records set data = jsonb_set(data, '{responses}', coalesce(data -> 'responses', '[]') || jsonb_build_array(jsonb_build_object(
      'id', coalesce(left(p_response ->> 'id', 40), public._new_id(16)), 'answers', v_answers,
      'routedTo', left(coalesce(p_response ->> 'routedTo', ''), 300), 'at', now()))),
    updated_at = now()
  where id = f.id;
end $$;

create or replace function public.public_team(p_slug text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare t record; v_members jsonb;
begin
  select * into t from records where kind = 'team' and lower(data ->> 'slug') = lower(p_slug) limit 1;
  if not found then return null; end if;
  select coalesce(jsonb_agg(public._profile_bundle(m.uid, null)), '[]') into v_members from (
    select distinct x.uid from (
      select t.owner_id as uid
      union all
      select (m ->> 'userId')::uuid from jsonb_array_elements(t.data -> 'members') m where (m ->> 'accepted')::boolean
    ) x
  ) m;
  return jsonb_build_object('team', t.data, 'members', v_members,
    'eventTypes', coalesce((select jsonb_agg(public._public_event_type(data)) from records where kind = 'event_type' and data ->> 'teamId' = t.id), '[]'));
end $$;

create or replace function public.my_teams() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(data), '[]') from records where kind = 'team'
    and (owner_id = auth.uid() or data -> 'members' @> jsonb_build_array(jsonb_build_object('userId', auth.uid()::text)))
$$;

create or replace function public.find_user(p_username text) returns jsonb
language sql stable security definer set search_path = public as $$
  select public._public_user(data) from records where kind = 'profile' and lower(data ->> 'username') = lower(p_username) limit 1
$$;

grant execute on function public.public_profile, public.public_busy, public.public_booking, public.public_poll,
  public.public_link, public.public_create_booking, public.public_cancel_booking,
  public.public_reschedule_booking, public.public_vote_poll, public.public_reconfirm, public.public_personal_link,
  public.public_routing_form, public.public_submit_routing, public.public_team, public.find_user, public.public_event_type to anon, authenticated;
grant execute on function public.my_teams to authenticated;
revoke all on function public._check_slot, public._check_rules, public._clean_booking, public._profile_bundle,
  public._host_ok, public._cohosts_ok, public._records_guard from public, anon, authenticated;
