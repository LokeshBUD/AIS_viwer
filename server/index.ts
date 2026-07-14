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


const app = express()
const httpServer = createServer(app)
const wss = new WebSocketServer({ server: httpServer, path: '/ws' })

const relay = new AISRelay(API_KEY)
relay.connect()

wss.on('connection', (ws: WebSocket) => {
  relay.addClient(ws)
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
