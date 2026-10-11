/**
 * СЧЁТЧИК FPS — маленький бейдж в углу экрана.
 *
 * Зачем: проверка производительности («душит ли Phaser слабый ПК»).
 * Как включить: Настройки → Интерфейс → «Показывать FPS». Значение
 * сохраняется в localStorage и переживает перезагрузку.
 *
 * Реализация: обычный requestAnimationFrame-цикл считает кадры за окно
 * ~0.5 сек и обновляет текст. Никакой зависимости от игры — работает
 * и в меню, и в игре.
 */
import { getSettings, onSettingsChange } from '../settings/settings'

export function initFpsCounter(): void {
  const el = document.createElement('div')
  el.className = 'fps'
  el.setAttribute('aria-hidden', 'true')
  document.body.append(el)

  let frames = 0
  let windowStart = performance.now()

  const loop = (now: number): void => {
    frames += 1
    const elapsed = now - windowStart
    if (elapsed >= 500) {
      const fps = Math.round((frames * 1000) / elapsed)
      el.textContent = `${fps} FPS`
      frames = 0
      windowStart = now
    }
    requestAnimationFrame(loop)
  }
  requestAnimationFrame(loop)

  const apply = (): void => {
    el.classList.toggle('is-on', getSettings().showFps)
  }
  apply()
  onSettingsChange(apply)
}
