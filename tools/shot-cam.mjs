// Скриншоты фида камеры КАМ-04: ?ui&cam открывает TDS сразу на живом кадре,
// дальше снимаем несколько кадров подряд (чтобы видеть фазы движения).
//   node tools/shot-cam.mjs [url] [outDir] [кадров]
import { chromium } from 'playwright-core'
import { mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const url = process.argv[2] ?? 'http://127.0.0.1:5175/?ui&cam'
const out = process.argv[3] ?? join(tmpdir(), 'opencode', 'camshots')
const frames = Number(process.argv[4] ?? 6)
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

// Серия кадров: фиды мерцают, девушка движется
for (let i = 0; i < frames; i++) {
  await page.waitForTimeout(900)
  await page.screenshot({ path: `${out}/${String(i + 1).padStart(2, '0')}-cam.png` })
}

console.log(errors.length ? `ОШИБКИ:\n${errors.join('\n')}` : 'ошибок в консоли нет')
await browser.close()
