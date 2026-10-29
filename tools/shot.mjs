// Скриншот-тест прототипа: открывает игру в установленном Edge, кликает по
// рабочему столу и сохраняет кадры. Запуск:
//   node tools/shot.mjs [url] [outDir]
// Нужен только для разработки, в билд не попадает.
// Координаты кликов подогнаны под viewport 1600×900 и текущую посадку камеры.
import { chromium } from 'playwright-core'
import { mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const url = process.argv[2] ?? 'http://127.0.0.1:5174/'
const out = process.argv[3] ?? join(tmpdir(), 'opencode', 'shots')
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
  await page.mouse.move(x, y, { steps: 5 })
  await page.mouse.down()
  await page.mouse.up()
  await page.waitForTimeout(wait)
}

// Рабочий стол без окон: браузер теперь запускается по клику, а не сам.
await page.goto(url, { waitUntil: 'networkidle' })
await page.waitForTimeout(2500)
await page.screenshot({ path: `${out}/01-desktop.png` })

// Иконка «Интернет»: 1.5 с песочных часов, потом окно браузера
await click(320, 275, 1900)
await page.screenshot({ path: `${out}/02-browser.png` })

// Поиск по узлу в браузере
await click(480, 388, 900)
await page.screenshot({ path: `${out}/03-search.png` })

// Иконка «Почта»
await click(320, 165, 1400)
await page.screenshot({ path: `${out}/04-mail.png` })

// Письмо в списке
await click(800, 322, 900)
await page.screenshot({ path: `${out}/05-letter.png` })

// Перетаскивание окна почты за заголовок
await page.mouse.move(900, 267)
await page.mouse.down()
await page.mouse.move(760, 430, { steps: 12 })
await page.mouse.up()
await page.waitForTimeout(600)
await page.screenshot({ path: `${out}/06-drag.png` })

// Меню «Пуск»
await click(350, 843, 800)
await page.screenshot({ path: `${out}/07-start.png` })

console.log(errors.length ? `ОШИБКИ:\n${errors.join('\n')}` : 'ошибок в консоли нет')
await browser.close()
