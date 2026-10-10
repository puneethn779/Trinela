// The configured URL may include a service path like `/rest/v1/`; Supabase clients need the bare project origin.
export function getSupabaseUrl() {
  const raw = 'https://kxtrlwlvaonswwpguhmb.supabase.co'
  if (!raw) return ''
  try {
    return new URL(raw).origin
  } catch {
    return raw.replace(/\/(rest|auth)\/v1\/?$/, '').replace(/\/$/, '')
  }
}
