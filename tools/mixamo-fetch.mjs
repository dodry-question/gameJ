// Загрузка одного клипа с Mixamo в публичную папку игры.
// Запуск: node tools/mixamo-fetch.mjs <запрос> <точное имя плитки> [inplace]
//   node tools/mixamo-fetch.mjs running Running inplace
// Требует запущенного tools/mixamo-browser.mjs (CDP :9222) и логина.
import { chromium } from 'playwright-core'

const [query, title, inplace] = process.argv.slice(2)
const DIR = '/home/dodry/Документы/prog/gameJ/public/cctv/anims'

const b = await chromium.connectOverCDP('http://127.0.0.1:9222')
const session = await b.newBrowserCDPSession()
await session.send('Browser.setDownloadBehavior', {
  behavior: 'allow',
  downloadPath: DIR,
  eventsEnabled: true,
})
session.on('Browser.downloadWillBegin', (e) => console.log('НАЧАЛО:', e.suggestedFilename))

const ctx = b.contexts()[0]
// закрыть пустые попап-вкладки от прошлых скачиваний
for (const p of ctx.pages()) if (p.url() === 'about:blank') await p.close().catch(() => {})
const page = ctx.pages().find((p) => p.url().includes('mixamo'))

// поиск: fill/press работают без клика (клик перекрыт оверлеем жанров)
const search = page.getByPlaceholder('Search')
await search.fill(query)
await search.press('Enter')
await page.waitForTimeout(4500)
const typed = await page.evaluate(() => document.querySelector('input[type=search]')?.value)
console.log('в поле:', JSON.stringify(typed))

// имена плиток результатов
const titles = await page.evaluate(() =>
  [...document.querySelectorAll('*')]
    .filter((e) => e.children.length === 0 && e.offsetParent !== null)
    .map((e) => e.textContent.trim())
    .filter((t) => t && t.length < 40 && !/^(Download|Cancel|Mirror|In Place|Overdrive|Trim|Character Arm-Space|frames|total|Showing.*)$/i.test(t)),
)
console.log('НАЙДЕНО:', JSON.stringify([...new Set(titles)].slice(0, 14)))

if (title === '?') process.exit(0)

// кликаем ровно по заголовку плитки (клик всплывает на карточку)
const pt = await page.evaluate((t) => {
  const el = [...document.querySelectorAll('*')]
    .filter((e) => e.textContent.trim() === t && e.children.length === 0)
    .pop()
  if (!el) return null
  el.scrollIntoView({ block: 'center' })
  const r = el.getBoundingClientRect()
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
}, title)
if (!pt) {
  console.log('ПЛИТКА НЕ НАЙДЕНА:', title)
  process.exit(1)
}
await page.waitForTimeout(1200) // после прокрутки
await page.mouse.click(pt.x, pt.y)
await page.waitForTimeout(3000)
const sel = await page.evaluate(() => {
  const els = [...document.querySelectorAll('*')].filter((e) =>
    e.textContent.trim().toUpperCase().endsWith('ON X BOT'),
  )
  const el = els.sort((a, b) => b.textContent.length - a.textContent.length)[0]
  return el ? el.textContent.trim() : '(заголовок не найден)'
})
console.log('ВЫБРАНО:', sel)
if (!sel.toUpperCase().includes(title.toUpperCase())) {
  console.log('КЛИК ПО ПЛИТКЕ ПРОМАХНУЛСЯ — прерываю, файл качать нельзя')
  process.exit(1)
}

if (inplace === 'inplace') {
  const box = await page.evaluate(() => {
    const el = [...document.querySelectorAll('*')].find(
      (e) => e.children.length === 0 && e.textContent.trim() === 'In Place' && e.offsetParent !== null,
    )
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { x: r.x - 12, y: r.y + r.height / 2 }
  })
  if (box) {
    await page.mouse.click(box.x, box.y)
    await page.waitForTimeout(800)
    console.log('In Place отмечен')
  } else {
    console.log('In Place НЕ НАЙДЕН (не локомоция?)')
  }
}

await page.mouse.click(859, 125) // DOWNLOAD справа
await page.waitForTimeout(2000)
const s = page.locator('select')
if ((await s.count()) >= 5) {
  await s.nth(2).selectOption({ label: 'Without Skin' })
  await s.nth(3).selectOption({ label: '30' })
  await s.nth(4).selectOption({ label: 'none' })
  await s.nth(1).selectOption({ label: 'FBX Binary(.fbx)' })
  console.log('настройки диалога ок')
}
await page.mouse.click(750, 355) // DOWNLOAD в диалоге
console.log('жду файл...')

const fs = await import('node:fs')
const before = fs.readdirSync(DIR)
for (let i = 0; i < 25; i++) {
  await page.waitForTimeout(2000)
  const added = fs.readdirSync(DIR).filter((f) => !before.includes(f))
  if (added.length) {
    console.log('СКАЧАНО:', added.join(', '))
    process.exit(0)
  }
}
console.log('ТАЙМАУТ: файл не пришёл')
process.exit(1)
