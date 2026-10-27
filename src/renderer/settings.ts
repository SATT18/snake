// Настройки игрока, сохраняются между запусками.
import type { QualitySetting } from "./quality.js";

export type CameraMode = "classic" | "chase";

export interface Settings {
  camera: CameraMode; // classic — без вращения, chase — за спиной змейки
  shake: boolean; // тряска камеры при столкновении
  quality: QualitySetting; // auto — по устройству, с понижением при просадке FPS
}

const KEY = "snake.settings.v1";
const DEFAULTS: Settings = { camera: "classic", shake: true, quality: "auto" };

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Settings>) } : { ...DEFAULTS };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(settings: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    // настройки просто не сохранятся
  }
}
