import dotenv from 'dotenv'
dotenv.config()

import express from 'express'
import { createServer } from 'http'
import { WebSocketServer, WebSocket } from 'ws'
import path from 'path'
import { AISRelay } from './AISRelay'

const PORT = Number(process.env.PORT ?? 3001)
const API_KEY = process.env.AIS_API ?? ''

if (!API_KEY) {
  console.error('[server] AIS_API not set in .env — exiting')
  process.exit(1)
}

const SHORT_IO_API_KEY = process.env.SHORT_IO_API_KEY ?? ''
const SHORT_IO_DOMAIN = process.env.SHORT_IO_DOMAIN ?? 'aisviewer.s.gy'
const SHORT_IO_PATH = process.env.SHORT_IO_PATH ?? 'backend'
const BACKEND_URL_CACHE_MS = 30_000
let backendUrlCache: { url: string; ts: number } | null = null

const app = express()
const httpServer = createServer(app)
const wss = new WebSocketServer({ server: httpServer, path: '/ws' })

const relay = new AISRelay(API_KEY)
relay.connect()

wss.on('connection', (ws: WebSocket) => {
  relay.addClient(ws)
})

// Resolves the current cloudflare tunnel host from short.io (backend rotates on restart)
app.get('/api/backend-url', async (_req, res) => {
  if (backendUrlCache && Date.now() - backendUrlCache.ts < BACKEND_URL_CACHE_MS) {
    return res.json({ url: backendUrlCache.url })
  }
  if (!SHORT_IO_API_KEY) {
    return res.status(500).json({ error: 'SHORT_IO_API_KEY not set' })
  }
  try {
    const r = await fetch(
      `https://api.short.io/links/expand?domain=${SHORT_IO_DOMAIN}&path=${SHORT_IO_PATH}`,
      { headers: { accept: 'application/json', Authorization: SHORT_IO_API_KEY } }
    )
    if (!r.ok) {
      return res.status(502).json({ error: `short.io lookup failed: ${r.status}` })
    }
    const data = (await r.json()) as { originalURL: string }
    backendUrlCache = { url: data.originalURL, ts: Date.now() }
    res.json({ url: data.originalURL })
  } catch (e) {
    res.status(502).json({ error: String(e) })
  }
})

// Health endpoint
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    clients: relay.clientCount,
    vessels: relay.vesselCount,
    msgRate: relay.messageRate,
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
