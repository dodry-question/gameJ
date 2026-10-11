/**
 * ТИПЫ ДЛЯ ИГРОВЫХ СЦЕН.
 *
 * Сцены Phaser получают от обёртки (src/game/index.ts) две вещи:
 *   1) colors — цвета текущего скина, переведённые в числа для canvas
 *      (значения CSS-переменных берутся из src/theme/themes.css);
 *   2) hooks — как сцена сообщает UI наверх: изменился счёт, игрок проиграл.
 *
 * ВАЖНО про лёгкую замену: обёртка НИЧЕГО не знает о конкретной игре.
 * Она лишь передаёт события ввода (onPress/onRelease/startRun) и слушает
 * колбэки. Чтобы поменять игру — замени файл в scenes/ и строку в scenes/index.ts.
 */

/** Цвета скина в формате 0xRRGGBB — их понимает canvas */
export interface SceneColors {
  /** Фон панели (подложка сцены) */
  bg: number
  /** Основной акцент — игрок */
  accent: number
  /** Второй акцент — объекты */
  accent2: number
  /** Цвет опасности — враги/препятствия */
  danger: number
  /** Приглушённый текст — декор */
  text: number
  /** Линии/рамки */
  line: number
}

/** Колбэки, которыми сцена сообщает события наверх (в HTML-обёртку) */
export interface SceneHooks {
  /** Вызывать при каждом изменении целого числа очков */
  onScore: (score: number) => void
  /** Вызывать, когда игрок проиграл */
  onGameOver: (score: number) => void
}

/** Что кладётся в game.registry под ключом 'jam' — доступно любой сцене */
export interface JamData {
  colors: SceneColors
  hooks: SceneHooks
}

/** Минимальный контракт, который обёртка ждёт от основной сцены */
export interface GameSceneApi {
  /** Начать/перезапустить игру (сброс состояния, счёт в ноль) */
  startRun(): void
  /** Первичное действие: Пробел / клик. В ready/over обёртка сама зовёт startRun,
   *  в playing передаёт сцене — что с ней делать, решает сама сцена. */
  onPress(): void
  /** Игрок отпустил кнопку действия (для «удерживаемых» механик) */
  onRelease(): void
}

export const JAM_REGISTRY_KEY = 'jam'
