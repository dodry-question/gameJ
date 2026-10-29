/**
 * «Сеть наблюдения · блок C» — карта комплекса с радаром.
 *
 * Показывает план блока, точки камер и объект: пока объект в кадре текущей
 * камеры — красный кружок горит; как только камера его теряет, кружок медленно
 * гаснет на последнем замеченном месте, как радар в CS. Щелчок по камере на
 * карте переключает кормящийся ракурс — других кнопок переключения нет.
 */
import { fill, inside, panel, setFont, text } from '../draw'
import type { Rect } from '../draw'
import type { App } from '../app'
import type { Sound } from '../../audio'
import { getCctv } from '../../cctv'

type Hit = { r: Rect; fn: () => void }

/** Границы пола в мировых координатах (комната 6×5 с центром (0, -0.5)). */
const WORLD = { x0: -3, x1: 3, z0: -3, z1: 2 }

export class MapApp implements App {
  title = 'Сеть наблюдения · блок C'
  private hits: Hit[] = []
  private sound: Sound
  /** Яркость метки объекта: 1 — в кадре, плавно гаснет после потери. */
  private alpha = 0
  private lastSeen: { x: number; z: number } | null = null

  constructor(sound: Sound) {
    this.sound = sound
  }

  tick(): boolean {
    const cctv = getCctv()
    if (!cctv.loaded || cctv.gone) {
      if (this.alpha > 0) {
        this.alpha = 0
        return true
      }
      return false
    }
    const pos = cctv.girlPos
    if (pos && cctv.sees(pos.x, pos.z)) {
      this.lastSeen = pos
      if (this.alpha < 1) {
        this.alpha = Math.min(1, this.alpha + 0.25)
        return true
      }
      return false
    }
    // не в кадре — метка медленно гаснет на последнем замеченном месте
    if (this.alpha > 0) {
      this.alpha = Math.max(0, this.alpha - 0.006)
      return true
    }
    return false
  }

  draw(ctx: CanvasRenderingContext2D, r: Rect): void {
    this.hits = []
    fill(ctx, r, '#12100c')

    const area: Rect = { x: r.x + 18, y: r.y + 18, w: r.w - 36, h: r.h - 66 }
    fill(ctx, area, '#17211b')
    ctx.strokeStyle = '#3d4a3f'
    ctx.strokeRect(area.x + 0.5, area.y + 0.5, area.w - 1, area.h - 1)

    // сетка миллиметровки
    ctx.strokeStyle = 'rgba(90, 120, 95, 0.14)'
    for (let gx = area.x + 14; gx < area.x + area.w; gx += 14) {
      ctx.beginPath()
      ctx.moveTo(gx, area.y + 1)
      ctx.lineTo(gx, area.y + area.h - 1)
      ctx.stroke()
    }
    for (let gy = area.y + 14; gy < area.y + area.h; gy += 14) {
      ctx.beginPath()
      ctx.moveTo(area.x + 1, gy)
      ctx.lineTo(area.x + area.w - 1, gy)
      ctx.stroke()
    }

    // план: контур комнаты, проём двери, коридор снизу
    const p0 = this.worldToMap(WORLD.x0, WORLD.z0, area)
    const p1 = this.worldToMap(WORLD.x1, WORLD.z1, area)
    ctx.strokeStyle = '#8fae94'
    ctx.lineWidth = 2
    ctx.strokeRect(p0.mx, p0.my, p1.mx - p0.mx, p1.my - p0.my)
    // проём двери на дальней стене
    const d0 = this.worldToMap(-0.6, WORLD.z0, area)
    const d1 = this.worldToMap(0.6, WORLD.z0, area)
    ctx.strokeStyle = '#17211b'
    ctx.lineWidth = 4
    ctx.beginPath()
    ctx.moveTo(d0.mx + 2, p0.my)
    ctx.lineTo(d1.mx - 2, p0.my)
    ctx.stroke()
    ctx.lineWidth = 1
    ctx.strokeStyle = '#c9c2a0'
    ctx.beginPath()
    ctx.arc(d0.mx + 2, p0.my + 2, d1.mx - d0.mx - 4, -Math.PI / 2, 0)
    ctx.stroke()

    // коридор за дверью и выход
    text(ctx, 'КОРИДОР', p0.mx + (p1.mx - p0.mx) / 2, p0.my - 14, {
      size: 9,
      color: '#6d7f70',
      align: 'center',
    })
    ctx.strokeStyle = '#6d7f70'
    ctx.strokeRect(p0.mx + 8, p0.my - 12, p1.mx - p0.mx - 16, 9)

    // стул
    const chair = this.worldToMap(-0.6, -0.9, area)
    ctx.strokeStyle = '#a08c5c'
    ctx.strokeRect(chair.mx - 4, chair.my - 4, 8, 8)

    // камеры: сектор обзора и точка, кликом переключается ракурс
    const cctv = getCctv()
    for (let i = 0; i < cctv.views.length; i++) {
      const v = cctv.views[i]
      const cur = cctv.getView() === i
      const p = this.worldToMap(v.pos[0], v.pos[2], area)
      // сектор
      const ang = Math.atan2(v.at[2] - v.pos[2], v.at[0] - v.pos[0])
      const half = ((v.fov / 2) * Math.PI) / 180
      const len = 52
      const tipX = p.mx + Math.cos(ang) * len
      const tipY = p.my + Math.sin(ang) * len
      const lx = p.mx + Math.cos(ang - half) * len
      const ly = p.my + Math.sin(ang - half) * len
      const rx = p.mx + Math.cos(ang + half) * len
      const ry = p.my + Math.sin(ang + half) * len
      ctx.fillStyle = cur ? 'rgba(140, 220, 150, 0.16)' : 'rgba(140, 220, 150, 0.07)'
      ctx.beginPath()
      ctx.moveTo(p.mx, p.my)
      ctx.lineTo(lx, ly)
      ctx.lineTo(tipX, tipY)
      ctx.lineTo(rx, ry)
      ctx.closePath()
      ctx.fill()
      // точка камеры
      const node: Rect = { x: p.mx - 11, y: p.my - 11, w: 22, h: 22 }
      panel(ctx, node, cur, 1)
      setFont(ctx, 10, cur)
      ctx.fillStyle = cur ? '#d8e4d0' : '#8f948d'
      ctx.textAlign = 'center'
      ctx.fillText(String(i + 1), p.mx, p.my + 1)
      ctx.textAlign = 'left'
      const idx = i
      this.hits.push({
        r: node,
        fn: () => {
          cctv.setView(idx)
          this.sound.click()
        },
      })
    }

    // объект: горит, пока в кадре, гаснет на последнем месте после потери
    if (this.lastSeen && this.alpha > 0) {
      const gp = this.worldToMap(this.lastSeen.x, this.lastSeen.z, area)
      ctx.globalAlpha = this.alpha
      ctx.fillStyle = '#d4402e'
      ctx.beginPath()
      ctx.arc(gp.mx, gp.my, 5, 0, Math.PI * 2)
      ctx.fill()
      ctx.strokeStyle = '#f2a08e'
      ctx.stroke()
      ctx.font = '9px "MS Sans Serif", sans-serif'
      ctx.fillStyle = '#f2b0a0'
      ctx.textAlign = 'center'
      ctx.fillText('ОБЪЕКТ', gp.mx, gp.my - 9)
      ctx.textAlign = 'left'
      ctx.globalAlpha = 1
    }

    // подвал: подсказка и статус
    text(ctx, 'Щёлкни по камере, чтобы переключить канал', r.x + 12, r.y + r.h - 16, {
      size: 10,
      color: '#8f948d',
    })
    const seen = this.alpha > 0.6
    text(ctx, seen ? 'ОБЪЕКТ В КАДРЕ' : 'ОБЪЕКТ НЕ НАБЛЮДАЕТСЯ', r.x + r.w - 12, r.y + r.h - 16, {
      size: 10,
      bold: true,
      color: seen ? '#9fd39f' : '#d08a8a',
      align: 'right',
    })
  }

  /** Мировые координаты → пиксели карты. */
  private worldToMap(x: number, z: number, area: Rect): { mx: number; my: number } {
    return {
      mx: area.x + ((x - WORLD.x0) / (WORLD.x1 - WORLD.x0)) * area.w,
      my: area.y + ((z - WORLD.z0) / (WORLD.z1 - WORLD.z0)) * area.h,
    }
  }

  click(x: number, y: number, _r: Rect): void {
    for (let i = this.hits.length - 1; i >= 0; i--) {
      if (inside(this.hits[i].r, x, y)) {
        this.hits[i].fn()
        return
      }
    }
  }
}
