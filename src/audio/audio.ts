/**
 * ЗВУК БЕЗ ЕДИНОГО АУДИОФАЙЛА — всё синтезируется WebAudio.
 * Плюс: ноль размер билда, звуки автоматически подстраиваются под громкость
 * из настроек. Минус: простейшие «блипы», не оркестр.
 *
 * Публичный API:
 *   audio.unlock()          — вызывается при первом клике/клавише (так требует браузер)
 *   audio.play('click')     — короткий эффект
 *   audio.sync()            — перечитать громкости из настроек
 *
 * Имена эффектов: hover, click, back, select, jump, hit, score
 */
import { getSettings, onSettingsChange } from '../settings/settings'

export type SfxName = 'hover' | 'click' | 'back' | 'select' | 'jump' | 'hit' | 'score'

/** Ноты малой пентатоники от ля (220 Гц), 16 шагов петли, null = пауза */
const MUSIC_PATTERN: (number | null)[] = [
  0, null, 7, null, 12, null, 7, null, 3, null, 10, null, 15, null, 12, null,
]
const MUSIC_BASS: (number | null)[] = [0, null, null, null, null, null, null, null, -2, null, null, null, null, null, 7, null]
const STEP_SECONDS = 0.3
const BASE_FREQ = 220

class AudioEngine {
  private ctx: AudioContext | null = null
  private sfxBus: GainNode | null = null
  private musicBus: GainNode | null = null
  private timer: number | null = null
  private nextStepAt = 0
  private stepIndex = 0
  private unlocked = false

  /** Запускается один раз из main.ts: первый жест пользователя = разрешение звука */
  init(): void {
    onSettingsChange(() => this.sync())
    const unlock = () => this.unlock()
    window.addEventListener('pointerdown', unlock, { once: true })
    window.addEventListener('keydown', unlock, { once: true })
    document.addEventListener('visibilitychange', () => {
      if (!this.ctx || !this.unlocked) return
      if (document.hidden) void this.ctx.suspend()
      else void this.ctx.resume()
    })
  }

  private ensure(): AudioContext | null {
    if (this.ctx) return this.ctx
    const w = window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }
    const Ctor = w.AudioContext ?? w.webkitAudioContext
    if (!Ctor) return null
    try {
      const ctx = new Ctor()
      const sfx = ctx.createGain()
      const music = ctx.createGain()
      sfx.connect(ctx.destination)
      music.connect(ctx.destination)
      this.ctx = ctx
      this.sfxBus = sfx
      this.musicBus = music
      this.sync()
      return ctx
    } catch {
      return null
    }
  }

  unlock(): void {
    const ctx = this.ensure()
    if (!ctx) return
    this.unlocked = true
    if (ctx.state === 'suspended') void ctx.resume()
    if (this.timer === null) {
      this.nextStepAt = ctx.currentTime + 0.1
      this.timer = window.setInterval(() => this.scheduleMusic(), 60)
    }
  }

  /** Подтянуть громкости из настроек (вызывается и автоматически, и вручную) */
  sync(): void {
    if (!this.ctx || !this.sfxBus || !this.musicBus) return
    const s = getSettings()
    const t = this.ctx.currentTime
    this.sfxBus.gain.setTargetAtTime(s.sfx * 0.55, t, 0.02)
    this.musicBus.gain.setTargetAtTime(s.music * 0.5, t, 0.05)
  }

  play(name: SfxName): void {
    if (!this.ctx || !this.sfxBus || getSettings().sfx <= 0) return
    switch (name) {
      case 'hover':
        this.tone('sine', 760, 900, 0.06, 0.05)
        break
      case 'click':
        this.tone('square', 520, 640, 0.08, 0.1)
        break
      case 'back':
        this.tone('square', 420, 260, 0.1, 0.09)
        break
      case 'select':
        this.tone('triangle', 660, 990, 0.12, 0.12)
        break
      case 'jump':
        this.tone('square', 300, 660, 0.12, 0.1)
        break
      case 'hit':
        this.tone('sawtooth', 240, 55, 0.38, 0.16)
        this.tone('square', 120, 40, 0.3, 0.08, 0.04)
        break
      case 'score':
        this.tone('sine', 880, 880, 0.1, 0.09)
        this.tone('sine', 1320, 1320, 0.14, 0.09, 0.09)
        break
    }
  }

  private tone(type: OscillatorType, from: number, to: number, dur: number, peak: number, delay = 0): void {
    const ctx = this.ctx
    const bus = this.sfxBus
    if (!ctx || !bus) return
    const t0 = ctx.currentTime + delay
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = type
    osc.frequency.setValueAtTime(from, t0)
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), t0 + dur)
    gain.gain.setValueAtTime(0.0001, t0)
    gain.gain.exponentialRampToValueAtTime(peak, t0 + 0.012)
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
    osc.connect(gain)
    gain.connect(bus)
    osc.start(t0)
    osc.stop(t0 + dur + 0.03)
  }

  /** Планировщик фоновой петли: смотрит на 0.25 секунды вперёд */
  private scheduleMusic(): void {
    const ctx = this.ctx
    if (!ctx || !this.musicBus || ctx.state !== 'running') return
    while (this.nextStepAt < ctx.currentTime + 0.25) {
      const i = this.stepIndex % MUSIC_PATTERN.length
      const melody = MUSIC_PATTERN[i]
      const bass = MUSIC_BASS[i]
      if (melody !== null) this.musicNote(BASE_FREQ * Math.pow(2, melody / 12), this.nextStepAt, 0.5, 0.1)
      if (bass !== null) this.musicNote(BASE_FREQ * Math.pow(2, bass / 12) / 2, this.nextStepAt, 1.1, 0.14, 'sine')
      this.nextStepAt += STEP_SECONDS
      this.stepIndex += 1
    }
  }

  private musicNote(freq: number, at: number, dur: number, peak: number, type: OscillatorType = 'triangle'): void {
    const ctx = this.ctx
    const bus = this.musicBus
    if (!ctx || !bus) return
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = type
    osc.frequency.setValueAtTime(freq, at)
    gain.gain.setValueAtTime(0.0001, at)
    gain.gain.exponentialRampToValueAtTime(peak, at + 0.05)
    gain.gain.exponentialRampToValueAtTime(0.0001, at + dur)
    osc.connect(gain)
    gain.connect(bus)
    osc.start(at)
    osc.stop(at + dur + 0.05)
  }
}

export const audio = new AudioEngine()
