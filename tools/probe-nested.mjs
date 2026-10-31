// Симуляция сайта джема: билд открыт из вложенного пути, камера обязана ожить.
import { chromium } from 'playwright-core'
import { mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const out = join(tmpdir(), 'opencode', 'nested')
mkdirSync(out, { recursive: true })
const browser = await chromium.launch({
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle'],
})
const page = await browser.newPage({ viewport: { width: 1000, height: 760 } })
const errors = []
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
page.on('pageerror', (e) => errors.push(String(e)))
await page.goto('http://127.0.0.1:8077/games/dodry/thedeadstroach/?ui&cam&kitchen', { waitUntil: 'networkidle' })
await page.waitForTimeout(1500)
// женщина должна загрузиться с вложенного пути
await page.waitForFunction(() => window.__cctv?.loaded === true, null, { timeout: 25000 })
  .then(() => console.log('cctv loaded: true'))
  .catch(async () => console.log('cctv loaded: FALSE —', await page.evaluate(() => window.__cctv?.loaded)))
// открываем эфир камеры 04 и снимаем кадр
await page.click(38, 704).catch(() => {})
await page.waitForTimeout(300)
await page.click(110, 522, ).catch(() => {})
await page.waitForTimeout(3000)
await page.screenshot({ path: `${out}/feed-nested.png`, clip: { x: 0, y: 0, width: 960, height: 720 } })
console.log('ошибок в консоли:', errors.length ? errors.join(' | ') : 'нет')
await browser.close()
