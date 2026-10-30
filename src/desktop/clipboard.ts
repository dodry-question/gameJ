/**
 * Системный буфер обмена.
 *
 * Основной путь — `navigator.clipboard`; если браузер его не даёт (или это
 * небезопасный контекст), копируем через скрытую textarea и `execCommand`.
 */
export function writeClipboard(text: string): void {
  try {
    if (navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(text).catch(() => legacyCopy(text))
      return
    }
  } catch {
    // ниже — запасной путь
  }
  legacyCopy(text)
}

function legacyCopy(text: string): void {
  const ta = document.createElement('textarea')
  ta.value = text
  ta.style.position = 'fixed'
  ta.style.left = '-9999px'
  ta.style.top = '0'
  document.body.appendChild(ta)
  ta.select()
  try {
    document.execCommand('copy')
  } catch {
    // буфер недоступен — ничего не поделать
  }
  ta.remove()
}

export async function readClipboard(): Promise<string | null> {
  try {
    if (navigator.clipboard?.readText) return await navigator.clipboard.readText()
  } catch {
    // доступ к буферу запрещён
  }
  return null
}
