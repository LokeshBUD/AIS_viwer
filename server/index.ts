import dotenv from 'dotenv'
dotenv.config()

import express from 'express'
import compression from 'compression'
import { createServer } from 'http'
import { WebSocketServer, WebSocket } from 'ws'
import path from 'path'
import { AISRelay } from './AISRelay'

const PORT = Number(process.env.PORT ?? 3001)
const API_KEY = process.env.AIS_API ?? ''
const HEALTH_TOKEN = process.env.HEALTH_TOKEN ?? ''
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ?? 'https://lokeshbud.github.io,http://localhost:5173')
  .split(',')
  .map(o => o.trim())
  .filter(Boolean)

if (!API_KEY) {
  console.error('[server] AIS_API not set in .env — exiting')
  process.exit(1)
}

if (process.env.NODE_ENV === 'production' && !HEALTH_TOKEN) {
  console.warn('[server] HEALTH_TOKEN not set — /health will be disabled in production')
}

const app = express()
app.use(compression())
const httpServer = createServer(app)
const wss = new WebSocketServer({
  server: httpServer,
  path: '/ws',
  verifyClient: (info, cb) => {
    const origin = info.origin
    if (!origin || !ALLOWED_ORIGINS.includes(origin)) {
      console.warn(`[server] rejected WS connection from disallowed origin: ${origin || '(none)'}`)
      cb(false, 403, 'Forbidden')
      return
    }
    cb(true)
  },
  perMessageDeflate: {
    zlibDeflateOptions: { level: 6 },
    threshold: 1024,
    concurrencyLimit: 10,
  },
})

const relay = new AISRelay(API_KEY)
relay.connect()

wss.on('connection', (ws: WebSocket) => {
  relay.addClient(ws)
})

// Health/stats endpoint — disabled unless HEALTH_TOKEN is set and matched, to
// avoid leaking client/vessel counts and process internals to anyone probing
// the public tunnel URL.
app.get('/health', (req, res) => {
  if (!HEALTH_TOKEN || req.get('x-health-token') !== HEALTH_TOKEN) {
    res.status(404).end()
    return
  }
  const mem = process.memoryUsage()
  res.json({
    status: 'ok',
    uptimeSec: relay.uptimeSec,
    ais: {
      connectionState: relay.aisConnectionState,
      reconnectAttempts: relay.reconnectAttempts,
    },
    relay: {
      clients: relay.clientCount,
      maxClients: relay.maxClients,
      vessels: relay.vesselCount,
      staticRecords: relay.staticRecordCount,
      msgRate: relay.messageRate,
      totalMessages: relay.totalMessages,
      cacheLimits: relay.cacheLimits,
    },
    process: {
      pid: process.pid,
      nodeVersion: process.version,
      memoryMb: {
        rss: Math.round(mem.rss / 1024 / 1024),
        heapUsed: Math.round(mem.heapUsed / 1024 / 1024),
        heapTotal: Math.round(mem.heapTotal / 1024 / 1024),
      },
    },
  })
})

// Serve Vite build in production
if (process.env.NODE_ENV === 'production') {
  const distPath = path.resolve(__dirname, '../../dist/client')
  app.use(express.static(distPath))
  app.get('*', (_req, res) => res.sendFile(path.join(distPath, 'index.html')))
}

httpServer.listen(PORT, () => {
  console.log(`[server] AIS relay listening on :${PORT}`)
  if (process.env.NODE_ENV !== 'production') {
    console.log(`[server] Vite dev client on :5173`)
  }
})
