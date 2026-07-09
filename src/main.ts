import * as THREE from 'three'
import './styles/main.css'

import { SceneManager } from './scene/SceneManager'
import { GlobeEnvironment } from './scene/GlobeEnvironment'
import { LODManager } from './scene/LODManager'
import { PortMarkers } from './scene/PortMarkers'

import { WebSocketClient } from './ais/WebSocketClient'
import { VesselTracker } from './ais/VesselTracker'

import { AlertManager } from './agent/AlertManager'
import { AnomalyDetector } from './agent/AnomalyDetector'

import { HUD } from './ui/HUD'
import { VesselInfoPanel } from './ui/VesselInfoPanel'
import { AlertPanel } from './ui/AlertPanel'
import { MapView } from './ui/MapView'

import { vec3ToLatLon, latLonToVec3 } from './utils/CoordMapper'
import { GLOBE_RADIUS } from './utils/constants'
import { EventBus, Events } from './utils/EventBus'
import type { WSStatus } from './ais/WebSocketClient'
import type { AnomalyAlert } from './agent/AlertManager'

// ─── Bootstrap ──────────────────────────────────────────────────────────────

const canvas = document.getElementById('ais-canvas') as HTMLCanvasElement

const scene  = new SceneManager(canvas)
const globe  = new GlobeEnvironment(scene.scene)
const lod    = new LODManager(scene.scene, scene.camera)
const ports  = new PortMarkers(scene.scene)

const tracker = new VesselTracker()
const alerts  = new AlertManager()
new AnomalyDetector(alerts)

const hud        = new HUD()
new VesselInfoPanel(tracker)
const alertPanel = new AlertPanel()
const mapView    = new MapView()

const ws = new WebSocketClient()
ws.connect()

// ─── Cross-module wiring ────────────────────────────────────────────────────

EventBus.on<WSStatus>(Events.WS_STATUS_CHANGED, s => hud.setWSStatus(s))

// View toggle: switch between 3D globe and 2D satellite map
let mapActive = false
hud.onViewToggle(() => {
  mapActive = !mapActive
  if (mapActive) {
    mapView.show(tracker.getAll())
    canvas.style.display = 'none'
  } else {
    mapView.hide()
    canvas.style.display = 'block'
  }
})
EventBus.on<AnomalyAlert>(Events.ANOMALY_DETECTED, () => {
  hud.setAlertCount(alertPanel.count)
})
// Fly camera to face selected vessel, then highlight
EventBus.on<number>(Events.VESSEL_SELECTED, mmsi => {
  lod.highlightAnomaly(mmsi)
  const state = tracker.get(mmsi)
  if (state) {
    const worldPos = latLonToVec3(state.lat, state.lon, GLOBE_RADIUS)
    scene.focusOn(worldPos)
  }
})

// ─── Mouse → lat/lon display via sphere raycasting ──────────────────────────
const raycaster  = new THREE.Raycaster()
const mouse      = new THREE.Vector2()
const globeSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), GLOBE_RADIUS)
const hitPoint   = new THREE.Vector3()

canvas.addEventListener('mousemove', (e: MouseEvent) => {
  mouse.x =  (e.clientX / window.innerWidth)  * 2 - 1
  mouse.y = -(e.clientY / window.innerHeight) * 2 + 1
  raycaster.setFromCamera(mouse, scene.camera)
  if (raycaster.ray.intersectSphere(globeSphere, hitPoint)) {
    const { lat, lon } = vec3ToLatLon(hitPoint)
    hud.setCoords(lat, lon)
  }
})

// ─── Click → pick vessel ────────────────────────────────────────────────────
canvas.addEventListener('click', (e: MouseEvent) => {
  lod.pick(new THREE.Vector2(
    (e.clientX / window.innerWidth)  * 2 - 1,
    -(e.clientY / window.innerHeight) * 2 + 1,
  ))
})

// ─── Main render loop ────────────────────────────────────────────────────────
let msgCount  = 0
let lastMsgTs = Date.now()
EventBus.on<string>(Events.WS_MESSAGE, () => { msgCount++ })

scene.onTick((dt: number) => {
  globe.update(dt)
  lod.tick(dt)
  ports.tick(scene.camera.position.length())
  hud.setVesselCount(lod.count)

  const now = Date.now()
  if (now - lastMsgTs > 5000) {
    hud.setMsgRate(Math.round(msgCount / ((now - lastMsgTs) / 1000)))
    msgCount  = 0
    lastMsgTs = now
  }
})

scene.start()

console.log('%c AIS Maritime Dashboard — Globe Mode ', 'background:#000820;color:#00d4ff;font-weight:bold;padding:4px 10px;')
