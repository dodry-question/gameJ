// Проба осей позы: куда смотрит поднятая рука при разных yaw.
//   node tools/probe-arm.mjs [url]
import { chromium } from 'playwright-core'

const url = process.argv[2] ?? 'http://127.0.0.1:5175/?ui&cam'
const browser = await chromium.launch({
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle'],
})
const page = await browser.newPage({ viewport: { width: 1200, height: 900 } })
await page.goto(url, { waitUntil: 'networkidle' })
await page.waitForTimeout(1500)
// TDS открыт сразу через ?ui&cam: браузерный пролог больше не нужен.
await page.waitForTimeout(2600)

const result = await page.evaluate(() => {
  const v = window.__cctv
  v.gesture = null
  v.gestureNext = 1e9
  v.freeT = 1
  v.animate = () => {}
  v.girl.position.set(0, 0, -1)
  const STAND = {
    Spine: [0.05, 0, 0],
    Head: [0, 0, 0],
    LeftArm: [0, 0, 0.08],
    RightArm: [0, 0, -0.08],
    LeftForeArm: [-0.18, 0, 0],
    RightForeArm: [-0.18, 0, 0],
  }
  const pos = (name) => {
    const b = v.bones.get(name)
    const p = new b.position.constructor()
    b.getWorldPosition(p)
    return { x: +p.x.toFixed(2), y: +p.y.toFixed(2), z: +p.z.toFixed(2) }
  }
  const test = (label, yaw, arm, fore) => {
    v.yaw = yaw
    v.girl.rotation.y = yaw
    v.applyPose({ ...STAND, RightArm: arm, RightForeArm: fore })
    v.girl.updateMatrixWorld(true)
    const s = pos('RightArm')
    const h = pos('RightHand')
    return { label, yaw: +yaw.toFixed(2), shoulder: s, hand: h, dir: { x: +(h.x - s.x).toFixed(2), y: +(h.y - s.y).toFixed(2), z: +(h.z - s.z).toFixed(2) } }
  }
  return [
    test('yaw0 arm fwd', 0, [-1.0, 0, -0.32], [-0.78, 0, 0]),
    test('yaw90 arm fwd', Math.PI / 2, [-1.0, 0, -0.32], [-0.78, 0, 0]),
    test('yaw180 arm fwd', Math.PI, [-1.0, 0, -0.32], [-0.78, 0, 0]),
    test('yaw0 knock', 0, [-1.42, 0, -0.16], [-0.28, 0, 0]),
    test('yaw180 knock', Math.PI, [-1.42, 0, -0.16], [-0.28, 0, 0]),
  ]
})
console.log(JSON.stringify(result, null, 2))
await browser.close()
