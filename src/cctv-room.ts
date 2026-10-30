/**
 * Комната 4 в кадре КАМ-04: бетонные стены, дверь и следы того, что девушка
 * здесь давно и в беде — засечки дней на стене, царапины на двери, обрывки
 * верёвки, вещи, матрас. Всё — примитивы и canvas-текстуры, никакого ассет-пака.
 */
import * as THREE from 'three'

export type Room4 = {
  /** Дверь на петле: вращается при открытии. */
  doorPivot: THREE.Group
  /** Пыль в луче лампы: медленно плывёт. */
  dust: THREE.Points
}

/** Canvas-текстура с пиксельной фильтрацией под PS1. */
function tex(w: number, h: number, draw: (c: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d')!
  draw(ctx)
  const t = new THREE.CanvasTexture(c)
  t.magFilter = THREE.NearestFilter
  t.minFilter = THREE.NearestFilter
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

/** Случай в диапазоне — для «грязи» на текстурах. */
const rnd = (a: number, b: number): number => a + Math.random() * (b - a)

/** Бетонная стена: пятна, потёки, трещины, грязный низ. */
function wallTex(): THREE.CanvasTexture {
  return tex(128, 128, (c) => {
    c.fillStyle = '#474941'
    c.fillRect(0, 0, 128, 128)
    // крапанки бетона
    for (let i = 0; i < 260; i++) {
      c.fillStyle = Math.random() < 0.5 ? 'rgba(30,32,28,0.10)' : 'rgba(120,122,110,0.08)'
      c.fillRect(rnd(0, 126), rnd(0, 126), rnd(1, 4), rnd(1, 4))
    }
    // потёки сверху
    for (let i = 0; i < 7; i++) {
      const x = rnd(0, 120)
      const w = rnd(3, 10)
      const g = c.createLinearGradient(0, 0, 0, rnd(40, 110))
      g.addColorStop(0, 'rgba(24,26,22,0.5)')
      g.addColorStop(1, 'rgba(24,26,22,0)')
      c.fillStyle = g
      c.fillRect(x, 0, w, 120)
    }
    // трещины
    c.strokeStyle = 'rgba(22,24,20,0.55)'
    c.lineWidth = 1
    for (let i = 0; i < 3; i++) {
      let x = rnd(10, 118)
      let y = rnd(10, 40)
      c.beginPath()
      c.moveTo(x, y)
      for (let s = 0; s < 6; s++) {
        x += rnd(-6, 6)
        y += rnd(6, 16)
        c.lineTo(x, y)
      }
      c.stroke()
    }
    // грязный низ
    const g2 = c.createLinearGradient(0, 96, 0, 128)
    g2.addColorStop(0, 'rgba(20,22,18,0)')
    g2.addColorStop(1, 'rgba(20,22,18,0.55)')
    c.fillStyle = g2
    c.fillRect(0, 96, 128, 32)
  })
}

/** Пол: линолеум с рваными пятнами и потёртой тропой посередине. */
function floorTex(): THREE.CanvasTexture {
  return tex(128, 128, (c) => {
    c.fillStyle = '#2c2e2a'
    c.fillRect(0, 0, 128, 128)
    for (let i = 0; i < 22; i++) {
      c.fillStyle = Math.random() < 0.6 ? 'rgba(14,16,13,0.16)' : 'rgba(86,90,78,0.07)'
      const x = rnd(0, 110)
      const y = rnd(0, 110)
      c.beginPath()
      c.ellipse(x, y, rnd(6, 26), rnd(4, 16), rnd(0, 3), 0, Math.PI * 2)
      c.fill()
    }
    // потёртости
    c.strokeStyle = 'rgba(110,114,100,0.10)'
    for (let i = 0; i < 26; i++) {
      c.beginPath()
      c.moveTo(rnd(0, 128), rnd(0, 128))
      c.lineTo(rnd(0, 128), rnd(0, 128))
      c.stroke()
    }
  })
}

/** Дверь изнутри: доски, затёртый низ и царапины — она скреблась. */
function doorTex(): THREE.CanvasTexture {
  return tex(64, 128, (c) => {
    c.fillStyle = '#5a4a38'
    c.fillRect(0, 0, 64, 128)
    // доски
    c.fillStyle = 'rgba(30,22,14,0.4)'
    for (const x of [0, 21, 42]) c.fillRect(x, 0, 1, 128)
    for (let i = 0; i < 40; i++) {
      c.fillStyle = 'rgba(40,30,20,0.25)'
      c.fillRect(rnd(0, 62), rnd(0, 126), rnd(1, 3), rnd(1, 2))
    }
    // затёртый и побитый низ
    const g = c.createLinearGradient(0, 84, 0, 128)
    g.addColorStop(0, 'rgba(25,18,12,0)')
    g.addColorStop(1, 'rgba(25,18,12,0.6)')
    c.fillStyle = g
    c.fillRect(0, 84, 64, 44)
    // царапины: светлые борозды от ногтей, гуще всего к замку и внизу
    for (let i = 0; i < 26; i++) {
      const nearBottom = Math.random() < 0.7
      const y = nearBottom ? rnd(78, 124) : rnd(30, 90)
      const x = rnd(2, 50)
      const len = rnd(4, 14)
      c.strokeStyle = 'rgba(178,158,128,0.8)'
      c.lineWidth = 1
      c.beginPath()
      c.moveTo(x, y)
      c.lineTo(x + len * rnd(0.6, 1), y - len * rnd(0.2, 0.9))
      c.stroke()
    }
    // накладка замка снаружи: пластина с болтами
    c.fillStyle = '#3a3a38'
    c.fillRect(50, 52, 10, 18)
    c.fillStyle = '#181818'
    for (const [bx, by] of [[52, 54], [58, 54], [52, 66], [58, 66]]) c.fillRect(bx, by, 2, 2)
  })
}

/** Засечки на стене: считать дни. */
function tallyTex(): THREE.CanvasTexture {
  return tex(64, 64, (c) => {
    c.fillStyle = '#45473f'
    c.fillRect(0, 0, 64, 64)
    c.strokeStyle = 'rgba(18,19,15,0.9)'
    c.lineWidth = 1.6
    let gx = 6
    let gy = 8
    for (let group = 0; group < 11; group++) {
      const tilt = rnd(-0.08, 0.08)
      for (let i = 0; i < 4; i++) {
        const x = gx + i * 3.4
        c.beginPath()
        c.moveTo(x, gy)
        c.lineTo(x + tilt * 8, gy + rnd(10, 13))
        c.stroke()
      }
      c.beginPath()
      c.moveTo(gx - 1.5, gy + rnd(9, 12))
      c.lineTo(gx + 13, gy + rnd(0, 2))
      c.stroke()
      gx = gx === 6 ? 38 : 6
      if (gx === 6) gy += 18
    }
  })
}

/** Газета на полу: серый лист с колонками «текста». */
function paperTex(): THREE.CanvasTexture {
  return tex(64, 64, (c) => {
    c.fillStyle = '#8d887c'
    c.fillRect(0, 0, 64, 64)
    c.fillStyle = '#2e2c26'
    c.fillRect(8, 6, 48, 6)
    c.fillStyle = 'rgba(40,38,32,0.75)'
    for (let y = 18; y < 60; y += 4) {
      for (const x of [8, 36]) c.fillRect(x, y, rnd(20, 26), 2)
    }
  })
}

/** Матрас: серая ткань с разводами. */
function mattressTex(): THREE.CanvasTexture {
  return tex(64, 64, (c) => {
    c.fillStyle = '#6b655a'
    c.fillRect(0, 0, 64, 64)
    for (let i = 0; i < 12; i++) {
      c.fillStyle = 'rgba(52,46,38,0.4)'
      c.beginPath()
      c.ellipse(rnd(0, 64), rnd(0, 64), rnd(4, 12), rnd(3, 8), rnd(0, 3), 0, Math.PI * 2)
      c.fill()
    }
    // шов по краю
    c.strokeStyle = 'rgba(40,36,30,0.7)'
    c.strokeRect(2, 2, 60, 60)
  })
}

/** Фотография на стене: выцветший снимок двоих, приклеен скотчем. */
function photoTex(): THREE.CanvasTexture {
  return tex(40, 48, (c) => {
    c.fillStyle = '#ded6c4'
    c.fillRect(0, 0, 40, 48)
    c.fillStyle = '#5c6157'
    c.fillRect(4, 6, 32, 34)
    // двое: силуэты на фоне окна
    for (const [x, s] of [
      [15, 1],
      [25, 0.92],
    ] as const) {
      c.fillStyle = '#2b2c28'
      c.beginPath()
      c.arc(x, 24, 4 * s, 0, Math.PI * 2)
      c.fill()
      c.fillRect(x - 4 * s, 28, 8 * s, 12)
    }
    c.fillStyle = 'rgba(180,180,170,0.85)'
    c.fillRect(4, 6, 32, 6)
    // скотч по углам
    c.fillStyle = 'rgba(210,205,190,0.55)'
    c.fillRect(1, 1, 10, 4)
    c.fillRect(29, 1, 10, 4)
  })
}

/** Собрать комнату. Возвращает дверь и пыль для анимации. */
export function buildRoom(scene: THREE.Scene, chairX: number, chairZ: number, chairYaw: number): Room4 {
  const wallMat = new THREE.MeshLambertMaterial({ map: wallTex() })
  const floorMat = new THREE.MeshLambertMaterial({ map: floorTex() })
  const darkMat = new THREE.MeshLambertMaterial({ color: 0x2a2c28 })
  const woodMat = new THREE.MeshLambertMaterial({ color: 0x4a3b2a })
  const ropeMat = new THREE.MeshLambertMaterial({ color: 0x8a7448 })

  const floor = new THREE.Mesh(new THREE.PlaneGeometry(6, 5), floorMat)
  floor.rotation.x = -Math.PI / 2
  floor.position.set(0, 0, -0.5)
  scene.add(floor)

  const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(6, 5), darkMat)
  ceiling.rotation.x = Math.PI / 2
  ceiling.position.set(0, 3, -0.5)
  scene.add(ceiling)

  const back = new THREE.Mesh(new THREE.BoxGeometry(6, 3, 0.2), wallMat)
  back.position.set(0, 1.5, -3)
  scene.add(back)

  const left = new THREE.Mesh(new THREE.BoxGeometry(0.2, 3, 5), wallMat)
  left.position.set(-3, 1.5, -0.5)
  scene.add(left)

  const right = new THREE.Mesh(new THREE.BoxGeometry(0.2, 3, 5), wallMat)
  right.position.set(3, 1.5, -0.5)
  scene.add(right)

  // ── дверь: доски, царапины, замочная накладка ────────────────────────
  const doorPivot = new THREE.Group()
  doorPivot.position.set(-0.6, 0, -2.88)
  const door = new THREE.Mesh(
    new THREE.BoxGeometry(1.2, 2.2, 0.08),
    new THREE.MeshLambertMaterial({ map: doorTex() }),
  )
  door.position.set(0.6, 1.1, 0)
  doorPivot.add(door)
  scene.add(doorPivot)

  // проём: тёмный прямоугольник за дверью
  const hole = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 2.2), new THREE.MeshBasicMaterial({ color: 0x020304 }))
  hole.position.set(0, 1.1, -2.95)
  scene.add(hole)

  // ── труба и лампа (вторая половина трубки мертва) ────────────────────
  const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 5.6, 6), darkMat)
  pipe.rotation.z = Math.PI / 2
  pipe.position.set(0, 2.86, -1.4)
  scene.add(pipe)

  const tubeLive = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.06, 0.16), new THREE.MeshBasicMaterial({ color: 0xfff0c0 }))
  tubeLive.position.set(0.0, 2.78, -0.4)
  scene.add(tubeLive)
  const tubeDead = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.06, 0.16), new THREE.MeshBasicMaterial({ color: 0x3a3830 }))
  tubeDead.position.set(0.58, 2.78, -0.4)
  scene.add(tubeDead)

  // ── стул, к которому привязана девушка ───────────────────────────────
  const chair = new THREE.Group()
  chair.position.set(chairX, 0, chairZ)
  chair.rotation.y = chairYaw
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
  // моток верёвки брошен на сиденье у спинки — ею её и привязывали
  const seatCoil = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.014, 6, 12), ropeMat)
  seatCoil.position.set(0.04, 0.49, -0.1)
  seatCoil.rotation.x = Math.PI / 2
  seatCoil.scale.set(1.15, 0.8, 1)
  chair.add(seatCoil)
  const ropeEnd = new THREE.Mesh(new THREE.CylinderGeometry(0.013, 0.013, 0.34, 5), ropeMat)
  ropeEnd.position.set(0.18, 0.3, 0.16)
  ropeEnd.rotation.set(0.2, 0, 0.4)
  chair.add(ropeEnd)
  scene.add(chair)

  // ── следы беда: обрывки верёвки там, где она вырывалась ──────────────
  for (const [x, z, yaw] of [
    [-0.2, -0.35, 0.7],
    [-1.0, -0.55, 2.1],
    [-0.35, -1.6, 1.2],
  ] as const) {
    const scrap = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.3, 5), ropeMat)
    scrap.rotation.set(Math.PI / 2, 0, yaw)
    scrap.position.set(x, 0.015, z)
    scene.add(scrap)
  }
  const coil = new THREE.Mesh(new THREE.TorusGeometry(0.045, 0.013, 5, 10), ropeMat)
  coil.rotation.x = Math.PI / 2
  coil.position.set(0.35, 0.015, -0.7)
  scene.add(coil)

  // ── матрас в углу: она здесь спит ────────────────────────────────────
  const mattress = new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.16, 0.55), new THREE.MeshLambertMaterial({ map: mattressTex() }))
  mattress.position.set(-1.62, 0.08, -2.6)
  mattress.rotation.y = 0.12
  scene.add(mattress)
  const blanket = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.07, 0.5), darkMat)
  blanket.position.set(-1.8, 0.19, -2.58)
  blanket.rotation.y = 0.3
  scene.add(blanket)

  // ── вещи: её привезли с вещами, они брошены где пришлось ─────────────
  const bag = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.14, 0.1), new THREE.MeshLambertMaterial({ color: 0x5a2e26 }))
  bag.position.set(0.95, 0.07, -2.4)
  bag.rotation.y = -0.5
  scene.add(bag)
  const flap = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.02, 0.1), new THREE.MeshLambertMaterial({ color: 0x4a241e }))
  flap.position.set(0.95, 0.15, -2.4)
  flap.rotation.y = -0.5
  scene.add(flap)

  const shoeMat = new THREE.MeshLambertMaterial({ color: 0x33302b })
  const shoe1 = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.06, 0.22), shoeMat)
  shoe1.position.set(1.55, 0.03, -0.95)
  shoe1.rotation.y = 0.6
  scene.add(shoe1)
  const shoe2 = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.22, 0.06), shoeMat)
  shoe2.position.set(1.72, 0.05, -0.8)
  shoe2.rotation.set(0, 0.2, 1.4)
  scene.add(shoe2)

  // комканная одежда
  const clothMat = new THREE.MeshLambertMaterial({ color: 0x565a52 })
  for (const [x, z, yaw, mat] of [
    [0.45, -2.6, 0.9, clothMat],
    [-0.95, -2.65, 2.3, new THREE.MeshLambertMaterial({ color: 0x6a6458 })],
    [2.05, -1.35, 1.5, clothMat],
  ] as const) {
    const cloth = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.03, 0.2), mat)
    cloth.position.set(x, 0.02, z)
    cloth.rotation.y = yaw
    scene.add(cloth)
  }

  // газета у табурета
  const paper = new THREE.Mesh(new THREE.PlaneGeometry(0.36, 0.5), new THREE.MeshLambertMaterial({ map: paperTex() }))
  paper.rotation.x = -Math.PI / 2
  paper.rotation.z = 0.5
  paper.position.set(1.15, 0.012, -1.7)
  scene.add(paper)

  // ── цепь: раньше держала её у стены, теперь разомкнута и брошена ─────
  const anchor = new THREE.Vector3(-2.42, 0.55, -2.88)
  const cuffPos = new THREE.Vector3(-1.98, 0.04, -2.5)
  const chainMat = new THREE.MeshLambertMaterial({ color: 0x6d6d64 })
  const linkDir = new THREE.Vector3().subVectors(cuffPos, anchor).normalize()
  const linkQ = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), linkDir)
  for (let i = 0; i < 10; i++) {
    const link = new THREE.Mesh(new THREE.TorusGeometry(0.04, 0.011, 5, 8), chainMat)
    link.position.lerpVectors(anchor, cuffPos, (i + 0.5) / 10)
    link.quaternion.copy(linkQ)
    if (i % 2) link.rotateZ(Math.PI / 2)
    scene.add(link)
  }
  const bolt = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.06, 6), chainMat)
  bolt.rotation.x = Math.PI / 2
  bolt.position.copy(anchor).add(new THREE.Vector3(0, 0, -0.02))
  scene.add(bolt)
  const cuff = new THREE.Mesh(new THREE.TorusGeometry(0.055, 0.012, 5, 9, Math.PI * 1.7), chainMat)
  cuff.rotation.x = Math.PI / 2
  cuff.rotation.z = 0.6
  cuff.position.copy(cuffPos)
  scene.add(cuff)

  // ── ведро, бутылка, миска: что давали, то и осталось стоять ─────────
  const metal = new THREE.MeshLambertMaterial({ color: 0x51554f })
  const bucket = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.115, 0.32, 8), metal)
  bucket.position.set(-0.98, 0.16, -2.5)
  bucket.rotation.y = 0.3
  scene.add(bucket)
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.012, 5, 10), metal)
  rim.rotation.x = Math.PI / 2
  rim.position.set(-0.98, 0.32, -2.5)
  scene.add(rim)
  const water = new THREE.Mesh(
    new THREE.CircleGeometry(0.125, 8),
    new THREE.MeshBasicMaterial({ color: 0x0b1214 }),
  )
  water.rotation.x = -Math.PI / 2
  water.position.set(-0.98, 0.315, -2.5)
  scene.add(water)

  const bottle = new THREE.Mesh(
    new THREE.CylinderGeometry(0.035, 0.035, 0.22, 6),
    new THREE.MeshLambertMaterial({ color: 0x7c8a80 }),
  )
  bottle.position.set(-1.16, 0.14, -2.2)
  bottle.rotation.set(Math.PI / 2, 0, 0.3)
  scene.add(bottle)
  const cap = new THREE.Mesh(
    new THREE.CylinderGeometry(0.03, 0.03, 0.04, 6),
    new THREE.MeshLambertMaterial({ color: 0x9aa0a0 }),
  )
  cap.position.set(-1.16, 0.15, -2.08)
  scene.add(cap)

  const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.05, 0.05, 8), metal)
  bowl.position.set(-2.16, 0.026, -2.42)
  scene.add(bowl)

  // ── фото на стене над матрасом: двое, до всего этого ─────────────────
  const photo = new THREE.Mesh(
    new THREE.PlaneGeometry(0.28, 0.34),
    new THREE.MeshLambertMaterial({ map: photoTex() }),
  )
  photo.position.set(-1.42, 1.52, -2.885)
  photo.rotation.z = 0.04
  scene.add(photo)

  // ── полоса света из-под двери: в коридоре кто-то оставил свет ───────
  const gapGlow = new THREE.Mesh(
    new THREE.PlaneGeometry(1.16, 0.05),
    new THREE.MeshBasicMaterial({ color: 0x76856f }),
  )
  gapGlow.rotation.x = -Math.PI / 2
  gapGlow.position.set(0, 0.012, -2.83)
  scene.add(gapGlow)
  const gapLight = new THREE.PointLight(0x9fb3a4, 3.4, 3.4, 2)
  gapLight.position.set(0, 0.1, -2.6)
  scene.add(gapLight)

  // ── тёмные застарелые пятна: что-то было, и это не вода ──────────────
  for (const [x, z, sx, sz, color] of [
    [1.0, -2.55, 0.4, 0.3, 0x1d1512],
    [0.25, -2.2, 0.7, 0.22, 0x241a14],
    [-1.75, -1.95, 0.3, 0.25, 0x1b1712],
  ] as const) {
    const stain = new THREE.Mesh(
      new THREE.CircleGeometry(0.5, 9),
      new THREE.MeshLambertMaterial({ color }),
    )
    stain.rotation.x = -Math.PI / 2
    stain.position.set(x, 0.008, z)
    stain.scale.set(sx, sz, 1)
    scene.add(stain)
  }

  // ── засечки дней на стене справа от двери ────────────────────────────
  const tally = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.5), new THREE.MeshLambertMaterial({ map: tallyTex() }))
  tally.position.set(0.95, 1.5, -2.89)
  scene.add(tally)

  // ── вентиляция под потолком (про неё писали в новостях узла) ─────────
  const vent = new THREE.Group()
  vent.position.set(1.75, 2.45, -2.89)
  const frame = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.4, 0.04), darkMat)
  vent.add(frame)
  for (let i = 0; i < 4; i++) {
    const slat = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.035, 0.05), new THREE.MeshLambertMaterial({ color: 0x191b18 }))
    slat.position.set(0, -0.14 + i * 0.09, 0.01)
    vent.add(slat)
  }
  scene.add(vent)

  // ── паутина в дальнем углу под потолком ──────────────────────────────
  const webGeo = new THREE.BufferGeometry()
  const C: [number, number, number] = [-2.95, 2.9, -2.9]
  const webPts: number[] = []
  const ends: [number, number, number][] = [
    [-2.1, 2.9, -2.9],
    [-2.35, 2.35, -2.9],
    [-2.95, 2.35, -2.45],
    [-2.95, 2.9, -2.2],
    [-2.6, 2.62, -2.6],
  ]
  for (const e of ends) webPts.push(...C, ...e)
  webGeo.setAttribute('position', new THREE.Float32BufferAttribute(webPts, 3))
  const web = new THREE.LineSegments(
    webGeo,
    new THREE.LineBasicMaterial({ color: 0x8a8a80, transparent: true, opacity: 0.35 }),
  )
  scene.add(web)

  // ── пыль в свете лампы ───────────────────────────────────────────────
  const N = 46
  const pos = new Float32Array(N * 3)
  for (let i = 0; i < N; i++) {
    pos[i * 3] = rnd(-2, 2)
    pos[i * 3 + 1] = rnd(0.9, 2.7)
    pos[i * 3 + 2] = rnd(-2.4, 0.4)
  }
  const dustGeo = new THREE.BufferGeometry()
  dustGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  const dust = new THREE.Points(
    dustGeo,
    new THREE.PointsMaterial({
      color: 0xffe8b8,
      size: 0.02,
      transparent: true,
      opacity: 0.4,
      depthWrite: false,
    }),
  )
  scene.add(dust)

  return { doorPivot, dust }
}
