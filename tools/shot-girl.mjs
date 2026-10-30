// Крупный кадр девушки вне записи: открывает КАМ-04 и ставит отладочную камеру
// рядом с ней. Так видно пересечения рук с телом, посадку и подъём.
//   node tools/shot-girl.mjs [url] [outDir] [кадров] [задержка мс] [вид]
// вид: close (по умолчанию), side, three-quarter, wide
import { chromium } from 'playwright-core'
import { mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const url = process.argv[2] ?? 'http://127.0.0.1:5175/?ui&cam'
const out = process.argv[3] ?? join(tmpdir(), 'opencode', 'girl')
const frames = Number(process.argv[4] ?? 4)
const gap = Number(process.argv[5] ?? 700)
const view = process.argv[6] ?? 'close'
mkdirSync(out, { recursive: true })

const CAMERAS = {
  close: { pos: [0.15, 1.25, 0.55], at: [-0.72, 0.72, -0.9], fov: 40 },
  side: { pos: [1.05, 1.15, -0.55], at: [-0.6, 0.75, -0.95], fov: 42 },
  'three-quarter': { pos: [0.95, 1.35, 0.75], at: [-0.65, 0.8, -0.95], fov: 45 },
  wide: { pos: [1.7, 2.2, 1.4], at: [-0.55, 0.85, -1.3], fov: 58 },
}

const browser = await chromium.launch({
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle'],
})
const page = await browser.newPage({ viewport: { width: 1200, height: 900 } })
const errors = []
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text())
})
page.on('pageerror', (e) => errors.push(String(e)))

await page.goto(url, { waitUntil: 'networkidle' })
await page.waitForTimeout(1500)

// TDS открыт сразу через ?ui&cam: браузерный пролог больше не нужен.
await page.waitForTimeout(2500)

const cam = CAMERAS[view] ?? CAMERAS.close
await page.evaluate((c) => {
  const v = window.__cctv
  if (!v) return
  v.camera.position.set(...c.pos)
  v.camera.lookAt(...c.at)
  v.camera.fov = c.fov
  v.camera.updateProjectionMatrix()
}, cam)

// Рисуем сам кадр камеры крупно, без обвязки окна.
await page.evaluate(() => {
  const feed = window.__cctv?.canvas
  if (!feed) return
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

for (let i = 0; i < frames; i++) {
  await page.waitForTimeout(gap)
  await page.screenshot({ path: `${out}/${String(i + 1).padStart(2, '0')}-${view}.png`, clip: { x: 0, y: 0, width: 1290, height: 975 } })
}

console.log(errors.length ? `ОШИБКИ:\n${errors.join('\n')}` : 'ошибок в консоли нет')
console.log('__cctv:', await page.evaluate(() => (window.__cctv ? 'есть' : 'нет')))
await browser.close()
