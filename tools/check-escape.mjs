// Проверка роста (бёдра в покое под клипами) и видимого побега в коридор.
import { chromium } from 'playwright-core'
const browser = await chromium.launch({
  executablePath: '/usr/bin/brave-browser-stable',
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--disable-gpu-sandbox', '--no-sandbox'],
})
const page = await browser.newPage({ viewport: { width: 1300, height: 1000 } })
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
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
})
const shot = (n) => page.screenshot({ path: `/tmp/mocap/${n}.png`, clip: { x: 0, y: 0, width: 1300, height: 990 } })
const hips = () => page.evaluate(() => +window.__cctv.bones.get('Hips').position.y.toFixed(1))

// 1. у двери: она должна стоять в полный рост, бёдра не провалены
await page.evaluate(() => { window.__cctv.untie() })
await page.waitForTimeout(5200)
await shot('fix-door-height')
console.log('бёдра у двери (клип idle):', await hips())

// 2. побег: открыть дверь, смотреть, как она уходит по коридору в проём
await page.evaluate(() => {
  const v = window.__cctv
  v.release()
  v.girl.position.set(0, 0, -2.2)
  v.prev.set(0, 0, -2.2)
  v.setState('run')
})
for (const [i, ms] of [1400, 1600, 1800, 2000].entries()) {
  await page.waitForTimeout(ms)
  await shot(`fix-escape-${i}`)
  const st = await page.evaluate(() => {
    const v = window.__cctv
    return `${v.girlState} z=${v.girlPos ? v.girlPos.z.toFixed(1) : '—'}`
  })
  console.log(`кадр ${i}:`, st)
}
console.log('ошибки страницы:', errors.length ? errors.slice(0, 4) : 'нет')
await browser.close()
