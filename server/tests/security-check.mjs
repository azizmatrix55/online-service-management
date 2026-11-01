import { randomBytes } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { createInterface } from 'node:readline/promises'
import { Writable } from 'node:stream'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

// HTTP integration checks against the user's running LOCAL development server.
// No database access, external packages, credential files, or existing-record writes.
export class ApiClient {
  constructor(base, origin) { this.base = base; this.origin = origin; this.cookies = new Map(); this.token = null }
  async request(path, { method = 'GET', body, csrf = true, origin = this.origin } = {}) {
    const headers = { Accept: 'application/json' }
    if (this.cookies.size) headers.Cookie = [...this.cookies].map(([key,value]) => `${key}=${value}`).join('; ')
    if (method !== 'GET') {
      headers.Origin = origin
      headers['Content-Type'] = 'application/json'
      if (csrf && this.token) headers['X-CSRF-Token'] = this.token
    }
    const response = await fetch(new URL(path, this.base), {
      method, headers, body: body === undefined ? undefined : JSON.stringify(body),
      redirect: 'error', signal: AbortSignal.timeout(15000),
    })
    for (const cookie of response.headers.getSetCookie()) {
      const pair = cookie.split(';', 1)[0]; const at = pair.indexOf('=')
      if (at > 0) {
        const key = pair.slice(0, at), value = pair.slice(at + 1)
        if (!value || /max-age=0|expires=Thu, 01 Jan 1970/i.test(cookie)) this.cookies.delete(key)
        else this.cookies.set(key, value)
      }
    }
    const text = await response.text()
    let data
    try { data = JSON.parse(text) } catch { throw new Error(`Non-JSON HTTP ${response.status} at ${path}. Check the API address.`) }
    return { status: response.status, data }
  }
  async csrf() {
    const response = await this.request('/api/auth/csrf')
    if (response.status !== 200 || typeof response.data.csrfToken !== 'string') throw new Error('Could not obtain a CSRF token. Check rate limits and server availability.')
    this.token = response.data.csrfToken
  }
  async mutate(path, body, method = 'POST', options = {}) {
    await this.csrf()
    return this.request(path, { method, body, ...options })
  }
}

async function askCredentials() {
  if (!process.stdin.isTTY) throw new Error('Run interactively in the VS Code terminal so the admin password can be entered privately.')
  let muted = false
  const output = new Writable({ write(chunk, encoding, done) { if (!muted) process.stdout.write(chunk, encoding); done() } })
  const prompt = createInterface({ input: process.stdin, output, terminal: true })
  try {
    const email = (await prompt.question('Existing admin email: ')).trim()
    process.stdout.write('Admin password (hidden while typing): ')
    muted = true
    const password = await prompt.question('')
    muted = false; process.stdout.write('\n')
    return { email, password }
  } finally { muted = false; prompt.close() }
}

export async function runChecks({ base, origin, credentials }) {
  const baseUrl = new URL(base)
  if (!['localhost','127.0.0.1','[::1]'].includes(baseUrl.hostname) || baseUrl.protocol !== 'http:' || baseUrl.username || baseUrl.password) {
    throw new Error('Use a local HTTP development API. This script is not intended for production.')
  }
  const startedAt = new Date().toISOString()
  const marker = `SECURITY-TEST-${Date.now()}-${randomBytes(3).toString('hex')}`
  const report = { marker, startedAt, baseUrl: baseUrl.origin, appOrigin: origin,
    environment: { node: process.version, platform: process.platform },
    scope: 'HTTP integration checks; not a complete penetration test or performance benchmark.',
    tests: [], fixtures: { serviceId: null, customerId: null, bookingIds: [] }, cleanup: [] }
  const admin = new ApiClient(baseUrl, origin), customer = new ApiClient(baseUrl, origin)
  let service
  function record(name, expected, actual, passed) {
    report.tests.push({ name, expected, actual, passed })
    console.log(`${passed ? 'PASS' : 'FAIL'}  ${name} (${actual})`)
    return passed
  }
  function expect(name, response, status, code, extra = true) {
    return record(name, `HTTP ${status}${code ? ` ${code}` : ''}`,
      `HTTP ${response.status}${response.data.code ? ` ${response.data.code}` : ''}`,
      response.status === status && (!code || response.data.code === code) && extra)
  }
  function required(response, status, key) {
    if (response.status !== status || (key && !response.data[key]?.id)) throw new Error(`Setup or required transition failed: expected HTTP ${status}, got ${response.status}.`)
    return key ? response.data[key] : response.data
  }
  async function allItems(client, path, key) {
    const items = []
    for (let page = 1; page <= 100; page++) {
      const response = await client.request(`${path}?page=${page}&limit=100`)
      if (response.status !== 200 || !Array.isArray(response.data[key])) throw new Error(`Could not read ${key} for persistence verification.`)
      items.push(...response.data[key])
      if (!response.data.hasMore) return items
    }
    throw new Error('Pagination exceeded the test script limit.')
  }
  async function savedBooking(id) {
    const item = (await allItems(admin, '/api/admin/bookings', 'bookings')).find(item => item.id === id)
    if (!item) throw new Error('Test booking was missing during persistence verification.')
    return item
  }
  try {
    const health = await admin.request('/api/health')
    required(health, 200)
    if (health.data.database !== 'connected') throw new Error('The API does not report a connected database.')
    const login = await admin.mutate('/api/auth/login', credentials)
    required(login, 200)
    if (login.data.user?.role !== 'admin') throw new Error('The supplied account is not an administrator.')
    admin.token = login.data.csrfToken
    credentials.password = ''
    const password = randomBytes(24).toString('hex')
    const email = `${marker.toLowerCase()}@example.test`
    const registration = await customer.mutate('/api/auth/register', { name: marker, email, password })
    const account = required(registration, 201, 'user')
    report.fixtures.customerId = account.id
    required(await customer.mutate('/api/auth/login', { email, password }), 200)
    service = required(await admin.mutate('/api/admin/services', {
      name: marker, description: 'Fictional service created by security-check.mjs.', isActive: true,
    }), 201, 'service')
    report.fixtures.serviceId = service.id
    const valid = { serviceId: service.id, preferredAt: new Date(Date.now() + 30 * 86400000).toISOString(),
      address: `${marker} — fictional test address`, notes: 'Automated local test record.' }
    for (const [label, changes] of [
      ['Empty address', { address: '   ' }], ['Address too long', { address: 'x'.repeat(301) }],
      ['Notes too long', { notes: 'x'.repeat(1001) }], ['Notes with wrong type', { notes: { text: 'invalid' } }],
      ['Past appointment', { preferredAt: '2020-01-01T10:00:00Z' }],
      ['Invalid calendar date', { preferredAt: '2099-02-30T10:00:00Z' }],
      ['Timestamp without offset', { preferredAt: '2099-01-15T10:00:00' }],
      ['Malformed service ID', { serviceId: 'invalid-id' }],
      ['Client-supplied booking status', { status: 'completed' }],
      ['Client-supplied customer identity', { customerId: '000000000000000000000000' }],
    ]) {
      expect(label, await customer.mutate('/api/bookings', { ...valid, ...changes }), 400, 'VALIDATION_FAILED')
    }
    expect('Nonexistent service', await customer.mutate('/api/bookings', { ...valid, serviceId: '000000000000000000000000' }), 400, 'SERVICE_UNAVAILABLE')
    await customer.csrf()
    expect('Missing CSRF token', await customer.request('/api/bookings', { method:'POST', body:valid, csrf:false }), 403, 'CSRF_REJECTED')
    const realToken = customer.token
    customer.token = 'invalid-token'
    expect('Incorrect CSRF token', await customer.request('/api/bookings', { method:'POST', body:valid }), 403, 'CSRF_REJECTED')
    customer.token = realToken
    expect('Incorrect Origin with valid token', await customer.request('/api/bookings', { method:'POST', body:valid, origin:'https://untrusted.example' }), 403, 'CSRF_REJECTED')
    const before = await allItems(customer, '/api/bookings', 'bookings')
    record('Rejected requests created no bookings', '0 bookings for the new test customer', `${before.length} bookings`, before.length === 0)
    if (before.length) throw new Error('An invalid request created a booking. Stop and investigate before continuing.')

    const created = await customer.mutate('/api/bookings', valid)
    const booking = required(created, 201, 'booking')
    report.fixtures.bookingIds.push(booking.id)
    expect('Valid request persists as pending', created, 201, null, booking.status === 'pending')
    const saved = await savedBooking(booking.id)
    record('Saved booking has trusted identity and snapshot', 'test customer, test service, pending, initial history',
      'Read from admin booking list', saved.customerId === account.id && saved.serviceId === service.id &&
      saved.serviceNameSnapshot === marker && saved.status === 'pending' && saved.statusHistory?.length === 1)
    const statusPath = `/api/admin/bookings/${booking.id}/status`
    expect('Customer cannot update booking status', await customer.mutate(statusPath, {status:'confirmed',expectedVersion:saved.version}, 'PATCH'), 403, 'ADMIN_REQUIRED')
    expect('Pending cannot become completed', await admin.mutate(statusPath, {status:'completed',expectedVersion:saved.version}, 'PATCH'), 400, 'INVALID_TRANSITION')
    expect('Status update requires version', await admin.mutate(statusPath, {status:'confirmed'}, 'PATCH'), 400, 'VALIDATION_FAILED')
    const afterRejected = await savedBooking(booking.id)
    record('Rejected transitions did not change the record', 'same pending status, version and history',
      `status=${afterRejected.status}; version=${afterRejected.version}`, afterRejected.status === 'pending' &&
      afterRejected.version === saved.version && afterRejected.statusHistory.length === saved.statusHistory.length)

    // Obtain one token before concurrent writes to avoid parallel CSRF session saves.
    await admin.csrf()
    const decisions = await Promise.all([0,1].map(() => admin.request(statusPath, {
      method:'PATCH', body:{status:'confirmed',expectedVersion:saved.version},
    })))
    const statuses = decisions.map(item => item.status).sort((a,b) => a-b)
    record('Concurrent decisions accept exactly one update', 'HTTP 200 and HTTP 409 BOOKING_CONFLICT',
      statuses.join(', '), statuses[0] === 200 && statuses[1] === 409 &&
      decisions.find(item => item.status === 409)?.data.code === 'BOOKING_CONFLICT')
    const confirmed = await savedBooking(booking.id)
    record('Concurrent update appends exactly one history entry', 'confirmed; version +1; history +1',
      `status=${confirmed.status}; version=${confirmed.version}; history=${confirmed.statusHistory.length}`,
      confirmed.status === 'confirmed' && confirmed.version === saved.version + 1 && confirmed.statusHistory.length === saved.statusHistory.length + 1)
    if (confirmed.status !== 'confirmed') throw new Error('Expected a confirmed test booking after the concurrent update.')
    const completed = await admin.mutate(statusPath, {status:'completed',expectedVersion:confirmed.version}, 'PATCH')
    required(completed, 200, 'booking')
    expect('Confirmed can become completed', completed, 200, null, completed.data.booking.status === 'completed')
    expect('Completed booking cannot reopen', await admin.mutate(statusPath, {
      status:'pending',expectedVersion:completed.data.booking.version,
    }, 'PATCH'), 400, 'INVALID_TRANSITION')
    service = required(await admin.mutate(`/api/admin/services/${service.id}`, {
      isActive:false, expectedVersion:service.version,
    }, 'PATCH'), 200, 'service')
    const catalogue = await customer.request('/api/services')
    record('Deactivated test service is hidden from catalogue', 'test service absent',
      `HTTP ${catalogue.status}`, catalogue.status === 200 && Array.isArray(catalogue.data) && !catalogue.data.some(item => item.id === service.id))
    expect('Inactive service cannot be booked', await customer.mutate('/api/bookings',valid), 400, 'SERVICE_UNAVAILABLE')
    const finalBookings = await allItems(customer, '/api/bookings', 'bookings')
    record('Customer history retains the completed booking', 'one completed test booking with original label',
      `${finalBookings.length} bookings`, finalBookings.length === 1 && finalBookings[0].id === booking.id &&
      finalBookings[0].status === 'completed' && finalBookings[0].serviceNameSnapshot === marker)
  } catch (error) {
    report.error = error.message
    console.error(`STOP: ${error.message}`)
  } finally {
    // Only the IDs returned when this run created fixtures may be changed here.
    if (service) {
      try {
        const current = (await allItems(admin, '/api/admin/services', 'services')).find(item => item.id === service.id)
        if (!current) throw new Error('Test service not found during cleanup.')
        if (current.isActive) required(await admin.mutate(`/api/admin/services/${service.id}`, {
          isActive:false,expectedVersion:current.version,
        }, 'PATCH'),200,'service')
        report.cleanup.push('This run’s test service is inactive.')
      } catch { report.cleanup.push('Could not verify test service deactivation; check the fixture service ID manually.') }
    }
    for (const id of report.fixtures.bookingIds) {
      try {
        const current = await savedBooking(id)
        if (['pending','confirmed'].includes(current.status)) required(await admin.mutate(`/api/admin/bookings/${id}/status`, {
          status:'cancelled',expectedVersion:current.version,
        }, 'PATCH'),200,'booking')
        report.cleanup.push(`Test booking ${id} is closed (completed or cancelled).`)
      } catch { report.cleanup.push(`Could not close test booking ${id}; review it manually.`) }
    }
    for (const client of [customer, admin]) {
      try { await client.mutate('/api/auth/logout', {}) } catch { /* May be unavailable after a startup failure. */ }
    }
  }
  report.finishedAt = new Date().toISOString()
  report.summary = { passed:report.tests.filter(test => test.passed).length, failed:report.tests.filter(test => !test.passed).length,
    aborted:Boolean(report.error) }
  const directory = resolve('test-results', marker)
  await mkdir(directory,{recursive:true})
  await writeFile(resolve(directory,'results.json'),JSON.stringify(report,null,2)+'\n')
  const cell = text => String(text).replaceAll('|','/').replaceAll('\n',' ')
  const markdown = `# Sweeplune local API verification\n\nRun: ${marker}\n\nStarted: ${startedAt}\n\nAPI: ${baseUrl.origin}\n\nNode: ${process.version}; platform: ${process.platform}\n\n${report.scope}\n\nPassed: ${report.summary.passed}; failed: ${report.summary.failed}; aborted: ${report.summary.aborted}.\n\n`+
    '| Test | Expected | Actual | Result |\n|---|---|---|---|\n'+report.tests.map(test => `| ${cell(test.name)} | ${cell(test.expected)} | ${cell(test.actual)} | ${test.passed?'PASS':'FAIL'} |`).join('\n')+
    `\n\n${report.error ? `Run stopped: ${report.error}\n\n` : ''}## Test data\n\n`+
    'This run creates one customer, one service, and normally one booking. Records remain for traceability; there is no hard-delete API. The generated customer password is not stored or reported.\n\n'+
    report.cleanup.map(item=>`- ${item}`).join('\n')+'\n'
  await writeFile(resolve(directory,'results.md'),markdown)
  console.log(`\nPassed: ${report.summary.passed}; failed: ${report.summary.failed}; aborted: ${report.summary.aborted}`)
  console.log(`Reports saved to: ${directory}`)
  if (report.summary.failed || report.summary.aborted || report.cleanup.some(item=>item.startsWith('Could not'))) process.exitCode=1
  return report
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  console.log('Sweeplune local integration checks\nCreates labelled test records. Existing bookings and services are not modified.\nKeep the backend running. Enter an existing administrator account below.\n')
  try {
    const base = process.env.TEST_BASE_URL || 'http://localhost:3000'
    const origin = new URL(process.env.TEST_APP_ORIGIN || 'http://localhost:5173').origin
    // Validate the destination before requesting credentials.
    const url = new URL(base)
    if (!['localhost','127.0.0.1','[::1]'].includes(url.hostname) || url.protocol !== 'http:' || url.username || url.password) throw new Error('TEST_BASE_URL must be a local HTTP URL.')
    await runChecks({base,origin,credentials:await askCredentials()})
  } catch (error) { console.error(`Unable to run: ${error.message}`);process.exitCode=1 }
}
