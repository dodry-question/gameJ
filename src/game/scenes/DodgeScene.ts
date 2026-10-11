/**
 * ИГРА-ЗАГЛУШКА: «Уклоняйся» (Dodge).
 *
 * Суть: управляешь квадратиком (WASD/стрелки), сверху падают красные кубики,
 * за секунду выживания — 1 очко, столкновение — game over.
 *
 * Зачем она: проверка движка — ВВОД (клавиатура), ФИЗИКА/КОЛЛИЗИИ (arcade),
 * ТАЙМЕРЫ (спавн, счёт), СПАВН объектов и ПЕРЕДАЧА СЧЁТА из Phaser в HTML-HUD.
 *
 * ╔═══════════════════════════════════════════════════════════════════════╗
 * ║ КАК УДАЛИТЬ ЭТУ ИГРУ (30 секунд, ничего больше не трогать):          ║
 * ║   1) удали файл src/game/scenes/DodgeScene.ts;                       ║
 * ║   2) в src/game/scenes/index.ts убери импорт и строку из SCENES,     ║
 * ║      поставь там свою сцену (см. README, «Как добавить свою игру»).   ║
 * ║ Обёртка (src/game/index.ts), меню, настройки и скины НЕ ЗАВИСЯТ      ║
 * ║ от этой сцены — их трогать не нужно.                                  ║
 * ╚═══════════════════════════════════════════════════════════════════════╝
 */
import Phaser from 'phaser'
import { audio } from '../../audio/audio'
import { JAM_REGISTRY_KEY } from './types'
import type { GameSceneApi, JamData } from './types'

/* ------------------------------------------------------------- константы */
const PLAYER_SIZE = 26
const MOVE_SPEED = 340 // px/сек — скорость игрока
const CUBE_MIN = 22 // мин/макс размер кубика
const CUBE_MAX = 40
const FALL_START = 230 // стартовая скорость падения px/сек
const FALL_MAX = 620 // потолок скорости
const FALL_RAMP = 7 // насколько скорость растёт за секунду игры
const SPAWN_START = 0.95 // стартовый интервал между спавнами (сек)
const SPAWN_MIN = 0.3 // минимальный интервал

interface Cube {
  rect: Phaser.GameObjects.Rectangle
}

export class DodgeScene extends Phaser.Scene implements GameSceneApi {
  private colors: JamData['colors'] = {
    bg: 0x140d31,
    accent: 0x4ff2ff,
    accent2: 0xff5ed6,
    danger: 0xff4d6d,
    text: 0x9aa2d4,
    line: 0x3a2a86,
  }
  private hooks: JamData['hooks'] = { onScore: () => {}, onGameOver: () => {} }

  private player: Phaser.GameObjects.Rectangle | null = null
  private cubes: Cube[] = []
  private keys: Record<string, Phaser.Input.Keyboard.Key> | null = null

  private running = false
  private score = 0 // живые секунды = очки
  private lastEmittedScore = -1
  private spawnIn = SPAWN_START
  private fallSpeed = FALL_START

  constructor() {
    super({ key: 'Dodge' })
  }

  create(): void {
    const data = this.registry.get(JAM_REGISTRY_KEY) as JamData | undefined
    if (data) {
      this.colors = data.colors
      this.hooks = data.hooks
    }

    // игрок: квадрат с физическим телом (arcade)
    const p = this.add.rectangle(this.scale.width / 2, this.scale.height - 80, PLAYER_SIZE, PLAYER_SIZE, this.colors.accent)
    this.physics.add.existing(p)
    const body = p.body as Phaser.Physics.Arcade.Body
    body.setCollideWorldBounds(true)
    this.player = p

    // ввод: WASD и стрелки (Phaser сам слушает клавиатуру сцены)
    this.keys = (this.input.keyboard?.addKeys('W,A,S,D,UP,LEFT,RIGHT,DOWN') ??
      null) as Record<string, Phaser.Input.Keyboard.Key> | null

    this.scale.on('resize', this.onResize, this)
  }

  /* ---------------------------------------------------- GameSceneApi ---- */

  startRun(): void {
    this.clearCubes()
    this.score = 0
    this.lastEmittedScore = -1
    this.spawnIn = SPAWN_START
    this.fallSpeed = FALL_START
    this.running = true
    this.player?.setPosition(this.scale.width / 2, this.scale.height - 80)
    ;(this.player?.body as Phaser.Physics.Arcade.Body | undefined)?.setVelocity(0, 0)
    this.hooks.onScore(0)
    this.physics.world.resume()
  }

  onPress(): void {
    // в этой игре действие не нужно (движение — на WASD), но контракт есть:
    // если сменить игру на «прыгалку», место для прыжка уже готово
  }

  onRelease(): void {}

  /* ------------------------------------------------------- внутренности - */

  private onResize(): void {
    // при смене размера вкладки игрока «прижимаем» обратно в границы экрана
    if (!this.player) return
    this.player.setPosition(
      Phaser.Math.Clamp(this.player.x, PLAYER_SIZE / 2, this.scale.width - PLAYER_SIZE / 2),
      Phaser.Math.Clamp(this.player.y, PLAYER_SIZE / 2, this.scale.height - PLAYER_SIZE / 2),
    )
    const b = this.player.body as Phaser.Physics.Arcade.Body | undefined
    b?.reset(this.player.x, this.player.y)
  }

  private clearCubes(): void {
    for (const c of this.cubes) c.rect.destroy()
    this.cubes = []
  }

  private spawnCube(): void {
    const size = Phaser.Math.Between(CUBE_MIN, CUBE_MAX)
    const x = Phaser.Math.Between(size / 2, this.scale.width - size / 2)
    const rect = this.add.rectangle(x, -size, size, size, this.colors.danger)
    this.physics.add.existing(rect)
    const body = rect.body as Phaser.Physics.Arcade.Body
    body.setVelocityY(this.fallSpeed)
    this.cubes.push({ rect })
  }

  private gameOver(): void {
    this.running = false
    this.physics.world.pause()
    audio.play('hit')
    this.hooks.onGameOver(Math.floor(this.score))
  }

  /* ------------------------------------------------------------- update - */

  update(_time: number, deltaMs: number): void {
    const dt = Math.min(0.05, deltaMs / 1000)
    if (!this.running || !this.player || !this.keys) return

    // 1) ВВОД: клавиши → вектор скорости игрока
    const body = this.player.body as Phaser.Physics.Arcade.Body
    const left = this.keys.A.isDown || this.keys.LEFT.isDown
    const right = this.keys.D.isDown || this.keys.RIGHT.isDown
    const up = this.keys.W.isDown || this.keys.UP.isDown
    const down = this.keys.S.isDown || this.keys.DOWN.isDown
    body.setVelocity((Number(right) - Number(left)) * MOVE_SPEED, (Number(down) - Number(up)) * MOVE_SPEED)

    // 2) ТАЙМЕРЫ/СЛОЖНОСТЬ: счёт = живые секунды, скорость падения растёт
    this.score += dt
    this.fallSpeed = Math.min(FALL_MAX, this.fallSpeed + FALL_RAMP * dt)
    const whole = Math.floor(this.score)
    if (whole !== this.lastEmittedScore) {
      this.lastEmittedScore = whole
      this.hooks.onScore(whole) // 3) ПЕРЕДАЧА СЧЁТА в HTML-HUD
      if (whole > 0 && whole % 10 === 0) audio.play('score')
    }

    // 4) СПАВН: каждые spawnIn секунд новый кубик сверху
    this.spawnIn -= dt
    if (this.spawnIn <= 0) {
      this.spawnCube()
      this.spawnIn = Math.max(SPAWN_MIN, SPAWN_START - this.score * 0.015)
    }

    // уборка кубиков, улетевших за низ
    this.cubes = this.cubes.filter((c) => {
      if (c.rect.y > this.scale.height + 60) {
        c.rect.destroy()
        return false
      }
      return true
    })

    // 5) ФИЗИКА/КОЛЛИЗИИ: простой AABB-тест игрока с каждым кубиком
    const px = this.player.x - PLAYER_SIZE / 2
    const py = this.player.y - PLAYER_SIZE / 2
    for (const c of this.cubes) {
      const half = (c.rect.width * c.rect.scaleX) / 2
      const cx = c.rect.x - half
      const cy = c.rect.y - half
      if (px < cx + half * 2 && px + PLAYER_SIZE > cx && py < cy + half * 2 && py + PLAYER_SIZE > cy) {
        this.gameOver()
        return
      }
    }
  }

  /** На всякий случай — Phaser мог пересоздать сцену */
  shutdown(): void {
    this.scale.off('resize', this.onResize, this)
    this.clearCubes()
    this.player = null
    this.keys = null
  }
}
