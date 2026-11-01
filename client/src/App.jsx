import { useEffect, useRef, useState } from 'react'
import logo from './assets/sweeplune-logo.png'
import './App.css'
// Interpret booking fields in the provider's zone, never the device's zone.
const serviceTimeZone = 'Europe/Budapest'
const budapestPartsFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: serviceTimeZone, calendar: 'gregory', numberingSystem: 'latn',
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
})
const budapestDisplayFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: serviceTimeZone, year: 'numeric', month: 'short', day: 'numeric',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZoneName: 'short',
})

function formatServiceTime(value) {
  const instant = new Date(value)
  return Number.isFinite(instant.getTime())
    ? `${budapestDisplayFormatter.format(instant)} (Budapest)`
    : 'Time unavailable'
}

function budapestWallTime(instant) {
  const parts = Object.fromEntries(budapestPartsFormatter.formatToParts(instant)
    .filter((part) => part.type !== 'literal').map((part) => [part.type, Number(part.value)]))
  // setUTCFullYear avoids Date.UTC's special treatment of years 0–99.
  const wall = new Date(0)
  wall.setUTCFullYear(parts.year, parts.month - 1, parts.day)
  wall.setUTCHours(parts.hour, parts.minute, parts.second, 0)
  return wall.getTime()
}

function parseServiceTime(dateText, timeText) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateText) || !/^\d{2}:\d{2}$/.test(timeText)) {
    return { error: 'Enter a valid date and time in Budapest.' }
  }
  const [year, month, day] = dateText.split('-').map(Number)
  const [hour, minute] = timeText.split(':').map(Number)
  const wall = new Date(0)
  wall.setUTCFullYear(year, month - 1, day)
  wall.setUTCHours(hour, minute, 0, 0)
  if (year < 1 || wall.getUTCFullYear() !== year || wall.getUTCMonth() !== month - 1 ||
      wall.getUTCDate() !== day || wall.getUTCHours() !== hour || wall.getUTCMinutes() !== minute) {
    return { error: 'Enter a valid calendar date and time.' }
  }
  const target = wall.getTime()
  // Sample both sides of Budapest's clock change to collect possible offsets.
  const offsets = new Set()
  for (let hours = -36; hours <= 36; hours += 6) {
    const sample = target + hours * 60 * 60 * 1000
    offsets.add(budapestWallTime(sample) - sample)
  }
  const candidates = [...offsets].map((offset) => target - offset)
    .filter((candidate) => budapestWallTime(candidate) === target)
  if (candidates.length === 0) {
    return { error: 'This time does not exist in Budapest because the clocks move forward. Choose another time.' }
  }
  if (candidates.length !== 1) {
    return { error: 'This time occurs twice in Budapest because the clocks move back. Choose another time outside the repeated hour.' }
  }
  return { instant: new Date(candidates[0]) }
}

const inputStyle =
  'mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/20'
async function accountRequest(path, options = {}) {
  const response = await fetch(path, { credentials: 'same-origin', ...options })
  let data
  try { data = await response.json() } catch {
    throw new Error('The server returned an unreadable response. Please check your connection.')
  }
  if (!response.ok) {
    const error = new Error(data.message || 'Account request failed.')
    error.status = response.status
    error.code = data.code
    error.fields = data.fields || {}
    throw error
  }
  return data
}
async function accountMutation(path, body, method = 'POST') {
  const { csrfToken } = await accountRequest('/api/auth/csrf')
  return accountRequest(path, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
    body: JSON.stringify(body),
  })
}
function MyBookings({ refreshKey }) {
  const [page, setPage] = useState(1)
  const [attempt, setAttempt] = useState(0)
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  useEffect(() => {
    const controller = new AbortController()
    async function load() {
      setLoading(true)
      setError('')
      setResult(null)
      try {
        const data = await accountRequest(`/api/bookings?page=${page}&limit=20`, { signal: controller.signal })
        if (!Array.isArray(data.bookings)) throw new Error('Invalid booking history response.')
        if (!controller.signal.aborted) setResult(data)
      } catch (failure) {
        if (!controller.signal.aborted) setError(failure.status === 401 ? 'Your session expired. Sign in again to view bookings.' : failure.message)
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }
    load()
    return () => controller.abort()
  }, [page, attempt, refreshKey])
  return (
    <section id="my-bookings" className="mt-14 scroll-mt-6 rounded-2xl border border-slate-200 bg-white p-6 sm:p-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h2 className="text-2xl font-bold">My Bookings</h2>
        <button type="button" disabled={loading} onClick={() => setAttempt((value) => value + 1)} className="rounded-lg border px-4 py-2 disabled:opacity-50">Refresh bookings</button>
      </div>
      {loading && <p role="status" className="mt-4">Loading bookings…</p>}
      {error && <p role="alert" className="mt-4 text-red-700">{error}</p>}
      {!loading && !error && result?.bookings.length === 0 && <p className="mt-4 text-slate-600">{page === 1 ? 'You have no bookings yet.' : 'No bookings on this page.'}</p>}
      {!loading && !error && result && (
        <>
          <div className="mt-5 space-y-4">
            {result.bookings.map((booking) => (
              <article key={booking.id} className="rounded-xl border border-slate-200 p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h3 className="font-semibold">{booking.serviceNameSnapshot}</h3>
                  <span className={`status-badge status-${booking.status}`}>{booking.status}</span>
                </div>
                <p className="mt-3 text-sm text-slate-600">Preferred time: {formatServiceTime(booking.preferredAt)}</p>
                <p className="mt-2 whitespace-pre-wrap break-words">{booking.address}</p>
                {booking.notes && <p className="mt-2 whitespace-pre-wrap break-words text-sm text-slate-600">Instructions: {booking.notes}</p>}
                <p className="mt-3 break-all text-xs text-slate-500">Reference: {booking.id}</p>
              </article>
            ))}
          </div>
          <div className="mt-5 flex items-center gap-4">
            <button type="button" disabled={page === 1} onClick={() => setPage((value) => value - 1)} className="rounded-lg border px-4 py-2 disabled:opacity-40">Previous</button>
            <span>Page {page}</span>
            <button type="button" disabled={!result.hasMore} onClick={() => setPage((value) => value + 1)} className="rounded-lg border px-4 py-2 disabled:opacity-40">Next</button>
          </div>
        </>
      )}
    </section>
  )
}
function AdminDashboard({ onBusyChange, disabled }) {
  const [view, setView] = useState({ page: 1, status: '' })
  const [attempt, setAttempt] = useState(0)
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [busyId, setBusyId] = useState(null)
  const updating = useRef(false)
  const mounted = useRef(false)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])
  useEffect(() => {
    const controller = new AbortController()
    async function load() {
      setLoading(true)
      setResult(null)
      setError('')
      try {
        const query = new URLSearchParams({ page: String(view.page), limit: '20' })
        if (view.status) query.set('status', view.status)
        const data = await accountRequest(`/api/admin/bookings?${query}`, { signal: controller.signal })
        if (!Array.isArray(data.bookings)) throw new Error('Invalid admin booking response.')
        if (!controller.signal.aborted) setResult(data)
      } catch (failure) {
        if (!controller.signal.aborted) setError(failure.status === 401
          ? 'Your session expired. Sign out and sign in again.'
          : failure.status === 403 ? 'An administrator account is required.' : failure.message)
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }
    load()
    return () => controller.abort()
  }, [view, attempt])
  async function changeStatus(booking, status) {
    if (disabled || updating.current) return
    updating.current = true
    setBusyId(booking.id)
    onBusyChange(true)
    setError('')
    setMessage('')
    try {
      const data = await accountMutation(`/api/admin/bookings/${booking.id}/status`, {
        status, expectedVersion: booking.version,
      }, 'PATCH')
      if (!data.booking?.id) throw new Error('Incomplete booking update response.')
      if (mounted.current) {
        setMessage(`Booking ${booking.id} is now ${data.booking.status}.`)
        setAttempt((value) => value + 1)
      }
    } catch (failure) {
      if (mounted.current) {
        setError(failure.status === 409
          ? 'This booking changed elsewhere. Refresh bookings before trying again.'
          : failure.status === 401 ? 'Your session expired. Sign out and sign in again.'
          : failure.status ? failure.message
          : 'The update result could not be confirmed. Refresh bookings to check its status before trying again.')
        // Hide stale action buttons until the administrator reloads the list.
        setResult(null)
      }
    } finally {
      updating.current = false
      if (mounted.current) {
        setBusyId(null)
        onBusyChange(false)
      }
    }
  }
  const actions = { pending: ['confirmed', 'cancelled'], confirmed: ['completed', 'cancelled'] }
  const labels = { confirmed: 'Confirm booking', completed: 'Mark completed', cancelled: 'Cancel booking' }
  return (
    <section id="admin" className="mt-14 scroll-mt-6 rounded-2xl border border-slate-200 bg-white p-6 sm:p-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold">Admin dashboard</h2>
          <p className="mt-2 text-slate-600">Review cleaning requests and update their status.</p>
        </div>
        <button type="button" disabled={disabled || loading || Boolean(busyId)} onClick={() => { setMessage(''); setAttempt((value) => value + 1) }} className="rounded-lg border px-4 py-2 disabled:opacity-50">Refresh bookings</button>
      </div>
      <div className="admin-summary">{[['Requests on this page', result?.bookings.length], ['Pending on this page', result?.bookings.filter((item) => item.status === 'pending').length], ['Confirmed on this page', result?.bookings.filter((item) => item.status === 'confirmed').length]].map(([label,count]) => <div key={label}><span>{label}</span><strong>{loading || !result ? '—' : count}</strong><Icon name="calendar" /></div>)}</div>
      <label htmlFor="admin-status" className="mt-6 block max-w-xs font-medium">
        Filter by status
        <select id="admin-status" value={view.status} disabled={disabled || Boolean(busyId)} onChange={(event) => { setMessage(''); setView({ page: 1, status: event.target.value }) }} className={inputStyle}>
          <option value="">All statuses</option>
          {['pending', 'confirmed', 'completed', 'cancelled'].map((status) => <option key={status} value={status}>{status[0].toUpperCase() + status.slice(1)}</option>)}
        </select>
      </label>
      <p className="mt-3 text-sm text-slate-500">All times below are shown in Budapest time (Europe/Budapest).</p>
      {message && <p role="status" className="mt-4 rounded-lg bg-teal-50 p-3 break-words text-teal-800">{message}</p>}
      {error && <p role="alert" className="mt-4 text-red-700">{error}</p>}
      {loading && <p role="status" className="mt-4">Loading bookings…</p>}
      {!loading && result && (
        <>
          {result.bookings.length === 0 && <p className="mt-5 text-slate-600">No bookings found on this page.</p>}
          <div className="booking-table-wrap"><table className="booking-table"><caption className="sr-only">Booking requests on page {view.page}</caption><thead><tr><th scope="col">Service / customer</th><th scope="col">Preferred appointment</th><th scope="col">Status</th><th scope="col">Review & actions</th></tr></thead><tbody>
            {result.bookings.map((booking) => <tr key={booking.id}><td><strong>{booking.serviceNameSnapshot}</strong><small className="record-id">Customer: {booking.customerId}</small><small className="record-id">Ref: {booking.id}</small></td><td><span>{formatServiceTime(booking.preferredAt)}</span><small className="record-address">{booking.address}</small></td><td><span className={`status-badge status-${booking.status}`}>{booking.status}</span></td><td><details className="booking-detail"><summary>View details</summary>{booking.notes && <p className="whitespace-pre-wrap break-words">{booking.notes}</p>}<ol>{booking.statusHistory?.map((entry,index) => <li key={index}>{entry.status} · {formatServiceTime(entry.changedAt)}</li>)}</ol></details><div className="table-actions">{(actions[booking.status] || []).map((status) => <button key={status} type="button" disabled={disabled || Boolean(busyId)} onClick={() => changeStatus(booking,status)} className={status === 'cancelled' ? 'cancel-action' : 'confirm-action'}>{busyId === booking.id ? 'Updating…' : labels[status]}</button>)}{!actions[booking.status] && <small>Booking closed</small>}</div></td></tr>)}
          </tbody></table></div>
          <div className="mt-6 flex flex-wrap items-center gap-4">
            <button type="button" disabled={disabled || view.page === 1 || Boolean(busyId)} onClick={() => setView((previous) => ({ ...previous, page: previous.page - 1 }))} className="rounded-lg border px-4 py-2 disabled:opacity-40">Previous</button>
            <span>Page {view.page}</span>
            <button type="button" disabled={disabled || !result.hasMore || Boolean(busyId)} onClick={() => setView((previous) => ({ ...previous, page: previous.page + 1 }))} className="rounded-lg border px-4 py-2 disabled:opacity-40">Next</button>
          </div>
        </>
      )}
    </section>
  )
}
function AdminServices({ disabled, onBusyChange, onCatalogueChange }) {
  const emptyForm = { name: '', description: '', isActive: true }
  const [form, setForm] = useState(emptyForm)
  const [editing, setEditing] = useState(null)
  const [page, setPage] = useState(1)
  const [attempt, setAttempt] = useState(0)
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [needsRefresh, setNeedsRefresh] = useState(false)
  const [error, setError] = useState('')
  const [fields, setFields] = useState({})
  const [message, setMessage] = useState('')
  const updating = useRef(false)
  const mounted = useRef(false)
  const editor = useRef(null)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])
  useEffect(() => {
    const controller = new AbortController()
    async function load() {
      setLoading(true)
      setResult(null)
      try {
        const data = await accountRequest(`/api/admin/services?page=${page}&limit=20`, { signal: controller.signal })
        if (!Array.isArray(data.services)) throw new Error('Invalid service list response.')
        if (!controller.signal.aborted) {
          setResult(data)
          setNeedsRefresh(false)
        }
      } catch (failure) {
        if (!controller.signal.aborted) setError(accessMessage(failure))
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }
    load()
    return () => controller.abort()
  }, [page, attempt])
  function accessMessage(failure) {
    return failure.status === 401 ? 'Your session expired. Sign out and sign in again.'
      : failure.status === 403 ? 'Administrator access is required. If your session expired, sign out and sign in again.'
      : failure.message || 'Unable to load services. Please try again.'
  }
  function resetEditor() {
    setEditing(null)
    setForm(emptyForm)
    setFields({})
  }
  function refresh() {
    if (disabled || updating.current) return
    resetEditor()
    setError('')
    setMessage('')
    setAttempt((value) => value + 1)
    onCatalogueChange()
  }
  function edit(service) {
    if (disabled || loading || updating.current || needsRefresh) return
    setEditing({ id: service.id, version: service.version })
    setForm({ name: service.name, description: service.description, isActive: service.isActive })
    setFields({})
    setError('')
    setMessage('')
    editor.current?.focus()
  }
  function updateField(event) {
    const { name, value, checked, type } = event.target
    setForm((previous) => ({ ...previous, [name]: type === 'checkbox' ? checked : value }))
    setFields((previous) => ({ ...previous, [name]: undefined }))
  }
  async function saveService(event) {
    event.preventDefault()
    if (disabled || loading || updating.current || needsRefresh) return
    const errors = {}
    if (!form.name.trim() || form.name.trim().length > 100) errors.name = 'Use between 1 and 100 characters.'
    if (!form.description.trim() || form.description.trim().length > 1000) errors.description = 'Use between 1 and 1,000 characters.'
    setFields(errors)
    setError('')
    setMessage('')
    if (Object.keys(errors).length) return
    updating.current = true
    setBusy(true)
    onBusyChange(true)
    try {
      const body = { name: form.name.trim(), description: form.description.trim(), isActive: form.isActive }
      if (editing) body.expectedVersion = editing.version
      const data = await accountMutation(editing ? `/api/admin/services/${editing.id}` : '/api/admin/services', body, editing ? 'PATCH' : 'POST')
      if (!data.service?.id) throw new Error('Incomplete service response.')
      if (mounted.current) {
        setMessage(`Service ${editing ? 'updated' : 'created'} successfully.`)
        resetEditor()
        setLoading(true)
        setResult(null)
        setAttempt((value) => value + 1)
        onCatalogueChange()
      }
    } catch (failure) {
      if (mounted.current) {
        setFields(failure.fields || {})
        setError(failure.status === 409
          ? 'This service changed elsewhere. Reload services, then select Edit again. Reloading clears the form.'
          : failure.status ? accessMessage(failure)
          : 'The save result could not be confirmed. Reload services and check the list before saving again. Reloading clears the form.')
        if (!failure.status || failure.status === 409 || failure.status === 404) setNeedsRefresh(true)
      }
    } finally {
      updating.current = false
      if (mounted.current) {
        setBusy(false)
        onBusyChange(false)
      }
    }
  }
  const locked = disabled || busy || loading
  return (
    <section id="admin-services" className="mt-10 scroll-mt-6 rounded-2xl border border-slate-200 bg-white p-6 sm:p-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold">Manage services</h2>
          <p className="mt-2 text-slate-600">Add services or edit their details and availability. Deactivation preserves existing booking history.</p>
        </div>
        <button type="button" disabled={locked} onClick={refresh} className="rounded-lg border px-4 py-2 disabled:opacity-50">Reload services</button>
      </div>
      {message && <p role="status" className="mt-4 text-teal-800">{message}</p>}
      {error && <p role="alert" className="mt-4 text-red-700">{error}</p>}
      <form onSubmit={saveService} noValidate className="mt-6 rounded-xl bg-slate-50 p-5">
        <h3 tabIndex={-1} ref={editor} className="text-lg font-semibold">{editing ? 'Edit service' : 'Add a service'}</h3>
        <fieldset disabled={locked || needsRefresh} className="mt-4 space-y-4">
          <legend className="sr-only">Service details</legend>
          {['name', 'description'].map((name) => (
            <div key={name}>
              <label htmlFor={`service-${name}`} className="font-medium">{name === 'name' ? 'Service name' : 'Description'}</label>
              {name === 'name' ? (
                <input id={`service-${name}`} name={name} value={form[name]} onChange={updateField} required maxLength={100} className={inputStyle} aria-invalid={Boolean(fields[name])} aria-describedby={fields[name] ? `service-${name}-error` : undefined} />
              ) : (
                <textarea id={`service-${name}`} name={name} value={form[name]} onChange={updateField} rows={3} required maxLength={1000} className={inputStyle} aria-invalid={Boolean(fields[name])} aria-describedby={fields[name] ? `service-${name}-error` : undefined} />
              )}
              {fields[name] && <p id={`service-${name}-error`} className="mt-2 text-sm text-red-700">{fields[name]}</p>}
            </div>
          ))}
          <label className="flex items-center gap-3 font-medium">
            <input type="checkbox" name="isActive" checked={form.isActive} onChange={updateField} className="h-4 w-4 accent-teal-700" />
            Active — customers can book this service
          </label>
          {fields.isActive && <p className="text-sm text-red-700">{fields.isActive}</p>}
          {fields.form && <p className="text-sm text-red-700">{fields.form}</p>}
          <div className="flex flex-wrap gap-3">
            <button type="submit" className="rounded-lg bg-teal-700 px-5 py-3 font-semibold text-white hover:bg-teal-800 disabled:opacity-50">{busy ? 'Saving…' : editing ? 'Save changes' : 'Create service'}</button>
            {editing && <button type="button" onClick={resetEditor} className="rounded-lg border px-5 py-3">Cancel editing</button>}
          </div>
        </fieldset>
      </form>
      {loading && <p role="status" className="mt-5">Loading services…</p>}
      {!loading && result && (
        <>
          {!result.services.length && <p className="mt-5 text-slate-600">No services on this page.</p>}
          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            {result.services.map((service) => (
              <article key={service.id} className="rounded-xl border border-slate-200 p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h3 className="break-words font-semibold">{service.name}</h3>
                  <span className={`rounded-full px-3 py-1 text-sm ${service.isActive ? 'bg-teal-50 text-teal-800' : 'bg-slate-100 text-slate-600'}`}>{service.isActive ? 'Active' : 'Inactive'}</span>
                </div>
                <p className="mt-3 whitespace-pre-wrap break-words text-slate-600">{service.description}</p>
                <button type="button" disabled={locked || needsRefresh} onClick={() => edit(service)} className="mt-4 rounded-lg border px-4 py-2 font-medium disabled:opacity-50">Edit service</button>
              </article>
            ))}
          </div>
          <div className="mt-6 flex flex-wrap items-center gap-4">
            <button type="button" disabled={page === 1 || locked} onClick={() => { resetEditor(); setError(''); setMessage(''); setPage((value) => value - 1) }} className="rounded-lg border px-4 py-2 disabled:opacity-40">Previous</button>
            <span>Page {page}</span>
            <button type="button" disabled={!result.hasMore || locked} onClick={() => { resetEditor(); setError(''); setMessage(''); setPage((value) => value + 1) }} className="rounded-lg border px-4 py-2 disabled:opacity-40">Next</button>
          </div>
        </>
      )}
    </section>
  )
}
function Icon({ name = 'spark', size = 20 }) {
  const paths = {
    spark: 'm12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Z',
    home: 'm3 10 9-7 9 7v10H3V10Zm6 10v-7h6v7',
    grid: 'M3 3h7v7H3V3Zm11 0h7v7h-7V3ZM3 14h7v7H3v-7Zm11 0h7v7h-7v-7Z',
    calendar: 'M5 5h14v16H5V5Zm3-3v6m8-6v6M5 10h14m-10 5h6',
    user: 'M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0ZM4 21v-2a8 8 0 0 1 16 0v2',
    arrow: 'M4 12h15m-6-6 6 6-6 6',
    check: 'm5 12 4 4L19 6',
    clock: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9-5v5l3 2',
  }
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name] || paths.spark} /></svg>
}

function RoomIllustration() {
  return (
    <div className="room-art" aria-hidden="true">
      <div className="art-label"><span className="live-dot" /> A little more room to relax</div>
      <svg viewBox="0 0 560 430" role="presentation">
        <defs>
          <linearGradient id="wall" x2="0" y2="1"><stop stopColor="#e5eee3"/><stop offset="1" stopColor="#cddfd3"/></linearGradient>
          <linearGradient id="sofa" x2="0" y2="1"><stop stopColor="#528c79"/><stop offset="1" stopColor="#2b6555"/></linearGradient>
          <linearGradient id="light"><stop stopColor="#fff9dc" stopOpacity=".8"/><stop offset="1" stopColor="#fff9dc" stopOpacity="0"/></linearGradient>
        </defs>
        <path d="M0 0h560v330H0z" fill="url(#wall)"/>
        <path d="M0 330h560v100H0z" fill="#c4b79c"/>
        <path d="M0 331h560" stroke="#b4c7b9" strokeWidth="7"/>
        <path d="m350 110 210 55v220L200 330Z" fill="url(#light)"/>
        <rect x="324" y="35" width="164" height="199" rx="74" fill="#f5f1db" stroke="#f8faf4" strokeWidth="12"/>
        <path d="M406 36v196m-80-91h160" stroke="#fbfcf5" strokeWidth="8"/>
        <path d="M333 190c34-30 76-21 145-65v101H333Z" fill="#a9c2ac"/>
        <path d="M406 36v196m-80-91h160" stroke="#fbfcf5" strokeWidth="6"/>
        <ellipse cx="277" cy="368" rx="204" ry="40" fill="#e9e3cc"/>
        <path d="M103 338v24m245-24v24" stroke="#514a38" strokeWidth="9"/>
        <rect x="91" y="225" width="270" height="115" rx="25" fill="url(#sofa)"/>
        <rect x="112" y="210" width="109" height="84" rx="21" fill="#6b9b86"/>
        <rect x="228" y="210" width="111" height="84" rx="21" fill="#6b9b86"/>
        <rect x="78" y="266" width="43" height="78" rx="17" fill="#3d7864"/>
        <rect x="335" y="266" width="43" height="78" rx="17" fill="#3d7864"/>
        <rect x="121" y="285" width="214" height="43" rx="12" fill="#77a28b"/>
        <rect x="144" y="236" width="52" height="51" rx="10" fill="#dfca94" transform="rotate(-12 170 260)"/>
        <path d="M177 242v39m-13-35v37" stroke="#baa779" strokeWidth="2"/>
        <ellipse cx="366" cy="341" rx="64" ry="19" fill="#e2b880"/>
        <path d="m328 349-7 45m82-45 7 45" stroke="#846c4d" strokeWidth="7"/>
        <rect x="358" y="314" width="19" height="22" rx="4" fill="#faf6e8"/>
        <path d="M377 319c17-3 17 13 0 10" fill="none" stroke="#faf6e8" strokeWidth="4"/>
        <path d="M457 320c-12-48 15-78 5-140m-4 87c-29-3-39-24-29-45 23 1 34 21 29 45Zm4-39c26-2 39-20 30-41-24 1-35 17-30 41Zm-4 72c-25-2-42-19-36-39 24-2 39 12 36 39Z" fill="#477c58" stroke="#477c58" strokeWidth="3"/>
        <path d="M432 309h50l-7 52h-35Z" fill="#c68e65"/>
        <rect x="74" y="63" width="100" height="111" fill="#d9b987"/>
        <rect x="81" y="70" width="86" height="97" fill="#f5efe1"/>
        <circle cx="123" cy="107" r="20" fill="#e0bd78"/>
        <path d="M87 153c31-52 47-40 72 0" fill="#779984"/>
        <path d="M261 89v22m-11-11h22M504 272v20m-10-10h20" stroke="#fffdf1" strokeWidth="3" strokeLinecap="round"/>
      </svg>
      <div className="art-note"><span className="note-icon"><Icon name="check" /></span><div><strong>Your space. A fresh start.</strong><small>Thoughtful cleaning, simply arranged.</small></div></div>
    </div>
  )
}

export default function App() {
  const [page, setPage] = useState('home')
  function navigate(next) {
    if (adminBusy || bookingBusy || authBusy) return
    setPage(next)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }
  function followLink(event) {
    const link = event.target.closest('a[href^="#"]')
    if (!link) return
    const routes = { '#': 'home', '#services': 'services', '#booking': 'booking', '#account': 'account', '#my-bookings': 'history', '#admin': 'admin', '#admin-services': 'admin-services' }
    const next = routes[link.getAttribute('href')]
    if (next) { event.preventDefault(); navigate(next) }
  }

  const [adminBusy, setAdminBusy] = useState(false)
  const [user, setUser] = useState(null)
  const [bookingBusy, setBookingBusy] = useState(false)
  const [bookingError, setBookingError] = useState('')
  const [bookingsRefresh, setBookingsRefresh] = useState(0)
  const submittingBooking = useRef(false)
  const [checkingSession, setCheckingSession] = useState(true)
  const [sessionError, setSessionError] = useState('')
  const [sessionAttempt, setSessionAttempt] = useState(0)
  const [authMode, setAuthMode] = useState('login')
  const [account, setAccount] = useState({ name: '', email: '', password: '' })
  const [authErrors, setAuthErrors] = useState({})
  const [authError, setAuthError] = useState('')
  const [authMessage, setAuthMessage] = useState('')
  const [authBusy, setAuthBusy] = useState(false)
  useEffect(() => {
    const controller = new AbortController()
    async function restoreSession() {
      setCheckingSession(true)
      setSessionError('')
      try {
        const data = await accountRequest('/api/auth/me', { signal: controller.signal })
        if (!controller.signal.aborted) { setUser(data.user); if (data.user.role === 'admin') setPage('admin') }
      } catch (error) {
        if (!controller.signal.aborted) {
          setUser(null)
          if (error.status !== 401) setSessionError('Unable to check your session. Please try again.')
        }
      } finally {
        if (!controller.signal.aborted) setCheckingSession(false)
      }
    }
    restoreSession()
    return () => controller.abort()
  }, [sessionAttempt])
  function changeAuthMode(mode) {
    setAuthMode(mode)
    setAccount((previous) => ({ ...previous, password: '' }))
    setAuthErrors({})
    setAuthError('')
    setAuthMessage('')
  }
  function updateAccount(event) {
    const { name, value } = event.target
    setAccount((previous) => ({ ...previous, [name]: value }))
    setAuthErrors((previous) => ({ ...previous, [name]: undefined }))
    setAuthError('')
    setAuthMessage('')
  }
  async function submitAccount(event) {
    event.preventDefault()
    if (authBusy || adminBusy || submittingBooking.current) return
    const registering = authMode === 'register'
    const fields = {}
    if (registering && (account.name.trim().length < 2 || account.name.trim().length > 100)) {
      fields.name = 'Use a name between 2 and 100 characters.'
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(account.email.trim()) || account.email.trim().length > 254) {
      fields.email = 'Enter a valid email address.'
    }
    if (account.password.length < (registering ? 12 : 1) || account.password.length > 128) {
      fields.password = registering ? 'Use a password between 12 and 128 characters.' : 'Enter your password.'
    }
    setAuthErrors(fields)
    setAuthError('')
    setAuthMessage('')
    if (Object.keys(fields).length) return
    setAuthBusy(true)
    try {
      const body = { email: account.email.trim(), password: account.password }
      if (registering) body.name = account.name.trim()
      const data = await accountMutation(`/api/auth/${authMode}`, body)
      setAccount((previous) => ({ ...previous, password: '' }))
      if (registering) {
        setAuthMode('login')
        setAuthMessage('Account created. Sign in with your email and password.')
      } else {
        setUser(data.user)
        setPage(data.user.role === 'admin' ? 'admin' : 'booking')
        setAuthMessage('You are signed in.')
      }
    } catch (error) {
      setAuthError(error.message || 'Unable to connect. Please try again.')
      setAuthErrors(error.fields || {})
    } finally {
      setAuthBusy(false)
    }
  }
  async function logout() {
    if (authBusy || adminBusy || submittingBooking.current) return
    setAuthBusy(true)
    setAuthError('')
    setAuthMessage('')
    try {
      await accountMutation('/api/auth/logout', {})
      setUser(null)
      setAccount({ name: '', email: '', password: '' })
      setPreview(null)
      setBookingError('')
      setForm({ serviceId: '', date: '', time: '', address: '', notes: '' })
      setErrors({})
      setPage('account')
      setAuthMessage('You have signed out.')
    } catch (error) {
      if (error.status === 401) {
        setUser(null)
        setPreview(null)
      }
      setAuthError(error.message || 'Unable to sign out. Please try again.')
    } finally {
      setAuthBusy(false)
    }
  }
  const [services, setServices] = useState([])
  const [loadingServices, setLoadingServices] = useState(true)
  const [serviceError, setServiceError] = useState('')
  const [catalogueAttempt, setCatalogueAttempt] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    async function loadServices() {
      setLoadingServices(true)
      setServiceError('')
      try {
        const response = await fetch('/api/services', {
          signal: controller.signal,
        })
        if (!response.ok) throw new Error('Unable to load services.')
        const data = await response.json()
        if (!Array.isArray(data) || data.some((service) =>
          !service || typeof service.id !== 'string' ||
          typeof service.name !== 'string' ||
          typeof service.description !== 'string'
        )) {
          throw new Error('The service catalogue response was invalid.')
        }
        if (!controller.signal.aborted) setServices(data)
      } catch {
        if (!controller.signal.aborted) {
          setServices([])
          setServiceError('Unable to load services. Check that the backend is running and try again.')
        }
      } finally {
        if (!controller.signal.aborted) setLoadingServices(false)
      }
    }
    loadServices()
    return () => controller.abort()
  }, [catalogueAttempt])
  const catalogueUnavailable = loadingServices || Boolean(serviceError) || services.length === 0
  const [form, setForm] = useState({
    serviceId: '',
    date: '',
    time: '',
    address: '',
    notes: '',
  })
  const [errors, setErrors] = useState({})
  const [preview, setPreview] = useState(null)
  function updateField(event) {
    if (submittingBooking.current) return
    setBookingError('')
    const { name, value } = event.target
    setForm((previous) => ({ ...previous, [name]: value }))
    setErrors((previous) => ({ ...previous, [name]: undefined }))
    setPreview(null)
  }
  function selectService(serviceId) {
    if (submittingBooking.current) return
    setBookingError('')
    setForm((previous) => ({ ...previous, serviceId }))
    setErrors((previous) => ({ ...previous, serviceId: undefined }))
    setPreview(null)
    navigate('booking')
  }
  async function submitBooking(event) {
    event.preventDefault()
    if (catalogueUnavailable || submittingBooking.current || authBusy) return
    setBookingError('')
    setPreview(null)
    if (!user || user.role !== 'customer') {
      setBookingError('Sign in with a customer account before submitting a booking.')
      setPage('account')
      return
    }
    const nextErrors = {}
    const selectedService = services.find(
      (service) => service.id === form.serviceId,
    )
    const parsedTime = parseServiceTime(form.date, form.time)
    const preferredAt = parsedTime.instant
    if (!selectedService) {
      nextErrors.serviceId = 'Please select a service.'
    }
    if (!form.date) nextErrors.date = 'Please choose a date.'
    if (!form.time) nextErrors.time = 'Please choose a time.'
    if (form.date && form.time) {
      if (parsedTime.error) nextErrors.time = parsedTime.error
      else if (preferredAt.getTime() <= Date.now()) {
        nextErrors.date = 'Choose a future date and time in Budapest.'
      }
    }
    if (!form.address.trim()) {
      nextErrors.address = 'Please enter the cleaning address.'
    } else if (form.address.trim().length > 300) {
      nextErrors.address = 'Use no more than 300 characters.'
    }
    if (form.notes.length > 1000) {
      nextErrors.notes = 'Use no more than 1,000 characters.'
    }
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length > 0) {
      setPreview(null)
      return
    }
    submittingBooking.current = true
    setBookingBusy(true)
    try {
      const data = await accountMutation('/api/bookings', {
        serviceId: form.serviceId,
        preferredAt: preferredAt.toISOString(),
        address: form.address.trim(),
        notes: form.notes.trim(),
      })
      if (!data.booking?.id) throw new Error('The booking response was incomplete.')
      setPreview({
        id: data.booking.id,
        service: data.booking.serviceNameSnapshot,
        preferredAt: formatServiceTime(data.booking.preferredAt),
        address: data.booking.address,
        notes: data.booking.notes,
      })
      setForm({ serviceId: '', date: '', time: '', address: '', notes: '' })
      setBookingsRefresh((value) => value + 1)
    } catch (error) {
      const fields = { ...(error.fields || {}) }
      if (fields.preferredAt) fields.date = fields.preferredAt
      setErrors(fields)
      if (error.status === 401) {
        setUser(null)
        setAuthMessage('Your session expired. Please sign in again.')
      }
      setBookingError(error.status
        ? error.message
        : 'The submission result could not be confirmed. Refresh My Bookings before submitting again to avoid a duplicate request.')
      if (error.code === 'SERVICE_UNAVAILABLE') setCatalogueAttempt((value) => value + 1)
    } finally {
      submittingBooking.current = false
      setBookingBusy(false)
    }
  }
  function fieldError(name) {
    return errors[name] ? (
      <p id={`${name}-error`} className="mt-2 text-sm text-red-700">
        {errors[name]}
      </p>
    ) : null
  }
  function accessibility(name) {
    return {
      'aria-invalid': Boolean(errors[name]),
      'aria-describedby': errors[name] ? `${name}-error` : undefined,
    }
  }
  const isAdmin = user?.role === 'admin'
  const busy = adminBusy || bookingBusy || authBusy
  const navItem = (target, label, icon) => <button type="button" key={target} disabled={busy} onClick={() => navigate(target)} aria-current={page === target ? 'page' : undefined} className={`nav-item ${page === target ? 'active' : ''}`}><Icon name={icon} /><span>{label}</span></button>
  return (
    <div className={`sweeplune-app ${isAdmin ? 'admin-layout' : ''}`} onClick={followLink}>
      <a className="skip-link" href="#main-content" onClick={(event) => { event.preventDefault(); document.getElementById('main-content')?.focus() }}>Skip to content</a>
      {isAdmin ? (
        <aside className="admin-sidebar">
          <a href="#admin" className="brand"><img src={logo} alt="" /><span>Sweeplune<small>MANAGEMENT STUDIO</small></span></a>
          <p className="sidebar-label">WORKSPACE</p>
          <nav aria-label="Admin navigation">
            {navItem('admin', 'Bookings', 'calendar')}
            {navItem('admin-services', 'Services', 'grid')}
            {navItem('services', 'View catalogue', 'home')}
            {navItem('account', 'My account', 'user')}
          </nav>
          <div className="sidebar-note"><Icon name="spark" size={26} /><strong>A little order.<br />A lot more clarity.</strong><p>Manage services and keep every request moving.</p></div>
          <div className="sidebar-profile"><span className="avatar">{user.name?.slice(0,1).toUpperCase()}</span><div><strong>{user.name}</strong><small>Administrator</small></div></div>
        </aside>
      ) : (
        <header className="site-header">
          <a href="#" className="brand"><img src={logo} alt="" /><span>Sweeplune<small>A LITTLE CLEANER. A LITTLE CALMER.</small></span></a>
          <nav aria-label="Main navigation">{navItem('home', 'Home', 'home')}{navItem('services', 'Services', 'grid')}{user?.role === 'customer' && navItem('history', 'My bookings', 'calendar')}</nav>
          <div className="header-actions"><button type="button" disabled={busy} onClick={() => navigate('account')} className="account-link"><Icon name="user" />{user ? user.name.split(' ')[0] : 'Sign in'}</button><button type="button" disabled={busy} onClick={() => navigate('booking')} className="primary-button">Book a clean <Icon name="arrow" size={17} /></button></div>
        </header>
      )}
      <main id="main-content" tabIndex={-1} className="app-main">
        {isAdmin && <div className="workspace-top"><span>Workspace <span className="breadcrumb-divider">/</span> {page === 'admin' ? 'Bookings' : page === 'admin-services' ? 'Services' : page === 'account' ? 'Account' : 'Catalogue'}</span><span className="timezone-label"><Icon name="clock" size={16} /> Budapest time</span></div>}
        {checkingSession && <p role="status" className="session-banner">Checking your session…</p>}
        {sessionError && page !== 'account' && <p role="alert" className="session-banner">{sessionError} <a href="#account">Try again</a></p>}
        <div hidden={page !== 'home' || isAdmin}>
          <section className="home-hero">
            <div className="hero-copy"><p className="eyebrow"><span className="live-dot" /> CLEANING, WITH A PERSONAL TOUCH</p><h1>A cleaner home.<br />A <em>lighter</em> day.</h1><p className="hero-description">Leave the cleaning on your to-do list to us. Find your service, request a time, and get back to what matters.</p><div className="hero-actions"><a href="#booking" className="primary-button">Find your fresh start <Icon name="arrow" /></a><a href="#services" className="text-link">Explore services ↗</a></div><div className="hero-points"><span><Icon name="check" size={16} /> Simple booking</span><span><Icon name="check" size={16} /> Clear status updates</span></div></div>
            <RoomIllustration />
          </section>
          <div className="process-strip"><div><span>01</span><p><strong>Choose your clean</strong><small>Find the right fit for your space.</small></p></div><div><span>02</span><p><strong>Make a request</strong><small>Pick a preferred date and time.</small></p></div><div><span>03</span><p><strong>We confirm the details</strong><small>Track updates in your account.</small></p></div></div>
        </div>
        <div hidden={page !== 'account'} className="account-layout"><div className="account-intro"><p className="eyebrow">WELCOME HOME</p><h1>A little less<br />on your list.</h1><p>Your next clean and every booking update, all in one place.</p><div className="account-emblem"><img src={logo} alt="Sweeplune" /></div></div>
        <section id="account" className="mt-14 scroll-mt-6 rounded-2xl border border-slate-200 bg-white p-6 sm:p-8">
          <p className="eyebrow">Your Sweeplune space</p><h2 className="text-2xl font-bold">{user ? 'Your account' : 'Welcome to Sweeplune'}</h2>
          {checkingSession ? (
            <p role="status" className="mt-4 text-slate-600">Checking your session…</p>
          ) : sessionError ? (
            <div className="mt-4">
              <p role="alert" className="text-red-700">{sessionError}</p>
              <button type="button" className="mt-3 rounded-lg border px-4 py-2" onClick={() => setSessionAttempt((attempt) => attempt + 1)}>Try again</button>
            </div>
          ) : user ? (
            <div className="mt-4">
              <p className="text-slate-700">Signed in as <strong>{user.name}</strong></p>
              <p className="mt-1 break-words text-sm text-slate-600">{user.email} · {user.role}</p>
              <button type="button" disabled={authBusy || bookingBusy || adminBusy} onClick={logout} className="mt-5 rounded-xl border border-slate-300 px-5 py-3 font-medium disabled:opacity-50">
                {authBusy ? 'Signing out…' : 'Sign out'}
              </button>
            </div>
          ) : (
            <>
              <div className="mt-5 flex gap-3" aria-label="Account options">
                <button type="button" disabled={authBusy || bookingBusy || adminBusy} aria-pressed={authMode === 'login'} onClick={() => changeAuthMode('login')} className={`rounded-lg px-4 py-2 ${authMode === 'login' ? 'bg-teal-700 text-white' : 'bg-slate-100'}`}>Sign in</button>
                <button type="button" disabled={authBusy || bookingBusy || adminBusy} aria-pressed={authMode === 'register'} onClick={() => changeAuthMode('register')} className={`rounded-lg px-4 py-2 ${authMode === 'register' ? 'bg-teal-700 text-white' : 'bg-slate-100'}`}>Register</button>
              </div>
              <form onSubmit={submitAccount} noValidate className="mt-6 max-w-lg space-y-5">
                <fieldset disabled={authBusy || bookingBusy || adminBusy} className="space-y-5">
                  <legend className="sr-only">{authMode === 'register' ? 'Create an account' : 'Sign in to your account'}</legend>
                  {(authMode === 'register' ? ['name', 'email', 'password'] : ['email', 'password']).map((name) => (
                    <div key={name}>
                      <label htmlFor={`auth-${name}`} className="font-medium">{name === 'name' ? 'Full name' : name === 'email' ? 'Email address' : 'Password'}</label>
                      <input id={`auth-${name}`} name={name} type={name === 'name' ? 'text' : name} value={account[name]} onChange={updateAccount} required maxLength={name === 'name' ? 100 : name === 'email' ? 254 : 128} autoComplete={name === 'password' ? (authMode === 'register' ? 'new-password' : 'current-password') : name === 'name' ? 'name' : 'username'} className={inputStyle} aria-invalid={Boolean(authErrors[name])} aria-describedby={authErrors[name] ? `auth-${name}-error` : name === 'password' && authMode === 'register' ? 'password-help' : undefined} />
                      {name === 'password' && authMode === 'register' && <p id="password-help" className="mt-2 text-sm text-slate-600">Use 12–128 characters.</p>}
                      {authErrors[name] && <p id={`auth-${name}-error`} className="mt-2 text-sm text-red-700">{authErrors[name]}</p>}
                    </div>
                  ))}
                  <button type="submit" className="rounded-xl bg-teal-700 px-6 py-3 font-semibold text-white hover:bg-teal-800 disabled:opacity-50">
                    {authBusy ? 'Please wait…' : authMode === 'register' ? 'Create account' : 'Sign in'}
                  </button>
                </fieldset>
              </form>
            </>
          )}
          {authError && <p role="alert" className="mt-4 text-red-700">{authError}</p>}
          {authMessage && <p role="status" className="mt-4 text-teal-800">{authMessage}</p>}
        </section>
        </div>
        {isAdmin && <div hidden={page !== 'admin'}><AdminDashboard key={`bookings-${user.id}`} onBusyChange={setAdminBusy} disabled={adminBusy || authBusy} /></div>}
        {isAdmin && <div hidden={page !== 'admin-services'}><AdminServices key={`services-${user.id}`} onBusyChange={setAdminBusy} disabled={adminBusy || authBusy} onCatalogueChange={() => setCatalogueAttempt((value) => value + 1)} /></div>}
        <div hidden={!['home', 'services'].includes(page)}>
        <section id="services" className="mt-14 scroll-mt-6">
          <div className="section-heading"><div><p className="eyebrow">A clean for every space</p><h2>What can we help with?</h2></div><p>Everyday upkeep or a fresh start.<br />Choose the service that fits.</p></div>
          {loadingServices && (
            <p role="status" className="mt-4 text-slate-600">Loading services…</p>
          )}
          {serviceError && (
            <div className="mt-4 rounded-xl bg-red-50 p-4">
              <p role="alert" className="text-red-700">{serviceError}</p>
              <button
                type="button"
                onClick={() => setCatalogueAttempt((attempt) => attempt + 1)}
                className="mt-3 rounded-lg border border-red-700 px-4 py-2 text-red-700 focus-visible:outline-2 focus-visible:outline-offset-2"
              >
                Try again
              </button>
            </div>
          )}
          {!loadingServices && !serviceError && services.length === 0 && (
            <p role="status" className="mt-4 text-slate-600">No services are currently available.</p>
          )}
          <div className="mt-6 grid gap-5 md:grid-cols-3">
            {services.map((service) => (
              <article
                key={service.id}
                className="service-card"
              >
                <div className="service-symbol"><Icon name={service.name.toLowerCase().includes('office') ? 'grid' : service.name.toLowerCase().includes('deep') ? 'spark' : 'home'} size={28} /></div><h3 className="text-xl font-semibold">{service.name}</h3>
                <p className="mt-3 flex-1 leading-7 text-slate-600">
                  {service.description}
                </p>
                <button
                  type="button"
                  onClick={() => selectService(service.id)}
                  className="mt-6 rounded-xl bg-teal-700 px-4 py-3 font-medium text-white hover:bg-teal-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700"
                >
                  Choose this service ↗
                </button>
              </article>
            ))}
          </div>
        </section>
        </div>
        <div hidden={page !== 'booking'} className="booking-layout"><aside className="booking-guide"><p className="eyebrow">YOUR NEXT CLEAN</p><h1>Let's make<br />space for you.</h1><p>Tell us what you need. We'll review your request and confirm availability.</p><ol><li><span>1</span> Choose your service</li><li><span>2</span> Share the details</li><li><span>3</span> Receive confirmation</li></ol><div className="booking-timezone"><Icon name="clock" /><div><strong>One place. One time zone.</strong><p>All appointments use Budapest time, wherever you book from.</p></div></div></aside>
        <section
          id="booking"
          className="mt-14 scroll-mt-6 rounded-2xl border border-slate-200 bg-white p-6 sm:p-8"
        >
          <p className="eyebrow">Make room for a fresh start</p><h2 className="text-2xl font-bold">Request your cleaning</h2>
          <p className="mt-2 text-slate-600">
            Your preferred time is a request, not a confirmed appointment.
          </p>
          <p className="mt-4 rounded-xl bg-amber-50 p-4 text-sm text-amber-900">
            Requests are saved as pending and require administrator confirmation.
            Enter dates and times in Budapest time (Europe/Budapest), regardless of your device’s time zone.
            {!user && <> <a href="#account" className="font-semibold underline">Sign in</a> to submit a request.</>}
          </p>
          {bookingError && <p role="alert" className="mt-4 text-red-700">{bookingError}</p>}
          <form onSubmit={submitBooking} noValidate className="mt-6 space-y-5">
            <fieldset disabled={bookingBusy || authBusy} className="space-y-5">
              <legend className="sr-only">Cleaning booking details</legend>
            <div>
              <label htmlFor="serviceId" className="font-medium">
                Service
              </label>
              <select
                disabled={catalogueUnavailable}
                id="serviceId"
                name="serviceId"
                value={form.serviceId}
                onChange={updateField}
                className={inputStyle}
                required
                {...accessibility('serviceId')}
              >
                <option value="">Choose a service</option>
                {services.map((service) => (
                  <option key={service.id} value={service.id}>
                    {service.name}
                  </option>
                ))}
              </select>
              {fieldError('serviceId')}
            </div>
            <div className="grid gap-5 sm:grid-cols-2">
              <div>
                <label htmlFor="date" className="font-medium">
                  Preferred date (Budapest)
                </label>
                <input
                  id="date"
                  name="date"
                  type="date"
                  value={form.date}
                  onChange={updateField}
                  className={inputStyle}
                  required
                  {...accessibility('date')}
                />
                {fieldError('date')}
              </div>
              <div>
                <label htmlFor="time" className="font-medium">
                  Preferred time (Budapest)
                </label>
                <input
                  id="time"
                  name="time"
                  type="time"
                  value={form.time}
                  onChange={updateField}
                  className={inputStyle}
                  required
                  {...accessibility('time')}
                />
                {fieldError('time')}
              </div>
            </div>
            <div>
              <label htmlFor="address" className="font-medium">
                Cleaning address
              </label>
              <textarea
                id="address"
                name="address"
                value={form.address}
                onChange={updateField}
                rows={3}
                maxLength={300}
                autoComplete="street-address"
                className={inputStyle}
                required
                {...accessibility('address')}
              />
              {fieldError('address')}
            </div>
            <div>
              <label htmlFor="notes" className="font-medium">
                Additional instructions (optional)
              </label>
              <textarea
                id="notes"
                name="notes"
                value={form.notes}
                onChange={updateField}
                rows={3}
                maxLength={1000}
                className={inputStyle}
                {...accessibility('notes')}
              />
              {fieldError('notes')}
            </div>
            <button
              disabled={catalogueUnavailable || bookingBusy || authBusy || checkingSession || user?.role !== 'customer'}
              type="submit"
              className="disabled:cursor-not-allowed disabled:opacity-50 rounded-xl bg-teal-700 px-6 py-3 font-semibold text-white hover:bg-teal-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700"
            >
              {bookingBusy ? 'Submitting…' : 'Submit booking request'}
            </button>
            </fieldset>
          </form>
          {preview && (
            <div
              role="status"
              className="mt-6 rounded-xl border border-teal-200 bg-teal-50 p-5"
            >
              <h3 className="font-semibold">Booking saved — pending confirmation</h3>
              <p className="mt-2 break-all text-sm">Reference: {preview.id}</p>
              <dl className="mt-3 space-y-3 text-sm">
                <div>
                  <dt className="font-semibold">Service</dt>
                  <dd>{preview.service}</dd>
                </div>
                <div>
                  <dt className="font-semibold">Preferred date and time</dt>
                  <dd>{preview.preferredAt}</dd>
                </div>
                <div>
                  <dt className="font-semibold">Address</dt>
                  <dd className="whitespace-pre-wrap break-words">
                    {preview.address}
                  </dd>
                </div>
                {preview.notes && (
                  <div>
                    <dt className="font-semibold">Instructions</dt>
                    <dd className="whitespace-pre-wrap break-words">
                      {preview.notes}
                    </dd>
                  </div>
                )}
              </dl>
            </div>
          )}
        </section>
        </div>
        {user?.role === 'customer' && <div hidden={page !== 'history'}><div className="page-heading"><p className="eyebrow">YOUR CLEANING JOURNEY</p><h1>A little peace of mind.</h1><p>Follow your requests from the first hello to the final clean.</p></div><MyBookings key={user.id} refreshKey={bookingsRefresh} /></div>}
        {page === 'home' && !isAdmin && <section className="closing-banner"><Icon name="spark" size={34} /><div><h2>Less cleaning. More living.</h2><p>Make your next fresh start a simple one.</p></div><a href="#booking" className="primary-button">Request a cleaning <Icon name="arrow" /></a></section>}
      </main>
      <footer className="site-footer"><strong>Sweeplune</strong><p>Fresh spaces. Lighter days.</p><span>Cleaning services · Budapest</span></footer>
    </div>
  )
}
