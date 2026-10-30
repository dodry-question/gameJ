// Она выбегает из комнаты в коридор: серия кадров от момента открытия двери.
//   node tools/shot-escape.mjs [url] [outDir]
import { chromium } from 'playwright-core'
import { mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const url = process.argv[2] ?? 'http://127.0.0.1:5175/?ui&cam'
const out = process.argv[3] ?? join(tmpdir(), 'opencode', 'escape')
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
  // Дверь открыта, она стоит у порога — сейчас побежит.
  v.gesture = null
  v.gestureNext = 1e9
  v.freeT = 1
  v.doorOpen = 1
  v.doorPivot.rotation.y = -1.5
  v.setState('run')
  v.girl.position.set(0, 0, -2.55)
  v.prev.set(0, 0, -2.55)
  v.yaw = v.yawTarget = Math.PI
  v.girl.rotation.y = Math.PI
})

for (let i = 0; i < 6; i++) {
  await page.waitForTimeout(450)
  await page.screenshot({
    path: `${out}/${String(i + 1).padStart(2, '0')}-escape.png`,
    clip: { x: 0, y: 0, width: 1290, height: 975 },
  })
}

console.log(errors.length ? `ОШИБКИ:\n${errors.join('\n')}` : 'ошибок в консоли нет')
await browser.close()
