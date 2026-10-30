// Сквозная проверка сброса замка: эфир КАМ-04 → «Открыть дверь» → блокнот
// с адресом панели → файлы в «Мой компьютер» → Netscape → lockreset.local →
// мини-игра (удары по узлам, перезарядка волной) → победа → дверь отперта.
//   node tools/check-lock.mjs [url] [outDir]
import { chromium } from 'playwright-core'
import { mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const url = process.argv[2] ?? 'http://127.0.0.1:5175/?ui&cam&girl'
const out = process.argv[3] ?? join(tmpdir(), 'opencode', 'lock')
mkdirSync(out, { recursive: true })

const browser = await chromium.launch({
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle'],
})
const context = await browser.newContext({
  viewport: { width: 1000, height: 760 },
  permissions: ['clipboard-read', 'clipboard-write'],
})
const page = await context.newPage()
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
const lock = () => page.evaluate(() => window.__lock?.debugState() ?? null)
const desk = () => page.evaluate(() => window.__desk?.debugInfo() ?? null)
const windows = () =>
  page.evaluate(() => window.__desk?.windows.map((w) => w.app.title) ?? [])
const notepadText = () =>
  page.evaluate(
    () =>
      window.__desk?.windows.find((w) => w.app.title.includes('дверь'))?.app.text ?? null,
  )
const tdsInfo = () => page.evaluate(() => window.__tds?.debugInfo() ?? null)

const result = {}

// ── 1. Ждём камеру, жмём «Открыть дверь» ─────────────────────────────
await page.waitForFunction(() => window.__cctv?.loaded === true, null, { timeout: 20000 })
await shot('01-feed')
await click(119, 657, 1200) // кнопка «Открыть дверь» в эфире
result.windowsAfterButton = await windows()
result.noteHasUrl = (await notepadText())?.includes('lockreset.local') ?? false
result.deskAfterButton = await desk()
await shot('02-notepad-url')

// ── 2. Проводник: файлы по папкам ────────────────────────────────────
// «Мой компьютер» из «Пуска»: Пуск → пункт меню «Мой компьютер».
await click(38, 704, 300)
await click(110, 568, 1000)
await shot('03-computer-root')
// Загрузки: первый значок списка (окно 280,110; список от 284,180; ячейка 96×84)
await click(330, 225, 400)
await shot('04-downloads')
// Вверх → Документы
await click(319, 145, 300)
await click(425, 225, 400)
await shot('05-documents')

// ── 3. Браузер: адрес из блокнота → страница замка ───────────────────
// Пуск → Netscape Navigator.
await click(38, 704, 300)
await click(110, 522, 1500)
// адресная строка: клик выделяет её целиком, дальше печатаем домен
await click(400, 143, 200)
await page.keyboard.type('lockreset.local', { delay: 15 })
await page.keyboard.press('Enter')
await page.waitForTimeout(1300)
result.browserPage = await page.evaluate(() => window.__browser?.page ?? null)
await shot('06-lock-intro')
result.lockIntro = await lock()

// ── 4. Мини-игра: запуск, ход, удары по узлам, перезарядка ───────────
await page.keyboard.press('Space')
await page.waitForTimeout(300)
result.lockRun = await lock()
// ход клавишей: база (2,2) → шаг вправо
await page.keyboard.press('KeyD')
await page.waitForTimeout(150)
result.stepRight = (await lock()).player
await page.evaluate(() => window.__lock.debugJump(2, 2))

const hitAll = async () => {
  const log = []
  for (let guard = 0; guard < 12; guard++) {
    let s = await lock()
    if (!s || s.state !== 'run') break
    if (s.infected.length === 0) break
    if (s.battery < 15) {
      // к серверу и перезарядка: сначала пробуем удар в такт волне
      await page.evaluate(() => window.__lock.debugJump(2, 2))
      await page.evaluate(() => window.__lock.debugClear())
      const recharged = await rechargeAtBase()
      log.push({ recharge: recharged })
    }
    s = await lock()
    const node = s.infected[0]
    await page.evaluate((n) => window.__lock.debugJump(n.col, n.row), node)
    await page.evaluate(() => window.__lock.debugClear())
    for (let i = 0; i < 3; i++) {
      await page.keyboard.press('Space')
      await page.waitForTimeout(140)
    }
    s = await lock()
    log.push({ node, cleared: s.total - s.infected.length, battery: s.battery, state: s.state })
    if (log.length === 1) await shot('06b-lock-fight')
  }
  return log
}

/** Стоя на сервере: ПРОБЕЛ в такт волне; при промахе ждём следующую. */
const rechargeAtBase = async () => {
  for (let i = 0; i < 400; i++) {
    const s = await lock()
    if (s.battery >= 100) return { ok: true, battery: s.battery, frozen: s.frozen }
    if (!s.frozen && s.waveR >= 0 && Math.abs(s.waveR - s.ringR) <= s.ringR * 0.42) {
      await page.keyboard.press('Space')
    }
    await page.waitForTimeout(12)
  }
  return { ok: false, battery: (await lock()).battery }
}

result.fightLog = await hitAll()
result.lockEnd = await lock()

// ── 5. Победа → дверь отперта, девушка побежала ──────────────────────
await page.waitForFunction(
  () => window.__desk?.debugInfo().door === true,
  null,
  { timeout: 8000 },
)
result.deskAfterWin = await desk()
result.tdsAfterWin = await tdsInfo()
result.girlState = await page.evaluate(() => window.__cctv?.state ?? null)
await page.waitForTimeout(600)
await shot('07-lock-won')

// поднимаем окно TDS: кнопка на панели задач
await click(150, 704, 600)
await shot('08-door-open')

// ── 6. Пасхалки: Изображения → dodry.jpg ─────────────────────────────
// tds.exe появляется в «Загрузках» после установки: имитируем установку.
await page.evaluate(() => window.__desk.beginInstall?.())
await page.waitForTimeout(5800)
result.filesWithTds = (await desk()).files
await click(38, 704, 300)
await click(110, 568, 900) // поднять «Мой компьютер» (остался в «Документах»)
await click(377, 145, 300) // Вверх → корень
await click(618, 225, 400) // папка «Изображения»
await shot('09-images-folder')
await click(330, 225, 900) // открыть dodry.jpg (первая в папке)
result.windowsAfterImage = await windows()
await shot('10-image-viewer')

// ── 7. Пасхалка «Музыка»: песенка запускается кликом ─────────────────
await click(455, 704, 400) // поднимаем «Мой компьютер» из панели задач
await click(377, 145, 300) // Вверх → корень
await click(520, 225, 400) // папка «Музыка»
await shot('11-music-folder')
await click(330, 225, 3000) // «песенка для малыша.ogg» → грузится и играет
result.songPlaying = await page.evaluate(() => window.__desk?.sound?.songPlaying ?? null)
await shot('12-song-playing')

console.log(JSON.stringify(result, null, 2))
console.log(errors.length ? `ОШИБКИ:\n${errors.join('\n')}` : 'ошибок в консоли нет')
await browser.close()
