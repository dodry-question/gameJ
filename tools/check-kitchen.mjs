// Проверка кухни: ?ui&cam&kitchen — девушку сразу отправляют в кухню, ждём
// прихода, узел 05 оживает на карте, удержание подключает КАМ-05, в кадре кухня.
//   node tools/check-kitchen.mjs [url] [outDir]
import { chromium } from 'playwright-core'
import { mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const url = process.argv[2] ?? 'http://127.0.0.1:5175/?ui&cam&kitchen'
const out = process.argv[3] ?? join(tmpdir(), 'opencode', 'kitchen')
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
await page.waitForTimeout(1200)

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
const result = {}

// ── 1. Она доходит до кухни сама ─────────────────────────────────────
await page.waitForFunction(() => window.__cctv?.loaded === true, null, { timeout: 20000 })
result.stateBefore = await page.evaluate(() => window.__cctv.girlState)
await page.waitForFunction(
  () => window.__cctv?.girlState === 'kitchen',
  null,
  { timeout: 30000 },
)
result.stateAfter = await page.evaluate(() => window.__cctv.girlState)
result.kitchenReady = await page.evaluate(() => window.__cctv.kitchenReady)

// ── 2. Карта: узел 05 в сети, удержание подключает КАМ-05 ────────────
await click(58, 41, 600) // ← КАРТА
const p = await page.evaluate(() => window.__tds?.debugInfo().cam05 ?? null)
if (!p) throw new Error('узел 05 не найден на карте')
await shot('01-map-node05')
await page.mouse.move(p.x, p.y, { steps: 3 })
await page.mouse.down()
await page.waitForTimeout(2200)
await page.mouse.up()
await page.waitForTimeout(1500)
result.connecting = await page.evaluate(() => window.__tds?.debugInfo().screen)
await page.waitForTimeout(3000)
result.screen = await page.evaluate(() => window.__tds?.debugInfo().screen)
result.channel = await page.evaluate(() => window.__tds?.feed.channelNow ?? null)
await shot('02-kitchen-feed')

console.log(JSON.stringify(result, null, 2))
console.log(errors.length ? `ОШИБКИ:\n${errors.join('\n')}` : 'ошибок в консоли нет')
await browser.close()
