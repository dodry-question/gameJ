/**
 * РОУТЕР ЭКРАНОВ — переключает меню / настройки / об игре / игру.
 * Каждый экран — функция, которая заполняет переданный контейнер и (опционально)
 * возвращает функцию очистки (убрать слушатели, остановить игру).
 *
 * Переход: старый экран «уходит» (60мс), потом новый «приходит» (110мс).
 * Всё снаппи — никаких долгих затуханий.
 * Переменная token спасает от гонок, если нажать кнопку несколько раз подряд.
 */
import { mountGame } from '../game'
import type { GameHandle } from '../game/types'
import { renderAbout } from './about'
import { renderMenu } from './menu'
import { renderSettings } from './settingsScreen'

export type ScreenName = 'menu' | 'settings' | 'about' | 'game'

type Cleanup = () => void

let host: HTMLElement | null = null
let cleanup: Cleanup | null = null
let token = 0

export function initScreens(el: HTMLElement): void {
  host = el
}

const wait = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms))

function render(name: ScreenName, root: HTMLElement): Cleanup | void {
  switch (name) {
    case 'menu':
      return renderMenu(root)
    case 'settings':
      return renderSettings(root)
    case 'about':
      return renderAbout(root)
    case 'game': {
      const handle: GameHandle = mountGame(root, {
        onExit: () => {
          void show('menu')
        },
      })
      return () => handle.destroy()
    }
  }
}

export async function show(name: ScreenName): Promise<void> {
  if (!host) return
  const mine = ++token

  // 1. старый экран мгновенно «уходит» (60мс — снаппи, без долгих затуханий)
  host.classList.add('is-leaving')
  await wait(60)
  if (mine !== token || !host) return

  host.classList.remove('is-leaving')

  // 2. только теперь выгружаем его (слушатели, игра, таймеры)
  if (cleanup) {
    try {
      cleanup()
    } catch {
      /* экран мог упасть при очистке — мешать переходу не должно */
    }
    cleanup = null
  }
  host.innerHTML = ''

  const done = render(name, host)
  cleanup = typeof done === 'function' ? done : null

  host.classList.add('is-entering')
  const el = host
  el.addEventListener('animationend', () => el.classList.remove('is-entering'), { once: true })
  window.setTimeout(() => el.classList.remove('is-entering'), 250)
  el.focus({ preventScroll: true })
}
