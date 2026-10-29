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
  private eye = new THREE.Vector3(0, 0.28, 0.55)
  private target = new THREE.Vector3(0, 0.13, 0.05)
  private look = new THREE.Vector2()
  private clock = 0

  constructor(host: HTMLElement, desktop: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' })
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.toneMapping = THREE.NoToneMapping
    host.appendChild(this.renderer.domElement)

    this.scene.background = new THREE.Color(0x05070a)
    this.scene.fog = new THREE.FogExp2(0x05070a, 0.5)

    this.camera = new THREE.PerspectiveCamera(50, 1, 0.01, 20)
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
    this.glow.scale.set(0.52, 0.42, 1)
    this.glow.position.set(0, SCREEN_Y, SCREEN_Z + 0.005)
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
    const concrete = concreteTexture()

    const walls = new THREE.Mesh(
      new THREE.BoxGeometry(4.4, 2.4, 3.6),
      new THREE.MeshStandardMaterial({ map: concrete, color: 0x8f8f8f, roughness: 1, side: THREE.BackSide }),
    )
    walls.position.set(0, 0.45, -1)
    this.scene.add(walls)

    this.scene.add(new THREE.AmbientLight(0x141c26, 0.55))
    this.scene.add(new THREE.HemisphereLight(0x0e1a22, 0x050505, 0.25))

    // лампа где-то над столом, вне кадра: даёт объём комнате
    const ceiling = new THREE.PointLight(0x6d8ba0, 0.8, 3.6, 2)
    ceiling.position.set(-0.2, 1.5, 0.3)
    this.scene.add(ceiling)

    // решётка вентиляции на дальней стене — силуэт, чтобы комната не была пустой
    const grate = new THREE.Mesh(
      new THREE.BoxGeometry(0.6, 0.4, 0.02),
      new THREE.MeshStandardMaterial({ color: 0x1a1c1e, roughness: 1 }),
    )
    grate.position.set(-1.1, 0.9, -2.78)
    this.scene.add(grate)
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
      pos[i * 3 + 2] = Math.random() * 2.2 - 1.4
      vel[i] = 0.006 + Math.random() * 0.02
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    const mat = new THREE.PointsMaterial({
      color: 0xbdd7dd,
      size: 0.0045,
      transparent: true,
      opacity: 0.5,
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

    // параллакс: чуть смещаемся за мышью, плюс дыхание
    const k = 1 - Math.pow(0.001, dt)
    this.camera.position.x += (this.eye.x + this.look.x * 0.018 - this.camera.position.x) * k
    this.camera.position.y +=
      (this.eye.y + this.look.y * 0.011 + Math.sin(t * 0.9) * 0.0012 - this.camera.position.y) * k
    this.camera.lookAt(this.target)

    // мерцание экрана
    const flick = 1 + Math.sin(t * 31.3) * 0.015 + Math.sin(t * 7.1) * 0.02
    const dip = Math.max(0, Math.sin(t * 1.9) - 0.993) * 40
    const lum = Math.max(0.85, 1 - dip * 0.15) * flick
    this.screenLight.intensity = 0.22 * lum
    this.screenMat.color.setRGB(0.98 * lum, 0.99 * lum, lum)
    this.glow.material.opacity = 0.14 * lum

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

function concreteTexture(): THREE.CanvasTexture {
  const s = 256
  const c = document.createElement('canvas')
  c.width = s
  c.height = s
  const g = c.getContext('2d')
  if (!g) throw new Error('canvas 2d недоступен')
  g.fillStyle = '#3a3a34'
  g.fillRect(0, 0, s, s)
  for (let i = 0; i < 1400; i++) {
    const x = Math.random() * s
    const y = Math.random() * s
    const r = 1 + Math.random() * 18
    const dark = Math.random() > 0.5
    g.fillStyle = dark ? 'rgba(12, 14, 12, 0.10)' : 'rgba(120, 118, 104, 0.07)'
    g.beginPath()
    g.arc(x, y, r, 0, Math.PI * 2)
    g.fill()
  }
  // подтёки
  for (let i = 0; i < 24; i++) {
    const x = Math.random() * s
    g.fillStyle = 'rgba(30, 34, 28, 0.35)'
    g.fillRect(x, Math.random() * s * 0.4, 1 + Math.random() * 2, 30 + Math.random() * 90)
  }
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.wrapS = THREE.RepeatWrapping
  tex.wrapT = THREE.RepeatWrapping
  tex.repeat.set(3, 2)
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

function glowTexture(): THREE.CanvasTexture {
  const s = 128
  const c = document.createElement('canvas')
  c.width = s
  c.height = s
  const g = c.getContext('2d')
  if (!g) throw new Error('canvas 2d недоступен')
  const grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2)
  grad.addColorStop(0, 'rgba(255, 255, 255, 1)')
  grad.addColorStop(0.45, 'rgba(170, 200, 230, 0.35)')
  grad.addColorStop(1, 'rgba(0, 0, 0, 0)')
  g.fillStyle = grad
  g.fillRect(0, 0, s, s)
  return new THREE.CanvasTexture(c)
}
