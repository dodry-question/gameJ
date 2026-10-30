// Полная проверка кухни: переход → КАМ-05 → скан → команды (нож, холодильник,
// мясо, принтер) → pairs.local → пароль → печать → дверь → «ОНА УШЛА».
// Отдельно — провал: мурзик, маньяк, экран «ВЫ ПРОИГРАЛИ».
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
const flags = () => page.evaluate(() => window.__cctv?.flags ?? null)
const desk = () => page.evaluate(() => ({
  dead: window.__desk?.girlDead ?? null,
  escaped: window.__desk?.escaped ?? null,
  printed: window.__desk?.printedCode ?? null,
}))
/** Команда с ожиданием: она занята, пока не дойдёт и не сделает. */
const doCmd = async (id, action, timeout = 20000) => {
  await page.evaluate(
    ([i, a]) => window.__cctv.command(i, a),
    [id, action],
  )
  try {
    await page.waitForFunction(
      () => window.__cctv?.task === null,
      null,
      { timeout },
    )
  } catch (e) {
    const dbg = await page.evaluate(() => ({
      task: window.__cctv?.task ?? null,
      state: window.__cctv?.girlState ?? null,
      pos: window.__cctv?.girlPos ?? null,
      gesture: !!window.__cctv?.gestureNow,
    }))
    console.log(`ТАЙМАУТ ${id}/${action}:`, JSON.stringify(dbg))
    throw e
  }
  await page.waitForTimeout(400)
}
const result = {}

// ── 1. Переход в кухню и подключение к КАМ-05 ────────────────────────
await page.waitForFunction(() => window.__cctv?.loaded === true, null, { timeout: 20000 })
await page.waitForFunction(() => window.__cctv?.girlState === 'kitchen', null, { timeout: 30000 })
await click(58, 41, 600)
const p = await page.evaluate(() => window.__tds?.debugInfo().cam05 ?? null)
await page.mouse.move(p.x, p.y, { steps: 3 })
await page.mouse.down()
await page.waitForTimeout(2200)
await page.mouse.up()
await page.waitForTimeout(3200)

// ── 2. Скан по TAB: рамки и подписи ──────────────────────────────────
for (let i = 0; i < 3; i++) {
  if (await page.evaluate(() => window.__tds?.feed.scan === true)) break
  await page.keyboard.press('Tab')
  await page.waitForTimeout(300)
}
result.scan = await page.evaluate(() => window.__tds?.feed.scan ?? null)
await shot('01-scan')

// ── 3. Нож: страх и реплика про свежую кровь ─────────────────────────
await doCmd('knife', 'take')
result.knife = (await flags()).knife
await shot('02-knife')

// ── 4. Холодильник → мясо → разрезать ножом ──────────────────────────
await doCmd('fridge', 'inspect')
result.meatOut = (await flags()).meatOut
await shot('03-fridge')
await doCmd('meat', 'cut')
result.meatCut = (await flags()).meatCut
await shot('04-plate')

// ── 5. pairs.local: два этапа → пароль → печать ──────────────────────
await click(38, 704, 300)
await click(110, 522, 1500)
await click(400, 143, 200)
await page.keyboard.type('pairs.local', { delay: 15 })
await page.keyboard.press('Enter')
await page.waitForTimeout(1300)
await page.keyboard.press('Space') // этап 1: показ
await page.waitForTimeout(300)
await page.evaluate(() => window.__pairs.debugSkipMemorize())
await page.evaluate(() => window.__pairs.debugSolveStage())
await page.waitForTimeout(1800)
await page.keyboard.press('Space') // этап 2: показ
await page.waitForTimeout(300)
await page.evaluate(() => window.__pairs.debugSkipMemorize())
await page.evaluate(() => window.__pairs.debugSolveStage())
await page.waitForTimeout(1800)
const password = await page.evaluate(() => window.__pairs.debugState().password)
result.password = password
await shot('05-password')

// печатаем настоящий пароль честно: строка + кнопка
await page.evaluate(() => {
  // поднять браузер поверх (он уже активен) и кликнуть по форме из игры
  const form = window.__pairs.debugForm()
  return form
})
const form = await page.evaluate(() => window.__pairs.debugForm())
await click(form.input.x, form.input.y, 200)
await page.keyboard.type(password, { delay: 40 })
await click(form.print.x, form.print.y, 600)
result.printed = (await desk()).printed
await shot('06-printed')

// ── 6. Она берёт бумажку и выходит: «ОНА УШЛА» ───────────────────────
await page.waitForFunction(() => window.__desk?.escaped === true, null, { timeout: 45000 })
result.escaped = true
await shot('07-escaped')

// ── 7. Провал: мурзик, маньяк, «ВЫ ПРОИГРАЛИ» ────────────────────────
await page.reload({ waitUntil: 'networkidle' })
await page.waitForTimeout(1200)
await page.evaluate(() => {
  // тот же путь короче: сцена провала запускается напрямую
  window.__desk.pairsLost()
})
await page.waitForTimeout(2600)
await shot('08-maniac')
await page.waitForFunction(() => window.__desk?.girlDead === true, null, { timeout: 12000 })
result.dead = true
await shot('09-game-over')

console.log(JSON.stringify(result, null, 2))
console.log(errors.length ? `ОШИБКИ:\n${errors.join('\n')}` : 'ошибок в консоли нет')
await browser.close()
