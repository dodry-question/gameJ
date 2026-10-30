// Подбор позы «машет рукой»: правый локоть согнут, кисть у головы, ладонь
// смотрит в камеру. Перебирает углы плеча/предплечья и печатает лучшие позы.
//   node tools/wave-search.mjs [url]
import { chromium } from 'playwright-core'

const url = process.argv[2] ?? 'http://127.0.0.1:5175/?ui'
const browser = await chromium.launch({
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle'],
})
const page = await browser.newPage({ viewport: { width: 1200, height: 900 } })
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

const result = await page.evaluate(() => {
  const v = window.__cctv
  if (!v) return { error: 'нет __cctv' }
  v.gesture = null
  v.gestureNext = 1e9
  v.freeT = 1
  v.setState('idle')
  v.targetX = -0.6
  v.targetZ = -1.2
  v.girl.position.set(-0.6, 0, -1.2)
  v.yaw = v.yawTarget = 0
  v.girl.rotation.y = 0
  v.animate = () => {}

  const STAND = {
    Spine: [0.05, 0, 0],
    Head: [0, 0, 0],
    LeftArm: [0, 0, 0.08],
    RightArm: [0, 0, -0.08],
    LeftForeArm: [-0.18, 0, 0],
    RightForeArm: [-0.18, 0, 0],
    LeftUpLeg: [0, 0.02, 0.02],
    RightUpLeg: [0, -0.02, -0.02],
    LeftLeg: [0.03, 0, 0],
    RightLeg: [0.03, 0, 0],
  }

  const pos = (name) => {
    const b = v.bones.get(name)
    const p = new (b.position.constructor)()
    b.getWorldPosition(p)
    return { x: p.x, y: p.y, z: p.z }
  }

  const sample = (az, ax, fx, fz) => {
    const p = { ...STAND }
    p.RightArm = [ax, 0, az]
    p.RightForeArm = [fx, 0, fz]
    p.RightHand = [0, 0, 0]
    v.applyPose(p)
    v.girl.updateMatrixWorld(true)
    return {
      hand: pos('RightHand'),
      elbow: pos('RightForeArm'),
      shoulder: pos('RightArm'),
      head: pos('Head'),
      spine: pos('Spine'),
      hips: pos('Hips'),
    }
  }

  const head = sample(-0.08, 0, -0.18, 0).head
  const rows = []
  for (const az of [-1.9, -1.8, -1.7, -1.6, -1.5, -1.4, -1.3, -1.2])
    for (const ax of [-0.5, -0.3, -0.1, 0, 0.1, 0.3])
      for (const fx of [-0.9, -0.7, -0.5, -0.3, -0.1, 0.1])
        for (const fz of [-1.4, -1.2, -1.0, -0.8, -0.6, -0.4, -0.2, 0]) {
          const s = sample(az, ax, fx, fz)
          if (!s.hand || !s.elbow) continue
          // кисть у головы: по высоте чуть ниже макушки, сбоку на 0.2-0.45 м
          const dy = s.hand.y - s.head.y
          const horiz = Math.hypot(s.hand.x - s.head.x, s.hand.z - s.head.z)
          // локоть ниже кисти хотя бы на 15 см и не в торсе
          const bent = s.elbow.y < s.hand.y - 0.15
          const elbowOut =
            Math.abs(s.elbow.x - s.spine.x) > 0.16 ||
            Math.abs(s.elbow.z - s.spine.z) > 0.2
          // кисть чуть спереди головы (в сторону камеры: камера с +z)
          const front = s.hand.z > s.head.z - 0.05
          const score =
            Math.abs(dy + 0.03) * 2 +
            Math.abs(horiz - 0.3) * 1.5 +
            (bent ? 0 : 0.5) +
            (elbowOut ? 0 : 0.6) +
            (front ? 0 : 0.6)
          rows.push({ az, ax, fx, fz, score, hand: s.hand, elbow: s.elbow, head: s.head })
        }
  rows.sort((a, b) => a.score - b.score)
  return { head, top: rows.slice(0, 10) }
})

console.log(JSON.stringify(result, null, 2))
await browser.close()
