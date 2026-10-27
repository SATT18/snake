import { Direction, SnakeGame } from "./game.js";

const COLS = 20;
const ROWS = 20;
const CELL = 28;
const BEST_KEY = "snake.best";

const canvas = document.getElementById("board") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;
const scoreEl = document.getElementById("score")!;
const bestEl = document.getElementById("best")!;
const overlay = document.getElementById("overlay")!;
const overlayTitle = document.getElementById("overlay-title")!;
const overlayText = document.getElementById("overlay-text")!;

canvas.width = COLS * CELL;
canvas.height = ROWS * CELL;

const game = new SnakeGame(COLS, ROWS);
let best = loadBest();

const KEYS: Record<string, Direction> = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
  KeyW: "up",
  KeyS: "down",
  KeyA: "left",
  KeyD: "right",
};

window.addEventListener("keydown", (e) => {
  const dir = KEYS[e.code];
  if (dir) {
    e.preventDefault();
    game.turn(dir);
  } else if (e.code === "Space" || e.code === "KeyP" || e.code === "Escape") {
    e.preventDefault();
    game.togglePause();
  } else if (e.code === "Enter" && game.status === "over") {
    game.reset();
  }
  updateUi();
});

// Игровой цикл: фиксированный тик логики, отрисовка каждый кадр.
let last = performance.now();
let acc = 0;

function loop(now: number): void {
  acc += now - last;
  last = now;

  while (acc >= game.tickMs) {
    acc -= game.tickMs;
    game.step();
    if (game.status === "over") {
      acc = 0;
      if (game.score > best) {
        best = game.score;
        saveBest(best);
      }
    }
    updateUi();
  }
  if (game.status !== "running") acc = 0;

  draw();
  requestAnimationFrame(loop);
}

function draw(): void {
  ctx.fillStyle = "#0b1222";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Шахматная сетка
  ctx.fillStyle = "#0f1a30";
  for (let y = 0; y < ROWS; y++) {
    for (let x = (y % 2); x < COLS; x += 2) {
      ctx.fillRect(x * CELL, y * CELL, CELL, CELL);
    }
  }

  // Еда
  const f = game.food;
  ctx.fillStyle = "#f43f5e";
  ctx.beginPath();
  ctx.arc(f.x * CELL + CELL / 2, f.y * CELL + CELL / 2, CELL * 0.36, 0, Math.PI * 2);
  ctx.fill();

  // Змейка: от яркой головы к темнеющему хвосту
  const n = game.snake.length;
  game.snake.forEach((p, i) => {
    const t = n > 1 ? i / (n - 1) : 0;
    const light = 58 - t * 22;
    ctx.fillStyle = i === 0 ? "#86efac" : `hsl(142, 70%, ${light}%)`;
    roundRect(p.x * CELL + 2, p.y * CELL + 2, CELL - 4, CELL - 4, 7);
  });

  drawEyes();
}

function drawEyes(): void {
  const head = game.snake[0];
  const cx = head.x * CELL + CELL / 2;
  const cy = head.y * CELL + CELL / 2;
  const off = CELL * 0.18;
  const fwd = CELL * 0.14;
  const d = game.direction;
  const dx = d === "left" ? -1 : d === "right" ? 1 : 0;
  const dy = d === "up" ? -1 : d === "down" ? 1 : 0;

  ctx.fillStyle = "#052e16";
  for (const s of [-1, 1]) {
    const ex = cx + dx * fwd + dy * off * s;
    const ey = cy + dy * fwd + dx * off * s;
    ctx.beginPath();
    ctx.arc(ex, ey, CELL * 0.08, 0, Math.PI * 2);
    ctx.fill();
  }
}

function roundRect(x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fill();
}

function updateUi(): void {
  scoreEl.textContent = String(game.score);
  bestEl.textContent = String(Math.max(best, game.score));

  const show = (title: string, text: string) => {
    overlayTitle.textContent = title;
    overlayText.textContent = text;
    overlay.classList.remove("hidden");
  };

  switch (game.status) {
    case "ready":
      show("Змейка", "Нажмите стрелку или WASD, чтобы начать");
      break;
    case "paused":
      show("Пауза", "Пробел — продолжить");
      break;
    case "over":
      show("Игра окончена", `Счёт: ${game.score}. Enter — заново`);
      break;
    default:
      overlay.classList.add("hidden");
  }
}

function loadBest(): number {
  try {
    return Number(localStorage.getItem(BEST_KEY)) || 0;
  } catch {
    return 0;
  }
}

function saveBest(value: number): void {
  try {
    localStorage.setItem(BEST_KEY, String(value));
  } catch {
    // рекорд просто не сохранится
  }
}

updateUi();
requestAnimationFrame(loop);
