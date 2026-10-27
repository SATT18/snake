// Уровни описаны данными: препятствия, темп, цель и время суток.
// Поле 20×20, змейка стартует в (10,10) головой вправо — ряд 10 перед ней оставляем свободным.
import type { GameConfig, Point } from "./game.js";
import type { ThemeName } from "./themes.js";

export type ObstacleKind = "hedge" | "rock";

export interface Obstacle extends Point {
  kind: ObstacleKind;
}

export interface LevelDef {
  id: number;
  name: string;
  description: string;
  theme: ThemeName;
  goal: number;
  tickStart: number;
  tickMin: number;
  speedup: number;
  stars: [three: number, two: number]; // пороги времени в секундах
  obstacles: Obstacle[];
}

const hline = (x1: number, x2: number, y: number): Obstacle[] =>
  Array.from({ length: x2 - x1 + 1 }, (_, i) => ({ x: x1 + i, y, kind: "hedge" }));

const vline = (x: number, y1: number, y2: number): Obstacle[] =>
  Array.from({ length: y2 - y1 + 1 }, (_, i) => ({ x, y: y1 + i, kind: "hedge" }));

const rocks = (...points: [number, number][]): Obstacle[] => points.map(([x, y]) => ({ x, y, kind: "rock" }));

export const LEVELS: LevelDef[] = [
  {
    id: 1,
    name: "Зелёная долина",
    description: "Разминка: ровное поле и неспешный темп.",
    theme: "day",
    goal: 8,
    tickStart: 230,
    tickMin: 190,
    speedup: 5,
    stars: [45, 75],
    obstacles: [],
  },
  {
    id: 2,
    name: "Каменный сад",
    description: "Между плитками разбросаны валуны — не врежьтесь.",
    theme: "day",
    goal: 10,
    tickStart: 220,
    tickMin: 180,
    speedup: 4,
    stars: [60, 100],
    obstacles: rocks(
      [13, 2], [6, 4], [12, 4], [10, 6], [3, 7], [16, 7],
      [2, 12], [10, 13], [17, 13], [5, 14], [12, 15], [7, 17],
    ),
  },
  {
    id: 3,
    name: "Живой лабиринт",
    description: "Изгороди делят поле на коридоры и углы.",
    theme: "afternoon",
    goal: 12,
    tickStart: 210,
    tickMin: 170,
    speedup: 3,
    stars: [75, 120],
    obstacles: [
      ...hline(3, 7, 3), ...vline(3, 4, 7),
      ...hline(12, 16, 3), ...vline(16, 4, 7),
      ...hline(3, 7, 16), ...vline(3, 12, 15),
      ...hline(12, 16, 16), ...vline(16, 12, 15),
      ...hline(7, 12, 7), ...hline(7, 12, 13),
    ],
  },
  {
    id: 4,
    name: "Мельница на закате",
    description: "Крючья из кустов, камни и всё более быстрый темп.",
    theme: "sunset",
    goal: 14,
    tickStart: 200,
    tickMin: 160,
    speedup: 3,
    stars: [90, 140],
    obstacles: [
      ...hline(2, 6, 5), ...vline(6, 6, 8),
      ...hline(13, 17, 5), ...vline(13, 2, 4),
      ...hline(13, 17, 14), ...vline(13, 15, 17),
      ...hline(2, 6, 14), ...vline(6, 11, 13),
      ...rocks([10, 3], [3, 10], [10, 17], [1, 1], [18, 18], [1, 18], [18, 1], [8, 13], [12, 7]),
    ],
  },
  {
    id: 5,
    name: "Лунный лабиринт",
    description: "Финал: коридоры под луной и самая быстрая змейка.",
    theme: "night",
    goal: 16,
    tickStart: 190,
    tickMin: 150,
    speedup: 2.5,
    stars: [110, 170],
    obstacles: [
      ...hline(2, 8, 3), ...hline(11, 17, 3),
      ...hline(2, 8, 16), ...hline(11, 17, 16),
      ...vline(2, 6, 13),
      ...vline(17, 6, 8), ...vline(17, 12, 13),
      ...hline(6, 13, 7), ...hline(6, 13, 13),
      ...rocks([4, 5], [15, 5], [4, 14], [15, 14], [10, 1], [10, 18], [1, 10]),
    ],
  },
];

export function levelConfig(level: LevelDef, cols: number, rows: number): GameConfig {
  return {
    cols,
    rows,
    obstacles: level.obstacles,
    goal: level.goal,
    tickStart: level.tickStart,
    tickMin: level.tickMin,
    speedup: level.speedup,
  };
}

export function starsFor(level: LevelDef, seconds: number): number {
  if (seconds <= level.stars[0]) return 3;
  if (seconds <= level.stars[1]) return 2;
  return 1;
}
