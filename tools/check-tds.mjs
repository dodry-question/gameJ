// Сквозная проверка TDS: письмо → скачивание tds.exe → вирус-тыква на весь
// экран → установка → ярлык → карта блока C → удержание камеры 2 с →
// подключение → постепенная загрузка картинки → эфир → возврат на карту.
//   node tools/check-tds.mjs [url] [outDir]
import { chromium } from 'playwright-core'
import { mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const url = process.argv[2] ?? 'http://127.0.0.1:5175/?ui'
const out = process.argv[3] ?? join(tmpdir(), 'opencode', 'tds')
mkdirSync(out, { recursive: true })

const browser = await chromium.launch({
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle'],
})
const page = await browser.newPage({ viewport: { width: 1000, height: 760 } })
const errors = []
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text())
})
page.on('pageerror', (e) => errors.push(String(e)))

await page.goto(url, { waitUntil: 'networkidle' })
await page.waitForTimeout(1500)

const click = async (x, y, wait = 400) => {
  await page.mouse.move(x, y, { steps: 3 })
  await page.mouse.down()
  await page.mouse.up()
  await page.waitForTimeout(wait)
}
const shot = async (name) => {
  await page.screenshot({
    path: `${out}/${name}.png`,
    clip: { x: 0, y: 0, width: 960, height: 720 },
  })
}
const state = () =>
  page.evaluate(() => ({
    install: window.__desk?.install
      ? Math.round(performance.now() - window.__desk.install.start)
      : null,
    icon: window.__desk?.icons.some((i) => i.id === 'tds') ?? false,
    windows: window.__desk?.windows.map((w) => w.key) ?? [],
  }))

// ── 1. Почта и скачивание вложения ───────────────────────────────────
// Письмо приходит через 5 с после входа; открываем почту после этого.
await page.waitForTimeout(5200)
await click(54, 48, 60)
await click(54, 48, 1500)
await shot('01-mail')

// Кнопка «Скачать» в полосе вложения.
await click(800, 539, 120)
const virusAt = await page.evaluate(() => ({
  has: !!window.__desk?.install,
  phase: window.__desk?.install
    ? window.__desk.install.holdEnd - performance.now()
    : null,
}))
await shot('02-virus')
await page.waitForTimeout(1200)
await shot('03-virus-hold')
await page.waitForTimeout(1400)
await shot('04-virus-fade')
await page.waitForTimeout(1200)
await shot('05-install')
await page.waitForTimeout(2600)
await shot('06-icon')
const afterInstall = await state()

// ── 2. Запуск tds.exe: развёрнутая карта ─────────────────────────────
await click(54, 518, 80)
await click(54, 518, 1400)
await shot('07-map')
const mapInfo = await page.evaluate(() => window.__tds?.debugInfo() ?? null)

// ── 3. Удержание камеры две секунды ──────────────────────────────────
const p = mapInfo?.cam
if (p) {
  await page.mouse.move(p.x, p.y, { steps: 3 })
  await page.mouse.down()
  await page.waitForTimeout(1000)
  await shot('08-hold-half')
  await page.waitForTimeout(1200)
  await shot('09-hold-done')
  const holding = await page.evaluate(() => window.__tds?.debugInfo().screen)
  await page.mouse.up()
  await page.waitForTimeout(200)
  await shot('10-connect')
  const connecting = await page.evaluate(() => window.__tds?.debugInfo().screen)
  await page.waitForTimeout(1000)
  const entered = await page.evaluate(() => window.__tds?.debugInfo().screen)
  await shot('11-reveal-a')
  await page.waitForTimeout(900)
  await shot('12-reveal-b')
  await page.waitForTimeout(1600)
  await shot('13-feed')
  const feed = await page.evaluate(() => ({
    screen: window.__tds?.debugInfo().screen,
    viewing: window.__tds?.viewingCamera,
    loaded: window.__cctv?.loaded ?? false,
    reveal: window.__cctv ? true : false,
  }))

  // ── 4. Назад на карту и закрытие окна ─────────────────────────────
  await click(58, 41, 300)
  const back = await page.evaluate(() => window.__tds?.debugInfo().screen)
  await shot('14-back-map')
  await click(947, 11, 300)
  const closed = await page.evaluate(() => ({
    windows: window.__desk?.windows.map((w) => w.key) ?? [],
  }))
  console.log(
    JSON.stringify(
      { virusAt, afterInstall, mapInfo, holding, connecting, entered, feed, back, closed },
      null,
      2,
    ),
  )
} else {
  console.log(JSON.stringify({ virusAt, afterInstall, mapInfo, error: 'нет узла камеры' }, null, 2))
}

console.log(errors.length ? `ОШИБКИ:\n${errors.join('\n')}` : 'ошибок в консоли нет')
await browser.close()
