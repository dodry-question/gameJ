/**
 * ТОЧКА ВХОДА.
 *
 * Каркас пустой: подключение стилей и заголовка вкладки.
 * Вся игра (3D-сцена, камеры, интерфейс) пишется с нуля после ТЗ.
 * См. CONTEXT.md, раздел «СТАТУС».
 */
import './style.css'
import { GAME } from './config'

document.title = `${GAME.title} — ${GAME.tagline}`

const app = document.querySelector<HTMLDivElement>('#app')
if (!app) throw new Error('#app не найден в index.html')
