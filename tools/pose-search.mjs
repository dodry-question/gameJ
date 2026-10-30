// Поиск позы рук численно: применяет позу сидя, меряет мировые координаты
// кистей/локтей/колен и перебирает углы плеча и локтя, пока кисти не лягут
// на колени, а локти не уйдут из торса. Печатает лучшие варианты.
//   node tools/pose-search.mjs [url]
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
await page.waitForTimeout(2500)

const result = await page.evaluate(() => {
  const v = window.__cctv
  if (!v) return { error: 'нет __cctv' }
  // Останавливаем процедурную анимацию: дальше позу ставим руками.
  v.animate = () => {}

  const SIT = {
    Spine: [0.14, 0.02, 0],
    Head: [0.06, 0, 0],
    LeftUpLeg: [-1.45, 0.1, 0.06],
    RightUpLeg: [-1.45, -0.1, -0.06],
    LeftLeg: [1.35, 0, 0],
    RightLeg: [1.35, 0, 0],
    LeftFoot: [0.1, 0, 0],
    RightFoot: [0.1, 0, 0],
  }

  const pos = (name) => {
    const b = v.bones.get(name)
    if (!b) return null
    const p = new (b.position.constructor)()
    b.getWorldPosition(p)
    return { x: p.x, y: p.y, z: p.z }
  }

  const sample = (arm) => {
    const p = { ...SIT }
    p.LeftArm = [arm.x, arm.y, arm.z]
    p.RightArm = [arm.x, -arm.y, -arm.z]
    p.LeftForeArm = [arm.fx, arm.fy, 0]
    p.RightForeArm = [arm.fx, -arm.fy, 0]
    p.LeftHand = [0, 0, 0]
    p.RightHand = [0, 0, 0]
    v.applyPose(p)
    v.girl.updateMatrixWorld(true)
    return {
      handL: pos('LeftHand'),
      handR: pos('RightHand'),
      elbowL: pos('LeftForeArm'),
      shoulderL: pos('LeftArm'),
      kneeL: pos('LeftLeg'),
      kneeR: pos('RightLeg'),
      hips: pos('Hips'),
      spine: pos('Spine'),
      head: pos('Head'),
    }
  }

  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)
  const current = sample({ x: -0.48, y: 0.06, z: -1.3, fx: -0.5, fy: 0.12 })

  // цель: кисти над коленями, чуть выше и ближе к корпусу
  const knee = current.kneeL
  const target = { x: knee.x * 0.72, y: knee.y + 0.1, z: knee.z + 0.02 }

  const best = []
  const xs = [-0.4, -0.2, 0, 0.2, 0.4, 0.6]
  const ys = [-0.4, -0.2, 0, 0.2, 0.4]
  const zs = [-1.45, -1.3, -1.15, -1.0, -0.85]
  const fxs = [-1.0, -0.7, -0.4, -0.1, 0.2, 0.5]
  const fys = [-0.2, 0, 0.2]
  for (const x of xs)
    for (const y of ys)
      for (const z of zs)
        for (const fx of fxs)
          for (const fy of fys) {
            const s = sample({ x, y, z, fx, fy })
            const d = dist(s.handL, target) + dist(s.handL, s.handR) * 0.25
            // локоть не должен быть в торсе: либо сбоку, либо впереди
            const elbowIn = s.elbowL.x > -0.22 && s.elbowL.z > s.hips.z - 0.1 ? 1 : 0
            // кисть не выше локтя — иначе руки сложены на груди
            const high = s.handL.y > s.elbowL.y + 0.02 ? 1 : 0
            best.push({ x, y, z, fx, fy, d: d + elbowIn * 0.5 + high * 0.4, d0: d })
          }
  best.sort((a, b) => a.d - b.d)
  return { current, target, top: best.slice(0, 12) }
})

console.log(JSON.stringify(result, null, 2))
await browser.close()
