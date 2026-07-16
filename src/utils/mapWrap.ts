import type L from 'leaflet'

/**
 * Given a canonical longitude and the map's current (possibly unwrapped,
 * e.g. west=170 east=200) bounds, return whichever of lon-360/lon/lon+360
 * actually falls inside those bounds — i.e. the value to use so the point
 * renders in the world-copy currently in view. Null if none match.
 */
export function wrappedLon(lon: number, bounds: L.LatLngBounds): number | null {
  const west = bounds.getWest()
  const east = bounds.getEast()
  const center = (west + east) / 2
  const candidates = [lon - 360, lon, lon + 360]
  let best: number | null = null
  let bestDist = Infinity
  for (const c of candidates) {
    if (c >= west && c <= east) {
      const d = Math.abs(c - center)
      if (d < bestDist) { bestDist = d; best = c }
    }
  }
  return best
}

/**
 * Rewrites a sequence of canonical longitudes so consecutive points never
 * jump by more than 180° — e.g. a vessel whose real track crosses the
 * antimeridian (179.5 -> -179.8) produces a continuous run like
 * [179.5, 180.2] instead of a ~359° discontinuity. Without this, a polyline
 * drawn through the raw points would cut clear across the globe. Values may
 * end up outside [-180, 180]; that's intentional — the result is meant to be
 * shifted as a whole afterward (see call sites), not displayed as-is.
 */
export function unwrapLons(lons: readonly number[]): number[] {
  if (lons.length === 0) return []
  const out: number[] = [lons[0]]
  for (let i = 1; i < lons.length; i++) {
    let v = lons[i]
    const prev = out[i - 1]
    while (v - prev > 180) v -= 360
    while (v - prev < -180) v += 360
    out.push(v)
  }
  return out
}
