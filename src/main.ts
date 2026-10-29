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
  document.body.appendChild(desktop.canvas)
  desktop.draw()
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

  function aim(e: PointerEvent): void {
    ndc.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1)
  }

  host.addEventListener('pointermove', (e) => {
    aim(e)
    room.setPointer(ndc.x, ndc.y)
    const p = pressed ? room.pickLoose(ndc) : room.pick(ndc)
    if (p && p.x >= 0 && p.y >= 0 && p.x < DESKTOP_W && p.y < DESKTOP_H) {
      // Системную стрелку прячем: на экране монитора живёт нарисованный курсор.
      host.style.cursor = 'none'
      desktop.pointerMove(p.x, p.y)
    } else {
      host.style.cursor = 'default'
      desktop.pointerOut()
    }
  })

  host.addEventListener('pointerleave', () => {
    host.style.cursor = 'default'
    desktop.pointerOut()
  })

  host.addEventListener('pointerdown', (e) => {
    sound.ensure()
    aim(e)
    const p = room.pick(ndc)
    if (!p) return
    pressed = true
    host.setPointerCapture(e.pointerId)
    desktop.pointerDown(p.x, p.y)
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
