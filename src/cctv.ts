/**
 * Картинка с камеры наблюдения: маленькая 3D-комната и девушка на движке
 * mixamo. Рендерится в отдельный canvas 320×240 — его потом вклеивает
 * приложение камеры, поэтому «камера» выглядит как дешёвая запись с видеорегистратора.
 *
 * Девушка привязана к стулу, через несколько секунд освобождается и начинает
 * бродить и стучать в дверь. Состояния: tied → pace/knock/idle → run → gone.
 */
import * as THREE from 'three'
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js'

export type GirlState = 'tied' | 'idle' | 'pace' | 'knock' | 'run' | 'gone'

const W = 320
const H = 240

/**
 * Поза: имя кости → углы Эйлера относительно позы покоя.
 * Оси подогнаны по рендеру: у руки X — опускание вбок, Z — мах вперёд/назад,
 * у бедра Z — подъём вперёд, у колена Z — сгибание вниз.
 */
type Pose = Record<string, [number, number, number]>

/** Сидя: спина прямая, руки связаны перед собой и лежат на коленях. */
const SIT: Pose = {
  Spine: [0.04, 0, 0],
  Head: [0, 0, 0],
  LeftArm: [0.95, 0, 0.55],
  RightArm: [0.95, 0, -0.55],
  LeftForeArm: [0, 0.85, 0],
  RightForeArm: [0, -0.85, 0],
  LeftUpLeg: [0, 0, 1.5],
  RightUpLeg: [0, 0, 1.5],
  LeftLeg: [0, 0, -1.5],
  RightLeg: [0, 0, -1.5],
  LeftFoot: [0, 0, 0.2],
  RightFoot: [0, 0, 0.2],
}

/** Стоя, руки опущены. */
const STAND: Pose = {
  Spine: [0.05, 0, 0],
  Head: [0, 0, 0],
  LeftArm: [1.3, 0, 0],
  RightArm: [1.3, 0, 0],
  LeftForeArm: [0, 0.25, 0],
  RightForeArm: [0, -0.25, 0],
  LeftUpLeg: [0, 0, 0.03],
  RightUpLeg: [0, 0, -0.03],
  LeftLeg: [0, 0, 0],
  RightLeg: [0, 0, 0],
  LeftFoot: [0, 0, 0],
  RightFoot: [0, 0, 0],
}

/** Стул стоит здесь, девушка начинает привязанной к нему. */
const CHAIR = { x: -0.6, z: -0.9 }
/** Разворот стула и сидящей девушки: лицом к двери, спиной к камере. */
const CHAIR_YAW = 2.99
const SIT_Y = -0.487

export class Cctv {
  readonly canvas: HTMLCanvasElement
  private renderer: THREE.WebGLRenderer
  private scene = new THREE.Scene()
  private camera = new THREE.PerspectiveCamera(62, W / H, 0.1, 40)
  private girl: THREE.Group | null = null
  private bones = new Map<string, THREE.Bone>()
  private rest = new Map<string, THREE.Quaternion>()
  private doorPivot = new THREE.Group()
  private lamp: THREE.PointLight
  private time = 0
  private last = 0
  private state: GirlState = 'tied'
  private targetX = CHAIR.x
  private targetZ = CHAIR.z
  private knockT = 0
  private doorOpen = 0
  /** Фаза шага: набегает от реально пройденного пути, чтобы шаги совпадали с движением. */
  private phase = 0
  private prev = new THREE.Vector3(CHAIR.x, 0, CHAIR.z)
  /** Текущий и целевой поворот корпуса (рад). */
  private yaw = CHAIR_YAW
  private yawTarget = CHAIR_YAW
  /** 0 — сидит, 1 — стоит: плавный подъём со стула. */
  private freeT = 0
  /** Момент освобождения со стула — от него считаем цикл бродит/стучит. */
  private freedAt = 0
  /** 0 — стоит на месте, 1 — идёт: плавная смесь поз. */
  private moveBlend = 0
  /** Единственная камера в комнате: общий вид из правого верхнего угла. */
  static readonly CAM = {
    pos: [1.7, 2.2, 1.4] as [number, number, number],
    at: [-0.55, 0.85, -1.3] as [number, number, number],
    fov: 58,
  }

  /** Видит ли камера точку (x, z) — для радара на карте. */
  sees(x: number, z: number): boolean {
    const v = Cctv.CAM
    const dx = v.at[0] - v.pos[0]
    const dz = v.at[2] - v.pos[2]
    const px = x - v.pos[0]
    const pz = z - v.pos[2]
    if (Math.hypot(px, pz) > 7) return false
    const dl = Math.hypot(dx, dz) || 1
    const pl = Math.hypot(px, pz) || 1
    const half = (v.fov / 2) * 0.95 * (Math.PI / 180)
    return (dx * px + dz * pz) / (dl * pl) > Math.cos(half)
  }

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

    this.applyCam()

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
    const woodMat = new THREE.MeshLambertMaterial({ color: 0x4a3b2a })

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

    // стул, к которому привязана девушка: развёрнут так, чтобы она сидела
    // ровно, спиной к спинке, лицом туда же, куда смотрит (CHAIR_YAW)
    const chair = new THREE.Group()
    chair.position.set(CHAIR.x, 0, CHAIR.z)
    chair.rotation.y = CHAIR_YAW
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.05, 0.42), woodMat)
    seat.position.set(0, 0.45, 0)
    chair.add(seat)
    const backrest = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.55, 0.04), woodMat)
    backrest.position.set(0, 0.75, -0.19)
    chair.add(backrest)
    for (const [dx, dz] of [
      [-0.18, -0.18],
      [0.18, -0.18],
      [-0.18, 0.18],
      [0.18, 0.18],
    ]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.45, 0.045), woodMat)
      leg.position.set(dx, 0.22, dz)
      chair.add(leg)
    }
    // верёвка на запястьях — руки связаны перед собой, на коленях, плюс
    // отрезок к ножке стула: видно, что она прицеплена
    const rope = new THREE.Mesh(new THREE.TorusGeometry(0.085, 0.016, 6, 12), new THREE.MeshLambertMaterial({ color: 0x8a7448 }))
    rope.position.set(0, 0.62, 0.22)
    rope.rotation.x = Math.PI / 2
    chair.add(rope)
    const rope2 = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.013, 6, 12), new THREE.MeshLambertMaterial({ color: 0x8a7448 }))
    rope2.position.set(-0.14, 0.3, 0.2)
    rope2.rotation.set(Math.PI / 2.4, 0, 0.5)
    chair.add(rope2)
    this.scene.add(chair)

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
      // модель в сантиметрах, рост ~445 единиц: 0.0037 даёт ~1,65 м
      fbx.scale.setScalar(0.0037)
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
      fbx.position.set(CHAIR.x, SIT_Y, CHAIR.z)
      fbx.rotation.y = this.yaw
      this.prev.set(CHAIR.x, 0, CHAIR.z)
      this.girl = fbx
      this.scene.add(fbx)
    })
  }

  get loaded(): boolean {
    return this.girl !== null
  }

  /** Девушка уже скрылась из кадра. */
  get gone(): boolean {
    return this.state === 'gone'
  }

  /** Параметры единственной камеры — для карты и радара. */
  get cam(): typeof Cctv.CAM {
    return Cctv.CAM
  }

  private applyCam(): void {
    const v = Cctv.CAM
    this.camera.fov = v.fov
    this.camera.position.set(...v.pos)
    this.camera.lookAt(...v.at)
    this.camera.updateProjectionMatrix()
  }

  setState(state: GirlState): void {
    if (state === this.state) return
    this.state = state
    if (state === 'knock') {
      // подходит к двери и стучит
      this.targetX = 0
      this.targetZ = -2.05
      this.yawTarget = Math.PI
    } else if (state === 'run') {
      // дверь открыта — бежит в проём и дальше, в темноту
      this.targetX = 0
      this.targetZ = -3.6
      this.yawTarget = Math.PI
    } else if (state === 'pace') {
      // бродит перед стулом, не задевая его
      this.targetZ = -1.5
      this.yawTarget = Math.PI / 2
    } else if (state === 'idle') {
      this.targetX = CHAIR.x
      this.targetZ = -1.4
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
      this.narrative()
      this.animate(dt)
      this.move(dt)
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

  /** Сценарий: привязана, пока игрок не отвяжет; после — бродит и стучит. */
  private narrative(): void {
    if (this.state === 'pace' || this.state === 'idle' || this.state === 'knock') {
      const cycle = (this.time - this.freedAt) % 12
      if (cycle < 7) this.setState('pace')
      else if (cycle < 11) this.setState('knock')
      else this.setState('idle')
    }
  }

  /** Игрок дал команду отвязать: она встаёт и начинает пытаться уйти. */
  untie(): void {
    if (this.state === 'tied') {
      this.freedAt = this.time
      this.setState('pace')
    }
  }

  /** Насколько она напугана: 0.3 привязана, 0.55 бродит, 0.85 стучит, 1 бежит. */
  get stress(): number {
    if (this.state === 'tied') return 0.35 + Math.sin(this.time * 0.7) * 0.08
    if (this.state === 'pace' || this.state === 'idle') return 0.55
    if (this.state === 'knock') return 0.85
    if (this.state === 'run') return 1
    return 0
  }

  /** Мировая позиция девушки — для радара на карте. */
  get girlPos(): { x: number; z: number } | null {
    if (!this.girl || !this.girl.visible) return null
    return { x: this.girl.position.x, z: this.girl.position.z }
  }

  private move(dt: number): void {
    const g = this.girl!

    if (this.state === 'tied') {
      this.prev.set(g.position.x, 0, g.position.z)
      this.freeT = 0
      return
    }
    this.freeT = Math.min(1, this.freeT + dt * 0.9)

    const k = Math.min(1, dt * 1.6)
    g.position.x += (this.targetX - g.position.x) * k
    g.position.z += (this.targetZ - g.position.z) * k
    // шаги совпадают с пройденным путём, а не с временем
    const moved = Math.hypot(g.position.x - this.prev.x, g.position.z - this.prev.z)
    this.phase += moved * 4.6
    this.prev.set(g.position.x, 0, g.position.z)

    // поворот к цели по кратчайшей дуге
    let d = (this.yawTarget - this.yaw) % (Math.PI * 2)
    if (d > Math.PI) d -= Math.PI * 2
    if (d < -Math.PI) d += Math.PI * 2
    this.yaw += d * Math.min(1, dt * 5)
    g.rotation.y = this.yaw
  }

  private animate(dt: number): void {
    const t = this.time
    const g = this.girl!
    const sit = 1 - this.freeT

    if (this.state === 'gone') {
      g.visible = false
      return
    }
    g.visible = true

    // высота бедер: сидя на стуле → стоя
    g.position.y = SIT_Y * sit

    if (this.state === 'tied') {
      // привязана: дышит всё быстрее со стрессом, ёрзает, озирается
      const w = t * 6.5
      const stress = this.stress
      const breath = Math.sin(t * (1.6 + stress * 1.6))
      this.applyPose(SIT)
      this.pose('Spine', 0.04 + breath * (0.015 + stress * 0.03), Math.sin(t * 1.7) * 0.1, Math.cos(w * 0.5) * 0.05)
      this.pose('Head', breath * 0.04, Math.sin(t * 0.7) * 0.55, Math.sin(w * 0.5) * 0.08)
      this.pose('LeftUpLeg', 0, 0, 1.5 + Math.max(0, Math.sin(w)) * 0.2)
      this.pose('RightUpLeg', 0, 0, 1.5 + Math.max(0, Math.sin(w + 2.1)) * 0.2)
      this.pose('LeftArm', 0.95 + Math.sin(w * 1.3) * 0.1, 0, 0.55)
      this.pose('RightArm', 0.95 - Math.sin(w * 1.1) * 0.1, 0, -0.55)
      this.targetX = CHAIR.x
      this.targetZ = CHAIR.z
      this.yaw = this.yawTarget = CHAIR_YAW // ровно по спинке стула
      g.rotation.y = this.yaw
      return
    }

    // вставание со стула: смесь сидячей и стоячей позы
    const m = this.freeT
    const nearTarget = Math.hypot(g.position.x - this.targetX, g.position.z - this.targetZ) < 0.3
    const moving =
      this.state === 'pace' || this.state === 'run' || (this.state === 'knock' && !nearTarget)
    this.moveBlend += ((moving && m >= 1 ? 1 : 0) - this.moveBlend) * Math.min(1, dt * 5)

    const base: Pose = {}
    for (const bone of Object.keys(STAND)) {
      const a = SIT[bone] ?? [0, 0, 0]
      const b = STAND[bone] ?? [0, 0, 0]
      base[bone] = [a[0] + (b[0] - a[0]) * m, a[1] + (b[1] - a[1]) * m, a[2] + (b[2] - a[2]) * m]
    }

    if (moving) {
      if (this.state === 'pace') this.targetX = Math.sin(t * 0.45) * 1.1
      // шаг: махи ног и рук от фазы, набегающей от пройденного пути
      const fast = this.state === 'run' ? 1.35 : 1
      const w = this.phase * fast
      const swing = Math.sin(w) * 0.5 * this.moveBlend
      base.LeftUpLeg = [base.LeftUpLeg[0] - swing * 0.8, 0, base.LeftUpLeg[2]]
      base.RightUpLeg = [base.RightUpLeg[0] + swing * 0.8, 0, base.RightUpLeg[2]]
      base.LeftLeg = [Math.max(0, Math.sin(w)) * 0.5 * this.moveBlend, 0, 0]
      base.RightLeg = [Math.max(0, -Math.sin(w)) * 0.5 * this.moveBlend, 0, 0]
      base.LeftArm = [1.3, 0, -swing * 0.5]
      base.RightArm = [1.3, 0, swing * 0.5]
      base.LeftForeArm = [0, 0.4, 0]
      base.RightForeArm = [0, -0.4, 0]
      base.Spine = [0.08, 0, 0]
      base.Head = [0, 0, 0]
      g.position.y += Math.abs(Math.sin(w)) * 0.03 * this.moveBlend
      // лицом по ходу движения
      const dx = this.targetX - g.position.x
      if (Math.abs(dx) > 0.05) this.yawTarget = dx > 0 ? Math.PI / 2 : -Math.PI / 2
    } else if (this.state === 'knock') {
      this.knockT += dt
      const hit = Math.max(0, Math.sin(this.knockT * 7))
      const hit2 = Math.max(0, Math.sin(this.knockT * 7 + Math.PI))
      // обе руки подняты к двери, кулаки стучат по очереди
      base.RightArm = [1.2, 0, -1.35]
      base.RightForeArm = [-0.6 - hit * 0.45, -0.5, 0]
      base.LeftArm = [1.2, 0, -1.35]
      base.LeftForeArm = [-0.6 - hit2 * 0.45, 0.5, 0]
      base.Spine = [0.06 + hit * 0.05, 0, 0]
      base.Head = [-0.1, 0, 0]
      // стоит у двери, лицом к ней
      this.targetX = 0
      this.targetZ = -2.05
      this.yawTarget = Math.PI
    } else {
      // стоит: дышит, переминается, смотрит в сторону двери, не в камеру
      base.Spine = [Math.sin(t * 1.6) * 0.03 + 0.05, Math.sin(t * 0.35) * 0.06, 0]
      base.Head = [0, Math.sin(t * 0.5) * 0.35, 0]
      base.LeftArm = [1.3, 0, Math.sin(t * 1.4) * 0.05]
      base.RightArm = [1.3, 0, -Math.sin(t * 1.4) * 0.05]
      this.targetX = CHAIR.x + Math.sin(t * 0.25) * 0.25
      this.targetZ = -1.4
      // лицом к двери, спиной к камере
      this.yawTarget = Math.PI
    }

    for (const [bone, a] of Object.entries(base)) this.pose(bone, a[0], a[1], a[2])
  }

  private applyPose(p: Pose): void {
    for (const [bone, a] of Object.entries(p)) this.pose(bone, a[0], a[1], a[2])
  }

  /** Дверь открывается — девушка убегает. */
  release(): void {
    if (this.doorOpen === 0) this.doorOpen = 0.0001
    this.setState('run')
  }
}

// Один экземпляр на всю игру: камера и карта смотрят на одну и ту же сцену.
let shared: Cctv | null = null

export function getCctv(): Cctv {
  if (!shared) shared = new Cctv()
  return shared
}
