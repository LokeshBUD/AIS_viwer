import './styles/main.css'

import { WebSocketClient } from './ais/WebSocketClient'
import { VesselTracker } from './ais/VesselTracker'

import { AlertManager } from './agent/AlertManager'
import { AnomalyDetector } from './agent/AnomalyDetector'

import { HUD } from './ui/HUD'
import { VesselInfoPanel } from './ui/VesselInfoPanel'
import { AlertPanel } from './ui/AlertPanel'
import { MapView } from './ui/MapView'
import { FilterPanel } from './ui/FilterPanel'
import { VesselTable } from './ui/VesselTable'

import { EventBus, Events } from './utils/EventBus'
import type { WSStatus } from './ais/WebSocketClient'
import type { AnomalyAlert } from './agent/AlertManager'

// ─── Bootstrap ───────────────────────────────────────────────────────────────

const tracker = new VesselTracker()
const alerts  = new AlertManager()
new AnomalyDetector(alerts)

const hud         = new HUD()
new VesselInfoPanel(tracker)
const alertPanel  = new AlertPanel()
const mapView     = new MapView()
const filterPanel = new FilterPanel()
new VesselTable(tracker)

const ws = new WebSocketClient()
ws.connect()

// ─── Wiring ──────────────────────────────────────────────────────────────────

EventBus.on<WSStatus>(Events.WS_STATUS_CHANGED, s => hud.setWSStatus(s))
EventBus.on<AnomalyAlert>(Events.ANOMALY_DETECTED, () => {
  hud.setAlertCount(alertPanel.count)
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
}, 1000)

console.log('%c AIS Maritime Dashboard — 2D Map ', 'background:#000820;color:#00d4ff;font-weight:bold;padding:4px 10px;')
