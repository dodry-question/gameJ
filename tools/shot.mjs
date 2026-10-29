// Скриншот-тест прототипа: открывает игру в установленном Edge, кликает по
// рабочему столу и сохраняет кадры. Запуск:
//   node tools/shot.mjs [url] [outDir]
// Нужен только для разработки, в билд не попадает.
import { chromium } from 'playwright-core'
import { mkdirSync } from 'node:fs'

const url = process.argv[2] ?? 'http://127.0.0.1:5174/'
const out = process.argv[3] ?? 'C:/Users/dodry/AppData/Local/Temp/opencode'
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

const click = async (x, y, wait = 700) => {
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.up()
  await page.waitForTimeout(wait)
}

await page.goto(url, { waitUntil: 'networkidle' })
await page.waitForTimeout(2500)
await page.screenshot({ path: `${out}/01-desktop.png` })

// Поиск по узлу в браузере
await click(570, 291, 900)
await page.screenshot({ path: `${out}/02-search.png` })

// Иконка «Почта»
await click(467, 145, 900)
await page.screenshot({ path: `${out}/03-mail.png` })

// Письмо в списке
await click(790, 300, 900)
await page.screenshot({ path: `${out}/04-letter.png` })

// Перетаскивание окна почты за заголовок
await page.mouse.move(850, 217)
await page.mouse.down()
await page.mouse.move(700, 400, { steps: 12 })
await page.mouse.up()
await page.waitForTimeout(600)
await page.screenshot({ path: `${out}/05-drag.png` })

// Меню «Пуск»
await click(487, 597, 800)
await page.screenshot({ path: `${out}/06-start.png` })

console.log(errors.length ? `ОШИБКИ:\n${errors.join('\n')}` : 'ошибок в консоли нет')
await browser.close()
