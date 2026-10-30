/**
 * Звук: системные звуки Windows 2000, собранные из осцилляторов и шума,
 * плюс зацикленный эмбиент комнаты из файла.
 *
 * Почему не квадратные пищалки: у Win2000 звуки колокольчиковые (FM-синтез)
 * с короткой реверберацией, а клики мыши — мягкие шумовые тики.
 */

export class Sound {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private noise: AudioBuffer | null = null
  private modem: AudioBuffer | null = null
  private modemLoading = false
  private ambient: AudioBuffer | null = null
  private ambientLoading = false
  private creak: AudioBuffer | null = null
  private creakLoading = false
  private breath: AudioBuffer | null = null
  private breathLoading = false
  private breathStress: number | null = null
  private breathSrc: AudioBufferSourceNode | null = null
  private breathGain: GainNode | null = null
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
      this.loadAmbient()
      this.loadModem()
      this.scheduleModem(28 + Math.random() * 26)
      this.loadCreak()
      this.scheduleCreak(16 + Math.random() * 18)
      void ctx.resume()
    } catch {
      this.ctx = null
      this.master = null
    }
  }

  // ── эмбиент комнаты ──────────────────────────────────────────────

  /**
   * Основной эмбиент — запись нашего звуковика (public/sounds/ambient.ogg).
   * Грузим после первого клика: раньше браузер всё равно не даст звук.
   */
  private loadAmbient(): void {
    if (this.ambient || this.ambientLoading) return
    const ctx = this.ctx
    if (!ctx) return
    this.ambientLoading = true
    fetch('sounds/ambient.ogg')
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error('нет файла'))))
      .then((buffers) => ctx.decodeAudioData(buffers))
      .then((buf) => {
        this.ambient = buf
        this.startAmbient(ctx, buf)
      })
      .catch(() => {
        // без Ogg (Safari) или без файла живём в тишине
      })
  }

  private startAmbient(ctx: AudioContext, buf: AudioBuffer): void {
    const out = this.master
    if (!out) return
    const src = ctx.createBufferSource()
    src.buffer = buf
    src.loop = true
    const g = ctx.createGain()
    const t = ctx.currentTime
    // тихо и с плавным входом: фон не должен «щёлкать»
    g.gain.setValueAtTime(0.0001, t)
    g.gain.linearRampToValueAtTime(0.2, t + 2.5)
    src.connect(g).connect(out)
    src.start(t)
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

  // ── модем ────────────────────────────────────────────────────────

  /**
   * Оригинальная запись dial-up хендшейка: Wikimedia Commons,
   * «Dial up modem noises.ogg», public domain.
   * Грузим лениво и играем редко — это фон, а не событие.
   */
  private loadModem(): void {
    if (this.modem || this.modemLoading) return
    const ctx = this.ctx
    if (!ctx) return
    this.modemLoading = true
    fetch('sounds/modem.ogg')
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error('нет файла'))))
      .then((buffers) => ctx.decodeAudioData(buffers))
      .then((buf) => {
        this.modem = buf
      })
      .catch(() => {
        // без Ogg (Safari) или без файла просто живём без модема
      })
  }

  private scheduleModem(delaySec: number): void {
    window.setTimeout(() => {
      this.playModem()
      this.scheduleModem(110 + Math.random() * 150)
    }, delaySec * 1000)
  }

  private playModem(): void {
    const ctx = this.ctx
    const out = this.master
    if (!ctx || !out || !this.modem) return
    const src = ctx.createBufferSource()
    src.buffer = this.modem
    // тихо и глухо: модем «за стеной», а не в наушниках
    const lp = ctx.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.value = 3400
    const env = ctx.createGain()
    const t = ctx.currentTime
    env.gain.setValueAtTime(0.0001, t)
    env.gain.linearRampToValueAtTime(0.05, t + 1.2)
    env.gain.setValueAtTime(0.05, t + Math.max(1.3, this.modem.duration - 1.6))
    env.gain.linearRampToValueAtTime(0.0001, t + this.modem.duration)
    src.connect(lp).connect(env).connect(out)
    src.start(t)
  }
  // ── дыхание девушки ──────────────────────────────────────────────

  /**
   * Реальная запись испуганного дыхания (Freesound, Aquillx «Scared
   * Breathing», CC BY 4.0), лупится из динамиков монитора, пока открыта
   * камера. Стресс рулит громкостью и темпом воспроизведения. null — тишина.
   */
  setBreathing(stress: number | null): void {
    this.breathStress = stress
    const ctx = this.ctx
    if (!ctx) return
    const t = ctx.currentTime

    if (stress === null) {
      if (!this.breathSrc) return
      if (this.breathSrc && this.breathGain) {
        const g = this.breathGain
        const src = this.breathSrc
        g.gain.cancelScheduledValues(t)
        g.gain.setValueAtTime(Math.max(g.gain.value, 0.0001), t)
        g.gain.linearRampToValueAtTime(0.0001, t + 0.6)
        window.setTimeout(() => {
          try {
            src.stop()
          } catch {
            /* уже остановлен */
          }
        }, 700)
      }
      this.breathSrc = null
      this.breathGain = null
      return
    }

    if (!this.breathSrc) {
      if (!this.breath) {
        this.loadBreath()
        return
      }
      const src = ctx.createBufferSource()
      src.buffer = this.breath
      src.loop = true
      const g = ctx.createGain()
      g.gain.value = 0.0001
      src.connect(g).connect(this.master!)
      src.start(t)
      this.breathSrc = src
      this.breathGain = g
    }

    const g = this.breathGain!
    g.gain.cancelScheduledValues(t)
    g.gain.setValueAtTime(Math.max(g.gain.value, 0.0001), t)
    g.gain.linearRampToValueAtTime(0.05 + stress * 0.13, t + 0.8)
    this.breathSrc!.playbackRate.value = 0.92 + stress * 0.28
  }

  private loadBreath(): void {
    const ctx = this.ctx
    if (!ctx || this.breath || this.breathLoading) return
    this.breathLoading = true
    fetch('sounds/breath.mp3')
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error('нет файла'))))
      .then((b) => ctx.decodeAudioData(b))
      .then((buf) => {
        this.breath = buf
        // к моменту загрузки камера могла уже открыться — запускаем сразу
        if (this.breathStress !== null) this.setBreathing(this.breathStress)
      })
      .catch(() => {
        this.breathLoading = false
      })
  }

  // ── скрип пола за спиной ─────────────────────────────────────────

  /**
   * Скрип деревянного пола сзади оператора: настоящая запись шага по старому
   * дереву (Freesound, Rudmer_Rotteveel «Wood Creak Single V10», CC0),
   * играется изредка через HRTF-паннер позади слушателя — в наушниках понятно,
   * что скрипят за спиной. Громкость средняя: заметно, но без акцента.
   */
  private loadCreak(): void {
    const ctx = this.ctx
    if (!ctx || this.creak || this.creakLoading) return
    this.creakLoading = true
    fetch('sounds/creak.mp3')
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error('нет файла'))))
      .then((b) => ctx.decodeAudioData(b))
      .then((buf) => {
        this.creak = buf
      })
      .catch(() => {
        this.creakLoading = false
        // без файла просто живём без скрипов
      })
  }

  private scheduleCreak(delaySec: number): void {
    window.setTimeout(() => {
      this.playCreak()
      this.scheduleCreak(24 + Math.random() * 32)
    }, delaySec * 1000)
  }

  private playCreak(): void {
    const ctx = this.ctx
    const out = this.master
    if (!ctx || !out || !this.creak) return
    this.playOneCreak()
    // иногда скрипнет пару раз подряд, как человек, переступающий с ноги на ногу
    if (Math.random() < 0.45) this.playOneCreak(0.7 + Math.random() * 0.6)
  }

  private playOneCreak(when = 0): void {
    const ctx = this.ctx
    const out = this.master
    if (!ctx || !out || !this.creak) return
    const src = ctx.createBufferSource()
    src.buffer = this.creak
    src.playbackRate.value = 0.9 + Math.random() * 0.25
    const panner = ctx.createPanner()
    panner.panningModel = 'HRTF'
    panner.refDistance = 1
    panner.rolloffFactor = 0.3
    if (panner.positionX) {
      panner.positionX.value = 0.5
      panner.positionY.value = -0.3
      panner.positionZ.value = 2.2 // сзади: слушатель смотрит в -Z
    } else {
      panner.setPosition(0.5, -0.3, 2.2)
    }
    const env = ctx.createGain()
    const t = ctx.currentTime + when
    const dur = this.creak.duration / src.playbackRate.value
    env.gain.setValueAtTime(0.0001, t)
    env.gain.linearRampToValueAtTime(0.4, t + 0.05)
    env.gain.setValueAtTime(0.4, t + dur - 0.15)
    env.gain.linearRampToValueAtTime(0.0001, t + dur)
    src.connect(panner).connect(env).connect(out)
    src.start(t)
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
