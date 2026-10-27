// Результаты прохождения уровней, сохраняются между запусками.

export interface LevelResult {
  time: number; // лучшее время, секунды
  stars: number;
}

export type Progress = Record<number, LevelResult>;

const KEY = "snake.progress.v1";

export function loadProgress(): Progress {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Progress) : {};
  } catch {
    return {};
  }
}

/** Сохраняет результат, если он лучше прежнего. */
export function saveResult(id: number, time: number, stars: number): { newRecord: boolean } {
  const progress = loadProgress();
  const old = progress[id];
  const newRecord = !old || time < old.time;
  progress[id] = {
    time: newRecord ? time : old.time,
    stars: Math.max(stars, old?.stars ?? 0),
  };
  try {
    localStorage.setItem(KEY, JSON.stringify(progress));
  } catch {
    // результат просто не сохранится
  }
  return { newRecord };
}

export function resetProgress(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // нечего сбрасывать
  }
}

/** Первый уровень открыт всегда, остальные — после прохождения предыдущего. */
export function isUnlocked(progress: Progress, levelIds: number[], index: number): boolean {
  return index === 0 || progress[levelIds[index - 1]] !== undefined;
}
