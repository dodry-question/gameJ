import { chromium } from 'playwright-core'
const browser = await chromium.launch({
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--autoplay-policy=no-user-gesture-required'],
})
const page = await browser.newPage({ viewport: { width: 1000, height: 760 } })
await page.goto('http://127.0.0.1:5199/?ui&cam', { waitUntil: 'networkidle' })
await page.mouse.click(480, 360)
await page.waitForFunction(() => window.__cctv?.loaded === true, null, { timeout: 30000 })
await page.waitForTimeout(500)
console.log(await page.evaluate(() => ({
  power: window.__cctv.powerReady,
  search: location.search,
  hasMap: !!window.__tds,
})))
await browser.close()
