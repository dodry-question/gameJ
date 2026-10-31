// Проверка релейного щита (power.local) и камеры 01: гейт до письма → 403 →
// подсказка обесточенного узла в TDS → осциллограф (ползунки) → рубильники
// по порядку → питание подано → узел 01 в сети → пост охраны в эфире.
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

// ── 1. Узел 01 обесточен: клик даёт подсказку power.local ────────────
await page.evaluate(() => window.__tds.reset())
await page.waitForTimeout(300)
const node01 = await page.evaluate(() => window.__tds.debugInfo().cam)
await page.mouse.click(node01.x, node01.y)
await page.waitForTimeout(300)
await shot('map-power-hint')

// ── 2. Гейт: до чтения письма power.local отвечает 403 ───────────────
// (в ?cam гейты открыты, поэтому проверяем только саму страницу)
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
result.phase = await page.evaluate(() => window.__power?.debugState() ?? null)

// ── 3. Осциллограф: частота и амплитуда точно, фаза — за опорной ─────
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

// ── 4. Рубильники: верный порядок и одна авария для проверки сброса ──
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

// ── 5. Узел 01 в сети: удержание → эфир поста охраны ─────────────────
await page.evaluate(() => window.__tds.reset())
await page.waitForTimeout(300)
const map = await page.evaluate(() => ({
  cam: window.__tds.debugInfo().cam,
  online01: true,
}))
await page.evaluate(() => window.__tds.forceChannel('01'))
await page.waitForTimeout(1000)
await shot('post-cam-01')
result.postHeader = await page.evaluate(() => window.__tds.debugInfo().screen)

console.log(JSON.stringify(result, null, 2))
if (errors.length) console.log('ERRORS:', errors)
await browser.close()
process.exit(errors.length ? 1 : 0)
