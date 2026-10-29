// Локальные скриншоты gameJ на Linux (в репозитории tools/shot.mjs — под Windows).
// Запуск: node ~/scripts/shot-gamej.mjs [url] [outDir]
import { chromium } from 'playwright-core'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

const url = process.argv[2] ?? 'http://127.0.0.1:5174/'
const out = process.argv[3] ?? join('/tmp/opencode', 'gamej-shots')
mkdirSync(out, { recursive: true })

const browser = await chromium.launch({
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--disable-gpu-sandbox'],
})
const page = await browser.newPage({ viewport: { width: 1000, height: 760 } })

const errors = []
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text())
})
page.on('pageerror', (e) => errors.push(String(e)))

const click = async (x, y, wait = 600) => {
  await page.mouse.move(x, y, { steps: 4 })
  await page.mouse.down()
  await page.mouse.up()
  await page.waitForTimeout(wait)
}

// 1. Стол без 3D — быстрый режим ?ui
await page.goto(`${url}?ui`, { waitUntil: 'networkidle' })
await page.waitForTimeout(1200)
await page.screenshot({ path: `${out}/01-desktop.png`, clip: { x: 0, y: 0, width: 960, height: 720 } })

// 2. Браузер по иконке «Интернет» (второй значок)
await click(54, 134, 1900)
await page.screenshot({ path: `${out}/02-browser.png`, clip: { x: 0, y: 0, width: 960, height: 720 } })

// 3. Поиск — ссылка на личной панели
await click(250, 165, 700)
await page.screenshot({ path: `${out}/03-search.png`, clip: { x: 0, y: 0, width: 960, height: 720 } })

// 4. Ошибка загрузки — «Справка»
await click(345, 165, 700)
await page.screenshot({ path: `${out}/04-error.png`, clip: { x: 0, y: 0, width: 960, height: 720 } })

// 5. Настоящий 3D-вид с монитором
await page.goto(url, { waitUntil: 'networkidle' })
await page.waitForTimeout(2600)
await page.screenshot({ path: `${out}/05-room.png` })

console.log(errors.length ? `ОШИБКИ:\n${errors.join('\n')}` : 'ошибок в консоли нет')
await browser.close()
