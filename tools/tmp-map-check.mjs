// Карта по эскизу: вид узлов после выпуска, закрытые двери, ошибка при попытке.
import { chromium } from 'playwright-core'
import { mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const out = join(tmpdir(), 'opencode', 'map2')
mkdirSync(out, { recursive: true })
const browser = await chromium.launch({
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--autoplay-policy=no-user-gesture-required'],
})
const page = await browser.newPage({ viewport: { width: 1000, height: 760 } })
page.on('pageerror', (e) => console.log('[pageerror]', String(e)))
await page.goto('http://127.0.0.1:5199/?ui&cam', { waitUntil: 'networkidle' })
await page.mouse.click(480, 360)
await page.waitForFunction(() => window.__cctv?.loaded === true, null, { timeout: 30000 })
await page.waitForTimeout(900)
const shot = (name) => page.screenshot({ path: `${out}/${name}.png`, clip: { x: 0, y: 0, width: 960, height: 720 } })

// до выпуска: 01 — НЕТ ПИТАНИЯ, 05 — НЕТ СВЯЗИ
await page.evaluate(() => window.__tds.reset())
await page.waitForTimeout(400)
await shot('map-tied')
console.log('привязана:', JSON.stringify(await page.evaluate(() => ({
  s01: window.__desk ? null : null,
}))))

// выпускаем: 01 и 05 должны выглядеть «В СЕТИ»
await page.evaluate(() => window.__cctv.untie())
await page.waitForTimeout(600)
await shot('map-freed')

// попытка на 05: окно ошибки → блокнот
const n5 = await page.evaluate(() => window.__tds.debugInfo().cam05)
await page.mouse.move(n5.x, n5.y)
await page.mouse.down()
await page.waitForTimeout(1700)
await page.mouse.up()
await page.waitForTimeout(500)
console.log('ошибка после попытки на 05:', JSON.stringify(await page.evaluate(() => window.__tds.debugInfo().error)))
await shot('error-05')
await page.mouse.click(480, 360)
await page.waitForTimeout(2400)
console.log('блокнот:', JSON.stringify(await page.evaluate(() => ({
  open: window.__desk.windows.some((w) => w.key === 'notepad'),
  ok: (window.__desk.noteText || '').includes('power.local'),
}))))
await browser.close()
