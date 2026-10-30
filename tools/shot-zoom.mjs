// Крупные кадры фида: открывает КАМ-04, вырезает область записи из экрана
// монитора и рисует её поверх страницы с 3× пиксельным увеличением.
//   node tools/shot-zoom.mjs [url] [outDir] [кадров] [задержка мс]
import { chromium } from 'playwright-core'
import { mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const url = process.argv[2] ?? 'http://127.0.0.1:5175/?ui&cam'
const out = process.argv[3] ?? join(tmpdir(), 'opencode', 'zoom')
const frames = Number(process.argv[4] ?? 6)
const gap = Number(process.argv[5] ?? 700)
mkdirSync(out, { recursive: true })

const browser = await chromium.launch({
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle'],
})
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } })
const errors = []
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text())
})
page.on('pageerror', (e) => errors.push(String(e)))

await page.goto(url, { waitUntil: 'networkidle' })
await page.waitForTimeout(1500)

// TDS открыт сразу через ?ui&cam: браузерный пролог больше не нужен.
await page.waitForTimeout(1200)

// Область записи внутри экрана монитора (канвас 960×720 в левом верхнем углу).
await page.evaluate(() => {
  const src = document.querySelector('canvas')
  if (!src) return
  const crop = { x: 264, y: 202, w: 354, h: 264 }
  const scale = 3
  const over = document.createElement('canvas')
  over.width = crop.w * scale
  over.height = crop.h * scale
  over.style.cssText = `position:fixed;left:8px;top:8px;z-index:9999;image-rendering:pixelated;border:2px solid #444`
  const ctx = over.getContext('2d')
  ctx.imageSmoothingEnabled = false
  const tick = () => {
    ctx.drawImage(src, crop.x, crop.y, crop.w, crop.h, 0, 0, over.width, over.height)
    requestAnimationFrame(tick)
  }
  tick()
  document.body.appendChild(over)
})

for (let i = 0; i < frames; i++) {
  await page.waitForTimeout(gap)
  await page.screenshot({ path: `${out}/${String(i + 1).padStart(2, '0')}-zoom.png`, clip: { x: 0, y: 0, width: 1080, height: 810 } })
}

console.log(errors.length ? `ОШИБКИ:\n${errors.join('\n')}` : 'ошибок в консоли нет')
await browser.close()
