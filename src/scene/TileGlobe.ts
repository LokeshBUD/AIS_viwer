/**
 * Tile-based globe — CartoDB Voyager.
 *
 * Blue ocean, tan/beige land, visible country + state borders, major city labels.
 * No street detail at globe zoom levels (z=2–3).
 *
 * Strategy:
 *  • Start with zoom=2 (16 tiles, loads instantly)
 *  • After 1.2 s upgrade to zoom=3 (64 tiles) — shows country borders + cities.
 *  • zoom=4+ not needed: camera never gets close enough to benefit.
 */

import * as THREE from 'three'
import { latLonToVec3 } from '../utils/CoordMapper'
import { GLOBE_RADIUS } from '../utils/constants'

// ── Sun direction (used by GlobeEnvironment for directional lighting) ─────────
export const SUN_DIR = new THREE.Vector3(400, 150, 300).normalize()

// ── CartoDB Voyager tile URL (z/x/y order, 4 subdomains for parallel loads) ───
// Voyager: blue ocean, tan land, country/state borders, city labels, no streets.
const SUBDOMAINS = ['a', 'b', 'c', 'd']
let _sdIdx = 0
const CARTO = (z: number, tx: number, ty: number) => {
  const s = SUBDOMAINS[_sdIdx++ % 4]
  return `https://${s}.basemaps.cartocdn.com/rastertiles/voyager/${z}/${tx}/${ty}.png`
}

// ── Web Mercator helpers ──────────────────────────────────────────────────────

function tileXToLon(x: number, z: number): number {
  return (x / Math.pow(2, z)) * 360 - 180
}

function tileYToLat(y: number, z: number): number {
  const n = Math.PI - (2 * Math.PI * y) / Math.pow(2, z)
  return (180 / Math.PI) * Math.atan(Math.sinh(n))
}

/** Mercator y-value for latitude (used for correct UV mapping) */
function mercY(latDeg: number): number {
  const r = latDeg * Math.PI / 180
  return Math.log(Math.tan(Math.PI / 4 + r / 2))
}

// ── Tile patch geometry ───────────────────────────────────────────────────────

const SEG = 14  // subdivision per tile — smooth sphere curvature

function createPatch(z: number, tx: number, ty: number): THREE.BufferGeometry {
  const lon1 = tileXToLon(tx,     z)
  const lon2 = tileXToLon(tx + 1, z)
  const lat1 = tileYToLat(ty,     z)   // north edge
  const lat2 = tileYToLat(ty + 1, z)   // south edge

  const mN  = mercY(lat1)   // Mercator y at north edge
  const mS  = mercY(lat2)   //                south edge

  const positions: number[] = []
  const normals:   number[] = []
  const uvs:       number[] = []
  const indices:   number[] = []

  for (let j = 0; j <= SEG; j++) {
    for (let i = 0; i <= SEG; i++) {
      const u = i / SEG
      const v = j / SEG

      // Interpolate lon linearly (Mercator is linear in lon)
      const lon = lon1 + (lon2 - lon1) * u

      // Interpolate lat using Mercator y for correct UV alignment
      // Mercator y varies linearly with tile pixel row
      const mLerp = mN + (mS - mN) * v
      const lat   = (180 / Math.PI) * (2 * Math.atan(Math.exp(mLerp)) - Math.PI / 2)

      const pos = latLonToVec3(lat, lon, GLOBE_RADIUS)
      positions.push(pos.x, pos.y, pos.z)

      const norm = pos.clone().normalize()
      normals.push(norm.x, norm.y, norm.z)

      // UV: u linear, v uses Mercator proportion for correct image sampling
      const mCur = mercY(lat)
      const vUv  = (mCur - mN) / (mS - mN)
      uvs.push(u, 1 - vUv)    // flip V: image row 0 = north
    }
  }

  for (let j = 0; j < SEG; j++) {
    for (let i = 0; i < SEG; i++) {
      const a = j * (SEG + 1) + i
      indices.push(a, a + SEG + 1, a + 1, a + 1, a + SEG + 1, a + SEG + 2)
    }
  }

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geo.setAttribute('normal',   new THREE.Float32BufferAttribute(normals,   3))
  geo.setAttribute('uv',       new THREE.Float32BufferAttribute(uvs,       2))
  geo.setIndex(indices)
  return geo
}

// ── TileGlobe class ───────────────────────────────────────────────────────────

interface TileEntry {
  mesh:  THREE.Mesh
  mat:   THREE.MeshBasicMaterial
  z:     number
  tx:    number
  ty:    number
  ready: boolean
}

export class TileGlobe {
  private group = new THREE.Group()
  private tiles: TileEntry[] = []
  private loader = new THREE.TextureLoader()

  constructor(scene: THREE.Scene) {
    scene.add(this.group)
    this.loadZoom(2)                                 //    0 ms —  16 tiles
    setTimeout(() => this.loadZoom(3), 1200)         // 1200 ms —  64 tiles (country borders)
    setTimeout(() => this.loadZoom(4), 4000)         // 4000 ms — 256 tiles (state lines, cities)
  }

  private loadZoom(z: number): void {
    const count = Math.pow(2, z)
    for (let ty = 0; ty < count; ty++) {
      for (let tx = 0; tx < count; tx++) {
        this.loadTile(z, tx, ty)
      }
    }
  }

  private loadTile(z: number, tx: number, ty: number): void {
    const geo = createPatch(z, tx, ty)

    const mat = new THREE.MeshBasicMaterial({
      transparent: true,
      opacity:     0,
      depthWrite:  true,
    })

    const mesh = new THREE.Mesh(geo, mat)
    mesh.renderOrder = z    // higher zoom renders on top
    this.group.add(mesh)

    const entry: TileEntry = { mesh, mat, z, tx, ty, ready: false }
    this.tiles.push(entry)

    this.loader.load(
      CARTO(z, tx, ty),
      tex => {
        tex.colorSpace  = THREE.SRGBColorSpace
        mat.map         = tex
        mat.opacity     = 1
        mat.transparent = false
        mat.needsUpdate = true
        entry.ready     = true

        if (z > 2) this.hideLowerTile(z, tx, ty)
      },
    )
  }

  /**
   * When all 4 children at zoom z are ready for a given parent tile,
   * hide the parent at zoom z-1 to avoid z-fighting.
   */
  private hideLowerTile(z: number, tx: number, ty: number): void {
    const pz  = z - 1
    const ptx = Math.floor(tx / 2)
    const pty = Math.floor(ty / 2)

    const parent = this.tiles.find(t => t.z === pz && t.tx === ptx && t.ty === pty)
    if (!parent) return

    const readyChildren = this.tiles.filter(
      t => t.z === z &&
        Math.floor(t.tx / 2) === ptx &&
        Math.floor(t.ty / 2) === pty &&
        t.ready,
    )
    if (readyChildren.length === 4) parent.mesh.visible = false
  }

  dispose(): void {
    this.tiles.forEach(({ mesh, mat }) => {
      mesh.geometry.dispose()
      mat.map?.dispose()
      mat.dispose()
    })
    this.tiles = []
  }
}
