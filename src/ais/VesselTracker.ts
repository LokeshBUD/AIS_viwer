import { EventBus, Events } from '../utils/EventBus'
import { RingBuffer } from '../utils/RingBuffer'
import { parseRaw, extractPosition, extractStatic, shipTypeToCategory } from './AISParser'
import { VESSEL_HISTORY_LEN, STALE_VESSEL_MS, MAX_TRACKED_VESSELS } from '../utils/constants'
import type { VesselState, PositionSnapshot } from './types'
import type { IHistoryStore } from '../utils/HistoryStore'

export class VesselTracker {
  private vessels = new Map<number, VesselState>()
  private history = new Map<number, RingBuffer<PositionSnapshot>>()

  constructor(private historyStore?: IHistoryStore) {
    EventBus.on<string>(Events.WS_MESSAGE, (raw) => this.handle(raw))
    setInterval(() => this.purgeStale(), 60_000)
  }

  private handle(raw: string): void {
    const msg = parseRaw(raw)
    if (!msg) return

    const type = msg.MessageType ?? ''

    if (type === 'PositionReport' || type === 'StandardClassBPositionReport') {
      const pos = extractPosition(msg)
      if (!pos) return

      const vessel = this.getOrCreate(pos.mmsi, pos.name)
      vessel.lat = pos.lat
      vessel.lon = pos.lon
      vessel.sog = pos.sog
      vessel.cog = pos.cog
      vessel.trueHeading = pos.trueHeading
      vessel.rot = pos.rot
      vessel.navStatus = pos.navStatus
      vessel.lastUpdate = Date.now()
      if (!vessel.name || vessel.name.startsWith('MMSI:')) vessel.name = pos.name

      const snapshot: PositionSnapshot = { lat: pos.lat, lon: pos.lon, sog: pos.sog, cog: pos.cog, timestamp: Date.now() }
      const buf = this.history.get(pos.mmsi)!
      buf.push(snapshot)
      vessel.history = buf.toArray()
      this.historyStore?.append(pos.mmsi, snapshot)

      EventBus.emit(Events.VESSEL_UPDATED, vessel)
    }

    if (type === 'ShipStaticData') {
      const stat = extractStatic(msg)
      if (!stat) return

      const vessel = this.vessels.get(stat.mmsi)
      if (!vessel) return  // no position yet — wait for position report

      if (stat.name) vessel.name = stat.name
      vessel.shipType = stat.shipType
      vessel.vesselCategory = shipTypeToCategory(stat.shipType)
      vessel.draught = stat.draught
      vessel.callSign = stat.callSign
      vessel.destination = stat.destination

      EventBus.emit(Events.VESSEL_UPDATED, vessel)
    }
  }

  private getOrCreate(mmsi: number, name: string): VesselState {
    let v = this.vessels.get(mmsi)
    if (v) {
      // True LRU: move to the most-recently-updated end (Map iteration order
      // follows insertion order, so delete+re-set moves it to the back).
      this.vessels.delete(mmsi)
      this.vessels.set(mmsi, v)
      return v
    }

    if (this.vessels.size >= MAX_TRACKED_VESSELS) {
      const lruMmsi = this.vessels.keys().next().value
      if (lruMmsi !== undefined) {
        this.vessels.delete(lruMmsi)
        this.history.delete(lruMmsi)
        EventBus.emit(Events.VESSEL_LOST, lruMmsi)
      }
    }

    v = {
      mmsi, name,
      lat: 0, lon: 0, sog: 0, cog: 0, trueHeading: 511, rot: 0,
      navStatus: 'NotDefined', draught: 0, shipType: 0,
      vesselCategory: 'unknown', callSign: '', destination: '',
      lastUpdate: Date.now(), history: [],
    }
    this.vessels.set(mmsi, v)
    this.history.set(mmsi, new RingBuffer<PositionSnapshot>(VESSEL_HISTORY_LEN))
    return v
  }

  private purgeStale(): void {
    const cutoff = Date.now() - STALE_VESSEL_MS
    for (const [mmsi, v] of this.vessels) {
      if (v.lastUpdate < cutoff) {
        this.vessels.delete(mmsi)
        this.history.delete(mmsi)
        EventBus.emit(Events.VESSEL_LOST, mmsi)
      }
    }
  }

  get(mmsi: number): VesselState | undefined { return this.vessels.get(mmsi) }
  getAll(): ReadonlyMap<number, VesselState> { return this.vessels }
}
