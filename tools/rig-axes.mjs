// Калибровка осей скелета: для ключевых костей проверяет, как поворот вокруг
// каждой локальной оси смещает дочернюю кость в мире. Печатает, какая ось
// поднимает бедро вперёд (посадка), опускает/выносит вперёд руку и т.п.
//   node tools/rig-axes.mjs [url]
import { chromium } from 'playwright-core'

const url = process.argv[2] ?? 'http://127.0.0.1:5175/?ui'

const browser = await chromium.launch({
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle'],
})
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } })
page.on('pageerror', (e) => console.error('PAGEERROR', String(e)))
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
await page.waitForTimeout(1500)

const table = await page.evaluate(async () => {
  const cctv = window.__cctv
  if (!cctv) return 'нет __cctv'
  const t0 = performance.now()
  while (!cctv.loaded && performance.now() - t0 < 10000) {
    await new Promise((r) => setTimeout(r, 100))
  }
  if (!cctv.loaded) return 'модель не загрузилась'

  // доступ к three через прототипы не нужен — работаем с объектами напрямую
  const bones = cctv.bones
  const girl = cctv.girl
  const V = girl.position.constructor // THREE.Vector3
  const Q = girl.quaternion.constructor // THREE.Quaternion

  const yaw = girl.rotation.y
  const fwd = new V(Math.sin(yaw), 0, Math.cos(yaw))
  const right = new V(Math.cos(yaw), 0, -Math.sin(yaw))

  const sample = (boneName, childName, camount) => {
    const bone = bones.get(boneName)
    const child = bones.get(childName)
    if (!bone || !child) return null
    const rest = bone.quaternion.clone()
    const world = (b) => {
      const v = new V()
      b.getWorldPosition(v)
      return v
    }
    // базовая точка — мировая позиция дочерней кости
    girl.updateMatrixWorld(true)
    const base = world(child)
    const out = []
    for (const ax of ['x', 'y', 'z']) {
      for (const sign of [1, -1]) {
        const axis = new V(ax === 'x' ? 1 : 0, ax === 'y' ? 1 : 0, ax === 'z' ? 1 : 0)
        const dq = new Q()
        dq.setFromAxisAngle(axis, camount * sign)
        bone.quaternion.copy(rest).multiply(dq)
        girl.updateMatrixWorld(true)
        const now = world(child)
        const d = now.sub(base)
        out.push({
          ax,
          sign,
          fwd: +d.dot(fwd).toFixed(3),
          up: +d.y.toFixed(3),
          right: +d.dot(right).toFixed(3),
        })
      }
    }
    bone.quaternion.copy(rest)
    girl.updateMatrixWorld(true)
    return out
  }

  const rows = []
  const pairs = [
    ['LeftUpLeg', 'LeftLeg'],
    ['RightUpLeg', 'RightLeg'],
    ['LeftLeg', 'LeftFoot'],
    ['LeftArm', 'LeftForeArm'],
    ['RightArm', 'RightForeArm'],
    ['LeftForeArm', 'LeftHand'],
    ['Spine', 'Head'],
  ]
  for (const [p, c] of pairs) {
    const res = sample(p, c, 0.7)
    rows.push(`${p} → ${c}:`)
    if (!res) {
      rows.push('  нет костей')
      continue
    }
    for (const r of res) {
      rows.push(`  ${r.ax}${r.sign > 0 ? '+' : '-'}  fwd=${r.fwd}  up=${r.up}  right=${r.right}`)
    }
  }
  return rows.join('\n')
})

console.log(table)
await browser.close()
