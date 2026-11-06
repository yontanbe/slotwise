import type { EventLocation, LocationType } from './types'

type L = (he: string, en: string) => string

export const LOCATION_TYPES: LocationType[] = ['meet', 'zoom', 'teams', 'phone_host', 'phone_invitee', 'whatsapp', 'in_person', 'link']

export function locationName(t: LocationType, L: L): string {
  switch (t) {
    case 'meet':
      return 'Google Meet'
    case 'zoom':
      return 'Zoom'
    case 'teams':
      return 'Microsoft Teams'
    case 'phone_host':
      return L('אני אתקשר', 'I will call')
    case 'phone_invitee':
      return L('המוזמן מתקשר', 'Invitee calls')
    case 'whatsapp':
      return L('שיחת WhatsApp', 'WhatsApp call')
    case 'in_person':
      return L('פגישה פרונטלית', 'In person')
    case 'link':
      return L('קישור מותאם', 'Custom link')
  }
}

export function locationDetail(loc: EventLocation, L: L, meetUrl?: string): string {
  if (loc.type === 'meet') return meetUrl || L('קישור Meet יישלח בהזמנה', 'Meet link will be in the invite')
  if (loc.type === 'phone_host') return L('נתקשר למספר שהשארת', 'We will call the number you left')
  return loc.value || ''
}

export const LOCATION_GLYPH: Record<LocationType, string> = {
  meet: '◉',
  zoom: '◎',
  teams: '◈',
  phone_host: '☏',
  phone_invitee: '☎',
  whatsapp: '✆',
  in_person: '⌂',
  link: '↗',
}
