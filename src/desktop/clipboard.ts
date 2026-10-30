/**
 * Системный буфер обмена.
 *
 * Сначала пробуем синхронный `execCommand('copy')`: он работает прямо внутри
 * жеста пользователя и не требует разрешений — важно для iframe и Firefox.
 * Если не вышло, идём через `navigator.clipboard`.
 */
export function writeClipboard(text: string): boolean {
  if (legacyCopy(text)) return true
  try {
    if (navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(text).catch(() => {
        // буфер недоступен — ничего не поделать
      })
      return true
    }
  } catch {
    // ниже — уже нечего пробовать
  }
  return false
}

function legacyCopy(text: string): boolean {
  const ta = document.createElement('textarea')
  ta.value = text
  ta.style.position = 'fixed'
  ta.style.left = '-9999px'
  ta.style.top = '0'
  document.body.appendChild(ta)
  ta.focus()
  ta.select()
  let ok = false
  try {
    ok = document.execCommand('copy')
  } catch {
    // буфер недоступен
  }
  ta.remove()
  return ok
}

export async function readClipboard(): Promise<string | null> {
  try {
    if (navigator.clipboard?.readText) return await navigator.clipboard.readText()
  } catch {
    // доступ к буферу запрещён
  }
  return null
}
