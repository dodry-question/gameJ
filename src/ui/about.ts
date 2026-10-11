/**
 * ЭКРАН «ОБ ИГРЕ» — витрина для жюри/ментора: что за проект, какой движок,
 * управление и где что лежит в коде.
 */
import { audio } from '../audio/audio'
import { GAME } from '../config'
import { show } from './screens'

export function renderAbout(root: HTMLElement): () => void {
  root.innerHTML = `
    <div class="page">
      <div class="page-head">
        <button class="btn btn-ghost" type="button" data-act="back">← Меню <span class="kbd">Esc</span></button>
        <h1 class="page-title">Об игре</h1>
        <p class="page-sub">${GAME.title} · ${GAME.tagline} · версия ${GAME.version}</p>
      </div>

      <section class="panel">
        <div class="section-title">Проект</div>
        <p class="section-hint">
          Прототип для геймджема. Меню и настройки готовы и не привязаны к игре:
          игровая сцена подключается через слот <b>src/game/index.ts</b>,
          реестр сцен — <b>src/game/scenes/</b> (сейчас внутри заглушка
          «уклоняйся» на Phaser 3 — квадратик против падающих кубиков).
        </p>
        <div class="key-line"><span>Движок</span><span class="tag">${GAME.engine}</span></div>
        <div class="key-line"><span>Сборка и запуск</span><span><span class="kbd">npm run dev</span> <span class="kbd">npm run build</span></span></div>
        <div class="key-line"><span>Где менять название игры</span><span class="kbd">src/config.ts</span></div>
        <div class="key-line"><span>Где менять стиль/скины</span><span class="kbd">src/theme/themes.css</span></div>
        <div class="key-line"><span>Где добавить свою игру/сцену</span><span class="kbd">src/game/scenes/</span></div>
      </section>

      <section class="panel">
        <div class="section-title">Управление (заглушка)</div>
        <div class="key-line"><span>Движение</span><span><span class="kbd">WASD</span> <span class="kbd">стрелки</span></span></div>
        <div class="key-line"><span>Старт / рестарт</span><span><span class="kbd">Пробел</span> <span class="kbd">клик</span></span></div>
        <div class="key-line"><span>Пауза</span><span class="kbd">P</span></div>
        <div class="key-line"><span>Выйти в меню</span><span class="kbd">Esc</span></div>
      </section>

      <div class="btn-row">
        <button class="btn btn-primary" type="button" data-act="play">Играть</button>
      </div>
    </div>
  `

  const back = root.querySelector<HTMLButtonElement>('[data-act="back"]')
  const play = root.querySelector<HTMLButtonElement>('[data-act="play"]')

  const onBack = () => {
    audio.play('back')
    void show('menu')
  }
  const onPlay = () => {
    audio.play('click')
    void show('game')
  }
  const onKeydown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') onBack()
  }
  const onHover = () => audio.play('hover')

  back?.addEventListener('click', onBack)
  play?.addEventListener('click', onPlay)
  play?.addEventListener('mouseenter', onHover)
  back?.addEventListener('mouseenter', onHover)
  window.addEventListener('keydown', onKeydown)
  window.requestAnimationFrame(() => back?.focus({ preventScroll: true }))

  return () => {
    window.removeEventListener('keydown', onKeydown)
    back?.removeEventListener('click', onBack)
    play?.removeEventListener('click', onPlay)
    play?.removeEventListener('mouseenter', onHover)
    back?.removeEventListener('mouseenter', onHover)
  }
}
