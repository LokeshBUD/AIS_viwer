/**
 * Maritime routing via searoute-ts's global maritime network (2025 Eurostat
 * marnet + ORNL shipping-lane data). Snaps origin/destination to the nearest
 * sea point and returns the shortest real sea route, hugging coastlines and
 * routing through canals/straits (Suez, Panama, Malacca, Hormuz, etc) where
 * that's the shortest path.
 */

export interface NavPoint { lat: number; lon: number; label: string }

// searoute-ts bundles a ~1.8MB global maritime network graph — load it lazily
// on first route request instead of eagerly in the main bundle, and cache the
// module so repeat calls don't re-pay the import.
let searouteMod: typeof import('searoute-ts') | null = null

/**
 * Compute maritime route waypoints from (fromLat, fromLon) to (toLat, toLon).
 * Returns ordered array of NavPoints including source and destination.
 * Falls back to a direct line if no sea route can be found.
 */
export async function maritimeRoute(
  fromLat: number, fromLon: number,
  toLat: number,   toLon: number,
): Promise<NavPoint[]> {
  const { seaRoute, NoRouteError, SnapFailedError } = searouteMod ??= await import('searoute-ts')
  try {
    // appendOriginDestination: searoute-ts otherwise starts/ends the path at
    // the nearest snapped network node, which can visibly miss the vessel's
    // actual position (e.g. in a bay) — force the raw coords onto both ends.
    const route = seaRoute([fromLon, fromLat], [toLon, toLat], { appendOriginDestination: true })
    return route.geometry.coordinates.map(([lon, lat]) => ({ lat, lon, label: '' }))
  } catch (err) {
    if (err instanceof SnapFailedError || err instanceof NoRouteError) {
      return [
        { lat: fromLat, lon: fromLon, label: 'Origin' },
        { lat: toLat,   lon: toLon,   label: 'Destination' },
      ]
    }
    throw err
  }
}
