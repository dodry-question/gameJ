/**
 * Пост охраны в кадре КАМ-01: пустая комната за стадией «линия обесточена».
 *
 * Никого в кадре — только вещи, по которым читается история: пульт из трёх
 * ЭЛТ с помехами, вахтёрский стол, шкаф, доска со сменой Ларионова и связка
 * ключей от микроавтобуса (тот самый, из письма другу). Комната стоит в
 * стороне от блока C (x 6.8…10.4) — её видит только своя камера.
 */
import * as THREE from 'three'
import { tex, wallTex } from './cctv-room'

export type PostObject = {
  id: string
  label: string
  mesh: THREE.Mesh
}

export type Post = {
  update(dt: number, t: number): void
  /** Интерактивные объекты поста для скана по TAB. */
  objects: PostObject[]
  /** Канва доски смен — её читают крупным планом на кадре. */
  boardCanvas: HTMLCanvasElement
}

/** Габариты комнаты поста: нужен только КАМ-01. */
export const POST = { x0: 6.8, x1: 10.4, z0: -5.2, z1: -1.6, h: 2.6 }

/** Случай в диапазоне — как в cctv-room. */
const rnd = (a: number, b: number): number => a + Math.random() * (b - a)

/** Развёрнутый шум для экранов пульта: перерисовывается в update(). */
function noiseScreen(w: number, h: number): { tex: THREE.CanvasTexture; redraw: () => void } {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d')!
  const redraw = (): void => {
    const img = ctx.createImageData(w, h)
    for (let i = 0; i < img.data.length; i += 4) {
      const v = 30 + Math.random() * 150
      img.data[i] = v * 0.82
      img.data[i + 1] = v
      img.data[i + 2] = v * 0.86
      img.data[i + 3] = 255
    }
    ctx.putImageData(img, 0, 0)
    // редкие горизонтальные срывы строк
    for (let i = 0; i < 3; i++) {
      const y = Math.floor(rnd(0, h))
      ctx.fillStyle = 'rgba(220, 255, 220, 0.16)'
      ctx.fillRect(0, y, w, 1)
    }
  }
  redraw()
  const t = new THREE.CanvasTexture(c)
  t.magFilter = THREE.NearestFilter
  t.minFilter = THREE.NearestFilter
  t.colorSpace = THREE.SRGBColorSpace
  return { tex: t, redraw }
}

/** Синий экран «НЕТ СИГНАЛА 04»: пульт смотрит в мёртвый канал. */
function deadScreen(): { tex: THREE.CanvasTexture; redraw: (t: number) => void } {
  const c = document.createElement('canvas')
  c.width = 64
  c.height = 48
  const ctx = c.getContext('2d')!
  const redraw = (t: number): void => {
    ctx.fillStyle = '#0a1420'
    ctx.fillRect(0, 0, 64, 48)
    // сканирующая полоса
    const y = (t * 10) % 56 - 4
    ctx.fillStyle = 'rgba(90, 140, 190, 0.12)'
    ctx.fillRect(0, y, 64, 3)
    ctx.fillStyle = '#7fa8c8'
    ctx.font = '7px monospace'
    ctx.textAlign = 'center'
    ctx.fillText('CAM 04', 32, 22)
    ctx.fillText('НЕТ СИГНАЛА', 32, 32)
  }
  redraw(0)
  const t = new THREE.CanvasTexture(c)
  t.magFilter = THREE.NearestFilter
  t.minFilter = THREE.NearestFilter
  t.colorSpace = THREE.SRGBColorSpace
  return { tex: t, redraw }
}

/** Доска на стене: смена Ларионова, сверка архива, запрет на питание. */
function makeBoard(): { tex: THREE.CanvasTexture; canvas: HTMLCanvasElement } {
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 192
  const c = canvas.getContext('2d')!
  c.fillStyle = '#9aa08e'
  c.fillRect(0, 0, 256, 192)
  c.strokeStyle = '#5c6154'
  c.lineWidth = 6
  c.strokeRect(3, 3, 250, 186)
  c.fillStyle = '#3c4038'
  c.font = 'bold 15px monospace'
  c.textAlign = 'left'
  c.fillText('СМЕНА:', 18, 34)
  c.font = 'bold 17px monospace'
  c.fillText('ЛАРИОНОВ И. В.', 18, 56)
  c.font = '14px monospace'
  c.fillText('до 06:00 · НЕ ПОКИДАТЬ ПОСТ', 18, 76)
  c.strokeStyle = 'rgba(60, 64, 56, 0.5)'
  c.lineWidth = 2
  c.beginPath()
  c.moveTo(16, 92)
  c.lineTo(240, 92)
  c.stroke()
  c.font = '13px monospace'
  c.fillText('АРХИВ: сверка записей 03:00', 18, 114)
  c.fillText('КОРИДОР B — питание НЕ ВЫКЛ.', 18, 134)
  c.fillText('ЩИТ 3B — линия камер ОТКЛ.', 18, 154)
  // приписка от руки
  c.save()
  c.translate(150, 180)
  c.rotate(-0.03)
  c.fillStyle = '#7a3030'
  c.font = '12px monospace'
  c.fillText('чужой кабинет 12 — закрыт', 0, 0)
  c.restore()
  const t = new THREE.CanvasTexture(canvas)
  t.magFilter = THREE.NearestFilter
  t.minFilter = THREE.NearestFilter
  t.colorSpace = THREE.SRGBColorSpace
  return { tex: t, canvas }
}

/** Бирка на связке ключей. */
function tagTex(): THREE.CanvasTexture {
  return tex(64, 32, (c) => {
    c.fillStyle = '#b8a26a'
    c.fillRect(0, 0, 64, 32)
    c.strokeStyle = '#6e5c34'
    c.strokeRect(1, 1, 62, 30)
    c.fillStyle = '#3a2f18'
    c.font = 'bold 9px monospace'
    c.textAlign = 'center'
    c.fillText('МИКРО-', 32, 13)
    c.fillText('АВТОБУС', 32, 24)
  })
}

export function buildPost(scene: THREE.Scene): Post {
  const g = new THREE.Group()
  const wall = new THREE.MeshLambertMaterial({ map: wallTex() })
  const dark = new THREE.MeshLambertMaterial({ color: 0x35372f })
  const metal = new THREE.MeshLambertMaterial({ color: 0x565a52 })
  const wood = new THREE.MeshLambertMaterial({ color: 0x6b5a3a })

  // ── оболочка комнаты ─────────────────────────────────────────────
  const w = POST.x1 - POST.x0
  const d = POST.z1 - POST.z0
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(w, d),
    new THREE.MeshLambertMaterial({ color: 0x4a4438 }),
  )
  floor.rotation.x = -Math.PI / 2
  floor.position.set((POST.x0 + POST.x1) / 2, 0, (POST.z0 + POST.z1) / 2)
  g.add(floor)

  const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(w, d), dark)
  ceiling.rotation.x = Math.PI / 2
  ceiling.position.set((POST.x0 + POST.x1) / 2, POST.h, (POST.z0 + POST.z1) / 2)
  g.add(ceiling)

  const mkWall = (pw: number, ph: number): THREE.Mesh =>
    new THREE.Mesh(new THREE.PlaneGeometry(pw, ph), wall)
  // дальняя (z0), ближняя (z1), левая (x0), правая (x1)
  const back = mkWall(w, POST.h)
  back.position.set((POST.x0 + POST.x1) / 2, POST.h / 2, POST.z0)
  g.add(back)
  const near = mkWall(w, POST.h)
  near.position.set((POST.x0 + POST.x1) / 2, POST.h / 2, POST.z1)
  near.rotation.y = Math.PI
  g.add(near)
  const left = mkWall(d, POST.h)
  left.position.set(POST.x0, POST.h / 2, (POST.z0 + POST.z1) / 2)
  left.rotation.y = Math.PI / 2
  g.add(left)
  const right = mkWall(d, POST.h)
  right.position.set(POST.x1, POST.h / 2, (POST.z0 + POST.z1) / 2)
  right.rotation.y = -Math.PI / 2
  g.add(right)

  // ── вахтёрский стол у дальней стены ──────────────────────────────
  const desk = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.08, 0.9), wood)
  desk.position.set(8.1, 0.78, POST.z0 + 0.55)
  g.add(desk)
  for (const [lx, lz] of [
    [-1.0, -0.36],
    [1.0, -0.36],
    [-1.0, 0.36],
    [1.0, 0.36],
  ]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.76, 0.07), wood)
    leg.position.set(8.1 + lx, 0.38, POST.z0 + 0.55 + lz)
    g.add(leg)
  }

  // ── пульт: три ЭЛТ с помехами ────────────────────────────────────
  const statics = [
    noiseScreen(64, 48),
    noiseScreen(64, 48),
    deadScreen(),
  ] as const
  const cases = [
    { x: 7.45, y: 1.18, ry: 0.24 },
    { x: 8.1, y: 1.22, ry: 0 },
    { x: 8.75, y: 1.16, ry: -0.22 },
  ]
  cases.forEach((cs, i) => {
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.42, 0.42), dark)
    body.position.set(cs.x, cs.y, POST.z0 + 0.42)
    body.rotation.y = cs.ry
    g.add(body)
    const screen = new THREE.Mesh(
      new THREE.PlaneGeometry(0.36, 0.27),
      new THREE.MeshBasicMaterial({ map: statics[i].tex }),
    )
    screen.position.set(cs.x, cs.y + 0.01, POST.z0 + 0.635)
    screen.rotation.y = cs.ry
    g.add(screen)
  })

  // клавиатура, кружка, бумаги на столе
  const kb = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.03, 0.16), dark)
  kb.position.set(8.1, 0.83, POST.z0 + 0.95)
  kb.rotation.y = 0.05
  g.add(kb)
  const mug = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.04, 0.1, 8), metal)
  mug.position.set(7.15, 0.87, POST.z0 + 0.8)
  g.add(mug)
  const paper = new THREE.Mesh(
    new THREE.PlaneGeometry(0.26, 0.36),
    new THREE.MeshLambertMaterial({ color: 0xb9b4a4 }),
  )
  paper.rotation.x = -Math.PI / 2
  paper.rotation.z = 0.3
  paper.position.set(8.9, 0.825, POST.z0 + 0.75)
  g.add(paper)

  // ── стул на колёсиках ────────────────────────────────────────────
  const seat = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.06, 0.44), dark)
  seat.position.set(8.1, 0.5, POST.z0 + 1.5)
  g.add(seat)
  const seatBack = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.5, 0.06), dark)
  seatBack.position.set(8.1, 0.78, POST.z0 + 1.71)
  g.add(seatBack)
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.42, 8), metal)
  pole.position.set(8.1, 0.26, POST.z0 + 1.5)
  g.add(pole)
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.26, 0.05, 10), metal)
  base.position.set(8.1, 0.05, POST.z0 + 1.5)
  g.add(base)

  // ── шкаф у правой стены ──────────────────────────────────────────
  const locker = new THREE.Mesh(new THREE.BoxGeometry(0.6, 1.9, 0.5), metal)
  locker.position.set(POST.x1 - 0.32, 0.95, POST.z0 + 0.6)
  g.add(locker)
  const seam = new THREE.Mesh(new THREE.BoxGeometry(0.02, 1.7, 0.02), dark)
  seam.position.set(POST.x1 - 0.61, 0.95, POST.z0 + 0.6)
  g.add(seam)

  // ── доска со сменой (левая стена) ────────────────────────────────
  const boardArt = makeBoard()
  const board = new THREE.Mesh(
    new THREE.PlaneGeometry(1.15, 0.85),
    new THREE.MeshLambertMaterial({ map: boardArt.tex }),
  )
  board.position.set(POST.x0 + 0.012, 1.45, POST.z0 + 1.1)
  board.rotation.y = Math.PI / 2
  g.add(board)

  // ── дверь в правой стене + часы над ней ──────────────────────────
  const door = new THREE.Mesh(new THREE.BoxGeometry(0.04, 1.9, 0.85), wood)
  door.position.set(POST.x1 - 0.02, 0.95, POST.z1 - 1.1)
  g.add(door)
  const clockFace = new THREE.Mesh(
    new THREE.CircleGeometry(0.16, 20),
    new THREE.MeshLambertMaterial({ color: 0xc9c4b2 }),
  )
  clockFace.position.set(POST.x1 - 0.03, 2.15, POST.z1 - 1.1)
  clockFace.rotation.y = -Math.PI / 2
  g.add(clockFace)
  const handM = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.1, 0.01), dark)
  const handH = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.07, 0.01), dark)
  handM.geometry.translate(0, 0.05, 0)
  handH.geometry.translate(0, 0.035, 0)
  handM.position.set(POST.x1 - 0.05, 2.15, POST.z1 - 1.1)
  handH.position.set(POST.x1 - 0.05, 2.15, POST.z1 - 1.1)
  handM.rotation.y = -Math.PI / 2
  handH.rotation.y = -Math.PI / 2
  g.add(handM, handH)

  // ── связка ключей на крюке у двери: микроавтобус ─────────────────
  const hook = new THREE.Mesh(new THREE.TorusGeometry(0.025, 0.006, 6, 10), metal)
  hook.position.set(POST.x1 - 0.04, 1.55, POST.z1 - 1.65)
  hook.rotation.y = Math.PI / 2
  g.add(hook)
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.035, 0.008, 6, 12), metal)
  ring.position.set(POST.x1 - 0.07, 1.5, POST.z1 - 1.65)
  ring.rotation.y = Math.PI / 2
  g.add(ring)
  const tag = new THREE.Mesh(
    new THREE.PlaneGeometry(0.11, 0.055),
    new THREE.MeshLambertMaterial({ map: tagTex() }),
  )
  tag.position.set(POST.x1 - 0.09, 1.44, POST.z1 - 1.65)
  tag.rotation.y = -Math.PI / 2
  g.add(tag)
  for (let i = 0; i < 3; i++) {
    const key = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.05, 0.02), metal)
    key.position.set(POST.x1 - 0.08, 1.43 - i * 0.005, POST.z1 - 1.62 + i * 0.02)
    g.add(key)
  }

  // ── приёмник на шкафу ────────────────────────────────────────────
  const radio = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.14, 0.12), dark)
  radio.position.set(POST.x1 - 0.32, 1.97, POST.z0 + 0.6)
  g.add(radio)
  const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.4, 5), metal)
  antenna.position.set(POST.x1 - 0.26, 2.22, POST.z0 + 0.55)
  antenna.rotation.z = -0.35
  g.add(antenna)

  // ── свет: лампа над столом + синева от пульта ────────────────────
  const lampGlow = new THREE.Mesh(
    new THREE.PlaneGeometry(0.5, 0.16),
    new THREE.MeshBasicMaterial({ color: 0xd8cfa8 }),
  )
  lampGlow.rotation.x = Math.PI / 2
  lampGlow.position.set(8.1, POST.h - 0.02, POST.z0 + 1.1)
  g.add(lampGlow)
  const lamp = new THREE.PointLight(0xffe2b0, 7, 7, 2)
  lamp.position.set(8.1, POST.h - 0.2, POST.z0 + 1.1)
  g.add(lamp)
  const screenGlow = new THREE.PointLight(0x86b6dd, 1.6, 3.4, 2)
  screenGlow.position.set(8.1, 1.2, POST.z0 + 1.0)
  g.add(screenGlow)

  scene.add(g)

  let statT = 0
  return {
    objects: [{ id: 'board', label: 'ДОСКА СМЕН', mesh: board }],
    boardCanvas: boardArt.canvas,
    update(dt: number, t: number): void {
      // мерцание лампы: держим ровно, изредка спотыкается
      const flick =
        Math.random() < 0.008 ? 0.15 : 1 + Math.sin(t * 31) * 0.05 + Math.sin(t * 7.3) * 0.04
      lamp.intensity = 7 * flick
      ;(lampGlow.material as THREE.MeshBasicMaterial).color.setRGB(0.85 * flick, 0.81 * flick, 0.66 * flick)
      // помехи на пульте — по кадру видеорегистратора
      statT += dt
      if (statT > 0.09) {
        statT = 0
        statics[0].redraw()
        statics[1].redraw()
        statics[0].tex.needsUpdate = true
        statics[1].tex.needsUpdate = true
        statics[2].redraw(t)
        statics[2].tex.needsUpdate = true
      }
      // часы: минутная и часовая (время системное — как на пульте);
      // порядок XYZ: сначала разворот к комнате (Y), потом взмах по X
      const now = new Date()
      const mw = (now.getMinutes() / 60) * Math.PI * 2
      const hw = ((now.getHours() % 12) / 12 + now.getMinutes() / 720) * Math.PI * 2
      handM.rotation.set(mw, -Math.PI / 2, 0)
      handH.rotation.set(hw, -Math.PI / 2, 0)
    },
  }
}
