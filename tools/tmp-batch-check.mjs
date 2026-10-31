// Проверка пакета: карта, камера 01 из угла, TAB-скан доски, чтение,
// окно ошибки питания → блокнот с адресом.
import { chromium } from 'playwright-core'
import { mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const out = join(tmpdir(), 'opencode', 'batch')
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
await page.goto('http://127.0.0.1:5199/?ui&cam', { waitUntil: 'networkidle' })
await page.mouse.click(480, 360)
await page.waitForFunction(() => window.__cctv?.loaded === true, null, { timeout: 30000 })
await page.waitForTimeout(1200)
const shot = (name) => page.screenshot({ path: `${out}/${name}.png`, clip: { x: 0, y: 0, width: 960, height: 720 } })

// ── 1. новая карта ─────────────────────────────────────────────────
await page.evaluate(() => window.__tds.reset())
await page.waitForTimeout(500)
await shot('map-new')

// ── 2. пост охраны с нового ракурса ────────────────────────────────
await page.evaluate(() => window.__tds.forceChannel('01'))
await page.waitForTimeout(900)
await shot('post-view')

// ── 3. TAB-скан: рамка на доске ────────────────────────────────────
await page.keyboard.press('Tab')
await page.waitForTimeout(400)
await shot('post-scan')

// ── 4. клик по доске → чтение ──────────────────────────────────────
const target = await page.evaluate(() => {
  const tds = window.__tds
  const info = tds.debugInfo()
  const f = info.feed
  const p = window.__cctv.project('board')
  if (!f || !p) return null
  return { x: f.x + (p.x / 320) * f.w, y: f.y + (p.y / 240) * f.h }
})
if (target) {
  await page.mouse.click(target.x, target.y)
  await page.waitForTimeout(400)
  await shot('board-read')
  await page.mouse.click(target.x, target.y) // закрыть
  await page.waitForTimeout(200)
}

// ── 5. окно ошибки → блокнот ───────────────────────────────────────
await page.evaluate(() => {
  window.__cctv.debugToKitchen()
})
await page.waitForFunction(() => window.__cctv.girlState === 'kitchen', null, { timeout: 40000 })
await page.evaluate(() => window.__tds.reset())
await page.waitForTimeout(400)
const n5 = await page.evaluate(() => window.__tds.debugInfo().cam05)
await page.mouse.move(n5.x, n5.y)
await page.mouse.down()
await page.waitForTimeout(1700) // удержание 700 + подключение 600 + запас
await page.mouse.up()
await page.waitForTimeout(500)
const st1 = await page.evaluate(() => window.__tds.debugInfo())
console.log('после попытки:', JSON.stringify(st1))
await shot('power-error')
await page.mouse.click(480, 360) // закрыть окно ошибки
await page.waitForTimeout(2200) // блокнот «открывается с диска»
const note = await page.evaluate(() => ({
  noteOpen: window.__desk.windows.some((w) => w.key === 'notepad'),
  text: (window.__desk.noteText || '').includes('power.local'),
}))
console.log('блокнот:', JSON.stringify(note))
await shot('note-power')

console.log('ошибок страницы:', errors.length ? errors.join(' | ') : 'нет')
await browser.close()
