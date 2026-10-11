/**
 * ЭКРАН НАСТРОЕК.
 * Каждая строка = название + объяснение «что это вообще делает» + управляющий.
 * Все значения читаются/пишутся через src/settings/settings.ts, поэтому
 * экран всегда показывает актуальное состояние (в т.ч. после «Сбросить»).
 */
import { audio } from '../audio/audio'
import { onSettingsChange, getSettings, resetSettings, updateSettings } from '../settings/settings'
import type { Settings } from '../settings/settings'
import { SKINS } from '../theme/theme'
import { show } from './screens'

type NumericKey = 'sfx' | 'music'
type ToggleKey = 'reduceMotion' | 'showFps'

export function renderSettings(root: HTMLElement): () => void {
  root.innerHTML = `
    <div class="page">
      <div class="page-head">
        <button class="btn btn-ghost" type="button" data-act="back">← Меню <span class="kbd">Esc</span></button>
        <h1 class="page-title">Настройки</h1>
        <p class="page-sub">Сохраняется в браузере (localStorage) — переживает перезагрузку страницы.</p>
      </div>

      <section class="panel">
        <div class="section-title">Оформление</div>
        <p class="section-hint">
          Скин — это «одежда» интерфейса: цвета, шрифты, форма кнопок и фон.
          Меняется в один файле — <code>src/theme/themes.css</code>, новый скин
          появляется здесь автоматически.
        </p>
        <div class="swatches" data-el="skins"></div>
      </section>

      <section class="panel">
        <div class="section-title">Звук</div>

        <div class="row">
          <div class="row-title">Эффекты</div>
          <div class="row-hint">Короткие звуки: клик по кнопке, прыжок, столкновение, «рекорд». 0% — тишина.</div>
          <div class="row-control">
            <input class="range" type="range" min="0" max="100" step="5" data-set="sfx" aria-label="Громкость эффектов" />
            <span class="range-value" data-val="sfx">—</span>
          </div>
        </div>

        <div class="row">
          <div class="row-title">Музыка</div>
          <div class="row-hint">Фоновая петля (синтезируется в браузере, аудиофайлов нет). 0% — только эффекты.</div>
          <div class="row-control">
            <input class="range" type="range" min="0" max="100" step="5" data-set="music" aria-label="Громкость музыки" />
            <span class="range-value" data-val="music">—</span>
          </div>
        </div>
      </section>

      <section class="panel">
        <div class="section-title">Интерфейс</div>

        <div class="row">
          <div class="row-title">Меньше анимаций</div>
          <div class="row-hint">Выключает движущийся фон и плавные переходы. Включай, если ПК слабый или движения укачивают.</div>
          <div class="row-control">
            <button class="switch" type="button" role="switch" data-toggle="reduceMotion" aria-label="Меньше анимаций"></button>
          </div>
        </div>

        <div class="row">
          <div class="row-title">Показывать FPS</div>
          <div class="row-hint">Маленький счётчик кадров в углу экрана — для проверки производительности (сколько кадров в секунду рисует игра).</div>
          <div class="row-control">
            <button class="switch" type="button" role="switch" data-toggle="showFps" aria-label="Показывать FPS"></button>
          </div>
        </div>

        <div class="row">
          <div class="row-title">Полный экран</div>
          <div class="row-hint">Разворачивает игру на весь монитор (как F11 в браузере, только без адресной строки).</div>
          <div class="row-control">
            <button class="btn btn-sm" type="button" data-act="fullscreen" data-el="fs">Во весь экран</button>
          </div>
        </div>

        <div class="row">
          <div class="row-title">Сброс настроек</div>
          <div class="row-hint">Вернуть всё как было: цвета, громкости, анимации.</div>
          <div class="row-control">
            <button class="btn btn-sm" type="button" data-act="reset">Сбросить</button>
          </div>
        </div>
      </section>

      <p class="page-sub">Хочешь свой стиль? Скопируй блок в <code>src/theme/themes.css</code>, переименуй id — и он появится в списке выше.</p>
    </div>
  `

  const skinsBox = root.querySelector<HTMLElement>('[data-el="skins"]')
  if (skinsBox) {
    skinsBox.innerHTML = SKINS.map(
      (skin) => `
        <button class="swatch" type="button" data-skin="${skin.id}" data-theme="${skin.id}" aria-pressed="false">
          <span class="swatch-preview">
            <span class="dot dot-1"></span><span class="dot dot-2"></span><span class="dot dot-3"></span>
          </span>
          <span class="swatch-name">${skin.name}</span>
          <span class="swatch-note">${skin.note}</span>
          <span class="swatch-mark" data-mark="${skin.id}"></span>
        </button>
      `,
    ).join('')
  }

  const backBtn = root.querySelector<HTMLButtonElement>('[data-act="back"]')
  const resetBtn = root.querySelector<HTMLButtonElement>('[data-act="reset"]')
  const fsBtn = root.querySelector<HTMLButtonElement>('[data-el="fs"]')
  const ranges = Array.from(root.querySelectorAll<HTMLInputElement>('input.range'))
  const switches = Array.from(root.querySelectorAll<HTMLButtonElement>('[data-toggle]'))
  const swatches = Array.from(root.querySelectorAll<HTMLButtonElement>('[data-skin]'))

  /** Перерисовать все управляющие по текущим настройкам */
  const refresh = (s: Settings) => {
    ranges.forEach((input) => {
      const key = input.dataset.set as NumericKey
      const percent = Math.round(s[key] * 100)
      input.value = String(percent)
      input.style.setProperty('--range-fill', `${percent}%`)
      const label = root.querySelector<HTMLElement>(`[data-val="${key}"]`)
      if (label) label.textContent = `${percent}%`
    })
    switches.forEach((sw) => {
      const key = sw.dataset.toggle as ToggleKey
      sw.setAttribute('aria-checked', String(s[key]))
    })
    swatches.forEach((card) => {
      const active = card.dataset.skin === s.theme
      card.setAttribute('aria-pressed', String(active))
      const mark = card.querySelector<HTMLElement>(`[data-mark="${card.dataset.skin}"]`)
      if (mark) mark.textContent = active ? '✓ выбран' : ''
    })
    if (fsBtn) fsBtn.textContent = document.fullscreenElement ? 'Выйти из полного экрана' : 'Во весь экран'
  }

  const onRangeInput = (e: Event) => {
    const input = e.currentTarget as HTMLInputElement
    const value = Number(input.value) / 100
    if (input.dataset.set === 'sfx') updateSettings({ sfx: value })
    else updateSettings({ music: value })
    audio.play('hover')
  }
  const onToggle = (e: Event): void => {
    const key = (e.currentTarget as HTMLButtonElement).dataset.toggle as ToggleKey
    if (!key) return
    updateSettings({ [key]: !getSettings()[key] })
    audio.play('click')
  }
  const onSwatch = (e: Event) => {
    const card = e.currentTarget as HTMLButtonElement
    updateSettings({ theme: card.dataset.skin ?? 'neon' })
    audio.play('select')
  }
  const onBack = () => {
    audio.play('back')
    void show('menu')
  }
  const onReset = () => {
    resetSettings()
    audio.play('select')
  }
  const onFullscreen = () => {
    audio.play('click')
    void (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()).catch(
      () => {
        /* браузер может запретить полный экран без жеста пользователя */
      },
    )
  }
  const onKeydown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') onBack()
  }
  const onFullscreenChange = () => refresh(getSettings())

  backBtn?.addEventListener('click', onBack)
  resetBtn?.addEventListener('click', onReset)
  fsBtn?.addEventListener('click', onFullscreen)
  ranges.forEach((i) => i.addEventListener('input', onRangeInput))
  switches.forEach((s) => s.addEventListener('click', onToggle))
  swatches.forEach((s) => s.addEventListener('click', onSwatch))
  window.addEventListener('keydown', onKeydown)
  document.addEventListener('fullscreenchange', onFullscreenChange)

  const unsubscribe = onSettingsChange(refresh)
  refresh(getSettings())

  return () => {
    unsubscribe()
    window.removeEventListener('keydown', onKeydown)
    document.removeEventListener('fullscreenchange', onFullscreenChange)
    backBtn?.removeEventListener('click', onBack)
    resetBtn?.removeEventListener('click', onReset)
    fsBtn?.removeEventListener('click', onFullscreen)
    ranges.forEach((i) => i.removeEventListener('input', onRangeInput))
    switches.forEach((s) => s.removeEventListener('click', onToggle))
    swatches.forEach((s) => s.removeEventListener('click', onSwatch))
  }
}
