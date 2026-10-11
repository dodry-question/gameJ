/**
 * СКИНЫ (темы оформления) — список и переключение.
 *
 * Цвета/шрифты/скругления каждого скина лежат ТОЛЬКО в src/theme/themes.css.
 * Здесь — лишь список id + человекочитаемых названий для меню настроек.
 *
 * Как добавить новый скин:
 *   1. В themes.css скопируй любой блок `[data-theme="..."]` и переименуй id;
 *   2. Поменяй цвета/шрифты внутри;
 *   3. Добавь строку в SKINS ниже — и он появится в настройках.
 */
export interface Skin {
  id: string
  /** Как скин называется в меню настроек */
  name: string
  /** Короткое описание-подсказка, что в нём изменится */
  note: string
}

export const SKINS: Skin[] = [
  { id: 'neon', name: 'Неон', note: 'Тёмный фон, светящиеся акценты' },
  { id: 'sunset', name: 'Закат', note: 'Тёплые оранжево-розовые тона' },
  { id: 'mint', name: 'Дневной', note: 'Светлая тема, мягкие тени' },
  { id: 'retro', name: 'Ретро-терминал', note: 'Моноширинный шрифт, янтарный CRT' },
]

export function isKnownSkin(id: string): boolean {
  return SKINS.some((s) => s.id === id)
}

/** Вешает скин на <html>. Неизвестный id молча заменяется на первый скин. */
export function applySkin(id: string): void {
  document.documentElement.dataset.theme = isKnownSkin(id) ? id : SKINS[0].id
}

/** Включает/выключает режим «меньше анимаций» (класс на <html>) */
export function applyMotionPreference(reduce: boolean): void {
  document.documentElement.classList.toggle('reduce-motion', reduce)
}
