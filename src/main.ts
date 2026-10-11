/**
 * ТОЧКА ВХОДА ПРИЛОЖЕНИЯ.
 * Порядок: применить сохранённые настройки → подписаться на их изменения →
 * показать меню. Всё.
 */
import './style.css'
import './theme/themes.css'

import { audio } from './audio/audio'
import { GAME } from './config'
import { getSettings, onSettingsChange } from './settings/settings'
import type { Settings } from './settings/settings'
import { applyMotionPreference, applySkin } from './theme/theme'
import { initFpsCounter } from './ui/fps'
import { initScreens, show } from './ui/screens'

/** Применить визуальные настройки к <html> */
function applyAppearance(s: Settings): void {
  applySkin(s.theme)
  applyMotionPreference(s.reduceMotion)
}

document.title = `${GAME.title} — ${GAME.tagline}`

applyAppearance(getSettings())
onSettingsChange(applyAppearance)

audio.init()
initFpsCounter()

const screen = document.querySelector<HTMLElement>('#screen')
if (screen) {
  initScreens(screen)
  void show('menu')
}
