import { useEffect, useRef, useState } from 'react'
import logo from './assets/sweeplune-logo.png'

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

async function accountMutation(path, body) {
  const { csrfToken } = await accountRequest('/api/auth/csrf')
  return accountRequest(path, {
    method: 'POST',
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
                  <span className="rounded-full bg-slate-100 px-3 py-1 text-sm capitalize">{booking.status}</span>
                </div>
                <p className="mt-3 text-sm text-slate-600">Preferred time: {new Date(booking.preferredAt).toLocaleString()}</p>
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

export default function App() {
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
        if (!controller.signal.aborted) setUser(data.user)
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
    if (authBusy || submittingBooking.current) return
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
    if (authBusy || submittingBooking.current) return
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
    document.getElementById('booking').scrollIntoView({
      behavior: 'smooth',
    })
  }

  async function submitBooking(event) {
    event.preventDefault()

    if (catalogueUnavailable || submittingBooking.current || authBusy) return
    setBookingError('')
    setPreview(null)
    if (!user || user.role !== 'customer') {
      setBookingError('Sign in with a customer account before submitting a booking.')
      document.getElementById('account').scrollIntoView({ behavior: 'smooth' })
      return
    }

    const nextErrors = {}
    const selectedService = services.find(
      (service) => service.id === form.serviceId,
    )
    const preferredAt = new Date(`${form.date}T${form.time}`)

    if (!selectedService) {
      nextErrors.serviceId = 'Please select a service.'
    }

    if (!form.date) nextErrors.date = 'Please choose a date.'
    if (!form.time) nextErrors.time = 'Please choose a time.'

    if (
      form.date &&
      form.time &&
      (Number.isNaN(preferredAt.getTime()) ||
        preferredAt.getTime() <= Date.now())
    ) {
      nextErrors.date = 'Choose a future date and time.'
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
        preferredAt: new Date(data.booking.preferredAt).toLocaleString(),
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

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <nav
          aria-label="Main navigation"
          className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-6 py-5"
        >
          <a href="#" aria-label="Sweeplune home" className="shrink-0">
                <img src={logo} alt="Sweeplune" className="h-24 w-auto object-contain" />
          </a>
          <div className="flex flex-wrap gap-6 text-sm font-medium">
            <a href="#account" className="hover:text-teal-700">{user ? 'My account' : 'Sign in / Register'}</a>
            {user?.role === 'customer' && <a href="#my-bookings" className="hover:text-teal-700">My Bookings</a>}
            <a href="#services" className="hover:text-teal-700">
              Services
            </a>
            <a href="#booking" className="hover:text-teal-700">
              Request cleaning
            </a>
          </div>
        </nav>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-12">
        <section className="max-w-2xl">
          <p className="text-sm font-semibold uppercase tracking-widest text-teal-700">
            A cleaner space starts here
          </p>
          <h1 className="mt-4 text-4xl font-bold tracking-tight sm:text-5xl">
            Cleaning that fits your space.
          </h1>
          <p className="mt-5 text-lg leading-8 text-slate-600">
            Explore our services and request your preferred cleaning time.
            Availability is confirmed after your request is reviewed.
          </p>
        </section>

        <section id="account" className="mt-14 scroll-mt-6 rounded-2xl border border-slate-200 bg-white p-6 sm:p-8">
          <h2 className="text-2xl font-bold">{user ? 'Your account' : 'Welcome to Sweeplune'}</h2>
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
              <button type="button" disabled={authBusy || bookingBusy} onClick={logout} className="mt-5 rounded-xl border border-slate-300 px-5 py-3 font-medium disabled:opacity-50">
                {authBusy ? 'Signing out…' : 'Sign out'}
              </button>
            </div>
          ) : (
            <>
              <div className="mt-5 flex gap-3" aria-label="Account options">
                <button type="button" disabled={authBusy || bookingBusy} aria-pressed={authMode === 'login'} onClick={() => changeAuthMode('login')} className={`rounded-lg px-4 py-2 ${authMode === 'login' ? 'bg-teal-700 text-white' : 'bg-slate-100'}`}>Sign in</button>
                <button type="button" disabled={authBusy || bookingBusy} aria-pressed={authMode === 'register'} onClick={() => changeAuthMode('register')} className={`rounded-lg px-4 py-2 ${authMode === 'register' ? 'bg-teal-700 text-white' : 'bg-slate-100'}`}>Register</button>
              </div>
              <form onSubmit={submitAccount} noValidate className="mt-6 max-w-lg space-y-5">
                <fieldset disabled={authBusy || bookingBusy} className="space-y-5">
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

        <section id="services" className="mt-14 scroll-mt-6">
          <h2 className="text-2xl font-bold">Our services</h2>
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
                className="flex flex-col rounded-2xl border border-slate-200 bg-white p-6"
              >
                <h3 className="text-xl font-semibold">{service.name}</h3>
                <p className="mt-3 flex-1 leading-7 text-slate-600">
                  {service.description}
                </p>
                <button
                  type="button"
                  onClick={() => selectService(service.id)}
                  className="mt-6 rounded-xl bg-teal-700 px-4 py-3 font-medium text-white hover:bg-teal-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700"
                >
                  Select service
                </button>
              </article>
            ))}
          </div>
        </section>

        <section
          id="booking"
          className="mt-14 scroll-mt-6 rounded-2xl border border-slate-200 bg-white p-6 sm:p-8"
        >
          <h2 className="text-2xl font-bold">Request a cleaning</h2>
          <p className="mt-2 text-slate-600">
            Your preferred time is a request, not a confirmed appointment.
          </p>
          <p className="mt-4 rounded-xl bg-amber-50 p-4 text-sm text-amber-900">
            Requests are saved as pending and require administrator confirmation.
            Dates and times use your device’s local time zone.
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
                  Preferred date
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
                  Preferred time
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
        {user?.role === 'customer' && <MyBookings key={user.id} refreshKey={bookingsRefresh} />}
      </main>

      <footer className="border-t border-slate-200 px-6 py-6 text-center text-sm text-slate-500">
        Sweeplune · Cleaning service booking and management
      </footer>
    </div>
  )
}