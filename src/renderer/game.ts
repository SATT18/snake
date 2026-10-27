// Чистая логика игры — без DOM, чтобы её было легко тестировать.

export interface Point {
  x: number;
  y: number;
}

export type Direction = "up" | "down" | "left" | "right";
export type Status = "ready" | "running" | "paused" | "over" | "won";

export interface GameConfig {
  cols: number;
  rows: number;
  obstacles: Point[];
  goal: number; // сколько монет нужно собрать
  tickStart: number; // интервал шага в начале, мс
  tickMin: number; // минимальный интервал шага, мс
  speedup: number; // на сколько мс ускоряемся за каждую монету
}

const VECTORS: Record<Direction, Point> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

const OPPOSITE: Record<Direction, Direction> = {
  up: "down",
  down: "up",
  left: "right",
  right: "left",
};

// По часовой стрелке, если смотреть на поле сверху (ось y направлена вниз)
const CLOCKWISE: Direction[] = ["up", "right", "down", "left"];

export class SnakeGame {
  snake: Point[] = [];
  food: Point = { x: 0, y: 0 };
  direction: Direction = "right";
  status: Status = "ready";
  coins = 0;
  // Пощада: если следующий шаг смертелен, змейка один шаг ждёт и даёт время повернуть
  stalled = false;

  readonly cols: number;
  readonly rows: number;
  readonly goal: number;

  // Очередь поворотов: позволяет быстро нажать две клавиши за один тик
  // и не даёт развернуться змейке в саму себя.
  private queue: Direction[] = [];
  private blocked: Set<number>;

  constructor(private readonly config: GameConfig) {
    this.cols = config.cols;
    this.rows = config.rows;
    this.goal = config.goal;
    this.blocked = new Set(config.obstacles.map((p) => p.y * config.cols + p.x));
    this.reset();
  }

  isBlocked(x: number, y: number): boolean {
    return this.blocked.has(y * this.cols + x);
  }

  reset(): void {
    const cy = Math.floor(this.rows / 2);
    const cx = Math.floor(this.cols / 2);
    this.snake = [
      { x: cx, y: cy },
      { x: cx - 1, y: cy },
      { x: cx - 2, y: cy },
    ];
    this.direction = "right";
    this.queue = [];
    this.coins = 0;
    this.stalled = false;
    this.status = "ready";
    this.spawnFood();
  }

  turn(dir: Direction): void {
    if (this.status !== "ready" && this.status !== "running") return;
    if (this.status === "ready") this.status = "running";

    const last = this.queue.length ? this.queue[this.queue.length - 1] : this.direction;
    if (dir === last || dir === OPPOSITE[last]) return;
    if (this.queue.length < 3) this.queue.push(dir);
  }

  /** Курс с учётом ещё не выполненных поворотов из очереди. */
  get heading(): Direction {
    return this.queue.length ? this.queue[this.queue.length - 1] : this.direction;
  }

  /** Поворот относительно текущего курса — для камеры, которая смотрит из-за спины. */
  turnRelative(side: "left" | "right"): void {
    const i = CLOCKWISE.indexOf(this.heading);
    this.turn(CLOCKWISE[(i + (side === "right" ? 1 : 3)) % 4]);
  }

  start(): void {
    if (this.status === "ready") this.status = "running";
  }

  togglePause(): void {
    if (this.status === "running") this.status = "paused";
    else if (this.status === "paused") this.status = "running";
  }

  /** Один шаг игры. Возвращает true, если змейка съела монету. */
  step(): boolean {
    if (this.status !== "running") return false;

    const next = this.queue.shift();
    if (next) this.direction = next;

    const v = VECTORS[this.direction];
    const head = this.snake[0];
    const newHead = { x: head.x + v.x, y: head.y + v.y };

    const ate = newHead.x === this.food.x && newHead.y === this.food.y;
    // Хвост сдвинется в этом же тике, поэтому в него можно «войти», если не едим
    const body = ate ? this.snake : this.snake.slice(0, -1);

    if (
      newHead.x < 0 ||
      newHead.y < 0 ||
      newHead.x >= this.cols ||
      newHead.y >= this.rows ||
      this.isBlocked(newHead.x, newHead.y) ||
      body.some((p) => p.x === newHead.x && p.y === newHead.y)
    ) {
      if (!this.stalled) {
        this.stalled = true;
        return false;
      }
      this.status = "over";
      return false;
    }

    this.stalled = false;
    this.snake.unshift(newHead);
    if (ate) {
      this.coins++;
      if (this.coins >= this.goal) this.status = "won";
      else this.spawnFood();
    } else {
      this.snake.pop();
    }
    return ate;
  }

  /** Интервал шага в мс: игра ускоряется с каждой монетой. */
  get tickMs(): number {
    return Math.max(this.config.tickMin, this.config.tickStart - this.coins * this.config.speedup);
  }

  private isOpen(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.cols && y < this.rows && !this.isBlocked(x, y);
  }

  private spawnFood(): void {
    const free: Point[] = [];
    const comfy: Point[] = [];
    const head = this.snake[0];
    for (let y = 0; y < this.rows; y++) {
      for (let x = 0; x < this.cols; x++) {
        if (this.isBlocked(x, y)) continue;
        if (this.snake.some((p) => p.x === x && p.y === y)) continue;
        free.push({ x, y });
        // Удобная клетка: не тупик, не вплотную к стене и не прямо под носом у змейки
        const open = [this.isOpen(x + 1, y), this.isOpen(x - 1, y), this.isOpen(x, y + 1), this.isOpen(x, y - 1)];
        const far = Math.abs(x - head.x) + Math.abs(y - head.y) > 3;
        if (open.every(Boolean) && far) comfy.push({ x, y });
      }
    }
    if (free.length === 0) {
      this.status = "won"; // свободных клеток не осталось
      return;
    }
    const pool = comfy.length ? comfy : free;
    this.food = pool[Math.floor(Math.random() * pool.length)];
  }
}
