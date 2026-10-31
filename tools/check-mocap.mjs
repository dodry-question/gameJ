// Сценарная проверка мокап-слоя, часть 2: брожение и бег серией кадров.
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
  // отвязать давно: сценарий больше не тащит к двери
  v.untie()
  v.freeT = 1
  v.freedAt = v.time - 40
  v.setState('pace')
  v.gestureNext = 1e9
  v.gesture = null
  v.girl.position.set(-0.3, 0, -0.3)
  v.prev.set(-0.3, 0, -0.3)
})
const shot = (n) => page.screenshot({ path: `/tmp/mocap/${n}.png`, clip: { x: 0, y: 0, width: 1300, height: 990 } })

// брожение: 4 кадра
for (let i = 0; i < 4; i++) {
  await page.waitForTimeout(1100)
  await shot(`pace-${i}`)
}
// бег: 4 кадра
await page.evaluate(() => {
  const v = window.__cctv
  v.setState('run')
  v.targetX = 0.4
  v.targetZ = -3.2
})
for (let i = 0; i < 4; i++) {
  await page.waitForTimeout(700)
  await shot(`run-${i}`)
}
const st = await page.evaluate(() => {
  const v = window.__cctv
  return {
    state: v.girlState,
    speed: +v.speed.toFixed(2),
    walkTs: v.actions.get('walk') ? +v.actions.get('walk').timeScale.toFixed(2) : null,
    runTs: v.actions.get('run') ? +v.actions.get('run').timeScale.toFixed(2) : null,
    pos: { x: +v.girlPos.x.toFixed(2), z: +v.girlPos.z.toFixed(2) },
  }
})
console.log('итог:', JSON.stringify(st))
console.log('ошибки страницы:', errors.length ? errors.slice(0, 4) : 'нет')
await browser.close()
