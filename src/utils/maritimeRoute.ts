/**
 * Maritime routing via a sparse navigational graph.
 * Vessels route through real chokepoints: Suez Canal, Panama Canal,
 * Strait of Malacca, Cape of Good Hope, Cape Horn, Gibraltar, Hormuz, etc.
 *
 * Algorithm: Dijkstra on a ~45-node graph of ocean waypoints.
 * Source/destination are temporarily added as virtual nodes connected to
 * their 4 nearest graph nodes.
 */

export interface NavPoint { lat: number; lon: number; label: string }

// ─── Navigational graph nodes ─────────────────────────────────────────────────

const N: Record<string, NavPoint> = {
  // Northern Europe
  N_EU:       { lat: 57.0,  lon:   4.0,  label: 'North Sea' },
  DOVER:      { lat: 51.1,  lon:   1.5,  label: 'Dover Strait' },
  BISCAY:     { lat: 46.0,  lon: -10.0,  label: 'Bay of Biscay' },
  IBERIA:     { lat: 37.0,  lon:  -9.0,  label: 'Iberian Coast' },

  // Mediterranean gateway
  GIBRALTAR:  { lat: 35.97, lon:  -5.45, label: 'Gibraltar' },
  W_MED:      { lat: 38.0,  lon:   5.0,  label: 'W Mediterranean' },
  E_MED:      { lat: 34.5,  lon:  30.0,  label: 'E Mediterranean' },

  // Suez Canal
  SUEZ_N:     { lat: 31.27, lon:  32.34, label: 'Port Said' },
  SUEZ_S:     { lat: 29.93, lon:  32.56, label: 'Suez' },

  // Red Sea & Gulf of Aden
  RED_MID:    { lat: 20.0,  lon:  38.0,  label: 'Red Sea' },
  BAB_EL_M:   { lat: 11.62, lon:  43.47, label: 'Bab el-Mandeb' },
  GULF_ADEN:  { lat: 12.0,  lon:  48.0,  label: 'Gulf of Aden' },

  // Persian Gulf
  HORMUZ:     { lat: 26.57, lon:  56.97, label: 'Strait of Hormuz' },
  ARABIAN_S:  { lat: 15.0,  lon:  63.0,  label: 'Arabian Sea' },

  // Indian Ocean
  W_INDIAN:   { lat:  5.0,  lon:  65.0,  label: 'W Indian Ocean' },
  IO_CENTRAL: { lat: -5.0,  lon:  72.0,  label: 'Indian Ocean' },
  IO_SE:      { lat:-15.0,  lon:  85.0,  label: 'SE Indian Ocean' },
  S_INDIAN:   { lat:-35.0,  lon:  80.0,  label: 'S Indian Ocean' },
  IO_E:       { lat: -5.0,  lon:  95.0,  label: 'E Indian Ocean' },

  // Malacca Strait
  MALACCA_NW: { lat:  5.57, lon:  98.58, label: 'NW Malacca' },
  MALACCA_SE: { lat:  1.26, lon: 103.83, label: 'Singapore Strait' },

  // South China Sea & East Asia
  SCS:        { lat: 15.0,  lon: 115.0,  label: 'South China Sea' },
  E_CHINA:    { lat: 30.0,  lon: 122.0,  label: 'E China Sea' },
  JAPAN_SEA:  { lat: 35.0,  lon: 137.0,  label: 'Japan / Korea' },

  // Pacific
  PAC_W:      { lat: 40.0,  lon: 160.0,  label: 'W Pacific' },
  PAC_MID_N:  { lat: 45.0,  lon: 175.0,  label: 'N Mid Pacific' },
  PAC_MID_S:  { lat:  5.0,  lon: 175.0,  label: 'S Mid Pacific' },
  PAC_NE:     { lat: 50.0,  lon:-155.0,  label: 'NE Pacific' },
  PAC_E:      { lat: 15.0,  lon:-120.0,  label: 'E Pacific' },
  PAC_SE:     { lat:-38.0,  lon:-100.0,  label: 'SE Pacific' },

  // Oceania
  OCEANIA:    { lat:-30.0,  lon: 170.0,  label: 'SW Pacific' },

  // Capes
  CAPE_GH:    { lat:-34.4,  lon:  18.5,  label: 'Cape of Good Hope' },
  CAPE_AG:    { lat:-34.8,  lon:  26.0,  label: 'S Africa offshore' },

  // Cape Horn
  CAPE_HORN:  { lat:-55.9,  lon: -67.3,  label: 'Cape Horn' },

  // West Africa
  CANARY:     { lat: 28.0,  lon: -15.0,  label: 'Canary Islands' },
  W_AFR_N:    { lat: 15.0,  lon: -17.0,  label: 'W Africa (North)' },
  W_AFR:      { lat:  5.0,  lon:  -5.0,  label: 'W Africa (Gulf)' },
  W_AFR_S:    { lat: -5.0,  lon:   5.0,  label: 'W Africa (South)' },

  // Atlantic
  S_ATL:      { lat:  0.0,  lon: -25.0,  label: 'S Atlantic' },
  N_ATL:      { lat: 50.0,  lon: -30.0,  label: 'N Atlantic' },
  S_ATL_S:    { lat:-40.0,  lon: -15.0,  label: 'S Atlantic (deep)' },

  // South America East
  S_AME_E:    { lat:-25.0,  lon: -45.0,  label: 'SE South America' },

  // Panama Canal
  PANAMA_PAC: { lat:  8.87, lon: -79.52, label: 'Panama (Pacific)' },
  PANAMA_ATL: { lat:  9.37, lon: -79.92, label: 'Panama (Atlantic)' },

  // Caribbean
  CARIB:      { lat: 15.0,  lon: -70.0,  label: 'Caribbean' },

  // North America coasts
  NA_E:       { lat: 38.0,  lon: -73.0,  label: 'N America East' },
  NA_NE:      { lat: 46.0,  lon: -60.0,  label: 'N America NE' },
  NA_W:       { lat: 35.0,  lon:-125.0,  label: 'N America West' },
  NA_NW:      { lat: 50.0,  lon:-130.0,  label: 'N America NW' },
}

// ─── Graph edges (bidirectional, open-ocean passages) ─────────────────────────

const EDGES: [string, string][] = [
  // Northern Europe approaches
  ['N_EU', 'DOVER'], ['N_EU', 'N_ATL'], ['N_EU', 'NA_NE'],
  ['DOVER', 'BISCAY'], ['DOVER', 'N_ATL'],
  ['BISCAY', 'IBERIA'], ['BISCAY', 'N_ATL'],
  ['IBERIA', 'GIBRALTAR'], ['IBERIA', 'CANARY'],

  // Mediterranean
  ['GIBRALTAR', 'W_MED'], ['GIBRALTAR', 'CANARY'],
  ['W_MED', 'E_MED'],
  ['E_MED', 'SUEZ_N'],

  // Suez Canal
  ['SUEZ_N', 'SUEZ_S'],
  ['SUEZ_S', 'RED_MID'],
  ['RED_MID', 'BAB_EL_M'],
  ['BAB_EL_M', 'GULF_ADEN'],

  // Persian Gulf branch
  ['HORMUZ', 'ARABIAN_S'],
  ['ARABIAN_S', 'GULF_ADEN'],
  ['ARABIAN_S', 'W_INDIAN'],

  // Indian Ocean
  ['GULF_ADEN', 'W_INDIAN'],
  ['W_INDIAN', 'IO_CENTRAL'],
  ['W_INDIAN', 'ARABIAN_S'],
  ['IO_CENTRAL', 'MALACCA_NW'],
  ['IO_CENTRAL', 'IO_SE'],
  ['IO_CENTRAL', 'IO_E'],
  ['IO_SE', 'S_INDIAN'],
  ['IO_SE', 'IO_E'],
  ['IO_E', 'MALACCA_NW'],
  ['IO_E', 'OCEANIA'],
  ['S_INDIAN', 'CAPE_AG'],
  ['S_INDIAN', 'OCEANIA'],

  // Malacca → East Asia
  ['MALACCA_NW', 'MALACCA_SE'],
  ['MALACCA_SE', 'SCS'],
  ['MALACCA_SE', 'IO_E'],
  ['SCS', 'E_CHINA'],
  ['SCS', 'PAC_MID_S'],
  ['E_CHINA', 'JAPAN_SEA'],

  // Pacific routes
  ['JAPAN_SEA', 'PAC_W'],
  ['PAC_W', 'PAC_MID_N'],
  ['PAC_W', 'OCEANIA'],
  ['PAC_MID_N', 'PAC_NE'],
  ['PAC_MID_N', 'PAC_MID_S'],
  ['PAC_MID_S', 'PAC_E'],
  ['PAC_MID_S', 'OCEANIA'],
  ['PAC_NE', 'NA_NW'],
  ['PAC_NE', 'PAC_E'],
  ['PAC_E', 'NA_W'],
  ['PAC_E', 'PANAMA_PAC'],
  ['PAC_SE', 'PANAMA_PAC'],
  ['PAC_SE', 'CAPE_HORN'],

  // Oceania
  ['OCEANIA', 'PAC_MID_S'],
  ['OCEANIA', 'S_INDIAN'],

  // Cape of Good Hope route
  ['CAPE_GH', 'CAPE_AG'],
  ['CAPE_AG', 'S_ATL_S'],
  ['CAPE_AG', 'S_INDIAN'],
  ['S_ATL_S', 'CAPE_HORN'],
  ['S_ATL_S', 'S_ATL'],

  // West Africa coast
  ['GIBRALTAR', 'CANARY'],
  ['CANARY', 'W_AFR_N'],
  ['W_AFR_N', 'W_AFR'],
  ['W_AFR', 'W_AFR_S'],
  ['W_AFR_S', 'S_ATL'],
  ['W_AFR_S', 'CAPE_GH'],

  // Atlantic
  ['S_ATL', 'N_ATL'],
  ['S_ATL', 'S_AME_E'],
  ['N_ATL', 'NA_E'],
  ['N_ATL', 'NA_NE'],
  ['NA_E', 'NA_NE'],
  ['NA_E', 'CARIB'],

  // South America East
  ['S_AME_E', 'CAPE_HORN'],
  ['S_AME_E', 'PANAMA_ATL'],

  // Panama Canal
  ['PANAMA_ATL', 'CARIB'],
  ['PANAMA_ATL', 'PANAMA_PAC'],
  ['PANAMA_PAC', 'NA_W'],

  // North America West
  ['NA_W', 'NA_NW'],
  ['NA_NW', 'PAC_NE'],
  ['NA_W', 'PAC_E'],
  ['NA_NW', 'PAC_MID_N'],

  // Caribbean to East coasts
  ['CARIB', 'S_AME_E'],
  ['CARIB', 'NA_E'],
]

// ─── Haversine distance (km) ─────────────────────────────────────────────────

function hvDist(a: NavPoint, b: NavPoint): number {
  const R = 6371
  const dLat = (b.lat - a.lat) * Math.PI / 180
  const dLon = (b.lon - a.lon) * Math.PI / 180
  const sinA = Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * Math.sin(dLon / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(sinA), Math.sqrt(1 - sinA))
}

// ─── Build adjacency list ─────────────────────────────────────────────────────

function buildAdjList(extraNodes: Record<string, NavPoint>): Map<string, [string, number][]> {
  const all = { ...N, ...extraNodes }
  const adj = new Map<string, [string, number][]>()

  const allEdges: [string, string][] = [...EDGES]
  // Connect extra nodes (SRC / DST) to their 4 nearest graph nodes
  for (const ek of Object.keys(extraNodes)) {
    const ep = all[ek]
    const byDist = Object.keys(N)
      .map(k => ({ k, d: hvDist(ep, N[k]) }))
      .sort((a, b) => a.d - b.d)
    byDist.slice(0, 4).forEach(({ k }) => allEdges.push([ek, k]))
  }

  for (const [a, b] of allEdges) {
    if (!all[a] || !all[b]) continue
    const d = hvDist(all[a], all[b])
    if (!adj.has(a)) adj.set(a, [])
    if (!adj.has(b)) adj.set(b, [])
    adj.get(a)!.push([b, d])
    adj.get(b)!.push([a, d])
  }
  return adj
}

// ─── Dijkstra ────────────────────────────────────────────────────────────────

function dijkstra(
  adj: Map<string, [string, number][]>,
  src: string,
  dst: string,
): string[] {
  const dist = new Map<string, number>()
  const prev = new Map<string, string>()
  const pq: [number, string][] = [[0, src]]

  adj.forEach((_, k) => dist.set(k, Infinity))
  dist.set(src, 0)

  while (pq.length > 0) {
    pq.sort((a, b) => a[0] - b[0])
    const [d, u] = pq.shift()!
    if (d > (dist.get(u) ?? Infinity)) continue
    if (u === dst) break

    for (const [v, w] of adj.get(u) ?? []) {
      const nd = d + w
      if (nd < (dist.get(v) ?? Infinity)) {
        dist.set(v, nd)
        prev.set(v, u)
        pq.push([nd, v])
      }
    }
  }

  // Reconstruct path
  const path: string[] = []
  let cur: string | undefined = dst
  while (cur) {
    path.unshift(cur)
    cur = prev.get(cur)
  }
  return path[0] === src ? path : []
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Compute maritime route waypoints from (fromLat, fromLon) to (toLat, toLon).
 * Returns ordered array of NavPoints including source and destination.
 * Falls back to direct line if no path found.
 */
export function maritimeRoute(
  fromLat: number, fromLon: number,
  toLat: number,   toLon: number,
): NavPoint[] {
  const src: NavPoint = { lat: fromLat, lon: fromLon, label: 'Origin' }
  const dst: NavPoint = { lat: toLat,   lon: toLon,   label: 'Destination' }

  const extras: Record<string, NavPoint> = { SRC: src, DST: dst }
  const all = { ...N, ...extras }
  const adj = buildAdjList(extras)

  const path = dijkstra(adj, 'SRC', 'DST')
  if (!path.length) return [src, dst]

  return path.map(k => all[k])
}
