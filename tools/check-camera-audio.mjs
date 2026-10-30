// Проверка звуков с камеры: голос не грузится до открытия страницы, шина
// камеры открывается на CAM_LEVEL, капли и голос реально стартуют, а после
// закрытия страницы шина гаснет и таймеры молчат.
//   node tools/check-camera-audio.mjs [url]
import { chromium } from 'playwright-core'

const url = process.argv[2] ?? 'http://127.0.0.1:5175/?ui'

const browser = await chromium.launch({
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle'],
})
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } })
const errors = []
const responses = []
page.on('pageerror', (e) => errors.push(String(e)))
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text())
})
page.on('response', (r) => {
  if (r.url().includes('sounds/voice/')) responses.push({ url: r.url(), status: r.status() })
})

await page.addInitScript(() => {
  window.__reqs = []
  window.__buf = []
  window.__osc = []
  window.__gains = []

  const of = window.fetch
  window.fetch = function (...a) {
    try {
      const u = String(typeof a[0] === 'string' ? a[0] : a[0]?.url ?? '')
      window.__reqs.push({ u, t: performance.now() })
    } catch {
      /* не мешаем */
    }
    return of.apply(this, a)
  }

  const P = window.AudioContext.prototype
  const cg = P.createGain
  P.createGain = function () {
    const g = cg.call(this)
    window.__gains.push({ g, t: performance.now(), init: g.gain.value })
    return g
  }

  const BS = window.AudioBufferSourceNode.prototype
  const bs = BS.start
  BS.start = function (when, offset, dur) {
    window.__buf.push({
      t: performance.now(),
      when: when ?? 0,
      offset: offset ?? 0,
      dur: dur ?? null,
      loop: this.loop,
      bufDur: this.buffer ? this.buffer.duration : 0,
      ctxT: this.context.currentTime,
    })
    return bs.apply(this, arguments)
  }

  const OS = window.OscillatorNode.prototype
  const os = OS.start
  OS.start = function (when) {
    window.__osc.push({ t: performance.now(), f: this.frequency.value })
    return os.apply(this, arguments)
  }
})

await page.goto(url, { waitUntil: 'networkidle' })
await page.waitForTimeout(1500)

const click = async (x, y, wait = 600) => {
  await page.mouse.move(x, y, { steps: 4 })
  await page.mouse.down()
  await page.mouse.up()
  await page.waitForTimeout(wait)
}

// Интернет → адрес камеры
await click(55, 137, 60)
await page.mouse.down()
await page.mouse.up()
await page.waitForTimeout(1900)
await click(400, 141, 400)

const beforeOpen = await page.evaluate(() => ({
  t: performance.now(),
  voiceReqs: window.__reqs.filter((r) => r.u.includes('sounds/voice/')).length,
}))

await page.keyboard.type('http://192.168.0.13/cam04', { delay: 15 })
await page.keyboard.press('Enter')
const opened = await page.evaluate(() => performance.now())

// Ждём: капли идут через 1–3 с, голос — через 8–17 с
const gains = []
for (let i = 0; i < 17; i++) {
  await page.waitForTimeout(1000)
  gains.push(
    await page.evaluate(() => {
      const v = window.__gains
        .map((x, i) => ({ i, v: +x.g.gain.value.toFixed(4) }))
        .filter((x) => x.v > 0.001 && x.v < 0.75)
      return { t: performance.now(), v }
    }),
  )
}

const whileOpen = await page.evaluate(
  ([openedT, beforeT]) => {
    const reqs = window.__reqs.filter((r) => r.t >= beforeT)
    const buf = window.__buf.filter((b) => b.t >= openedT)
    const osc = window.__osc.filter((o) => o.t >= openedT)
    return {
      voiceReqs: reqs.filter((r) => r.u.includes('sounds/voice/')).map((r) => r.u),
      voiceAll: window.__reqs
        .filter((r) => r.u.includes('sounds/voice/'))
        .map((r) => ({ u: r.u, at: +((r.t - openedT) / 1000).toFixed(1) })),
      reqCount: reqs.length,
      loopStarts: buf.filter((b) => b.loop).map((b) => +b.bufDur.toFixed(2)),
      loopsAll: window.__buf.filter((b) => b.loop && Math.abs(b.bufDur - 0.4) < 0.01).length,
      dripOsc: osc.filter((o) => o.f >= 300 && o.f <= 1500).length,
      dripOscAt: osc
        .filter((o) => o.f >= 300 && o.f <= 1500)
        .map((o) => +((o.t - openedT) / 1000).toFixed(1)),
      dripNoise: buf.filter((b) => !b.loop && b.bufDur < 3).length,
      voiceStarts: buf
        .filter((b) => !b.loop && b.bufDur >= 3)
        .map((b) => ({
          at: +((b.t - openedT) / 1000).toFixed(1),
          dur: +b.bufDur.toFixed(2),
          played: +Math.min(b.dur ?? b.bufDur - b.offset, b.bufDur - b.offset).toFixed(2),
        })),
    }
  },
  [opened, beforeOpen.t],
)

// Закрываем страницу камеры: другой адрес в том же браузере
await click(400, 141, 200)
await page.keyboard.type('http://intranet.local/', { delay: 10 })
await page.keyboard.press('Enter')
await page.waitForTimeout(1600)
const closed = await page.evaluate(() => performance.now())
const gatesClosed = await page.evaluate(() =>
  window.__gains
    .map((x, i) => ({ i, v: +x.g.gain.value.toFixed(4) }))
    .filter((x) => x.v > 0.001 && x.v < 0.75),
)

// Тишина после закрытия: новых капель и голоса быть не должно
await page.waitForTimeout(5000)
const afterClose = await page.evaluate(
  ([closedT]) => {
    const buf = window.__buf.filter((b) => b.t >= closedT)
    const osc = window.__osc.filter((o) => o.t >= closedT)
    return {
      starts: buf.length,
      voice: buf.filter((b) => b.bufDur >= 3).length,
      drips: osc.filter((o) => o.f >= 300 && o.f <= 1500).length,
      noise: buf.filter((b) => !b.loop && b.bufDur < 3).length,
    }
  },
  [closed],
)

const perNode = new Map()
for (const s of gains) for (const x of s.v) perNode.set(x.i, Math.max(perNode.get(x.i) ?? 0, x.v))
console.log('До открытия камеры (запросов голоса):', beforeOpen.voiceReqs)
console.log('ответы голоса:', responses.length ? JSON.stringify(responses) : 'нет')
console.log('ПРИ ОТКРЫТОЙ КАМЕРЕ')
console.log('  загрузка голоса:', JSON.stringify(whileOpen.voiceAll), '| всего fetch:', whileOpen.reqCount)
console.log('  запросы с адресом голоса после открытия:', whileOpen.voiceReqs.length ? whileOpen.voiceReqs.join(', ') : 'нет')
console.log('  петли гула (длит. буфера):', whileOpen.loopStarts.join(', '), '| петель шума всего:', whileOpen.loopsAll)
console.log('  капли: осцилляторов', whileOpen.dripOsc, '| шумовых всплесков', whileOpen.dripNoise, '| когда:', JSON.stringify(whileOpen.dripOscAt))
console.log('  голосовые отрывки:', JSON.stringify(whileOpen.voiceStarts))
console.log('  громкость шин (узлы с 0.001…0.75):', JSON.stringify([...perNode].map(([i, v]) => `${i}:${v}`)))
console.log('  после закрытия:', JSON.stringify(gatesClosed.map((x) => `${x.i}:${x.v}`)))
console.log('ПОСЛЕ ЗАКРЫТИЯ')
console.log('  новые старты за 5 с:', JSON.stringify(afterClose))
console.log(errors.length ? `ОШИБКИ:\n${errors.join('\n')}` : 'ошибок в консоли нет')
await browser.close()
