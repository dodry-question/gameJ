/**
 * ЕДИНОЕ ХРАНИЛИЩЕ ИГРОВЫХ НАСТРОЕК.
 *
 * Как это работает:
 *  - настройки лежат в одном объекте `Settings`;
 *  - при изменении они сразу сохраняются в localStorage браузера
 *    (то есть переживают F5 и закрытие вкладки);
 *  - все экраны/звук «подписаны» на изменения через onSettingsChange.
 *
 * Чтобы добавить свою настройку:
 *  1. добавь поле в интерфейс Settings и в DEFAULT_SETTINGS;
 *  2. получи к нему доступ через getSettings() там, где он нужен;
 *  3. (опционально) добавь ему строку в меню настроек: src/ui/settingsScreen.ts
 */

export interface Settings {
  /** id скина (оформления): 'neon' | 'sunset' | 'mint' | 'retro' — см. src/theme/theme.ts */
  theme: string
  /** Громкость звуков эффектов: 0..1 */
  sfx: number
  /** Громкость фоновой музыки: 0..1 */
  music: number
  /** true — выключить лишние анимации (фон, переходы). Для слабых ПК и «укорачивания» */
  reduceMotion: boolean
  /** true — показывать счётчик FPS в углу экрана (проверка производительности) */
  showFps: boolean
}

const STORAGE_KEY = 'jamgame.settings.v1'

function prefersReducedMotion(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'neon',
  sfx: 0.7,
  music: 0.3,
  reduceMotion: prefersReducedMotion(),
  showFps: false,
}

function readStorage(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...DEFAULT_SETTINGS }
    const parsed = JSON.parse(raw) as Partial<Settings>
    // merge с дефолтами: если в хранилище старая версия настроек — не ломаемся
    return sanitize({ ...DEFAULT_SETTINGS, ...parsed })
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

/** Защита от битых значений (человек мог руками полезть в localStorage) */
function sanitize(s: Settings): Settings {
  const clamp01 = (n: number) => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0)
  return {
    theme: typeof s.theme === 'string' ? s.theme : DEFAULT_SETTINGS.theme,
    sfx: clamp01(s.sfx),
    music: clamp01(s.music),
    reduceMotion: Boolean(s.reduceMotion),
    showFps: Boolean(s.showFps),
  }
}

let state: Settings = readStorage()

type Listener = (s: Settings) => void
const listeners = new Set<Listener>()

export function getSettings(): Settings {
  return state
}

/** Частичное обновление: updateSettings({ sfx: 0.5 }) — остальное не тронется */
export function updateSettings(patch: Partial<Settings>): void {
  state = sanitize({ ...state, ...patch })
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    /* приватный режим — просто не сохраняем */
  }
  listeners.forEach((l) => l(state))
}

/** Подписка на изменения. Возвращает функцию-отписку. */
export function onSettingsChange(fn: Listener): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

export function resetSettings(): void {
  updateSettings({ ...DEFAULT_SETTINGS, reduceMotion: prefersReducedMotion() })
}
