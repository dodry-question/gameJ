// Серия кадров по состояниям девушки: посадка, подъём, жесты, стук.
// Управляет состоянием через __cctv, чтобы не ждать случайный сценарий.
//   node tools/shot-states.mjs [url] [outDir]
import { chromium } from 'playwright-core'
import { mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const url = process.argv[2] ?? 'http://127.0.0.1:5175/?ui'
const out = process.argv[3] ?? join(tmpdir(), 'opencode', 'states')
mkdirSync(out, { recursive: true })

const browser = await chromium.launch({
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle'],
})
const page = await browser.newPage({ viewport: { width: 1200, height: 900 } })
const errors = []
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text())
})
page.on('pageerror', (e) => errors.push(String(e)))

await page.goto(url, { waitUntil: 'networkidle' })
await page.waitForTimeout(1500)

const click = async (x, y, wait = 600) => {
  await page.mouse.move(x, y, { steps: 4 })
  await page.mouse.down()
  await page.mouse.up()
  await page.waitForTimeout(wait)
}
await click(55, 137, 60)
await page.mouse.down()
await page.mouse.up()
await page.waitForTimeout(1900)
await click(400, 141, 400)
await page.keyboard.type('http://192.168.0.13/cam04', { delay: 15 })
await page.keyboard.press('Enter')
await page.waitForTimeout(2600)

// Камера у стула, кадр камеры крупно поверх страницы.
await page.evaluate(() => {
  const v = window.__cctv
  v.camera.position.set(0.35, 1.5, 1.1)
  v.camera.lookAt(-0.62, 0.75, -0.85)
  v.camera.fov = 46
  v.camera.updateProjectionMatrix()
  const feed = v.canvas
  const over = document.createElement('canvas')
  over.width = 320 * 4
  over.height = 240 * 4
  over.style.cssText = 'position:fixed;left:8px;top:8px;z-index:9999;image-rendering:pixelated;border:2px solid #444'
  const ctx = over.getContext('2d')
  ctx.imageSmoothingEnabled = false
  const tick = () => {
    ctx.drawImage(feed, 0, 0, 320, 240, 0, 0, over.width, over.height)
    requestAnimationFrame(tick)
  }
  tick()
  document.body.appendChild(over)
})

const shot = async (name) => {
  await page.screenshot({ path: `${out}/${name}.png`, clip: { x: 0, y: 0, width: 1290, height: 975 } })
}

const setState = (fn) => page.evaluate(fn)

// 1. Привязана к стулу.
await setState(() => {
  const v = window.__cctv
  v.gesture = null
  v.gestureNext = 1e9
  v.freeT = 0
  v.setState('tied')
  v.girl.position.set(-0.6, -0.42, -0.9)
  v.yaw = v.yawTarget = 0.15
  v.girl.rotation.y = 0.15
})
await page.waitForTimeout(700)
await shot('01-tied')
await page.waitForTimeout(600)
await shot('02-tied')

// 2. Подъём: сбрасываем freeT и снимаем, пока встаёт.
await setState(() => {
  const v = window.__cctv
  v.freeT = 0
  v.freedAt = v.time
  v.setState('pace')
})
for (let i = 0; i < 5; i++) {
  await page.waitForTimeout(240)
  await shot(`1${i + 1}-rise`)
}

// 3. Стоит и машет камере.
await setState(() => {
  const v = window.__cctv
  v.setState('idle')
  v.targetX = -0.6
  v.targetZ = -1.2
  v.gesture = { kind: 'wave', start: v.time, dur: 3.8, side: 1 }
  v.gestureNext = 1e9
})
await page.waitForTimeout(900)
await shot('21-wave-a')
await page.waitForTimeout(450)
await shot('22-wave-b')
await page.waitForTimeout(450)
await shot('23-wave-c')

// 4. Стучит в дверь.
await setState(() => {
  const v = window.__cctv
  v.gesture = null
  v.freeT = 1
  v.freedAt = v.time - 7.2
  v.setState('knock')
})
await page.waitForTimeout(1600)
await shot('31-knock')
await page.waitForTimeout(300)
await shot('32-knock')

// 5. Стоит с опущенными руками.
await setState(() => {
  const v = window.__cctv
  v.gesture = null
  v.gestureNext = 1e9
  v.freeT = 1
  v.setState('idle')
  v.targetX = -0.6
  v.targetZ = -1.2
})
await page.waitForTimeout(900)
await shot('41-stand')

console.log(errors.length ? `ОШИБКИ:\n${errors.join('\n')}` : 'ошибок в консоли нет')
console.log('состояние:', await page.evaluate(() => window.__cctv?.state))
await browser.close()
