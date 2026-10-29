import * as THREE from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import { makeFinalPass } from './postfx'
import { DESKTOP_H, DESKTOP_W } from './desktop/desktop'

const SCREEN_W = 0.36
const SCREEN_H = 0.27
const SCREEN_Y = 0.17
const SCREEN_Z = 0.075

/** Тёмная комната: стол, монитор ЭЛТ, пыль, гудящая лампа. */
export class Room {
  private renderer: THREE.WebGLRenderer
  private scene = new THREE.Scene()
  private camera: THREE.PerspectiveCamera
  private composer: EffectComposer
  private pass: ReturnType<typeof makeFinalPass>
  private screenTex: THREE.CanvasTexture
  private screenMesh: THREE.Mesh
  private screenMat: THREE.MeshBasicMaterial
  private glow: THREE.Sprite
  private screenLight: THREE.PointLight
  private bulbLight: THREE.PointLight
  private dust: THREE.Points
  private dustVel: Float32Array
  private monitor = new THREE.Group()
  private raycaster = new THREE.Raycaster()
  private plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -SCREEN_Z)
  private eye = new THREE.Vector3(0, 0.255, 0.42)
  private target = new THREE.Vector3(0, 0.195, 0.07)
  private look = new THREE.Vector2()
  private clock = 0

  constructor(host: HTMLElement, desktop: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' })
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.toneMapping = THREE.NoToneMapping
    host.appendChild(this.renderer.domElement)

    this.scene.background = new THREE.Color(0x05070a)
    this.scene.fog = new THREE.FogExp2(0x05070a, 0.22)

    this.camera = new THREE.PerspectiveCamera(46, 1, 0.01, 20)
    this.camera.position.copy(this.eye)
    this.camera.lookAt(this.target)

    this.monitor.rotation.y = -0.045
    this.scene.add(this.monitor)

    this.buildRoom()
    this.buildDesk()

    this.screenTex = new THREE.CanvasTexture(desktop)
    this.screenTex.colorSpace = THREE.SRGBColorSpace
    this.screenTex.anisotropy = this.renderer.capabilities.getMaxAnisotropy()
    this.screenTex.minFilter = THREE.LinearMipmapLinearFilter

    this.screenMat = new THREE.MeshBasicMaterial({ map: this.screenTex, toneMapped: false })
    this.screenMesh = new THREE.Mesh(this.curvedScreen(), this.screenMat)
    this.screenMesh.position.set(0, SCREEN_Y, SCREEN_Z)
    this.monitor.add(this.screenMesh)

    this.screenLight = new THREE.PointLight(0xa6d2ff, 0.35, 2.4, 2)
    this.screenLight.position.set(0, SCREEN_Y + 0.04, SCREEN_Z + 0.12)
    this.monitor.add(this.screenLight)

    this.glow = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: glowTexture(),
        color: 0x86b6dd,
        transparent: true,
        opacity: 0.1,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    )
    this.glow.scale.set(0.9, 0.75, 1)
    // За корпусом монитора: светящееся пятно на стене, а не плёнка поверх экрана.
    this.glow.position.set(0, SCREEN_Y, SCREEN_Z - 0.28)
    this.monitor.add(this.glow)

    const bulb = this.buildBulb()
    this.bulbLight = bulb

    const dust = this.buildDust()
    this.dust = dust.points
    this.dustVel = dust.vel

    this.composer = new EffectComposer(this.renderer)
    this.composer.addPass(new RenderPass(this.scene, this.camera))
    this.pass = makeFinalPass()
    this.composer.addPass(this.pass)
    this.composer.addPass(new OutputPass())

    this.resize()
  }

  // ── геометрия сцены ──────────────────────────────────────────────

  private buildRoom(): void {
    const paper = wallpaperTexture()
    const lino = linoleumTexture()
    const wall = new THREE.MeshStandardMaterial({
      map: paper,
      // слабая самосветимость: обои должны читаться в темноте, иначе комната — чёрный фон
      emissiveMap: paper,
      emissive: 0x6b6250,
      emissiveIntensity: 0.5,
      color: 0x9d968a,
      roughness: 1,
      side: THREE.BackSide,
    })
    const ceilingMat = new THREE.MeshStandardMaterial({
      color: 0x3f3c36,
      emissive: 0x161411,
      emissiveIntensity: 0.4,
      roughness: 1,
      side: THREE.BackSide,
    })
    const floorMat = new THREE.MeshStandardMaterial({
      map: lino,
      emissiveMap: lino,
      emissive: 0x3f3328,
      emissiveIntensity: 0.4,
      color: 0x6d655c,
      roughness: 0.85,
      side: THREE.BackSide,
    })

    // порядок граней бокса: +x, -x, +y, -y, +z, -z
    const walls = new THREE.Mesh(new THREE.BoxGeometry(4.4, 2.4, 3.6), [
      wall,
      wall,
      ceilingMat,
      floorMat,
      wall,
      wall,
    ])
    walls.position.set(0, 0.45, -1)
    this.scene.add(walls)

    this.scene.add(new THREE.AmbientLight(0x141c26, 0.7))
    this.scene.add(new THREE.HemisphereLight(0x0e1a22, 0x050505, 0.3))

    // лампа где-то над столом, вне кадра: даёт объём комнате
    const ceiling = new THREE.PointLight(0x6d8ba0, 0.8, 3.6, 2)
    ceiling.position.set(-0.2, 1.5, 0.3)
    this.scene.add(ceiling)

    this.buildWindow()
    this.buildRadiator()

    // плинтус: голая стена без него выглядит как декорация
    const skirt = new THREE.Mesh(
      new THREE.BoxGeometry(4.36, 0.07, 0.02),
      new THREE.MeshStandardMaterial({ color: 0x2e2a25, roughness: 1 }),
    )
    skirt.position.set(0, 0.02, -2.79)
    this.scene.add(skirt)

    // решётка вентиляции на дальней стене — силуэт, чтобы комната не была пустой
    const grate = new THREE.Mesh(
      new THREE.BoxGeometry(0.6, 0.4, 0.02),
      new THREE.MeshStandardMaterial({ color: 0x1a1c1e, roughness: 1 }),
    )
    grate.position.set(0.95, 1.05, -2.78)
    this.scene.add(grate)
  }

  /** Окно хрущёвки: тёмный двор, панелька напротив, пара чужих окон горит. */
  private buildWindow(): void {
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x3c3730, roughness: 0.9 })
    const frame = new THREE.Mesh(new THREE.BoxGeometry(1.08, 1.24, 0.05), frameMat)
    frame.position.set(-1.12, 0.95, -2.79)
    this.scene.add(frame)

    const glass = new THREE.Mesh(
      new THREE.PlaneGeometry(0.96, 1.12),
      new THREE.MeshBasicMaterial({ map: windowTexture() }),
    )
    glass.position.set(-1.12, 0.95, -2.76)
    this.scene.add(glass)

    // переплёт: две вертикальные и одна горизонтальная планка
    const sashV = new THREE.BoxGeometry(0.03, 1.12, 0.03)
    const sash = new THREE.Mesh(sashV, frameMat)
    sash.position.set(-1.12, 0.95, -2.755)
    this.scene.add(sash)
    const sashH = new THREE.Mesh(new THREE.BoxGeometry(0.96, 0.03, 0.03), frameMat)
    sashH.position.set(-1.12, 0.95, -2.755)
    this.scene.add(sashH)

    // холодный свет с улицы: единственный источник, который не жалко
    const street = new THREE.PointLight(0x7d9cc4, 0.9, 4.6, 2)
    street.position.set(-1.12, 1.0, -2.45)
    this.scene.add(street)
  }

  /** Чугунная батарея под окном — обязательный атрибут. */
  private buildRadiator(): void {
    const metal = new THREE.MeshStandardMaterial({ color: 0x5b5850, roughness: 0.85 })
    const fins = new THREE.Group()
    for (let i = 0; i < 11; i++) {
      const fin = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.4, 0.09), metal)
      fin.position.set(-1.62 + i * 0.09, 0.34, -2.72)
      fins.add(fin)
    }
    this.scene.add(fins)
  }

  private buildDesk(): void {
    const desk = new THREE.Mesh(
      new THREE.BoxGeometry(1.5, 0.05, 0.85),
      new THREE.MeshStandardMaterial({ color: 0x2a2622, roughness: 0.85 }),
    )
    desk.position.set(0, -0.025, 0.2)
    this.scene.add(desk)

    const beige = new THREE.MeshStandardMaterial({ color: 0x6e6858, roughness: 0.85 })

    // корпус ЭЛТ: задняя банка + четыре планки-рамки вокруг экрана
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.27, 0.2), beige)
    back.position.set(0, SCREEN_Y, SCREEN_Z - 0.145)
    this.monitor.add(back)

    const barH = new THREE.BoxGeometry(0.43, 0.03, 0.04)
    const barV = new THREE.BoxGeometry(0.035, 0.33, 0.04)
    for (const dy of [1, -1]) {
      const bar = new THREE.Mesh(barH, beige)
      bar.position.set(0, SCREEN_Y + dy * (SCREEN_H / 2 + 0.015), 0.055)
      this.monitor.add(bar)
    }
    for (const dx of [1, -1]) {
      const bar = new THREE.Mesh(barV, beige)
      bar.position.set(dx * (SCREEN_W / 2 + 0.0175), SCREEN_Y, 0.055)
      this.monitor.add(bar)
    }

    const stand = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.03, 0.12), beige)
    stand.position.set(0, 0.015, -0.02)
    this.monitor.add(stand)

    const keyboard = new THREE.Mesh(
      new THREE.BoxGeometry(0.42, 0.02, 0.15),
      new THREE.MeshStandardMaterial({ map: keyTexture(), roughness: 0.8 }),
    )
    keyboard.position.set(0, 0.012, 0.27)
    keyboard.rotation.x = -0.07
    this.scene.add(keyboard)

    const mouse = new THREE.Mesh(
      new THREE.BoxGeometry(0.06, 0.024, 0.1),
      new THREE.MeshStandardMaterial({ color: 0x8d8677, roughness: 0.8 }),
    )
    mouse.position.set(0.3, 0.014, 0.28)
    this.scene.add(mouse)

    const mug = new THREE.Mesh(
      new THREE.CylinderGeometry(0.034, 0.028, 0.085, 14, 1, true),
      new THREE.MeshStandardMaterial({ color: 0x3d443d, roughness: 0.9, side: THREE.DoubleSide }),
    )
    mug.position.set(-0.31, 0.047, 0.22)
    this.scene.add(mug)

    const cable = new THREE.Mesh(
      new THREE.TubeGeometry(
        new THREE.CatmullRomCurve3([
          new THREE.Vector3(0.02, 0.03, SCREEN_Z - 0.16),
          new THREE.Vector3(0.06, 0.012, 0.06),
          new THREE.Vector3(0.24, 0.004, 0.2),
          new THREE.Vector3(0.55, 0.003, 0.3),
        ]),
        32,
        0.004,
        6,
      ),
      new THREE.MeshStandardMaterial({ color: 0x14140f, roughness: 1 }),
    )
    this.scene.add(cable)

    const led = new THREE.Mesh(
      new THREE.BoxGeometry(0.012, 0.008, 0.004),
      new THREE.MeshBasicMaterial({ color: 0x37ff7a }),
    )
    led.position.set(0.17, SCREEN_Y - 0.19, SCREEN_Z + 0.002)
    this.monitor.add(led)
  }

  private buildBulb(): THREE.PointLight {
    const bulb = new THREE.Mesh(
      new THREE.SphereGeometry(0.028, 10, 8),
      new THREE.MeshBasicMaterial({ color: 0xffc98a }),
    )
    bulb.position.set(0.92, 1.16, 0.32)
    this.scene.add(bulb)

    const wire = new THREE.Mesh(
      new THREE.CylinderGeometry(0.0016, 0.0016, 0.5, 4),
      new THREE.MeshStandardMaterial({ color: 0x0a0a0a, roughness: 1 }),
    )
    wire.position.set(0.92, 1.42, 0.32)
    this.scene.add(wire)

    const light = new THREE.PointLight(0xffb673, 0.5, 4.2, 2)
    light.position.copy(bulb.position)
    this.scene.add(light)
    return light
  }

  private buildDust(): { points: THREE.Points; vel: Float32Array } {
    const count = 420
    const pos = new Float32Array(count * 3)
    const vel = new Float32Array(count)
    for (let i = 0; i < count; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 2.6
      pos[i * 3 + 1] = Math.random() * 1.8 - 0.6
      // ближе 20 см к объективу не сыплем: иначе пылинка превращается в пятно
      pos[i * 3 + 2] = Math.random() * 1.7 - 1.5
      vel[i] = 0.006 + Math.random() * 0.02
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    const mat = new THREE.PointsMaterial({
      map: dustTexture(),
      color: 0xbdd7dd,
      size: 0.006,
      transparent: true,
      opacity: 0.4,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
    const points = new THREE.Points(geo, mat)
    this.scene.add(points)
    return { points, vel }
  }

  private curvedScreen(): THREE.BufferGeometry {
    const geo = new THREE.PlaneGeometry(SCREEN_W, SCREEN_H, 28, 20)
    const pos = geo.attributes.position as THREE.BufferAttribute
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i) / (SCREEN_W / 2)
      const y = pos.getY(i) / (SCREEN_H / 2)
      pos.setZ(i, -(x * x + y * y) * 0.008)
    }
    pos.needsUpdate = true
    geo.computeVertexNormals()
    return geo
  }

  // ── публичное ────────────────────────────────────────────────────

  refreshScreen(): void {
    this.screenTex.needsUpdate = true
  }

  setPointer(nx: number, ny: number): void {
    this.look.set(nx, ny)
  }

  update(dt: number): void {
    this.clock += dt
    const t = this.clock

    // параллакс: еле заметный, чтобы экран не качался как лодка
    const k = 1 - Math.pow(0.06, dt)
    this.camera.position.x += (this.eye.x + this.look.x * 0.0045 - this.camera.position.x) * k
    this.camera.position.y +=
      (this.eye.y + this.look.y * 0.003 + Math.sin(t * 0.55) * 0.0004 - this.camera.position.y) * k
    this.camera.lookAt(this.target)

    // мерцание экрана
    const flick = 1 + Math.sin(t * 31.3) * 0.015 + Math.sin(t * 7.1) * 0.02
    const dip = Math.max(0, Math.sin(t * 1.9) - 0.993) * 40
    const lum = Math.max(0.85, 1 - dip * 0.15) * flick
    this.screenLight.intensity = 0.22 * lum
    this.screenMat.color.setRGB(0.98 * lum, 0.99 * lum, lum)
    this.glow.material.opacity = 0.12 * lum

    // лампа на проводе
    const swing = 0.45 + 0.1 * Math.sin(t * 1.7) + 0.04 * Math.sin(t * 9.3)
    this.bulbLight.intensity = Math.max(0.06, swing)

    // пыль
    const attr = this.dust.geometry.attributes.position as THREE.BufferAttribute
    const arr = attr.array as Float32Array
    for (let i = 0; i < this.dustVel.length; i++) {
      arr[i * 3 + 1] += this.dustVel[i] * dt
      arr[i * 3] += Math.sin(t * 0.6 + i) * dt * 0.004
      if (arr[i * 3 + 1] > 1.35) arr[i * 3 + 1] = -0.65
    }
    attr.needsUpdate = true

    this.pass.uniforms.uTime.value = t
  }

  render(): void {
    this.composer.render()
  }

  resize(): void {
    const w = window.innerWidth
    const h = window.innerHeight
    const dpr = Math.min(window.devicePixelRatio || 1, 1.6)
    this.renderer.setPixelRatio(dpr)
    this.renderer.setSize(w, h, false)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
    this.composer.setPixelRatio(dpr)
    this.composer.setSize(w, h)
    this.pass.uniforms.uRes.value.set(w * dpr, h * dpr)
  }

  /** Точка на экране монитора или null, если мышь мимо. */
  pick(ndc: THREE.Vector2): { x: number; y: number } | null {
    this.raycaster.setFromCamera(ndc, this.camera)
    const hit = this.raycaster.intersectObject(this.screenMesh, false)[0]
    if (!hit || !hit.uv) return null
    return { x: hit.uv.x * DESKTOP_W, y: (1 - hit.uv.y) * DESKTOP_H }
  }

  /** То же, но по плоскости экрана: нужно, когда тянешь окно за его пределы. */
  pickLoose(ndc: THREE.Vector2): { x: number; y: number } | null {
    this.raycaster.setFromCamera(ndc, this.camera)

    const q = this.screenMesh.getWorldQuaternion(new THREE.Quaternion())
    const center = this.screenMesh.getWorldPosition(new THREE.Vector3())
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(q)
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(q)
    const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(q)
    this.plane.setFromNormalAndCoplanarPoint(normal, center)

    const p = new THREE.Vector3()
    if (!this.raycaster.ray.intersectPlane(this.plane, p)) return null
    const delta = p.sub(center)
    const u = delta.dot(right) / SCREEN_W + 0.5
    const v = 0.5 - delta.dot(up) / SCREEN_H
    return { x: u * DESKTOP_W, y: v * DESKTOP_H }
  }
}

// ── процедурные текстуры ───────────────────────────────────────────

/** Обои хрущёвки: выцветшие полосы, разводы, отслоившиеся куски. */
function wallpaperTexture(): THREE.CanvasTexture {
  const s = 384
  const c = document.createElement('canvas')
  c.width = s
  c.height = s
  const g = c.getContext('2d')
  if (!g) throw new Error('canvas 2d недоступен')

  g.fillStyle = '#6b6659'
  g.fillRect(0, 0, s, s)

  // вертикальные полосы
  for (let x = 0; x < s; x += 24) {
    g.fillStyle = (x / 24) % 2 === 0 ? 'rgba(126, 120, 103, 0.5)' : 'rgba(92, 88, 76, 0.45)'
    g.fillRect(x, 0, 12, s)
  }
  // мелкий выцветший узор
  for (let i = 0; i < 260; i++) {
    g.fillStyle = 'rgba(122, 117, 100, 0.22)'
    g.beginPath()
    g.arc(Math.random() * s, Math.random() * s, 1.2 + Math.random() * 2.2, 0, Math.PI * 2)
    g.fill()
  }
  // потёки сверху и сырость снизу
  for (let i = 0; i < 26; i++) {
    const x = Math.random() * s
    const h = 40 + Math.random() * 150
    const grad = g.createLinearGradient(0, 0, 0, h)
    grad.addColorStop(0, 'rgba(38, 34, 26, 0.34)')
    grad.addColorStop(1, 'rgba(38, 34, 26, 0)')
    g.fillStyle = grad
    g.fillRect(x, 0, 1 + Math.random() * 3, h)
  }
  const damp = g.createLinearGradient(0, s * 0.55, 0, s)
  damp.addColorStop(0, 'rgba(40, 40, 30, 0)')
  damp.addColorStop(1, 'rgba(34, 36, 26, 0.55)')
  g.fillStyle = damp
  g.fillRect(0, s * 0.55, s, s * 0.45)

  // отслоившаяся краска: светлые пятна с тенью снизу
  for (let i = 0; i < 7; i++) {
    const x = Math.random() * s
    const y = Math.random() * s
    const w = 14 + Math.random() * 46
    const h = 10 + Math.random() * 30
    g.fillStyle = 'rgba(150, 144, 128, 0.5)'
    g.beginPath()
    g.moveTo(x, y)
    g.lineTo(x + w, y + Math.random() * 6)
    g.lineTo(x + w - Math.random() * 8, y + h)
    g.lineTo(x + Math.random() * 6, y + h - Math.random() * 5)
    g.closePath()
    g.fill()
    g.fillStyle = 'rgba(24, 22, 18, 0.35)'
    g.fillRect(x, y + h, w, 2)
  }

  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.wrapS = THREE.RepeatWrapping
  tex.wrapT = THREE.RepeatWrapping
  tex.repeat.set(2.5, 1)
  return tex
}

/** Линолеум: бурый, в крапинку, со швами. */
function linoleumTexture(): THREE.CanvasTexture {
  const s = 256
  const c = document.createElement('canvas')
  c.width = s
  c.height = s
  const g = c.getContext('2d')
  if (!g) throw new Error('canvas 2d недоступен')
  g.fillStyle = '#4b423a'
  g.fillRect(0, 0, s, s)
  for (let i = 0; i < 2600; i++) {
    g.fillStyle = Math.random() > 0.5 ? 'rgba(96, 84, 70, 0.35)' : 'rgba(28, 24, 20, 0.35)'
    g.fillRect(Math.random() * s, Math.random() * s, 1.5, 1.5)
  }
  g.strokeStyle = 'rgba(22, 19, 16, 0.5)'
  g.lineWidth = 2
  g.beginPath()
  g.moveTo(0, s * 0.5)
  g.lineTo(s, s * 0.5)
  g.stroke()

  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.wrapS = THREE.RepeatWrapping
  tex.wrapT = THREE.RepeatWrapping
  tex.repeat.set(4, 4)
  return tex
}

/** Что видно в окне: двор, панелька напротив, три живых окна из ста. */
function windowTexture(): THREE.CanvasTexture {
  const w = 256
  const h = 300
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const g = c.getContext('2d')
  if (!g) throw new Error('canvas 2d недоступен')

  const sky = g.createLinearGradient(0, 0, 0, h)
  sky.addColorStop(0, '#0a1420')
  sky.addColorStop(0.55, '#12202e')
  sky.addColorStop(1, '#0d1319')
  g.fillStyle = sky
  g.fillRect(0, 0, w, h)

  // панелька напротив
  g.fillStyle = '#151b20'
  g.fillRect(18, 70, 220, 150)
  for (let row = 0; row < 5; row++) {
    for (let col = 0; col < 9; col++) {
      const lit = Math.random() < 0.08
      g.fillStyle = lit ? 'rgba(214, 170, 96, 0.75)' : 'rgba(10, 13, 16, 0.9)'
      g.fillRect(26 + col * 24, 78 + row * 28, 14, 18)
    }
  }

  // фонарь во дворе
  const lamp = g.createRadialGradient(196, 236, 2, 196, 236, 46)
  lamp.addColorStop(0, 'rgba(226, 198, 140, 0.85)')
  lamp.addColorStop(0.35, 'rgba(200, 168, 110, 0.25)')
  lamp.addColorStop(1, 'rgba(160, 130, 80, 0)')
  g.fillStyle = lamp
  g.fillRect(140, 180, 120, 120)

  // голое дерево
  g.strokeStyle = '#0b0f12'
  g.lineWidth = 3
  g.beginPath()
  g.moveTo(52, 300)
  g.lineTo(52, 214)
  g.moveTo(52, 250)
  g.lineTo(28, 226)
  g.moveTo(52, 236)
  g.lineTo(78, 216)
  g.stroke()

  // пыль и царапины на стекле
  for (let i = 0; i < 120; i++) {
    g.fillStyle = 'rgba(180, 190, 200, 0.06)'
    g.fillRect(Math.random() * w, Math.random() * h, 1, 1)
  }

  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

function keyTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = 256
  c.height = 96
  const g = c.getContext('2d')
  if (!g) throw new Error('canvas 2d недоступен')
  g.fillStyle = '#57534a'
  g.fillRect(0, 0, 256, 96)
  for (let row = 0; row < 5; row++) {
    for (let col = 0; col < 15; col++) {
      const w = row === 4 && col > 3 && col < 8 ? 46 : 14
      const x = 6 + col * 16
      const y = 6 + row * 17
      g.fillStyle = '#403d36'
      g.fillRect(x, y, w, 13)
      g.fillStyle = '#6a665c'
      g.fillRect(x, y, w, 2)
    }
  }
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

/** Круглая пылинка: без текстуры Points рисует квадраты, а вблизи это видно. */
function dustTexture(): THREE.CanvasTexture {
  const s = 32
  const c = document.createElement('canvas')
  c.width = s
  c.height = s
  const g = c.getContext('2d')
  if (!g) throw new Error('canvas 2d недоступен')
  const grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2)
  grad.addColorStop(0, 'rgba(255, 255, 255, 1)')
  grad.addColorStop(0.35, 'rgba(255, 255, 255, 0.5)')
  grad.addColorStop(1, 'rgba(255, 255, 255, 0)')
  g.fillStyle = grad
  g.fillRect(0, 0, s, s)
  return new THREE.CanvasTexture(c)
}

function glowTexture(): THREE.CanvasTexture {
  const s = 128
  const c = document.createElement('canvas')
  c.width = s
  c.height = s
  const g = c.getContext('2d')
  if (!g) throw new Error('canvas 2d недоступен')
  const grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2)
  grad.addColorStop(0, 'rgba(255, 255, 255, 1)')
  grad.addColorStop(0.18, 'rgba(214, 230, 245, 0.72)')
  grad.addColorStop(0.42, 'rgba(170, 200, 230, 0.34)')
  grad.addColorStop(0.68, 'rgba(140, 175, 210, 0.12)')
  grad.addColorStop(0.88, 'rgba(120, 155, 190, 0.03)')
  grad.addColorStop(1, 'rgba(0, 0, 0, 0)')
  g.fillStyle = grad
  g.fillRect(0, 0, s, s)
  return new THREE.CanvasTexture(c)
}
