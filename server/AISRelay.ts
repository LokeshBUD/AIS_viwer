import WebSocket from 'ws'

const MAX_CACHE        = 8000
const MAX_BACKOFF_MS   = 60_000   // cap reconnect delay at 60s
const BASE_BACKOFF_MS  = 2_000    // start at 2s (aisstream 429 = server is busy, don't hammer)

interface CachedMessage {
  raw: string
  ts: number
}

export class AISRelay {
  private aisWs: WebSocket | null = null
  private clients: Set<WebSocket> = new Set()
  /** Latest position report per MMSI */
  private posCache = new Map<number, CachedMessage>()
  /** Latest static data per MMSI */
  private staticCache = new Map<number, CachedMessage>()
  private reconnectAttempt = 0
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private msgCount = 0
  private startTime = Date.now()

  constructor(private apiKey: string) {
    setInterval(() => {
      console.log(`[relay] live msg rate: ${this.messageRate}/s, total: ${this.msgCount}, vessels: ${this.vesselCount}, clients: ${this.clientCount}`)
    }, 30_000)
  }

  connect(): void {
    if (this.aisWs?.readyState === WebSocket.OPEN) return
    console.log(`[relay] Connecting to aisstream.io (attempt ${this.reconnectAttempt + 1})`)
    this.aisWs = new WebSocket('wss://stream.aisstream.io/v0/stream')

    this.aisWs.on('open', () => {
      console.log('[relay] Connected to aisstream.io')
      this.reconnectAttempt = 0
      this.aisWs!.send(
        JSON.stringify({
          APIKey: this.apiKey,
          BoundingBoxes: [[[-90, -180], [90, 180]]],
        })
      )
      this.broadcastStatus('connected')
    })

    this.aisWs.on('message', (data: Buffer) => {
      const raw = data.toString()
      this.msgCount++
      try {
        const msg = JSON.parse(raw)
        const mmsi = Number(msg?.MetaData?.MMSI)
        if (mmsi) {
          const type: string = msg.MessageType ?? ''
          if (type === 'PositionReport' || type === 'StandardClassBPositionReport') {
            this.cacheWithEviction(this.posCache, mmsi, raw)
          } else if (type === 'ShipStaticData') {
            this.cacheWithEviction(this.staticCache, mmsi, raw)
          }
        }
      } catch {
        // ignore malformed
      }
      this.broadcast(raw)
    })

    this.aisWs.on('close', () => {
      console.log('[relay] Disconnected from aisstream.io, scheduling reconnect')
      this.broadcastStatus('disconnected')
      this.scheduleReconnect()
    })

    this.aisWs.on('error', (err) => {
      console.error('[relay] WS error:', err.message)
      this.broadcastStatus('error')
    })
  }

  addClient(ws: WebSocket): void {
    this.clients.add(ws)
    // Send server status + snapshot of current vessels
    ws.send(JSON.stringify({ type: 'SERVER_STATUS', status: this.aisWs?.readyState === WebSocket.OPEN ? 'connected' : 'disconnected' }))
    this.sendSnapshot(ws)
    ws.on('close', () => {
      this.clients.delete(ws)
      console.log(`[relay] Client disconnected. Total: ${this.clients.size}`)
    })
    ws.on('error', () => this.clients.delete(ws))
    console.log(`[relay] Client connected. Total: ${this.clients.size}`)
  }

  private sendSnapshot(ws: WebSocket): void {
    const positions = Array.from(this.posCache.values()).map(c => c.raw)
    const statics = Array.from(this.staticCache.values()).map(c => c.raw)
    if (positions.length === 0 && statics.length === 0) return
    try {
      ws.send(JSON.stringify({ type: 'SNAPSHOT', positions, statics }))
    } catch {
      // client already gone
    }
  }

  private broadcastStatus(status: string): void {
    this.broadcast(JSON.stringify({ type: 'SERVER_STATUS', status }))
  }

  private broadcast(data: string): void {
    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        try {
          client.send(data)
        } catch {
          this.clients.delete(client)
        }
      }
    }
  }

  private cacheWithEviction(cache: Map<number, CachedMessage>, mmsi: number, raw: string): void {
    if (cache.size >= MAX_CACHE && !cache.has(mmsi)) {
      // Evict oldest entry
      const firstKey = cache.keys().next().value
      if (firstKey !== undefined) cache.delete(firstKey)
    }
    cache.set(mmsi, { raw, ts: Date.now() })
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return
    // True exponential backoff: 2s, 4s, 8s, 16s, 32s, 60s (capped), with ±20% jitter
    const base  = Math.min(BASE_BACKOFF_MS * Math.pow(2, this.reconnectAttempt), MAX_BACKOFF_MS)
    const delay = Math.round(base * (0.8 + Math.random() * 0.4))
    this.reconnectAttempt++
    console.log(`[relay] Reconnecting in ${(delay / 1000).toFixed(1)}s (attempt ${this.reconnectAttempt})`)
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.connect()
    }, delay)
  }

  get clientCount(): number { return this.clients.size }
  get vesselCount(): number { return this.posCache.size }
  get messageRate(): number {
    const uptime = (Date.now() - this.startTime) / 1000
    return uptime > 0 ? Math.round(this.msgCount / uptime) : 0
  }
}
