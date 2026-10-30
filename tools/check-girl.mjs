// Проверка поведения девушки: обход стула, жест «машет в камеру», уход
// в коридор до исчезновения. Пишет числа и скриншоты.
//   node tools/check-girl.mjs [url] [outDir]
import { chromium } from 'playwright-core'
import { mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const url = process.argv[2] ?? 'http://127.0.0.1:5175/?ui&cam'
const out = process.argv[3] ?? join(tmpdir(), 'opencode', 'girl')
mkdirSync(out, { recursive: true })

const browser = await chromium.launch({
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle'],
})
const page = await browser.newPage({ viewport: { width: 1300, height: 1000 } })
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))

await page.goto(url, { waitUntil: 'networkidle' })
await page.waitForTimeout(1500)

// TDS открыт сразу через ?ui&cam: браузерный пролог больше не нужен.
await page.waitForTimeout(2600)

await page.evaluate(() => {
  const v = window.__cctv
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
})

const shot = async (name) => {
  await page.screenshot({
    path: `${out}/${name}.png`,
    clip: { x: 0, y: 0, width: 1290, height: 975 },
  })
}

// ── 1. Бродит: минимальное расстояние до стула за кадр ────────────────
await page.evaluate(() => {
  const v = window.__cctv
  v.gesture = null
  v.gestureNext = 1e9
  v.freeT = 1
  v.setState('pace')
  v.girl.position.set(-0.3, 0, -0.3)
  v.prev.set(-0.3, 0, -0.3)
  v.yaw = v.yawTarget = 0
  v.girl.rotation.y = 0
  const CHAIR = { x: -0.6, z: -0.9 }
  window.__minChair = 9
  const loop = () => {
    const d = Math.hypot(v.girl.position.x - CHAIR.x, v.girl.position.z - CHAIR.z)
    if (d < window.__minChair) window.__minChair = d
    requestAnimationFrame(loop)
  }
  loop()
})
for (let i = 0; i < 4; i++) {
  await page.waitForTimeout(1200)
  await shot(`01-pace-${i}`)
}
const minChair = await page.evaluate(() => window.__minChair)

// ── 2. Жест «машет в камеру» ─────────────────────────────────────────
await page.evaluate(() => {
  const v = window.__cctv
  v.gestureNext = 1e9
  v.setState('idle')
  v.girl.position.set(-0.25, 0, -0.25)
  v.prev.set(-0.25, 0, -0.25)
  const yaw = Math.atan2(v.constructor.CAM.pos[0] - -0.25, v.constructor.CAM.pos[2] - -0.25)
  v.yaw = v.yawTarget = yaw
  v.girl.rotation.y = yaw
  v.time = 100
  v.gesture = { kind: 'wave', start: 100, dur: 3.8, side: 1 }
  v.freedAt = 0
})
await page.waitForTimeout(900)
await shot('02-wave-a')
const hand = await page.evaluate(() => {
  const v = window.__cctv
  const b = v.bones.get('RightHand')
  const p = new b.position.constructor()
  b.getWorldPosition(p)
  const cam = v.constructor.CAM.pos
  return {
    hand: { x: +p.x.toFixed(2), y: +p.y.toFixed(2), z: +p.z.toFixed(2) },
    cam,
    toCam: {
      x: +(cam[0] - p.x).toFixed(2),
      y: +(cam[1] - p.y).toFixed(2),
      z: +(cam[2] - p.z).toFixed(2),
    },
  }
})
await page.waitForTimeout(500)
await shot('02-wave-b')

// ── 3. Дверь открыта: уходит в коридор ───────────────────────────────
await page.evaluate(() => {
  const v = window.__cctv
  v.gesture = null
  v.gestureNext = 1e9
  v.freeT = 1
  v.doorOpen = 0.0001
  v.girl.position.set(0, 0, -2.4)
  v.prev.set(0, 0, -2.4)
  v.setState('run')
  window.__track = []
  const t0 = performance.now()
  let lastT = -1
  const loop = () => {
    const p = v.girlPos
    const now = performance.now()
    if (p && now - lastT > 200) {
      lastT = now
      window.__track.push({ t: Math.round(now - t0), x: +p.x.toFixed(2), z: +p.z.toFixed(2) })
    }
    requestAnimationFrame(loop)
  }
  loop()
})
for (let i = 0; i < 9; i++) {
  await page.waitForTimeout(500)
  await shot(`03-run-${i}`)
}
const track = await page.evaluate(() => window.__track)

console.log(JSON.stringify({ minChair: +minChair.toFixed(3), hand, track }, null, 2))
console.log(errors.length ? `ОШИБКИ:\n${errors.join('\n')}` : 'ошибок в консоли нет')
await browser.close()
