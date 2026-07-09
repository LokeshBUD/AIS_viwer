import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { GLOBE_RADIUS } from '../utils/constants'

interface FlyAnim {
  startPos: THREE.Vector3
  endPos:   THREE.Vector3
  elapsed:  number
  duration: number
}

export class SceneManager {
  readonly renderer: THREE.WebGLRenderer
  readonly scene:    THREE.Scene
  readonly camera:   THREE.PerspectiveCamera
  readonly controls: OrbitControls

  private animId  = 0
  private tickers: Array<(dt: number) => void> = []
  private lastTime = 0
  private flyAnim: FlyAnim | null = null

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.setSize(window.innerWidth, window.innerHeight)
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 0.6
    this.renderer.outputColorSpace = THREE.SRGBColorSpace

    this.scene = new THREE.Scene()
    this.scene.background = new THREE.Color(0x050f1e)   // dark navy — globe edge visible

    this.camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 5000)
    this.camera.position.set(0, 60, 260)
    this.camera.lookAt(0, 0, 0)

    this.controls = new OrbitControls(this.camera, this.renderer.domElement)

    // ── Google Maps–style controls ─────────────────────────────────────────
    this.controls.enableDamping  = true
    this.controls.dampingFactor  = 0.08     // smooth momentum feel
    this.controls.rotateSpeed    = 0.65     // comfortable for both mouse and finger
    this.controls.zoomSpeed      = 1.0
    this.controls.enablePan      = false    // globe rotates, doesn't translate
    this.controls.minDistance    = GLOBE_RADIUS + 1
    this.controls.maxDistance    = 1800
    this.controls.maxPolarAngle  = Math.PI

    // Touch gestures:
    //   1 finger → rotate globe
    //   2 fingers → pinch zoom + rotate simultaneously
    this.controls.touches = {
      ONE: THREE.TOUCH.ROTATE,
      TWO: THREE.TOUCH.DOLLY_ROTATE,
    }

    // Zoom toward cursor/touch point (Google Maps feel)
    this.controls.zoomToCursor = true

    window.addEventListener('resize', this.onResize)
  }

  /**
   * Smoothly fly camera to face a point on the globe surface.
   * Maintains current orbital distance but rotates the camera around the globe
   * so `targetWorldPos` is centered in the viewport.
   */
  focusOn(targetWorldPos: THREE.Vector3, duration = 1.2): void {
    const camDist = this.camera.position.length()
    const endPos  = targetWorldPos.clone().normalize().multiplyScalar(camDist)

    this.flyAnim = {
      startPos: this.camera.position.clone(),
      endPos,
      elapsed:  0,
      duration,
    }
    this.controls.enabled = false   // pause user input during fly
  }

  onTick(cb: (dt: number) => void): void {
    this.tickers.push(cb)
  }

  start(): void {
    this.lastTime = performance.now()
    const loop = (now: number) => {
      const dt = Math.min((now - this.lastTime) / 1000, 0.1)
      this.lastTime = now

      // ── Fly animation ──────────────────────────────────────────────────────
      if (this.flyAnim) {
        this.flyAnim.elapsed += dt
        const t  = Math.min(1, this.flyAnim.elapsed / this.flyAnim.duration)
        const te = easeInOutCubic(t)
        this.camera.position.lerpVectors(this.flyAnim.startPos, this.flyAnim.endPos, te)
        this.camera.lookAt(0, 0, 0)
        if (t >= 1) {
          this.flyAnim = null
          this.controls.enabled = true
          this.controls.update()
        }
      }

      // ── Dynamic near/far — maintains depth precision at all zoom levels ────
      const camDist   = this.camera.position.length()
      const surfaceGap = Math.max(0.01, camDist - GLOBE_RADIUS)
      this.camera.near = surfaceGap * 0.05
      this.camera.far  = camDist + GLOBE_RADIUS * 16
      this.camera.updateProjectionMatrix()

      this.controls.update()
      this.tickers.forEach(t => t(dt))
      this.renderer.render(this.scene, this.camera)
      this.animId = requestAnimationFrame(loop)
    }
    this.animId = requestAnimationFrame(loop)
  }

  dispose(): void {
    cancelAnimationFrame(this.animId)
    window.removeEventListener('resize', this.onResize)
    this.renderer.dispose()
  }

  private onResize = (): void => {
    this.camera.aspect = window.innerWidth / window.innerHeight
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(window.innerWidth, window.innerHeight)
  }
}

// ─── Easing ───────────────────────────────────────────────────────────────────

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}
