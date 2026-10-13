import { useEffect, useState } from 'react'

const inputStyle =
  'mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/20'

export default function App() {
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
    const { name, value } = event.target
    setForm((previous) => ({ ...previous, [name]: value }))
    setErrors((previous) => ({ ...previous, [name]: undefined }))
    setPreview(null)
  }

  function selectService(serviceId) {
    setForm((previous) => ({ ...previous, serviceId }))
    setErrors((previous) => ({ ...previous, serviceId: undefined }))
    setPreview(null)
    document.getElementById('booking').scrollIntoView({
      behavior: 'smooth',
    })
  }

  function submitPreview(event) {
    event.preventDefault()

    if (catalogueUnavailable) return

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

    setPreview({
      service: selectedService.name,
      preferredAt: preferredAt.toLocaleString(),
      address: form.address.trim(),
      notes: form.notes.trim(),
    })
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
          <a href="#" className="text-2xl font-bold tracking-tight text-teal-700">
            Sweeplune
          </a>
          <div className="flex gap-6 text-sm font-medium">
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
            Prototype: this form does not save or send bookings. Times currently
            use your device’s local time zone.
          </p>

          <form onSubmit={submitPreview} noValidate className="mt-6 space-y-5">
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
              disabled={catalogueUnavailable}
              type="submit"
              className="disabled:cursor-not-allowed disabled:opacity-50 rounded-xl bg-teal-700 px-6 py-3 font-semibold text-white hover:bg-teal-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700"
            >
              Preview request
            </button>
          </form>

          {preview && (
            <div
              role="status"
              className="mt-6 rounded-xl border border-teal-200 bg-teal-50 p-5"
            >
              <h3 className="font-semibold">Request preview — not submitted</h3>
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
      </main>

      <footer className="border-t border-slate-200 px-6 py-6 text-center text-sm text-slate-500">
        Sweeplune · Cleaning service booking and management
      </footer>
    </div>
  )
}