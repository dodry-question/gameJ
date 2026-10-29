// Скриншот-тест прототипа на Linux (в репозитории tools/shot.mjs — вариант под Windows).
// Открывает игру в headless Chromium, проходит по интерфейсу и сохраняет кадры.
// Запуск: node tools/shot-linux.mjs [url] [outDir]
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

const clip = { x: 0, y: 0, width: 960, height: 720 }

const click = async (x, y, wait = 600) => {
  await page.mouse.move(x, y, { steps: 3 })
  await page.mouse.down()
  await page.mouse.up()
  await page.waitForTimeout(wait)
}

/** Двойной клик: два pointerdown подряд, чтобы сработало открытие ярлыка. */
const dbl = async (x, y, wait = 900) => {
  await page.mouse.move(x, y, { steps: 3 })
  await page.mouse.down()
  await page.mouse.up()
  await page.waitForTimeout(90)
  await page.mouse.down()
  await page.mouse.up()
  await page.waitForTimeout(wait)
}

const shot = async (name) => {
  await page.screenshot({ path: `${out}/${name}.png`, clip })
}

// ── часть 1: рабочий стол, выделение рамкой ────────────────────────
await page.goto(`${url}?ui`, { waitUntil: 'networkidle' })
await page.waitForTimeout(1200)
await shot('01-desktop')

// Рамка выделения: тянем от пустого места к ярлыкам.
await page.mouse.move(300, 330)
await page.mouse.down()
for (let i = 1; i <= 12; i++) {
  await page.mouse.move(300 + (10 - 300) * (i / 12), 330 + (10 - 330) * (i / 12))
}
await shot('02-band')
await page.mouse.up()
await page.waitForTimeout(250)
await shot('03-selection')
await click(600, 400, 250)

// ── часть 2: почта, архив, установка ──────────────────────────────
await dbl(54, 54, 1500) // Почта
await shot('04-mail')

await click(500, 530, 400) // «Скачать» вложение
await shot('05-install')

await page.waitForTimeout(3000)
await shot('06-installed')

// ── часть 3: запуск exe, камера, письмо ───────────────────────────
await dbl(148, 54, 1900) // cam04.exe
await shot('07-camera-locked')

await click(54, 54, 400) // поднять почту
await click(500, 156, 500) // прочитать письмо похитителей
await shot('08-mail-threat')

await click(400, 95, 400) // поднять камеру за заголовок
await shot('09-camera-ready')

await click(679, 507, 900) // «Открыть дверь»
await shot('10-camera-open')
await page.waitForTimeout(2600)
await shot('11-camera-gone')

// ── часть 4: проводник и перетаскивание ярлыка ────────────────────
await page.goto(`${url}?ui`, { waitUntil: 'networkidle' })
await page.waitForTimeout(900)
await dbl(54, 242, 1100) // Мой компьютер
await shot('12-explorer')

// перетаскиваем ярлык «Почта» вниз-вправо
await page.mouse.move(54, 54)
await page.mouse.down()
for (let i = 1; i <= 12; i++) {
  await page.mouse.move(54 + (330 - 54) * (i / 12), 54 + (380 - 54) * (i / 12))
}
await page.mouse.up()
await page.waitForTimeout(250)
await shot('13-icon-moved')

// ── часть 5: 3D-вид с монитором ───────────────────────────────────
await page.goto(url, { waitUntil: 'networkidle' })
await page.waitForTimeout(2800)
await page.screenshot({ path: `${out}/14-room.png` })

console.log(errors.length ? `ОШИБКИ:\n${errors.join('\n')}` : 'ошибок в консоли нет')
await browser.close()
