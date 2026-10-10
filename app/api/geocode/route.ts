import { NextRequest, NextResponse } from 'next/server'

type Coordinate = { lat: number; lng: number }
type GeocodeResult = { lat: string; lon: string; display_name: string; address: Record<string, string> }
type ResolvedPlace = { lat: number; lng: number; display_name: string; address: Record<string, string> }

const coordinateCache = new Map<string, Promise<Coordinate | null>>()
const placeCache = new Map<string, Promise<ResolvedPlace | null>>()
let lastGeocodeAt = 0
let geocodeQueue: Promise<void> = Promise.resolve()

function normalizeArea(value: string) {
  return value.trim().replace(/[\s,]+/g, ' ').slice(0, 120)
}

async function requestNominatim(url: URL) {
  const request = geocodeQueue.then(async () => {
    const delay = Math.max(0, 1100 - (Date.now() - lastGeocodeAt))
    if (delay > 0) await new Promise<void>((resolve) => setTimeout(resolve, delay))
    lastGeocodeAt = Date.now()

    const response = await fetch(url, {
      headers: { 'Accept-Language': 'en', 'User-Agent': 'TrinelaSchoolFinder/1.0 (+https://trinela.in)' },
      next: { revalidate: 604_800 },
      signal: AbortSignal.timeout(10_000),
    })
    if (!response.ok) throw new Error('Neighborhood lookup failed.')
    return await response.json() as GeocodeResult[]
  })

  geocodeQueue = request.then(() => undefined, () => undefined)
  return request
}

function lookupNominatim(query: string) {
  const url = new URL('https://nominatim.openstreetmap.org/search')
  url.searchParams.set('q', query)
  url.searchParams.set('format', 'jsonv2')
  url.searchParams.set('limit', '1')
  url.searchParams.set('addressdetails', '1')
  url.searchParams.set('countrycodes', 'in')
  url.searchParams.set('viewbox', '77.3,13.2,77.85,12.65')
  url.searchParams.set('bounded', '1')
  return requestNominatim(url)
}

function fetchAreaCoordinate(area: string): Promise<Coordinate | null> {
  const cacheKey = area.toLocaleLowerCase()
  const cached = coordinateCache.get(cacheKey)
  if (cached) return cached

  const request = lookupNominatim(`${area}, Bengaluru, Karnataka, India`).then((results) => {
    const lat = Number(results[0]?.lat)
    const lng = Number(results[0]?.lon)
    return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null
  })
  const cachedRequest = request.catch(() => {
    coordinateCache.delete(cacheKey)
    return null
  })
  coordinateCache.set(cacheKey, cachedRequest)
  return cachedRequest
}

function fetchSearchPlace(query: string): Promise<ResolvedPlace | null> {
  const cacheKey = query.toLocaleLowerCase()
  const cached = placeCache.get(cacheKey)
  if (cached) return cached

  const normalizedQuery = normalizeArea(query)
  const queryWithCity = /^\d{6}$/.test(normalizedQuery)
    ? `${normalizedQuery}, Bengaluru, Karnataka, India`
    : `${normalizedQuery}, Bengaluru, India`
  const request = lookupNominatim(queryWithCity).then((results): ResolvedPlace | null => {
    const result = results[0]
    const lat = Number(result?.lat)
    const lng = Number(result?.lon)
    return result && Number.isFinite(lat) && Number.isFinite(lng)
      ? { lat, lng, display_name: result.display_name, address: result.address }
      : null
  })
  const cachedRequest = request.catch(() => {
    placeCache.delete(cacheKey)
    return null
  })
  placeCache.set(cacheKey, cachedRequest)
  return cachedRequest
}

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get('query')
  if (query !== null) {
    const searchTerm = normalizeArea(query)
    if (query.length > 120 || !searchTerm) {
      return NextResponse.json({ error: 'Enter a valid Bengaluru area or postal code.' }, { status: 400 })
    }

    try {
      const place = await fetchSearchPlace(searchTerm)
      return NextResponse.json({ place }, { headers: { 'Cache-Control': 'private, max-age=300' } })
    } catch {
      return NextResponse.json({ error: 'The requested location could not be found.' }, { status: 502 })
    }
  }

  const locationsParameter = request.nextUrl.searchParams.get('locations')
  if (!locationsParameter || locationsParameter.length > 4_000) {
    return NextResponse.json({ error: 'Provide a valid list of Bengaluru school neighborhoods.' }, { status: 400 })
  }

  let requested: unknown
  try {
    requested = JSON.parse(locationsParameter)
  } catch {
    return NextResponse.json({ error: 'The neighborhood list must be valid JSON.' }, { status: 400 })
  }

  if (!Array.isArray(requested) || requested.length > 25 || requested.some((area) => typeof area !== 'string' || !normalizeArea(area))) {
    return NextResponse.json({ error: 'Provide up to 25 valid school neighborhoods.' }, { status: 400 })
  }

  const areas = Array.from(new Set(requested.map((area: string) => normalizeArea(area))))
  const coordinates: Record<string, Coordinate | null> = {}

  try {
    for (const area of areas) {
      coordinates[area] = await fetchAreaCoordinate(area)
    }
  } catch {
    return NextResponse.json({ error: 'Neighborhood locations could not be loaded.' }, { status: 502 })
  }

  return NextResponse.json({ coordinates }, { headers: { 'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400' } })
}
