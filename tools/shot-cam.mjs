// Скриншоты фида камеры КАМ-04: открывает браузер в ?ui-режиме, вводит адрес
// камеры и снимает несколько кадров подряд (чтобы видеть фазы движения).
//   node tools/shot-cam.mjs [url] [outDir] [кадров]
// Координаты кликов подогнаны под ?ui: стол 960×720, вьюпорт 1600×900.
import { chromium } from 'playwright-core'
import { mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const url = process.argv[2] ?? 'http://127.0.0.1:5175/?ui'
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

// ?ui-стол рисуется в левом верхнем углу в масштабе 1:1 (960×720).
const ui = (x, y) => ({ x, y })
const click = async (x, y, wait = 600) => {
  const p = ui(x, y)
  await page.mouse.move(p.x, p.y, { steps: 4 })
  await page.mouse.down()
  await page.mouse.up()
  await page.waitForTimeout(wait)
}

// Иконка «Интернет» → окно браузера (1.5 с песочных часов); двойной клик
await click(55, 137, 60)
await page.mouse.down()
await page.mouse.up()
await page.waitForTimeout(1900)
await page.screenshot({ path: `${out}/00-browser.png` })

// Клик по адресной строке и ввод адреса камеры
await click(400, 141, 400)
await page.keyboard.type('http://192.168.0.13/cam04', { delay: 15 })
await page.keyboard.press('Enter')
await page.waitForTimeout(1200)

// Серия кадров: фиды мерцают, девушка движется
for (let i = 0; i < frames; i++) {
  await page.waitForTimeout(900)
  await page.screenshot({ path: `${out}/${String(i + 1).padStart(2, '0')}-cam.png` })
}

console.log(errors.length ? `ОШИБКИ:\n${errors.join('\n')}` : 'ошибок в консоли нет')
await browser.close()
