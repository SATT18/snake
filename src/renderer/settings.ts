// Настройки игрока, сохраняются между запусками.

export type CameraMode = "classic" | "chase";

export interface Settings {
  camera: CameraMode; // classic — без вращения, chase — за спиной змейки
  shake: boolean; // тряска камеры при столкновении
}

const KEY = "snake.settings.v1";
const DEFAULTS: Settings = { camera: "classic", shake: true };

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
