/**
 * Картинка с камеры наблюдения: маленькая 3D-комната и девушка на движке
 * mixamo. Рендерится в отдельный canvas 320×240 — его потом вклеивает
 * приложение камеры, поэтому «камера» выглядит как дешёвая запись с видеорегистратора.
 */
import * as THREE from 'three'
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js'

export type GirlState = 'idle' | 'pace' | 'knock' | 'run' | 'gone'

const W = 320
const H = 240

export class Cctv {
  readonly canvas: HTMLCanvasElement
  private renderer: THREE.WebGLRenderer
  private scene = new THREE.Scene()
  private camera: THREE.PerspectiveCamera
  private girl: THREE.Group | null = null
  private bones = new Map<string, THREE.Bone>()
  private rest = new Map<string, THREE.Quaternion>()
  private doorPivot = new THREE.Group()
  private lamp: THREE.PointLight
  private time = 0
  private last = 0
  private state: GirlState = 'idle'
  private targetX = -0.6
  private targetZ = -0.9
  private knockT = 0
  private doorOpen = 0

  constructor() {
    this.canvas = document.createElement('canvas')
    this.canvas.width = W
    this.canvas.height = H

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: false,
      powerPreference: 'low-power',
    })
    this.renderer.setPixelRatio(1)
    this.renderer.setSize(W, H, false)
    this.renderer.setClearColor(0x05070a, 1)

    this.scene.fog = new THREE.Fog(0x05070a, 3.5, 9)

    this.camera = new THREE.PerspectiveCamera(72, W / H, 0.1, 40)
    this.camera.position.set(2.35, 2.55, 1.85)
    this.camera.lookAt(-0.35, 0.85, -0.7)

    this.scene.add(new THREE.AmbientLight(0x3a4048, 1.4))
    this.lamp = new THREE.PointLight(0xffd9a0, 14, 9, 2)
    this.lamp.position.set(0.2, 2.9, -0.4)
    this.scene.add(this.lamp)

    this.buildRoom()
    this.loadGirl()
  }

  /** Комната: бетон, труба под потолком, дверь и хлам. */
  private buildRoom(): void {
    const floorMat = new THREE.MeshLambertMaterial({ color: 0x2b2d2a })
    const wallMat = new THREE.MeshLambertMaterial({ color: 0x44463f })
    const darkMat = new THREE.MeshLambertMaterial({ color: 0x2a2c28 })

    const floor = new THREE.Mesh(new THREE.PlaneGeometry(6, 5), floorMat)
    floor.rotation.x = -Math.PI / 2
    floor.position.set(0, 0, -0.5)
    this.scene.add(floor)

    const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(6, 5), darkMat)
    ceiling.rotation.x = Math.PI / 2
    ceiling.position.set(0, 3, -0.5)
    this.scene.add(ceiling)

    const back = new THREE.Mesh(new THREE.BoxGeometry(6, 3, 0.2), wallMat)
    back.position.set(0, 1.5, -3)
    this.scene.add(back)

    const left = new THREE.Mesh(new THREE.BoxGeometry(0.2, 3, 5), wallMat)
    left.position.set(-3, 1.5, -0.5)
    this.scene.add(left)

    const right = new THREE.Mesh(new THREE.BoxGeometry(0.2, 3, 5), wallMat)
    right.position.set(3, 1.5, -0.5)
    this.scene.add(right)

    // дверь на дальней стене, петли слева
    this.doorPivot.position.set(-0.6, 0, -2.88)
    const door = new THREE.Mesh(new THREE.BoxGeometry(1.2, 2.2, 0.08), new THREE.MeshLambertMaterial({ color: 0x5a4a38 }))
    door.position.set(0.6, 1.1, 0)
    this.doorPivot.add(door)
    this.scene.add(this.doorPivot)

    // проём: тёмный прямоугольник за дверью
    const hole = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 2.2), new THREE.MeshBasicMaterial({ color: 0x020304 }))
    hole.position.set(0, 1.1, -2.95)
    this.scene.add(hole)

    // труба и лампа
    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 5.6, 6), darkMat)
    pipe.rotation.z = Math.PI / 2
    pipe.position.set(0, 2.86, -1.4)
    this.scene.add(pipe)

    const tube = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.06, 0.16), new THREE.MeshBasicMaterial({ color: 0xfff0c0 }))
    tube.position.set(0.2, 2.78, -0.4)
    this.scene.add(tube)

    // табурет и ведро
    const stool = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.06, 0.4), darkMat)
    stool.position.set(1.6, 0.45, -1.6)
    this.scene.add(stool)
    for (const [dx, dz] of [
      [-0.16, -0.16],
      [0.16, -0.16],
      [-0.16, 0.16],
      [0.16, 0.16],
    ]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.45, 0.05), darkMat)
      leg.position.set(1.6 + dx, 0.22, -1.6 + dz)
      this.scene.add(leg)
    }

    const bucket = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.14, 0.34, 8), darkMat)
    bucket.position.set(-1.9, 0.17, -1.2)
    this.scene.add(bucket)

    // лужа на полу
    const puddle = new THREE.Mesh(new THREE.CircleGeometry(0.5, 10), new THREE.MeshLambertMaterial({ color: 0x1b2320 }))
    puddle.rotation.x = -Math.PI / 2
    puddle.position.set(-1.2, 0.01, -1.9)
    this.scene.add(puddle)
  }

  private loadGirl(): void {
    const manager = new THREE.LoadingManager()
    manager.setURLModifier((url) => (url.toLowerCase().endsWith('.png') ? '/cctv/girl.png' : url))

    const tex = new THREE.TextureLoader(manager).load('/cctv/girl.png')
    tex.magFilter = THREE.NearestFilter
    tex.minFilter = THREE.NearestFilter
    tex.colorSpace = THREE.SRGBColorSpace
    const skin = new THREE.MeshLambertMaterial({ map: tex })

    new FBXLoader(manager).load('/cctv/girl.fbx', (fbx) => {
      fbx.scale.setScalar(0.0105)
      fbx.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) {
          const mesh = o as THREE.Mesh
          mesh.material = skin
          mesh.frustumCulled = false
        }
        if ((o as THREE.Bone).isBone) {
          const bone = o as THREE.Bone
          const name = bone.name.replace(/^mixamorig:?/, '')
          this.bones.set(name, bone)
          this.rest.set(name, bone.quaternion.clone())
        }
      })
      fbx.position.set(-0.6, 0, -0.9)
      fbx.rotation.y = Math.PI
      this.girl = fbx
      this.scene.add(fbx)
    })
  }

  get loaded(): boolean {
    return this.girl !== null
  }

  setState(state: GirlState): void {
    if (state === this.state) return
    this.state = state
    if (state === 'knock') {
      // подходит к двери и стучит
      this.targetX = 0
      this.targetZ = -2.05
    } else if (state === 'run') {
      // дверь открыта — бежит в проём
      this.targetX = 0
      this.targetZ = -2.55
    } else if (state === 'idle' || state === 'pace') {
      this.targetZ = -0.9
    }
  }

  /** Поворот кости относительно позы покоя. */
  private pose(name: string, x = 0, y = 0, z = 0): void {
    const bone = this.bones.get(name)
    const rest = this.rest.get(name)
    if (!bone || !rest) return
    bone.quaternion.copy(rest)
    bone.quaternion.multiply(
      new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z, 'XYZ')),
    )
  }

  update(): void {
    const now = performance.now() / 1000
    const dt = this.last ? Math.min(now - this.last, 0.1) : 0.016
    this.last = now
    this.time += dt

    if (this.girl) {
      this.animate(dt)
      const k = Math.min(1, dt * 1.6)
      this.girl.position.x += (this.targetX - this.girl.position.x) * k
      this.girl.position.z += (this.targetZ - this.girl.position.z) * k
    }

    // лампа слегка дрожит, как настоящая люминесцентная
    const flick = 1 + Math.sin(this.time * 37) * 0.04 + Math.sin(this.time * 11) * 0.03
    this.lamp.intensity = 14 * flick

    if (this.doorOpen > 0 && this.doorOpen < 1) {
      this.doorOpen = Math.min(1, this.doorOpen + dt * 1.6)
      this.doorPivot.rotation.y = -this.doorOpen * 1.5
    }

    this.renderer.render(this.scene, this.camera)
  }

  private animate(dt: number): void {
    const t = this.time
    const g = this.girl!

    if (this.state === 'gone') {
      g.visible = false
      return
    }
    g.visible = true

    if (this.state === 'idle') {
      // дышит, переминается, оглядывается на камеру
      this.pose('Spine', Math.sin(t * 1.6) * 0.03, Math.sin(t * 0.35) * 0.06)
      this.pose('Head', 0, Math.sin(t * 0.5) * 0.5)
      this.pose('LeftArm', 0, 0, -1.25 + Math.sin(t * 1.4) * 0.04)
      this.pose('RightArm', 0, 0, 1.25 - Math.sin(t * 1.4) * 0.04)
      this.pose('LeftForeArm', 0, 0.25, 0)
      this.pose('RightForeArm', 0, -0.25, 0)
      this.pose('LeftUpLeg', 0, 0, 0)
      this.pose('RightUpLeg', 0, 0, 0)
      this.pose('LeftLeg', 0, 0, 0)
      this.pose('RightLeg', 0, 0, 0)
      this.targetX = -0.6 + Math.sin(t * 0.25) * 0.25
      this.targetZ = -0.9
    } else if (this.state === 'pace' || this.state === 'run') {
      const fast = this.state === 'run' ? 2.1 : 1
      const w = t * 5.2 * fast
      const swing = Math.sin(w) * 0.62
      this.pose('LeftUpLeg', swing, 0, 0)
      this.pose('RightUpLeg', -swing, 0, 0)
      this.pose('LeftLeg', Math.max(0, -Math.sin(w)) * 0.9, 0, 0)
      this.pose('RightLeg', Math.max(0, Math.sin(w)) * 0.9, 0, 0)
      this.pose('LeftArm', 0, 0, -1.2 - swing * 0.5)
      this.pose('RightArm', 0, 0, 1.2 + swing * 0.5)
      this.pose('LeftForeArm', 0, 0.5, 0)
      this.pose('RightForeArm', 0, -0.5, 0)
      this.pose('Spine', 0.08, 0, 0)
      this.pose('Head', 0, 0, 0)
      g.position.y = Math.abs(Math.sin(w)) * 0.03
      if (this.state === 'pace') {
        this.targetX = Math.sin(t * 0.45) * 1.1
        this.targetZ = -0.9
      }
    } else if (this.state === 'knock') {
      this.knockT += dt
      const hit = Math.max(0, Math.sin(this.knockT * 6))
      this.pose('RightArm', 0, 0, 1.1)
      this.pose('RightForeArm', 0, -1.1 - hit * 0.5, 0)
      this.pose('LeftArm', 0, 0, -1.25)
      this.pose('LeftForeArm', 0, 0.2, 0)
      this.pose('Spine', 0.06 + hit * 0.05, 0, 0)
      this.pose('Head', -0.1, 0, 0)
      this.pose('LeftUpLeg', 0, 0, 0)
      this.pose('RightUpLeg', 0, 0, 0)
      this.pose('LeftLeg', 0, 0, 0)
      this.pose('RightLeg', 0, 0, 0)
      g.position.y = 0
    }
  }

  /** Дверь открывается — девушка убегает. */
  release(): void {
    if (this.doorOpen === 0) this.doorOpen = 0.0001
    this.setState('run')
  }
}
