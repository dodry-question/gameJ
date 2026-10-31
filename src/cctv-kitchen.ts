/**
 * Кухня в комнате 5 — продолжение сцены КАМ за коридором комнаты 4.
 * Примитивы и canvas-текстуры, как и вся остальная сцена: стол с
 * окровавленным ножом, холодильник, разогревательная плита, принтер и
 * качающаяся на проводе лампа, которая моргает раз в 20–30 секунд.
 * Выход из кухни — металлическая дверь с кодовой панелью в тёмном углу.
 *
 * Всё интерактивное попадает в список objects: по нему TDS рисует подсветку
 * в режиме скана и ловит клики (raycast по мешам).
 */
import * as THREE from 'three'
import { tex, wallTex } from './cctv-room'

export type KitchenObject = {
  id: string
  label: string
  mesh: THREE.Object3D
  /** Точка, к которой девушка подходит, чтобы взаимодействовать. */
  stand: [number, number]
  /** Куда повернуться лицом к объекту (рад). */
  yaw: number
}

export type Kitchen = {
  objects: KitchenObject[]
  lamp: THREE.PointLight
  /** Качающаяся группа: провод + плафон. */
  lampPivot: THREE.Group
  exitDoor: THREE.Mesh
  /** Дверца холодильника: открывается, когда она осматривает. */
  fridgeDoor: THREE.Object3D
  /** Кусок мяса внутри холодильника: появляется после осмотра. */
  meat: THREE.Object3D
  /** Железка с адресом: появляется вместо мяса после разделки. */
  plate: THREE.Object3D
  /** Бумажка из принтера: выезжает при печати. */
  paper: THREE.Object3D
  /** Диод принтера: мигает во время печати. */
  printerLed: THREE.Mesh
  /** Фигура маньяка: скрыта, пока не нападёт. */
  maniac: THREE.Group
  /** Лампа сейчас горит: по гашению она вздрагивает. */
  readonly lampOn: boolean
  /** Конечности на шарнирах: шаг анимирует cctv. */
  maniacParts: {
    legL: THREE.Group
    legR: THREE.Group
    armL: THREE.Group
    armR: THREE.Group
    torso: THREE.Mesh
    head: THREE.Mesh
  }
  update(dt: number, time: number): void
  /** Открыть/закрыть дверцу холодильника. */
  setFridgeOpen(open: boolean): void
  /** Открыть/закрыть дверь выхода. */
  setExitOpen(open: boolean): void
  /** Запустить печать: диод замигает, лист выползет, звук зашумит. */
  startPrint(): void
  readonly printing: boolean
  readonly paperReady: boolean
  hidePaper(): void
}

/** Границы пола кухни по z: за коридором (тот кончается на −9.2). */
export const KITCHEN = {
  x0: -2.2,
  x1: 2.2,
  z0: -12.8,
  z1: -9.2,
  /** Проём входа из коридора. */
  doorX: 0,
  doorZ: -9.2,
}

/** Препятствия на полу кухни: она обходит их, как стул в комнате 4. */
export const KITCHEN_OBSTACLES: Array<{ x: number; z: number; r: number }> = [
  { x: -1.2, z: -10.7, r: 0.8 }, // стол
  { x: 1.72, z: -11.2, r: 0.65 }, // холодильник
  { x: 1.72, z: -10.0, r: 0.55 }, // плита
  { x: -1.6, z: -12.15, r: 0.6 }, // тумба с принтером
]

export function buildKitchen(scene: THREE.Scene): Kitchen {
  const g = new THREE.Group()
  scene.add(g)

  const wallMat = new THREE.MeshLambertMaterial({ map: wallTex(), color: 0xb0a89a })
  wallMat.map!.repeat.set(2, 1)
  const tileTex = tex(128, 128, (c) => {
    c.fillStyle = '#54565a'
    c.fillRect(0, 0, 128, 128)
    for (let y = 0; y < 128; y += 32) {
      for (let x = 0; x < 128; x += 32) {
        c.fillStyle = `rgba(${90 + Math.random() * 30}, ${92 + Math.random() * 26}, ${96 + Math.random() * 24}, 1)`
        c.fillRect(x + 1, y + 1, 30, 30)
        c.fillStyle = 'rgba(20,22,24,0.35)'
        c.fillRect(x, y, 32, 1)
        c.fillRect(x, y, 1, 32)
      }
    }
    // выбитая плитка и грязь: заброшка, а не столовая
    for (let i = 0; i < 3; i++) {
      c.fillStyle = 'rgba(16, 18, 16, 0.85)'
      c.fillRect(Math.floor(Math.random() * 4) * 32 + 1, Math.floor(Math.random() * 4) * 32 + 1, 30, 30)
    }
    for (let i = 0; i < 90; i++) {
      c.fillStyle = 'rgba(18,20,22,0.12)'
      c.fillRect(Math.random() * 126, Math.random() * 126, rnd2(1, 3), rnd2(1, 3))
    }
    for (let i = 0; i < 5; i++) {
      const gx = rnd2(6, 120)
      const gy = rnd2(6, 120)
      const gr = c.createRadialGradient(gx, gy, 1, gx, gy, rnd2(8, 20))
      gr.addColorStop(0, 'rgba(14, 16, 13, 0.5)')
      gr.addColorStop(1, 'rgba(14, 16, 13, 0)')
      c.fillStyle = gr
      c.fillRect(gx - 22, gy - 22, 44, 44)
    }
    c.strokeStyle = 'rgba(20, 22, 20, 0.6)'
    c.lineWidth = 1
    for (let i = 0; i < 3; i++) {
      c.beginPath()
      c.moveTo(rnd2(0, 128), rnd2(0, 128))
      c.lineTo(rnd2(0, 128), rnd2(0, 128))
      c.stroke()
    }
  })
  const floorMat = new THREE.MeshLambertMaterial({ map: tileTex })
  const darkMat = new THREE.MeshLambertMaterial({ color: 0x191b18 })

  // ── коробка помещения ─────────────────────────────────────────────
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(4.4, 3.6), floorMat)
  floor.rotation.x = -Math.PI / 2
  floor.position.set(0, 0, -11)
  g.add(floor)

  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(4.4, 3.6), darkMat)
  ceil.rotation.x = Math.PI / 2
  ceil.position.set(0, 2.4, -11)
  g.add(ceil)

  // стены: задняя (с выходом), две боковые; вход — проём из коридора
  const back = new THREE.Mesh(new THREE.BoxGeometry(4.4, 2.4, 0.2), wallMat)
  back.position.set(0, 1.2, KITCHEN.z0 - 0.1)
  g.add(back)
  for (const sx of [-1, 1]) {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(0.2, 2.4, 3.6), wallMat)
    wall.position.set(sx * 2.3, 1.2, -11)
    g.add(wall)
  }
  // передняя стена с проёмом: коридор впадает в кухню
  const frontSeg = (cx: number, w: number): void => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, 2.4, 0.2), wallMat)
    m.position.set(cx, 1.2, KITCHEN.z1 + 0.1)
    g.add(m)
  }
  frontSeg(-1.5, 1.6)
  frontSeg(1.5, 1.6)
  const frontLintel = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.4, 0.2), wallMat)
  frontLintel.position.set(0, 2.2, KITCHEN.z1 + 0.1)
  g.add(frontLintel)

  // ── стол с окровавленным ножом ────────────────────────────────────
  const woodMat = new THREE.MeshLambertMaterial({ color: 0x6a5236 })
  const table = new THREE.Group()
  table.position.set(-1.2, 0, -10.7)
  const top = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.06, 0.8), woodMat)
  top.position.y = 0.85
  table.add(top)
  for (const [lx, lz] of [
    [-0.6, -0.3],
    [0.6, -0.3],
    [-0.6, 0.3],
    [0.6, 0.3],
  ]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.85, 0.08), woodMat)
    leg.position.set(lx, 0.42, lz)
    table.add(leg)
  }
  // засохшее и не очень пятно крови на столешнице
  const blood = new THREE.Mesh(
    new THREE.CircleGeometry(0.3, 12),
    new THREE.MeshLambertMaterial({ color: 0x5c1410 }),
  )
  blood.rotation.x = -Math.PI / 2
  blood.position.set(0.1, 0.885, 0.05)
  table.add(blood)
  g.add(table)

  const knife = new THREE.Group()
  const blade = new THREE.Mesh(
    new THREE.BoxGeometry(0.3, 0.015, 0.05),
    new THREE.MeshLambertMaterial({ color: 0xb9bfc6 }),
  )
  blade.position.set(0.15, 0, 0)
  knife.add(blade)
  const grip = new THREE.Mesh(
    new THREE.BoxGeometry(0.12, 0.03, 0.045),
    new THREE.MeshLambertMaterial({ color: 0x2e2620 }),
  )
  grip.position.set(-0.06, 0.005, 0)
  knife.add(grip)
  knife.position.set(-1.05, 0.9, -10.55)
  knife.rotation.y = 0.5
  g.add(knife)

  // ── холодильник: открытый корпус, иначе мясо не видно и не кликнуть ─
  const fridgeMat = new THREE.MeshLambertMaterial({ color: 0x8e9496 })
  const fridge = new THREE.Group()
  fridge.position.set(1.72, 0, -11.2)
  const panel = (w: number, h: number, d: number, x: number, y: number, z: number): void => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), fridgeMat)
    m.position.set(x, y, z)
    fridge.add(m)
  }
  panel(0.05, 1.8, 0.8, -0.4, 0.9, 0) // левая стенка
  panel(0.05, 1.8, 0.8, 0.4, 0.9, 0) // правая
  panel(0.8, 1.8, 0.05, 0, 0.9, -0.375) // задняя
  panel(0.8, 0.06, 0.8, 0, 1.77, 0) // крышка
  panel(0.8, 0.06, 0.8, 0, 0.03, 0) // дно
  panel(0.7, 0.04, 0.62, 0, 1.0, 0.02) // полка
  g.add(fridge)
  // дверца на петле слева: открывается на камеру
  const fridgeDoorPivot = new THREE.Group()
  fridgeDoorPivot.position.set(1.32, 1.05, -10.8)
  const fridgeDoor = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.5, 0.06), fridgeMat)
  fridgeDoor.position.set(0.4, 0, 0)
  fridgeDoorPivot.add(fridgeDoor)
  const fridgeHandle = new THREE.Mesh(
    new THREE.BoxGeometry(0.05, 0.4, 0.05),
    new THREE.MeshLambertMaterial({ color: 0x54585a }),
  )
  fridgeHandle.position.set(0.72, 0.2, 0)
  fridgeDoorPivot.add(fridgeHandle)
  g.add(fridgeDoorPivot)
  // магнитики на дверце
  for (const [dx, color] of [
    [0.28, 0xb23a2e],
    [0.45, 0xd8b25a],
    [0.6, 0x4f7a3c],
  ] as const) {
    const mag = new THREE.Mesh(
      new THREE.BoxGeometry(0.09, 0.09, 0.02),
      new THREE.MeshLambertMaterial({ color }),
    )
    mag.position.set(dx, 1.5, 0.035)
    fridgeDoorPivot.add(mag)
  }

  // мясо на полке: видно и кликабельно, когда дверца открыта
  const meat = new THREE.Group()
  const meatBody = new THREE.Mesh(
    new THREE.SphereGeometry(0.14, 10, 8),
    new THREE.MeshLambertMaterial({ color: 0xa03630 }),
  )
  meatBody.scale.set(1.25, 0.75, 0.9)
  meat.add(meatBody)
  const bone = new THREE.Mesh(
    new THREE.CylinderGeometry(0.03, 0.03, 0.16, 6),
    new THREE.MeshLambertMaterial({ color: 0xd9d0c0 }),
  )
  bone.rotation.z = Math.PI / 2
  bone.position.set(0.2, 0.02, 0.04)
  meat.add(bone)
  meat.position.set(1.68, 1.14, -11.2)
  meat.visible = false
  g.add(meat)

  // железка с адресом: остаётся на полке после разделки
  const plate = new THREE.Mesh(
    new THREE.BoxGeometry(0.22, 0.015, 0.14),
    new THREE.MeshLambertMaterial({ color: 0x7d8288 }),
  )
  plate.position.set(1.68, 1.15, -11.2)
  plate.visible = false
  g.add(plate)

  // ── разогревательная плита ────────────────────────────────────────
  const stove = new THREE.Group()
  stove.position.set(1.72, 0, -10.0)
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.7, 0.9, 0.7),
    new THREE.MeshLambertMaterial({ color: 0x8a8d86 }),
  )
  body.position.y = 0.45
  stove.add(body)
  for (const [cx, cz] of [
    [-0.17, -0.17],
    [0.17, 0.17],
  ]) {
    const coil = new THREE.Mesh(
      new THREE.TorusGeometry(0.12, 0.022, 6, 14),
      new THREE.MeshLambertMaterial({ color: 0x2a2c28 }),
    )
    coil.rotation.x = -Math.PI / 2
    coil.position.set(cx, 0.91, cz)
    stove.add(coil)
  }
  g.add(stove)

  // ── принтер на тумбе в тёмном углу ────────────────────────────────
  const cab = new THREE.Mesh(
    new THREE.BoxGeometry(0.6, 0.75, 0.5),
    new THREE.MeshLambertMaterial({ color: 0x4a4640 }),
  )
  cab.position.set(-1.6, 0.375, -12.15)
  g.add(cab)
  const printer = new THREE.Group()
  printer.position.set(-1.6, 0.95, -12.15)
  const pcase = new THREE.Mesh(
    new THREE.BoxGeometry(0.55, 0.3, 0.45),
    new THREE.MeshLambertMaterial({ color: 0xb8b5aa }),
  )
  printer.add(pcase)
  const slot = new THREE.Mesh(
    new THREE.BoxGeometry(0.4, 0.02, 0.05),
    new THREE.MeshLambertMaterial({ color: 0x22241f }),
  )
  slot.position.set(0, 0.16, 0.21)
  printer.add(slot)
  const led = new THREE.Mesh(
    new THREE.BoxGeometry(0.05, 0.03, 0.01),
    new THREE.MeshBasicMaterial({ color: 0x4f8f57 }),
  )
  led.position.set(0.2, 0.08, 0.23)
  printer.add(led)
  // белый лист: выползает из щели и по мере выхода поникает концом вниз
  const paper = new THREE.Group()
  const sheet = new THREE.Mesh(
    new THREE.PlaneGeometry(0.26, 0.42),
    new THREE.MeshLambertMaterial({ color: 0xf2efe2, side: THREE.DoubleSide }),
  )
  sheet.rotation.x = -Math.PI / 2
  sheet.position.set(0, 0, 0.21)
  paper.add(sheet)
  paper.position.set(0, 0.17, 0)
  paper.visible = false
  printer.add(paper)
  // наклейка с адресом на боку принтера
  const sticker = new THREE.Mesh(
    new THREE.PlaneGeometry(0.26, 0.09),
    new THREE.MeshLambertMaterial({ map: addrTex() }),
  )
  sticker.position.set(0.278, 0.02, 0)
  sticker.rotation.y = Math.PI / 2
  printer.add(sticker)
  g.add(printer)

  // ── выход: металлическая дверь с кодовой панелью (по центру задней
  // стены, иначе из кадра КАМ-05 её закрывает холодильник) ────────────
  const exitPivot = new THREE.Group()
  exitPivot.position.set(-0.475, 0, KITCHEN.z0 + 0.15)
  const exitDoor = new THREE.Mesh(
    new THREE.BoxGeometry(0.95, 2.1, 0.08),
    new THREE.MeshLambertMaterial({ color: 0x3d4448 }),
  )
  exitDoor.position.set(0.475, 1.05, 0)
  exitPivot.add(exitDoor)
  g.add(exitPivot)
  const keypad = new THREE.Group()
  const kpad = new THREE.Mesh(
    new THREE.BoxGeometry(0.16, 0.22, 0.04),
    new THREE.MeshLambertMaterial({ color: 0x1c1e20 }),
  )
  keypad.add(kpad)
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      const key = new THREE.Mesh(
        new THREE.BoxGeometry(0.035, 0.035, 0.012),
        new THREE.MeshBasicMaterial({ color: 0x8f948d }),
      )
      key.position.set(-0.05 + c * 0.05, 0.06 - r * 0.05, 0.024)
      keypad.add(key)
    }
  }
  keypad.position.set(0.62, 1.35, KITCHEN.z0 + 0.12)
  g.add(keypad)

  // ── лампа на проводе: качается и моргает ──────────────────────────
  const lampPivot = new THREE.Group()
  lampPivot.position.set(0, 2.4, -10.9)
  const cord = new THREE.Mesh(
    new THREE.CylinderGeometry(0.008, 0.008, 0.6, 4),
    new THREE.MeshLambertMaterial({ color: 0x22241f }),
  )
  cord.position.y = -0.3
  lampPivot.add(cord)
  const shade = new THREE.Mesh(
    new THREE.ConeGeometry(0.22, 0.18, 10, 1, true),
    new THREE.MeshLambertMaterial({ color: 0x5c6672, side: THREE.DoubleSide }),
  )
  shade.position.y = -0.66
  lampPivot.add(shade)
  const bulb = new THREE.Mesh(
    new THREE.SphereGeometry(0.05, 8, 6),
    new THREE.MeshBasicMaterial({ color: 0xffe9b0 }),
  )
  bulb.position.y = -0.72
  lampPivot.add(bulb)
  const lamp = new THREE.PointLight(0xffd9a0, 16, 8, 2)
  lamp.position.y = -0.72
  lampPivot.add(lamp)
  g.add(lampPivot)

  // слабая подсветка тёмного угла и отсвет из коридора — кухня мёртвая
  const corner = new THREE.PointLight(0x8a94a0, 1.1, 2.6, 2)
  corner.position.set(-1.5, 1.6, -12.0)
  g.add(corner)
  const spill = new THREE.PointLight(0xb9c8a8, 2.2, 3.2, 2)
  spill.position.set(0, 2.1, KITCHEN.z1 - 0.4)
  g.add(spill)

  // ── разруха: мусор, облупившиеся пятна, обрушенный стул, провод ────
  const rubbleMat = new THREE.MeshLambertMaterial({ color: 0x3c3e38 })
  for (let i = 0; i < 14; i++) {
    const x = rnd2(KITCHEN.x0 + 0.4, KITCHEN.x1 - 0.4)
    const z = rnd2(KITCHEN.z0 + 0.4, KITCHEN.z1 - 0.4)
    const s = rnd2(0.05, 0.16)
    const piece =
      Math.random() < 0.5
        ? new THREE.Mesh(new THREE.BoxGeometry(s, s * 0.4, s * rnd2(0.6, 1.4)), rubbleMat)
        : new THREE.Mesh(new THREE.ConeGeometry(s * 0.5, s, 5), rubbleMat)
    piece.position.set(x, s * 0.2, z)
    piece.rotation.y = Math.random() * Math.PI
    piece.rotation.z = rnd2(-0.2, 0.2)
    g.add(piece)
  }
  // тёмные пятна на полу: подтёки и старая грязь
  const stainTex = tex(64, 64, (c) => {
    const gr = c.createRadialGradient(32, 32, 4, 32, 32, 30)
    gr.addColorStop(0, 'rgba(12, 14, 12, 0.75)')
    gr.addColorStop(1, 'rgba(12, 14, 12, 0)')
    c.fillStyle = gr
    c.fillRect(0, 0, 64, 64)
  })
  for (let i = 0; i < 7; i++) {
    const stain = new THREE.Mesh(
      new THREE.PlaneGeometry(rnd2(0.5, 1.1), rnd2(0.5, 1.1)),
      new THREE.MeshBasicMaterial({ map: stainTex, transparent: true, depthWrite: false }),
    )
    stain.rotation.x = -Math.PI / 2
    stain.rotation.z = Math.random() * Math.PI
    stain.position.set(rnd2(-1.8, 1.8), 0.012, rnd2(-12.4, -9.6))
    g.add(stain)
  }
  // обрушенный стул у дальней стены
  const chair = new THREE.Group()
  const chairMat = new THREE.MeshLambertMaterial({ color: 0x574434 })
  const seat = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.05, 0.4), chairMat)
  seat.rotation.z = 0.4
  chair.add(seat)
  const chairBack = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.5, 0.05), chairMat)
  chairBack.position.set(-0.12, 0.22, -0.18)
  chairBack.rotation.z = 0.4
  chair.add(chairBack)
  for (const [lx, lz] of [
    [-0.16, -0.16],
    [0.18, 0.1],
  ]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.45, 0.05), chairMat)
    leg.position.set(lx, 0.1, lz)
    leg.rotation.z = 0.4
    chair.add(leg)
  }
  chair.position.set(-0.8, 0.06, -12.3)
  chair.rotation.y = 0.7
  g.add(chair)
  // оборванный провод из потолка
  const wire = new THREE.Mesh(
    new THREE.CylinderGeometry(0.012, 0.008, 0.9, 4),
    new THREE.MeshLambertMaterial({ color: 0x1c1e1a }),
  )
  wire.position.set(1.2, 1.95, -12.3)
  wire.rotation.z = 0.5
  g.add(wire)
  // щиток со свисающей дверцей на стене
  const board = new THREE.Mesh(
    new THREE.BoxGeometry(0.5, 0.7, 0.06),
    new THREE.MeshLambertMaterial({ color: 0x4a4e48 }),
  )
  board.position.set(-2.15, 1.5, -10.2)
  board.rotation.y = Math.PI / 2
  g.add(board)
  const boardDoor = new THREE.Mesh(
    new THREE.BoxGeometry(0.02, 0.66, 0.44),
    new THREE.MeshLambertMaterial({ color: 0x565a52 }),
  )
  boardDoor.position.set(-2.08, 1.42, -10.24)
  boardDoor.rotation.y = Math.PI / 2 - 0.7
  g.add(boardDoor)

  // ── старый мусор у стен ───────────────────────────────────────────
  const junk2Mat = new THREE.MeshLambertMaterial({ color: 0x6a675c })
  for (const [x, z, w] of [
    [-0.4, -12.5, 0.3],
    [1.0, -10.4, 0.22],
    [-0.9, -9.6, 0.18],
  ] as const) {
    const box = new THREE.Mesh(new THREE.BoxGeometry(w, 0.05, w * 0.7), junk2Mat)
    box.position.set(x, 0.03, z)
    box.rotation.y = Math.random() * Math.PI
    g.add(box)
  }

  const objects: KitchenObject[] = [
    { id: 'knife', label: 'НОЖ', mesh: knife, stand: [-0.45, -10.4], yaw: -2.3 },
    { id: 'fridge', label: 'ХОЛОДИЛЬНИК', mesh: fridge, stand: [1.05, -11.2], yaw: Math.PI / 2 },
    { id: 'meat', label: 'МЯСО', mesh: meat, stand: [1.05, -11.2], yaw: Math.PI / 2 },
    { id: 'stove', label: 'ПЛИТА', mesh: stove, stand: [1.05, -10.0], yaw: Math.PI / 2 },
    { id: 'printer', label: 'ПРИНТЕР', mesh: printer, stand: [-1.0, -11.85], yaw: 0.9 },
    { id: 'exit', label: 'ДВЕРЬ', mesh: exitDoor, stand: [0.0, -12.15], yaw: Math.PI },
  ]

  // ── маньяк: тёмная фигура, шагает из проёма при провале ───────────
  const maniac = new THREE.Group()
  const maniacMat = new THREE.MeshLambertMaterial({ color: 0x101317 })
  const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 0.62, 7), maniacMat)
  torso.position.y = 1.15
  maniac.add(torso)
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.11, 8, 6), maniacMat)
  head.position.y = 1.62
  maniac.add(head)
  // конечности на шарнирах в бедре и плече: шаг качает их от сустава,
  // а не вертит вокруг центра цилиндра
  const limb = (x: number, y: number, zRot: number, len: number, r0: number, r1: number) => {
    const pivot = new THREE.Group()
    pivot.position.set(x, y, 0)
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r0, r1, len, 6), maniacMat)
    mesh.position.y = -len / 2
    pivot.add(mesh)
    pivot.rotation.z = zRot
    maniac.add(pivot)
    return pivot
  }
  const legL = limb(-0.09, 0.85, 0, 0.85, 0.06, 0.05)
  const legR = limb(0.09, 0.85, 0, 0.85, 0.06, 0.05)
  const armL = limb(-0.26, 1.5, 0.35, 0.6, 0.05, 0.04)
  const armR = limb(0.26, 1.5, -0.5, 0.6, 0.05, 0.04)
  // нож в правой руке — живёт на её шарнире и ходит вместе с шагом
  const mKnife = new THREE.Mesh(
    new THREE.BoxGeometry(0.04, 0.26, 0.02),
    new THREE.MeshLambertMaterial({ color: 0xaeb4ba }),
  )
  mKnife.position.set(0.09, -0.35, 0.05)
  mKnife.rotation.z = -0.4
  armR.add(mKnife)
  maniac.visible = false
  g.add(maniac)

  // ── анимации кухни ────────────────────────────────────────────────
  let fridgeOpenT = 0 // 0 закрыта → 1 открыта
  let fridgeTarget = 0
  let exitOpenT = 0
  let exitTarget = 0
  let printLeft = 0 // сколько секунд ещё печатает
  let paperOutT = 0 // 0 убрана → 1 полностью вышла
  let blinkNext = 6 + Math.random() * 10
  let blinkUntil = 0
  let lampOnNow = true
  const update = (dt: number, time: number): void => {
    // маятник с лёгким дрейфом
    lampPivot.rotation.z = Math.sin(time * 0.9) * 0.16 + Math.sin(time * 0.23) * 0.06
    lampPivot.rotation.x = Math.sin(time * 0.61 + 1.4) * 0.1
    blinkNext -= dt
    if (blinkNext <= 0) {
      blinkUntil = time + 0.12 + Math.random() * 0.1
      blinkNext = 20 + Math.random() * 10 // моргает раз в 20–30 секунд
    }
    const flick = 1 + Math.sin(time * 43) * 0.05
    const on = time > blinkUntil ? 1 : 0
    lampOnNow = on === 1
    lamp.intensity = 13 * flick * on
    ;(bulb.material as THREE.MeshBasicMaterial).color.setHex(on ? 0xffe9b0 : 0x3a352a)

    // дверца холодильника и дверь выхода
    fridgeOpenT += (fridgeTarget - fridgeOpenT) * Math.min(1, dt * 4)
    fridgeDoorPivot.rotation.y = -fridgeOpenT * 1.9
    exitOpenT += (exitTarget - exitOpenT) * Math.min(1, dt * 2.4)
    exitPivot.rotation.y = -exitOpenT * 1.5

    // печать: диод мигает, белый лист выползает и поникает
    if (printLeft > 0) {
      printLeft -= dt
      const blink = Math.floor(time * 6) % 2 === 0
      ;(led.material as THREE.MeshBasicMaterial).color.setHex(blink ? 0xd8b25a : 0x2a2c24)
      if (printLeft <= 1.2) {
        paper.visible = true
        paperOutT = Math.min(1, paperOutT + dt * 1.2)
        paper.position.z = paperOutT * 0.17
        const sheetMesh = paper.children[0] as THREE.Mesh
        sheetMesh.rotation.x = -Math.PI / 2 + paperOutT * 0.55
        sheetMesh.position.z = 0.21 + paperOutT * 0.08
      }
    } else {
      ;(led.material as THREE.MeshBasicMaterial).color.setHex(0x4f8f57)
    }
  }

  return {
    objects,
    lamp,
    lampPivot,
    exitDoor,
    fridgeDoor: fridgeDoorPivot,
    meat,
    plate,
    paper,
    printerLed: led,
    maniac,
    maniacParts: { legL, legR, armL, armR, torso, head },
    get lampOn() {
      return lampOnNow
    },
    update,
    setFridgeOpen(open: boolean): void {
      fridgeTarget = open ? 1 : 0
    },
    setExitOpen(open: boolean): void {
      exitTarget = open ? 1 : 0
    },
    startPrint(): void {
      printLeft = 2.8
      paperOutT = 0
      paper.visible = false
      paper.position.set(0, 0.17, 0)
      const sheetMesh = paper.children[0] as THREE.Mesh
      sheetMesh.rotation.x = -Math.PI / 2
      sheetMesh.position.z = 0.21
    },
    get printing(): boolean {
      return printLeft > 0
    },
    get paperReady(): boolean {
      return paperOutT >= 1
    },
    hidePaper(): void {
      paper.visible = false
      paperOutT = 0
    },
  }
}

/** Текст-текстура «адрес на наклейке принтера». */
function addrTex(): THREE.CanvasTexture {
  return tex(256, 96, (c) => {
    c.fillStyle = '#e6e4d8'
    c.fillRect(0, 0, 256, 96)
    c.fillStyle = '#23231c'
    c.font = 'bold 34px "Courier New", monospace'
    c.textAlign = 'center'
    c.textBaseline = 'middle'
    c.fillText('print.local', 128, 40)
    c.font = '22px "Courier New", monospace'
    c.fillStyle = '#5c5c54'
    c.fillText('ПЕЧАТЬ ПАРОЛЯ', 128, 74)
    c.strokeStyle = '#8a7a1a'
    c.strokeRect(2, 2, 252, 92)
  })
}

function rnd2(a: number, b: number): number {
  return a + Math.random() * (b - a)
}
