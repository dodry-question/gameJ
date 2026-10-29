/**
 * Звук без ассетов: короткие пищащие клики «системы 2000» и гул комнаты.
 * Всё синтезируется в WebAudio, поэтому билд ничего не весит.
 */

type Wave = OscillatorType

export class Sound {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
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
      master.connect(ctx.destination)
      this.ctx = ctx
      this.master = master
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

  private tone(freq: number, dur: number, type: Wave, gain: number, slideTo?: number): void {
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

  click(): void {
    this.tone(1400, 0.035, 'square', 0.05)
  }

  open(): void {
    this.tone(660, 0.06, 'square', 0.04)
    window.setTimeout(() => this.tone(990, 0.09, 'square', 0.035), 55)
  }

  close(): void {
    this.tone(700, 0.07, 'square', 0.035, 420)
  }

  error(): void {
    this.tone(220, 0.16, 'square', 0.05)
    window.setTimeout(() => this.tone(180, 0.2, 'square', 0.045), 120)
  }

  message(): void {
    this.tone(880, 0.05, 'triangle', 0.04)
    window.setTimeout(() => this.tone(1320, 0.08, 'triangle', 0.03), 70)
  }

  private thud(): void {
    this.tone(58, 0.6, 'sine', 0.06, 34)
  }
}
