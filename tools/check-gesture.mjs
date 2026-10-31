// Живые жесты поверх мокапа: wave и shiver.
import { chromium } from 'playwright-core'
const browser = await chromium.launch({
  executablePath: '/usr/bin/brave-browser-stable',
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--disable-gpu-sandbox', '--no-sandbox'],
})
const page = await browser.newPage({ viewport: { width: 1300, height: 1000 } })
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
  v.untie()
  v.freeT = 1
  v.freedAt = v.time - 40
  v.girl.position.set(-0.1, 0, -1.1)
  v.prev.set(-0.1, 0, -1.1)
  v.setState('idle')
  v.gestureNext = 1e9
  // пусть смотрит в камеру и машет
  v.gesture = { kind: 'wave', start: v.time - 1.2, dur: 3.8, side: 1 }
})
const shot = (n) => page.screenshot({ path: `/tmp/mocap/${n}.png`, clip: { x: 0, y: 0, width: 1300, height: 990 } })
await page.waitForTimeout(600)
await shot('gesture-wave')
await page.waitForTimeout(4200)
await page.evaluate(() => {
  const v = window.__cctv
  v.gesture = { kind: 'shiver', start: v.time, dur: 1.7, side: -1 }
})
await page.waitForTimeout(800)
await shot('gesture-shiver')
await browser.close()
