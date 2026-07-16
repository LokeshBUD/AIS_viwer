import './styles/main.css'

import { WebSocketClient } from './ais/WebSocketClient'
import { VesselTracker } from './ais/VesselTracker'

import { AlertManager } from './agent/AlertManager'
import { AnomalyDetector } from './agent/AnomalyDetector'
import { GeofenceMonitor } from './agent/GeofenceMonitor'

import { HUD } from './ui/HUD'
import { VesselInfoPanel } from './ui/VesselInfoPanel'
import { MapView } from './ui/MapView'
import { FilterPanel } from './ui/FilterPanel'
import { VesselTable } from './ui/VesselTable'
import { LegendPanel } from './ui/LegendPanel'

import { EventBus, Events } from './utils/EventBus'
import type { WSStatus } from './ais/WebSocketClient'
import { InMemoryHistoryStore } from './utils/HistoryStore'

// ─── Bootstrap ───────────────────────────────────────────────────────────────

const historyStore = new InMemoryHistoryStore()
const tracker      = new VesselTracker(historyStore)
const alerts       = new AlertManager()
new AnomalyDetector(alerts, tracker)
new GeofenceMonitor(alerts)

const hud         = new HUD()
new VesselInfoPanel(tracker)
const mapView     = new MapView()
const filterPanel = new FilterPanel()
new VesselTable(tracker)
new LegendPanel()

const ws = new WebSocketClient()
ws.connect()

// ─── Wiring ──────────────────────────────────────────────────────────────────

EventBus.on<WSStatus>(Events.WS_STATUS_CHANGED, s => hud.setWSStatus(s))

// ZONE ↑ (GEOFENCE_EXIT) is a one-time crossing event, not a steady-state
// condition — there's no "currently exited" to track, so it stays a
// cumulative session count fed by the alert stream. Everything else is
// read live from AlertManager's active-vessel sets below.
let zoneExitCount = 0
EventBus.on<{ type: string }>(Events.ANOMALY_DETECTED, (alert) => {
  if (alert.type === 'GEOFENCE_EXIT') {
    zoneExitCount++
    hud.setAlertTypeCount('GEOFENCE_EXIT', zoneExitCount)
  }
})

// ─── Start map ───────────────────────────────────────────────────────────────

mapView.start(tracker.getAll(), (lat, lon) => hud.setCoords(lat, lon))
hud.onSearch(q => mapView.search(q))
filterPanel.onChange(f => mapView.applyFilter(f))

// ─── Stats ───────────────────────────────────────────────────────────────────

let msgCount  = 0
let lastMsgTs = Date.now()
EventBus.on<string>(Events.WS_MESSAGE, () => { msgCount++ })

setInterval(() => {
  hud.setVesselCount(tracker.getAll().size)
  const now = Date.now()
  if (now - lastMsgTs >= 5000) {
    hud.setMsgRate(Math.round(msgCount / ((now - lastMsgTs) / 1000)))
    msgCount  = 0
    lastMsgTs = now
  }

  hud.setAlertCount(alerts.getActiveVesselCount())
  hud.setAlertTypeCount('SPEED_DROP',     alerts.getActiveCount('SPEED_DROP'))
  hud.setAlertTypeCount('SHARP_HEADING',  alerts.getActiveCount('SHARP_HEADING'))
  hud.setAlertTypeCount('DRAFT_MISMATCH', alerts.getActiveCount('DRAFT_MISMATCH'))
  hud.setAlertTypeCount('AIS_GAP',        alerts.getActiveCount('AIS_GAP'))
  hud.setAlertTypeCount('GEOFENCE_ENTRY', alerts.getActiveCount('GEOFENCE_ENTRY'))
}, 1000)

console.log('%c AIS Maritime Dashboard — 2D Map ', 'background:#000820;color:#00d4ff;font-weight:bold;padding:4px 10px;')
