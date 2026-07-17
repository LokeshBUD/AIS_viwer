/** 1 Three.js unit = 1 km */
export const WORLD_SCALE = 1

export const OCEAN_SIZE = 40000

/** Globe sphere radius in Three.js units */
export const GLOBE_RADIUS = 100

/** Vessel marker offset above sphere surface */
export const VESSEL_GLOBE_OFFSET = 1.5

export const LOD_HIGH_DIST  = 100
export const LOD_MED_DIST   = 1000
export const LOD_LOW_DIST   = 5000

/** Positions stored per vessel ring buffer */
export const VESSEL_HISTORY_LEN = 300

/** Seconds of history to examine for anomalies */
export const ANOMALY_WINDOW_SECS = 180

/** SOG fraction drop to trigger speed-drop anomaly (0.35 = 35%) */
export const SPEED_DROP_THRESHOLD = 0.35

/** Degrees of total COG drift within window to trigger heading anomaly */
export const HEADING_CHANGE_THRESHOLD = 35

/** Vessels not seen within this ms are purged */
export const STALE_VESSEL_MS = 10 * 60 * 1000

/**
 * Safety-valve cap on concurrently tracked vessels — bounds memory and the
 * cost of every full-sweep operation (table sort, anomaly scan, canvas
 * redraw) in the rare case traffic spikes far beyond normal. Under normal
 * conditions STALE_VESSEL_MS is what actually bounds the count (matches
 * server/AISRelay.ts's own MAX_CACHE/STALE_MS, same 10-minute window) —
 * verified smooth up to ~28,000 concurrent vessels with no errors or
 * perceptible lag, so this cap sits well above the real-world steady state.
 * Over the cap, the least-recently-updated vessel is evicted (true LRU).
 */
export const MAX_TRACKED_VESSELS = 50_000

/** AIS gap thresholds — vessel must have history.length >= 5 before gap fires */
export const AIS_GAP_WARNING_MS  = 5  * 60 * 1000   // 5 min → warning
export const AIS_GAP_CRITICAL_MS = 15 * 60 * 1000   // 15 min → critical

export const RECONNECT_DELAYS_MS = [1000, 2000, 4000, 8000, 16000]

/** Water normal map — CDN for dev, place in /public/textures/ for offline prod */
export const WATER_NORMALS_URL = 'https://threejs.org/examples/textures/waternormals.jpg'
