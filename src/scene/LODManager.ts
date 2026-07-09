import * as THREE from 'three'
import { EventBus, Events } from '../utils/EventBus'
import { VesselMesh } from './VesselMesh'
import type { VesselState } from '../ais/types'

export class LODManager {
  private meshes = new Map<number, VesselMesh>()
  private raycaster = new THREE.Raycaster()
  private selectedMmsi: number | null = null

  constructor(
    private scene: THREE.Scene,
    private camera: THREE.PerspectiveCamera,
  ) {
    // Wider threshold so sprites (which have no exact hit surface) are easier to click
    this.raycaster.params.Sprite = { threshold: 0.5 } as unknown as { threshold: number }
    EventBus.on<VesselState>(Events.VESSEL_UPDATED, v => this.onVesselUpdated(v))
    EventBus.on<number>(Events.VESSEL_LOST, mmsi => this.onVesselLost(mmsi))
  }

  private onVesselUpdated(state: VesselState): void {
    let vm = this.meshes.get(state.mmsi)
    if (!vm) {
      vm = new VesselMesh(state)
      this.scene.add(vm.group)
      this.scene.add(vm.arcLine)
      this.meshes.set(state.mmsi, vm)
    }
    vm.applyState(state)
  }

  private onVesselLost(mmsi: number): void {
    const vm = this.meshes.get(mmsi)
    if (!vm) return
    this.scene.remove(vm.group)
    this.scene.remove(vm.arcLine)
    vm.dispose()
    this.meshes.delete(mmsi)
    if (this.selectedMmsi === mmsi) {
      this.selectedMmsi = null
      EventBus.emit(Events.VESSEL_DESELECTED, mmsi)
    }
  }

  tick(dt: number): void {
    const camPos = this.camera.position
    for (const vm of this.meshes.values()) {
      vm.tick(dt, this.camera)
      vm.setLOD(camPos.distanceTo(vm.group.position))
    }
  }

  pick(ndc: THREE.Vector2): void {
    this.raycaster.setFromCamera(ndc, this.camera)

    const targets: THREE.Object3D[] = []
    const objToMmsi = new Map<THREE.Object3D, number>()

    for (const [mmsi, vm] of this.meshes) {
      for (const t of vm.getPickTargets()) {
        targets.push(t)
        objToMmsi.set(t, mmsi)
      }
    }

    const hits = this.raycaster.intersectObjects(targets, false)
    if (!hits.length) {
      if (this.selectedMmsi !== null) {
        this.deselect()
      }
      return
    }

    const mmsi = objToMmsi.get(hits[0].object)
    if (mmsi === undefined) return

    if (this.selectedMmsi === mmsi) return   // already selected

    if (this.selectedMmsi !== null) this.deselect()

    this.selectedMmsi = mmsi
    this.meshes.get(mmsi)?.setHighlight(true)
    this.setIsolation(mmsi)                   // hide all other vessels
    EventBus.emit(Events.VESSEL_SELECTED, mmsi)
  }

  private deselect(): void {
    if (this.selectedMmsi === null) return
    this.meshes.get(this.selectedMmsi)?.setHighlight(false)
    EventBus.emit(Events.VESSEL_DESELECTED, this.selectedMmsi)
    this.selectedMmsi = null
    this.clearIsolation()                     // show all vessels again
  }

  /** Fade all vessels except the selected one */
  private setIsolation(focusMmsi: number): void {
    for (const [mmsi, vm] of this.meshes) {
      vm.setFaded(mmsi !== focusMmsi)
    }
  }

  private clearIsolation(): void {
    for (const vm of this.meshes.values()) {
      vm.setFaded(false)
    }
  }

  highlightAnomaly(mmsi: number): void {
    this.meshes.get(mmsi)?.setHighlight(true)
  }

  get count(): number { return this.meshes.size }
}
