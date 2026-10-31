// Проверка питания линий камер: попытка входа в обесточенный узел 01 →
// окно ошибки «НЕТ ПИТАНИЯ» → блокнот с адресом → power.local → осциллограф
// (ползунки) → рубильники по порядку (плюс авария) → питание подано →
// узел 01 в сети → пост охраны в эфире.
//   node tools/check-power.mjs [url] [outDir]
import { chromium } from 'playwright-core'
import { mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const url = process.argv[2] ?? 'http://127.0.0.1:5175/?ui&cam'
const out = process.argv[3] ?? join(tmpdir(), 'opencode', 'power-check')
mkdirSync(out, { recursive: true })

const browser = await chromium.launch({
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--autoplay-policy=no-user-gesture-required'],
})
const page = await browser.newPage({ viewport: { width: 1000, height: 760 } })
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text())
})

await page.goto(url, { waitUntil: 'networkidle' })
await page.mouse.click(480, 360)
await page.waitForFunction(() => window.__cctv?.loaded === true, null, { timeout: 25000 })
await page.waitForTimeout(600)

const shot = async (name) =>
  page.screenshot({ path: `${out}/${name}.png`, clip: { x: 0, y: 0, width: 960, height: 720 } })
const result = {}

// ── 1. Попытка входа в обесточенный узел 01 → окно ошибки ────────────
await page.evaluate(() => window.__tds.reset())
await page.waitForTimeout(400)
const n1 = await page.evaluate(() => window.__tds.debugInfo().cam01)
await page.mouse.move(n1.x, n1.y)
await page.mouse.down()
await page.waitForTimeout(1700)
await page.mouse.up()
await page.waitForTimeout(500)
result.errorShown = await page.evaluate(() => window.__tds.debugInfo().error)
await shot('power-error')

// ── 2. Закрыть окно → блокнот с адресом ─────────────────────────────
await page.mouse.click(480, 360)
await page.waitForTimeout(2400)
result.note = await page.evaluate(() => ({
  open: window.__desk.windows.some((w) => w.key === 'notepad'),
  address: (window.__desk.noteText || '').includes('power.local'),
}))

// ── 3. power.local: осциллограф → рубильники ────────────────────────
await page.mouse.click(38, 704) // «Пуск»
await page.waitForTimeout(300)
await page.mouse.click(110, 522) // Netscape
await page.waitForTimeout(2200)
await page.mouse.click(400, 143)
await page.keyboard.type('power.local', { delay: 10 })
await page.keyboard.press('Enter')
await page.waitForTimeout(1600)
await shot('power-phase')
result.page = await page.evaluate(() => window.__browser?.page ?? null)

const deadline = Date.now() + 20000
while (Date.now() < deadline) {
  const st = await page.evaluate(() => window.__power.debugState())
  if (st.stage !== 'phase') break
  await page.evaluate(() => {
    const p = window.__power
    p.debugSlider(0, (1.55 - 0.4) / 2.4)
    p.debugSlider(2, (0.62 - 0.15) / 0.85)
    const ref = p.debugRefPhase()
    p.debugSlider(1, ((((ref % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) / (Math.PI * 2)) % 1)
  })
  await page.waitForTimeout(100)
}
result.afterPhase = await page.evaluate(() => window.__power.debugState())

await page.evaluate(() => window.__power.debugLever('ШИНА')) // не первый — КЗ
await page.waitForTimeout(300)
result.afterWrong = await page.evaluate(() => window.__power.debugState())
await shot('power-line-spark')
for (const label of ['СЕТЬ', 'ЩИТ', 'ЛИНИЯ', 'ШИНА']) {
  await page.evaluate((l) => window.__power.debugLever(l), label)
  await page.waitForTimeout(250)
}
await page.waitForTimeout(400)
await shot('power-won')
result.won = await page.evaluate(() => window.__power.debugState())
result.cctvPower = await page.evaluate(() => window.__cctv.powerReady)

// ── 4. Узел 01 в сети: удержание → эфир поста охраны ────────────────
await page.mouse.click(130, 705) // вкладка TDS в панели задач — поднять окно
await page.waitForTimeout(400)
await page.evaluate(() => window.__tds.reset())
await page.waitForTimeout(400)
const n1b = await page.evaluate(() => window.__tds.debugInfo().cam01)
await page.mouse.move(n1b.x, n1b.y)
await page.mouse.down()
await page.waitForTimeout(1700)
await page.mouse.up()
await page.waitForTimeout(1400)
result.postFeed = await page.evaluate(() => window.__tds.debugInfo().screen)
await shot('post-cam-01')

console.log(JSON.stringify(result, null, 2))
if (errors.length) console.log('ERRORS:', errors)
await browser.close()
process.exit(errors.length ? 1 : 0)
