/**
 * ТОЧКА ВХОДА.
 *
 * Каркас пустой: ни стилей, ни разметки, ни игры. Только заголовок вкладки.
 * 3D-сцена, камеры, интерфейс и весь CSS пишутся с нуля после ТЗ.
 * См. CONTEXT.md, раздел «СТАТУС».
 */
import { GAME } from './config'

document.title = `${GAME.title} — ${GAME.tagline}`

const app = document.querySelector<HTMLDivElement>('#app')
if (!app) throw new Error('#app не найден в index.html')
