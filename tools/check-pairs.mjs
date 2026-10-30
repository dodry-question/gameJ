// Проверка головоломки-пар и узла печати: гейт до этапа (403) → pairs.local →
// два этапа (8 попыток, 3 подсматривания) → код без формы печати → print.local
// → строка пароля → «Печать» → код уходит на принтер кухни.
//   node tools/check-pairs.mjs [url] [outDir]
import { chromium } from 'playwright-core'
import { mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const url = process.argv[2] ?? 'http://127.0.0.1:5175/?ui&cam&kitchen'
const out = process.argv[3] ?? join(tmpdir(), 'opencode', 'pairs')
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
const pairs = () => page.evaluate(() => window.__pairs?.debugState() ?? null)
const navigate = async (host) => {
  await click(400, 143, 200)
  await page.keyboard.type(host, { delay: 15 })
  await page.keyboard.press('Enter')
  await page.waitForTimeout(1200)
  return page.evaluate(() => window.__browser?.page ?? null)
}

const result = {}

// ── 1. Гейт замка: до письма со камеры узел закрыт ───────────────────
await page.waitForFunction(() => window.__cctv?.loaded === true, null, { timeout: 20000 })
await click(38, 704, 300)
await click(110, 522, 1500)
result.gateLockDeniedEarly =
  (await page.evaluate(() => window.__browser?.canOpenLock?.() ?? null)) === false

// ── 2. Она на кухне — pairs.local открывается ────────────────────────
await page.waitForFunction(
  () => window.__cctv?.girlState === 'kitchen',
  null,
  { timeout: 30000 },
)
result.page = await navigate('pairs.local')
result.intro = await pairs()
await shot('02-intro')
await page.keyboard.press('Space')
await page.waitForTimeout(300)
result.memorize = await pairs()
await shot('03-memorize')
await page.evaluate(() => window.__pairs.debugSkipMemorize())
await page.waitForTimeout(200)

// честный промах и честное совпадение
const missPair = await page.evaluate(() => {
  const cards = window.__pairs.debugCards()
  const a = cards.find((c) => c.state === 'hidden')
  const b = cards.find((c) => c.state === 'hidden' && c.kind !== a.kind)
  return { a: { x: a.x, y: a.y }, b: { x: b.x, y: b.y } }
})
await click(missPair.a.x, missPair.a.y, 80)
await click(missPair.b.x, missPair.b.y, 900)
result.afterMiss = await pairs()

// подсматривание: карты открываются и закрываются обратно
const peeksBefore = (await pairs()).peeks
await page.keyboard.press('KeyP')
await page.waitForTimeout(300)
await shot('04-peek')
await page.waitForTimeout(900)
const peeksAfter = (await pairs()).peeks
result.peeksUsed = peeksBefore - peeksAfter

const matchPair = await page.evaluate(() => {
  const cards = window.__pairs.debugCards()
  const a = cards.find((c) => c.state === 'hidden')
  const b = cards.find((c) => c.kind === a.kind && c !== a)
  return { a: { x: a.x, y: a.y }, b: { x: b.x, y: b.y } }
})
await click(matchPair.a.x, matchPair.a.y, 80)
await click(matchPair.b.x, matchPair.b.y, 300)
result.afterMatch = await pairs()
await page.evaluate(() => window.__pairs.debugSolveStage())
await page.waitForTimeout(1800)
result.won = await pairs()
result.noPrintFormOnGame = await page.evaluate(
  () => typeof window.__pairs.debugForm !== 'function',
)
await shot('05-code')

// ── 3. print.local: строка пароля и честная «Печать» ─────────────────
result.printPage = await navigate('print.local')
await shot('06-print-site')
const form = await page.evaluate(() => window.__printsite?.debugForm() ?? null)
await click(form.input.x, form.input.y, 200)
await page.keyboard.type((await pairs()).password, { delay: 40 })
await click(form.print.x, form.print.y, 600)
result.printedCode = await page.evaluate(() => window.__desk.debugInfo().printedCode)
await shot('07-printed')

console.log(JSON.stringify(result, null, 2))
console.log(errors.length ? `ОШИБКИ:\n${errors.join('\n')}` : 'ошибок в консоли нет')
await browser.close()
