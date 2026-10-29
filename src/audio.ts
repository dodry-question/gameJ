/**
 * Звук без ассетов: системные звуки Windows 2000, собранные из осцилляторов
 * и шума, плюс гул комнаты. Сэмплов нет — билд не тяжелеет.
 *
 * Почему не квадратные пищалки: у Win2000 звуки колокольчиковые (FM-синтез)
 * с короткой реверберацией, а клики мыши — мягкие шумовые тики.
 */

export class Sound {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private noise: AudioBuffer | null = null
  private started = false

  /** Вызывать на первом клике: браузеры не дают создать звук раньше. */
  ensure(): void {
    if (this.started) return
    this.started = true
    try {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      const ctx = new Ctor()
      const master = ctx.createGain()
      master.gain.value = 0.5

      // сухая шина + немного «комнаты», иначе колокольчики звучат как в вакууме
      const dry = ctx.createGain()
      dry.gain.value = 1
      const wet = ctx.createGain()
      wet.gain.value = 0.16
      const verb = ctx.createConvolver()
      verb.buffer = impulse(ctx)
      master.connect(dry).connect(ctx.destination)
      master.connect(verb).connect(wet).connect(ctx.destination)

      this.ctx = ctx
      this.master = master
      this.noise = noiseBuffer(ctx)
      this.hum(ctx, master)
      void ctx.resume()
    } catch {
      this.ctx = null
      this.master = null
    }
  }

  /** Низкий гул вентиляции + случайные удары где-то в здании. */
  private hum(ctx: AudioContext, out: GainNode): void {
    const len = ctx.sampleRate * 4
    const buf = ctx.createBuffer(1, len, ctx.sampleRate)
    const data = buf.getChannelData(0)
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * 0.35

    const noise = ctx.createBufferSource()
    noise.buffer = buf
    noise.loop = true

    const lp = ctx.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.value = 120
    lp.Q.value = 1.2

    const g = ctx.createGain()
    g.gain.value = 0.06

    noise.connect(lp).connect(g).connect(out)
    noise.start()

    const osc = ctx.createOscillator()
    osc.type = 'sine'
    osc.frequency.value = 49
    const og = ctx.createGain()
    og.gain.value = 0.02
    osc.connect(og).connect(out)
    osc.start()

    const thud = () => {
      this.thud()
      window.setTimeout(thud, 11000 + Math.random() * 16000)
    }
    window.setTimeout(thud, 9000)
  }

  // ── синтез ───────────────────────────────────────────────────────

  /** Колокольчик на FM: несущая + модулятор с гаснущей девиацией. */
  private bell(freq: number, dur: number, gain: number, bright = 1, when = 0): void {
    const ctx = this.ctx
    const out = this.master
    if (!ctx || !out) return
    const t = ctx.currentTime + when + 0.003

    const car = ctx.createOscillator()
    car.type = 'sine'
    car.frequency.setValueAtTime(freq, t)

    const mod = ctx.createOscillator()
    mod.type = 'sine'
    mod.frequency.setValueAtTime(freq * 2.01, t)

    const dev = ctx.createGain()
    dev.gain.setValueAtTime(freq * 2.4 * bright, t)
    dev.gain.exponentialRampToValueAtTime(freq * 0.04, t + dur * 0.6)
    mod.connect(dev).connect(car.frequency)

    const env = ctx.createGain()
    env.gain.setValueAtTime(0.0001, t)
    env.gain.exponentialRampToValueAtTime(gain, t + 0.005)
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    car.connect(env).connect(out)

    car.start(t)
    mod.start(t)
    car.stop(t + dur + 0.06)
    mod.stop(t + dur + 0.06)
  }

  /** Мягкий шумовой тик: клик мыши, щелчок меню, шорох диска. */
  private tick(freq: number, q: number, gain: number, dur = 0.03, when = 0): void {
    const ctx = this.ctx
    const out = this.master
    if (!ctx || !out || !this.noise) return
    const t = ctx.currentTime + when

    const src = ctx.createBufferSource()
    src.buffer = this.noise
    const bp = ctx.createBiquadFilter()
    bp.type = 'bandpass'
    bp.frequency.value = freq
    bp.Q.value = q
    const env = ctx.createGain()
    env.gain.setValueAtTime(gain, t)
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    src.connect(bp).connect(env).connect(out)
    src.start(t)
    src.stop(t + dur + 0.02)
  }

  private tone(freq: number, dur: number, type: OscillatorType, gain: number, slideTo?: number): void {
    const ctx = this.ctx
    const out = this.master
    if (!ctx || !out) return
    const t = ctx.currentTime
    const osc = ctx.createOscillator()
    osc.type = type
    osc.frequency.setValueAtTime(freq, t)
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + dur)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0, t)
    g.gain.linearRampToValueAtTime(gain, t + 0.005)
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    osc.connect(g).connect(out)
    osc.start(t)
    osc.stop(t + dur + 0.02)
  }

  // ── системные звуки ──────────────────────────────────────────────

  /** Клик мыши по элементу: короткий тик, почти без тона. */
  click(): void {
    this.tick(2400, 1.5, 0.05, 0.028)
    this.bell(1900, 0.035, 0.008, 0.6)
  }

  /** Открытие меню «Пуск»: приглушённый «пум». */
  menu(): void {
    this.tick(900, 1.1, 0.03, 0.05)
    this.bell(392, 0.09, 0.02, 0.9)
  }

  /** Старт программы: короткий восходящий перезвон (как Start Navigation). */
  open(): void {
    this.bell(587, 0.18, 0.05, 1.2)
    this.bell(880, 0.24, 0.042, 1, 0.06)
    this.bell(1175, 0.32, 0.026, 0.8, 0.12)
  }

  /** Закрытие окна: нисходящий колокольчик. */
  close(): void {
    this.bell(784, 0.14, 0.038, 1)
    this.bell(523, 0.22, 0.03, 0.9, 0.055)
  }

  /** Critical Stop: низкий гонг с двумя ударами. */
  error(): void {
    this.bell(147, 0.55, 0.085, 1.8)
    this.bell(110, 0.8, 0.07, 1.5, 0.17)
  }

  /** Уведомление: две ноты вверх. */
  message(): void {
    this.bell(988, 0.2, 0.04, 1)
    this.bell(1319, 0.26, 0.03, 0.8, 0.09)
  }

  /** Запуск программы «с диска»: трещотка головки. */
  busy(): void {
    this.tick(760, 2.4, 0.03, 0.02)
    this.tick(980, 2.6, 0.025, 0.018, 0.055)
    this.tick(700, 2.2, 0.028, 0.022, 0.14)
    this.tick(1080, 2.8, 0.02, 0.016, 0.21)
    this.tone(52, 0.5, 'sine', 0.012)
  }

  private thud(): void {
    this.tone(58, 0.6, 'sine', 0.06, 34)
  }
}

// ── буферы ─────────────────────────────────────────────────────────

function noiseBuffer(ctx: AudioContext): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * 0.4)
  const buf = ctx.createBuffer(1, len, ctx.sampleRate)
  const data = buf.getChannelData(0)
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1
  return buf
}

/** Короткий «воздух комнаты» для свёртки: шум с быстрым затуханием. */
function impulse(ctx: AudioContext): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * 0.35)
  const buf = ctx.createBuffer(1, len, ctx.sampleRate)
  const data = buf.getChannelData(0)
  for (let i = 0; i < len; i++) {
    const k = 1 - i / len
    data[i] = (Math.random() * 2 - 1) * Math.pow(k, 3)
  }
  return buf
}
