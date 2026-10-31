// Скриншоты фида камеры КАМ-04 на Linux (аналог tools/shot-cam.mjs под Brave).
//   node tools/shot-cam-linux.mjs [url] [outDir] [кадров]
import { chromium } from 'playwright-core'
import { mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const url = process.argv[2] ?? 'http://127.0.0.1:5199/?ui&cam'
const out = process.argv[3] ?? join(tmpdir(), 'opencode', 'camshots-linux')
const frames = Number(process.argv[4] ?? 6)
mkdirSync(out, { recursive: true })

const browser = await chromium.launch({
  executablePath: '/usr/bin/brave-browser-stable',
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--disable-gpu-sandbox', '--no-sandbox'],
})
const page = await browser.newPage({ viewport: { width: 1300, height: 1000 } })
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text())
})

await page.goto(url, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(1500)
await page.waitForTimeout(2600)

// увеличенный фид камеры поверх страницы
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
    clip: { x: 0, y: 0, width: 1300, height: 990 },
  })
}

for (let i = 0; i < frames; i++) {
  await page.waitForTimeout(1000)
  await shot(`cam-${String(i).padStart(2, '0')}`)
}

console.log('ошибки страницы:', errors.length ? errors.slice(0, 5) : 'нет')
console.log('кадры в', out)
await browser.close()
