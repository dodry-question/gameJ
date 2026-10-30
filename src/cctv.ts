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
import { buildKitchen, KITCHEN_OBSTACLES, KITCHEN } from './cctv-kitchen'
import type { Kitchen } from './cctv-kitchen'

export type GirlState = 'tied' | 'idle' | 'pace' | 'knock' | 'run' | 'toKitchen' | 'kitchen' | 'gone'

export const W = 320
export const H = 240

/**
 * Поза: имя кости → углы поворота от позы покоя в осях комнаты:
 * X — наклон вперёд(+)/назад(-), Y — поворот влево(+)/вправо(-),
 * Z — крен вправо(+)/влево(-). Так позы читаются и сочиняются как обычные
 * «наклонить корпус», а не как подбор локальных осей каждой кости.
 * Порядок применения — от корня к детям, поэтому вращения родителей уже учтены.
 */
type Pose = Record<string, [number, number, number]>

/**
 * Сидя на стуле: бёдра вперёд, колени вниз, связанные кисти лежат на коленях.
 * Углы подобраны численно (tools/pose-search.mjs): кисти над бёдрами, локти
 * снаружи торса — руки не входят в тело.
 */
const SIT: Pose = {
  Spine: [0.14, 0.02, 0],
  Head: [0.06, 0, 0],
  LeftArm: [-0.5, 0.3, -0.35],
  RightArm: [-0.5, -0.3, 0.35],
  LeftForeArm: [-0.7, -0.7, 0],
  RightForeArm: [-0.7, 0.7, 0],
  LeftUpLeg: [-1.45, 0.1, 0.06],
  RightUpLeg: [-1.45, -0.1, -0.06],
  LeftLeg: [1.35, 0, 0],
  RightLeg: [1.35, 0, 0],
  LeftFoot: [0.1, 0, 0],
  RightFoot: [0.1, 0, 0],
}

/** Стоя: руки свободно висят вдоль тела, чуть в стороны. */
const STAND: Pose = {
  Spine: [0.05, 0, 0],
  Head: [0, 0, 0],
  LeftArm: [0, 0, 0.08],
  RightArm: [0, 0, -0.08],
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
/** Насколько вперёд из стула она выходит, пока встаёт: иначе ноги проходят сквозь сиденье. */
const RISE_STEP = 0.56
/** Радиус, внутри которого стул считается препятствием: обходит, а не проходит. */
const CHAIR_R = 0.5
/** Куда она убегает: по коридору, наискось, оставаясь в конусе камеры. */
const CORRIDOR_X = -0.85
const CORRIDOR_Z = -7.2

const clamp = (v: number, a: number, b: number): number => Math.min(b, Math.max(a, v))

/** Плавное начало и конец: без рывка на старте и без «щелчка» в конце. */
const smooth = (v: number): number => v * v * (3 - 2 * v)

export class Cctv {
  readonly canvas: HTMLCanvasElement
  /** Она вышла через дверь кухни: конец демо. */
  onEscaped?: () => void
  /** Маньяк добился своего: рабочий стол показывает «ВЫ ПРОИГРАЛИ». */
  onDead?: () => void
  /** Важная реплика: рабочий стол открывает заметки и дописывает строку. */
  onNoteAppend?: (line: string) => void

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
  private gapGlow: THREE.Mesh
  private gapLight: THREE.PointLight
  private dust: THREE.Points
  private lamp: THREE.PointLight
  /** Кухня за коридором: объекты и лампа. */
  private kitchen: Kitchen
  /** Какой камерой смотрим: 04 — комната 4, 05 — кухня. */
  private view: '04' | '05' = '04'
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
  /** Случайный «живой» жест: оглянулась, помахала камере, поёжилась. */
  private gesture: { kind: 'look' | 'wave' | 'shiver' | 'fidget'; start: number; dur: number; side: number } | null =
    null
  private gestureNext = 7
  /** Когда снова выбрать точку блуждания по кухне. */
  private wanderNext = 0

  // ── кухня: команды оператора ──────────────────────────────────────
  /** Текущее поручение: к какому объекту и что делать. */
  private task: {
    id: string
    action: string
    phase: 'walk' | 'act'
    fired: boolean
  } | null = null
  private taskT = 0
  /** Прогресс по кухне: что взято, найдено, напечатано. */
  private flags = {
    knife: false,
    fridgeOpen: false,
    meatOut: false,
    meatCut: false,
    hasPaper: false,
    leaving: false,
  }
  private fear = 0
  private refuseUsed = false
  private subtitle = { text: '', until: 0 }
  /** События для ленты камеры: звуки двери и прочее. */
  readonly events: string[] = []
  private exitCode = ''
  private printedCode = ''
  /** Сцена нападения: −1 нет, 0…3.5 идёт, −2 закончилась. */
  private attackT = -1
  private deadSent = false
  /** Провал случился, пока она ещё не дошла до кухни. */
  private maniacPending = false
  private raycaster = new THREE.Raycaster()
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

  /** Камера кухни: тот же рендер, другой ракурс. */
  static readonly CAM05 = {
    pos: [1.85, 2.5, -9.55] as [number, number, number],
    at: [-0.45, 0.7, -11.9] as [number, number, number],
    fov: 64,
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
    this.gapGlow = room.gapGlow
    this.gapLight = room.gapLight
    this.dust = room.dust
    this.kitchen = buildKitchen(this.scene)
    this.loadGirl()
    this.loadManiac()
    // Отладочный доступ к сцене — для tools/rig-axes.mjs и tools/shot-*.mjs.
    ;(window as unknown as { __cctv?: Cctv }).__cctv = this
  }

  /** Маньяк из набора PSX-персонажей: грузим своего FBX с текстурой. */
  private loadManiac(): void {
    const manager = new THREE.LoadingManager()
    manager.setURLModifier((url) => (url.toLowerCase().endsWith('.png') ? '/cctv/maniac.png' : url))
    const tex = new THREE.TextureLoader(manager).load('/cctv/maniac.png')
    tex.magFilter = THREE.NearestFilter
    tex.minFilter = THREE.NearestFilter
    tex.colorSpace = THREE.SRGBColorSpace
    const skin = new THREE.MeshLambertMaterial({ map: tex })
    new FBXLoader(manager).load('/cctv/maniac.fbx', (fbx) => {
      fbx.scale.setScalar(0.0037)
      fbx.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) {
          const mesh = o as THREE.Mesh
          mesh.material = skin
          mesh.frustumCulled = false
        }
      })
      // примитивная болванка больше не нужна — модель становится фигурой
      while (this.kitchen.maniac.children.length > 0) {
        this.kitchen.maniac.remove(this.kitchen.maniac.children[0])
      }
      this.kitchen.maniac.add(fbx)
    })
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

  /** Кольца верёвки двигаются вместе с кистями, пока девушка связана. */  private updateWristRopes(): void {
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

  /** Текущее состояние девушки — страховки сценария в CameraFeed. */
  get girlState(): GirlState {
    return this.state
  }

  /** Девушка пошла в кухню: узел 05 на карте оживает. */
  get kitchenReady(): boolean {
    return this.state === 'toKitchen' || this.state === 'kitchen'
  }

  /** Смотреть этим каналом: переключает ракурс камеры. */
  setView(view: '04' | '05'): void {
    if (this.view === view) return
    this.view = view
    this.applyCam()
  }

  get viewNow(): '04' | '05' {
    return this.view
  }

  /** Параметры единственной камеры — для карты и радара. */
  get cam(): typeof Cctv.CAM {
    return Cctv.CAM
  }

  /** Параметры камеры кухни — для узла 05 на карте. */
  get cam05(): typeof Cctv.CAM05 {
    return Cctv.CAM05
  }

  private applyCam(): void {
    const v = this.view === '05' ? Cctv.CAM05 : Cctv.CAM
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
      // дверь открыта — уходит в глубь коридора по диагонали, чтобы её было
      // видно в проёме, пока она не скроется в темноте
      this.targetX = CORRIDOR_X
      this.targetZ = CORRIDOR_Z
      this.yawTarget = Math.atan2(CORRIDOR_X - this.girl!.position.x, CORRIDOR_Z - this.girl!.position.z)
    } else if (state === 'pace') {
      // бродит перед стулом, не задевая его
      this.targetZ = -1.5
      this.yawTarget = Math.PI / 2
    } else if (state === 'idle') {
      this.targetX = this.girl!.position.x
      this.targetZ = this.girl!.position.z
    } else if (state === 'toKitchen') {
      // через весь коридор и проём в кухню
      this.targetX = KITCHEN.doorX
      this.targetZ = KITCHEN.z1 - 0.6
      this.yawTarget = Math.PI
    } else if (state === 'kitchen') {
      // оказалась внутри: начинает осваиваться с центра кухни
      this.targetX = 0
      this.targetZ = -10.7
      this.wanderNext = this.time + 2.5
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
      this.gestures()
      this.move(dt)
      this.kitchenTask(dt)
      // провал мог случиться в дороге: маньяк ждёт её на кухне
      if (this.maniacPending && this.state === 'kitchen') {
        this.maniacPending = false
        this.startAttack()
      }
      this.kitchenAttack(dt)
      this.animate(dt)
    }

    // лампа слегка дрожит, как настоящая люминесцентная
    const flick = 1 + Math.sin(this.time * 37) * 0.04 + Math.sin(this.time * 11) * 0.03
    this.lamp.intensity = 18 * flick

    // пыль медленно плывёт в луче
    this.dust.rotation.y = this.time * 0.03
    this.dust.position.y = Math.sin(this.time * 0.17) * 0.06

    // кухня живёт своей жизнью, даже когда её не смотрят
    this.kitchen.update(dt, this.time)

    if (this.doorOpen > 0 && this.doorOpen < 1) {
      this.doorOpen = Math.min(1, this.doorOpen + dt * 1.6)
      this.doorPivot.rotation.y = -this.doorOpen * 1.5
    }
    // полоса света из-под двери гаснет вместе с открытием
    this.gapLight.intensity = 3.4 * (1 - this.doorOpen)
    ;(this.gapGlow.material as THREE.MeshBasicMaterial).opacity = 1 - this.doorOpen

    this.renderer.render(this.scene, this.camera)
  }

  /** Сценарий: привязана, пока игрок не отвяжет; после — бродит и стучит. */
  private narrative(): void {
    // Жест важнее сценария: пока она машет или оглядывается, не дёргаем её к двери.
    if (this.gesture) return
    if (this.state === 'pace' || this.state === 'idle' || this.state === 'knock') {
      const cycle = (this.time - this.freedAt) % 12
      if (cycle < 7) this.setState('pace')
      else if (cycle < 11) this.setState('knock')
      else this.setState('idle')
      return
    }
    // В кухне бродит сама: время от времени выбирает новую точку.
    if (this.state === 'kitchen' && !this.task && !this.flags.leaving) {
      const g = this.girl!
      const near = Math.hypot(g.position.x - this.targetX, g.position.z - this.targetZ) < 0.35
      if (near && this.time >= this.wanderNext) {
        this.wanderNext = this.time + 4 + Math.random() * 5
        for (let i = 0; i < 12; i++) {
          const x = KITCHEN.x0 + 0.5 + Math.random() * 3.0
          const z = KITCHEN.z0 + 0.5 + Math.random() * 2.6
          const blocked = KITCHEN_OBSTACLES.some(
            (o) => Math.hypot(x - o.x, z - o.z) < o.r + 0.25,
          )
          if (!blocked) {
            this.targetX = x
            this.targetZ = z
            this.yawTarget = Math.atan2(x - g.position.x, z - g.position.z)
            break
          }
        }
      }
      return
    }
    // Уход через дверь: дойдя до порога, шагает наружу и растворяется.
    if (this.state === 'kitchen' && this.flags.leaving) {
      const g = this.girl!
      const near = Math.hypot(g.position.x - this.targetX, g.position.z - this.targetZ) < 0.35
      if (near) {
        this.targetX = 0
        this.targetZ = -13.6
      }
      if (g.position.z < -13.05) {
        g.visible = false
        this.setState('gone')
        this.onEscaped?.()
      }
    }
  }

  /**
   * Раз в несколько секунд она делает что-то «своё»: оглядывается по сторонам,
   * останавливается и машет камере, поёживается. Без этого она просто ходит
   * туда-сюда и выглядит как робот.
   */
  private gestures(): void {
    const t = this.time
    if (this.task || this.attackT >= 0) return // занята поручением или случилось худшее
    if (this.gesture) {
      if (t - this.gesture.start > this.gesture.dur) {
        this.gesture = null
        this.gestureNext = t + 3 + Math.random() * 4.5
      }
      return
    }
    if (this.freeT < 1) return
    if (this.state !== 'pace' && this.state !== 'idle' && this.state !== 'kitchen') return
    if (t < this.gestureNext) return

    const r = Math.random()
    const kind = r < 0.34 ? 'look' : r < 0.62 ? 'wave' : r < 0.82 ? 'shiver' : 'fidget'
    const dur = kind === 'wave' ? 3.8 : kind === 'look' ? 2.4 : kind === 'shiver' ? 1.7 : 2.1
    this.gesture = { kind, start: t, dur, side: Math.random() < 0.5 ? -1 : 1 }
    this.gestureNext = t + dur + 2.5 + Math.random() * 4
  }

  /** Поворот, при котором девушка смотрит в камеру (текущую). */
  private faceCameraYaw(): number {
    const g = this.girl!
    const v = this.view === '05' ? Cctv.CAM05 : Cctv.CAM
    return Math.atan2(v.pos[0] - g.position.x, v.pos[2] - g.position.z)
  }

  /** Не пускает сквозь мебель: стул в комнате 4 или объекты кухни. */
  private avoidChair(x: number, z: number): { x: number; z: number } {
    const obstacles =
      z < KITCHEN.z1 ? KITCHEN_OBSTACLES : [{ x: CHAIR.x, z: CHAIR.z, r: CHAIR_R }]
    let px = x
    let pz = z
    for (const o of obstacles) {
      const dx = px - o.x
      const dz = pz - o.z
      const d = Math.hypot(dx, dz)
      if (d >= o.r || d < 1e-5) continue
      const k = o.r / d
      px = o.x + dx * k
      pz = o.z + dz * k
    }
    // в кухне не даём пройти сквозь стены — кроме финального ухода в дверь
    if (pz < KITCHEN.z1 && !this.flags.leaving) {
      px = clamp(px, KITCHEN.x0 + 0.3, KITCHEN.x1 - 0.3)
      pz = clamp(pz, KITCHEN.z0 + 0.3, KITCHEN.z1 - 0.1)
    }
    return { x: px, z: pz }
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
    if (this.state === 'kitchen') return 0.55 + this.fear * 0.45 + Math.sin(this.time * 0.5) * 0.04
    if (this.state === 'run' || this.state === 'toKitchen') return 1
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

    // Подъём со стула — по сценарию, а не лерпом к цели: она подаётся вперёд
    // и выходит из стула, иначе ноги проходят сквозь сиденье.
    if (this.freeT < 1) {
      this.freeT = Math.min(1, this.freeT + dt * 0.85)
      const step = RISE_STEP * smooth(this.freeT)
      g.position.x = CHAIR.x + Math.sin(CHAIR_YAW) * step
      g.position.z = CHAIR.z + Math.cos(CHAIR_YAW) * step
      this.prev.set(g.position.x, 0, g.position.z)
      this.phase = 0
      this.yaw = this.yawTarget = CHAIR_YAW
      g.rotation.y = this.yaw
      return
    }

    // Нападение: она застыла, дальше двигает сцена атаки.
    if (this.attackT >= 0) {
      this.prev.set(g.position.x, 0, g.position.z)
      return
    }

    // Жест на месте: останавливается, чтобы оглянуться или помахать.
    if (this.gesture) {
      this.targetX = g.position.x
      this.targetZ = g.position.z
    }

    // Добежала до темноты коридора — уходит дальше, в кухню (КАМ-04 её теряет).
    if (this.state === 'run' && g.position.z < -6.9) {
      this.setState('toKitchen')
    }
    // Прошла проём — теперь она на кухне.
    if (this.state === 'toKitchen' && g.position.z < KITCHEN.z1 - 0.1) {
      this.setState('kitchen')
    }

    // Доворот с ограничением скорости: она не щёлкает на 180° за кадр.
    let d = (this.yawTarget - this.yaw) % (Math.PI * 2)
    if (d > Math.PI) d -= Math.PI * 2
    if (d < -Math.PI) d += Math.PI * 2
    const turnStep = clamp(d, -2.4 * dt, 2.4 * dt)
    this.yaw += turnStep
    this.yawDelta = turnStep
    g.rotation.y = this.yaw

    // Пока корпус не довернулся, почти не идёт: иначе получается бег боком.
    const facing = Math.max(0, Math.cos(d))
    const k = Math.min(1, dt * 2.2 * (0.12 + 0.88 * facing * facing))
    // скорость ограничена: до далёкой цели она идёт/бежит, а не телепортится
    let vx = (this.targetX - g.position.x) * k
    let vz = (this.targetZ - g.position.z) * k
    const step = Math.hypot(vx, vz)
    const maxStep = (this.state === 'run' ? 3.4 : 2.4) * dt
    if (step > maxStep) {
      vx *= maxStep / step
      vz *= maxStep / step
    }
    g.position.x += vx
    g.position.z += vz
    const safe = this.avoidChair(g.position.x, g.position.z)
    g.position.x = safe.x
    g.position.z = safe.z
    // шаги совпадают с пройденным путём, а не с временем
    const moved = Math.hypot(g.position.x - this.prev.x, g.position.z - this.prev.z)
    this.phase += moved * 4.6
    this.prev.set(g.position.x, 0, g.position.z)
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

    // Вставание: смесь сидячей и стоячей позы, наклон вперёд и упор руками
    // в колени — так подъём читается как усилие, а не как всплытие.
    if (this.freeT < 1) {
      const riseBase = this.mix(SIT, STAND, this.freeT)
      const push = Math.sin(this.freeT * Math.PI)
      this.add(riseBase, 'Spine', push * 0.5, 0, 0)
      this.add(riseBase, 'Head', -push * 0.18, 0, 0)
      this.add(riseBase, 'LeftForeArm', push * 0.45, 0, 0)
      this.add(riseBase, 'RightForeArm', push * 0.45, 0, 0)
      this.add(riseBase, 'LeftUpLeg', push * 0.12, 0, 0)
      this.add(riseBase, 'RightUpLeg', push * 0.12, 0, 0)
      this.tremor(riseBase, t, stress)
      this.applyPose(riseBase)
      this.updateWristRopes()
      return
    }

    // Нападение: она застыла лицом к маньяку и дрожит.
    if (this.attackT >= 0 && this.attackT < 2.2) {
      const p: Pose = { ...STAND }
      this.add(p, 'Spine', -0.18, 0, 0)
      this.add(p, 'LeftArm', -0.45, 0, 0.55)
      this.tremor(p, t, 1)
      this.applyPose(p)
      return
    }

    const nearTarget = Math.hypot(g.position.x - this.targetX, g.position.z - this.targetZ) < 0.3
    const walkingTask = !!this.task && this.task.phase === 'walk'
    const moving =
      !this.gesture &&
      this.attackT < 0 &&
      (this.state === 'pace' ||
        this.state === 'run' ||
        this.state === 'toKitchen' ||
        (this.state === 'kitchen' && (!nearTarget || this.flags.leaving || walkingTask)) ||
        (this.state === 'knock' && !nearTarget))
    this.moveBlend += ((moving ? 1 : 0) - this.moveBlend) * Math.min(1, dt * 5)

    const base = this.mix(SIT, STAND, this.freeT)

    if (moving) {
      this.walkPose(base, t)
    } else if (this.state === 'knock') {
      this.knockPose(base, t, dt, stress)
    } else {
      this.standPose(base, t, dt, breath, stress)
    }

    // действие по поручению: руки и наклон поверх стойки
    if (this.task && this.task.phase === 'act') this.taskPose(base)

    this.tremor(base, t, stress)
    this.applyPose(base)
    this.updateWristRopes()
  }

  /** Поза действия по поручению: наклон и руки поверх базовой позы. */
  private taskPose(p: Pose): void {
    const task = this.task!
    const k = this.taskT
    const reach = (v: number): number => Math.sin(clamp(v, 0, 1) * Math.PI)
    if (task.id === 'knife') {
      const m = reach(k / 1.2)
      this.add(p, 'RightArm', -1.6 * m, 0, -0.25 * m)
      this.add(p, 'RightForeArm', -0.6 * m, 0, 0)
      this.add(p, 'Spine', 0.3 * m, 0, 0)
    } else if (task.id === 'fridge' || (task.id === 'meat' && task.action === 'cut')) {
      const m = reach(k / 1.6)
      this.add(p, 'LeftArm', -1.7 * m, 0, 0.3 * m)
      this.add(p, 'RightArm', -1.7 * m, 0, -0.3 * m)
      this.add(p, 'LeftForeArm', -0.5 * m, 0, 0)
      this.add(p, 'RightForeArm', -0.5 * m, 0, 0)
      this.add(p, 'Spine', 0.35 * m, 0, 0)
      if (task.action === 'cut') {
        // рубящие взмахи правой рукой
        const chop = Math.max(0, Math.sin(k * 9)) * (k > 0.3 && k < 1.5 ? 1 : 0.2)
        this.add(p, 'RightForeArm', chop * 0.8, 0, 0)
      }
    } else if (task.id === 'printer') {
      const m = reach(k / 1.4)
      this.add(p, 'RightArm', -1.3 * m, -0.4 * m, -0.2 * m)
      this.add(p, 'LeftArm', -1.3 * m, 0.4 * m, 0.2 * m)
      this.add(p, 'Spine', 0.4 * m, 0, 0)
      this.add(p, 'Head', 0.3 * m, 0, 0)
    } else if (task.id === 'exit') {
      const m = reach(k / 1.0)
      this.add(p, 'RightArm', -1.45 * m, -0.55 * m, -0.1 * m)
      this.add(p, 'Spine', 0.2 * m, 0, 0)
      this.add(p, 'Head', 0.12 * m, 0, 0)
    } else if (task.id === 'stove') {
      const m = reach(k / 1.2)
      this.add(p, 'Spine', 0.35 * m, 0, 0)
      this.add(p, 'Head', 0.25 * m, 0, 0)
    }
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
    const armX = -0.5 - pull * 0.4 + Math.sin(w * 1.3) * 0.04
    p.LeftArm = [armX, 0.3, -0.35 - pull * 0.1]
    p.RightArm = [armX, -0.3, 0.35 + pull * 0.1]
    p.LeftForeArm = [-0.7 - pull * 0.3, -0.7, 0]
    p.RightForeArm = [-0.7 - pull * 0.3, 0.7, 0]
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

  /** Ходьба и бег: махи ног, скрутка корпуса, крен и мелкий шаг в развороте. */
  private walkPose(base: Pose, t: number): void {
    const g = this.girl!

    if (this.state === 'pace') {
      // ходит туда-сюда перед стулом; путь слегка неровный, не по линейке
      this.targetX = -0.25 + Math.sin(t * 0.42) * 0.62 + this.wob(t * 0.5, 5) * 0.05
      this.targetZ = -0.35 + Math.sin(t * 0.27 + 1.2) * 0.1
    }

    // Поворот — по направлению реального движения: и в брожении, и в беге.
    // Так корпус всегда разворачивается туда, куда она идёт, а не по осям.
    const dx = this.targetX - g.position.x
    const dz = this.targetZ - g.position.z
    if (Math.hypot(dx, dz) > 0.16) this.yawTarget = Math.atan2(dx, dz)

    // насколько корпус ещё не довернулся к движению: в развороте шаг мельче,
    // вес переносится, голова ведёт поворот
    let err = (this.yawTarget - this.yaw) % (Math.PI * 2)
    if (err > Math.PI) err -= Math.PI * 2
    if (err < -Math.PI) err += Math.PI * 2
    const turning = clamp(Math.abs(err) / 1.2, 0, 1)
    const lean = clamp(err, -0.7, 0.7)

    const run = this.state === 'run'
    const w = this.phase * (run ? 1.35 : 1)
    const amp = this.moveBlend * (run ? 0.58 : 0.42) * (1 - turning * 0.3)
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

    // корпус: наклон вперёд, плечи скручиваются против бёдер, в повороте крен
    base.Spine = [(run ? 0.2 : 0.08) + amp * 0.08, -swingL * 0.08, -lean * 0.05]
    // голова запаздывает за корпусом и ведёт разворот
    base.Head = [
      Math.sin(w * 2 - 0.6) * amp * 0.06,
      -swingL * 0.06 + lean * 0.3,
      this.wob(t, 4) * 0.03,
    ]

    // руки качаются в противофазе ногам; локти гнутся, когда рука идёт вперёд
    const armL = swingL * amp * 1.15
    const armR = swingR * amp * 1.15
    base.LeftArm = [armL, 0, 0.1]
    base.RightArm = [armR, 0, -0.1]
    base.LeftForeArm = [-0.22 - Math.max(0, -armL) * 0.9, 0, 0]
    base.RightForeArm = [-0.22 - Math.max(0, -armR) * 0.9, 0, 0]

    // бёдра: перекат веса и скрутка в такт шагам
    this.add(base, 'Hips', 0, swingL * 0.08 * this.moveBlend, -swingL * 0.045 * this.moveBlend)
    // крен в поворот: куда крутится, туда и заваливается
    this.add(base, 'Hips', 0, 0, -lean * 0.06 + clamp(this.yawDelta * 1.5, -0.06, 0.06))

    // подпрыг корпуса: двойная частота шага
    g.position.y += Math.abs(Math.cos(w)) * (run ? 0.04 : 0.022) * this.moveBlend
  }

  /** Стоит у двери и бьётся в неё: серии из трёх ударов, пауза, осмотр. */
  private knockPose(base: Pose, t: number, dt: number, stress: number): void {
    this.knockT += dt
    // серия: три удара по 0.47 с, потом пауза — ритм неровный, не метроном
    const cycle = this.knockT % 3.4
    const idx = Math.floor(cycle / 0.47)
    const inBurst = cycle < 1.41 && idx < 3
    const hit = inBurst ? Math.sin(((cycle % 0.47) / 0.47) * Math.PI) ** 1.5 : 0

    // Руки подняты вперёд к двери; бьёт по очереди, вторая ладонью опирается.
    const right = idx % 2 === 0
    const shoulder = -1.42 - hit * 0.14
    const elbow = -0.28 + hit * 0.12
    if (right) {
      base.RightArm = [shoulder, 0, -0.16]
      base.RightForeArm = [elbow, 0, 0]
      base.LeftArm = [-1.36, 0, 0.16]
      base.LeftForeArm = [-0.42, 0, 0]
    } else {
      base.LeftArm = [shoulder, 0, 0.16]
      base.LeftForeArm = [elbow, 0, 0]
      base.RightArm = [-1.36, 0, -0.16]
      base.RightForeArm = [-0.42, 0, 0]
    }

    // бьётся всем телом: корпус и голова подаются в удары
    base.Spine = [0.12 + hit * 0.07, (right ? -1 : 1) * (0.03 + hit * 0.05), 0]
    base.Head = [0.05 + hit * 0.06, hit > 0.1 ? 0 : this.wob(t * 0.5, 6) * 0.3, 0]
    this.add(base, 'Hips', 0, 0, hit * 0.025)

    // стоит у двери, лицом к ней
    this.targetX = 0
    this.targetZ = -2.45
    this.yawTarget = Math.PI
    void stress
  }

  /** Стоит без дела: переминается, вес перекатывается, живые случайные жесты. */
  private standPose(base: Pose, t: number, dt: number, breath: number, stress: number): void {
    const gst = this.gesture
    const gp = gst ? clamp((t - gst.start) / gst.dur, 0, 1) : 0

    // взгляд: жест задаёт цель, иначе дверь/руки/стороны
    if (gst?.kind === 'look') {
      this.gazeTarget = { x: 0.02, y: gst.side * 0.95 }
    } else if (gst?.kind === 'wave') {
      this.gazeTarget = { x: -0.18, y: 0 } // в камеру
    } else if (gst?.kind === 'shiver') {
      this.gazeTarget = { x: 0.3, y: 0 }
    } else if (gst?.kind === 'fidget') {
      this.gazeTarget = { x: 0.45, y: -0.35 }
    } else if (t > this.gazeNext) {
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
    base.LeftArm = [this.wob(t, 2) * 0.04, 0, 0.08 + shift * 0.03]
    base.RightArm = [this.wob(t, 6) * 0.04, 0, -0.08 + shift * 0.03]
    base.LeftForeArm = [-0.18 + this.wob(t * 0.7, 1) * 0.08, 0, 0]
    base.RightForeArm = [-0.18 + this.wob(t * 0.7, 8) * 0.08, 0, 0]

    // ── живые жесты ──────────────────────────────────────────────────
    if (gst?.kind === 'wave') {
      // Рука идёт вперёд, к камере: плечо поднято и чуть повёрнуто к объективу,
      // предплечье согнуто, ладонь развёрнута в камеру, кисть качается.
      const up = smooth(clamp(gp / 0.22, 0, 1))
      const down = 1 - smooth(clamp((gp - 0.76) / 0.22, 0, 1))
      const raise = up * down
      const idle = 1 - raise
      const shake = Math.sin((t - gst.start) * 9) * raise
      base.RightArm = [this.wob(t, 6) * 0.04 * idle, 0.6 * raise, -0.08 - 1.03 * raise]
      base.RightForeArm = [
        (-0.18 + this.wob(t * 0.7, 8) * 0.08) * idle,
        -0.8 * raise + shake * 0.1,
        -1.4 * raise,
      ]
      base.RightHand = [0, 0, shake * 0.5]
      base.Head = [base.Head[0] - 0.08 * raise, this.gaze.y, 0.06 * raise]
      base.Spine = [base.Spine[0], base.Spine[1] + 0.05 * raise, base.Spine[2]]
      this.yawTarget = this.faceCameraYaw()
    } else if (gst?.kind === 'look') {
      base.Spine = [base.Spine[0], base.Spine[1] + gst.side * 0.08, base.Spine[2]]
    } else if (gst?.kind === 'shiver') {
      // плечи к ушам, руки прижаты, мелкая дрожь
      const sh = Math.sin(Math.PI * gp) ** 0.7
      base.Spine = [base.Spine[0] + 0.1 * sh, base.Spine[1], base.Spine[2]]
      base.Head = [
        base.Head[0] + 0.12 * sh,
        base.Head[1] + Math.sin(t * 22) * 0.03 * sh,
        base.Head[2],
      ]
      base.LeftArm = [base.LeftArm[0], 0, base.LeftArm[2] - 0.12 * sh]
      base.RightArm = [base.RightArm[0], 0, base.RightArm[2] + 0.12 * sh]
      base.LeftForeArm = [base.LeftForeArm[0] - 0.3 * sh, 0, 0]
      base.RightForeArm = [base.RightForeArm[0] - 0.3 * sh, 0, 0]
    } else if (gst?.kind === 'fidget') {
      // переступает на месте и теребит край свитера
      const sh = Math.sin(Math.PI * gp) ** 0.7
      base.LeftForeArm = [base.LeftForeArm[0] - 0.5 * sh, -0.3 * sh, 0]
      base.RightForeArm = [base.RightForeArm[0] - 0.45 * sh, 0.3 * sh, 0]
      base.Spine = [base.Spine[0] + 0.04 * sh, base.Spine[1], base.Spine[2]]
    }

    // Жест держит её на месте; иначе — просто стоит там, где остановилась,
    // и смотрит к двери (не «подъезжает» к стулу сквозь него).
    this.targetX = this.girl!.position.x
    this.targetZ = this.girl!.position.z
    if (!gst) this.yawTarget = Math.PI
  }

  /** Дверь открывается — девушка убегает. */
  /** Отладка для ?kitchen: сразу отвязать и отправить в кухню. */
  debugToKitchen(): void {
    this.untie()
    this.setState('toKitchen')
  }

  // ── команды оператора на кухне ────────────────────────────────────

  get kitchenFear(): number {
    return this.fear
  }

  get subtitleNow(): { text: string; until: number } {
    return this.subtitle
  }

  get attackNow(): number {
    return this.attackT
  }

  /** Оператор выбрал команду в меню объекта. */
  command(id: string, action: string): void {
    if (this.state !== 'kitchen' || this.attackT >= 0 || this.flags.leaving) return
    if (this.task) return // занята предыдущим поручением
    this.gesture = null // поручение важнее «живости»: она прерывает жест
    // printer и exit — в тёмном углу: со страхом она туда первый раз не пойдёт
    const dark = id === 'printer' || id === 'exit'
    if (dark && this.fear > 0.5 && !this.refuseUsed) {
      this.say('там так темно... не хочу одна. не заставляй', 3.6)
      this.refuseUsed = true
      return
    }
    if (dark && this.refuseUsed && !this.task) {
      // собралась с духом — но только на этот раз
      this.say('...ладно. только быстро, хорошо?', 2.6)
      this.refuseUsed = false
      this.fear = Math.min(1, this.fear + 0.1)
    }
    if (id === 'meat' && action === 'cut' && !this.flags.knife) {
      this.say('чем резать? нужен нож. он на столе', 3)
      return
    }
    if (id === 'exit' && action === 'try' && !this.flags.hasPaper) {
      this.say('у двери клавиатура. нужен код — бумажка с принтера', 3.4)
      return
    }
    this.task = { id, action, phase: 'walk', fired: false }
    const obj = this.kitchen.objects.find((o) => o.id === id)
    if (obj) {
      this.targetX = obj.stand[0]
      this.targetZ = obj.stand[1]
      this.yawTarget = obj.yaw
    }
  }

  /** Пароль выхода с pairs.local — его знает только дверь. */
  setExitCode(code: string): void {
    this.exitCode = code
  }

  /** Сайт отправил печать: принтер выносит бумажку с тем, что ввели. */
  print(code: string): void {
    if (this.state !== 'kitchen' && this.state !== 'toKitchen') return
    this.printedCode = code
    this.kitchen.startPrint()
  }

  /** Провал головоломки: маньяк бросается из проёма. */
  maniacAttack(): void {
    if (this.attackT >= 0 || this.state === 'tied') return
    // нападение возможно только на кухне: если она ещё в пути — откладываем
    if (this.state !== 'kitchen') {
      this.maniacPending = true
      return
    }
    this.startAttack()
  }

  private startAttack(): void {
    this.task = null
    this.attackT = 0
    this.kitchen.maniac.visible = true
    this.kitchen.maniac.position.set(0, 0, KITCHEN.z1 - 0.3)
  }

  private say(text: string, sec: number): void {
    this.subtitle = { text, until: performance.now() + sec * 1000 }
  }

  /**
   * Логика поручений: дойти до объекта, выполнить действие с позой и
   * эффектами. Вызывается каждый кадр, пока на кухне.
   */
  private kitchenTask(dt: number): void {
    const g = this.girl!
    // бумажка выползла из принтера — она слышала и идёт сама
    if (
      !this.task &&
      this.state === 'kitchen' &&
      !this.flags.leaving &&
      this.kitchen.paperReady &&
      !this.flags.hasPaper &&
      this.attackT < 0
    ) {
      this.task = { id: 'printer', action: 'takePaper', phase: 'walk', fired: false }
      const obj = this.kitchen.objects.find((o) => o.id === 'printer')!
      this.targetX = obj.stand[0]
      this.targetZ = obj.stand[1]
      this.yawTarget = obj.yaw
    }
    if (!this.task || this.attackT >= 0) return
    const t = this.task
    const obj = this.kitchen.objects.find((o) => o.id === t.id)
    if (!obj) {
      this.task = null
      return
    }

    if (t.phase === 'walk') {
      // смотрим по ходу движения, иначе из-за препятствия не дойдёт:
      // разворот на объект — только на месте, в фазе действия
      this.yawTarget = Math.atan2(obj.stand[0] - g.position.x, obj.stand[1] - g.position.z)
      const near = Math.hypot(g.position.x - obj.stand[0], g.position.z - obj.stand[1]) < 0.3
      if (near) {
        t.phase = 'act'
        this.taskT = 0
        this.yawTarget = obj.yaw
      }
      return
    }

    // фаза действия: таймер и одноразовые эффекты
    this.taskT += dt
    const at = this.taskT
    if (t.id === 'knife' && t.action === 'take') {
      if (at > 0.9 && !t.fired) {
        t.fired = true
        this.flags.knife = true
        this.fear = 0.65
        // нож больше не на столе: она его забрала
        const knifeObj = this.kitchen.objects.find((o) => o.id === 'knife')
        if (knifeObj) knifeObj.mesh.visible = false
        this.say('кровь... она ещё свежая. не свернулась. за мной шли недавно', 4.2)
      }
      if (at > 1.8) this.task = null
      return
    }
    if (t.id === 'fridge' && t.action === 'inspect') {
      if (at > 0.7 && !t.fired) {
        t.fired = true
        this.flags.fridgeOpen = true
        this.kitchen.setFridgeOpen(true)
      }
      if (at > 1.7 && !this.flags.meatOut) {
        this.flags.meatOut = true
        this.kitchen.meat.visible = true
        this.say('тут кусок мяса... большой, свежий', 3.2)
      }
      if (at > 2.4) this.task = null
      return
    }
    if (t.id === 'meat' && t.action === 'cut') {
      if (at > 1.5 && !t.fired) {
        t.fired = true
        this.kitchen.meat.visible = false
        this.kitchen.plate.visible = true
        this.flags.meatCut = true
        this.say('внутри железка... на ней выбит адрес', 3)
        this.onNoteAppend?.('Железка внутри мяса: выбит адрес pairs.local — это головоломка')
      }
      if (at > 2.6) {
        this.say('пары точка локал. это их архив — записывай!', 4)
        this.task = null
      }
      return
    }
    if (t.id === 'stove' && t.action === 'inspect') {
      if (at > 0.8 && !t.fired) {
        t.fired = true
        this.say('плита ещё тёплая... тут кто-то был совсем недавно', 3.4)
      }
      if (at > 1.8) this.task = null
      return
    }
    if (t.id === 'printer' && t.action === 'read') {
      if (at > 0.8 && !t.fired) {
        t.fired = true
        this.say('на наклейке адрес: print.local — туда вводят пароль для печати', 4)
        this.onNoteAppend?.('Принтер на кухне: print.local — ввести пароль и нажать «Печать»')
      }
      if (at > 1.9) this.task = null
      return
    }
    if (t.id === 'printer' && t.action === 'takePaper') {
      if (at > 0.8 && !t.fired) {
        t.fired = true
        this.flags.hasPaper = true
        this.kitchen.hidePaper()
        this.say(`бумажка... тут цифры: ${this.printedCode}. иду к двери`, 3.4)
      }
      if (at > 1.6) {
        // сама идёт пробовать код: задача принтера закрывается, дверь — новая
        const obj = this.kitchen.objects.find((o) => o.id === 'exit')!
        this.task = { id: 'exit', action: 'try', phase: 'walk', fired: false }
        this.targetX = obj.stand[0]
        this.targetZ = obj.stand[1]
        this.yawTarget = obj.yaw
      }
      return
    }
    if (t.id === 'exit' && t.action === 'try') {
      if (at > 1.0 && !t.fired) {
        t.fired = true
        if (this.printedCode && this.printedCode === this.exitCode) {
          this.kitchen.setExitOpen(true)
          this.events.push('doorOk')
          this.say('подошло! дверь открылась — я выхожу', 3)
          this.flags.leaving = true
          this.targetX = 0
          this.targetZ = -12.6
        } else {
          this.events.push('doorDeny')
          this.fear = 1
          this.say('не подходит... дверь отказала. она огорчена', 3.4)
        }
      }
      if (!this.flags.leaving && at > 2.0) this.task = null
      return
    }
    this.task = null
  }

  /** Сцена нападения: маньяк настигает её у кухни. */
  private kitchenAttack(dt: number): void {
    if (this.attackT < 0) return
    const g = this.girl!
    this.attackT += dt
    const m = this.kitchen.maniac
    const t = this.attackT
    // рывок из проёма к ней
    const rush = Math.min(1, t / 1.1)
    const tx = g.position.x
    const tz = g.position.z + 0.4
    m.position.x = 0 + (tx - 0) * rush
    m.position.z = KITCHEN.z1 - 0.3 + (tz - (KITCHEN.z1 - 0.3)) * rush
    m.rotation.y = Math.atan2(tx - m.position.x, tz - m.position.z)
    // замах всем корпусом: наклоняется и делает выпад в момент удара
    m.rotation.x = rush < 1 ? 0.12 : 0.35 + Math.sin(t * 26) * 0.25
    const lunge = rush >= 1 ? Math.max(0, Math.sin((t - 1.1) * 9)) * 0.22 : 0
    m.position.x += Math.sin(m.rotation.y) * lunge
    m.position.z += Math.cos(m.rotation.y) * lunge
    // она разворачивается к нему и дрожит
    this.yaw = this.yawTarget = Math.atan2(m.position.x - g.position.x, m.position.z - g.position.z)
    g.rotation.y = this.yaw
    if (t > 2.1 && g.visible) {
      // удар остаётся за глитчами кадра: её не видно
      g.visible = false
    }
    if (t > 2.4 && !this.deadSent) {
      this.deadSent = true
      this.onDead?.()
    }
    if (t > 3.4) {
      m.visible = false
      this.attackT = -2
    }
  }

  // ── ввод по кадру кухни ───────────────────────────────────────────

  /** Что под курсором на кухне (nx, ny — NDC кадра). */
  pick(nx: number, ny: number): { id: string; label: string } | null {
    if (this.view !== '05') return null
    this.raycaster.setFromCamera(new THREE.Vector2(nx, ny), this.camera)
    const objs = this.kitchen.objects.filter((o) => o.mesh.visible)
    const hits = this.raycaster.intersectObjects(objs.map((o) => o.mesh), true)
    for (const h of hits) {
      let o: THREE.Object3D | null = h.object
      while (o) {
        const found = objs.find((v) => v.mesh === o)
        if (found) return { id: found.id, label: found.label }
        o = o.parent
      }
    }
    return null
  }

  /** Экранная точка объекта в пикселях ленты 320×240 — для режима скана. */
  project(id: string): { x: number; y: number; label: string } | null {
    if (this.view !== '05') return null
    const obj = this.kitchen.objects.find((o) => o.id === id)
    if (!obj || !obj.mesh.visible) return null
    const p = new THREE.Vector3()
    obj.mesh.getWorldPosition(p)
    p.project(this.camera)
    if (p.z > 1) return null
    return { x: (p.x * 0.5 + 0.5) * W, y: (-p.y * 0.5 + 0.5) * H, label: obj.label }
  }

  release(): void {
    if (this.doorOpen === 0) this.doorOpen = 0.0001
    // жест мог держать её на месте — иначе она зависнет на пороге
    this.gesture = null
    this.setState('run')
  }
}

// Один экземпляр на всю игру: камера и карта смотрят на одну и ту же сцену.
let shared: Cctv | null = null

export function getCctv(): Cctv {
  if (!shared) shared = new Cctv()
  return shared
}
