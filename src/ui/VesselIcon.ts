import L from 'leaflet'
import type { VesselCategory } from '../ais/types'

// Icon viewport: 14×22px, vessel points UP (north), rotated by COG
const W = 14, H = 22, CX = 7, CY = 13

// SVG path per category — all pointing north, rotated via transform
const SHAPES: Record<VesselCategory, string> = {
  // Large boxy hull with angled bow
  cargo:     'M7,0 L11,6 L11,21 L3,21 L3,6 Z',
  // Wider than cargo, blunter bow
  tanker:    'M7,0 L12,5 L12,21 L2,21 L2,5 Z',
  // Wide body, flat stern
  passenger: 'M7,0 L13,4 L13,20 L1,20 L1,4 Z',
  // Small, compact hull
  fishing:   'M7,2 L10,7 L10,17 L4,17 L4,7 Z',
  // Short and wide
  tugboat:   'M7,2 L11,6 L11,15 L3,15 L3,6 Z',
  // Narrow pointed warship hull
  military:  'M7,0 L9,8 L9,21 L5,21 L5,8 Z',
  // Simple arrowhead
  unknown:   'M7,0 L12,21 L7,16 L2,21 Z',
}

export function makeVesselDivIcon(
  category: VesselCategory,
  color: string,
  cog: number,
): L.DivIcon {
  const path  = SHAPES[category] ?? SHAPES.unknown
  const cogDeg = isFinite(cog) ? cog : 0

  return L.divIcon({
    html: `<div class="vi"><svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" overflow="visible">
      <path d="${path}" fill="${color}" stroke="#000" stroke-width="0.6" stroke-linejoin="round"
        transform="rotate(${cogDeg},${CX},${CY})"/>
    </svg></div>`,
    className:   '',           // suppress leaflet default white square
    iconSize:    [W, H],
    iconAnchor:  [CX, CY],    // anchor = center of icon
    popupAnchor: [0, -CY],
  })
}

/** Update rotation + color in-place without recreating the icon */
export function updateVesselIconTransform(
  marker: L.Marker,
  color: string,
  cog: number,
): void {
  const el = marker.getElement()?.querySelector<SVGPathElement>('path')
  if (!el) return
  const cogDeg = isFinite(cog) ? cog : 0
  el.setAttribute('transform', `rotate(${cogDeg},${CX},${CY})`)
  el.setAttribute('fill', color)
}

export function setVesselMarkerState(
  marker: L.Marker,
  state: 'normal' | 'selected' | 'dimmed' | 'hidden',
): void {
  const el = marker.getElement()?.querySelector<HTMLElement>('.vi')
  if (!el) return
  el.className = `vi vi-${state}`
  // Z-order: selected vessel renders above others
  marker.setZIndexOffset(state === 'selected' ? 1000 : 0)
}
