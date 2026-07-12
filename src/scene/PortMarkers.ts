import * as THREE from 'three'
import { latLonToVec3 } from '../utils/CoordMapper'
import { GLOBE_RADIUS } from '../utils/constants'
import { CONTINENT_COLORS, PORTS_LIST } from '../utils/ports'

// Fixed screen sizes (sizeAttenuation=false units, where 1.0 = half screen height)
const PORT_SIZE  = 0.018   // ~10px on 1080p
const LABEL_SHOW_DIST = 175   // camera dist from globe center
const LABEL_FULL_DIST = 130

interface PortEntry {
  dot:   THREE.Sprite
  label: THREE.Sprite
  dir:   THREE.Vector3   // unit vector pointing from globe center to port surface
}

const _camDir = new THREE.Vector3()

export class PortMarkers {
  private group   = new THREE.Group()
  private entries: PortEntry[] = []

  constructor(scene: THREE.Scene) {
    this.build()
    scene.add(this.group)
  }

  private build(): void {
    for (const port of PORTS_LIST) {
      const col    = CONTINENT_COLORS[port.continent]
      const colHex = '#' + col.toString(16).padStart(6, '0')
      const pos    = latLonToVec3(port.lat, port.lon, GLOBE_RADIUS, 1.5)
      const dir    = pos.clone().normalize()

      // ── Port dot ───────────────────────────────────────────────────────────
      const dotMat = new THREE.SpriteMaterial({
        map:             buildDotTexture(col),
        transparent:     true,
        depthTest:       true,
        depthWrite:      false,
        sizeAttenuation: false,
      })
      const dot = new THREE.Sprite(dotMat)
      dot.position.copy(pos)
      dot.scale.set(PORT_SIZE, PORT_SIZE, 1)
      this.group.add(dot)

      // ── Port label ─────────────────────────────────────────────────────────
      const labelMat = new THREE.SpriteMaterial({
        map:             buildLabelTexture(port.name, port.code, colHex),
        transparent:     true,
        depthTest:       true,    // occluded by globe — no back-side bleed
        depthWrite:      false,
        sizeAttenuation: false,
        opacity:         0,
      })
      const label = new THREE.Sprite(labelMat)
      label.position.copy(pos).addScaledVector(dir, 1.0)
      label.scale.set(PORT_SIZE * 5.5, PORT_SIZE * 1.4, 1)
      label.visible = false
      this.group.add(label)

      this.entries.push({ dot, label, dir })
    }
  }

  tick(camera: THREE.PerspectiveCamera): void {
    const camDist  = camera.position.length()
    const showLabels = camDist < LABEL_SHOW_DIST
    const alpha = showLabels
      ? Math.min(1, (LABEL_SHOW_DIST - camDist) / (LABEL_SHOW_DIST - LABEL_FULL_DIST))
      : 0

    _camDir.copy(camera.position).normalize()

    for (const { dot, label, dir } of this.entries) {
      // Hemisphere cull — hide anything on the back side of the globe
      const onFront = dir.dot(_camDir) > -0.05
      dot.visible   = onFront
      label.visible = onFront && showLabels
      if (onFront && showLabels) {
        ;(label.material as THREE.SpriteMaterial).opacity = alpha
      }
    }
  }

  dispose(): void {
    this.group.traverse(obj => {
      if (obj instanceof THREE.Sprite) {
        ;(obj.material as THREE.SpriteMaterial).map?.dispose()
        ;(obj.material as THREE.Material).dispose()
      }
    })
  }
}

// ─── Texture builders ─────────────────────────────────────────────────────────

function buildDotTexture(col: number): THREE.CanvasTexture {
  const S  = 64
  const cv = document.createElement('canvas')
  cv.width = S; cv.height = S
  const ctx = cv.getContext('2d')!
  const hex = '#' + col.toString(16).padStart(6, '0')
  const cx  = S / 2

  // Outer glow
  const grd = ctx.createRadialGradient(cx, cx, cx * 0.3, cx, cx, cx)
  grd.addColorStop(0,   hex)
  grd.addColorStop(0.55, hex)
  grd.addColorStop(0.75, hex + '99')
  grd.addColorStop(1,   hex + '00')
  ctx.fillStyle = grd
  ctx.beginPath()
  ctx.arc(cx, cx, cx, 0, Math.PI * 2)
  ctx.fill()

  // White ring
  ctx.strokeStyle = 'rgba(255,255,255,0.9)'
  ctx.lineWidth   = S * 0.07
  ctx.beginPath()
  ctx.arc(cx, cx, cx * 0.52, 0, Math.PI * 2)
  ctx.stroke()

  return new THREE.CanvasTexture(cv)
}

function buildLabelTexture(name: string, code: string, hex: string): THREE.CanvasTexture {
  const W = 280, H = 48
  const cv = document.createElement('canvas')
  cv.width = W; cv.height = H
  const ctx = cv.getContext('2d')!

  // Background
  ctx.fillStyle = 'rgba(5,15,30,0.88)'
  roundRect(ctx, 0, 4, W, H - 4, 6)
  ctx.fill()

  // Colored left accent
  ctx.fillStyle = hex
  roundRect(ctx, 0, 4, 4, H - 4, [6, 0, 0, 6])
  ctx.fill()

  // Port name
  ctx.font      = 'bold 16px monospace'
  ctx.fillStyle = '#e8f4ff'
  ctx.textAlign = 'left'
  ctx.fillText(name.substring(0, 16).toUpperCase(), 12, 22)

  // UNLOC code
  ctx.font      = '12px monospace'
  ctx.fillStyle = hex
  ctx.fillText(code, 12, 38)

  return new THREE.CanvasTexture(cv)
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number,
  r: number | [number, number, number, number],
): void {
  const [tl, tr, br, bl] = Array.isArray(r) ? r : [r, r, r, r]
  ctx.beginPath()
  ctx.moveTo(x + tl, y)
  ctx.lineTo(x + w - tr, y);     ctx.arcTo(x + w, y,     x + w, y + tr,     tr)
  ctx.lineTo(x + w, y + h - br); ctx.arcTo(x + w, y + h, x + w - br, y + h, br)
  ctx.lineTo(x + bl, y + h);     ctx.arcTo(x,     y + h, x,     y + h - bl,  bl)
  ctx.lineTo(x, y + tl);         ctx.arcTo(x,     y,     x + tl, y,           tl)
  ctx.closePath()
}
