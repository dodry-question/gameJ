/**
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║  ИГРОВОЙ СЛОТ — ЕДИНСТВЕННЫЙ ФАЙЛ, ЧЕРЕЗ КОТОРЫЙ МЕНЮ ВИДИТ ИГРУ.    ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 *
 * Игра занимает ВСЮ вкладку браузера: холст Phaser растягивается на весь
 * экран, а HTML-HUD (счёт, кнопка «В меню», оверлеи) плавает сверху.
 *
 * Что здесь происходит:
 *   1) строится HTML-обёртка: холст на весь экран + плавающий HUD + оверлеи;
 *   2) внутрь монтируется Phaser.Game (Scale.RESIZE — холст = размер вкладки);
 *   3) текущий скин (цвета из src/theme/themes.css) пробрасывается в сцену;
 *   4) клавиатура/клик переводятся в вызовы сцене (startRun / onPress / onRelease).
 *
 * СЛОТ НЕ ЗАВИСИТ ОТ КОНКРЕТНОЙ ИГРЫ: он знает только контракт GameSceneApi
 * (src/game/scenes/types.ts). Смена игры = новый файл в scenes/ + строка
 * в scenes/index.ts. Этот файл трогать не нужно.
 */
import Phaser from 'phaser'
import { audio } from '../audio/audio'
import { MAIN_SCENE_KEY, SCENES } from './scenes'
import type { GameSceneApi, SceneColors } from './scenes/types'
import type { GameContext, GameHandle } from './types'

type Phase = 'ready' | 'playing' | 'paused' | 'over'
const BEST_KEY = 'jamgame.best'

function loadBest(): number {
  const raw = Number(localStorage.getItem(BEST_KEY) ?? '0')
  return Number.isFinite(raw) ? Math.max(0, Math.floor(raw)) : 0
}

function saveBest(value: number): void {
  try {
    localStorage.setItem(BEST_KEY, String(value))
  } catch {
    /* приватный режим — просто не сохраняем */
  }
}

/** Достать цвет скина из <html> и перевести #rrggbb → 0xRRGGBB для canvas */
function sceneColor(name: string, fallback: number): number {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  if (!raw.startsWith('#')) return fallback
  const hex = raw.length === 4 ? raw.replace(/#/g, '').replace(/./g, (c) => c + c) : raw.slice(1)
  const n = Number.parseInt(hex, 16)
  return Number.isFinite(n) ? n : fallback
}

function readSceneColors(): SceneColors {
  return {
    bg: sceneColor('--color-bg', 0x0b0e1a),
    accent: sceneColor('--color-accent', 0x4ff2ff),
    accent2: sceneColor('--color-accent-2', 0xff5ed6),
    danger: sceneColor('--color-danger', 0xff4d6d),
    text: sceneColor('--color-text-dim', 0x8b94b8),
    line: sceneColor('--color-line', 0x2c3552),
  }
}

export function mountGame(container: HTMLElement, game: GameContext): GameHandle {
  container.innerHTML = `
    <div class="game">
      <!-- Холст Phaser на всю вкладку -->
      <div class="game-mount" data-el="mount"></div>

      <!-- Плавающий HUD поверх игры -->
      <div class="game-hud">
        <button class="btn btn-ghost hud-back" type="button" data-act="menu">← В меню <span class="kbd">Esc</span></button>
        <div class="game-score">
          <span class="game-score-value" data-el="score">0</span>
          <span class="game-hi">рекорд: <span data-el="hi">0</span></span>
        </div>
      </div>

      <div class="game-overlay" data-el="overlay"></div>

      <p class="game-help">
        <span class="kbd">WASD</span>/<span class="kbd">стрелки</span> — движение ·
        <span class="kbd">P</span> — пауза ·
        <span class="kbd">Esc</span> — в меню
      </p>
    </div>
  `

  const mountEl = container.querySelector<HTMLElement>('[data-el="mount"]')!
  const overlay = container.querySelector<HTMLElement>('[data-el="overlay"]')!
  const scoreEl = container.querySelector<HTMLElement>('[data-el="score"]')
  const hiEl = container.querySelector<HTMLElement>('[data-el="hi"]')
  const menuBtn = container.querySelector<HTMLButtonElement>('[data-act="menu"]')
  const gameEl = container.querySelector<HTMLElement>('.game')

  let phase: Phase = 'ready'
  let best = loadBest()
  let lastScore = 0

  const refreshHud = (score: number): void => {
    if (scoreEl) scoreEl.textContent = String(score)
    if (hiEl) hiEl.textContent = String(best)
  }
  refreshHud(0)

  /* ------------------------------------------------------- Phaser-игра -- */
  const colors = readSceneColors()
  const phaserGame = new Phaser.Game({
    type: Phaser.AUTO,
    parent: mountEl,
    backgroundColor: '#' + colors.bg.toString(16).padStart(6, '0'),
    // arcade-физика: тела, velocity, столкновения — без неё сцены с физикой не стартуют
    physics: {
      default: 'arcade',
      arcade: { gravity: { x: 0, y: 0 }, debug: false },
    },
    scale: {
      mode: Phaser.Scale.RESIZE, // холст = размер вкладки, ресайзится на лету
      autoCenter: Phaser.Scale.NO_CENTER,
      width: mountEl.clientWidth || 960,
      height: mountEl.clientHeight || 600,
    },
    scene: SCENES,
    banner: false,
    audio: { noAudio: true }, // звуком занимается наш src/audio/audio.ts
  })
  // Цвета скина + колбэки для сцен — через registry, доступно любой сцене
  phaserGame.registry.set('jam', {
    colors,
    hooks: {
      onScore: (score: number) => refreshHud(score),
      onGameOver: (score: number) => {
        phase = 'over'
        lastScore = score
        if (score > best) {
          best = score
          saveBest(best)
        }
        refreshHud(score)
        setOverlay()
      },
    },
  })

  const scene = (): (GameSceneApi & Phaser.Scene) | null =>
    (phaserGame.scene.getScene(MAIN_SCENE_KEY) as GameSceneApi & Phaser.Scene) ?? null

  /* --------------------------------------------------------- управление - */
  function startRun(): void {
    phase = 'playing'
    setOverlay()
    audio.play('click')
    scene()?.startRun()
    blurActive()
  }

  function togglePause(): void {
    if (phase === 'playing') {
      phase = 'paused'
      phaserGame.scene.pause(MAIN_SCENE_KEY)
      setOverlay()
    } else if (phase === 'paused') {
      phase = 'playing'
      phaserGame.scene.resume(MAIN_SCENE_KEY)
      setOverlay()
      blurActive()
    }
  }

  function primaryAction(): void {
    if (phase === 'ready' || phase === 'over') startRun()
    else if (phase === 'playing') scene()?.onPress()
    else if (phase === 'paused') togglePause()
  }

  function blurActive(): void {
    const el = document.activeElement as HTMLElement | null
    if (el && el !== document.body) el.blur()
  }

  /* ------------------------------------------------------ оверлей (HTML) */
  function setOverlay(): void {
    if (phase === 'playing') {
      overlay.classList.add('is-hidden')
      overlay.innerHTML = ''
      return
    }
    overlay.classList.remove('is-hidden')

    if (phase === 'ready') {
      overlay.innerHTML = `
        <div class="overlay-card">
          <div class="overlay-title">Уклоняйся</div>
          <div class="overlay-text">Красные кубики падают сверху — уворачивайся. +1 очко за секунду выживания. Своя игра — в <b>src/game/scenes/</b>.</div>
          <div class="overlay-actions">
            <button class="btn btn-primary" type="button" data-go>Начать <span class="kbd">Пробел</span></button>
            <button class="btn" type="button" data-menu>В меню <span class="kbd">Esc</span></button>
          </div>
        </div>`
    } else if (phase === 'paused') {
      overlay.innerHTML = `
        <div class="overlay-card">
          <div class="overlay-title">Пауза</div>
          <div class="overlay-actions">
            <button class="btn btn-primary" type="button" data-go>Продолжить <span class="kbd">P</span></button>
            <button class="btn" type="button" data-menu>В меню <span class="kbd">Esc</span></button>
          </div>
        </div>`
    } else {
      overlay.innerHTML = `
        <div class="overlay-card">
          <div class="overlay-title">Попался!</div>
          <div class="overlay-stats">
            <div class="overlay-stat"><b>${lastScore}</b><span>очки</span></div>
            <div class="overlay-stat"><b>${best}</b><span>рекорд</span></div>
          </div>
          <div class="overlay-actions">
            <button class="btn btn-primary" type="button" data-go>Ещё раз <span class="kbd">Пробел</span></button>
            <button class="btn" type="button" data-menu>В меню <span class="kbd">Esc</span></button>
          </div>
        </div>`
    }

    overlay.querySelector<HTMLButtonElement>('[data-go]')?.addEventListener('click', () => {
      audio.play('click')
      if (phase === 'paused') togglePause()
      else startRun()
    })
    overlay.querySelector<HTMLButtonElement>('[data-menu]')?.addEventListener('click', () => {
      audio.play('back')
      game.onExit()
    })
    overlay.querySelectorAll<HTMLButtonElement>('button').forEach((b) => {
      b.addEventListener('mouseenter', () => audio.play('hover'))
    })
  }

  /* -------------------------------------------------------------- ввод --- */
  const isButtonTarget = (e: KeyboardEvent): boolean => {
    const t = e.target as HTMLElement | null
    return Boolean(t && t.tagName === 'BUTTON' && (e.code === 'Space' || e.code === 'Enter'))
  }

  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.preventDefault()
      audio.play('back')
      game.onExit()
      return
    }
    if (isButtonTarget(e)) return

    if (e.code === 'Space' || e.code === 'Enter') {
      e.preventDefault()
      if (!e.repeat) primaryAction()
    } else if (e.code === 'KeyP') {
      e.preventDefault()
      if (!e.repeat && phase !== 'ready' && phase !== 'over') togglePause()
    }
  }

  const onKeyUp = (e: KeyboardEvent): void => {
    if (e.code === 'Space' || e.code === 'Enter') scene()?.onRelease()
  }

  const onPointerDown = (e: PointerEvent): void => {
    // клик по кнопкам HUD/оверлея не должен стартовать игру
    if ((e.target as HTMLElement).closest('button')) return
    primaryAction()
  }

  const onPointerUp = (): void => scene()?.onRelease()

  const onBlur = (): void => {
    scene()?.onRelease()
    if (phase === 'playing') togglePause()
  }

  const onMenuClick = (): void => {
    audio.play('back')
    game.onExit()
  }

  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('keyup', onKeyUp)
  window.addEventListener('pointerup', onPointerUp)
  window.addEventListener('blur', onBlur)
  gameEl?.addEventListener('pointerdown', onPointerDown)
  menuBtn?.addEventListener('click', onMenuClick)
  menuBtn?.addEventListener('mouseenter', () => audio.play('hover'))

  setOverlay()

  return {
    destroy: () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('pointerup', onPointerUp)
      window.removeEventListener('blur', onBlur)
      gameEl?.removeEventListener('pointerdown', onPointerDown)
      menuBtn?.removeEventListener('click', onMenuClick)
      phaserGame.destroy(true, false) // true — убрать canvas из DOM
      container.innerHTML = ''
    },
  }
}
