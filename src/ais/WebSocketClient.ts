import { EventBus, Events } from '../utils/EventBus'
import { RECONNECT_DELAYS_MS } from '../utils/constants'

export type WSStatus = 'connecting' | 'connected' | 'disconnected' | 'error'

export class WebSocketClient {
  private ws: WebSocket | null = null
  private attemptIndex = 0
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private _status: WSStatus = 'disconnected'
  private url: string

  constructor() {
    // VITE_WS_URL=auto resolves the current tunnel host from a static backend-url.json
    // published alongside this site (the tunnel rotates on restart; short.io redirects
    // don't work for the ws upgrade handshake, so we resolve the real host then connect direct)
    // Otherwise VITE_WS_URL overrides directly (e.g. point local dev at a fixed backend)
    // Falls back to same-host /ws — works for Vite proxy in dev
    const envUrl = import.meta.env.VITE_WS_URL as string | undefined
    if (envUrl === 'auto') {
      this.url = ''
    } else if (envUrl) {
      this.url = envUrl
    } else {
      const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
      this.url = `${proto}//${location.host}/ws`
    }
  }

  private async resolveAutoUrl(): Promise<string> {
    const res = await fetch(`${import.meta.env.BASE_URL}backend-url.json`, { cache: 'no-store' })
    if (!res.ok) throw new Error(`backend-url.json resolve failed: ${res.status}`)
    const { url } = (await res.json()) as { url: string }
    return url.replace(/^http/, 'ws') + '/ws'
  }

  async connect(): Promise<void> {
    if (this.ws?.readyState === WebSocket.OPEN) return
    this.setStatus('connecting')

    if ((import.meta.env.VITE_WS_URL as string | undefined) === 'auto') {
      try {
        this.url = await this.resolveAutoUrl()
      } catch {
        this.setStatus('error')
        this.scheduleReconnect()
        return
      }
    }

    this.ws = new WebSocket(this.url)

    this.ws.onopen = () => {
      this.attemptIndex = 0
      this.setStatus('connected')
    }

    this.ws.onmessage = (evt: MessageEvent<string>) => {
      const data = evt.data
      try {
        const parsed = JSON.parse(data) as { type?: string; status?: string; positions?: string[]; statics?: string[] }
        // Relay server status change
        if (parsed.type === 'SERVER_STATUS') {
          const s = parsed.status as WSStatus
          this.setStatus(s)
          return
        }
        // Initial vessel snapshot
        if (parsed.type === 'SNAPSHOT') {
          for (const raw of parsed.positions ?? []) {
            EventBus.emit(Events.WS_MESSAGE, raw)
          }
          for (const raw of parsed.statics ?? []) {
            EventBus.emit(Events.WS_MESSAGE, raw)
          }
          return
        }
      } catch {
        // not JSON — shouldn't happen
      }
      // Regular AIS message
      EventBus.emit(Events.WS_MESSAGE, data)
    }

    this.ws.onclose = () => {
      this.scheduleReconnect()
    }

    this.ws.onerror = () => {
      this.setStatus('error')
    }
  }

  private scheduleReconnect(): void {
    this.setStatus('disconnected')
    if (this.reconnectTimer) return
    const delay = RECONNECT_DELAYS_MS[Math.min(this.attemptIndex, RECONNECT_DELAYS_MS.length - 1)]
    this.attemptIndex++
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.connect()
    }, delay)
  }

  private setStatus(s: WSStatus): void {
    if (this._status === s) return
    this._status = s
    EventBus.emit(Events.WS_STATUS_CHANGED, s)
  }

  get status(): WSStatus { return this._status }

  disconnect(): void {
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null }
    this.ws?.close()
  }
}
