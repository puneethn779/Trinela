import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseUrl } from '@/lib/supabase/url'

const PAGE_SIZE = 1000

type SchoolRow = {
  id: string | number
  name: string | null
  location: string | null
  price: number | string | null
  rating: number | string | null
  lat: number | string | null
  lng: number | string | null
  main_image_url: string | null
  [column: string]: unknown
}

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const supabaseUrl = getSupabaseUrl()
  const apiKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt4dHJsd2x2YW9uc3d3cGd1aG1iIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE0NTU5NzUsImV4cCI6MjEwNzAzMTk3NX0.IvFEchXhfvAk65vDyoRlZ-OqDQ4N60he9m2nUPZqDgI',
  if (!supabaseUrl || !apiKey) {
    return NextResponse.json({ error: 'School listings are not configured.' }, { status: 503 })
  }

  const schools: SchoolRow[] = []

  try {
    for (let offset = 0; ; offset += PAGE_SIZE) {
      const query = new URLSearchParams({
        select: '*',
        order: 'rating.desc.nullslast,id.asc',
      })

      const response = await fetch(`${supabaseUrl}/rest/v1/schools?${query.toString()}`, {
        headers: {
          apikey: apiKey,
          Authorization: `Bearer ${apiKey}`,
          Range: `${offset}-${offset + PAGE_SIZE - 1}`,
          'Range-Unit': 'items',
        },
        cache: 'no-store',
        signal: AbortSignal.timeout(15_000),
      })

      if (!response.ok) {
        return NextResponse.json({ error: 'Unable to load school listings.' }, { status: 502 })
      }

      const page = await response.json() as SchoolRow[]
      schools.push(...page)
      if (page.length < PAGE_SIZE) break
    }

    return NextResponse.json({ schools }, { headers: { 'Cache-Control': 'no-store' } })
  } catch {
    return NextResponse.json({ error: 'Unable to load school listings.' }, { status: 502 })
  }
}
