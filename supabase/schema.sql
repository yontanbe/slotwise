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
  kind text not null check (kind in ('profile', 'event_type', 'schedule', 'booking', 'poll', 'link', 'busy', 'outbox')),
  data jsonb not null,
  updated_at timestamptz not null default now()
);

create index if not exists records_kind_owner on public.records (kind, owner_id);
create unique index if not exists records_username on public.records ((lower(data ->> 'username'))) where kind = 'profile';
create index if not exists records_booking_token on public.records ((data ->> 'token')) where kind = 'booking';
create index if not exists records_link_token on public.records ((data ->> 'token')) where kind = 'link';

alter table public.records enable row level security;

drop policy if exists records_owner on public.records;
create policy records_owner on public.records
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- ---------- helpers ----------

create or replace function public._public_user(p jsonb) returns jsonb
language sql immutable as $$
  select jsonb_build_object(
    'id', p ->> 'id', 'name', p ->> 'name', 'username', p ->> 'username', 'bio', p ->> 'bio',
    'avatarUrl', p ->> 'avatarUrl', 'timezone', p ->> 'timezone', 'locale', p ->> 'locale',
    'weekStart', p -> 'weekStart', 'timeFormat', p ->> 'timeFormat', 'brandColor', p ->> 'brandColor',
    'shabbat', p -> 'shabbat', 'phone', p ->> 'phone', 'email', p ->> 'email')
$$;

create or replace function public._profile_bundle(p_owner uuid, p_redirect text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'user', public._public_user((select data from records where kind = 'profile' and owner_id = p_owner limit 1)),
    'eventTypes', coalesce((select jsonb_agg(data order by (data ->> 'position')::int) from records where kind = 'event_type' and owner_id = p_owner), '[]'::jsonb),
    'schedules', coalesce((select jsonb_agg(data) from records where kind = 'schedule' and owner_id = p_owner), '[]'::jsonb),
    'redirectedFrom', p_redirect)
$$;

-- ---------- public read ----------

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

create or replace function public.public_busy(p_owner uuid, p_from timestamptz, p_to timestamptz) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'bookings', coalesce((
      select jsonb_agg(jsonb_build_object('id', data ->> 'id', 'eventTypeId', data ->> 'eventTypeId', 'start', data ->> 'start', 'end', data ->> 'end'))
      from records where kind = 'booking' and owner_id = p_owner
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
    'eventType', (select data from records where kind = 'event_type' and id = b ->> 'eventTypeId'),
    'user', public._public_user((select data from records where kind = 'profile' and owner_id = v_owner limit 1)));
end $$;

create or replace function public.public_poll(p_id text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('poll', r.data, 'user', public._public_user(p.data))
  from records r join records p on p.kind = 'profile' and p.owner_id = r.owner_id
  where r.kind = 'poll' and r.id = p_id
$$;

create or replace function public.public_link(p_token text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('link', r.data, 'profile', public._profile_bundle(r.owner_id, null))
  from records r where r.kind = 'link' and r.data ->> 'token' = p_token limit 1
$$;

-- ---------- public write ----------

-- Checks conflicts under an advisory lock so two invitees cannot take the same slot.
create or replace function public._check_slot(p_owner uuid, b jsonb, p_ignore text) returns text
language plpgsql security definer set search_path = public as $$
declare et jsonb; prof jsonb; v_seats int; v_taken int; v_email text; v_domain text;
  s timestamptz := (b ->> 'start')::timestamptz; e timestamptz := (b ->> 'end')::timestamptz;
begin
  if e <= s or s < now() - interval '5 minutes' then return 'conflict'; end if;
  select data into et from records where kind = 'event_type' and id = b ->> 'eventTypeId' and owner_id = p_owner;
  if et is null then return 'not_found'; end if;
  if not (et -> 'durations' @> to_jsonb((extract(epoch from (e - s)) / 60)::int)) then return 'conflict'; end if;
  select data into prof from records where kind = 'profile' and owner_id = p_owner limit 1;
  v_email := lower(b -> 'attendee' ->> 'email');
  v_domain := split_part(v_email, '@', 2);
  if exists (select 1 from jsonb_array_elements_text(coalesce(prof -> 'blockedEmails', '[]')) x
             where lower(x) in (v_email, v_domain, '@' || v_domain)) then return 'blocked'; end if;
  v_seats := nullif(et ->> 'seats', '')::int;
  if v_seats is not null and v_seats > 0 then
    select count(*) into v_taken from records where kind = 'booking' and owner_id = p_owner and id <> coalesce(p_ignore, '')
      and data ->> 'status' in ('accepted', 'pending') and data ->> 'eventTypeId' = et ->> 'id'
      and (data ->> 'start')::timestamptz = s;
    if v_taken >= v_seats then return 'full'; end if;
    if exists (select 1 from records where kind = 'booking' and owner_id = p_owner and id <> coalesce(p_ignore, '')
      and data ->> 'status' in ('accepted', 'pending')
      and not (data ->> 'eventTypeId' = et ->> 'id' and (data ->> 'start')::timestamptz = s)
      and (data ->> 'start')::timestamptz < e and (data ->> 'end')::timestamptz > s) then return 'conflict'; end if;
  elsif exists (select 1 from records where kind = 'booking' and owner_id = p_owner and id <> coalesce(p_ignore, '')
      and data ->> 'status' in ('accepted', 'pending')
      and (data ->> 'start')::timestamptz < e and (data ->> 'end')::timestamptz > s) then return 'conflict';
  end if;
  if exists (select 1 from records r, jsonb_array_elements(r.data -> 'blocks') x where r.kind = 'busy' and r.owner_id = p_owner
      and (x ->> 'start')::timestamptz < e and (x ->> 'end')::timestamptz > s) then return 'conflict'; end if;
  return null;
end $$;

create or replace function public.public_create_booking(p_booking jsonb, p_link_token text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_owner uuid := (p_booking ->> 'ownerId')::uuid; v_err text; et jsonb; lk record; v_has_link boolean := false; b jsonb;
begin
  if coalesce(p_booking ->> 'hp', '') <> '' then return jsonb_build_object('ok', false, 'error', 'spam'); end if;
  perform pg_advisory_xact_lock(hashtext(v_owner::text));
  if p_link_token is not null then
    select * into lk from records where kind = 'link' and data ->> 'token' = p_link_token and owner_id = v_owner for update;
    if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
    v_has_link := true;
    if lk.data ? 'usedBookingId' or (lk.data ->> 'expiresAt')::timestamptz < now() then
      return jsonb_build_object('ok', false, 'error', 'used'); end if;
  end if;
  v_err := public._check_slot(v_owner, p_booking, null);
  if v_err is not null then return jsonb_build_object('ok', false, 'error', v_err); end if;
  select data into et from records where kind = 'event_type' and id = p_booking ->> 'eventTypeId';
  b := p_booking - 'hp'
    || jsonb_build_object(
      'status', case when (et ->> 'requiresConfirmation')::boolean then 'pending' else 'accepted' end,
      'title', et ->> 'title', 'source', case when p_link_token is null then coalesce(p_booking ->> 'source', 'web') else 'link' end,
      'noShow', false, 'internalNotes', '', 'emailsSent', '[]'::jsonb, 'createdAt', now());
  insert into records (id, owner_id, kind, data) values (b ->> 'id', v_owner, 'booking', b);
  if v_has_link then
    update records set data = data || jsonb_build_object('usedBookingId', b ->> 'id'), updated_at = now() where id = lk.id;
  end if;
  return jsonb_build_object('ok', true, 'booking', b);
end $$;

create or replace function public.public_cancel_booking(p_token text, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  select * into r from records where kind = 'booking' and data ->> 'token' = p_token for update;
  if not found or r.data ->> 'status' not in ('accepted', 'pending') then return null; end if;
  update records set data = data || jsonb_build_object('status', 'cancelled', 'cancelReason', p_reason,
      'history', coalesce(data -> 'history', '[]') || jsonb_build_object('at', now(), 'action', 'cancelled', 'by', 'invitee', 'note', p_reason)),
    updated_at = now()
  where id = r.id returning data into r.data;
  return r.data - 'internalNotes';
end $$;

create or replace function public.public_reschedule_booking(p_token text, p_new jsonb, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r record; v_err text; nb jsonb;
begin
  select * into r from records where kind = 'booking' and data ->> 'token' = p_token for update;
  if not found or r.data ->> 'status' not in ('accepted', 'pending') then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  perform pg_advisory_xact_lock(hashtext(r.owner_id::text));
  nb := r.data || jsonb_build_object('start', p_new ->> 'start', 'end', p_new ->> 'end');
  v_err := public._check_slot(r.owner_id, nb, r.id);
  if v_err is not null then return jsonb_build_object('ok', false, 'error', v_err); end if;
  nb := nb || jsonb_build_object('id', p_new ->> 'id', 'token', p_new ->> 'token', 'rescheduledFromId', r.id,
    'rescheduleReason', p_reason, 'createdAt', now(), 'emailsSent', '[]'::jsonb,
    'history', coalesce(r.data -> 'history', '[]') || jsonb_build_object('at', now(), 'action', 'rescheduled', 'by', 'invitee', 'note', p_reason));
  insert into records (id, owner_id, kind, data) values (nb ->> 'id', r.owner_id, 'booking', nb);
  update records set data = (data - 'google') || jsonb_build_object('status', 'cancelled', 'rescheduledToId', nb ->> 'id',
      'history', coalesce(data -> 'history', '[]') || jsonb_build_object('at', now(), 'action', 'rescheduled_away', 'by', 'invitee', 'note', p_reason)),
    updated_at = now() where id = r.id;
  return jsonb_build_object('ok', true, 'booking', nb - 'internalNotes');
end $$;

create or replace function public.public_vote_poll(p_id text, p_voter jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r record; voters jsonb; v_hit boolean := false; i int;
begin
  select * into r from records where kind = 'poll' and id = p_id for update;
  if not found or r.data ->> 'status' <> 'open' then return null; end if;
  voters := coalesce(r.data -> 'voters', '[]');
  for i in 0 .. jsonb_array_length(voters) - 1 loop
    if voters -> i ->> 'id' = p_voter ->> 'id'
       or (coalesce(p_voter ->> 'email', '') <> '' and lower(voters -> i ->> 'email') = lower(p_voter ->> 'email')) then
      voters := jsonb_set(voters, array[i::text], p_voter || jsonb_build_object('id', voters -> i ->> 'id'));
      v_hit := true;
    end if;
  end loop;
  if not v_hit then voters := voters || jsonb_build_array(p_voter); end if;
  update records set data = data || jsonb_build_object('voters', voters), updated_at = now() where id = r.id returning data into r.data;
  return r.data;
end $$;

grant execute on function public.public_profile, public.public_busy, public.public_booking, public.public_poll,
  public.public_link, public.public_create_booking, public.public_cancel_booking,
  public.public_reschedule_booking, public.public_vote_poll to anon, authenticated;
revoke execute on function public._check_slot, public._profile_bundle from anon, authenticated;
