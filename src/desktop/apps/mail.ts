import { button, C, ellipsis, fill, inside, panel, setFont, text, wrap } from '../draw'
import type { Rect } from '../draw'
import type { App } from '../app'
import type { Sound } from '../../audio'

type Folder = 'in' | 'sent' | 'trash'

type Attachment = {
  name: string
  size: string
  downloaded: boolean
}

type Letter = {
  from: string
  subject: string
  date: string
  body: string
  read: boolean
  attachment?: Attachment
  /** Письмо похитителей: после прочтения открывается замок камеры. */
  threat?: boolean
}

type Hit = { r: Rect; fn: () => void }

function seedLetters(): Letter[] {
  return [
    {
      from: 'Служба эксплуатации',
      subject: 'Отключение воды, блок C',
      date: '04:12',
      body:
        'С 05:00 до 09:00 в блоке C не будет холодной воды.\n\n' +
        'Приносим извинения за неудобства.\n\n— Служба эксплуатации, доб. 214',
      read: true,
    },
    {
      from: 'no-reply@intranet.local',
      subject: 'Резервное копирование завершено',
      date: '03:00',
      body:
        'Резервная копия сервера КАМ-04 завершена.\n\n' +
        'Свободно на диске: 12%.\nРекомендуется очистить архив записей.\n\n' +
        'Служба каталогов',
      read: true,
    },
    {
      from: 'Неизвестный отправитель',
      subject: '(без темы)',
      date: '03:07',
      body:
        'она проснулась в 03:06\n\n' +
        'камера 2 показывает комнату\nна стуле кто-то есть\n\n' +
        'не отвечай на это письмо',
      read: false,
    },
    {
      from: 'Система',
      subject: 'Ошибка синхронизации часов',
      date: '03:09',
      body:
        'Не удалось синхронизировать часы с сервером времени.\n\n' +
        'Текущее время узла: 03:07\nРассинхронизация: 2 мин.\n\n' +
        'Повторите попытку позже.',
      read: false,
    },
  ]
}

const FOLDERS: Array<[Folder, string]> = [
  ['in', 'Входящие'],
  ['sent', 'Отправленные'],
  ['trash', 'Корзина'],
]

export class Mail implements App {
  title = 'Почта'
  /** Архив скачали — рабочий стол запускает «установку». */
  onDownload?: () => void
  /** Прочитано письмо похитителей — доступ к замку камеры открыт. */
  onThreatRead?: () => void

  private folder: Folder = 'in'
  private selected = 0
  private hits: Hit[] = []
  private sound: Sound
  private letters: Letter[] = seedLetters()

  constructor(sound: Sound) {
    this.sound = sound
  }

  /** Новое письмо с архивом приходит по ходу пролога. */
  deliver(): void {
    this.letters.unshift({
      from: 'Служба безопасности',
      subject: 'КАМ-04: требуется выгрузка архива',
      date: '03:11',
      body:
        'Оператор,\n\n' +
        'в архиве КАМ-04 есть запись с камеры 2 за 03:06. На записи — женщина. Она жива.\n\n' +
        'Выгрузка во вложении. Скачайте файл и откройте его на рабочем столе.',
      read: false,
      attachment: { name: 'cam04-archive.zip', size: '2,4 МБ · ZIP-архив', downloaded: false },
    })
    this.folder = 'in'
    this.selected = 0
  }

  /** Письмо от похитителей: приходит после первого запуска cam04.exe. */
  deliverThreat(): void {
    this.letters.unshift({
      from: 'Неизвестный отправитель',
      subject: 'Не узнаёшь её?',
      date: '03:14',
      body:
        'Не узнаёшь её?\n\n' +
        'Теперь, надеюсь, ты понял. Мы не прячем её от тебя — мы даём тебе шанс.\n\n' +
        'Камера 04 слушается тебя: скажи ей, что делать, и открой дверь. ' +
        'Только не тяни — мы можем и передумать.\n\n' +
        'Действуй.',
      read: false,
      threat: true,
    })
    this.folder = 'in'
    this.selected = 0
  }

  private get visible(): Letter[] {
    return this.folder === 'in' ? this.letters : []
  }

  draw(ctx: CanvasRenderingContext2D, r: Rect): void {
    this.hits = []
    fill(ctx, r, C.face)

    const leftW = 128
    this.drawFolders(ctx, { x: r.x + 4, y: r.y + 4, w: leftW, h: r.h - 8 })

    const rightX = r.x + leftW + 12
    const rightW = r.w - leftW - 16
    const listH = Math.max(130, Math.floor((r.h - 12) * 0.45))

    this.drawList(ctx, { x: rightX, y: r.y + 4, w: rightW, h: listH })
    this.drawBody(ctx, { x: rightX, y: r.y + listH + 10, w: rightW, h: r.h - listH - 16 })
  }

  private drawFolders(ctx: CanvasRenderingContext2D, r: Rect): void {
    panel(ctx, r)
    text(ctx, 'Папки', r.x + 8, r.y + 14, { size: 11, bold: true, color: C.textDim })

    let y = r.y + 26
    for (const [id, label] of FOLDERS) {
      const row: Rect = { x: r.x + 6, y, w: r.w - 12, h: 19 }
      const active = this.folder === id
      if (active) {
        fill(ctx, row, C.select)
        text(ctx, label, row.x + 4, row.y + 10, { size: 12, color: '#ffffff' })
      } else {
        text(ctx, label, row.x + 4, row.y + 10, { size: 12, color: C.text })
      }
      this.hits.push({
        r: row,
        fn: () => {
          this.folder = id
          this.sound.click()
        },
      })
      y += 21
    }

    // Счётчик непрочитанного.
    const unread = this.letters.filter((l) => !l.read).length
    if (unread > 0) {
      text(ctx, `Непрочитанных: ${unread}`, r.x + 8, r.y + r.h - 16, { size: 11, color: C.alert })
    }
  }

  private drawList(ctx: CanvasRenderingContext2D, r: Rect): void {
    fill(ctx, r, C.paper)
    ctx.strokeStyle = C.lo
    ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1)

    fill(ctx, { x: r.x + 1, y: r.y + 1, w: r.w - 2, h: 20 }, C.face)
    text(ctx, 'От кого', r.x + 8, r.y + 11, { size: 11, bold: true })
    text(ctx, 'Тема', r.x + 186, r.y + 11, { size: 11, bold: true })
    text(ctx, 'Время', r.x + r.w - 46, r.y + 11, { size: 11, bold: true })

    const list = this.visible
    if (list.length === 0) {
      text(ctx, this.folder === 'trash' ? 'Корзина пуста.' : 'Писем нет.', r.x + 10, r.y + 44, {
        size: 12,
        color: C.textDim,
      })
      return
    }

    let y = r.y + 21
    list.forEach((l, i) => {
      const row: Rect = { x: r.x + 1, y, w: r.w - 2, h: 19 }
      if (i === this.selected) {
        fill(ctx, row, C.select)
      }
      const color = i === this.selected ? '#ffffff' : l.read ? C.textDim : C.text
      setFont(ctx, 12, !l.read)
      text(ctx, ellipsis(ctx, l.from, 168, 12, !l.read), row.x + 8, row.y + 10, { size: 12, bold: !l.read, color })
      text(ctx, ellipsis(ctx, l.subject, row.w - 250, 12, !l.read), row.x + 186, row.y + 10, { size: 12, bold: !l.read, color })
      text(ctx, l.date, row.x + row.w - 46, row.y + 10, { size: 12, color })
      this.hits.push({
        r: row,
        fn: () => {
          const wasUnread = !l.read
          this.selected = i
          l.read = true
          if (wasUnread) this.sound.message()
          else this.sound.click()
          if (wasUnread && l.threat) this.onThreatRead?.()
        },
      })
      y += 19
    })
  }

  private drawBody(ctx: CanvasRenderingContext2D, r: Rect): void {
    fill(ctx, r, C.paper)
    ctx.strokeStyle = C.lo
    ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1)

    const list = this.visible
    if (list.length === 0) return
    const l = list[Math.min(this.selected, list.length - 1)]

    text(ctx, l.subject, r.x + 8, r.y + 14, { size: 12, bold: true, color: C.ink })
    text(ctx, `${l.from} · ${l.date}`, r.x + 8, r.y + 30, { size: 11, color: C.textDim })
    ctx.strokeStyle = C.lo
    ctx.beginPath()
    ctx.moveTo(r.x + 8, r.y + 38.5)
    ctx.lineTo(r.x + r.w - 8, r.y + 38.5)
    ctx.stroke()

    let y = r.y + 52
    const limit = l.attachment ? r.y + r.h - 66 : r.y + r.h - 8
    for (const line of wrap(ctx, l.body, r.w - 20, 12)) {
      if (y > limit) break
      text(ctx, line, r.x + 8, y, { size: 12, color: C.ink })
      y += 16
    }

    if (l.attachment) this.drawAttachment(ctx, r, l.attachment)
  }

  /** Вложение — главный акцент письма: игрок должен понять, что файл надо скачать. */
  private drawAttachment(ctx: CanvasRenderingContext2D, r: Rect, a: Attachment): void {
    const box: Rect = { x: r.x + 8, y: r.y + r.h - 60, w: r.w - 16, h: 52 }
    fill(ctx, box, a.downloaded ? '#d8d5c3' : '#f0e4b4')
    ctx.strokeStyle = a.downloaded ? C.lo : '#8a6a12'
    ctx.lineWidth = a.downloaded ? 1 : 2
    ctx.strokeRect(box.x + 1, box.y + 1, box.w - 2, box.h - 2)
    ctx.lineWidth = 1

    text(ctx, a.downloaded ? 'ФАЙЛ ПОЛУЧЕН' : 'ВЛОЖЕНИЕ', box.x + 12, box.y + 12, {
      size: 10,
      bold: true,
      color: a.downloaded ? C.textDim : C.alert,
    })

    // иконка файла с загнутым углом
    const ix = box.x + 14
    const iy = box.y + 20
    fill(ctx, { x: ix, y: iy, w: 18, h: 24 }, '#f4f2e6')
    ctx.strokeStyle = '#3a3a32'
    ctx.strokeRect(ix + 0.5, iy + 0.5, 17, 23)
    ctx.beginPath()
    ctx.moveTo(ix + 11, iy + 1)
    ctx.lineTo(ix + 17, iy + 7)
    ctx.lineTo(ix + 11, iy + 7)
    ctx.closePath()
    ctx.stroke()

    text(ctx, a.name, box.x + 42, box.y + 30, { size: 12, bold: true, color: C.ink })
    text(ctx, a.downloaded ? 'загружено · установка на рабочий стол' : a.size, box.x + 42, box.y + 43, {
      size: 10,
      color: C.textDim,
    })

    const btn: Rect = { x: box.x + box.w - 104, y: box.y + 15, w: 92, h: 24 }
    button(ctx, btn, a.downloaded ? 'Скачано' : 'Скачать')

    this.hits.push({
      r: box,
      fn: () => {
        if (a.downloaded) {
          this.sound.click()
          return
        }
        a.downloaded = true
        this.sound.open()
        this.onDownload?.()
      },
    })
  }

  /** Письмо, открытое в области просмотра, считается прочитанным сразу. */
  tick(): boolean {
    const list = this.visible
    const l = list[Math.min(this.selected, list.length - 1)]
    if (l && !l.read) {
      l.read = true
      if (l.threat) this.onThreatRead?.()
      return true
    }
    return false
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
