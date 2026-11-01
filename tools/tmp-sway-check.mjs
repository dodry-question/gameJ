// Фазы концовки: кадры в начале мешка, в конце (голова к потолку) и чёрный.
import { chromium } from 'playwright-core'
const browser = await chromium.launch({
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--autoplay-policy=no-user-gesture-required'],
})
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
page.on('pageerror', (e) => console.log('[pageerror]', String(e)))
await page.goto('http://127.0.0.1:5199/?ending', { waitUntil: 'networkidle' })
await page.mouse.click(640, 400)
await page.waitForFunction(() => window.__cctv?.loaded === true, null, { timeout: 30000 })
await page.waitForTimeout(5600) // bag: ~1.2s в фазе
await page.screenshot({ path: 'C:/Users/dodry/AppData/Local/Temp/opencode/bag-sway.png' })
await page.waitForTimeout(3200) // bag: ~4.4s — голова к потолку
await page.screenshot({ path: 'C:/Users/dodry/AppData/Local/Temp/opencode/bag-up.png' })
await page.waitForFunction(() => window.__desk?.girlDead === true, null, { timeout: 25000 })
await page.waitForTimeout(2600)
await page.screenshot({ path: 'C:/Users/dodry/AppData/Local/Temp/opencode/ending-final.png' })
console.log('ok')
await browser.close()
