// Проверка перехвата потока (pairs.local) и узла печати: гейт после кухни →
// интро → ловля бит (движение ловца, зелёное окно ±2) → ПАУЗА мышью →
// клик по зелёному хэшу → код без формы печати → print.local → строка
// пароля → «Печать» → код уходит на принтер кухни. Плюс провал: пауза
// вне зелёного окна рвёт поток и будит маньяка.
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

// ── 1. Гейт: на кухне узел pairs.local открыт ────────────────────────
await page.waitForFunction(() => window.__cctv?.loaded === true, null, { timeout: 20000 })
await click(38, 704, 300)
await click(110, 522, 1500)
await page.waitForFunction(
  () => window.__cctv?.girlState === 'kitchen',
  null,
  { timeout: 30000 },
)
result.gatePairsOpen = await page.evaluate(() => window.__browser?.canOpenPairs?.() ?? null)

// ── 2. pairs.local: интро и старт ────────────────────────────────────
result.page = await navigate('pairs.local')
result.intro = await pairs()
await shot('02-intro')
await page.keyboard.press('Space')
await page.waitForTimeout(800)
result.play = await pairs()
result.bitsInAir = await page.evaluate(() => window.__pairs.debugBits())
await shot('03-play')

// ловец ездит: удержание D смещает вправо, A возвращает
const cxBefore = (await pairs()).catcher
await page.keyboard.down('d')
await page.waitForTimeout(350)
await page.keyboard.up('d')
const cxAfter = (await pairs()).catcher
await page.keyboard.down('a')
await page.waitForTimeout(120)
await page.keyboard.up('a')
result.catcherMoved = cxAfter > cxBefore
result.catcher = { before: cxBefore, after: (await pairs()).catcher }

// ── 3. Зелёное окно: догоняем до нижней границы честными битами ──────
let st = await pairs()
const need = Math.max(0, st.window[0] - st.caught)
await page.evaluate((n) => window.__pairs.debugCatch(n), need)
st = await pairs()
result.green = st.green
result.hashRegen = st.hash !== '···· ···· ···· ····'
await shot('04-green')

// ── 4. ПАУЗА мышью в углу и клик по зелёному хэшу ────────────────────
const btns = await page.evaluate(() => window.__pairs.debugButtons())
await click(btns.pause.x, btns.pause.y, 300)
result.paused = (await pairs()).state
await shot('05-paused')
await click(btns.hash.x, btns.hash.y, 300)
st = await pairs()
result.won = st.state
result.password4 = /^\d{4}$/.test(st.password ?? '')
result.noPrintFormOnGame = await page.evaluate(
  () => typeof window.__pairs.debugForm !== 'function',
)
await shot('06-code')

// ── 5. print.local: строка пароля и честная «Печать» ─────────────────
result.printPage = await navigate('print.local')
await shot('07-print-site')
const form = await page.evaluate(() => window.__printsite?.debugForm() ?? null)
await click(form.input.x, form.input.y, 200)
await page.keyboard.type((await pairs()).password, { delay: 40 })
await click(form.print.x, form.print.y, 600)
result.printedCode = await page.evaluate(() => window.__desk.debugInfo().printedCode)
await shot('07-printed')

// ── 6. Провал: пауза вне зелёного окна рвёт поток ────────────────────
await navigate('pairs.local')
await page.evaluate(() => window.__pairs.reset()) // смена перезапущена — игра с начала
await page.waitForTimeout(300)
result.restarted = (await pairs()).state
await page.keyboard.press('Space')
await page.waitForTimeout(400)
await page.evaluate(() => window.__pairs.debugCatch(2)) // меньше окна: хэш не зелёный
const beforeFail = await pairs()
result.failNotGreen = beforeFail.green === false
const failBtns = await page.evaluate(() => window.__pairs.debugButtons())
await click(failBtns.pause.x, failBtns.pause.y, 600)
result.failed = (await pairs()).state
result.cinematic = await page.evaluate(() => window.__desk.debugInfo().pairsLost)
await shot('08-sorry') // плашка «Мне очень жаль», хэш красный

console.log(JSON.stringify(result, null, 2))
console.log(errors.length ? `ОШИБКИ:\n${errors.join('\n')}` : 'ошибок в консоли нет')
await browser.close()
