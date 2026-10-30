// Проверка головоломки-пар на pairs.local: открытие страницы → запуск этапа →
// показ → поиск пар (совпадение и промах с попытками) → победа → пароль →
// печать кода → провал при исчерпанных попытках.
//   node tools/check-pairs.mjs [url] [outDir]
import { chromium } from 'playwright-core'
import { mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const url = process.argv[2] ?? 'http://127.0.0.1:5175/?ui'
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

const result = {}

// ── 1. Пуск → Netscape → pairs.local ─────────────────────────────────
await click(38, 704, 300)
await click(110, 522, 1500)
await click(400, 143, 200)
await page.keyboard.type('pairs.local', { delay: 15 })
await page.keyboard.press('Enter')
await page.waitForTimeout(1300)
result.page = await page.evaluate(() => window.__browser?.page ?? null)
result.intro = await pairs()
await shot('01-intro')

// ── 2. Этап 1: показ → честные клики: пара и промах → добить отладкой ─
await page.keyboard.press('Space')
await page.waitForTimeout(400)
result.memorize = await pairs()
await shot('02-memorize')
await page.evaluate(() => window.__pairs.debugSkipMemorize())
await page.waitForTimeout(200)

// честный промах: две разные карты — попытка должна сгореть
const missPair = await page.evaluate(() => {
  const cards = window.__pairs.debugCards()
  const a = cards.find((c) => c.state === 'hidden')
  const b = cards.find((c) => c.state === 'hidden' && c.kind !== a.kind)
  return { a: { x: a.x, y: a.y }, b: { x: b.x, y: b.y } }
})
await click(missPair.a.x, missPair.a.y, 80)
await click(missPair.b.x, missPair.b.y, 900)
result.afterMiss = await pairs()

// честное совпадение: две карты одного вида
const matchPair = await page.evaluate(() => {
  const cards = window.__pairs.debugCards()
  const a = cards.find((c) => c.state === 'hidden')
  const b = cards.find((c) => c.kind === a.kind && c !== a)
  return { a: { x: a.x, y: a.y }, b: { x: b.x, y: b.y } }
})
await click(matchPair.a.x, matchPair.a.y, 80)
await click(matchPair.b.x, matchPair.b.y, 300)
result.afterMatch = await pairs()
await shot('03-play')

await page.evaluate(() => window.__pairs.debugSolveStage())
await page.waitForTimeout(300)
result.stageDone = await pairs()
await shot('04-stage-done')
await page.waitForTimeout(1600)

// ── 3. Этап 2: показ → победа → пароль ───────────────────────────────
result.stage2Intro = await pairs()
await page.keyboard.press('Space')
await page.waitForTimeout(300)
await page.evaluate(() => window.__pairs.debugSkipMemorize())
await page.evaluate(() => window.__pairs.debugSolveStage())
await page.waitForTimeout(1800)
result.won = await pairs()
await shot('05-password')

// ── 4. Печать: вводим произвольный код и жмём кнопку честно ──────────
const field = await page.evaluate(() => {
  // координаты строки и кнопки отдаёт игра после отрисовки
  return window.__pairs.debugForm()
})
await click(field.input.x, field.input.y, 200)
await page.keyboard.type('0000', { delay: 40 })
await click(field.print.x, field.print.y, 400)
result.printedCode = await page.evaluate(() => window.__desk.debugInfo().printedCode)
result.formState = await pairs()
await shot('06-printed')

// ── 5. Провал: сливаем 8 попыток честными промахами ──────────────────
await page.evaluate(() => window.__pairs.reset())
await page.keyboard.press('Space')
await page.waitForTimeout(200)
await page.evaluate(() => window.__pairs.debugSkipMemorize())
for (let i = 0; i < 9; i++) {
  const s = await pairs()
  if (s.state !== 'play') break
  const miss = await page.evaluate(() => {
    const cards = window.__pairs.debugCards()
    const a = cards.find((c) => c.state === 'hidden')
    const b = cards.find((c) => c.state === 'hidden' && c.kind !== a.kind)
    return { a: { x: a.x, y: a.y }, b: { x: b.x, y: b.y } }
  })
  await click(miss.a.x, miss.a.y, 60)
  await click(miss.b.x, miss.b.y, 820)
}
result.failState = await pairs()
result.pairsLost = await page.evaluate(() => window.__desk.debugInfo().pairsLost)
await shot('07-fail')

console.log(JSON.stringify(result, null, 2))
console.log(errors.length ? `ОШИБКИ:\n${errors.join('\n')}` : 'ошибок в консоли нет')
await browser.close()
