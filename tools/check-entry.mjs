// Вход в кухню с точки зрения КАМ-05.
import { chromium } from 'playwright-core'
const browser = await chromium.launch({
  executablePath: '/usr/bin/brave-browser-stable',
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--disable-gpu-sandbox', '--no-sandbox'],
})
const page = await browser.newPage({ viewport: { width: 1300, height: 1000 } })
await page.goto('http://127.0.0.1:5199/?ui&cam', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(4500)
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
  v.untie()
  v.freeT = 1
  v.girl.position.set(0, 0, -2.2)
  v.prev.set(0, 0, -2.2)
  v.setState('run')
  v.gestureNext = 1e9
})
const shot = (n) => page.screenshot({ path: `/tmp/mocap/${n}.png`, clip: { x: 0, y: 0, width: 1300, height: 990 } })
for (const [i, ms] of [2600, 900, 1200, 1500].entries()) {
  await page.waitForTimeout(ms)
  const st = await page.evaluate(() => {
    const v = window.__cctv
    return `${v.girlState} z=${v.girlPos ? v.girlPos.z.toFixed(1) : '—'} x=${v.girlPos ? v.girlPos.x.toFixed(1) : '—'}`
  })
  console.log(`кадр ${i}:`, st)
  await shot(`entry-${i}`)
}
await browser.close()
