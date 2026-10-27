// Чистая логика игры — без DOM, чтобы её было легко тестировать.

export interface Point {
  x: number;
  y: number;
}

export type Direction = "up" | "down" | "left" | "right";
export type Status = "ready" | "running" | "paused" | "over";

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
  score = 0;

  // Очередь поворотов: позволяет быстро нажать две клавиши за один тик
  // и не даёт развернуться змейке в саму себя.
  private queue: Direction[] = [];

  constructor(readonly cols: number, readonly rows: number) {
    this.reset();
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
    this.score = 0;
    this.status = "ready";
    this.spawnFood();
  }

  turn(dir: Direction): void {
    if (this.status === "over") return;
    if (this.status === "ready") this.status = "running";

    const last = this.queue.length ? this.queue[this.queue.length - 1] : this.direction;
    if (dir === last || dir === OPPOSITE[last]) return;
    if (this.queue.length < 3) this.queue.push(dir);
  }

  /** Поворот относительно текущего курса — для камеры, которая смотрит из-за спины. */
  turnRelative(side: "left" | "right"): void {
    const heading = this.queue.length ? this.queue[this.queue.length - 1] : this.direction;
    const i = CLOCKWISE.indexOf(heading);
    this.turn(CLOCKWISE[(i + (side === "right" ? 1 : 3)) % 4]);
  }

  start(): void {
    if (this.status === "ready") this.status = "running";
  }

  togglePause(): void {
    if (this.status === "running") this.status = "paused";
    else if (this.status === "paused") this.status = "running";
  }

  /** Один шаг игры. Возвращает true, если змейка съела еду. */
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
      body.some((p) => p.x === newHead.x && p.y === newHead.y)
    ) {
      this.status = "over";
      return false;
    }

    this.snake.unshift(newHead);
    if (ate) {
      this.score += 10;
      this.spawnFood();
    } else {
      this.snake.pop();
    }
    return ate;
  }

  /** Интервал тика в мс: игра ускоряется по мере роста счёта. */
  get tickMs(): number {
    return Math.max(55, 140 - Math.floor(this.score / 50) * 8);
  }

  private spawnFood(): void {
    const free: Point[] = [];
    for (let y = 0; y < this.rows; y++) {
      for (let x = 0; x < this.cols; x++) {
        if (!this.snake.some((p) => p.x === x && p.y === y)) free.push({ x, y });
      }
    }
    if (free.length === 0) {
      this.status = "over"; // поле заполнено — победа
      return;
    }
    this.food = free[Math.floor(Math.random() * free.length)];
  }
}
