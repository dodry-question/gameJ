// Поиск позы «машет в камеру»: кисть поднята перед лицом, рука направлена
// в объектив. Перебирает углы плеча/предплечья и снимает лучшую позу.
//   node tools/wave-search2.mjs [url] [outPng]
import { chromium } from 'playwright-core'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const url = process.argv[2] ?? 'http://127.0.0.1:5175/?ui&cam'
const outPng = process.argv[3] ?? join(tmpdir(), 'opencode', 'wave2.png')

const browser = await chromium.launch({
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle'],
})
const page = await browser.newPage({ viewport: { width: 1300, height: 1000 } })
page.on('pageerror', (e) => console.error('pageerror', String(e)))
await page.goto(url, { waitUntil: 'networkidle' })
await page.waitForTimeout(1500)
// TDS открыт сразу через ?ui&cam: браузерный пролог больше не нужен.
await page.waitForTimeout(2600)

const result = await page.evaluate(() => {
  const v = window.__cctv
  v.gesture = null
  v.gestureNext = 1e9
  v.freeT = 1
  v.setState('idle')
  v.girl.position.set(-0.3, 0, -0.3)
  v.prev.set(-0.3, 0, -0.3)
  const yaw = Math.atan2(1.7 - -0.3, 1.4 - -0.3)
  v.yaw = v.yawTarget = yaw
  v.girl.rotation.y = yaw
  v.animate = () => {}

  const STAND = {
    Spine: [0.05, 0, 0],
    Head: [0, 0, 0],
    LeftArm: [0, 0, 0.08],
    RightArm: [0, 0, -0.08],
    LeftForeArm: [-0.18, 0, 0],
    RightForeArm: [-0.18, 0, 0],
    LeftUpLeg: [0, 0.02, 0.02],
    RightUpLeg: [0, -0.02, -0.02],
  }
  const pos = (name) => {
    const b = v.bones.get(name)
    const p = new b.position.constructor()
    b.getWorldPosition(p)
    return { x: p.x, y: p.y, z: p.z }
  }
  const sample = (ax, az, fx, fz) => {
    const p = { ...STAND }
    p.RightArm = [ax, 0, az]
    p.RightForeArm = [fx, 0, fz]
    v.applyPose(p)
    v.girl.updateMatrixWorld(true)
    return { hand: pos('RightHand'), elbow: pos('RightForeArm'), shoulder: pos('RightArm'), head: pos('Head') }
  }
  const base = sample(0, -0.08, -0.18, 0)
  const H = base.head
  // цель: кисть в 35 см перед лицом, в сторону камеры, чуть выше макушки
  const dx = 1.7 - H.x
  const dz = 1.4 - H.z
  const dl = Math.hypot(dx, dz)
  const tx = H.x + (dx / dl) * 0.42
  const tz = H.z + (dz / dl) * 0.42
  const ty = H.y + 0.05

  const rows = []
  for (let ax = -1.7; ax <= -0.5; ax += 0.1)
    for (let az = -0.7; az <= 0.7; az += 0.14)
      for (let fx = -1.3; fx <= 0.3; fx += 0.15)
        for (let fz = -0.9; fz <= 0.9; fz += 0.2) {
          const s = sample(ax, az, fx, fz)
          const err = Math.hypot(s.hand.x - tx, s.hand.y - ty, s.hand.z - tz)
          // локоть ниже кисти и в стороне от торса — читаемый «привет»
          const elbowOk = s.elbow.y < s.hand.y - 0.05
          const score = err + (elbowOk ? 0 : 0.15)
          rows.push({ ax: +ax.toFixed(2), az: +az.toFixed(2), fx: +fx.toFixed(2), fz: +fz.toFixed(2), score: +score.toFixed(3), hand: s.hand, err: +err.toFixed(3) })
        }
  rows.sort((a, b) => a.score - b.score)
  return { yaw: +yaw.toFixed(2), target: { x: +tx.toFixed(2), y: +ty.toFixed(2), z: +tz.toFixed(2) }, top: rows.slice(0, 6) }
})
console.log(JSON.stringify(result, null, 2))

// Поставить лучшую позу и снять фид крупно
await page.evaluate((best) => {
  const v = window.__cctv
  v.animate = () => {}
  const p = {
    Spine: [0.05, 0, 0],
    Head: [0, 0, 0],
    LeftArm: [0, 0, 0.08],
    RightArm: [best.ax, 0, best.az],
    LeftForeArm: [-0.18, 0, 0],
    RightForeArm: [best.fx, 0, best.fz],
    LeftUpLeg: [0, 0.02, 0.02],
    RightUpLeg: [0, -0.02, -0.02],
  }
  v.applyPose(p)
  const feed = v.canvas
  const over = document.createElement('canvas')
  over.width = 320 * 4
  over.height = 240 * 4
  over.style.cssText = 'position:fixed;left:8px;top:8px;z-index:9999;image-rendering:pixelated;border:2px solid #444'
  const ctx = over.getContext('2d')
  ctx.imageSmoothingEnabled = false
  const tick = () => {
    ctx.drawImage(feed, 0, 0, 320, 240, 0, 0, over.width, over.height)
    requestAnimationFrame(tick)
  }
  tick()
  document.body.appendChild(over)
}, result.top[0])
await page.waitForTimeout(900)
await page.screenshot({ path: outPng, clip: { x: 0, y: 0, width: 1290, height: 975 } })
await browser.close()
