import express from 'express'
import { existsSync } from 'node:fs'
import { resolve, extname } from 'node:path'

export function configureTransport(app, { production, appOrigin, proxyHops = '' }) {
  const url = new URL(appOrigin)
  if (appOrigin !== url.origin || !['http:', 'https:'].includes(url.protocol)) {
    throw new Error('APP_ORIGIN must be an HTTP(S) origin without a path or trailing slash')
  }
  if (production && url.protocol !== 'https:') {
    throw new Error('Production APP_ORIGIN must use HTTPS')
  }
  if (proxyHops !== '' && !/^(0|[1-9]\d*)$/.test(proxyHops)) {
    throw new Error('TRUST_PROXY_HOPS must be a non-negative integer')
  }
  const hops = proxyHops === '' ? 0 : Number(proxyHops)
  if (!Number.isSafeInteger(hops) || hops > 10) throw new Error('TRUST_PROXY_HOPS must be between 0 and 10')
  // Set only for the known host's proxy topology. Never trust all proxies.
  app.set('trust proxy', hops || false)
  app.disable('x-powered-by')
  app.use((req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff')
    res.set('X-Frame-Options', 'DENY')
    res.set('Referrer-Policy', 'strict-origin-when-cross-origin')
    next()
  })
}

export function assertClientBuild(clientDirectory) {
  if (!existsSync(resolve(clientDirectory, 'index.html'))) {
    throw new Error('Frontend build missing. Run npm run build from the project root before starting production.')
  }
}

export function serveClient(app, clientDirectory) {
  // Call after the API 404 handler, so missing API routes remain JSON errors.
  app.use('/assets', express.static(resolve(clientDirectory, 'assets'), {
    immutable: true, maxAge: '1y', index: false,
  }))
  app.use(express.static(clientDirectory, { index: false, maxAge: 0 }))
  // Express 5 requires a named wildcard; braces also match the root path.
  app.get('/{*path}', (req, res, next) => {
    if (extname(req.path) || !req.accepts('html')) return next()
    res.set('Cache-Control', 'no-cache')
    res.sendFile(resolve(clientDirectory, 'index.html'))
  })
}
