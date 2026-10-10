'use client'

import nextDynamic from 'next/dynamic'
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import useSWR from 'swr'
import { createClient as createSupabaseClient } from '@/lib/supabase/client'
import type { User } from '@supabase/supabase-js'
import {
  ArrowLeft,
  ArrowRight,
  BadgeCheck,
  CalendarDays,
  CarFront,
  Check,
  ChevronDown,
  CircleCheck,
  CircleDollarSign,
  Clock3,
  Copy,
  CreditCard,
  FileCheck2,
  Headset,
  HeartHandshake,
  Home,
  Heart,
  Gift,
  Languages,
  LoaderCircle,
  LockKeyhole,
  MapPin,
  MessageCircle,
  Menu,
  Navigation,
  Search,
  ShieldCheck,
  Smartphone,
  Star,
  TrendingUp,
  UserRound,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { toast } from 'sonner'
import type { SchoolMapFocus } from '@/components/school-map'

const supabase = createSupabaseClient()
const SchoolMap = nextDynamic(() => import('@/components/school-map'), {
  ssr: false,
  loading: () => <div className="school-map-loading" role="status">Loading school map…</div>,
})
export const dynamic = 'force-dynamic';
type School = {
  id: string | number
  name: string
  location: string
  lat: number | null
  lng: number | null
  marketPrice: number | null
  trinelaPrice: number
  rating: number | null
  verified?: boolean
  transmission?: 'manual' | 'automatic' | null
  main_image_url: string | null
  initials: string
  accent: string
  tint: string
  description?: string
  cars?: string[]
  reviewCount?: number | null
  featuredBadge?: string
  galleryImages: string[]
  features: string[]
  carDetails: SchoolCar[]
  trainerDetails: SchoolTrainer[]
  packages: SchoolPackage[]
}

type SchoolCar = { name: string; transmission: string | null; image: string | null }
type SchoolTrainer = { name: string; gender: string | null; experience: string | null; languages: string[]; image: string | null; rating: number | null }
type SchoolPackage = { name: string; price: number | null; days: number | null; minsPerDay: number | null; duration: string | null; description: string | null; lessons: Array<{ label: string | null; title: string; detail: string | null }> }

type NominatimPlace = {
  place_id: number
  display_name: string
  address: Record<string, string>
  lat?: string
  lon?: string
  lng?: string | number
  name?: string
  class?: string
  category?: string
  addresstype?: string
  type?: string
}

type NominatimLocation = Pick<NominatimPlace, 'display_name' | 'address' | 'lat' | 'lon' | 'lng' | 'name'>
type SchoolCoordinate = { lat: number; lng: number }

function getPlaceCoordinates(place: NominatimLocation): SchoolCoordinate | undefined {
  const lat = Number(place.lat)
  const lng = Number(place.lon ?? place.lng)
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : undefined
}

function getSchoolSearchArea(place: NominatimLocation) {
  const address = place.address
  return address.suburb ?? address.neighbourhood ?? address.quarter ?? address.city_district ?? address.town ?? address.city ?? address.village ?? getPlaceAreaName(place)
}

function isValidSchoolCoordinate(value: SchoolCoordinate | null | undefined): value is SchoolCoordinate {
  return Boolean(value && Number.isFinite(value.lat) && Number.isFinite(value.lng) && Math.abs(value.lat) <= 90 && Math.abs(value.lng) <= 180)
}

function haversineDistanceKm(first: SchoolCoordinate, second: SchoolCoordinate) {
  const earthRadiusKm = 6371
  const toRadians = (degrees: number) => degrees * Math.PI / 180
  const latitudeDifference = toRadians(second.lat - first.lat)
  const longitudeDifference = toRadians(second.lng - first.lng)
  const distance = Math.sin(latitudeDifference / 2) ** 2
    + Math.cos(toRadians(first.lat)) * Math.cos(toRadians(second.lat)) * Math.sin(longitudeDifference / 2) ** 2
  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(distance), Math.sqrt(1 - distance))
}

const BENGALURU_MAP_CENTER = { lat: 12.9716, lng: 77.5946 }
const SCHOOL_SEARCH_RADIUS_KM = 8


const areaPlaceClasses = new Set(['place', 'boundary'])
const excludedPlaceClasses = new Set(['amenity', 'office', 'shop', 'building', 'leisure'])
const areaPlaceTypes = new Set(['suburb', 'neighbourhood', 'residential', 'city_district'])

function getPlaceAreaName(place: NominatimLocation) {
  return place.address?.suburb
    || place.address?.neighbourhood
    || place.address?.residential
    || place.name
    || place.display_name.split(',')[0]?.trim()
    || ''
}

function formatPlaceDisplayLabel(place: NominatimLocation) {
  const areaName = getPlaceAreaName(place)
  const postcode = place.address?.postcode
  return areaName ? `${areaName}${postcode ? ` - ${postcode}` : ''}` : ''
}

function isIndianPostcode(value: string) {
  return /^\d{6}$/.test(value.trim())
}

function extractCoreArea(searchInput: string) {
  return searchInput
    .replace(/\b\d{6}\b/g, ' ')
    .replace(/\bbengaluru\b/gi, ' ')
    .replace(/\bkarnataka\b/gi, ' ')
    .replace(/[—–-]/g, ' ')
    .replace(/[\s,]+/g, ' ')
    .trim()
}

function isAreaPlace(place: NominatimPlace) {
  const placeClass = place.class ?? place.category ?? ''
  return Boolean(getPlaceAreaName(place))
    && !excludedPlaceClasses.has(placeClass)
    && (areaPlaceClasses.has(placeClass) || areaPlaceTypes.has(place.type ?? ''))
}

let lastNominatimRequestAt = 0
let nominatimRequestQueue = Promise.resolve()

async function fetchNominatimJson<T>(url: URL, signal?: AbortSignal): Promise<T> {
  const request = nominatimRequestQueue.then(async () => {
    if (signal?.aborted) throw new DOMException('Location lookup cancelled', 'AbortError')

    const delay = Math.max(0, 1000 - (Date.now() - lastNominatimRequestAt))
    if (delay > 0) await new Promise<void>((resolve) => window.setTimeout(resolve, delay))
    if (signal?.aborted) throw new DOMException('Location lookup cancelled', 'AbortError')

    lastNominatimRequestAt = Date.now()
    const response = await fetch(url, { signal, headers: { 'Accept-Language': 'en' } })
    if (!response.ok) throw new Error(`Location lookup failed with status ${response.status}`)
    return await response.json() as T
  })

  nominatimRequestQueue = request.then(() => undefined, () => undefined)
  return request
}

type ActiveBooking = {
  school: School
  dateLabel: string
  timeLabel: string
  studentName: string
  balanceDue: number
}

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
}

const schoolColors = [
  { accent: '#f35c45', tint: '#fff0ec' },
  { accent: '#f2a943', tint: '#fff6e8' },
  { accent: '#6487d8', tint: '#edf2ff' },
]

const currency = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
})

async function fetchSchools(): Promise<School[]> {
  const response = await fetch('/api/schools', { cache: 'no-store' })
  if (!response.ok) throw new Error('Unable to load school listings.')

  const { schools: rows } = await response.json() as { schools: Array<{ id: string | number; name: string | null; location: string | null; price: number | string | null; rating: number | string | null; lat: number | string | null; lng: number | string | null; main_image_url: string | null; [column: string]: unknown }> }

  return rows.map((row, index) => {
    const colors = schoolColors[index % schoolColors.length]
    const name = String(row.name ?? 'Driving school')
    const rating = toNumber(row.rating)
    const cars = asArray(row.cars).map(toText).filter((car): car is string => car !== null)

    return {
      reviewCount: toNumber(row.review_count),
      featuredBadge: toText(row.badge) ?? undefined,
      cars,
      galleryImages: asArray(row.gallery_images).map(toText).filter((src): src is string => src !== null),
      features: asArray(row.features).map(toText).filter((feature): feature is string => feature !== null),
      carDetails: parseCarDetails(row.car_details),
      trainerDetails: parseTrainerDetails(row.trainer_details),
      packages: parsePackages(row.packages),
      id: row.id,
      name,
      location: String(row.location ?? 'Bengaluru'),
      lat: row.lat === null ? null : Number(row.lat),
      lng: row.lng === null ? null : Number(row.lng),
      marketPrice: null,
      trinelaPrice: row.price === null ? Number.NaN : Number(row.price),
      rating: rating !== null && rating > 0 ? rating : null,
      main_image_url: row.main_image_url,
      initials: name.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase(),
      ...colors,
    }
  })
}

function asArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value
  if (typeof value === 'string') {
    try {
      const parsed: unknown = JSON.parse(value)
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  }
  return []
}

function toText(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value.trim()
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return null
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function pickText(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = toText(record[key])
    if (value) return value
  }
  return null
}

function parseCarDetails(value: unknown): SchoolCar[] {
  return asArray(value).flatMap((item) => {
    const plain = toText(item)
    if (plain) return [{ name: plain, transmission: null, image: null }]
    const record = asRecord(item)
    const name = record && pickText(record, ['name', 'model', 'car', 'car_name', 'car_model'])
    if (!record || !name) return []
    return [{ name, transmission: pickText(record, ['transmission', 'type', 'gear']), image: pickText(record, ['image', 'image_url', 'photo', 'photo_url']) }]
  })
}

function parseTrainerDetails(value: unknown): SchoolTrainer[] {
  return asArray(value).flatMap((item) => {
    const plain = toText(item)
    if (plain) return [{ name: plain, gender: null, experience: null, languages: [], image: null, rating: null }]
    const record = asRecord(item)
    const name = record && pickText(record, ['name', 'trainer_name', 'full_name', 'instructor_name'])
    if (!record || !name) return []
    const experienceValue = record.experience ?? record.experience_years ?? record.years_experience ?? record.years
    const experience = typeof experienceValue === 'number' ? `${experienceValue} yrs exp` : toText(experienceValue)
    const languages = Array.isArray(record.languages) ? record.languages.map(toText).filter((language): language is string => language !== null) : (toText(record.languages)?.split(',').map((language) => language.trim()).filter(Boolean) ?? [])
    const rating = toNumber(record.rating)
    return [{ name, gender: pickText(record, ['gender']), experience, languages, image: pickText(record, ['image', 'image_url', 'photo', 'photo_url', 'avatar_url']), rating: rating !== null && rating > 0 ? rating : null }]
  })
}

function parsePackages(value: unknown): SchoolPackage[] {
  return asArray(value).flatMap((item) => {
    const plain = toText(item)
  if (plain) return [{ name: plain, price: null, days: null, minsPerDay: null, duration: null, description: null, lessons: [] }]
  const record = asRecord(item)
  const name = record && pickText(record, ['name', 'title', 'package_name'])
  if (!record || !name) return []
  const days = toPositiveInteger(record.days ?? record.duration_days)
  const minsPerDay = toPositiveInteger(record.mins_per_day ?? record.minutes_per_day)
  const durationValue = record.duration
  const duration = formatPackageFormat(days, minsPerDay) ?? (typeof durationValue === 'number' ? `${durationValue} days` : toText(durationValue))
    const lessonSource = record.lessons ?? record.syllabus ?? record.details ?? record.plan ?? record.sessions
    const lessons = asArray(lessonSource).flatMap((lesson) => {
      const lessonText = toText(lesson)
      if (lessonText) return [{ label: null, title: lessonText, detail: null }]
      const lessonRecord = asRecord(lesson)
      const title = lessonRecord && pickText(lessonRecord, ['title', 'name', 'topic', 'lesson'])
      if (!lessonRecord || !title) return []
      return [{ label: pickText(lessonRecord, ['label', 'days', 'day', 'session']), title, detail: pickText(lessonRecord, ['description', 'detail', 'details']) }]
    })
  return [{ name, price: toNumber(record.price ?? record.amount), days, minsPerDay, duration, description: pickText(record, ['description', 'summary']), lessons }]
  })
  }

function toPositiveInteger(value: unknown) {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number.parseInt(value, 10) : Number.NaN
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : null
}

function formatMinutes(mins: number) {
  if (mins % 60 === 0) return `${mins / 60} hr`
  if (mins > 60) return `${Math.floor(mins / 60)} hr ${mins % 60} min`
  return `${mins} min`
}

function formatPackageFormat(days: number | null, minsPerDay: number | null) {
  if (days === null && minsPerDay === null) return null
  return [days !== null ? `${days} ${days === 1 ? 'day' : 'days'}` : null, minsPerDay !== null ? `${formatMinutes(minsPerDay)}/day` : null].filter(Boolean).join(' - ')
}

const OPERATING_START_MINUTES = 6 * 60
const OPERATING_END_MINUTES = 18 * 60
const SLOT_STEP_MINUTES = 30
const DEFAULT_SESSION_MINUTES = 60

function formatClock(totalMinutes: number) {
  const hours24 = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  const period = hours24 >= 12 ? 'PM' : 'AM'
  const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12
  return `${String(hours12).padStart(2, '0')}:${String(minutes).padStart(2, '0')} ${period}`
}

type TimeSlot = { label: string; start: number; end: number; period: 'Morning' | 'Afternoon' | 'Evening' }

function buildTimeSlots(sessionMinutes: number): TimeSlot[] {
  const duration = Math.min(Math.max(sessionMinutes, 15), OPERATING_END_MINUTES - OPERATING_START_MINUTES)
  const slots: TimeSlot[] = []
  for (let start = OPERATING_START_MINUTES; start + duration <= OPERATING_END_MINUTES; start += SLOT_STEP_MINUTES) {
    const end = start + duration
    slots.push({ label: `${formatClock(start)} - ${formatClock(end)}`, start, end, period: start < 12 * 60 ? 'Morning' : start < 15 * 60 ? 'Afternoon' : 'Evening' })
  }
  return slots
}

function isWithinOperatingHours(timeLabel: string, sessionMinutes: number) {
  return buildTimeSlots(sessionMinutes).some((slot) => slot.label === timeLabel)
}

function RatingBadge({ rating, reviewCount, className }: { rating: number | null; reviewCount?: number | null; className: string }) {
  if (rating === null || rating <= 0) return <span className={`${className} no-rating`}>No ratings yet</span>
  return <span className={className}><Star size={13} fill="currentColor" aria-hidden="true" /> {rating.toFixed(1)}{reviewCount ? <span className="review-count">({reviewCount})</span> : null}</span>
}

function formatPrice(value: number) {
  return Number.isFinite(value) ? currency.format(value) : '—'
}

function IndianCarImage({ src, ...imageProps }: React.ImgHTMLAttributes<HTMLImageElement> & { src: string }) {
  return <img {...imageProps} src={src} />
}

function handleInstructorImageError(event: React.SyntheticEvent<HTMLImageElement>) {
  event.currentTarget.hidden = true
}

function getNextSevenDates() {
  const todayParts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  }).formatToParts(new Date())
  const year = Number(todayParts.find((part) => part.type === 'year')?.value)
  const month = Number(todayParts.find((part) => part.type === 'month')?.value)
  const day = Number(todayParts.find((part) => part.type === 'day')?.value)

  return Array.from({ length: 7 }, (_, index) => new Date(Date.UTC(year, month - 1, day + index + 1)))
}

function formatBookingDate(date: Date) {
  const weekday = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: 'UTC' }).format(date)
  const day = new Intl.DateTimeFormat('en-US', { day: '2-digit', timeZone: 'UTC' }).format(date)
  const month = new Intl.DateTimeFormat('en-US', { month: 'short', timeZone: 'UTC' }).format(date)
  return `${weekday}, ${day} ${month}`
}

function formatBookingSlot(date: Date, timeSlot: string) {
  return `${formatBookingDate(date)} - ${timeSlot.split(' - ')[0]}`
}

function BrandMark() {
  return (
    <a className="brand" href="#top" aria-label="Trinela home">
      <img src="https://hebbkx1anhila5yf.public.blob.vercel-storage.com/Trinela%20Logo%20DP.png-jDzzafhxCX79XZeKJqKxLDGPD8vFop.jpeg" alt="Trinela" />
    </a>
  )
}

function Header({ location, locating, onLocate, onPartnerClick, onAccountNavigation, onAuthClick }: { location: string; locating: boolean; onLocate: () => void; onPartnerClick: () => void; onAccountNavigation: (view: 'My Bookings' | 'Profile') => void; onAuthClick: (mode: 'signin' | 'signup') => void }) {
  return (
    <header className="site-header">
      <div className="header-inner">
        <BrandMark />
        <nav className="desktop-nav" aria-label="Main navigation">
          <a href="#schools">Driving schools</a>
          <a href="#how-it-works">How it works</a>
          <a href="#faq">FAQs</a>
          <button type="button" className="header-account-link" onClick={() => onAccountNavigation('My Bookings')}>My Bookings</button>
          <button type="button" className="header-account-link" onClick={() => onAccountNavigation('Profile')}>Profile</button>
        </nav>
        <button className="header-location" onClick={onLocate} disabled={locating} aria-label="Detect my location">
          <MapPin size={16} strokeWidth={2.2} />
          <span>{locating ? 'Detecting location…' : location || 'Bengaluru'}</span>
          <ChevronDown size={14} />
        </button>
        <div className="header-auth-actions" aria-label="Account access">
          <button type="button" className="header-auth-signin" onClick={() => onAuthClick('signin')}>Sign in</button>
          <button type="button" className="header-auth-signup" onClick={() => onAuthClick('signup')}>Sign up</button>
        </div>
        <a className="header-partner" href="#partner" onClick={(event) => { event.preventDefault(); onPartnerClick() }}>Partner with us <ArrowRight size={15} /></a>
        <a className="mobile-menu" href="#schools" aria-label="Browse driving schools">
          <Menu size={21} />
        </a>
      </div>
    </header>
  )
}

function GoogleMark() {
  return (
    <svg aria-hidden="true" viewBox="0 0 48 48" width="18" height="18">
      <path fill="#4285F4" d="M43.6 24.5c0-1.4-.1-2.8-.4-4.1H24v7.8h11a9.4 9.4 0 0 1-4.1 6.2v5.1h6.6c3.9-3.6 6.1-8.8 6.1-15Z" />
      <path fill="#34A853" d="M24 44c5.5 0 10.1-1.8 13.5-4.8l-6.6-5.1c-1.8 1.2-4.1 2-6.9 2-5.3 0-9.8-3.6-11.4-8.4H5.8v5.3A20 20 0 0 0 24 44Z" />
      <path fill="#FBBC05" d="M12.6 27.7a12 12 0 0 1 0-7.4V15H5.8a20 20 0 0 0 0 18l6.8-5.3Z" />
      <path fill="#EA4335" d="M24 11.9c3 0 5.7 1 7.8 3.1l5.9-5.9A19.7 19.7 0 0 0 24 4 20 20 0 0 0 5.8 15l6.8 5.3c1.6-4.8 6.1-8.4 11.4-8.4Z" />
    </svg>
  )
}

function AuthModal({ onClose, initialMode }: { onClose: () => void; initialMode: 'signin' | 'signup' }) {
  const [authMode, setAuthMode] = useState<'signin' | 'signup'>(initialMode)
  const [googleLoading, setGoogleLoading] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')

  useEffect(() => {
    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape' && !googleLoading) onClose()
    }
    window.addEventListener('keydown', handleEscape)
    return () => window.removeEventListener('keydown', handleEscape)
  }, [onClose, googleLoading])

  async function continueWithGoogle() {
    if (googleLoading) return
    setGoogleLoading(true)
    setErrorMessage('')
    try {
      const redirectTo = process.env.NEXT_PUBLIC_DEV_SUPABASE_REDIRECT_URL ?? `${window.location.origin}/auth/callback`
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo },
      })
      if (error) setErrorMessage('Google sign-in is unavailable right now. Please try again.')
    } catch {
      setErrorMessage('Google sign-in is unavailable right now. Please try again.')
    } finally {
      setGoogleLoading(false)
    }
  }

  return (
    <div className="modal-backdrop auth-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !googleLoading) onClose() }}>
      <section className="auth-modal" role="dialog" aria-modal="true" aria-labelledby="auth-title">
        <button className="modal-close" type="button" onClick={onClose} disabled={googleLoading} aria-label="Close login"><X size={17} /></button>
        <span className="auth-kicker"><span /> TRINELA ACCOUNT</span>
        <div className="mt-6 grid grid-cols-2 gap-1 rounded-sm bg-[#f1f4f8] p-1" role="group" aria-label="Choose sign-in or sign-up">
          <button type="button" className={`min-h-10 rounded-sm px-3 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1765ee] ${authMode === 'signin' ? 'bg-white text-[#263854] shadow-sm' : 'text-[#65748a] hover:text-[#263854]'}`} aria-pressed={authMode === 'signin'} onClick={() => { setAuthMode('signin'); setErrorMessage('') }}>Sign in</button>
          <button type="button" className={`min-h-10 rounded-sm px-3 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1765ee] ${authMode === 'signup' ? 'bg-white text-[#263854] shadow-sm' : 'text-[#65748a] hover:text-[#263854]'}`} aria-pressed={authMode === 'signup'} onClick={() => { setAuthMode('signup'); setErrorMessage('') }}>Sign up</button>
        </div>
        <h2 id="auth-title">{authMode === 'signin' ? 'Welcome back' : 'Create your account'}</h2>
        <p className="auth-description">{authMode === 'signin' ? 'Sign in to track your classes and exclusive offers.' : 'Create an account to book classes and save your favorite schools.'}</p>
        {errorMessage && <p className="auth-error" role="alert">{errorMessage}</p>}
        <Button type="button" variant="default" className="mt-6 h-12 w-full justify-center gap-3 rounded-sm bg-[#263854] text-white hover:bg-[#334a6d]" onClick={() => void continueWithGoogle()} disabled={googleLoading}>
          {googleLoading ? <LoaderCircle className="auth-spinner" size={17} /> : <GoogleMark />}
          {googleLoading ? 'Connecting…' : authMode === 'signin' ? 'Sign in with Google' : 'Sign up with Google'}
        </Button>
        <p className="auth-privacy"><ShieldCheck size={14} /> Your email stays private and protected.</p>
      </section>
    </div>
  )
}

function AccountRouteLinks({ active, onNavigate }: { active: 'My Bookings' | 'Profile'; onNavigate: (view: 'My Bookings' | 'Profile') => void }) {
  return (
    <nav className="account-route-nav" aria-label="Account navigation">
      <button type="button" className={active === 'My Bookings' ? 'is-active' : ''} aria-current={active === 'My Bookings' ? 'page' : undefined} onClick={() => onNavigate('My Bookings')}><CalendarDays size={15} /> My Bookings</button>
      <button type="button" className={active === 'Profile' ? 'is-active' : ''} aria-current={active === 'Profile' ? 'page' : undefined} onClick={() => onNavigate('Profile')}><UserRound size={15} /> Profile</button>
    </nav>
  )
}

function ProfileView({ user, phone, onHome, onLogout, onBookings, savedSchools, onToggleFavorite, onSelectSchool }: { user: User | null; phone: string; onHome: () => void; onLogout: () => void; onBookings: () => void; savedSchools: School[]; onToggleFavorite: (school: School) => void; onSelectSchool: (school: School) => void }) {
  const displayPhone = user?.phone ?? phone

  async function copyReferralCode() {
    try {
      await navigator.clipboard.writeText('FRIENDS50')
      toast.success('Referral code copied')
    } catch {
      toast.error('Could not copy referral code', { description: 'Please try again.' })
    }
  }

  const referralMessage = encodeURIComponent('Join me on Trinela to find a verified driving school and start learning. Use my referral code FRIENDS50!')

  return (
    <section className="account-page" aria-labelledby="account-title">
      <header className="account-topbar">
        <button className="dashboard-home-link" type="button" onClick={onHome}><ArrowLeft size={17} /> Back to Trinela</button>
        <BrandMark />
        <AccountRouteLinks active="Profile" onNavigate={(view) => { if (view === 'My Bookings') onBookings() }} />
      </header>
      <div className="account-content">
        <div className="account-heading"><span className="account-eyebrow"><span /> YOUR TRINELA ACCOUNT</span><h1 id="account-title">My Account</h1><p>Your details and account settings.</p></div>
        <article className="account-profile-card">
          <span className="account-avatar" aria-hidden="true">{(user?.user_metadata?.full_name as string | undefined)?.slice(0, 1).toUpperCase() || 'S'}</span>
          <div className="account-profile-details"><strong>{(user?.user_metadata?.full_name as string | undefined) || 'Student Name'}</strong><span>{displayPhone || 'Phone number not available'}</span><span><MapPin size={14} /> Bengaluru, KA</span></div>
          <BadgeCheck className="account-profile-check" size={20} />
        </article>
        <section className="profile-referral-card" aria-labelledby="profile-referral-title">
          <div className="profile-referral-heading"><span className="profile-referral-icon"><Gift size={20} /></span><div><span className="account-eyebrow">SHARE THE ROAD AHEAD</span><h2 id="profile-referral-title">Refer &amp; Earn</h2><p>Invite friends to Trinela and earn free classes together.</p></div></div>
          <div className="profile-referral-code"><span><small>YOUR REFERRAL CODE</small><strong>FRIENDS50</strong></span><button type="button" onClick={() => void copyReferralCode()} aria-label="Copy referral code FRIENDS50"><Copy size={16} /> Copy</button></div>
          <a className="whatsapp-share-button" href={`https://wa.me/?text=${referralMessage}`} target="_blank" rel="noreferrer"><MessageCircle size={17} /> Share on WhatsApp</a>
        </section>
        <section className="saved-schools-section" aria-labelledby="saved-schools-title">
          <div className="saved-schools-heading"><div><span className="account-eyebrow">YOUR SHORTLIST</span><h2 id="saved-schools-title">Saved Schools</h2></div><span className="saved-school-count">{savedSchools.length}</span></div>
          {savedSchools.length ? <div className="saved-school-list">{savedSchools.map((school) => <article className="saved-school-card" key={school.id}><IndianCarImage src={school.main_image_url === null ? '/trinela-indian-hatchback-illustration.png' : school.main_image_url} alt={`Driving lesson vehicle near ${school.location}`} loading="lazy" /><div className="saved-school-copy"><strong>{school.name}</strong><span><MapPin size={13} /> {school.location}</span><small>{formatPrice(school.trinelaPrice)} · {school.rating !== null && school.rating > 0 ? <><Star size={12} fill="currentColor" /> {school.rating.toFixed(1)}</> : 'No ratings yet'}</small></div><button className="saved-school-open" type="button" onClick={() => onSelectSchool(school)}>View</button><button className="saved-school-remove" type="button" onClick={() => onToggleFavorite(school)} aria-label={`Remove ${school.name} from saved schools`}><Heart size={18} fill="currentColor" /></button></article>)}</div> : <p className="saved-schools-empty">Tap the heart on any driving school to save it here for later.</p>}
        </section>
        <section className="account-settings" aria-labelledby="settings-title">
          <h2 id="settings-title">Account settings</h2>
          <div className="account-setting-row"><span className="account-setting-icon"><CreditCard size={18} /></span><span><strong>Payment Methods</strong><small>Manage your saved payment options</small></span><ArrowRight size={16} /></div>
          <a className="account-setting-row" href="mailto:hello@trinela.in?subject=Help%20and%20support"><span className="account-setting-icon"><Headset size={18} /></span><span><strong>Help &amp; Support</strong><small>We’re here to help with your classes</small></span><ArrowRight size={16} /></a>
          <a className="account-setting-row" href="mailto:hello@trinela.in?subject=Privacy%20policy"><span className="account-setting-icon"><LockKeyhole size={18} /></span><span><strong>Privacy Policy</strong><small>How Trinela handles your information</small></span><ArrowRight size={16} /></a>
        </section>
        <button className="account-logout" type="button" onClick={onLogout}>Log Out</button>
      </div>
    </section>
  )
}

function Hero({ searchQuery, setSearchQuery, schoolNameQuery, onSchoolNameQueryChange, onSchoolNameSearch, onLocationSearch, onLocate, locationLoading }: { searchQuery: string; setSearchQuery: (value: string) => void; schoolNameQuery: string; onSchoolNameQueryChange: (value: string) => void; onSchoolNameSearch: (query: string) => void; onLocationSearch: (location: string, displayValue?: string, coordinates?: SchoolCoordinate) => void; onLocate: () => void; locationLoading: boolean }) {
  // Deploy marker for the hero, Bengaluru styling, school fallback, and search updates.
  const [searchMode, setSearchMode] = useState<'area' | 'school'>('area')
  const [suggestions, setSuggestions] = useState<NominatimPlace[]>([])
  const [suggestionsOpen, setSuggestionsOpen] = useState(false)
  const [activeSuggestionIndex, setActiveSuggestionIndex] = useState(-1)
  const [isLoadingSuggestions, setIsLoadingSuggestions] = useState(false)
  const [isResolvingLocation, setIsResolvingLocation] = useState(false)
  const [hasLoadedSuggestions, setHasLoadedSuggestions] = useState(false)
  const isPostcodeQuery = isIndianPostcode(searchQuery)

  useEffect(() => {
    const query = extractCoreArea(searchQuery)
    if (searchMode !== 'area' || query.length < 2 || isIndianPostcode(searchQuery)) {
      setSuggestions([])
      setIsLoadingSuggestions(false)
      setHasLoadedSuggestions(false)
      return
    }

    const controller = new AbortController()
    setIsLoadingSuggestions(false)
    setHasLoadedSuggestions(false)
    const debounceTimer = window.setTimeout(async () => {
      setIsLoadingSuggestions(true)
      const url = new URL('https://nominatim.openstreetmap.org/search')
      url.searchParams.set('q', `${query}, Bengaluru, India`)
      url.searchParams.set('format', 'jsonv2')
      url.searchParams.set('addressdetails', '1')
      url.searchParams.set('limit', '40')

      try {
        const results = await fetchNominatimJson<NominatimPlace[]>(url, controller.signal)
        if (!controller.signal.aborted) {
          const areaResults = Array.isArray(results) ? results.filter(isAreaPlace) : []
          const uniqueAreas = new Map<string, NominatimPlace>()
          for (const place of areaResults) {
            const key = formatPlaceDisplayLabel(place).toLocaleLowerCase()
            if (key) uniqueAreas.set(key, place)
          }
          setSuggestions([...uniqueAreas.values()].slice(0, 5))
          setHasLoadedSuggestions(true)
        }
      } catch {
        if (!controller.signal.aborted) {
          setSuggestions([])
          setHasLoadedSuggestions(true)
        }
      } finally {
        if (!controller.signal.aborted) setIsLoadingSuggestions(false)
      }
    }, 450)

    return () => {
      window.clearTimeout(debounceTimer)
      controller.abort()
    }
  }, [searchMode, searchQuery])

  function choosePlace(place: NominatimPlace) {
    const areaName = getPlaceAreaName(place)
    const displayValue = formatPlaceDisplayLabel(place)
    onSchoolNameQueryChange('')
    setSearchQuery(displayValue)
    setSuggestions([])
    setSuggestionsOpen(false)
    setActiveSuggestionIndex(-1)
    onLocationSearch(areaName, displayValue, getPlaceCoordinates(place))
  }

  async function submitLocationSearch(value: string) {
    const query = value.trim()
    setSuggestionsOpen(false)
    setActiveSuggestionIndex(-1)

    if (!query) {
      onLocationSearch('', '')
      return
    }

    setIsResolvingLocation(true)
    try {
      const response = await fetch(`/api/geocode?${new URLSearchParams({ query })}`)
      if (!response.ok) throw new Error('Location lookup failed.')
      const { place } = await response.json() as { place: NominatimLocation | null }
      const coordinates = place ? getPlaceCoordinates(place) : undefined
      if (!place || !coordinates) throw new Error('No matching location was found.')

      const areaName = getSchoolSearchArea(place)
      onLocationSearch(areaName, isIndianPostcode(query) ? query : formatPlaceDisplayLabel(place) || query, coordinates)
    } catch {
      toast.info('Showing schools for your search', { description: 'The location could not be pinned precisely.' })
      onLocationSearch(query, query)
    } finally {
      setIsResolvingLocation(false)
    }
  }

  function handleSearchKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return
    if (event.key === 'Escape') {
      setSuggestionsOpen(false)
      setActiveSuggestionIndex(-1)
      return
    }
    if (event.key === 'ArrowDown' && suggestions.length) {
      event.preventDefault()
      setSuggestionsOpen(true)
      setActiveSuggestionIndex((index) => (index + 1) % suggestions.length)
      return
    }
    if (event.key === 'ArrowUp' && suggestions.length) {
      event.preventDefault()
      setSuggestionsOpen(true)
      setActiveSuggestionIndex((index) => index <= 0 ? suggestions.length - 1 : index - 1)
      return
    }
    if (event.key === 'Enter' && activeSuggestionIndex >= 0 && suggestions[activeSuggestionIndex]) {
      event.preventDefault()
      choosePlace(suggestions[activeSuggestionIndex])
    }
  }

  return (
    <section className="hero" id="top">
      <div className="hero-inner">
        <div className="hero-copy">
          <div className="eyebrow"><span className="eyebrow-dot" /> YOUR NEXT MILE STARTS HERE</div>
          <h1>Driving schools in <span>Bengaluru.</span></h1>
          <p className="hero-description">Find your kind of driving school. Learn with confidence, right around the corner.</p>
          <form className="search-bar" role="search" onSubmit={(event) => { event.preventDefault(); if (searchMode === 'school') { setSuggestionsOpen(false); onSchoolNameSearch(schoolNameQuery) } else void submitLocationSearch(searchQuery) }} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setSuggestionsOpen(false) }}>
            <label className="sr-only" htmlFor="search-mode">Search by</label>
            <select id="search-mode" className="search-mode-select" value={searchMode} onChange={(event) => { setSearchMode(event.target.value as 'area' | 'school'); setSuggestionsOpen(false); setActiveSuggestionIndex(-1) }} aria-label="Search by">
              <option value="area">Area</option>
              <option value="school">School name</option>
            </select>
            {searchMode === 'area' ? <MapPin className="search-pin" size={20} /> : <Search className="search-pin" size={20} />}
            <label className="sr-only" htmlFor={searchMode === 'area' ? 'location-search' : 'school-name-search'}>{searchMode === 'area' ? 'Search by Bengaluru location' : 'Search by driving school name'}</label>
            <div className="search-input-wrap">
              <input
                id={searchMode === 'area' ? 'location-search' : 'school-name-search'}
                role={searchMode === 'area' ? 'combobox' : undefined}
                aria-autocomplete={searchMode === 'area' ? isPostcodeQuery ? 'none' : 'list' : undefined}
                aria-expanded={searchMode === 'area' ? !isPostcodeQuery && suggestionsOpen && (suggestions.length > 0 || isLoadingSuggestions || hasLoadedSuggestions) : undefined}
                aria-controls={searchMode === 'area' ? 'location-suggestions' : undefined}
                aria-activedescendant={searchMode === 'area' && activeSuggestionIndex >= 0 ? `location-option-${activeSuggestionIndex}` : undefined}
                autoComplete="off"
                value={searchMode === 'area' ? searchQuery : schoolNameQuery}
                onFocus={() => { if (searchMode === 'area') setSuggestionsOpen(true) }}
                onChange={(event) => { if (searchMode === 'area') { setSearchQuery(event.target.value); setSuggestions([]); setSuggestionsOpen(true); setActiveSuggestionIndex(-1) } else onSchoolNameQueryChange(event.target.value) }}
                onKeyDown={searchMode === 'area' ? handleSearchKeyDown : undefined}
                placeholder={searchMode === 'area' ? 'Search a Bengaluru neighbourhood' : 'Search a driving school by name'}
              />
              {searchMode === 'area' && (isLoadingSuggestions || locationLoading || isResolvingLocation) && <LoaderCircle className="location-search-spinner" size={18} role="status" aria-label="Finding locations" />}
            </div>
            {searchMode === 'area' && <button className="search-locate-button" type="button" onClick={onLocate} disabled={locationLoading} aria-label="Locate me"><Navigation size={15} /><span>{locationLoading ? 'Locating…' : 'Locate me'}</span></button>}
            <button type="submit" aria-label={searchMode === 'area' ? 'Find driving schools by location' : 'Find driving schools by name'}><ArrowRight size={19} /></button>
            {searchMode === 'area' && suggestionsOpen && (suggestions.length > 0 || isLoadingSuggestions || hasLoadedSuggestions) && <div className="location-suggestions" id="location-suggestions" role="listbox" aria-label="Bengaluru locations" aria-busy={isLoadingSuggestions}>
              {suggestions.map((place, index) => <button className={`location-suggestion${index === activeSuggestionIndex ? ' is-active' : ''}`} id={`location-option-${index}`} key={`${place.place_id}-${index}`} type="button" role="option" aria-selected={index === activeSuggestionIndex} onMouseDown={(event) => event.preventDefault()} onClick={() => choosePlace(place)}><MapPin size={16} /><span>{formatPlaceDisplayLabel(place)}</span><ArrowRight size={15} /></button>)}
              {!isLoadingSuggestions && suggestions.length === 0 && <div className="location-suggestion-empty" role="status">No area matches. Try a nearby area name.</div>}
              {!isLoadingSuggestions && <a className="geocoding-attribution" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap contributors</a>}
            </div>}
          </form>
        </div>
      </div>
    </section>
  )
}

function OffersForYou() {
  const [copiedCode, setCopiedCode] = useState<string | null>(null)

  async function copyCouponCode(code: string) {
    try {
      await navigator.clipboard.writeText(code)
      setCopiedCode(code)
      toast.success('Code copied to clipboard', { description: code })
    } catch {
      const fallbackInput = document.createElement('textarea')
      fallbackInput.value = code
      fallbackInput.setAttribute('readonly', '')
      fallbackInput.style.position = 'fixed'
      fallbackInput.style.opacity = '0'
      document.body.appendChild(fallbackInput)
      fallbackInput.select()
      const copied = document.execCommand('copy')
      fallbackInput.remove()
      setCopiedCode(copied ? code : null)
      if (copied) toast.success('Code copied to clipboard', { description: code })
      else toast.error('Could not copy code', { description: 'Please try again.' })
    }
  }

  const offers = [
    { code: 'FIRSTDRIVE', title: 'Flat ₹500 Off', detail: 'your total fee', tone: 'coupon-blue' },
    { code: 'EASYSTART', title: 'Token Discount', detail: 'Lock for just ₹299', tone: 'coupon-mint' },
  ]

  return (
    <section className="offers-section" aria-labelledby="offers-title">
      <div className="offers-heading-row"><div><span className="offers-kicker">A LITTLE SOMETHING FOR YOUR FIRST DRIVE</span><h2 id="offers-title">Offers For You</h2></div><span className="offers-scroll-hint">SWIPE TO EXPLORE <ArrowRight size={13} /></span></div>
      <div className="offers-carousel" aria-label="Available driving lesson offers">
        {offers.map((offer) => (
          <article className={`coupon-card ${offer.tone}`} key={offer.code}>
            <div className="coupon-copy"><span className="coupon-tag">LIMITED OFFER</span><strong>{offer.title}</strong><span className="coupon-detail">{offer.detail}</span><span className="coupon-code"><span>CODE</span> {offer.code}</span></div>
            <span className="coupon-perforation" aria-hidden="true" />
            <button className="coupon-copy-button" onClick={() => void copyCouponCode(offer.code)} aria-label={`${copiedCode === offer.code ? 'Copied' : 'Copy'} coupon code ${offer.code}`} title={copiedCode === offer.code ? 'Copied' : 'Copy code'}><Copy size={15} /><span>{copiedCode === offer.code ? 'Copied' : 'Copy Code'}</span></button>
          </article>
        ))}
      </div>
      <span className="sr-only" aria-live="polite">{copiedCode ? `${copiedCode} copied to clipboard` : ''}</span>
    </section>
  )
}

function ReferralBanner({ onGetCode }: { onGetCode: () => void }) {
  return (
    <section className="referral-banner" aria-label="Refer a friend">
      <span className="referral-banner-icon" aria-hidden="true"><Gift size={21} /></span>
      <div className="referral-banner-copy"><strong>Invite Friends, Earn Free Classes 🎁</strong><span>Share Trinela with a friend and get closer to your next lesson.</span></div>
      <button type="button" onClick={onGetCode}>Get your code <ArrowRight size={15} /></button>
    </section>
  )
}

function SchoolCard({ school, onSelect, isSaved, onToggleFavorite }: { school: School; onSelect: (school: School) => void; isSaved: boolean; onToggleFavorite: (school: School) => void }) {
  return (
    <article className="school-card" style={{ '--card-accent': school.accent, '--card-tint': school.tint } as React.CSSProperties}>
      <div className="school-visual">
        <IndianCarImage className="school-photo" src={school.main_image_url === null ? '/trinela-indian-hatchback-illustration.png' : school.main_image_url} alt={`Driving lesson vehicle near ${school.location}`} loading="lazy" />
        <button className={`favorite-button ${isSaved ? 'is-saved' : ''}`} type="button" aria-label={`${isSaved ? 'Remove' : 'Save'} ${school.name} ${isSaved ? 'from' : 'to'} favorites`} aria-pressed={isSaved} onClick={() => onToggleFavorite(school)}><Heart size={18} fill={isSaved ? 'currentColor' : 'none'} /></button>
        {school.verified && <span className="verified-school-badge"><ShieldCheck size={14} aria-hidden="true" /> Verified School</span>}
        <span className="visual-location"><MapPin size={12} /> {school.location}</span>
      </div>
      <div className="school-card-content">
        <div className="school-card-main">
          <div className="school-title-wrap">
            <div className="school-name-line"><h3>{school.name}</h3>{school.verified && <BadgeCheck className="verified-mark" size={17} fill="currentColor" />}</div>
            <p className="school-area"><MapPin size={13} /> {school.location}</p>
            {school.featuredBadge && <span className="school-featured-badge">{school.featuredBadge}</span>}
          </div>
          <RatingBadge className="rating" rating={school.rating} reviewCount={school.reviewCount} />
        </div>
        {school.cars?.length ? <p className="school-car-list">Cars: {school.cars.join(', ')}</p> : null}
        <div className="school-card-bottom">
          <div className="price-block"><span className="trinela-price">{formatPrice(school.trinelaPrice)}</span><small className="course-caption">full course</small></div>
          <button className="choose-button" onClick={() => onSelect(school)}>View school <ArrowRight size={15} /></button>
        </div>
        <div className="school-card-foot"><span>{school.verified ? <><Check size={13} /> Verified driving school</> : 'Driving school listing'}</span><span>Transparent pricing</span></div>
      </div>
    </article>
  )
}

const fallbackCarImage = '/trinela-indian-hatchback-illustration.png'

function SchoolDetailView({ school, onClose, onSelectSlot, selectedCar, onSelectCar, selectedInstructor, onSelectInstructor }: { school: School; onClose: () => void; onSelectSlot: () => void; selectedCar: string; onSelectCar: (car: string) => void; selectedInstructor: string; onSelectInstructor: (instructor: string) => void }) {
  const [galleryIndex, setGalleryIndex] = useState(0)
  const savings = school.marketPrice !== null ? Math.max(0, school.marketPrice - school.trinelaPrice) : 0
  const gallerySources = [...new Set([school.main_image_url, ...school.galleryImages].filter((src): src is string => Boolean(src)))]
  const schoolGallery = (gallerySources.length ? gallerySources : [fallbackCarImage]).map((src, index) => ({ src, alt: `${school.name} photo ${index + 1}`, label: school.name }))
  const sectionNumber = (() => {
    let count = 0
    return () => String(++count).padStart(2, '0')
  })()

  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
      if (event.key === 'ArrowRight') setGalleryIndex((index) => (index + 1) % schoolGallery.length)
      if (event.key === 'ArrowLeft') setGalleryIndex((index) => (index - 1 + schoolGallery.length) % schoolGallery.length)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [onClose])

  return (
    <div className="school-detail-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section className="school-detail-dialog" role="dialog" aria-modal="true" aria-labelledby="school-detail-title">
        <header className="school-detail-topbar"><a className="detail-back-link" href="#schools" onClick={(event) => { event.preventDefault(); onClose() }}><ArrowLeft size={17} /> Back to schools</a><span className="detail-brand">TRINELA <i /> SCHOOL PROFILE</span><button className="detail-close" onClick={onClose} aria-label="Close school details"><X size={19} /></button></header>
        <div className="school-detail-scroll">
          <div className="detail-gallery-wrap">
            <div className="detail-gallery" aria-roledescription="carousel" aria-label="Driving school gallery">
              <div className="detail-gallery-track" style={{ transform: `translateX(-${galleryIndex * 100}%)` }}>
                {schoolGallery.map((image, index) => <figure className="detail-gallery-slide" key={`${image.src}-${index}`}><IndianCarImage src={image.src} alt={image.alt} /><span className="detail-gallery-promo"><CircleCheck size={14} /> {savings > 0 ? `Save ${formatPrice(savings)} with Trinela` : 'School listed price'}</span><figcaption>{image.label}</figcaption></figure>)}
              </div>
            </div>
            <div className="gallery-controls"><span>{String(galleryIndex + 1).padStart(2, '0')} <i /> {String(schoolGallery.length).padStart(2, '0')}</span><div><button onClick={() => setGalleryIndex((index) => (index - 1 + schoolGallery.length) % schoolGallery.length)} aria-label="Previous gallery image"><ArrowLeft size={16} /></button><button onClick={() => setGalleryIndex((index) => (index + 1) % schoolGallery.length)} aria-label="Next gallery image"><ArrowRight size={16} /></button></div></div>
          </div>
          <div className="detail-content">
            <div className="detail-heading-row"><div><span className="detail-eyebrow">{school.verified ? <><BadgeCheck size={14} /> VERIFIED TRINELA PARTNER</> : 'DRIVING SCHOOL'}</span><h1 id="school-detail-title">{school.name}</h1><p className="detail-location"><MapPin size={15} /> {school.location}</p></div>{school.rating !== null ? <div className="detail-rating"><Star size={15} fill="currentColor" aria-hidden="true" /> <strong>{school.rating.toFixed(1)}</strong><span>{school.reviewCount ? `${school.reviewCount} ${school.reviewCount === 1 ? 'review' : 'reviews'}` : 'learner rating'}</span></div> : <div className="detail-rating no-rating"><span>No ratings yet</span></div>}</div>
            {school.carDetails.length > 0 && <section className="detail-section"><div className="detail-section-heading"><div><span className="detail-eyebrow">{sectionNumber()} / THE FLEET</span><h2>Find your comfort zone.</h2></div><span className="sample-note">Choose a car</span></div><div className="detail-fleet-grid" role="group" aria-label="Choose your training car">{school.carDetails.map((car, index) => <button type="button" className={`detail-fleet-card ${selectedCar === car.name ? 'is-selected' : ''}`} key={`${car.name}-${index}`} aria-pressed={selectedCar === car.name} onClick={() => onSelectCar(car.name)}><span className="fleet-car-photo"><IndianCarImage src={car.image ?? fallbackCarImage} alt={`${car.name} training car`} loading="lazy" /></span><span className="fleet-car-info"><strong>{car.name}</strong>{car.transmission && <small>{car.transmission} transmission</small>}</span><span className="selection-check" aria-hidden="true">{selectedCar === car.name && <CircleCheck size={20} fill="currentColor" />}</span></button>)}</div></section>}
            <section className="syllabus-section detail-packages" aria-labelledby="packages-title">
              <div className="detail-section-heading"><div><span className="detail-eyebrow">{sectionNumber()} / YOUR PLAN</span><h2 id="packages-title">Course packages</h2></div></div>
              {school.packages.length > 0 ? school.packages.map((coursePackage, packageIndex) => (
                <details className="syllabus-accordion" key={`${coursePackage.name}-${packageIndex}`} open={packageIndex === 0}>
                  <summary><span><strong>{coursePackage.name}</strong>{(coursePackage.duration || coursePackage.price !== null) && <small className="package-meta">{[coursePackage.duration, coursePackage.price !== null ? formatPrice(coursePackage.price) : null].filter(Boolean).join(' · ')}</small>}</span><ChevronDown size={18} aria-hidden="true" /></summary>
                  {coursePackage.description && <p className="package-description">{coursePackage.description}</p>}
                  {coursePackage.lessons.length > 0 && <ol className="syllabus-timeline">
                    {coursePackage.lessons.map((lesson, lessonIndex) => <li key={`${lesson.title}-${lessonIndex}`}>{lesson.label && <span className="syllabus-days">{lesson.label}</span>}<span><strong>{lesson.title}</strong>{lesson.detail && <small>{lesson.detail}</small>}</span></li>)}
                  </ol>}
                </details>
              )) : <p className="detail-empty-state">Course packages coming soon.</p>}
            </section>
            <section className="detail-section"><div className="detail-section-heading"><div><span className="detail-eyebrow">{sectionNumber()} / YOUR INSTRUCTORS</span><h2>Patient people. Better first drives.</h2></div>{school.trainerDetails.length > 0 && <span className="sample-note">Choose an instructor</span>}</div>{school.trainerDetails.length > 0 ? <div className="detail-instructor-grid" role="group" aria-label="Choose your instructor">{school.trainerDetails.map((instructor, index) => <button type="button" className={`detail-instructor-card ${selectedInstructor === instructor.name ? 'is-selected' : ''}`} key={`${instructor.name}-${index}`} aria-pressed={selectedInstructor === instructor.name} onClick={() => onSelectInstructor(instructor.name)}><span className="instructor-avatar">{instructor.image && <img src={instructor.image} alt={`Driving instructor ${instructor.name}`} onError={handleInstructorImageError} loading="lazy" />}<span className="instructor-initials" aria-hidden="true">{instructor.name.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase()}</span></span><span className="instructor-info"><strong>{instructor.name}{instructor.gender?.toLowerCase() === 'female' && <span className="female-instructor-badge">Female Instructor</span>}</strong>{(instructor.gender || instructor.rating !== null || instructor.experience) && <small className="instructor-rating">{[instructor.gender, instructor.rating !== null ? `★ ${instructor.rating.toFixed(1)}` : null, instructor.experience].filter(Boolean).join(' · ')}</small>}{instructor.languages.length > 0 && <small className="instructor-languages"><Languages size={13} aria-hidden="true" /> {instructor.languages.join(', ')}</small>}</span><span className="selection-check" aria-hidden="true">{selectedInstructor === instructor.name && <CircleCheck size={20} fill="currentColor" />}</span></button>)}</div> : <p className="detail-empty-state">Instructor details coming soon.</p>}</section>
            {school.features.length > 0 && <section className="detail-badges" aria-label="School features">{school.features.map((feature) => <span key={feature}><ShieldCheck size={17} aria-hidden="true" /> {feature}</span>)}</section>}
          </div>
        </div>
        <div className="detail-bottom-bar"><div><span>FULL COURSE</span><strong>{formatPrice(school.trinelaPrice)}</strong>{(selectedCar || selectedInstructor) && <small className="detail-selection-preview">{[selectedCar, selectedInstructor].filter(Boolean).join(' · ')}</small>}</div><button onClick={onSelectSlot}>Select Time Slot <ArrowRight size={17} /></button></div>
      </section>
    </div>
  )
}

const schoolFilters = ['Manual', 'Automatic', 'Under ₹7,000', '₹7,000–₹8,000', 'Above ₹8,000', '4.5+ Rating', '4.0+ Rating', 'Verified Schools Only'] as const
type SchoolFilter = (typeof schoolFilters)[number]
type SchoolSort = 'Recommended' | 'Price: Low to High' | 'Price: High to Low' | 'Rating: High to Low'

function SchoolList({ onSelect, onClearSearch, onAreasGeocoded, location, searchQuery, schoolNameQuery, schools, allSchools, mapFocus, hasLoadError, activeFilter, onFilter, sortBy, onSort, onRetry, favoriteIds, onToggleFavorite }: { onSelect: (school: School) => void; onClearSearch: () => void; onAreasGeocoded: (coordinates: Record<string, SchoolCoordinate | null>) => void; location: string; searchQuery: string; schoolNameQuery: string; schools: School[]; allSchools: School[]; mapFocus: SchoolMapFocus | null; hasLoadError: boolean; activeFilter: SchoolFilter | null; onFilter: (filter: SchoolFilter) => void; sortBy: SchoolSort; onSort: (sort: SchoolSort) => void; onRetry: () => void; favoriteIds: string[]; onToggleFavorite: (school: School) => void }) {
  const resultLocation = searchQuery.trim() || location.trim()

  return (
    <section className="school-section" id="schools">
      <div className="section-heading">
        <div><div className="eyebrow"><span className="eyebrow-dot" /> HANDPICKED FOR YOU</div><h2>Good schools. Great starts.</h2><p>{schoolNameQuery.trim() ? <>{schools.length}{' '}{schools.length === 1 ? 'school' : 'schools'} matching <strong>{schoolNameQuery}</strong></> : resultLocation ? <>{schools.length}{' '}{schools.length === 1 ? 'school' : 'schools'} near <strong>{resultLocation}</strong></> : <>{schools.length}{' '}{schools.length === 1 ? 'school' : 'schools'} in <strong>Bengaluru</strong></>}</p></div>
        <a className="filter-button" href="#how-it-works"><span className="filter-count">₹499</span> to reserve a slot <ArrowRight size={15} /></a>
      </div>
      <div className="school-controls-row">
        <div className="filter-chips" aria-label="Filter driving schools">
          {schoolFilters.map((filter) => <button key={filter} className={`filter-chip ${activeFilter === filter ? 'is-active' : ''}`} aria-pressed={activeFilter === filter} onClick={() => onFilter(filter)}>{filter === 'Manual' || filter === 'Automatic' ? <CarFront size={14} /> : filter.includes('₹') ? <CircleDollarSign size={14} /> : filter.includes('Rating') ? <Star size={14} /> : <ShieldCheck size={14} />}{filter}</button>)}
        </div>
        <label className="sort-control">Sort by<select value={sortBy} onChange={(event) => onSort(event.target.value as SchoolSort)}><option>Recommended</option><option>Price: Low to High</option><option>Price: High to Low</option><option>Rating: High to Low</option></select></label>
      </div>
      {(activeFilter === 'Manual' || activeFilter === 'Automatic' || activeFilter === 'Verified Schools Only') && <p className="filter-note">Transmission and verification details aren&apos;t included in the connected schools data.</p>}
      <div className="school-discovery-layout">
        <section className="school-map-panel" aria-labelledby="school-map-title">
          <div className="school-map-heading"><div><span className="school-map-eyebrow">EXPLORE BENGALURU</span><h3 id="school-map-title">School locations</h3></div><span className="school-map-count">{allSchools.length} {allSchools.length === 1 ? 'school' : 'schools'}</span></div>
          <SchoolMap schools={allSchools} focus={mapFocus} onAreasGeocoded={onAreasGeocoded} />
          <p className="school-map-legend"><MapPin size={14} aria-hidden="true" /> {mapFocus ? 'Centered on your selected location' : 'Select a neighborhood or PIN code to zoom in'}</p>
        </section>
        <section className="school-results-panel" aria-label="Matching driving schools">
          {schools.length === 0 ? <Empty className="school-empty-state" role="status"><EmptyHeader><EmptyMedia className="school-empty-media" aria-hidden="true"><CarFront size={48} strokeWidth={1.4} /></EmptyMedia><EmptyTitle>{hasLoadError ? 'Schools could not be loaded' : 'No schools match this search'}</EmptyTitle><EmptyDescription>{hasLoadError ? 'Please try again in a moment.' : schoolNameQuery.trim() ? `No driving schools found matching “${schoolNameQuery}”. Try another name or clear the search.` : `There are no schools available for ${searchQuery.trim() || location || 'Bengaluru'} right now.`}</EmptyDescription></EmptyHeader><EmptyContent>{hasLoadError ? <Button type="button" onClick={onRetry} className="empty-clear-search">Try Again</Button> : <Button type="button" onClick={onClearSearch} className="empty-clear-search">Clear Search</Button>}</EmptyContent></Empty> : <div className="school-grid">{schools.map((school) => <SchoolCard key={school.id} school={school} onSelect={onSelect} isSaved={favoriteIds.includes(String(school.id))} onToggleFavorite={onToggleFavorite} />)}</div>}
        </section>
      </div>

      <div className="listing-note"><ShieldCheck size={16} /> School listings are loaded from Trinela&apos;s schools database. Map tiles © OpenStreetMap contributors.</div>
    </section>
  )
}

function TrustSignals() {
  const items = [
    { icon: CarFront, title: 'Dual-control vehicles', detail: 'Learn with a safety-first setup.' },
    { icon: FileCheck2, title: 'RTO-certified instructors', detail: 'Local experts who know the road.' },
    { icon: CircleDollarSign, title: 'Transparent pricing', detail: 'Know the full fee before you book.' },
    { icon: HeartHandshake, title: 'No cancellation headaches', detail: 'Plans change. We make room.' },
  ]
  return <section className="trust-section" id="trust-signals" aria-label="Why learn with Trinela"><div className="trust-grid">{items.map(({ icon: Icon, title, detail }) => <div className="trust-tile" key={title}><span className="trust-icon"><Icon size={20} /></span><span><strong>{title}</strong><small>{detail}</small></span></div>)}</div></section>
}

function HowItWorks() {
  const steps = [
    { number: '01', title: 'Find your next school', detail: 'Compare local driving schools, ratings and course prices in one place.' },
    { number: '02', title: 'Lock your lesson slot', detail: 'Choose a time and place a ₹499 token to reserve your first lesson.' },
    { number: '03', title: 'Learn, then pay the rest', detail: 'Your token goes toward the course. Pay the remaining balance at school.' },
  ]
  return <section className="how-section" id="how-it-works"><div className="section-eyebrow">A CLEAR ROAD AHEAD</div><h2>Three steps. Then you&apos;re driving.</h2><p className="section-intro">Getting started should feel as easy as the first turn.</p><div className="how-grid">{steps.map((step) => <article className="how-card" key={step.number}><span className="how-number">{step.number}</span><div className="how-line" /><h3>{step.title}</h3><p>{step.detail}</p></article>)}</div></section>
}

function FaqSection() {
  const questions = [
    { question: 'What is the ₹499 token for?', answer: 'It reserves your seat and first lesson time. The token is deducted from your total course package.' },
    { question: 'Do I need a learner’s licence before I start?', answer: 'No. Our partner schools can guide you through the RTO paperwork for your learner��s and driving licences.' },
    { question: 'When do I pay the remaining course fee?', answer: 'You pay the remaining balance directly to your chosen driving school on your first day.' },
    { question: 'How do I choose the right driving school?', answer: 'Compare local schools by location, ratings and course price, then pick the one that fits you.' },
  ]
  return <section className="faq-section" id="faq"><div className="faq-intro"><div className="section-eyebrow">GOOD TO KNOW</div><h2>A few things you might be wondering.</h2><p>We&apos;re here to make your first drive feel simple.</p></div><div className="faq-list">{questions.map((item) => <details className="faq-item" key={item.question}><summary>{item.question}<ChevronDown size={18} /></summary><p>{item.answer}</p></details>)}</div></section>
}

function SlotPicker({
  school,
  dates,
  selectedDate,
  selectedTime,
  selectedPackageIndex,
  onDate,
  onTime,
  onPackage,
  onBack,
  onContinue,
}: {
  school: School
  dates: Date[]
  selectedDate: number
  selectedTime: string
  selectedPackageIndex: number | null
  onDate: (index: number) => void
  onTime: (time: string) => void
  onPackage: (index: number) => void
  onBack: () => void
  onContinue: () => void
}) {
  const hasPackages = school.packages.length > 0
  const selectedPackage = selectedPackageIndex !== null ? school.packages[selectedPackageIndex] ?? null : null
  const sessionMinutes = selectedPackage?.minsPerDay ?? DEFAULT_SESSION_MINUTES
  const slots = buildTimeSlots(sessionMinutes)
  const packageReady = !hasPackages || selectedPackage !== null
  const canContinue = packageReady && Boolean(selectedTime) && isWithinOperatingHours(selectedTime, sessionMinutes)
  const periods: TimeSlot['period'][] = ['Morning', 'Afternoon', 'Evening']

  return (
    <section className="booking-section" id="slots">
      <button className="back-link" onClick={onBack}><ArrowLeft size={16} /> Back to schools</button>
      <div className="booking-layout">
        <div className="booking-main">
          <div className="eyebrow"><span className="eyebrow-dot" /> STEP 2 · PICK A COURSE &amp; TIME</div>
          <h2>When works for you?</h2>
          <p className="booking-description">Choose your course format, a start day and the time you want to drive each day.</p>
          <div className="time-heading"><BadgeCheck size={17} /><strong>Course format</strong></div>
          {hasPackages ? (
            <div className="package-options" role="radiogroup" aria-label="Choose a course format">
              {school.packages.map((coursePackage, index) => {
                const isSelected = selectedPackageIndex === index
                return (
                  <button type="button" role="radio" aria-checked={isSelected} key={`${coursePackage.name}-${index}`} className={`package-option ${isSelected ? 'selected' : ''}`} onClick={() => onPackage(index)}>
                    <span className="package-option-text"><strong>{coursePackage.name}</strong>{coursePackage.duration && <small>{coursePackage.duration}</small>}</span>
                    {coursePackage.price !== null && <span className="package-option-price">{formatPrice(coursePackage.price)}</span>}
                    {isSelected && <Check size={14} aria-hidden="true" />}
                  </button>
                )
              })}
            </div>
          ) : <p className="detail-empty-state">Course packages coming soon. Pick a time below to book a standard 1 hr session.</p>}
          <div className="date-heading"><CalendarDays size={17} /> <strong>{dates[selectedDate].toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })}</strong><span>All times in IST</span></div>
          <div className="date-picker" role="group" aria-label="Choose a date">
            {dates.map((date, index) => <button key={date.toISOString()} onClick={() => onDate(index)} className={`date-option ${selectedDate === index ? 'selected' : ''}`} aria-pressed={selectedDate === index}><span>{new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: 'UTC' }).format(date)}</span><strong>{new Intl.DateTimeFormat('en-US', { day: '2-digit', timeZone: 'UTC' }).format(date)}</strong><small>{new Intl.DateTimeFormat('en-US', { month: 'short', timeZone: 'UTC' }).format(date)}</small></button>)}
          </div>
          <div className="time-heading"><Clock3 size={17} /><strong>Daily driving time</strong><span className="time-heading-note">{formatMinutes(sessionMinutes)} sessions · 06:00 AM to 06:00 PM</span></div>
          {!packageReady ? <p className="detail-empty-state">Choose a course format to see available times.</p> : periods.map((period) => {
            const periodSlots = slots.filter((slot) => slot.period === period)
            if (periodSlots.length === 0) return null
            return (
              <div key={period}>
                <div className="time-group-label">{period.toUpperCase()}</div>
                <div className="time-grid" role="group" aria-label={`${period} time slots`}>{periodSlots.map((slot) => <button type="button" className={`time-option ${selectedTime === slot.label ? 'selected' : ''}`} key={slot.label} onClick={() => onTime(slot.label)} aria-pressed={selectedTime === slot.label}><span>{slot.label}</span><small>Available</small>{selectedTime === slot.label && <Check size={14} />}</button>)}</div>
              </div>
            )
          })}
        </div>
        <aside className="booking-aside">
          <div className="aside-label">YOUR SCHOOL</div>
          <div className="aside-school"><span className="school-avatar small" style={{ backgroundColor: school.tint, color: school.accent }}>{school.initials}</span><span><strong>{school.name}</strong><small>{school.location}</small></span></div>
          <div className="aside-divider" />
          <div className="aside-points">
            <span><Check size={14} /> {selectedPackage ? `${selectedPackage.name}${selectedPackage.duration ? ` (${selectedPackage.duration})` : ''}` : hasPackages ? 'Choose a course format' : 'Standard 1 hr session'}</span>
            <span><Check size={14} /> {selectedTime ? `Daily at ${selectedTime}` : 'Choose a daily time'}</span>
            <span><Check size={14} /> Lessons between 06:00 AM and 06:00 PM</span>
          </div>
          <button className="continue-button" onClick={onContinue} disabled={!canContinue}>Continue <ArrowRight size={17} /></button>
          <p className="aside-secure"><ShieldCheck size={14} /> No payment until you confirm</p>
        </aside>
      </div>
    </section>
  )
}

function CheckoutModal({
  school,
  dates,
  selectedDate,
  selectedTime,
  selectedCar,
  selectedInstructor,
  selectedPackage,
  onClose,
  onConfirm,
  studentName,
  setStudentName,
  studentPhone,
  setStudentPhone,
  submitting,
  submitError,
}: {
  school: School
  dates: Date[]
  selectedDate: number
  selectedTime: string
  selectedCar: string
  selectedInstructor: string
  selectedPackage: SchoolPackage | null
  onClose: () => void
  onConfirm: (selection: { selectedCar: string; selectedInstructor: string }) => void
  studentName: string
  setStudentName: (value: string) => void
  studentPhone: string
  setStudentPhone: (value: string) => void
  submitting: boolean
  submitError: string
}) {
  const [couponInput, setCouponInput] = useState('')
  const [appliedCoupon, setAppliedCoupon] = useState<string | null>(null)
  const [couponMessage, setCouponMessage] = useState('')
  const [couponError, setCouponError] = useState(false)
  const tokenAmount = appliedCoupon === 'EASYSTART' ? 299 : 499
  const schoolDiscount = appliedCoupon === 'FIRSTDRIVE' ? 500 : 0
  const balanceDue = Math.max(0, school.trinelaPrice - tokenAmount - schoolDiscount)

  function applyCoupon() {
    const code = couponInput.trim().toUpperCase()
    if (code === 'FIRSTDRIVE' || code === 'EASYSTART') {
      setAppliedCoupon(code)
      setCouponError(false)
      setCouponMessage(code === 'FIRSTDRIVE' ? '🎉 Code applied! ₹500 will be deducted from your school balance.' : '🎉 Token discount applied. Lock your slot for just ₹299.')
      return
    }
    setAppliedCoupon(null)
    setCouponError(true)
    setCouponMessage('That code isn’t active. Try FIRSTDRIVE or EASYSTART.')
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section className="checkout-modal" role="dialog" aria-modal="true" aria-labelledby="checkout-title">
        <button className="modal-close" onClick={onClose} aria-label="Close checkout"><X size={19} /></button>
        <>
          <div className="checkout-kicker"><span className="checkout-step">03</span> ONE LAST THING</div>
          <h2 id="checkout-title">You&apos;re nearly on the road.</h2>
          <p className="checkout-subtitle">Lock this lesson slot now. Pay the rest directly to your school.</p>
          <div className="checkout-school"><span className="school-avatar small" style={{ backgroundColor: school.tint, color: school.accent }}>{school.initials}</span><span><strong>{school.name}</strong><small><MapPin size={13} /> {school.location}</small></span>{school.verified && <BadgeCheck className="verified-mark" size={18} fill="currentColor" />}</div>
          <div className="checkout-breakdown">{selectedCar && <div className="checkout-row selection-summary-row"><span>Car</span><strong>{selectedCar}</strong></div>}{selectedInstructor && <div className="checkout-row selection-summary-row"><span>Instructor</span><strong>{selectedInstructor}</strong></div>}{selectedPackage && <div className="checkout-row selection-summary-row"><span>Course</span><strong>{selectedPackage.name}{selectedPackage.duration ? ` · ${selectedPackage.duration}` : ''}</strong></div>}<div className="checkout-row"><span>Starts</span><strong>{formatBookingDate(dates[selectedDate])}</strong></div><div className="checkout-row"><span>Daily time</span><strong>{selectedTime}</strong></div><div className="checkout-row muted-row"><span>Trinela course price</span><strong>{formatPrice(school.trinelaPrice)}</strong></div>{school.marketPrice !== null && <div className="checkout-row muted-row"><span>Full course (market price)</span><span className="struck">{formatPrice(school.marketPrice)}</span></div>}<div className="checkout-rule" /><div className="checkout-row due-row"><span>Token due now</span><strong>{formatPrice(tokenAmount)}</strong></div><div className="checkout-row balance-due-row"><span>Balance payable at school on Day 1</span><strong>{formatPrice(balanceDue)}</strong></div><p className="remaining-note">{schoolDiscount > 0 ? 'Your FIRSTDRIVE discount is included in the balance.' : 'Your token is deducted from the course price.'}</p></div>
          <div className="token-banner"><div className="token-check"><Check size={15} /></div><p><strong>Just {formatPrice(tokenAmount)} today.</strong> Fully adjustable against your course fee.</p></div>
          <form className="checkout-form" onSubmit={(event) => { event.preventDefault(); onConfirm({ selectedCar, selectedInstructor }) }}>
            <label className="checkout-field"><span>Full Name</span><input value={studentName} onChange={(event) => setStudentName(event.target.value)} autoComplete="name" placeholder="Enter your full name" required minLength={2} /></label>
            <label className="checkout-field"><span>WhatsApp Number</span><div className="phone-input-wrap"><span className="phone-country-code" aria-hidden="true">+91</span><input aria-label="WhatsApp mobile number" value={studentPhone} onChange={(event) => setStudentPhone(event.target.value.replace(/\D/g, '').slice(0, 10))} type="tel" inputMode="numeric" autoComplete="tel-national" placeholder="9876543210" pattern="[0-9]{10}" required minLength={10} maxLength={10} aria-invalid={studentPhone.length > 0 && !/^\d{10}$/.test(studentPhone)} title="Enter your 10-digit Indian mobile number" /></div></label>
            <section className="offers-benefits" aria-labelledby="offers-benefits-title">
              <div className="offers-benefits-heading"><span className="benefits-icon"><Copy size={14} /></span><div><strong id="offers-benefits-title">Offers &amp; Benefits</strong><small>Have a coupon? Apply it here.</small></div></div>
              <div className="coupon-entry-row"><input aria-label="Enter coupon code" autoComplete="off" placeholder="Enter coupon code" value={couponInput} onChange={(event) => { setCouponInput(event.target.value); setAppliedCoupon(null); setCouponMessage(''); setCouponError(false) }} onKeyDown={(event) => { if (event.key === 'Enter' && !event.nativeEvent.isComposing && event.keyCode !== 229) { event.preventDefault(); applyCoupon() } }} /><button type="button" onClick={applyCoupon}>Apply</button></div>
              {couponMessage && <p className={`coupon-feedback ${couponError ? 'coupon-feedback-error' : ''}`} role={couponError ? 'alert' : 'status'}>{couponMessage}</p>}
            </section>
            {submitError && <p className="booking-error" role="alert">{submitError}</p>}
            <button className="pay-button" type="submit" disabled={submitting || studentName.trim().length < 2 || !/^\d{10}$/.test(studentPhone)}><span>{submitting ? 'Saving your booking…' : appliedCoupon === 'EASYSTART' ? 'Pay ₹299 via UPI to Confirm' : 'Pay ₹499 via UPI to Confirm'}</span><ArrowRight size={19} /></button>
          </form>
          <div className="upi-row"><span>UPI</span><b>GPay</b><b>PhonePe</b><b>paytm</b><span className="secure-copy"><ShieldCheck size={13} /> Secure payment</span></div>
          <p className="checkout-terms">By continuing, you agree to Trinela&apos;s <a href="#terms">booking terms</a>.</p>
        </>
      </section>
    </div>
  )
}

function BookingSuccessView({ school, onDashboard }: { school: School; onDashboard: () => void }) {
  return (
    <section className="booking-success-screen" aria-labelledby="booking-success-title">
      <div className="success-topbar"><button className="success-brand" onClick={onDashboard} aria-label="Go to my bookings"><span className="success-brand-mark">t</span> trinela</button><span className="success-top-label">BOOKING REQUEST</span></div>
      <div className="success-content">
        <div className="success-checkmark" aria-hidden="true"><CircleCheck size={88} strokeWidth={1.8} /></div>
        <span className="success-eyebrow"><span /> YOUR NEXT MILE STARTS HERE</span>
        <h1 id="booking-success-title">Request Saved! 🎉</h1>
        <p className="success-school-name">{school.name} · {school.location}</p>
        <p className="success-description">Your booking request is saved. The ₹499 token is still pending, and WhatsApp notifications aren&apos;t connected yet. Your school will need to confirm your slot and instructor details.</p>
        <button className="success-dashboard-button" onClick={onDashboard}>Go to My Dashboard <ArrowRight size={18} /></button>
        <span className="success-reference-note">We&apos;ll show your class updates here as they become available.</span>
      </div>
      <div className="success-footer-note"><ShieldCheck size={15} /> Your booking request is securely saved with Trinela.</div>
    </section>
  )
}

function MyBookingsDashboard({ booking, fallbackSchool, fallbackDate, onHome, onProfile }: { booking: ActiveBooking | null; fallbackSchool?: School; fallbackDate: Date; onHome: () => void; onProfile: () => void }) {
  const school = booking?.school ?? fallbackSchool
  const slot = booking?.timeLabel ?? '06:00 AM - 07:00 AM'
  const dateLabel = booking?.dateLabel ?? formatBookingDate(fallbackDate)
  const balance = booking?.balanceDue ?? 7000
  const directionsHref = school ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(school.location)}` : 'https://www.google.com/maps/search/?api=1&query=Bengaluru+driving+school'
  const whatsappMessage = encodeURIComponent(`Hi, I have a driving class booking${school ? ` with ${school.name}` : ''}. Could you help me connect with my instructor?`)

  return (
    <section className="dashboard-page" id="bookings" aria-labelledby="dashboard-title">
      <header className="dashboard-topbar"><button className="dashboard-home-link" onClick={onHome}><ArrowLeft size={17} /> Back to Trinela</button><span className="dashboard-brand">TRINELA <i /> MY LEARNING</span><AccountRouteLinks active="My Bookings" onNavigate={(view) => { if (view === 'Profile') onProfile() }} /></header>
      <div className="dashboard-content">
        <div className="dashboard-heading"><span className="dashboard-kicker"><span /> YOUR ROAD AHEAD</span><h1 id="dashboard-title">My Active Classes</h1><p>Everything you need for a confident first drive.</p></div>
        <article className="active-class-card">
          <div className="active-class-card-header"><span className="active-class-label">{booking ? 'YOUR BOOKING' : 'SAMPLE BOOKING'}</span><span className={`booking-status ${booking ? 'booking-status-pending' : 'booking-status-sample'}`}><i /> {booking ? 'Awaiting school confirmation' : 'Preview'}</span></div>
          {!booking && <p className="dashboard-sample-note">Example dashboard preview — booking details appear here after you submit a request.</p>}
          <div className="dashboard-school-row"><span className="dashboard-school-avatar" style={{ backgroundColor: school?.tint ?? '#e8f1ff', color: school?.accent ?? '#1765ee' }}><CarFront size={25} /></span><div className="dashboard-school-copy"><strong>{school?.name ?? 'Your driving school'}</strong><span><MapPin size={13} /> {school?.location ?? 'Bengaluru'}</span></div><BadgeCheck size={19} className="dashboard-verified-icon" /></div>
          <div className="dashboard-booking-facts"><div className="balance-fact"><span>COURSE BALANCE</span><strong>{formatPrice(balance)} <small>due at school</small></strong></div><div className="class-time-fact"><span><CalendarDays size={14} /> {dateLabel}</span><strong><Clock3 size={15} /> {slot}</strong></div></div>
          <div className="progress-timeline" aria-label="Class progress">
            <div className="timeline-item is-complete"><span className="timeline-marker"><Check size={13} /></span><div><strong>Booking request saved</strong><small>Details submitted to {school?.name ?? 'your school'}</small></div></div>
            <div className="timeline-item is-pending"><span className="timeline-marker" /><div><strong>Instructor assigned</strong><small>Pending school confirmation</small></div></div>
            <div className="timeline-item is-pending"><span className="timeline-marker" /><div><strong>Day 1: Steering &amp; Controls</strong><small>Your first lesson</small></div></div>
            <div className="timeline-item is-pending"><span className="timeline-marker" /><div><strong>Day 15: RTO Driving Test</strong><small>Your final milestone</small></div></div>
          </div>
          <div className="dashboard-actions"><a href={directionsHref} target="_blank" rel="noreferrer"><Navigation size={16} /> Get Directions</a><a href={`https://wa.me/?text=${whatsappMessage}`} target="_blank" rel="noreferrer"><MessageCircle size={16} /> WhatsApp Instructor</a></div>
          <a className="sos-emergency-link" href="tel:112"><span aria-hidden="true">SOS</span> / Emergency Help <ArrowRight size={14} /></a>
        </article>
        <p className="dashboard-footnote"><ShieldCheck size={15} /> Your Trinela booking updates will appear here.</p>
      </div>
    </section>
  )
}

function PartnerWithUsView({ onBack }: { onBack: () => void }) {
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)

  function handleApplicationSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting) return
    setSubmitting(true)
    window.setTimeout(() => {
      setSubmitting(false)
      setSubmitted(true)
    }, 1000)
  }

  return (
    <section className="partner-view" aria-labelledby="partner-view-title">
      <div className="partner-view-inner">
        <header className="partner-view-header">
          <button className="partner-back-button" type="button" onClick={onBack}><ArrowLeft size={16} /> Back to Home</button>
          <span className="partner-wordmark">TRINELA <i /> PARTNER NETWORK</span>
        </header>

        <section className="partner-hero">
          <div className="partner-hero-copy">
            <span className="partner-eyebrow"><span /> FOR BENGALURU DRIVING SCHOOLS</span>
            <h1 id="partner-view-title">Grow your driving school with Trinela.</h1>
            <p>Get guaranteed students, fill your empty afternoon slots, and let us handle the marketing. Zero upfront fees.</p>
            <a className="partner-hero-cta" href="#partner-application">Apply to become a Partner <ArrowRight size={16} /></a>
            <span className="partner-hero-note"><ShieldCheck size={15} /> No joining fee. No marketing spend.</span>
          </div>
          <div className="partner-hero-image-wrap">
            <img src="https://images.unsplash.com/photo-1521791136064-7986c2920216?auto=format&fit=crop&w=1400&q=85" alt="Two business partners building a relationship with a handshake" />
            <span className="partner-image-caption">A BETTER WAY TO GROW, TOGETHER</span>
          </div>
        </section>

        <section className="partner-benefits" aria-label="Benefits of partnering with Trinela">
          <article className="partner-benefit-card">
            <span className="partner-benefit-icon"><TrendingUp size={20} /></span>
            <h2>More Revenue</h2>
            <p>We fill your idle batches so your cars are always earning.</p>
          </article>
          <article className="partner-benefit-card">
            <span className="partner-benefit-icon"><Smartphone size={20} /></span>
            <h2>Zero Marketing Hassle</h2>
            <p>Stop paying for expensive JustDial or Google Ads. We bring the students to you.</p>
          </article>
          <article className="partner-benefit-card">
            <span className="partner-benefit-icon"><ShieldCheck size={20} /></span>
            <h2>Verified School Status</h2>
            <p>Get the Trinela Verified badge and build instant trust with Bengaluru learners.</p>
          </article>
        </section>

        <section className="partner-application-section" id="partner-application" aria-labelledby="partner-application-title">
          {submitted ? (
            <div className="partner-success" role="status" aria-live="polite">
              <span className="partner-success-icon"><Check size={24} /></span>
              <p className="partner-form-eyebrow">THANK YOU FOR APPLYING</p>
              <h2 id="partner-application-title">Application Received!</h2>
              <p>Our Bengaluru onboarding team will WhatsApp you within 24 hours.</p>
            </div>
          ) : (
            <div className="partner-application-card">
              <div className="partner-form-heading">
                <span className="partner-form-eyebrow">LET&apos;S GET STARTED</span>
                <h2 id="partner-application-title">Apply to become a Partner</h2>
                <p>Tell us a little about your driving school.</p>
              </div>
              <form className="partner-application-form" onSubmit={handleApplicationSubmit}>
                <label className="partner-field">
                  <span>Driving School Name</span>
                  <input name="schoolName" type="text" placeholder="e.g. City Drive Academy" autoComplete="organization" required />
                </label>
                <label className="partner-field">
                  <span>Owner&apos;s Full Name</span>
                  <input name="ownerName" type="text" placeholder="Your full name" autoComplete="name" required />
                </label>
                <label className="partner-field">
                  <span>WhatsApp Number</span>
                  <span className="partner-phone-input"><span aria-hidden="true">+91</span><input name="whatsapp" type="tel" inputMode="numeric" autoComplete="tel-national" pattern="[0-9]{10}" maxLength={10} placeholder="10-digit mobile number" aria-label="WhatsApp number, 10 digits" required /></span>
                </label>
                <label className="partner-field">
                  <span>Pincode / Area in Bengaluru</span>
                  <input name="area" type="text" placeholder="e.g. 560038 or Indiranagar" autoComplete="postal-code" required />
                </label>
                <label className="partner-field partner-field-full">
                  <span>Number of Cars in Fleet</span>
                  <select name="fleetSize" defaultValue="" required>
                    <option value="" disabled>Select your fleet size</option>
                    <option value="1-2">1-2 cars</option>
                    <option value="3-5">3-5 cars</option>
                    <option value="5+">5+ cars</option>
                  </select>
                </label>
                <button className="partner-submit-button" type="submit" disabled={submitting}>
                  {submitting ? <><LoaderCircle className="partner-submit-spinner" size={17} /> Submitting…</> : <>Submit Application <ArrowRight size={16} /></>}
                </button>
                <p className="partner-form-privacy"><ShieldCheck size={14} /> Your details are only used to contact you about partnering with Trinela.</p>
              </form>
            </div>
          )}
        </section>

        <footer className="partner-view-footer"><BrandMark /><span>Built for Bengaluru&apos;s next generation of drivers.</span></footer>
      </div>
    </section>
  )
}

function Footer({ onPartnerClick }: { onPartnerClick: () => void }) {
  return (
    <footer className="site-footer" id="profile">
      <div className="footer-main"><div className="footer-brand-column"><a className="brand" href="#top" aria-label="Trinela home">trinela</a><p>More confidence behind the wheel starts with the right local school.</p><span className="footer-city"><MapPin size={15} /> Bengaluru, Karnataka 560086</span></div>
        <div className="footer-column"><h3>Company</h3><a href="#how-it-works">How it works</a><a href="#schools">Find a school</a><a href="#partner" onClick={(event) => { event.preventDefault(); onPartnerClick() }}>Partner with us</a></div>
        <div className="footer-column"><h3>Legal</h3><a href="#privacy">Privacy</a><a href="#terms">Terms of service</a><a href="#faq">FAQs</a></div>
        <div className="footer-partner" id="partner"><span className="partner-kicker">GROW WITH US</span><h3>Teach the next generation.</h3><p>Bring your school to Bengaluru&apos;s learners.</p><a href="#partner" onClick={(event) => { event.preventDefault(); onPartnerClick() }}>Become a partner <ArrowRight size={15} /></a></div>
      </div>
      <div className="footer-bottom"><span>© 2026 Trinela Technologies. Made for Bengaluru.</span><span><a id="privacy" href="mailto:hello@trinela.in?subject=Privacy%20policy">Privacy</a><a id="terms" href="mailto:hello@trinela.in?subject=Terms%20of%20service">Terms</a></span></div>
    </footer>
  )
}

function InstallBanner({ onInstall, onDismiss }: { onInstall: () => void; onDismiss: () => void }) {
  return (
    <aside className="install-banner" aria-label="Install Trinela">
      <span className="install-banner-icon" aria-hidden="true"><Smartphone size={17} /></span>
      <p>Get the full Trinela experience. <strong>Add to Home Screen.</strong></p>
      <button type="button" className="install-banner-action" onClick={onInstall}>Install</button>
      <button type="button" className="install-banner-dismiss" onClick={onDismiss} aria-label="Dismiss install banner"><X size={16} /></button>
    </aside>
  )
}

function SupportWidget() {
  const [isOpen, setIsOpen] = useState(false)

  useEffect(() => {
    if (!isOpen) return
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') setIsOpen(false)
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [isOpen])

  return (
    <>
      <button className="support-fab" type="button" aria-label="Open Help & Support" aria-expanded={isOpen} onClick={() => setIsOpen(true)}><MessageCircle size={23} /></button>
      {isOpen && <div className="support-sheet-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setIsOpen(false) }}>
        <section className="support-sheet" role="dialog" aria-modal="true" aria-labelledby="support-title">
          <div className="support-sheet-grab" aria-hidden="true" />
          <header className="support-sheet-header"><span className="support-sheet-icon"><Headset size={21} /></span><div><span>TRINELA CARE</span><h2 id="support-title">Help &amp; Support</h2></div><button type="button" onClick={() => setIsOpen(false)} aria-label="Close Help & Support"><X size={18} /></button></header>
          <p>We&apos;re here to help with your booking, instructor, or first lesson.</p>
          <a className="support-contact-row" href="mailto:hello@trinela.in?subject=Help%20and%20support"><span className="support-contact-icon"><MessageCircle size={18} /></span><span><strong>Email Trinela Support</strong><small>hello@trinela.in</small></span><ArrowRight size={16} /></a>
          <a className="support-emergency-row" href="tel:112"><span><strong>Emergency?</strong><small>Call India emergency services</small></span><span>Call 112</span></a>
          <small className="support-sheet-footnote">For urgent road safety concerns, call 112 directly.</small>
        </section>
      </div>}
    </>
  )
}

export default function Page() {
  // Keep this marker source-only; production render behavior is unchanged.
  // Paste the live production webhook URL here.
  const N8N_WEBHOOK_URL = 'YOUR_WEBHOOK_URL_HERE'

  const [location, setLocation] = useState('')
  const [locating, setLocating] = useState(false)
  const [schoolSearchLocation, setSchoolSearchLocation] = useState('')
  const [mapFocus, setMapFocus] = useState<SchoolMapFocus | null>(null)
  const [mapAreaCoordinates, setMapAreaCoordinates] = useState<Record<string, SchoolCoordinate | null>>({})
  const mapFocusSequence = useRef(0)
  const [searchQuery, setSearchQuery] = useState('')
  const [schoolNameQuery, setSchoolNameQuery] = useState('')
  const [authInitialMode, setAuthInitialMode] = useState<'signin' | 'signup'>('signin')
  const [activeFilter, setActiveFilter] = useState<SchoolFilter | null>(null)
  const [sortBy, setSortBy] = useState<SchoolSort>('Recommended')
  const [activeNav, setActiveNav] = useState('Home')
  const [isLoggedIn, setIsLoggedIn] = useState(false)
  const [authUser, setAuthUser] = useState<User | null>(null)
  const [authenticatedPhone, setAuthenticatedPhone] = useState('')
  const [authModalOpen, setAuthModalOpen] = useState(false)
  const [partnerViewOpen, setPartnerViewOpen] = useState(false)
  const [selectedSchool, setSelectedSchool] = useState<School | null>(null)
  const [selectedCar, setSelectedCar] = useState('')
  const [selectedInstructor, setSelectedInstructor] = useState('')
  const [favoriteSchoolIds, setFavoriteSchoolIds] = useState<string[]>([])
  const [installBannerVisible, setInstallBannerVisible] = useState(true)
  const [installPromptEvent, setInstallPromptEvent] = useState<InstallPromptEvent | null>(null)

  useEffect(() => {
    function captureInstallPrompt(event: Event) {
      event.preventDefault()
      setInstallPromptEvent(event as InstallPromptEvent)
    }
    function handleAppInstalled() {
      setInstallBannerVisible(false)
      setInstallPromptEvent(null)
    }
    window.addEventListener('beforeinstallprompt', captureInstallPrompt)
    window.addEventListener('appinstalled', handleAppInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', captureInstallPrompt)
      window.removeEventListener('appinstalled', handleAppInstalled)
    }
  }, [])

  useEffect(() => {
    let isMounted = true
    void supabase.auth.getSession().then(({ data }) => {
      if (!isMounted) return
      setAuthUser(data.session?.user ?? null)
      setAuthenticatedPhone(data.session?.user.phone ?? data.session?.user.email ?? '')
      setIsLoggedIn(Boolean(data.session))
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      setAuthUser(session?.user ?? null)
      setAuthenticatedPhone(session?.user.phone ?? session?.user.email ?? '')
      setIsLoggedIn(Boolean(session))
      if (event === 'SIGNED_IN') {
        setAuthModalOpen(false)
        setActiveNav('My Bookings')
      }
      if (!session) setActiveNav('Home')
    })
    return () => {
      isMounted = false
      subscription.unsubscribe()
    }
  }, [])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const authResult = params.get('auth')
    const authError = params.get('authError')

    if (authResult === 'success') setActiveNav('My Bookings')
    if (authError === 'oauth') {
      setAuthModalOpen(true)
      toast.error('Google sign-in could not be completed', { description: 'Please try again.' })
    }

    if (authResult || authError) {
      window.history.replaceState({}, '', `${window.location.pathname}${window.location.hash}`)
    }
  }, [])

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' })
  }, [partnerViewOpen])
  const [schoolDetailOpen, setSchoolDetailOpen] = useState(false)
  const [slotPickerOpen, setSlotPickerOpen] = useState(false)
  const [dates] = useState<Date[]>(getNextSevenDates)
  const [selectedDate, setSelectedDate] = useState(0)
  const [selectedTime, setSelectedTime] = useState('')
  const [selectedPackageIndex, setSelectedPackageIndex] = useState<number | null>(null)
  const [checkoutOpen, setCheckoutOpen] = useState(false)
  const [bookingConfirmed, setBookingConfirmed] = useState(false)
  const [activeBooking, setActiveBooking] = useState<ActiveBooking | null>(null)
  const [studentName, setStudentName] = useState('')
  const [studentPhone, setStudentPhone] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [bookingError, setBookingError] = useState('')
  const { data: schools = [], error: schoolsError, mutate } = useSWR<School[], Error>('trinela-schools', fetchSchools, { revalidateOnFocus: false })

  async function submitBooking({ selectedCar, selectedInstructor }: { selectedCar: string; selectedInstructor: string }) {
    if (!selectedSchool || submitting) return

    const name = studentName.trim()
    const phoneDigits = studentPhone.trim().replace(/\D/g, '').slice(0, 10)
    const phone = phoneDigits

    if (name.length < 2) {
      setBookingError('Please enter your full name.')
      return
    }
    if (!/^\d{10}$/.test(phoneDigits)) {
      setBookingError('Please enter a valid 10-digit Indian WhatsApp number.')
      return
    }
    const chosenPackage = selectedPackageIndex !== null ? selectedSchool.packages[selectedPackageIndex] ?? null : null
    if (selectedSchool.packages.length > 0 && !chosenPackage) {
      setBookingError('Please choose a course format.')
      return
    }
    if (!selectedTime || !isWithinOperatingHours(selectedTime, chosenPackage?.minsPerDay ?? DEFAULT_SESSION_MINUTES)) {
      setBookingError('Please choose a time between 06:00 AM and 06:00 PM.')
      return
    }

    const slotSelected = formatBookingSlot(dates[selectedDate], selectedTime)
    const packageSummary = chosenPackage ? `${chosenPackage.name}${chosenPackage.duration ? ` (${chosenPackage.duration})` : ''}` : ''
    setSubmitting(true)
    setBookingError('')
    try {
      const { error } = await supabase.from('bookings').insert({
        school_id: selectedSchool.id,
        student_name: name,
        student_phone: phone,
        slot_selected: slotSelected,
        token_paid: false,
        balance_amount: 7000,
        status: 'Pending',
      })
      if (error) throw error

      void (async () => {
        try {
          const response = await fetch(N8N_WEBHOOK_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              student_name: name,
              student_phone: phone,
              school_name: selectedSchool.name,
              slot_selected: slotSelected,
              selected_car: selectedCar,
              selected_instructor: selectedInstructor,
              selected_package: packageSummary,
              package_days: chosenPackage?.days ?? null,
              package_mins_per_day: chosenPackage?.minsPerDay ?? DEFAULT_SESSION_MINUTES,
              package_price: chosenPackage?.price ?? null,
              daily_time: selectedTime,
              amount_paid: 499,
            }),
          })
          if (!response.ok) throw new Error(`Webhook request failed with status ${response.status}`)
        } catch (error) {
          console.error('[v0] Booking webhook failed:', error)
        }
      })()

      setActiveBooking({
        school: selectedSchool,
        dateLabel: formatBookingDate(dates[selectedDate]),
        timeLabel: selectedTime,
        studentName: name,
        balanceDue: 7000,
      })
      setCheckoutOpen(false)
      setBookingConfirmed(true)
    } catch (error) {
      console.error('[v0] Booking insert failed:', error)
      setBookingError('We couldn’t save your booking. Please check your details and try again.')
    } finally {
      setSubmitting(false)
    }
  }

  function detectLocation() {
    if (!navigator.geolocation) {
      toast.error('Location is not available in this browser.')
      return
    }
    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        setMapFocus({ lat: position.coords.latitude, lng: position.coords.longitude, zoom: 14, key: ++mapFocusSequence.current })
        try {
          const url = new URL('https://nominatim.openstreetmap.org/reverse')
          url.searchParams.set('format', 'json')
          url.searchParams.set('lat', String(position.coords.latitude))
          url.searchParams.set('lon', String(position.coords.longitude))
          url.searchParams.set('addressdetails', '1')
          const result = await fetchNominatimJson<NominatimLocation>(url)
          const locality = getPlaceAreaName(result)
          if (!locality) throw new Error('No neighborhood was found for your location')
          showSchoolsForLocation(locality, formatPlaceDisplayLabel(result))
        } catch {
          toast.error('Could not find your neighborhood.', { description: 'Please search for your area instead.' })
        } finally {
          setLocating(false)
        }
      },
      () => {
        setLocating(false)
        toast.error('Could not determine your location.', { description: 'Check your browser permissions and try again.' })
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 },
    )
  }

  function handleFilter(filter: SchoolFilter) {
    setActiveFilter((current) => current === filter ? null : filter)
  }

  function toggleFavoriteSchool(school: School) {
    const schoolId = String(school.id)
    const isSaved = favoriteSchoolIds.includes(schoolId)
    setFavoriteSchoolIds((current) => isSaved ? current.filter((id) => id !== schoolId) : [...current, schoolId])
    if (isSaved) toast('Removed from favorites')
    else toast.success('School saved to favorites')
  }

  async function installApp() {
    if (!installPromptEvent) {
      toast.info('Use your browser menu to add Trinela to your Home Screen.')
      return
    }
    await installPromptEvent.prompt()
    const choice = await installPromptEvent.userChoice
    if (choice.outcome === 'accepted') setInstallBannerVisible(false)
    setInstallPromptEvent(null)
  }

  const normalizedSearchLocation = schoolSearchLocation.trim().toLocaleLowerCase()
  const normalizedSchoolName = schoolNameQuery.trim().toLocaleLowerCase()
  const matchingAreaSchools = normalizedSearchLocation
    ? schools.filter((school) => school.location.toLocaleLowerCase().includes(normalizedSearchLocation))
    : schools
  const nearbySchools = mapFocus
    ? schools.filter((school) => {
        const location = school.lat !== null && school.lng !== null
          ? { lat: school.lat, lng: school.lng }
          : mapAreaCoordinates[school.location]
        return isValidSchoolCoordinate(location) && haversineDistanceKm(mapFocus, location) <= SCHOOL_SEARCH_RADIUS_KM
      })
    : []
  const availableSchools = !normalizedSearchLocation
    ? schools
    : isIndianPostcode(searchQuery) && nearbySchools.length > 0
      ? nearbySchools
      : matchingAreaSchools.length > 0
        ? matchingAreaSchools
        : nearbySchools
  const savedSchools = availableSchools.filter((school) => favoriteSchoolIds.includes(String(school.id)))
  const filteredSchools = availableSchools.filter((school) => {
    if (normalizedSchoolName && !school.name.toLocaleLowerCase().includes(normalizedSchoolName)) return false
    const price = school.trinelaPrice
    const rating = school.rating

    if (activeFilter === 'Manual' && school.transmission !== 'manual') return false
    if (activeFilter === 'Automatic' && school.transmission !== 'automatic') return false
    if (activeFilter === 'Under ₹7,000' && (!Number.isFinite(price) || price >= 7000)) return false
    if (activeFilter === '₹7,000–₹8,000' && (!Number.isFinite(price) || price < 7000 || price > 8000)) return false
    if (activeFilter === 'Above ₹8,000' && (!Number.isFinite(price) || price <= 8000)) return false
    if (activeFilter === '4.5+ Rating' && (rating ?? 0) < 4.5) return false
    if (activeFilter === '4.0+ Rating' && (rating ?? 0) < 4) return false
    if (activeFilter === 'Verified Schools Only' && !school.verified) return false
    return true
  }).sort((first, second) => {
    if (sortBy === 'Price: Low to High') return first.trinelaPrice - second.trinelaPrice
    if (sortBy === 'Price: High to Low') return second.trinelaPrice - first.trinelaPrice
    return (second.rating ?? 0) - (first.rating ?? 0)
  })

  function showSchools() {
    setActiveNav('Home')
    document.getElementById('schools')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  function showSchoolsForLocation(searchLocation: string, displayValue = searchLocation, coordinates?: SchoolCoordinate) {
    const trimmedLocation = searchLocation.trim()
    const coreArea = isIndianPostcode(trimmedLocation) ? trimmedLocation : extractCoreArea(trimmedLocation)
    setSchoolNameQuery('')
    setLocation(coreArea)
    setSearchQuery(displayValue)
    setSchoolSearchLocation(coreArea)

    if (coordinates) {
      setMapFocus({ ...coordinates, zoom: isIndianPostcode(displayValue) ? 14 : 13, key: ++mapFocusSequence.current })
    } else if (!trimmedLocation) {
      setMapFocus({ ...BENGALURU_MAP_CENTER, zoom: 11, key: ++mapFocusSequence.current })
    }

    showSchools()
  }

  function showSchoolsByName(query: string) {
    setSchoolNameQuery(query.trim())
    setSearchQuery('')
    setLocation('')
    setSchoolSearchLocation('')
    setMapFocus({ ...BENGALURU_MAP_CENTER, zoom: 11, key: ++mapFocusSequence.current })
    showSchools()
  }

  function openPartnerView() {
    setPartnerViewOpen(true)
  }

  function closePartnerView() {
    setPartnerViewOpen(false)
    setActiveNav('Home')
  }

  function goHome() {
    setActiveNav('Home')
    setSlotPickerOpen(false)
    setSchoolDetailOpen(false)
  }

  function navigateToAccount(view: 'My Bookings' | 'Profile') {
    if (!isLoggedIn) {
      setAuthInitialMode('signin')
      setAuthModalOpen(true)
      return
    }
    setActiveNav(view)
    window.scrollTo({ top: 0, behavior: 'instant' })
  }

  async function logOut() {
    const { error } = await supabase.auth.signOut()
    if (error) {
      console.error('[v0] Supabase sign out failed:', error)
      return
    }
    setActiveNav('Home')
    setIsLoggedIn(false)
    setAuthUser(null)
    setAuthenticatedPhone('')
  }

  function chooseSchool(school: School) {
    setSelectedSchool(school)
    setSelectedCar(school.carDetails[0]?.name ?? '')
    setSelectedInstructor(school.trainerDetails[0]?.name ?? '')
    setSelectedTime('')
    setSelectedPackageIndex(school.packages.length === 1 ? 0 : null)
    setSchoolDetailOpen(true)
    setSlotPickerOpen(false)
  }

  function openSlotPicker() {
    setSchoolDetailOpen(false)
    setSlotPickerOpen(true)
    window.setTimeout(() => document.getElementById('slots')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50)
  }

  function closeSchoolDetail() {
    setSchoolDetailOpen(false)
    setSelectedSchool(null)
  }

  function returnToSchoolDetail() {
    setSlotPickerOpen(false)
    setSchoolDetailOpen(true)
  }

  function closeCheckout() {
    setCheckoutOpen(false)
    setBookingError('')
    setStudentName('')
    setStudentPhone('')
  }

  return (
    <main className="app-shell">
      {installBannerVisible && <InstallBanner onInstall={() => void installApp()} onDismiss={() => setInstallBannerVisible(false)} />}
      {partnerViewOpen ? <PartnerWithUsView onBack={closePartnerView} /> : <>
      {activeNav === 'My Bookings' ? <MyBookingsDashboard booking={activeBooking} fallbackSchool={selectedSchool ?? schools[0]} fallbackDate={dates[0]} onHome={goHome} onProfile={() => navigateToAccount('Profile')} /> : activeNav === 'Profile' ? <ProfileView user={authUser} phone={authenticatedPhone} onHome={goHome} onLogout={() => void logOut()} onBookings={() => navigateToAccount('My Bookings')} savedSchools={savedSchools} onToggleFavorite={toggleFavoriteSchool} onSelectSchool={(school) => { chooseSchool(school); setActiveNav('Home') }} /> : <>
      <Header location={location} locating={locating} onLocate={detectLocation} onPartnerClick={openPartnerView} onAccountNavigation={navigateToAccount} onAuthClick={(mode) => { setAuthInitialMode(mode); setAuthModalOpen(true) }} />
      <div className="page-container">
        <Hero searchQuery={searchQuery} setSearchQuery={setSearchQuery} schoolNameQuery={schoolNameQuery} onSchoolNameQueryChange={setSchoolNameQuery} onSchoolNameSearch={showSchoolsByName} onLocationSearch={showSchoolsForLocation} onLocate={detectLocation} locationLoading={locating} />
        <OffersForYou />
        <ReferralBanner onGetCode={() => navigateToAccount('Profile')} />
        <TrustSignals />
        <SchoolList onSelect={chooseSchool} onClearSearch={() => { setSearchQuery(''); setSchoolNameQuery(''); setLocation(''); setSchoolSearchLocation(''); setMapFocus({ ...BENGALURU_MAP_CENTER, zoom: 11, key: ++mapFocusSequence.current }); setActiveFilter(null) }} onAreasGeocoded={setMapAreaCoordinates} location={location} searchQuery={searchQuery} schoolNameQuery={schoolNameQuery} schools={filteredSchools} allSchools={schools} mapFocus={mapFocus} hasLoadError={Boolean(schoolsError)} activeFilter={activeFilter} onFilter={handleFilter} sortBy={sortBy} onSort={setSortBy} onRetry={() => { void mutate() }} favoriteIds={favoriteSchoolIds} onToggleFavorite={toggleFavoriteSchool} />
        <HowItWorks />
        {selectedSchool && slotPickerOpen && <SlotPicker school={selectedSchool} dates={dates} selectedDate={selectedDate} selectedTime={selectedTime} selectedPackageIndex={selectedPackageIndex} onDate={setSelectedDate} onTime={setSelectedTime} onPackage={(index) => { setSelectedPackageIndex(index); const minutes = selectedSchool.packages[index]?.minsPerDay ?? DEFAULT_SESSION_MINUTES; if (selectedTime && !isWithinOperatingHours(selectedTime, minutes)) setSelectedTime('') }} onBack={returnToSchoolDetail} onContinue={() => { setCheckoutOpen(true) }} />}
        <FaqSection />
      </div>
      <Footer onPartnerClick={openPartnerView} />
      {schoolDetailOpen && selectedSchool && <SchoolDetailView school={selectedSchool} onClose={closeSchoolDetail} onSelectSlot={openSlotPicker} selectedCar={selectedCar} onSelectCar={setSelectedCar} selectedInstructor={selectedInstructor} onSelectInstructor={setSelectedInstructor} />}
      {checkoutOpen && selectedSchool && <CheckoutModal school={selectedSchool} dates={dates} selectedDate={selectedDate} selectedTime={selectedTime} selectedCar={selectedCar} selectedInstructor={selectedInstructor} selectedPackage={selectedPackageIndex !== null ? selectedSchool.packages[selectedPackageIndex] ?? null : null} onClose={closeCheckout} onConfirm={submitBooking} studentName={studentName} setStudentName={setStudentName} studentPhone={studentPhone} setStudentPhone={setStudentPhone} submitting={submitting} submitError={bookingError} />}
      </>}
      {bookingConfirmed && activeBooking && <BookingSuccessView school={activeBooking.school} onDashboard={() => { setBookingConfirmed(false); setActiveNav('My Bookings') }} />}
      <nav className="mobile-bottom-nav" aria-label="Mobile navigation">
        <a href="#top" className={activeNav === 'Home' ? 'is-active' : ''} onClick={goHome}><Home size={19} /><span>Home</span></a>
        <a href="#bookings" className={activeNav === 'My Bookings' ? 'is-active' : ''} onClick={(event) => { event.preventDefault(); navigateToAccount('My Bookings') }}><CalendarDays size={19} /><span>My Bookings</span></a>
        <a href="#profile" className={activeNav === 'Profile' ? 'is-active' : ''} onClick={(event) => { event.preventDefault(); navigateToAccount('Profile') }}><UserRound size={19} /><span>Profile</span></a>
      </nav>
      {authModalOpen && <AuthModal initialMode={authInitialMode} onClose={() => setAuthModalOpen(false)} />}
      </>}
      <SupportWidget />
    </main>
  )
}
