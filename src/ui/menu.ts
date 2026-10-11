/**
 * ГЛАВНОЕ МЕНЮ.
 * Кнопки объявлены в data-action: play → игра, settings → настройки, about → об игре.
 * Хочешь добавить кнопку? Добавь <button data-action="..."> в разметку и имя
 * экрана в ACTIONS ниже (экран должен быть объявлен в screens.ts).
 */
import { audio } from '../audio/audio'
import { GAME } from '../config'
import { show } from './screens'
import type { ScreenName } from './screens'

const ACTIONS: Record<string, ScreenName> = {
  play: 'game',
  settings: 'settings',
  about: 'about',
}

export function renderMenu(root: HTMLElement): () => void {
  root.innerHTML = `
    <div class="menu">
      <header class="menu-head">
        <h1 class="logo-title">${GAME.title}</h1>
        <span class="logo-accent" aria-hidden="true"></span>
        <p class="logo-tag">${GAME.tagline}</p>
        <!--
          КОГДА-НИБУДЬ (не сейчас): сюда встанет арт игры — растянется на фон
          правой колонки/всего меню и совместится с заголовком. Пока это макет,
          рисовать заглушку не нужно — место под арт держит эта колонка.
        -->
      </header>

      <div class="menu-side">
        <nav class="menu-list" aria-label="Главное меню">
          <button class="btn btn-primary" type="button" data-action="play">
            Играть <span class="kbd">Enter</span>
          </button>
          <button class="btn" type="button" data-action="settings">Настройки</button>
          <button class="btn" type="button" data-action="about">Об игре</button>
        </nav>

        <p class="menu-hint">Tab / стрелки — навигация, Enter — выбрать</p>

        <footer class="menu-footer">
          <span class="tag">v${GAME.version}</span>
          <span>движок: ${GAME.engine}</span>
        </footer>
      </div>
    </div>
  `

  const buttons = Array.from(root.querySelectorAll<HTMLButtonElement>('[data-action]'))
  const onClick = (e: MouseEvent) => {
    const btn = e.currentTarget as HTMLButtonElement
    const target = ACTIONS[btn.dataset.action ?? '']
    if (!target) return
    audio.play('click')
    void show(target)
  }
  const onHover = () => audio.play('hover')

  // Стрелки ↑/↓ — переключение между пунктами меню (Tab тоже работает)
  const onKeydown = (e: KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    const i = buttons.indexOf(document.activeElement as HTMLButtonElement)
    if (i === -1) return
    e.preventDefault()
    audio.play('hover')
    const next = (i + (e.key === 'ArrowDown' ? 1 : buttons.length - 1)) % buttons.length
    buttons[next]?.focus({ preventScroll: true })
  }

  buttons.forEach((btn) => {
    btn.addEventListener('click', onClick)
    btn.addEventListener('mouseenter', onHover)
  })
  window.addEventListener('keydown', onKeydown)

  // фокус на «Играть», чтобы Enter сразу работал
  window.requestAnimationFrame(() => buttons[0]?.focus({ preventScroll: true }))

  return () => {
    window.removeEventListener('keydown', onKeydown)
    buttons.forEach((btn) => {
      btn.removeEventListener('click', onClick)
      btn.removeEventListener('mouseenter', onHover)
    })
  }
}
