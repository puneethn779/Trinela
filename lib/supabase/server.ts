import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { getSupabaseUrl } from './url'

/**
 * Especially important if using Fluid compute: Don't put this client in a
 * global variable. Always create a new client within each function when using
 * it.
 */
export async function createClient() {
  const cookieStore = await cookies()

  return createServerClient(
    'https://kxtrlwlvaonswwpguhmb.supabase.co',
'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt4dHJsd2x2YW9uc3d3cGd1aG1iIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE0NTU5NzUsImV4cCI6MjEwNzAzMTk3NX0.IvFEchXhfvAk65vDyoRlZ-OqDQ4N60he9m2nUPZqDgI',
    {
      // Secure cookies in production; not in dev, so localhost still works.
      cookieOptions: { secure: process.env.NODE_ENV === 'production' },
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            )
          } catch {
            // The "setAll" method was called from a Server Component.
            // This can be ignored if you have proxy refreshing
            // user sessions.
          }
        },
      },
    },
  )
}
