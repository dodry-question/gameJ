/**
 * ТОЧКА ВХОДА.
 *
 * Прототип «оператор за монитором»: 3D-комната, ЭЛТ-монитор, на экране которого
 * живёт рабочий стол в стиле Windows 2000. Сцена — scene.ts, интерфейс —
 * desktop/. Вся игра (камеры, героиня) появится позже.
 */
import './style.css'
import * as THREE from 'three'
import { GAME } from './config'
import { Room } from './scene'
import { Desktop, DESKTOP_H, DESKTOP_W } from './desktop/desktop'
import { Sound } from './audio'

document.title = `${GAME.title} — ${GAME.tagline}`

const found = document.querySelector<HTMLDivElement>('#app')
if (!found) throw new Error('#app не найден в index.html')
const host: HTMLDivElement = found

const sound = new Sound()
const desktop = new Desktop(sound)

// Отладочный режим: посмотреть рабочий стол без 3D → ?ui
if (location.search.includes('ui')) {
  desktop.canvas.style.width = '960px'
  desktop.canvas.style.height = '720px'
  host.appendChild(desktop.canvas)
  desktop.draw()

  const uiPoint = (e: PointerEvent): { x: number; y: number } => {
    const r = desktop.canvas.getBoundingClientRect()
    return {
      x: ((e.clientX - r.left) * DESKTOP_W) / r.width,
      y: ((e.clientY - r.top) * DESKTOP_H) / r.height,
    }
  }
  desktop.canvas.addEventListener('pointermove', (e) => {
    const p = uiPoint(e)
    desktop.pointerMove(p.x, p.y)
  })
  desktop.canvas.addEventListener('pointerleave', () => desktop.pointerOut())
  desktop.canvas.addEventListener('pointerdown', (e) => {
    sound.ensure()
    const p = uiPoint(e)
    desktop.pointerDown(p.x, p.y)
    desktop.canvas.setPointerCapture(e.pointerId)
  })
  const uiRelease = (e: PointerEvent): void => {
    desktop.pointerUp()
    if (desktop.canvas.hasPointerCapture(e.pointerId)) desktop.canvas.releasePointerCapture(e.pointerId)
  }
  desktop.canvas.addEventListener('pointerup', uiRelease)
  desktop.canvas.addEventListener('pointercancel', uiRelease)
  desktop.canvas.addEventListener('contextmenu', (e) => e.preventDefault())

  // В отладочном режиме тоже крутим тик: иначе задержки запуска и уведомление стоят.
  const loop = (): void => {
    desktop.tick()
    if (desktop.dirty) {
      desktop.dirty = false
      desktop.draw()
    }
    requestAnimationFrame(loop)
  }
  requestAnimationFrame(loop)
} else {
  run(new Room(host, desktop.canvas))
}

function run(room: Room): void {
  function paintDesktop(): void {
    desktop.draw()
    room.refreshScreen()
  }

  paintDesktop()

  const ndc = new THREE.Vector2()
  let pressed = false
  let overScreen = false
  let cursorHidden = false

  function aim(e: PointerEvent): void {
    ndc.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1)
  }

  /**
   * Курсор мыши оставляем системный: у игрока своя чувствительность и размер.
   * Прячем его только пока крутятся песочные часы загрузки.
   */
  function syncCursor(): void {
    const hide = overScreen && desktop.isBusy()
    if (hide === cursorHidden) return
    cursorHidden = hide
    host.style.cursor = hide ? 'none' : 'default'
  }

  host.addEventListener('pointermove', (e) => {
    aim(e)
    room.setPointer(ndc.x, ndc.y)
    const p = pressed ? room.pickLoose(ndc) : room.pick(ndc)
    if (p && p.x >= 0 && p.y >= 0 && p.x < DESKTOP_W && p.y < DESKTOP_H) {
      overScreen = true
      desktop.pointerMove(p.x, p.y)
    } else {
      overScreen = false
      desktop.pointerOut()
    }
    syncCursor()
  })

  host.addEventListener('pointerleave', () => {
    overScreen = false
    desktop.pointerOut()
    syncCursor()
  })

  host.addEventListener('pointerdown', (e) => {
    sound.ensure()
    aim(e)
    const p = room.pick(ndc)
    if (!p) return
    pressed = true
    overScreen = true
    host.setPointerCapture(e.pointerId)
    desktop.pointerDown(p.x, p.y)
    syncCursor()
  })

  function release(e: PointerEvent): void {
    if (!pressed) return
    pressed = false
    desktop.pointerUp()
    if (host.hasPointerCapture(e.pointerId)) host.releasePointerCapture(e.pointerId)
  }

  host.addEventListener('pointerup', release)
  host.addEventListener('pointercancel', release)
  host.addEventListener('contextmenu', (e) => e.preventDefault())

  window.addEventListener('resize', () => room.resize())

  let last = performance.now()

  function frame(now: number): void {
    const dt = Math.min((now - last) / 1000, 0.1)
    last = now

    desktop.tick()
    syncCursor()
    if (desktop.dirty) {
      desktop.dirty = false
      paintDesktop()
    }

    room.update(dt)
    room.render()
    requestAnimationFrame(frame)
  }

  requestAnimationFrame(frame)
}
