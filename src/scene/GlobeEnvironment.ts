import * as THREE from 'three'
import { TileGlobe, SUN_DIR } from './TileGlobe'

// ─────────────────────────────────────────────────────────────────────────────

export class GlobeEnvironment {
  private tileGlobe: TileGlobe

  constructor(scene: THREE.Scene) {
    this.buildStarfield(scene)
    this.tileGlobe = new TileGlobe(scene)   // satellite tile earth
    this.buildLighting(scene)
  }

  private buildStarfield(scene: THREE.Scene): void {
    const count = 18_000
    const pos   = new Float32Array(count * 3)
    for (let i = 0; i < count; i++) {
      const theta = Math.random() * Math.PI * 2
      const phi   = Math.acos(2 * Math.random() - 1)
      const r     = 900 + Math.random() * 300
      pos[i * 3]     = r * Math.sin(phi) * Math.cos(theta)
      pos[i * 3 + 1] = r * Math.cos(phi)
      pos[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta)
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    scene.add(new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xffffff, size: 0.5, sizeAttenuation: true })))
  }

  private buildLighting(scene: THREE.Scene): void {
    scene.add(new THREE.AmbientLight(0x111133, 1.5))

    const sun = new THREE.DirectionalLight(0xfff6ee, 3.5)
    sun.position.copy(SUN_DIR.clone().multiplyScalar(500))
    scene.add(sun)

    const fill = new THREE.DirectionalLight(0x0a1a50, 0.8)
    fill.position.set(-300, -100, -200)
    scene.add(fill)
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  update(_dt: number): void { /* future: animate sun */ }

  dispose(): void { this.tileGlobe.dispose() }
}
