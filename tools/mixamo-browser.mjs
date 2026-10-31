// Видимый браузер для Mixamo через локальный xray-прокси.
// Запуск: node tools/mixamo-browser.mjs
// Профиль живёт в .mixamo-profile/ — логин Adobe сохраняется между запусками.
// Скачанные клипы падают в public/cctv/anims/. CDP для внешнего управления:
// http://127.0.0.1:9222
import { chromium } from 'playwright-core'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const profile = join(root, '.mixamo-profile')
const anims = join(root, 'public', 'cctv', 'anims')
mkdirSync(anims, { recursive: true })

const context = await chromium.launchPersistentContext(profile, {
  headless: false,
  executablePath: '/usr/bin/brave-browser-stable',
  proxy: { server: 'http://127.0.0.1:10809' },
  viewport: null,
  args: [
    '--start-maximized',
    '--enable-unsafe-swiftshader',
    '--disable-gpu-sandbox',
    '--lang=ru',
    '--remote-debugging-port=9222',
  ],
  acceptDownloads: true,
})

const page = context.pages()[0] ?? (await context.newPage())
page.on('download', async (d) => {
  const to = join(anims, d.suggestedFilename())
  try {
    await d.saveAs(to)
    console.log('СКАЧАНО:', to)
  } catch (e) {
    console.log('ОШИБКА СКАЧИВАНИЯ:', e)
  }
})
page.on('pageerror', (e) => console.log('PAGEERROR:', e))

await page.goto('https://www.mixamo.com/', { waitUntil: 'domcontentloaded' })
console.log('ОТКРЫТО: https://www.mixamo.com/ — жди логина и работай')

// держим процесс живым
await new Promise(() => {})
