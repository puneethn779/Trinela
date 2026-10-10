'use client'

import { useEffect, useMemo, useRef } from 'react'
import L from 'leaflet'
import useSWR from 'swr'
import { MapContainer, Marker, Popup, TileLayer, useMap } from 'react-leaflet'
import { MapPin } from 'lucide-react'

export type SchoolMapFocus = {
  lat: number
  lng: number
  zoom: number
  key: number
}

type SchoolMapEntry = {
  id: string | number
  name: string
  location: string
  lat: number | null
  lng: number | null
}

type Coordinate = { lat: number; lng: number }

type SchoolMapProps = {
  schools: SchoolMapEntry[]
  focus: SchoolMapFocus | null
  onAreasGeocoded: (coordinates: Record<string, Coordinate | null>) => void
}

const BENGALURU_CENTER: L.LatLngExpression = [12.9716, 77.5946]

function isCoordinate(value: Coordinate | null | undefined): value is Coordinate {
  return Boolean(value && Number.isFinite(value.lat) && Number.isFinite(value.lng) && Math.abs(value.lat) <= 90 && Math.abs(value.lng) <= 180)
}

async function fetchAreaCoordinates([, areasJson]: [string, string]): Promise<Record<string, Coordinate | null>> {
  const response = await fetch('/api/geocode?' + new URLSearchParams({ locations: areasJson }))
  if (!response.ok) throw new Error('School neighborhood locations could not be loaded.')
  const data = await response.json() as { coordinates: Record<string, Coordinate | null> }
  return data.coordinates
}

function MapCamera({ focus, locations, locationsReady }: { focus: SchoolMapFocus | null; locations: L.LatLngExpression[]; locationsReady: boolean }) {
  const map = useMap()
  const fittedToSchools = useRef(false)

  useEffect(() => {
    if (focus) {
      map.flyTo([focus.lat, focus.lng], focus.zoom, { duration: 0.8 })
      return
    }

    if (locationsReady && locations.length && !fittedToSchools.current) {
      map.fitBounds(L.latLngBounds(locations), { padding: [32, 32], maxZoom: 12 })
      fittedToSchools.current = true
    }
  }, [focus, locations, locationsReady, map])

  return null
}

function createSchoolIcon() {
  return L.divIcon({
    className: 'school-marker-wrap',
    html: '<span class="school-marker-pin"><span class="school-marker-dot"></span></span>',
    iconSize: [32, 38],
    iconAnchor: [16, 36],
    popupAnchor: [0, -34],
  })
}

export default function SchoolMap({ schools, focus, onAreasGeocoded }: SchoolMapProps) {
  const missingLocations = useMemo(
    () => Array.from(new Set(schools.filter((school) => !isCoordinate(school.lat !== null && school.lng !== null ? { lat: school.lat, lng: school.lng } : null)).map((school) => school.location.trim()).filter(Boolean))),
    [schools],
  )
  const locationsJson = JSON.stringify(missingLocations)
  const { data: areaCoordinates, isLoading: isResolvingAreas, error: geocodingError } = useSWR<Record<string, Coordinate | null>, Error, [string, string] | null>(
    missingLocations.length ? ['school-map-area-coordinates', locationsJson] : null,
    fetchAreaCoordinates,
    { revalidateOnFocus: false, revalidateIfStale: false, dedupingInterval: 86_400_000 },
  )

  useEffect(() => {
    if (areaCoordinates) onAreasGeocoded(areaCoordinates)
  }, [areaCoordinates, onAreasGeocoded])

  const markers = useMemo(() => {
    const stackCounts = new Map<string, number>()

    return schools.flatMap((school) => {
      const direct = school.lat !== null && school.lng !== null ? { lat: school.lat, lng: school.lng } : null
      const resolved = isCoordinate(direct) ? direct : areaCoordinates?.[school.location.trim()] ?? null
      if (!isCoordinate(resolved)) return []

      const stackKey = `${resolved.lat.toFixed(5)}:${resolved.lng.toFixed(5)}`
      const stackIndex = stackCounts.get(stackKey) ?? 0
      stackCounts.set(stackKey, stackIndex + 1)
      const angle = stackIndex * 2.399963229728653
      const offset = stackIndex === 0 ? 0 : 0.00028

      return [{
        school,
        coordinate: {
          lat: resolved.lat + Math.sin(angle) * offset,
          lng: resolved.lng + Math.cos(angle) * offset,
        },
        approximate: !isCoordinate(direct),
      }]
    })
  }, [areaCoordinates, schools])

  const locationsReady = missingLocations.length === 0 || (!isResolvingAreas && Boolean(areaCoordinates || geocodingError))
  const visibleLocations = useMemo(() => markers.map(({ coordinate }) => [coordinate.lat, coordinate.lng] as L.LatLngExpression), [markers])
  const unresolvedCount = schools.length - markers.length

  return (
    <div className="school-map-frame">
      <div className="school-map-stamp" aria-live="polite"><MapPin size={13} aria-hidden="true" /><span>{markers.length} {markers.length === 1 ? 'school pin' : 'school pins'} mapped</span></div>
      <MapContainer center={BENGALURU_CENTER} zoom={11} scrollWheelZoom={false} className="school-map-canvas" aria-label="Map of every driving school in Bengaluru">
        <TileLayer
          attribution={'&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap contributors</a>'}
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          maxZoom={19}
        />
        <MapCamera focus={focus} locations={visibleLocations} locationsReady={locationsReady} />
        {markers.map(({ school, coordinate, approximate }) => (
          <Marker
            key={school.id}
            position={[coordinate.lat, coordinate.lng]}
            icon={createSchoolIcon()}
            title={school.name}
            alt={`Driving school ${school.name} in ${school.location}`}
          >
            <Popup className="school-map-popup">
              <strong>{school.name}</strong>
              <span>{school.location}</span>
              {approximate && <small>Approximate neighborhood location</small>}
            </Popup>
          </Marker>
        ))}
      </MapContainer>
      {unresolvedCount > 0 && <p className="school-map-status" role={geocodingError ? 'status' : undefined}>
        {geocodingError ? `${unresolvedCount} school ${unresolvedCount === 1 ? 'area' : 'areas'} could not be mapped.` : `Finding neighborhood pins for ${unresolvedCount} ${unresolvedCount === 1 ? 'school' : 'schools'}…`}
      </p>}
    </div>
  )
}

export type { Coordinate as SchoolMapCoordinate }
export { BENGALURU_CENTER }
