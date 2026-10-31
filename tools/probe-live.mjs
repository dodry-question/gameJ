// Прод-сайт: камера грузится, ?pairs открывает мини-игру.
import { chromium } from 'playwright-core'
import { mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const out = join(tmpdir(), 'opencode', 'live')
mkdirSync(out, { recursive: true })
const browser = await chromium.launch({
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle'],
})
const page = await browser.newPage({ viewport: { width: 1000, height: 760 } })
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
await page.goto('https://thedestroyer-9p8f.zai-ai.site/?ui&cam&pairs', { waitUntil: 'networkidle' })
await page.waitForFunction(() => window.__cctv?.loaded === true, null, { timeout: 30000 })
  .then(() => console.log('cctv loaded: true'))
  .catch(() => console.log('cctv loaded: FALSE'))
await page.waitForFunction(() => window.__browser?.page === 'pairs', null, { timeout: 20000 })
  .then(() => console.log('pairs page: true'))
  .catch(() => console.log('pairs page: FALSE'))
await page.waitForTimeout(2500)
await page.screenshot({ path: `${out}/live.png`, clip: { x: 0, y: 0, width: 960, height: 720 } })
console.log('ошибок:', errors.length ? errors.join(' | ') : 'нет')
await browser.close()
