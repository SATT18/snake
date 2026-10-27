// Пресеты качества графики. На телефонах по умолчанию выключены дорогие эффекты
// (GTAO, постобработка), снижено разрешение рендера, тени и плотность травы.

export type QualityLevel = "low" | "medium" | "high";
export type QualitySetting = "auto" | QualityLevel;

export interface QualityPreset {
  pixelRatio: number; // потолок для devicePixelRatio
  postprocessing: boolean; // HDR-буфер + bloom; без него рисуем сразу на экран
  ao: boolean; // GTAO — самый дорогой проход
  msaa: number; // сэмплы MSAA во внеэкранном буфере
  shadowMapSize: number;
  grassDensity: number; // доля травинок и цветов
  maxFps: number; // 0 — без ограничения; на 120-герцовых телефонах ограничиваем 60
}

export const PRESETS: Record<QualityLevel, QualityPreset> = {
  low: { pixelRatio: 1, postprocessing: false, ao: false, msaa: 0, shadowMapSize: 1024, grassDensity: 0.3, maxFps: 60 },
  medium: { pixelRatio: 1.5, postprocessing: true, ao: false, msaa: 2, shadowMapSize: 2048, grassDensity: 0.6, maxFps: 60 },
  high: { pixelRatio: 2, postprocessing: true, ao: true, msaa: 4, shadowMapSize: 4096, grassDensity: 1, maxFps: 0 },
};

/** Уровень на ступень ниже — для автоматического снижения при просадке FPS. */
export const LOWER: Record<QualityLevel, QualityLevel | null> = { high: "medium", medium: "low", low: null };

export function detectQuality(): QualityLevel {
  const touch = window.matchMedia("(pointer: coarse)").matches;
  const small = Math.min(window.screen.width, window.screen.height) < 820;
  if (touch && small) return "low"; // телефон
  if (touch) return "medium"; // планшет
  return "high";
}

export const QUALITY_LABELS: Record<QualitySetting, string> = {
  auto: "авто",
  low: "низкая",
  medium: "средняя",
  high: "высокая",
};
