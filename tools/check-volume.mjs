// Проверка регулятора громкости и шагов за спиной:
// открывает рабочий стол, кликает динамик, тянет ползунок, ловит создание
// HRTF-паннеров (шаги) и проверяет, что скрип больше не грузится.
//   node tools/check-volume.mjs [url]
import { chromium } from 'playwright-core'
import { mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const url = process.argv[2] ?? 'http://127.0.0.1:5175/?ui'
const out = join(tmpdir(), 'opencode', 'volume')
mkdirSync(out, { recursive: true })

const browser = await chromium.launch({
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--autoplay-policy=no-user-gesture-required'],
})
const page = await browser.newPage({ viewport: { width: 1000, height: 780 } })
const errors = []
const requests = []
page.on('pageerror', (e) => errors.push(String(e)))
page.on('request', (r) => requests.push(r.url()))

await page.goto(url, { waitUntil: 'networkidle' })
await page.waitForTimeout(700)

// Ускоряем таймеры и считаем паннеры, чтобы услышать (увидеть) шаги.
await page.evaluate(() => {
  const orig = window.setTimeout
  window.setTimeout = (fn, d, ...a) => orig(fn, Math.min(Number(d) || 0, 250), ...a)
  window.__panners = 0
  const ctor = window.AudioContext
  const create = ctor.prototype.createPanner
  ctor.prototype.createPanner = function (...a) {
    window.__panners++
    return create.apply(this, a)
  }
})

const shot = async (name) => {
  await page.screenshot({ path: `${out}/${name}.png`, clip: { x: 0, y: 0, width: 960, height: 720 } })
}
await shot('01-taskbar')

// Клик по динамику и перетаскивание ползунка на 40%.
await page.mouse.click(883, 704)
await page.waitForTimeout(250)
await shot('02-popup')

await page.mouse.move(857, 620)
await page.mouse.down()
await page.mouse.move(857, 618, { steps: 4 })
await page.mouse.up()
await page.waitForTimeout(250)
await shot('03-lowered')

const info = await page.evaluate(() => ({
  stored: localStorage.getItem('sound.volume'),
  panners: window.__panners,
}))
console.log('localStorage:', info.stored, '| паннеров за 1.5 с:', info.panners)
console.log('creak.mp3 запрашивался:', requests.some((u) => u.includes('creak')))
console.log(errors.length ? `ОШИБКИ:\n${errors.join('\n')}` : 'ошибок в консоли нет')
await browser.close()
