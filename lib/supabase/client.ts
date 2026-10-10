import { createBrowserClient } from '@supabase/ssr'
import { getSupabaseUrl } from './url'

export function createClient() {
  return createBrowserClient(
   'https://kxtrlwlvaonswwpguhmb.supabase.co',
'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt4dHJsd2x2YW9uc3d3cGd1aG1iIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE0NTU5NzUsImV4cCI6MjEwNzAzMTk3NX0.IvFEchXhfvAk65vDyoRlZ-OqDQ4N60he9m2nUPZqDgI',
    {
      // Secure cookies in production; not in dev, so localhost still works.
      cookieOptions: { secure: process.env.NODE_ENV === 'production' },
    },
  )
}
