import * as THREE from 'three'
import { Water } from 'three/examples/jsm/objects/Water.js'
import { Sky } from 'three/examples/jsm/objects/Sky.js'
import { OCEAN_SIZE, WATER_NORMALS_URL } from '../utils/constants'

type WaterUniforms = Record<string, { value: unknown }>

export class OceanEnvironment {
  private water: Water
  private sky: Sky
  private sun = new THREE.Vector3()
  private pmrem: THREE.PMREMGenerator

  constructor(
    private scene: THREE.Scene,
    renderer: THREE.WebGLRenderer,
  ) {
    this.pmrem = new THREE.PMREMGenerator(renderer)
    this.water = this.buildOcean()
    this.sky = this.buildSky()
    this.updateSun(10, 180)   // elevation 10°, azimuth 180°
  }

  private buildOcean(): Water {
    const geo = new THREE.PlaneGeometry(OCEAN_SIZE, OCEAN_SIZE, 8, 8)
    const loader = new THREE.TextureLoader()
    const normals = loader.load(WATER_NORMALS_URL, (tex) => {
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping
    })

    const water = new Water(geo, {
      textureWidth: 512,
      textureHeight: 512,
      waterNormals: normals,
      sunDirection: this.sun.clone().normalize(),
      sunColor: 0xffffff,
      waterColor: 0x001e50,
      distortionScale: 4.5,
      fog: true,
    })
    water.rotation.x = -Math.PI / 2
    water.position.y = 0
    water.receiveShadow = true
    this.scene.add(water)
    return water
  }

  private buildSky(): Sky {
    const sky = new Sky()
    sky.scale.setScalar(OCEAN_SIZE * 2)
    this.scene.add(sky)

    const u = sky.material.uniforms
    u['turbidity'].value = 8
    u['rayleigh'].value = 1.5
    u['mieCoefficient'].value = 0.006
    u['mieDirectionalG'].value = 0.82

    return sky
  }

  private updateSun(elevationDeg: number, azimuthDeg: number): void {
    const phi   = THREE.MathUtils.degToRad(90 - elevationDeg)
    const theta = THREE.MathUtils.degToRad(azimuthDeg)
    this.sun.setFromSphericalCoords(1, phi, theta)

    ;(this.sky.material.uniforms['sunPosition'].value as THREE.Vector3).copy(this.sun)
    const wu = (this.water.material as THREE.ShaderMaterial).uniforms as WaterUniforms
    ;(wu['sunDirection'].value as THREE.Vector3).copy(this.sun).normalize()

    const envMap = this.pmrem.fromScene(new THREE.Scene()).texture
    this.scene.environment = envMap
  }

  update(dt: number): void {
    const wu = (this.water.material as THREE.ShaderMaterial).uniforms as WaterUniforms
    ;(wu['time'].value as number)
    wu['time'].value = (wu['time'].value as number) + dt * 0.4
  }
}
