// Проба состояния «стучит»: переводит девушку в knock и печатает мировые
// координаты кистей относительно корпуса + делает скриншот фида.
//   node tools/probe-knock.mjs [url]
import { chromium } from 'playwright-core'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const url = process.argv[2] ?? 'http://127.0.0.1:5175/?ui&cam'
const out = join(tmpdir(), 'opencode', 'knock')

const browser = await chromium.launch({
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle'],
})
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } })
page.on('pageerror', (e) => console.error('PAGEERROR', String(e)))
await page.goto(url, { waitUntil: 'networkidle' })
await page.waitForTimeout(1500)

// TDS открыт сразу через ?ui&cam: браузерный пролог больше не нужен.
await page.waitForTimeout(1500)

await page.evaluate(() => {
  const c = window.__cctv
  const t0 = performance.now()
  const wait = () => {
    if (!c.loaded && performance.now() - t0 < 12000) return setTimeout(wait, 100)
    c.freedAt = c.time - 7.2
    c.freeT = 1
    c.setState('knock')
  }
  wait()
})
await page.waitForTimeout(2200)

const info = await page.evaluate(() => {
  const c = window.__cctv
  const V = c.girl.position.constructor
  const get = (n) => {
    const b = c.bones.get(n)
    if (!b) return null
    const v = new V()
    b.getWorldPosition(v)
    return { x: +v.x.toFixed(3), y: +v.y.toFixed(3), z: +v.z.toFixed(3) }
  }
  return {
    state: c.state,
    pos: { x: +c.girl.position.x.toFixed(3), z: +c.girl.position.z.toFixed(3) },
    hips: get('Hips'),
    head: get('Head'),
    handL: get('LeftHand'),
    handR: get('RightHand'),
    footL: get('LeftFoot'),
    footR: get('RightFoot'),
  }
})
console.log(JSON.stringify(info, null, 2))

// Крупный кадр
await page.evaluate(() => {
  const src = document.querySelector('canvas')
  const crop = { x: 264, y: 202, w: 354, h: 264 }
  const over = document.createElement('canvas')
  over.width = crop.w * 3
  over.height = crop.h * 3
  over.style.cssText = 'position:fixed;left:8px;top:8px;z-index:9999;image-rendering:pixelated'
  const ctx = over.getContext('2d')
  ctx.imageSmoothingEnabled = false
  const tick = () => {
    ctx.drawImage(src, crop.x, crop.y, crop.w, crop.h, 0, 0, over.width, over.height)
    requestAnimationFrame(tick)
  }
  tick()
  document.body.appendChild(over)
})
await page.waitForTimeout(200)
await page.screenshot({ path: `${out}/knock.png`, clip: { x: 0, y: 0, width: 1080, height: 810 } })
console.log(`скриншот: ${out}/knock.png`)
await browser.close()
