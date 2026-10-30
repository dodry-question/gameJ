/**
 * Картинка с камеры наблюдения: маленькая 3D-комната и девушка на движке
 * mixamo. Рендерится в отдельный canvas 320×240 — его потом вклеивает
 * страница камеры, поэтому «камера» выглядит как дешёвая запись с регистратора.
 *
 * Девушка привязана к стулу лицом от двери (в камеру), после освобождения
 * встаёт, бродит, стучит в дверь и убегает. Состояния: tied → pace/knock/idle
 * → run → gone.
 *
 * Анимация процедурная, но слоистая: базовая поза → дыхание → цикл шага (фаза
 * набегает от пройденного пути, а не от времени) → шум-«живость» → тремор от
 * страха. Позы задаются в осях комнаты (наклон/поворот/крен), поэтому одинаково
 * читаются и сидя, и в беге, и в рывке; у каждой кости учитывается уже
 * повёрнутый родитель, так что вторичное движение (голова запаздывает, корпус
 * скручивается против бёдер) считается той же арифметикой.
 */
import * as THREE from 'three'
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js'
import { buildRoom } from './cctv-room'

export type GirlState = 'tied' | 'idle' | 'pace' | 'knock' | 'run' | 'gone'

const W = 320
const H = 240

/**
 * Поза: имя кости → углы поворота от позы покоя в осях комнаты:
 * X — наклон вперёд(+)/назад(-), Y — поворот влево(+)/вправо(-),
 * Z — крен вправо(+)/влево(-). Так позы читаются и сочиняются как обычные
 * «наклонить корпус», а не как подбор локальных осей каждой кости.
 * Порядок применения — от корня к детям, поэтому вращения родителей уже учтены.
 */
type Pose = Record<string, [number, number, number]>

/** Сидя на стуле: бёдра вперёд, колени вниз, руки связаны и лежат на коленях. */
const SIT: Pose = {
  Spine: [0.14, 0.02, 0],
  Head: [0.06, 0, 0],
  LeftArm: [-0.48, 0.06, -1.3],
  RightArm: [-0.48, -0.06, 1.3],
  LeftForeArm: [-0.5, 0.12, 0],
  RightForeArm: [-0.5, -0.12, 0],
  LeftUpLeg: [-1.45, 0.1, 0.06],
  RightUpLeg: [-1.45, -0.1, -0.06],
  LeftLeg: [1.35, 0, 0],
  RightLeg: [1.35, 0, 0],
  LeftFoot: [0.1, 0, 0],
  RightFoot: [0.1, 0, 0],
}

/** Стоя, руки опущены. */
const STAND: Pose = {
  Spine: [0.05, 0, 0],
  Head: [0, 0, 0],
  LeftArm: [0, 0, -1.42],
  RightArm: [0, 0, 1.42],
  LeftForeArm: [-0.18, 0, 0],
  RightForeArm: [-0.18, 0, 0],
  LeftUpLeg: [0, 0.02, 0.02],
  RightUpLeg: [0, -0.02, -0.02],
  LeftLeg: [0.03, 0, 0],
  RightLeg: [0.03, 0, 0],
  LeftFoot: [0, 0, 0],
  RightFoot: [0, 0, 0],
}

/** Стул стоит здесь, девушка начинает привязанной к нему. */
const CHAIR = { x: -0.6, z: -0.9 }
/** Сидя она смотрит ОТ двери — в камеру: видно лицо и страх. */
const CHAIR_YAW = 0.15
const SIT_Y = -0.42

const clamp = (v: number, a: number, b: number): number => Math.min(b, Math.max(a, v))

export class Cctv {
  readonly canvas: HTMLCanvasElement
  private renderer: THREE.WebGLRenderer
  private scene = new THREE.Scene()
  private camera = new THREE.PerspectiveCamera(62, W / H, 0.1, 40)
  private girl: THREE.Group | null = null
  private bones = new Map<string, THREE.Bone>()
  private rest = new Map<string, THREE.Quaternion>()
  /** Глубина кости в иерархии: позы применяются от корня к листьям. */
  private depth = new Map<string, number>()
  /** Цепочки предков без самого корня модели — чтобы не собирать их каждый кадр. */
  private chains = new Map<string, THREE.Object3D[]>()
  private doorPivot: THREE.Group
  private dust: THREE.Points
  private lamp: THREE.PointLight
  /** Кольца верёвки на запястьях: вяжутся к рукам, пока девушка привязана. */
  private wristRopes: THREE.Mesh[] = []
  private handA = new THREE.Vector3()
  private handB = new THREE.Vector3()
  private ropeAxis = new THREE.Vector3()
  private axisZ = new THREE.Vector3(0, 0, 1)
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
  /** Скорость доворота за кадр — корпус кренится в поворот. */
  private yawDelta = 0
  /** 0 — сидит, 1 — стоит: плавный подъём со стула. */
  private freeT = 0
  /** Момент освобождения со стула — от него считаем цикл бродит/стучит. */
  private freedAt = 0
  /** 0 — стоит на месте, 1 — идёт: плавная смесь поз. */
  private moveBlend = 0
  /** Куда смотрит голова, когда стоит: цель и сглаженный текущий взгляд. */
  private gazeTarget = { x: 0, y: 0 }
  private gaze = { x: 0, y: 0 }
  private gazeNext = 2
  private euler = new THREE.Euler()
  private delta = new THREE.Quaternion()
  private deltaWorld = new THREE.Quaternion()
  private tmpA = new THREE.Quaternion()
  private tmpB = new THREE.Quaternion()
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

    this.scene.fog = new THREE.Fog(0x05070a, 4, 11)

    this.applyCam()

    this.scene.add(new THREE.AmbientLight(0x4a5058, 2.6))
    this.lamp = new THREE.PointLight(0xffd9a0, 18, 10, 2)
    this.lamp.position.set(0.2, 2.9, -0.4)
    this.scene.add(this.lamp)

    const room = buildRoom(this.scene, CHAIR.x, CHAIR.z, CHAIR_YAW)
    this.doorPivot = room.doorPivot
    this.dust = room.dust
    this.loadGirl()

    // Отладочный доступ к сцене — для tools/rig-axes.mjs и tools/shot-*.mjs.
    ;(window as unknown as { __cctv?: Cctv }).__cctv = this
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
          const chain: THREE.Object3D[] = []
          let p: THREE.Object3D | null = bone
          while (p && p !== fbx) {
            chain.push(p)
            p = p.parent
          }
          this.chains.set(name, chain)
          this.depth.set(name, chain.length)
        }
      })
      fbx.position.set(CHAIR.x, SIT_Y, CHAIR.z)
      fbx.rotation.y = this.yaw
      this.prev.set(CHAIR.x, 0, CHAIR.z)
      this.girl = fbx
      this.scene.add(fbx)

      // верёвка на запястьях: два кольца, каждое повязано вдоль предплечья
      const ropeMat = new THREE.MeshLambertMaterial({ color: 0x9a8452 })
      for (let i = 0; i < 2; i++) {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.042, 0.012, 6, 10), ropeMat)
        ring.visible = false
        this.wristRopes.push(ring)
        this.scene.add(ring)
      }
    })
  }

  /** Кольца верёвки двигаются вместе с кистями, пока девушка связана. */
  private updateWristRopes(): void {
    const tied = this.state === 'tied'
    for (const ring of this.wristRopes) ring.visible = tied
    if (!tied) return
    const sides: [string, string][] = [
      ['LeftForeArm', 'LeftHand'],
      ['RightForeArm', 'RightHand'],
    ]
    sides.forEach(([foreArm, hand], i) => {
      const fa = this.bones.get(foreArm)
      const h = this.bones.get(hand)
      const ring = this.wristRopes[i]
      if (!fa || !h || !ring) return
      fa.getWorldPosition(this.handA)
      h.getWorldPosition(this.handB)
      this.ropeAxis.copy(this.handB).sub(this.handA).normalize()
      ring.position.copy(this.handB)
      ring.quaternion.setFromUnitVectors(this.axisZ, this.ropeAxis)
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
      this.targetZ = -2.35
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

  /**
   * Мировой поворот родителя кости с учётом уже применённой позы предков.
   * Результат — во временном tmpA, который сразу потребляется в pose().
   */
  private parentWorld(name: string): THREE.Quaternion {
    const chain = this.chains.get(name)
    const q = this.tmpA.copy(this.girl!.quaternion)
    if (!chain) return q
    for (let i = chain.length - 1; i >= 1; i--) q.multiply(chain[i].quaternion)
    return q
  }

  /**
   * Повернуть кость на углы (X — наклон, Y — поворот, Z — крен) в осях
   * комнаты относительно позы покоя. Углы прибавляются к текущей позе родителя,
   * поэтому одна и та же запись работает и сидя, и в беге, и в рывке.
   */
  private pose(name: string, x = 0, y = 0, z = 0): void {
    const bone = this.bones.get(name)
    const rest = this.rest.get(name)
    if (!bone || !rest) return
    const parent = this.parentWorld(name)
    this.euler.set(x, y, z, 'XYZ')
    this.delta.setFromEuler(this.euler)
    // дельта задана в осях комнаты, а кость живёт в мировых — переносим
    this.tmpB.copy(this.girl!.quaternion).invert()
    this.deltaWorld.copy(this.girl!.quaternion).multiply(this.delta).multiply(this.tmpB)
    bone.quaternion
      .copy(parent)
      .invert()
      .multiply(this.deltaWorld)
      .multiply(parent)
      .multiply(rest)
  }

  /** Применить позу от корня к листьям: родители должны быть повёрнуты первыми. */
  private applyPose(p: Pose): void {
    const names = Object.keys(p).sort((a, b) => (this.depth.get(a) ?? 0) - (this.depth.get(b) ?? 0))
    for (const name of names) {
      const a = p[name]
      this.pose(name, a[0], a[1], a[2])
    }
  }

  /** Сложить два угла кости покомпонентно. */
  private add(p: Pose, name: string, dx: number, dy: number, dz: number): void {
    const a = p[name]
    if (!a) {
      p[name] = [dx, dy, dz]
      return
    }
    a[0] += dx
    a[1] += dy
    a[2] += dz
  }

  /** Смешать две позы: m=0 — a, m=1 — b. */
  private mix(a: Pose, b: Pose, m: number): Pose {
    const out: Pose = {}
    for (const bone of new Set([...Object.keys(a), ...Object.keys(b)])) {
      const p = a[bone] ?? [0, 0, 0]
      const q = b[bone] ?? [0, 0, 0]
      out[bone] = [p[0] + (q[0] - p[0]) * m, p[1] + (q[1] - p[1]) * m, p[2] + (q[2] - p[2]) * m]
    }
    return out
  }

  /**
   * Три синуса с несоизмеримыми частотами: сумма никогда не повторяется
   * точно, поэтому движение без «метронома». s — сдвиг фазы для разнообразия.
   */
  private wob(t: number, s = 0): number {
    return (
      Math.sin(t * 0.71 + s * 12.9) * 0.5 +
      Math.sin(t * 1.13 + s * 78.2) * 0.3 +
      Math.sin(t * 2.37 + s * 37.7) * 0.2
    )
  }

  update(): void {
    const now = performance.now() / 1000
    const dt = this.last ? Math.min(now - this.last, 0.1) : 0.016
    this.last = now
    this.time += dt

    if (this.girl) {
      this.narrative()
      this.move(dt)
      this.animate(dt)
    }

    // лампа слегка дрожит, как настоящая люминесцентная
    const flick = 1 + Math.sin(this.time * 37) * 0.04 + Math.sin(this.time * 11) * 0.03
    this.lamp.intensity = 18 * flick

    // пыль медленно плывёт в луче
    this.dust.rotation.y = this.time * 0.03
    this.dust.position.y = Math.sin(this.time * 0.17) * 0.06

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

    // поворот к цели по кратчайшей дуге; скорость доворота — для крена в повороте
    let d = (this.yawTarget - this.yaw) % (Math.PI * 2)
    if (d > Math.PI) d -= Math.PI * 2
    if (d < -Math.PI) d += Math.PI * 2
    this.yawDelta = d * Math.min(1, dt * 5)
    this.yaw += this.yawDelta
    g.rotation.y = this.yaw
  }

  private animate(dt: number): void {
    const t = this.time
    const g = this.girl!
    const sit = 1 - this.freeT
    const stress = this.stress

    if (this.state === 'gone') {
      g.visible = false
      return
    }
    g.visible = true

    // высота бёдер: сидя на стуле → стоя
    g.position.y = SIT_Y * sit

    // дыхание: чем страшнее, тем чаще и глубже; лёгкая неровность ритма
    const breath = Math.sin(t * (1.5 + stress * 1.9) + this.wob(t, 3) * 0.4)

    if (this.state === 'tied') {
      const p: Pose = {}
      this.tiedPose(p, t, dt, breath, stress)
      this.tremor(p, t, stress)
      this.applyPose(p)
      this.updateWristRopes()
      this.targetX = CHAIR.x
      this.targetZ = CHAIR.z
      this.yaw = this.yawTarget = CHAIR_YAW // ровно по спинке стула
      g.rotation.y = this.yaw
      return
    }

    // вставание со стула: смесь сидячей и стоячей позы
    const nearTarget = Math.hypot(g.position.x - this.targetX, g.position.z - this.targetZ) < 0.3
    const moving =
      this.state === 'pace' || this.state === 'run' || (this.state === 'knock' && !nearTarget)
    this.moveBlend += ((moving && this.freeT >= 1 ? 1 : 0) - this.moveBlend) * Math.min(1, dt * 5)

    const base = this.mix(SIT, STAND, this.freeT)

    // подъём: в середине она опирается руками о колени и сгибается вперёд
    const rise = Math.sin(this.freeT * Math.PI)
    this.add(base, 'Spine', rise * 0.45, 0, 0)
    this.add(base, 'LeftArm', -rise * 0.35, 0, 0)
    this.add(base, 'RightArm', -rise * 0.35, 0, 0)
    this.add(base, 'LeftForeArm', -rise * 0.35, 0, 0)
    this.add(base, 'RightForeArm', -rise * 0.35, 0, 0)

    if (moving) {
      this.walkPose(base, t)
    } else if (this.state === 'knock') {
      this.knockPose(base, t, dt, stress)
    } else {
      this.standPose(base, t, dt, breath, stress)
    }

    this.tremor(base, t, stress)
    this.applyPose(base)
    this.updateWristRopes()
  }

  /** Привязана: дышит, бьётся в верёвках рывками, озирается и трясёт головой. */
  private tiedPose(p: Pose, t: number, dt: number, breath: number, stress: number): void {
    // рывки: напрягается изо всех сил, потом обмякает; редкие и неровные
    const wave = Math.sin(t * 0.5) + Math.sin(t * 0.29 + 2.1) * 0.7
    const pull = clamp((wave - 0.55) / 0.45, 0, 1) ** 2
    const w = t * 6.5

    // куда смотрит: в камеру, на связанные руки, через плечо в сторону двери, в пол
    if (t > this.gazeNext) {
      const r = Math.random()
      this.gazeTarget =
        r < 0.4
          ? { x: -0.12, y: -0.5 }
          : r < 0.65
            ? { x: 0.5, y: -0.2 }
            : r < 0.85
              ? { x: 0.05, y: 0.95 }
              : { x: 0.28, y: 0.3 }
      this.gazeNext = t + 1.6 + Math.random() * 2.8
    }
    this.gaze.x += (this.gazeTarget.x - this.gaze.x) * Math.min(1, dt * 2.2)
    this.gaze.y += (this.gazeTarget.y - this.gaze.y) * Math.min(1, dt * 2.2)

    // корпус: дышит, в рывке тянется вперёд и привстаёт, между рывками — обмякает
    p.Spine = [
      0.14 + breath * (0.015 + stress * 0.03) - pull * 0.16,
      this.gaze.y * 0.1 + pull * 0.1,
      this.wob(t, 5) * 0.02,
    ]

    // голова: переводит взгляд — в камеру, на руки, к двери; в рывке дёргается
    p.Head = [
      0.06 + this.gaze.x + breath * 0.04 + pull * 0.16,
      this.gaze.y + pull * Math.sin(t * 8.5) * 0.14,
      this.wob(t, 3) * 0.08,
    ]

    // ноги: упираются в пол, в рывке дёргаются по очереди, пятки скользят
    const kickL = Math.max(0, Math.sin(w)) * (0.1 + pull * 0.32)
    const kickR = Math.max(0, Math.sin(w + 2.1)) * (0.1 + pull * 0.32)
    p.LeftUpLeg = [-1.45 - kickL, 0.1, 0.06]
    p.RightUpLeg = [-1.45 - kickR, -0.1, -0.06]
    p.LeftLeg = [1.35 + kickL * 0.7, 0, 0]
    p.RightLeg = [1.35 + kickR * 0.7, 0, 0]
    p.LeftFoot = [0.1 + Math.sin(w * 1.7) * 0.07, 0, 0]
    p.RightFoot = [0.1 + Math.sin(w * 1.7 + 1.9) * 0.07, 0, 0]

    // руки связаны перед собой: лежат на коленях, в рывке тянутся вперёд-вверх
    const armX = -0.48 - pull * 0.55 + Math.sin(w * 1.3) * 0.05
    p.LeftArm = [armX, 0.06, -1.3 + pull * 0.5]
    p.RightArm = [armX, -0.06, 1.3 - pull * 0.5]
    p.LeftForeArm = [-0.5 - pull * 0.5, 0.12, 0]
    p.RightForeArm = [-0.5 - pull * 0.5, -0.12, 0]
  }

  /**
   * Тремор от страха: мелкая быстрая дрожь головы и кистей. Проявляется на
   * высоком стрессе, амплитуда растёт — на записи это читается как паника.
   */
  private tremor(p: Pose, t: number, stress: number): void {
    if (stress <= 0.55) return
    const tr = (stress - 0.55) * 0.05
    this.add(p, 'Head', Math.sin(t * 12.1) * tr * 0.6, Math.sin(t * 10.3) * tr, 0)
    this.add(p, 'LeftForeArm', Math.sin(t * 13.7) * tr, 0, Math.sin(t * 11.3) * tr)
    this.add(p, 'RightForeArm', Math.sin(t * 12.9 + 1.7) * tr, 0, Math.sin(t * 10.7 + 0.6) * tr)
  }

  /** Ходьба и бег: махи ног, скрутка корпуса, крен в повороте. */
  private walkPose(base: Pose, t: number): void {
    const g = this.girl!

    if (this.state === 'pace') {
      // бродит по комнате; путь слегка неровный, не по линейке
      this.targetX = Math.sin(t * 0.45) * 1.1 + this.wob(t * 0.5, 5) * 0.22
    }
    const run = this.state === 'run'
    const w = this.phase * (run ? 1.35 : 1)
    const amp = this.moveBlend * (run ? 0.58 : 0.42)
    const swingL = Math.sin(w)
    const swingR = Math.sin(w + Math.PI)

    // ноги: бедро уходит вперёд, колено сгибается в переносе, носок отрывается
    base.LeftUpLeg = [-swingL * amp, 0.04, 0.04]
    base.RightUpLeg = [-swingR * amp, -0.04, -0.04]
    const kneeL = amp * 0.9 * (0.18 + 0.85 * Math.max(0, Math.cos(w)) ** 1.4)
    const kneeR = amp * 0.9 * (0.18 + 0.85 * Math.max(0, -Math.cos(w)) ** 1.4)
    base.LeftLeg = [kneeL, 0, 0]
    base.RightLeg = [kneeR, 0, 0]
    base.LeftFoot = [-swingL * amp * 0.5 + kneeL * 0.3, 0, 0]
    base.RightFoot = [-swingR * amp * 0.5 + kneeR * 0.3, 0, 0]

    // корпус: наклон вперёд, плечи скручиваются против бёдер
    base.Spine = [(run ? 0.2 : 0.08) + amp * 0.08, -swingL * 0.08, this.wob(t, 9) * 0.02]
    // голова запаздывает за корпусом и гасит тряску
    base.Head = [Math.sin(w * 2 - 0.6) * amp * 0.06, -swingL * 0.06, this.wob(t, 4) * 0.03]

    // руки качаются в противофазе ногам; локти гнутся, когда рука идёт вперёд
    const armL = swingL * amp * 1.15
    const armR = swingR * amp * 1.15
    base.LeftArm = [armL, 0, -1.38]
    base.RightArm = [armR, 0, 1.38]
    base.LeftForeArm = [-0.2 - Math.max(0, -armL) * 0.9, 0, 0]
    base.RightForeArm = [-0.2 - Math.max(0, -armR) * 0.9, 0, 0]

    // бёдра: перекат веса и скрутка в такт шагам
    this.add(base, 'Hips', 0, swingL * 0.08 * this.moveBlend, -swingL * 0.045 * this.moveBlend)
    // крен в поворот: куда крутится, туда и заваливается
    this.add(base, 'Hips', 0, 0, clamp(this.yawDelta * 1.5, -0.1, 0.1))

    // подпрыг корпуса: двойная частота шага
    g.position.y += Math.abs(Math.cos(w)) * (run ? 0.04 : 0.022) * this.moveBlend

    // лицом по ходу движения
    const dx = this.targetX - g.position.x
    if (Math.abs(dx) > 0.05) this.yawTarget = dx > 0 ? Math.PI / 2 : -Math.PI / 2
  }

  /** Стоит у двери и бьётся в неё: серии из трёх ударов, пауза, осмотр. */
  private knockPose(base: Pose, t: number, dt: number, stress: number): void {
    this.knockT += dt
    // серия: три удара по 0.47 с, потом пауза — ритм неровный, не метроном
    const cycle = this.knockT % 3.4
    const idx = Math.floor(cycle / 0.47)
    const inBurst = cycle < 1.41 && idx < 3
    const hit = inBurst ? Math.sin(((cycle % 0.47) / 0.47) * Math.PI) ** 1.5 : 0

    // обе руки подняты к двери; бьёт по очереди, вторая ладонью опирается
    const right = idx % 2 === 0
    const shoulder = -1.32 - hit * 0.16
    const elbow = -0.55 + hit * 0.45
    if (right) {
      base.RightArm = [shoulder, 0.55, 1.2]
      base.RightForeArm = [elbow, 0, 0]
      base.LeftArm = [-1.28, -0.55, -1.2]
      base.LeftForeArm = [-0.6, 0, 0]
    } else {
      base.LeftArm = [shoulder, -0.55, -1.2]
      base.LeftForeArm = [elbow, 0, 0]
      base.RightArm = [-1.28, 0.55, 1.2]
      base.RightForeArm = [-0.6, 0, 0]
    }

    // бьётся всем телом: корпус и голова подаются в удары
    base.Spine = [0.12 + hit * 0.07, this.wob(t * 0.4, 2) * 0.04, 0]
    base.Head = [0.05 + hit * 0.06, hit > 0.1 ? 0 : this.wob(t * 0.5, 6) * 0.3, 0]
    this.add(base, 'Hips', 0, 0, hit * 0.025)

    // стоит у двери, лицом к ней
    this.targetX = 0
    this.targetZ = -2.35
    this.yawTarget = Math.PI
    void stress
  }

  /** Стоит без дела: переминается, вес перекатывается, взгляд гуляет. */
  private standPose(base: Pose, t: number, dt: number, breath: number, stress: number): void {
    // взгляд: дверь, вниз на руки, в сторону; смотрит недолго и переводит
    if (t > this.gazeNext) {
      const r = Math.random()
      this.gazeTarget = {
        x: r < 0.3 ? 0.12 : r < 0.85 ? -0.05 : 0.3,
        y: r < 0.55 ? 0 : r < 0.8 ? 0.5 : -0.6,
      }
      this.gazeNext = t + 2.2 + Math.random() * 3
    }
    this.gaze.x += (this.gazeTarget.x - this.gaze.x) * Math.min(1, dt * 3)
    this.gaze.y += (this.gazeTarget.y - this.gaze.y) * Math.min(1, dt * 3)

    // вес перекатывается с ноги на ногу — медленно и неровно
    const shift = this.wob(t * 0.4, 7)
    this.add(base, 'Hips', 0, shift * 0.04, shift * 0.05)
    base.Spine = [
      0.05 + breath * (0.012 + stress * 0.02),
      this.wob(t * 0.5, 9) * 0.05,
      -shift * 0.03,
    ]
    base.Head = [this.gaze.x + breath * 0.02, this.gaze.y, this.wob(t, 4) * 0.04]

    // руки висят и слегка живут; кисти безвольно повёрнуты
    base.LeftArm = [this.wob(t, 2) * 0.04, 0, -1.42 + shift * 0.03]
    base.RightArm = [this.wob(t, 6) * 0.04, 0, 1.42 + shift * 0.03]
    base.LeftForeArm = [-0.18 + this.wob(t * 0.7, 1) * 0.08, 0, 0]
    base.RightForeArm = [-0.18 + this.wob(t * 0.7, 8) * 0.08, 0, 0]

    this.targetX = CHAIR.x + Math.sin(t * 0.25) * 0.25
    this.targetZ = -1.4
    // лицом к двери
    this.yawTarget = Math.PI
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
