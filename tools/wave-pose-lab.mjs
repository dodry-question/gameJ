// Лаборатория жеста «машет»: одна сессия, много поз, по кадру на позу.
//   node tools/wave-pose-lab.mjs [url] [outDir]
import { chromium } from 'playwright-core'
import { mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const url = process.argv[2] ?? 'http://127.0.0.1:5175/?ui'
const out = process.argv[3] ?? join(tmpdir(), 'opencode', 'wavelab')
mkdirSync(out, { recursive: true })

const browser = await chromium.launch({
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle'],
})
const page = await browser.newPage({ viewport: { width: 1300, height: 1000 } })
page.on('pageerror', (e) => console.error('pageerror', String(e)))
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

await page.evaluate(() => {
  const v = window.__cctv
  v.gesture = null
  v.gestureNext = 1e9
  v.freeT = 1
  v.setState('idle')
  v.girl.position.set(-0.35, 0, -0.35)
  v.prev.set(-0.35, 0, -0.35)
  const yaw = Math.atan2(1.7 - -0.35, 1.4 - -0.35)
  v.yaw = v.yawTarget = yaw
  v.girl.rotation.y = yaw
  v.narrative = () => {}
  v.gestures = () => {}
  v.move = () => {}
  v.animate = () => {}
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

const candidates = [
  ['61-y06', [0, 0.6, -1.1], [0, 0, -1.4], [0, 0, 0.5]],
  ['62-y06-fy08', [0, 0.6, -1.1], [0, 0.8, -1.4], [0, 0, 0.5]],
  ['63-y06-fy-08', [0, 0.6, -1.1], [0, -0.8, -1.4], [0, 0, 0.5]],
  ['64-y08-fy06', [0, 0.8, -1.1], [0, 0.6, -1.4], [0, 0, 0.5]],
  ['65-fy14', [0, 0.6, -1.1], [0, 1.4, -1.4], [0, 0, 0.5]],
  ['66-fy-14', [0, 0.6, -1.1], [0, -1.4, -1.4], [0, 0, 0.5]],
  ['67-y04', [0, 0.4, -1.2], [0, 0.8, -1.5], [0, 0, 0.5]],
  ['68-y04b', [0, 0.4, -1.2], [0, -0.8, -1.5], [0, 0, 0.5]],
  ['69-hand-y', [0, 0, -1.12], [0, 0, -1.4], [0, 1.0, 0]],
  ['70-hand-z', [0, 0, -1.12], [0, 0, -1.4], [0, 0, 1.2]],
]

const metrics = []
for (const [name, arm, fore, hand] of candidates) {
  const m = await page.evaluate(
    ({ arm, fore, hand }) => {
      const v = window.__cctv
      const p = {
        Spine: [0.05, 0, 0],
        Head: [0, 0, 0],
        LeftArm: [0, 0, 0.08],
        RightArm: arm,
        LeftForeArm: [-0.18, 0, 0],
        RightForeArm: fore,
        RightHand: hand,
        LeftUpLeg: [0, 0.02, 0.02],
        RightUpLeg: [0, -0.02, -0.02],
      }
      v.applyPose(p)
      v.girl.updateMatrixWorld(true)
      const pos = (n) => {
        const b = v.bones.get(n)
        const q = new b.position.constructor()
        b.getWorldPosition(q)
        return { x: +q.x.toFixed(2), y: +q.y.toFixed(2), z: +q.z.toFixed(2) }
      }
      const h = pos('RightHand')
      const e = pos('RightForeArm')
      const s = pos('RightArm')
      const head = pos('Head')
      const cam = v.constructor.CAM.pos
      const toCam = { x: cam[0] - h.x, y: cam[1] - h.y, z: cam[2] - h.z }
      return { hand: h, elbow: e, shoulder: s, head, toCam }
    },
    { arm, fore, hand },
  )
  metrics.push({ name, ...m })
  await page.waitForTimeout(450)
  await page.screenshot({ path: `${out}/${name}.png`, clip: { x: 380, y: 180, width: 600, height: 640 } })
}

console.log(JSON.stringify(metrics, null, 2))
await browser.close()
