import * as THREE from 'three'
import type { VesselCategory } from '../ais/types'

// ── Ship icon sprites — one cached texture per hex color ──────────────────────

const TEX_CACHE = new Map<number, THREE.Texture>()

function getIconTexture(col: number): THREE.Texture {
  if (TEX_CACHE.has(col)) return TEX_CACHE.get(col)!
  const tex = new THREE.CanvasTexture(drawShipIcon(col))
  TEX_CACHE.set(col, tex)
  return tex
}

function drawShipIcon(col: number): HTMLCanvasElement {
  const W = 48, H = 72, cx = W / 2
  const canvas = document.createElement('canvas')
  canvas.width = W; canvas.height = H
  const ctx = canvas.getContext('2d')!
  const hex = '#' + col.toString(16).padStart(6, '0')

  // ── Hull path (bow at top, stern at bottom) ───────────────────────────────
  ctx.beginPath()
  ctx.moveTo(cx,      4)          // bow tip
  ctx.lineTo(cx + 15, 24)         // bow-right flare
  ctx.lineTo(cx + 13, 56)         // stern-right
  ctx.lineTo(cx +  8, 63)         // stern-right corner
  ctx.lineTo(cx -  8, 63)         // stern-left corner
  ctx.lineTo(cx - 13, 56)         // stern-left
  ctx.lineTo(cx - 15, 24)         // bow-left flare
  ctx.closePath()

  // White glow behind hull (visibility against dark backgrounds)
  ctx.shadowColor = 'rgba(255,255,255,0.9)'
  ctx.shadowBlur  = 6
  ctx.strokeStyle = 'rgba(255,255,255,1.0)'
  ctx.lineWidth   = 4
  ctx.lineJoin    = 'round'
  ctx.stroke()

  // Hull fill
  ctx.shadowBlur = 0
  ctx.fillStyle  = hex
  ctx.fill()

  // Hull outline (crisp)
  ctx.strokeStyle = 'rgba(255,255,255,0.95)'
  ctx.lineWidth   = 2
  ctx.stroke()

  // ── Superstructure / bridge block ─────────────────────────────────────────
  ctx.fillStyle = 'rgba(255,255,255,0.55)'
  const bx = cx - 7, by = 32, bw = 14, bh = 12
  ctx.fillRect(bx, by, bw, bh)
  ctx.strokeStyle = 'rgba(255,255,255,0.3)'
  ctx.lineWidth   = 1
  ctx.strokeRect(bx, by, bw, bh)

  // ── Bow centerline ────────────────────────────────────────────────────────
  ctx.strokeStyle = 'rgba(255,255,255,0.6)'
  ctx.lineWidth   = 1.5
  ctx.beginPath()
  ctx.moveTo(cx, 4)
  ctx.lineTo(cx, 30)
  ctx.stroke()

  return canvas
}

// ── Geometry cache (for size hints) ──────────────────────────────────────────

export const CATEGORY_COLORS: Record<VesselCategory, number> = {
  cargo:     0x4a9eff,
  tanker:    0xff6b35,
  tugboat:   0xffdd57,
  passenger: 0x7fff7f,
  fishing:   0xff9f7f,
  military:  0x6aaa4f,
  unknown:   0xaaaacc,
}

export class VesselMeshFactory {
  /**
   * Create a billboard sprite with ship-icon texture.
   * The sprite's `rotation` property is updated each tick in world→screen projection.
   */
  static createSprite(cat: VesselCategory, colorOverride?: number): THREE.Sprite {
    const col = colorOverride ?? CATEGORY_COLORS[cat]
    const mat = new THREE.SpriteMaterial({
      map:             getIconTexture(col),
      transparent:     true,
      depthTest:       true,    // occluded by globe — back-side vessels hidden
      depthWrite:      false,
      sizeAttenuation: false,   // fixed screen-pixel size regardless of zoom
    })
    const sprite    = new THREE.Sprite(mat)
    sprite.name        = `vessel_${cat}`
    sprite.renderOrder = 10    // render after globe tiles (renderOrder 2-3)

    // sizeAttenuation=false: 1.0 = half screen height.
    // 0.028 ≈ ~15px tall on 1080p
    const base   = 0.028
    const aspect = 0.67
    sprite.scale.set(base * aspect, base, 1)
    return sprite
  }

  static getColor(cat: VesselCategory): number {
    return CATEGORY_COLORS[cat]
  }

  static getTexture(col: number): THREE.Texture {
    return getIconTexture(col)
  }

  static disposeAll(): void {
    TEX_CACHE.forEach(t => t.dispose())
    TEX_CACHE.clear()
  }
}
