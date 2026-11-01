// Кино провала: накопленный поворот корпуса (unwrap) — вращения быть не должно.
import { chromium } from 'playwright-core'
const browser = await chromium.launch({
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--autoplay-policy=no-user-gesture-required'],
})
const page = await browser.newPage({ viewport: { width: 1000, height: 760 } })
page.on('pageerror', (e) => console.log('[pageerror]', String(e)))
await page.goto('http://127.0.0.1:5199/?ui&pairs', { waitUntil: 'networkidle' })
await page.mouse.click(480, 360)
await page.waitForFunction(() => window.__cctv?.loaded === true, null, { timeout: 30000 })
await page.waitForTimeout(600)
await page.evaluate(() => window.__pairs.debugStart())
await page.waitForTimeout(400)
const btns = await page.evaluate(() => window.__pairs.debugButtons())
await page.mouse.click(btns.pause.x, btns.pause.y)
await page.waitForFunction(() => window.__cctv.attackNow >= 0, null, { timeout: 20000 })

let prevRoot = null, prevSpine = null, accR = 0, accS = 0, shot = false
for (let i = 0; i < 60; i++) {
  const st = await page.evaluate(() => ({
    attack: window.__cctv.attackNow,
    bones: window.__cctv.debugBones(),
  }))
  if (st.attack >= 0 && st.attack < 6.5) {
    const unwrap = (prev, cur) => {
      if (prev === null) return 0
      let d = cur - prev
      d -= Math.round(d / (Math.PI * 2)) * Math.PI * 2
      return Math.abs(d)
    }
    accR += unwrap(prevRoot, st.bones.root)
    accS += unwrap(prevSpine, st.bones.Spine)
    prevRoot = st.bones.root
    prevSpine = st.bones.Spine
    if (!shot && st.attack > 2.5) {
      shot = true
      await page.screenshot({ path: 'C:/Users/dodry/AppData/Local/Temp/opencode/fail-mid.png', clip: { x: 0, y: 0, width: 960, height: 720 } })
    }
  }
  await page.waitForTimeout(110)
}
console.log('накопленный поворот root:', accR.toFixed(2), 'rad · spine:', accS.toFixed(2), 'rad')
await browser.close()
