// Ввод: клавиатура и жесты на сенсорном экране.
import type { Direction } from "./game.js";

export interface InputHandlers {
  key(code: string, event: KeyboardEvent): void;
  /** Свайп в экранных направлениях: up — вверх по экрану. */
  swipe(direction: Direction): void;
  tap(): void;
}

const SWIPE_MIN = 30; // пикселей

export function bindInput(target: Window, handlers: InputHandlers): void {
  target.addEventListener("keydown", (e) => handlers.key(e.code, e));

  let start: { x: number; y: number } | null = null;
  target.addEventListener(
    "touchstart",
    (e) => {
      start = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    },
    { passive: true },
  );
  target.addEventListener("touchend", (e) => {
    if (!start) return;
    const dx = e.changedTouches[0].clientX - start.x;
    const dy = e.changedTouches[0].clientY - start.y;
    start = null;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < SWIPE_MIN) {
      handlers.tap();
      return;
    }
    if (Math.abs(dx) > Math.abs(dy)) handlers.swipe(dx > 0 ? "right" : "left");
    else handlers.swipe(dy > 0 ? "down" : "up");
  });
}

export const isTouchDevice = (): boolean => window.matchMedia("(pointer: coarse)").matches;
