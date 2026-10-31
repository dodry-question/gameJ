import { chromium } from 'playwright-core'
const browser = await chromium.launch({
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--autoplay-policy=no-user-gesture-required'],
})
const page = await browser.newPage({ viewport: { width: 1000, height: 760 } })
page.on('pageerror', (e) => console.log('[pageerror]', String(e)))
page.on('console', (m) => { if (m.type() === 'error') console.log('[err]', m.text()) })
await page.goto('http://127.0.0.1:5199/?ui&cam&kitchen', { waitUntil: 'networkidle' })
await page.mouse.click(480, 360)
await page.waitForFunction(() => window.__cctv?.loaded === true, null, { timeout: 30000 })
await page.waitForFunction(() => window.__cctv.girlState === 'kitchen', null, { timeout: 45000 })
await page.evaluate(() => window.__tds.reset())
await page.waitForTimeout(300)
const n5 = await page.evaluate(() => window.__tds.debugInfo().cam05)
await page.mouse.move(n5.x, n5.y)
await page.mouse.down()
await page.waitForTimeout(1700)
await page.mouse.up()
await page.waitForTimeout(400)
console.log('до клика:', JSON.stringify(await page.evaluate(() => window.__tds.debugInfo().error)))
await page.mouse.click(480, 360)
await page.waitForTimeout(300)
console.log('сразу после клика:', JSON.stringify(await page.evaluate(() => ({
  err: window.__tds.debugInfo().error,
  windows: window.__desk.windows.map((w) => w.key),
  pending: !!window.__desk.pending,
  note: (window.__desk.noteText || '').slice(-80),
}))))
await page.waitForTimeout(2500)
console.log('через 2.5с:', JSON.stringify(await page.evaluate(() => ({
  windows: window.__desk.windows.map((w) => w.key),
  note: (window.__desk.noteText || '').slice(-80),
}))))
await browser.close()
