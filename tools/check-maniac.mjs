// Кино провала: маньяк с мокап-ходьбой и выпадом. Скриншоты по фазам.
import { chromium } from 'playwright-core'
const browser = await chromium.launch({
  executablePath: '/usr/bin/brave-browser-stable',
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--disable-gpu-sandbox', '--no-sandbox'],
})
const page = await browser.newPage({ viewport: { width: 1300, height: 1000 } })
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
await page.goto('http://127.0.0.1:5199/?ui&cam', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(4200)
await page.evaluate(() => {
  const v = window.__cctv
  const over = document.createElement('canvas')
  over.width = 320 * 4
  over.height = 240 * 4
  over.style.cssText = 'position:fixed;left:8px;top:8px;z-index:9999;image-rendering:pixelated;border:2px solid #444'
  const ctx = over.getContext('2d')
  ctx.imageSmoothingEnabled = false
  const tick = () => {
    ctx.drawImage(v.canvas, 0, 0, 320, 240, 0, 0, over.width, over.height)
    requestAnimationFrame(tick)
  }
  tick()
  document.body.appendChild(over)
  v.setView('05')
  v.debugToKitchen()
  v.freeT = 1
})
const st0 = await page.evaluate(() => ({
  maniacClips: [...window.__cctv.maniacActions.keys()],
  state: window.__cctv.girlState,
}))
console.log('клипы маньяка:', JSON.stringify(st0))
const shot = (n) => page.screenshot({ path: `/tmp/mocap/${n}.png`, clip: { x: 0, y: 0, width: 1300, height: 990 } })
// ждать, пока дойдёт до кухни
await page.waitForTimeout(5200)
await page.evaluate(() => { window.__cctv.maniacAttack() })
for (let i = 0; i < 6; i++) {
  await page.waitForTimeout(1300)
  await shot(`maniac-${i}`)
}
await shot('maniac-final')
console.log('ошибки страницы:', errors.length ? errors.slice(0, 4) : 'нет')
await browser.close()
