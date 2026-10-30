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
  private breath: AudioBuffer | null = null
  private breathLoading = false
  private breathStress: number | null = null
  private breathSrc: AudioBufferSourceNode | null = null
  private breathGain: GainNode | null = null
  /** Тихая шина звуков с камеры: капли, гул подвала, голос девушки. */
  private camBus: GainNode | null = null
  private camGate: GainNode | null = null
  private camOn = false
  private camDripTimer: number | null = null
  private camVoiceTimer: number | null = null
  private camVoices: { hum: AudioBuffer | null; cry: AudioBuffer | null } = { hum: null, cry: null }
  private camVoiceLoading = false
  private camDrone = false
  private started = false
  /** Общая громкость игры: 1 — максимум, с которого стартуем. */
  private level = storedVolume()

  get volume(): number {
    return this.level
  }

  /** Общая громкость 0…1: ползунок в панели задач. */
  setVolume(v: number): void {
    this.level = Math.min(1, Math.max(0, v))
    try {
      localStorage.setItem(VOLUME_KEY, String(this.level))
    } catch {
      // приватный режим без localStorage — громкость просто не запомнится
    }
    const ctx = this.ctx
    const master = this.master
    if (!ctx || !master) return
    const t = ctx.currentTime
    master.gain.cancelScheduledValues(t)
    master.gain.setValueAtTime(master.gain.value, t)
    master.gain.linearRampToValueAtTime(this.level, t + 0.08)
  }

  /** Вызывать на первом клике: браузеры не дают создать звук раньше. */
  ensure(): void {
    if (this.started) return
    this.started = true
    try {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      const ctx = new Ctor()
      const master = ctx.createGain()
      master.gain.value = this.level

      // сухая шина + немного «комнаты», иначе колокольчики звучат как в вакууме
      const dry = ctx.createGain()
      dry.gain.value = 1
      const wet = ctx.createGain()
      wet.gain.value = 0.16
      const verb = ctx.createConvolver()
      verb.buffer = impulse(ctx)

      // limiter: на полной громкости пики не должны хрипеть
      const limiter = ctx.createDynamicsCompressor()
      limiter.threshold.value = -10
      limiter.knee.value = 8
      limiter.ratio.value = 12
      limiter.attack.value = 0.003
      limiter.release.value = 0.25

      master.connect(dry).connect(limiter)
      master.connect(verb).connect(wet).connect(limiter)
      limiter.connect(ctx.destination)

      this.ctx = ctx
      this.master = master
      this.noise = noiseBuffer(ctx)
      this.cameraBus()
      this.loadAmbient()
      this.loadModem()
      this.scheduleModem(28 + Math.random() * 26)
      this.scheduleSteps(18 + Math.random() * 22)
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
      src.connect(g).connect(this.cameraBus() ?? this.master!)
      src.start(t)
      this.breathSrc = src
      this.breathGain = g
    }

    const g = this.breathGain!
    g.gain.cancelScheduledValues(t)
    g.gain.setValueAtTime(Math.max(g.gain.value, 0.0001), t)
    // дыхание идёт через шину камеры: тише компьютера, как из динамика монитора
    g.gain.linearRampToValueAtTime(0.25 + stress * 0.35, t + 0.8)
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

  // ── шаги за спиной ───────────────────────────────────────────────

  /**
   * Редкие тихие шаги за спиной оператора: синтезированные (шорох подошвы +
   * глухой удар пятки) через HRTF-паннер. Каждая серия — случайное число шагов,
   * которые смещаются с одного бока на другой, поэтому звук «ходит» вокруг
   * головы. Громкость маленькая: не раздражать, а заставлять оборачиваться.
   */
  private scheduleSteps(delaySec: number): void {
    window.setTimeout(() => {
      this.walkBehind()
      this.scheduleSteps(30 + Math.random() * 55)
    }, delaySec * 1000)
  }

  private walkBehind(): void {
    if (!this.ctx || !this.master || !this.noise) return
    const count = 3 + Math.floor(Math.random() * 6) // 3–8 шагов
    const side = Math.random() < 0.5 ? -1 : 1
    let when = 0
    let x = side * (1.5 + Math.random() * 0.5)
    let z = 1.9 + Math.random() * 0.9
    const stride = 2.4 + Math.random() * 0.8
    for (let i = 0; i < count; i++) {
      when += 0.5 + Math.random() * 0.16
      // идёт наискось: звук перетекает от одного уха к другому
      x -= side * (stride / count) * (0.8 + Math.random() * 0.5)
      z += (Math.random() - 0.5) * 0.14
      this.footstep(when, x, z)
      if (Math.random() < 0.12) when += 0.5 + Math.random() * 0.7 // замер
    }
  }

  private footstep(when: number, x: number, z: number): void {
    const ctx = this.ctx
    const out = this.master
    if (!ctx || !out || !this.noise) return
    const t = ctx.currentTime + when

    const panner = ctx.createPanner()
    panner.panningModel = 'HRTF'
    panner.distanceModel = 'inverse'
    panner.refDistance = 1
    panner.rolloffFactor = 0.45
    if (panner.positionX) {
      panner.positionX.value = x
      panner.positionY.value = -0.2
      panner.positionZ.value = z // сзади: слушатель смотрит в -Z
    } else {
      panner.setPosition(x, -0.2, z)
    }
    panner.connect(out)

    const peak = 0.09 + Math.random() * 0.04

    // шорох подошвы по полу
    const src = ctx.createBufferSource()
    src.buffer = this.noise
    src.playbackRate.value = 0.85 + Math.random() * 0.3
    const lp = ctx.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.value = 420 + Math.random() * 260
    const env = ctx.createGain()
    env.gain.setValueAtTime(0.0001, t)
    env.gain.linearRampToValueAtTime(peak, t + 0.008)
    env.gain.exponentialRampToValueAtTime(0.0001, t + 0.13)
    src.connect(lp).connect(env).connect(panner)
    src.start(t)
    src.stop(t + 0.16)

    // глухой удар пятки — низкий, почти без тона
    const thump = ctx.createOscillator()
    thump.type = 'sine'
    thump.frequency.setValueAtTime(95 + Math.random() * 25, t)
    thump.frequency.exponentialRampToValueAtTime(46, t + 0.1)
    const tg = ctx.createGain()
    tg.gain.setValueAtTime(0.0001, t)
    tg.gain.linearRampToValueAtTime(peak * 0.8, t + 0.012)
    tg.gain.exponentialRampToValueAtTime(0.0001, t + 0.14)
    thump.connect(tg).connect(panner)
    thump.start(t)
    thump.stop(t + 0.16)
  }

  // ── звуки с камеры ───────────────────────────────────────────────

  /**
   * Что слышит микрофон камеры: тихий гул подвала, редкие капли воды, голос
   * девушки. Всё это идёт через отдельную шину — глухую и на порядок тише
   * звуков компьютера, чтобы игрок не путал запись с тем, что у него самого.
   * Шина открывается, только пока на экране страница КАМ-04.
   */
  setCameraAudio(on: boolean): void {
    if (this.camOn === on) return
    this.camOn = on
    const ctx = this.ctx
    const gate = this.cameraGate()
    if (!ctx || !gate) return
    const t = ctx.currentTime
    gate.gain.cancelScheduledValues(t)
    gate.gain.setValueAtTime(Math.max(gate.gain.value, 0.0001), t)
    if (on) {
      gate.gain.linearRampToValueAtTime(CAM_LEVEL, t + 1.2)
      this.startCameraDrone()
      this.loadCameraVoice()
      this.scheduleDrips(1 + Math.random() * 2)
      this.scheduleVoice(8 + Math.random() * 9)
    } else {
      gate.gain.linearRampToValueAtTime(0.0001, t + 0.8)
      if (this.camDripTimer !== null) window.clearTimeout(this.camDripTimer)
      if (this.camVoiceTimer !== null) window.clearTimeout(this.camVoiceTimer)
      this.camDripTimer = null
      this.camVoiceTimer = null
    }
  }

  private cameraGate(): GainNode | null {
    this.cameraBus()
    return this.camGate
  }

  /**
   * Шина камеры: узкая полоса, как маленький динамик монитора (без низа и
   * верха), короткое эхо бетонного коридора и общий уровень CAM_LEVEL.
   */
  private cameraBus(): GainNode | null {
    if (!this.ctx || !this.master) return null
    if (this.camGate) return this.camBus
    const ctx = this.ctx
    const bus = ctx.createGain()
    const hp = ctx.createBiquadFilter()
    hp.type = 'highpass'
    hp.frequency.value = 170
    const lp = ctx.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.value = 2400
    const gate = ctx.createGain()
    gate.gain.value = 0.0001
    const echo = ctx.createDelay(0.4)
    echo.delayTime.value = 0.12
    const fb = ctx.createGain()
    fb.gain.value = 0.24
    const wet = ctx.createGain()
    wet.gain.value = 0.35
    bus.connect(hp).connect(lp)
    lp.connect(gate)
    lp.connect(echo)
    echo.connect(fb).connect(echo)
    echo.connect(wet).connect(gate)
    gate.connect(this.master)
    this.camBus = bus
    this.camGate = gate
    return bus
  }

  /** Гул подвала: два слоя шума вразнобой, чтобы петля не читалась. */
  private startCameraDrone(): void {
    const ctx = this.ctx
    const bus = this.cameraBus()
    if (!ctx || !bus || this.camDrone || !this.noise) return
    this.camDrone = true
    for (const rate of [0.93, 1.07]) {
      const src = ctx.createBufferSource()
      src.buffer = this.noise
      src.loop = true
      src.playbackRate.value = rate
      const lp = ctx.createBiquadFilter()
      lp.type = 'lowpass'
      lp.frequency.value = 180 + rate * 40
      const g = ctx.createGain()
      g.gain.value = 0.16
      src.connect(lp).connect(g).connect(bus)
      src.start()
    }
    // далёкая труба: почти неслышный тон
    const hum = ctx.createOscillator()
    hum.type = 'sine'
    hum.frequency.value = 58
    const hg = ctx.createGain()
    hg.gain.value = 0.05
    hum.connect(hg).connect(bus)
    hum.start()
  }

  private scheduleDrips(delaySec: number): void {
    if (!this.camOn) return
    this.camDripTimer = window.setTimeout(() => {
      this.camDripTimer = null
      if (!this.camOn) return
      this.waterDrip(0)
      if (Math.random() < 0.22) this.waterDrip(0.16 + Math.random() * 0.22)
      this.scheduleDrips(2.4 + Math.random() * 4.8)
    }, delaySec * 1000)
  }

  /** Капля в лужу: короткий «плинк» с падением тона и брызгами поверх. */
  private waterDrip(when: number): void {
    const ctx = this.ctx
    const bus = this.camBus
    if (!ctx || !bus || !this.noise) return
    const t = ctx.currentTime + when + 0.01

    const f = 520 + Math.random() * 760
    const osc = ctx.createOscillator()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(f, t)
    osc.frequency.exponentialRampToValueAtTime(f * 0.42, t + 0.055)
    const env = ctx.createGain()
    env.gain.setValueAtTime(0.0001, t)
    env.gain.linearRampToValueAtTime(0.34 + Math.random() * 0.16, t + 0.004)
    env.gain.exponentialRampToValueAtTime(0.0001, t + 0.11)
    osc.connect(env).connect(bus)
    osc.start(t)
    osc.stop(t + 0.14)

    const src = ctx.createBufferSource()
    src.buffer = this.noise
    src.playbackRate.value = 1.6 + Math.random() * 0.8
    const bp = ctx.createBiquadFilter()
    bp.type = 'bandpass'
    bp.frequency.value = 1600 + Math.random() * 1600
    bp.Q.value = 1.4
    const sg = ctx.createGain()
    sg.gain.setValueAtTime(0.0001, t)
    sg.gain.linearRampToValueAtTime(0.08, t + 0.005)
    sg.gain.exponentialRampToValueAtTime(0.0001, t + 0.05)
    src.connect(bp).connect(sg).connect(bus)
    src.start(t)
    src.stop(t + 0.08)
  }

  /**
   * Голос с камеры: она тихо напевает себе под нос (CC0, PSsoundproject,
   * Freesound 183565) или, когда совсем плохо, сдавленно всхлипывает
   * (CC0, AlucardsBride). Короткими обрывками и очень тихо.
   */
  cameraVoice(kind?: 'hum' | 'cry'): void {
    const ctx = this.ctx
    const bus = this.camBus
    if (!ctx || !bus) return
    const stressed = this.breathStress !== null && this.breathStress > 0.8
    const cry = kind === 'cry' || (kind !== 'hum' && stressed && Math.random() < 0.45)
    const buf = cry ? this.camVoices.cry : this.camVoices.hum
    if (!buf) {
      this.loadCameraVoice()
      return
    }
    const t = ctx.currentTime
    const dur = Math.min(buf.duration - 0.25, cry ? 3.2 + Math.random() * 2.4 : 5 + Math.random() * 4)
    const offset = Math.random() * Math.max(0.1, buf.duration - dur - 0.2)
    const src = ctx.createBufferSource()
    src.buffer = buf
    src.playbackRate.value = 0.96 + Math.random() * 0.08
    const lp = ctx.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.value = 1900
    const g = ctx.createGain()
    const peak = cry ? 0.2 : 0.28
    g.gain.setValueAtTime(0.0001, t)
    g.gain.linearRampToValueAtTime(peak, t + 0.7)
    g.gain.setValueAtTime(peak, t + Math.max(0.8, dur - 0.8))
    g.gain.linearRampToValueAtTime(0.0001, t + dur)
    src.connect(lp).connect(g).connect(bus)
    src.start(t, offset, dur)
  }

  private scheduleVoice(delaySec: number): void {
    if (!this.camOn) return
    this.camVoiceTimer = window.setTimeout(() => {
      this.camVoiceTimer = null
      if (!this.camOn) return
      this.cameraVoice()
      this.scheduleVoice(24 + Math.random() * 30)
    }, delaySec * 1000)
  }

  private loadCameraVoice(): void {
    const ctx = this.ctx
    if (!ctx || this.camVoiceLoading) return
    if (this.camVoices.hum && this.camVoices.cry) return
    this.camVoiceLoading = true
    const load = (file: string, key: 'hum' | 'cry'): void => {
      fetch(`sounds/voice/${file}`)
        .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error('нет файла'))))
        .then((b) => ctx.decodeAudioData(b))
        .then((buf) => {
          this.camVoices[key] = buf
        })
        .catch(() => {
          // без голоса живём: капли и гул всё равно есть
        })
    }
    load('hum.wav', 'hum')
    load('cry.ogg', 'cry')
  }
}

// ── буферы ─────────────────────────────────────────────────────────

/** Громкость шины камеры: примерно на порядок ниже звуков компьютера. */
const CAM_LEVEL = 0.09

const VOLUME_KEY = 'sound.volume'

/** Громкость из прошлой сессии; по умолчанию — максимум. */
function storedVolume(): number {
  try {
    const raw = localStorage.getItem(VOLUME_KEY)
    if (raw === null) return 1
    const v = Number(raw)
    if (Number.isFinite(v)) return Math.min(1, Math.max(0, v))
  } catch {
    // приватный режим без localStorage
  }
  return 1
}

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
