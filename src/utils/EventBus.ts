type Handler<T> = (payload: T) => void

class _EventBus {
  private listeners = new Map<string, Handler<unknown>[]>()

  on<T>(event: string, handler: Handler<T>): () => void {
    const arr = (this.listeners.get(event) ?? []) as Handler<T>[]
    arr.push(handler)
    this.listeners.set(event, arr as Handler<unknown>[])
    return () => this.off(event, handler)
  }

  emit<T>(event: string, payload: T): void {
    const arr = this.listeners.get(event)
    if (arr) arr.forEach(h => (h as Handler<T>)(payload))
  }

  off<T>(event: string, handler: Handler<T>): void {
    const arr = this.listeners.get(event)
    if (!arr) return
    const filtered = arr.filter(h => h !== (handler as Handler<unknown>))
    this.listeners.set(event, filtered)
  }
}

export const EventBus = new _EventBus()

export const Events = {
  WS_MESSAGE:        'ws:message',
  WS_STATUS_CHANGED: 'ws:status',
  VESSEL_UPDATED:    'vessel:updated',
  VESSEL_LOST:       'vessel:lost',
  VESSEL_SELECTED:   'vessel:selected',
  VESSEL_DESELECTED: 'vessel:deselected',
  ANOMALY_DETECTED:  'anomaly:detected',
  ALERT_UPDATED:     'alert:updated',
} as const
