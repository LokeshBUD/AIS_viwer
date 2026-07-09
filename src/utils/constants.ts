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
export const ANOMALY_WINDOW_SECS = 120

/** SOG fraction drop to trigger speed-drop anomaly (0.5 = 50%) */
export const SPEED_DROP_THRESHOLD = 0.5

/** Degrees of COG change within window to trigger heading anomaly */
export const HEADING_CHANGE_THRESHOLD = 45

/** Vessels not seen within this ms are purged */
export const STALE_VESSEL_MS = 10 * 60 * 1000

export const RECONNECT_DELAYS_MS = [1000, 2000, 4000, 8000, 16000]

/** Water normal map — CDN for dev, place in /public/textures/ for offline prod */
export const WATER_NORMALS_URL = 'https://threejs.org/examples/textures/waternormals.jpg'
