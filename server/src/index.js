import 'dotenv/config'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import express from 'express'
import mongoose from 'mongoose'
import argon2 from 'argon2'
import session from 'express-session'
import MongoStore from 'connect-mongo'
import { rateLimit } from 'express-rate-limit'
import Service from './models/Service.js'
import User from './models/User.js'
import Booking from './models/Booking.js'
const app = express()
const port = Number(process.env.PORT || 3000)
const production = process.env.NODE_ENV === 'production'
const cookieName = 'sweeplune.sid'
const idleLifetime = 30 * 60 * 1000
const absoluteLifetime = 8 * 60 * 60 * 1000
const cookieOptions = {
  httpOnly: true,
  secure: production,
  sameSite: 'lax',
  path: '/',
}
function publicUser(user) {
  return {
    id: user._id.toString(),
    name: user.name,
    email: user.email,
    role: user.role,
  }
}
function sessionAction(req, action) {
  return new Promise((resolve, reject) => {
    req.session[action]((error) => {
      if (error) reject(error)
      else resolve()
    })
  })
}
function validToken(received, expected) {
  if (typeof received !== 'string' || typeof expected !== 'string') {
    return false
  }
  const first = Buffer.from(received)
  const second = Buffer.from(expected)
  return first.length === second.length && timingSafeEqual(first, second)
}
function validateAccount(body, registering) {
  const fields = {}
  const allowed = registering
    ? ['name', 'email', 'password']
    : ['email', 'password']
  if (
    !body ||
    typeof body !== 'object' ||
    Array.isArray(body) ||
    Object.keys(body).some((key) => !allowed.includes(key))
  ) {
    return {
      fields: { form: 'Submit only the permitted account fields.' },
    }
  }
  const email =
    typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  const password = typeof body.password === 'string' ? body.password : ''
  if (
    email.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  ) {
    fields.email = 'Enter a valid email address.'
  }
  if (
    password.length > 128 ||
    password.length < (registering ? 12 : 1)
  ) {
    fields.password = registering
      ? 'Use a password between 12 and 128 characters.'
      : 'Enter your password.'
  }
  const name =
    typeof body.name === 'string' ? body.name.trim() : ''
  if (registering && (name.length < 2 || name.length > 100)) {
    fields.name = 'Use a name between 2 and 100 characters.'
  }
  return { fields, name, email, password }
}
async function startServer() {
  try {
    if (!process.env.MONGODB_URI) {
      throw new Error('MONGODB_URI is missing from server/.env')
    }
    if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
      throw new Error('SESSION_SECRET must contain at least 32 characters')
    }
    if (!process.env.APP_ORIGIN) {
      throw new Error('APP_ORIGIN is missing from server/.env')
    }
    const appOrigin = new URL(process.env.APP_ORIGIN).origin
    await mongoose.connect(process.env.MONGODB_URI, {
      serverSelectionTimeoutMS: 5000,
    })
    // Ensure the unique email index exists before accepting registrations.
    await User.init()
    await Booking.init()
    await Service.init()
    // Used to verify a password even when an email is unknown.
    const dummyHash = await argon2.hash(randomBytes(32).toString('hex'), {
      type: argon2.argon2id,
      memoryCost: 19456,
      timeCost: 2,
      parallelism: 1,
    })
    app.disable('x-powered-by')
    app.use(express.json({ limit: '16kb' }))
    app.get('/api/health', (req, res) => {
      const connected = mongoose.connection.readyState === 1
      res.status(connected ? 200 : 503).json({
        status: connected ? 'ok' : 'unavailable',
        application: 'Sweeplune',
        database: connected ? 'connected' : 'disconnected',
      })
    })
    app.get('/api/services', async (req, res, next) => {
      try {
        const services = await Service.find({ isActive: true })
          .select('_id name description')
          .sort({ name: 1, _id: 1 })
          .lean()
        res.json(
          services.map((service) => ({
            id: service._id.toString(),
            name: service.name,
            description: service.description,
          })),
        )
      } catch (error) {
        next(error)
      }
    })
    const sessionStore = MongoStore.create({
      client: mongoose.connection.getClient(),
      dbName: mongoose.connection.name,
      collectionName: 'sessions',
      ttl: idleLifetime / 1000,
    })
    sessionStore.on('error', () => {
      console.error('Session store error')
    })
    app.use(
      '/api',
      session({
        name: cookieName,
        secret: process.env.SESSION_SECRET,
        store: sessionStore,
        resave: false,
        saveUninitialized: false,
        rolling: true,
        cookie: {
          ...cookieOptions,
          maxAge: idleLifetime,
        },
      }),
    )
    // Expire authenticated sessions after eight hours, even with activity.
    app.use('/api', async (req, res, next) => {
      try {
        if (
          req.session.userId &&
          (!Number.isFinite(req.session.loginAt) ||
            Date.now() - req.session.loginAt >= absoluteLifetime)
        ) {
          await sessionAction(req, 'destroy')
          res.clearCookie(cookieName, cookieOptions)
          return res.status(401).json({
            code: 'SESSION_EXPIRED',
            message: 'Your session expired. Please sign in again.',
          })
        }
        next()
      } catch (error) {
        next(error)
      }
    })
    app.use('/api/auth', (req, res, next) => {
      res.set('Cache-Control', 'no-store')
      next()
    })
    const authLimiter = rateLimit({
      windowMs: 15 * 60 * 1000,
      limit: 20,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      message: {
        code: 'TOO_MANY_ATTEMPTS',
        message: 'Too many attempts. Please try again later.',
      },
    })
    const csrfLimiter = rateLimit({
      windowMs: 15 * 60 * 1000,
      limit: 100,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      message: {
        code: 'TOO_MANY_ATTEMPTS',
        message: 'Too many requests. Please try again later.',
      },
    })
    // The frontend must fetch this before sending a mutation.
    app.get('/api/auth/csrf', csrfLimiter, async (req, res, next) => {
      try {
        if (!req.session.csrfToken) {
          req.session.csrfToken = randomBytes(32).toString('hex')
        }
        await sessionAction(req, 'save')
        res.json({ csrfToken: req.session.csrfToken })
      } catch (error) {
        next(error)
      }
    })
    // Protect all subsequent state-changing API routes.
    app.use('/api', (req, res, next) => {
      if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
        return next()
      }
      if (
        req.get('origin') !== appOrigin ||
        !validToken(req.get('x-csrf-token'), req.session.csrfToken)
      ) {
        return res.status(403).json({
          code: 'CSRF_REJECTED',
          message: 'Refresh the page and try again.',
        })
      }
      next()
    })
    app.post('/api/auth/register', authLimiter, async (req, res, next) => {
      try {
        const { fields, name, email, password } =
          validateAccount(req.body, true)
        if (Object.keys(fields).length) {
          return res.status(400).json({
            code: 'VALIDATION_FAILED',
            message: 'Check your account details.',
            fields,
          })
        }
        const passwordHash = await argon2.hash(password, {
          type: argon2.argon2id,
          memoryCost: 19456,
          timeCost: 2,
          parallelism: 1,
        })
        const user = await User.create({
          name,
          email,
          passwordHash,
          role: 'customer',
        })
        // Registration creates an account; login is a separate step.
        res.status(201).json({
          message: 'Account created. You can now sign in.',
          user: publicUser(user),
        })
      } catch (error) {
        if (error.code === 11000) {
          return res.status(409).json({
            code: 'ACCOUNT_EXISTS',
            message: 'An account with this email already exists.',
          })
        }
        next(error)
      }
    })
    app.post('/api/auth/login', authLimiter, async (req, res, next) => {
      try {
        const { fields, email, password } =
          validateAccount(req.body, false)
        if (Object.keys(fields).length) {
          return res.status(400).json({
            code: 'VALIDATION_FAILED',
            message: 'Check your login details.',
            fields,
          })
        }
        const user = await User.findOne({ email }).select('+passwordHash')
        const verified = await argon2.verify(
          user ? user.passwordHash : dummyHash,
          password,
        )
        if (!user || !verified) {
          return res.status(401).json({
            code: 'INVALID_CREDENTIALS',
            message: 'Invalid email or password.',
          })
        }
        await sessionAction(req, 'regenerate')
        req.session.userId = user._id.toString()
        req.session.loginAt = Date.now()
        req.session.csrfToken = randomBytes(32).toString('hex')
        await sessionAction(req, 'save')
        res.json({
          user: publicUser(user),
          csrfToken: req.session.csrfToken,
        })
      } catch (error) {
        next(error)
      }
    })
    app.get('/api/auth/me', async (req, res, next) => {
      try {
        if (!req.session.userId) {
          return res.status(401).json({
            code: 'AUTH_REQUIRED',
            message: 'Please sign in.',
          })
        }
        // Read the current role from the database, not the browser.
        const user = await User.findById(req.session.userId)
        if (!user) {
          await sessionAction(req, 'destroy')
          res.clearCookie(cookieName, cookieOptions)
          return res.status(401).json({
            code: 'AUTH_REQUIRED',
            message: 'Please sign in again.',
          })
        }
        res.json({ user: publicUser(user) })
      } catch (error) {
        next(error)
      }
    })
    app.post('/api/auth/logout', async (req, res, next) => {
      try {
        await sessionAction(req, 'destroy')
        res.clearCookie(cookieName, cookieOptions)
        res.json({ message: 'Signed out successfully.' })
      } catch (error) {
        next(error)
      }
    })
    // Always load trusted identity and role before accessing bookings.
    async function requireCustomer(req, res, next) {
      res.set('Cache-Control', 'no-store')
      try {
        if (!req.session.userId) {
          return res.status(401).json({ code: 'AUTH_REQUIRED', message: 'Please sign in.' })
        }
        const user = await User.findById(req.session.userId).select('_id role').lean()
        if (!user) {
          await sessionAction(req, 'destroy')
          res.clearCookie(cookieName, cookieOptions)
          return res.status(401).json({ code: 'AUTH_REQUIRED', message: 'Please sign in again.' })
        }
        if (user.role !== 'customer') {
          return res.status(403).json({ code: 'CUSTOMER_REQUIRED', message: 'A customer account is required.' })
        }
        req.customerId = user._id
        next()
      } catch (error) {
        next(error)
      }
    }
    function publicBooking(booking) {
      return {
        id: booking._id.toString(),
        serviceId: booking.serviceId.toString(),
        serviceNameSnapshot: booking.serviceNameSnapshot,
        preferredAt: booking.preferredAt,
        address: booking.address,
        notes: booking.notes,
        status: booking.status,
        createdAt: booking.createdAt,
        updatedAt: booking.updatedAt,
      }
    }
    app.post('/api/bookings', requireCustomer, async (req, res, next) => {
      try {
        const body = req.body
        const allowed = ['serviceId', 'preferredAt', 'address', 'notes']
        if (!body || typeof body !== 'object' || Array.isArray(body) ||
            Object.keys(body).some((key) => !allowed.includes(key))) {
          return res.status(400).json({
            code: 'VALIDATION_FAILED',
            message: 'Submit only serviceId, preferredAt, address, and optional notes.',
            fields: { form: 'Unexpected booking fields.' },
          })
        }
        const fields = {}
        const serviceId = typeof body.serviceId === 'string' ? body.serviceId : ''
        if (!/^[a-fA-F0-9]{24}$/.test(serviceId)) fields.serviceId = 'Select a valid service.'
        // Require an ISO timestamp with an explicit UTC or numeric offset.
        const timestamp = typeof body.preferredAt === 'string' ? body.preferredAt : ''
        const isoPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/
        const preferredAt = new Date(timestamp)
        const calendarDate = new Date(`${timestamp.slice(0, 10)}T00:00:00Z`)
        const validCalendar = Number.isFinite(calendarDate.getTime()) &&
          calendarDate.toISOString().slice(0, 10) === timestamp.slice(0, 10)
        if (!isoPattern.test(timestamp) || !validCalendar ||
            !Number.isFinite(preferredAt.getTime()) || preferredAt.getTime() <= Date.now()) {
          fields.preferredAt = 'Choose a valid future date and time with a time zone.'
        }
        const address = typeof body.address === 'string' ? body.address.trim() : ''
        if (!address || address.length > 300) fields.address = 'Enter an address of 1–300 characters.'
        const notes = body.notes === undefined ? '' : body.notes
        if (typeof notes !== 'string' || notes.length > 1000) fields.notes = 'Use no more than 1,000 characters.'
        if (Object.keys(fields).length) {
          return res.status(400).json({ code: 'VALIDATION_FAILED', message: 'Check your booking details.', fields })
        }
        const service = await Service.findOne({ _id: serviceId, isActive: true }).select('name').lean()
        if (!service) {
          return res.status(400).json({
            code: 'SERVICE_UNAVAILABLE', message: 'This service is no longer available. Refresh the catalogue.',
            fields: { serviceId: 'Choose an active service.' },
          })
        }
        const booking = await Booking.create({
          customerId: req.customerId,
          serviceId: service._id,
          serviceNameSnapshot: service.name,
          preferredAt,
          address,
          notes: notes.trim(),
          status: 'pending',
          statusHistory: [{ status: 'pending', changedBy: req.customerId, changedAt: new Date() }],
        })
        res.status(201).json({ booking: publicBooking(booking) })
      } catch (error) {
        next(error)
      }
    })
    app.get('/api/bookings', requireCustomer, async (req, res, next) => {
      try {
        const allowed = ['page', 'limit']
        if (Object.keys(req.query).some((key) => !allowed.includes(key))) {
          return res.status(400).json({ code: 'INVALID_QUERY', message: 'Only page and limit query parameters are supported.' })
        }
        const pageValue = req.query.page === undefined ? '1' : req.query.page
        const limitValue = req.query.limit === undefined ? '20' : req.query.limit
        const validInteger = (value) => typeof value === 'string' && /^[1-9]\d*$/.test(value) && Number.isSafeInteger(Number(value))
        if (!validInteger(pageValue) || !validInteger(limitValue) || Number(limitValue) > 100 ||
            !Number.isSafeInteger((Number(pageValue) - 1) * Number(limitValue))) {
          return res.status(400).json({ code: 'INVALID_QUERY', message: 'Use a positive page number and a limit between 1 and 100.' })
        }
        const page = Number(pageValue)
        const limit = Number(limitValue)
        const bookings = await Booking.find({ customerId: req.customerId })
          .sort({ createdAt: -1, _id: -1 })
          .skip((page - 1) * limit)
          .limit(limit + 1)
          .lean()
        res.json({
          bookings: bookings.slice(0, limit).map(publicBooking),
          page, limit, hasMore: bookings.length > limit,
        })
      } catch (error) {
        next(error)
      }
    })
    app.get('/api/bookings/:id', requireCustomer, async (req, res, next) => {
      try {
        const validId = /^[a-fA-F0-9]{24}$/.test(req.params.id)
        const booking = validId ? await Booking.findOne({
          _id: req.params.id, customerId: req.customerId,
        }).lean() : null
        if (!booking) {
          return res.status(404).json({ code: 'NOT_FOUND', message: 'Booking not found.' })
        }
        res.json({ booking: publicBooking(booking) })
      } catch (error) {
        next(error)
      }
    })
    async function requireAdmin(req, res, next) {
      res.set('Cache-Control', 'no-store')
      try {
        if (!req.session.userId) {
          return res.status(401).json({ code: 'AUTH_REQUIRED', message: 'Please sign in.' })
        }
        const user = await User.findById(req.session.userId).select('_id role').lean()
        if (!user) {
          await sessionAction(req, 'destroy')
          res.clearCookie(cookieName, cookieOptions)
          return res.status(401).json({ code: 'AUTH_REQUIRED', message: 'Please sign in again.' })
        }
        if (user.role !== 'admin') {
          return res.status(403).json({ code: 'ADMIN_REQUIRED', message: 'Administrator access is required.' })
        }
        req.adminId = user._id
        next()
      } catch (error) {
        next(error)
      }
    }
    function adminBooking(booking) {
      return {
        ...publicBooking(booking),
        customerId: booking.customerId.toString(),
        version: booking.__v,
        statusHistory: booking.statusHistory,
      }
    }
    app.get('/api/admin/bookings', requireAdmin, async (req, res, next) => {
      try {
        const allowed = ['page', 'limit', 'status', 'from', 'to']
        if (Object.keys(req.query).some((key) => !allowed.includes(key))) {
          return res.status(400).json({ code: 'INVALID_QUERY', message: 'Unsupported filter.' })
        }
        const pageText = req.query.page === undefined ? '1' : req.query.page
        const limitText = req.query.limit === undefined ? '20' : req.query.limit
        const positiveInteger = (value) => typeof value === 'string' && /^[1-9]\d*$/.test(value) && Number.isSafeInteger(Number(value))
        if (!positiveInteger(pageText) || !positiveInteger(limitText) || Number(limitText) > 100 ||
            !Number.isSafeInteger((Number(pageText) - 1) * Number(limitText))) {
          return res.status(400).json({ code: 'INVALID_QUERY', message: 'Use a positive page number and a limit of 1–100.' })
        }
        const filter = {}
        if (req.query.status !== undefined) {
          if (typeof req.query.status !== 'string' || !['pending', 'confirmed', 'completed', 'cancelled'].includes(req.query.status)) {
            return res.status(400).json({ code: 'INVALID_QUERY', message: 'Invalid status filter.' })
          }
          filter.status = req.query.status
        }
        for (const name of ['from', 'to']) {
          if (req.query[name] !== undefined) {
            const value = req.query[name]
            const date = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) ? new Date(value) : null
            if (!date || !Number.isFinite(date.getTime())) {
              return res.status(400).json({ code: 'INVALID_QUERY', message: 'Date filters must be ISO timestamps with a time zone.' })
            }
            filter.preferredAt ||= {}
            filter.preferredAt[name === 'from' ? '$gte' : '$lte'] = date
          }
        }
        if (filter.preferredAt?.$gte && filter.preferredAt?.$lte && filter.preferredAt.$gte > filter.preferredAt.$lte) {
          return res.status(400).json({ code: 'INVALID_QUERY', message: 'The start date must not follow the end date.' })
        }
        const page = Number(pageText)
        const limit = Number(limitText)
        const bookings = await Booking.find(filter)
          .sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit + 1).lean()
        res.json({ bookings: bookings.slice(0, limit).map(adminBooking), page, limit, hasMore: bookings.length > limit })
      } catch (error) {
        next(error)
      }
    })
    app.patch('/api/admin/bookings/:id/status', requireAdmin, async (req, res, next) => {
      try {
        if (!/^[a-fA-F0-9]{24}$/.test(req.params.id)) {
          return res.status(404).json({ code: 'NOT_FOUND', message: 'Booking not found.' })
        }
        const body = req.body
        if (!body || typeof body !== 'object' || Array.isArray(body) ||
            Object.keys(body).some((key) => !['status', 'expectedVersion'].includes(key)) ||
            !['pending', 'confirmed', 'completed', 'cancelled'].includes(body.status) ||
            !Number.isSafeInteger(body.expectedVersion) || body.expectedVersion < 0) {
          return res.status(400).json({ code: 'VALIDATION_FAILED', message: 'Provide a valid status and expectedVersion.' })
        }
        const current = await Booking.findById(req.params.id).lean()
        if (!current) {
          return res.status(404).json({ code: 'NOT_FOUND', message: 'Booking not found.' })
        }
        if (current.__v !== body.expectedVersion) {
          return res.status(409).json({ code: 'BOOKING_CONFLICT', message: 'This booking changed. Refresh before updating it.' })
        }
        const transitions = {
          pending: ['confirmed', 'cancelled'],
          confirmed: ['completed', 'cancelled'],
          completed: [],
          cancelled: [],
        }
        if (!transitions[current.status]?.includes(body.status)) {
          return res.status(400).json({ code: 'INVALID_TRANSITION', message: `Cannot change ${current.status} to ${body.status}.` })
        }
        // Match the version and status in the write itself, preventing lost updates.
        const updated = await Booking.findOneAndUpdate(
          { _id: current._id, __v: body.expectedVersion, status: current.status },
          {
            $set: { status: body.status },
            $inc: { __v: 1 },
            $push: { statusHistory: { status: body.status, changedBy: req.adminId, changedAt: new Date() } },
          },
          { new: true, runValidators: true },
        ).lean()
        if (!updated) {
          return res.status(409).json({ code: 'BOOKING_CONFLICT', message: 'This booking changed. Refresh before updating it.' })
        }
        res.json({ booking: adminBooking(updated) })
      } catch (error) {
        next(error)
      }
    })
    function adminService(service) {
      return {
        id: service._id.toString(),
        slug: service.slug,
        name: service.name,
        description: service.description,
        isActive: service.isActive,
        version: service.__v ?? 0,
        createdAt: service.createdAt,
        updatedAt: service.updatedAt,
      }
    }

    function validateService(body, editing = false) {
      const fields = {}
      const allowed = editing
        ? ['name', 'description', 'isActive', 'expectedVersion']
        : ['name', 'description', 'isActive']
      if (!body || typeof body !== 'object' || Array.isArray(body) ||
          Object.keys(body).some((key) => !allowed.includes(key))) {
        return { fields: { form: 'Submit only the permitted service fields.' }, values: {} }
      }
      const values = {}
      for (const [key, maximum] of [['name', 100], ['description', 1000]]) {
        if (!editing || Object.hasOwn(body, key)) {
          if (typeof body[key] !== 'string' || !body[key].trim() || body[key].trim().length > maximum) {
            fields[key] = `Use between 1 and ${maximum} characters.`
          } else {
            values[key] = body[key].trim()
          }
        }
      }
      if (Object.hasOwn(body, 'isActive')) {
        if (typeof body.isActive !== 'boolean') fields.isActive = 'Use true or false.'
        else values.isActive = body.isActive
      } else if (!editing) values.isActive = true
      if (editing) {
        if (!Number.isSafeInteger(body.expectedVersion) || body.expectedVersion < 0) {
          fields.expectedVersion = 'Refresh services before editing.'
        }
        if (!['name', 'description', 'isActive'].some((key) => Object.hasOwn(body, key))) {
          fields.form = 'Provide at least one service field to update.'
        }
      }
      return { fields, values }
    }

    app.get('/api/admin/services', requireAdmin, async (req, res, next) => {
      try {
        if (Object.keys(req.query).some((key) => !['page', 'limit'].includes(key))) {
          return res.status(400).json({ code: 'INVALID_QUERY', message: 'Only page and limit are supported.' })
        }
        const pageText = req.query.page ?? '1'
        const limitText = req.query.limit ?? '20'
        const positiveInteger = (value) => typeof value === 'string' && /^[1-9]\d*$/.test(value) && Number.isSafeInteger(Number(value))
        if (!positiveInteger(pageText) || !positiveInteger(limitText) || Number(limitText) > 100 ||
            !Number.isSafeInteger((Number(pageText) - 1) * Number(limitText))) {
          return res.status(400).json({ code: 'INVALID_QUERY', message: 'Use a positive page number and a limit of 1–100.' })
        }
        const page = Number(pageText)
        const limit = Number(limitText)
        const services = await Service.find({}).sort({ name: 1, _id: 1 })
          .skip((page - 1) * limit).limit(limit + 1).lean()
        res.json({ services: services.slice(0, limit).map(adminService), page, limit, hasMore: services.length > limit })
      } catch (error) { next(error) }
    })

    app.post('/api/admin/services', requireAdmin, async (req, res, next) => {
      try {
        const { fields, values } = validateService(req.body)
        if (Object.keys(fields).length) {
          return res.status(400).json({ code: 'VALIDATION_FAILED', message: 'Check the service details.', fields })
        }
        // A stable internal slug is generated once; renaming does not change it.
        const prefix = values.name.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
          .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 70) || 'service'
        const service = await Service.create({ ...values, slug: `${prefix}-${randomBytes(12).toString('hex')}` })
        res.status(201).json({ service: adminService(service) })
      } catch (error) {
        if (error.code === 11000) {
          return res.status(409).json({ code: 'SERVICE_EXISTS', message: 'A service identifier conflicted. Refresh services before trying again.' })
        }
        next(error)
      }
    })

    app.patch('/api/admin/services/:id', requireAdmin, async (req, res, next) => {
      try {
        if (!/^[a-fA-F0-9]{24}$/.test(req.params.id)) {
          return res.status(404).json({ code: 'NOT_FOUND', message: 'Service not found.' })
        }
        const { fields, values } = validateService(req.body, true)
        if (Object.keys(fields).length) {
          return res.status(400).json({ code: 'VALIDATION_FAILED', message: 'Check the service details.', fields })
        }
        const service = await Service.findOneAndUpdate(
          { _id: req.params.id, __v: req.body.expectedVersion },
          { $set: values, $inc: { __v: 1 } },
          { new: true, runValidators: true },
        ).lean()
        if (!service) {
          const exists = await Service.exists({ _id: req.params.id })
          return res.status(exists ? 409 : 404).json(exists
            ? { code: 'SERVICE_CONFLICT', message: 'This service changed. Refresh services before editing again.' }
            : { code: 'NOT_FOUND', message: 'Service not found.' })
        }
        res.json({ service: adminService(service) })
      } catch (error) { next(error) }
    })

    app.use('/api', (req, res) => {
      res.status(404).json({
        code: 'NOT_FOUND',
        message: 'API route not found.',
      })
    })
    app.use((error, req, res, next) => {
      if (res.headersSent) return next(error)
      if (error.type === 'entity.parse.failed') {
        return res.status(400).json({
          code: 'INVALID_JSON',
          message: 'The request contains invalid JSON.',
        })
      }
      if (error.type === 'entity.too.large') {
        return res.status(413).json({
          code: 'REQUEST_TOO_LARGE',
          message: 'The request is too large.',
        })
      }
      const requestId = randomBytes(8).toString('hex')
      console.error(`Request ${requestId} failed (${error.name})`)
      res.status(500).json({
        code: 'SERVER_ERROR',
        message: 'Something went wrong. Please try again.',
        requestId,
      })
    })
    console.log('MongoDB connected')
    app.listen(port, () => {
      console.log(`Sweeplune API running at http://localhost:${port}`)
    })
  } catch (error) {
    console.error('Server startup failed:', error.message)
    await mongoose.disconnect()
    process.exitCode = 1
  }
}
startServer()
