/**
 * РЕЕСТР СЦЕН — единственное место, куда добавляются новые сцены.
 *
 * Хочешь новую игру:
 *   1) создай файл рядом (MyScene.ts), напиши `class MyScene extends Phaser.Scene`;
 *   2) добавь импорт и строку в SCENES ниже — Phaser подхватит;
 *   3) основная сцена запускается по ключу MAIN_SCENE_KEY.
 *
 * Текущая заглушка — DodgeScene («уклоняйся»). Удалить её: убери строку
 * отсюда и файл DodgeScene.ts — обёртка от неё не зависит.
 */
import { DodgeScene } from './DodgeScene'

export const SCENES = [DodgeScene]

/** Ключ основной сцены, которую монтирует меню */
export const MAIN_SCENE_KEY = 'Dodge'
