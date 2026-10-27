// Точка входа: экраны (меню, игра, титры), игровой цикл и связь логики с 3D-представлением.
import * as THREE from "three";
import { CameraRig, RigMode } from "./cameraRig.js";
import { CoinView } from "./coinView.js";
import { Direction, Point, SnakeGame, Status } from "./game.js";
import { Graphics } from "./graphics.js";
import { bindInput } from "./input.js";
import { LEVELS, levelConfig, starsFor } from "./levels.js";
import { Particles } from "./particles.js";
import { isUnlocked, loadProgress, resetProgress, saveResult } from "./progress.js";
import { detectQuality, LOWER, QualityLevel, QualitySetting } from "./quality.js";
import { loadSettings, saveSettings } from "./settings.js";
import { SnakeView, yawOf } from "./snakeView.js";
import * as ui from "./ui.js";
import { cellToWorld, TILE_TOP } from "./world.js";

const COLS = 20;
const ROWS = 20;
const LEVEL_IDS = LEVELS.map((l) => l.id);
const QUALITY_CYCLE: QualitySetting[] = ["auto", "low", "medium", "high"];

type Mode = "menu" | "play" | "credits";

const settings = loadSettings();
const graphics = new Graphics(document.getElementById("board") as HTMLCanvasElement, COLS, ROWS);
const rig = new CameraRig(graphics.camera);
const snakeView = new SnakeView(graphics.scene, COLS, ROWS);
const coinView = new CoinView(graphics.scene, COLS, ROWS);
const particles = new Particles(graphics.scene);

rig.shakeEnabled = settings.shake;

// ---------- Качество графики ----------

// В режиме «авто» стартуем с уровня по устройству и опускаемся ниже, если FPS проседает
let autoLevel: QualityLevel = detectQuality();

function applyQuality(): void {
  graphics.setQuality(settings.quality === "auto" ? autoLevel : settings.quality);
}
applyQuality();

const fpsMonitor = {
  frames: 0,
  elapsed: 0,
  // Первые секунды пропускаем: компиляция шейдеров и карта окружения дают разовые просадки
  warmup: 3,
  reset(): void {
    this.frames = 0;
    this.elapsed = 0;
    this.warmup = 3;
  },
  tick(dt: number): void {
    if (settings.quality !== "auto") return;
    if (this.warmup > 0) {
      this.warmup -= dt;
      return;
    }
    this.frames++;
    this.elapsed += dt;
    if (this.elapsed < 3) return;
    const fps = this.frames / this.elapsed;
    this.frames = 0;
    this.elapsed = 0;
    const lower = LOWER[autoLevel];
    if (fps < 40 && lower) {
      autoLevel = lower;
      applyQuality();
      this.reset();
    }
  },
};

// ---------- Состояние ----------

const clonePoints = (pts: Point[]): Point[] => pts.map((p) => ({ x: p.x, y: p.y }));
// step() меняет status, а TS сужает тип после проверок — читаем через функцию
const statusOf = (g: SnakeGame): Status => g.status;

let mode: Mode = "menu";
let levelIndex = 0;
let game = new SnakeGame(levelConfig(LEVELS[0], COLS, ROWS));
// Позиции змейки до последнего шага: между ними и текущими плавно интерполируем
let prev = clonePoints(game.snake);
let acc = 0;
let levelTime = 0;
let deathTint = 0;
let shownStatus: Status | null = null;
let lastWin: { time: number; stars: number; newRecord: boolean } | null = null;

const rigMode = (): RigMode => (mode === "play" ? settings.camera : "orbit");

function setActorsVisible(visible: boolean): void {
  snakeView.setVisible(visible);
  coinView.setVisible(visible);
}

/** Показывает на острове препятствия и время суток уровня. */
function showScenery(index: number): void {
  graphics.applyTheme(LEVELS[index].theme);
  graphics.world.setObstacles(LEVELS[index].obstacles);
}

// ---------- Переходы между экранами ----------

function openMenu(): void {
  mode = "menu";
  ui.hideDialog();
  ui.hideHud();
  ui.hideCredits();
  setActorsVisible(false);

  const progress = loadProgress();
  const unlocked = LEVELS.map((_, i) => isUnlocked(progress, LEVEL_IDS, i));
  if (!unlocked[levelIndex]) levelIndex = 0;
  ui.showMenu(LEVELS, progress, unlocked, levelIndex, {
    onSelect: (i) => {
      levelIndex = i;
      showScenery(i);
    },
    onStart: (i) => startLevel(i),
    onCredits: () => openCredits(),
    onReset: () => {
      resetProgress();
      levelIndex = 0;
      openMenu();
    },
    onToggleCamera: () => {
      settings.camera = settings.camera === "classic" ? "chase" : "classic";
      saveSettings(settings);
      ui.showSettings(settings);
    },
    onToggleShake: () => {
      settings.shake = rig.shakeEnabled = !settings.shake;
      saveSettings(settings);
      ui.showSettings(settings);
    },
    onCycleQuality: () => {
      settings.quality = QUALITY_CYCLE[(QUALITY_CYCLE.indexOf(settings.quality) + 1) % QUALITY_CYCLE.length];
      if (settings.quality === "auto") autoLevel = detectQuality();
      saveSettings(settings);
      ui.showSettings(settings);
      applyQuality();
      fpsMonitor.reset();
    },
  });
  ui.showSettings(settings);
  showScenery(levelIndex);
}

function startLevel(index: number): void {
  mode = "play";
  levelIndex = index;
  ui.hideMenu();
  ui.hideCredits();
  showScenery(index);
  game = new SnakeGame(levelConfig(LEVELS[index], COLS, ROWS));
  restartRun();
  ui.showHud(LEVELS[index], index, settings.camera, togglePause);
  setActorsVisible(true);
}

function restartRun(): void {
  game.reset();
  prev = clonePoints(game.snake);
  acc = 0;
  levelTime = 0;
  deathTint = 0;
  lastWin = null;
  shownStatus = null;
  particles.clear();
  snakeView.reset();
  const head = cellToWorld(game.snake[0].x, game.snake[0].y, COLS, ROWS, new THREE.Vector3());
  rig.reset(rigMode(), head, yawOf(game.direction));
}

function openCredits(): void {
  mode = "credits";
  ui.hideMenu();
  ui.hideDialog();
  ui.hideHud();
  setActorsVisible(false);
  graphics.applyTheme("night");
  graphics.world.setObstacles([]);
  ui.showCredits(() => openMenu());
}

function togglePause(): void {
  if (mode === "play") game.togglePause();
}

function onGameOver(): void {
  prev = clonePoints(game.snake);
  acc = 0;
  rig.shake(0.35);
}

function onWin(): void {
  const level = LEVELS[levelIndex];
  const stars = starsFor(level, levelTime);
  const { newRecord } = saveResult(level.id, levelTime, stars);
  lastWin = { time: levelTime, stars, newRecord };
  prev = clonePoints(game.snake);
  acc = 0;
  particles.fountain(snakeView.headPosition);
}

/** Показывает диалог, соответствующий текущему статусу игры. */
function syncDialog(): void {
  shownStatus = game.status;
  const level = LEVELS[levelIndex];
  const toMenu: ui.DialogAction = { label: "Меню", hint: "Esc", keys: ["Escape"], run: openMenu };
  const retry: ui.DialogAction = { label: "Заново", hint: "R", keys: ["KeyR"], run: restartRun };

  switch (game.status) {
    case "ready":
      ui.showDialog({
        kicker: `Уровень ${levelIndex + 1} из ${LEVELS.length}`,
        title: level.name,
        body: [level.description, `Соберите ${level.goal} монет. ${ui.turnHint(settings.camera)}.`],
        actions: [
          { label: "Старт", hint: "↑", keys: ["ArrowUp", "KeyW", "Enter", "Space"], primary: true, run: () => game.start() },
          toMenu,
        ],
      });
      break;
    case "paused":
      ui.showDialog({
        title: "Пауза",
        body: [`Монет: ${game.coins} из ${level.goal} · ${ui.formatTime(levelTime)}`],
        actions: [
          { label: "Продолжить", hint: "Пробел", keys: ["Space", "Enter", "KeyP"], primary: true, run: () => game.togglePause() },
          retry,
          toMenu,
        ],
      });
      break;
    case "over":
      ui.showDialog({
        title: "Змейка разбилась",
        tone: "lose",
        body: [`Монет: ${game.coins} из ${level.goal}`],
        actions: [{ ...retry, hint: "Enter", keys: ["Enter", "KeyR", "Space"], primary: true }, toMenu],
      });
      break;
    case "won": {
      const win = lastWin!;
      const isLast = levelIndex === LEVELS.length - 1;
      const body: (string | Node)[] = [ui.starsElement(win.stars, true), `Время: ${ui.formatTime(win.time, true)}`];
      if (win.newRecord) {
        const record = document.createElement("span");
        record.className = "record";
        record.textContent = "Новый рекорд!";
        body.push(record);
      }
      ui.showDialog({
        kicker: level.name,
        title: isLast ? "Все острова пройдены!" : "Уровень пройден!",
        tone: "win",
        body,
        actions: [
          {
            label: isLast ? "Титры" : "Дальше",
            hint: "Enter",
            keys: ["Enter", "Space"],
            primary: true,
            run: () => (isLast ? openCredits() : startLevel(levelIndex + 1)),
          },
          { label: "Ещё раз", hint: "R", keys: ["KeyR"], run: restartRun },
          toMenu,
        ],
      });
      break;
    }
    default:
      ui.hideDialog();
  }
}

// ---------- Управление ----------

// Классическая камера: стрелки задают направление на поле (вверх — от камеры)
const DIRECTION_KEYS: Record<string, Direction> = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
  KeyW: "up",
  KeyS: "down",
  KeyA: "left",
  KeyD: "right",
};
// Камера за спиной: повороты относительные — влево/вправо от курса
const TURN_KEYS: Record<string, "left" | "right"> = {
  ArrowLeft: "left",
  ArrowRight: "right",
  KeyA: "left",
  KeyD: "right",
};

const canSteer = () => mode === "play" && (game.status === "running" || game.status === "ready");

function steer(screenDir: Direction): void {
  if (settings.camera === "classic") game.turn(screenDir);
  else if (screenDir === "left" || screenDir === "right") game.turnRelative(screenDir);
}

bindInput(window, {
  key(code, e) {
    if (mode === "menu") {
      if (ui.handleMenuKey(code)) e.preventDefault();
      return;
    }
    if (mode === "credits") {
      if (code === "Escape" || code === "Enter") {
        e.preventDefault();
        openMenu();
      }
      return;
    }
    if (canSteer()) {
      const dir = settings.camera === "classic" ? DIRECTION_KEYS[code] : TURN_KEYS[code];
      if (dir) {
        e.preventDefault();
        steer(dir);
        return;
      }
    }
    if (game.status === "running") {
      if (code === "Space" || code === "KeyP" || code === "Escape") {
        e.preventDefault();
        game.togglePause();
      }
      return;
    }
    if (ui.handleDialogKey(code)) e.preventDefault();
  },
  swipe(dir) {
    if (canSteer()) steer(dir);
  },
  tap() {
    if (mode === "play") game.start();
  },
});

// ---------- Игровой цикл ----------

let lastFrame = performance.now();
let time = 0;

function frame(now: number): void {
  requestAnimationFrame(frame);
  // На 120-герцовых экранах слабых устройств рисуем не чаще maxFps
  const maxFps = graphics.maxFps;
  if (maxFps && now - lastFrame < 1000 / maxFps - 2) return;

  const dt = Math.min(now - lastFrame, 100) / 1000;
  lastFrame = now;
  time += dt;
  fpsMonitor.tick(dt);

  if (mode === "play") updatePlay(dt);

  particles.update(dt, time);
  rig.update(dt, rigMode(), snakeView.headCell, yawOf(game.heading), time);
  graphics.world.update(time, dt);
  graphics.render();
}

function updatePlay(dt: number): void {
  if (game.status === "running") {
    levelTime += dt;
    acc += dt * 1000;
    while (acc >= game.tickMs) {
      acc -= game.tickMs;
      prev = clonePoints(game.snake);
      const eaten = game.food;
      if (game.step()) particles.burst(cellToWorld(eaten.x, eaten.y, COLS, ROWS, new THREE.Vector3()).setY(TILE_TOP + 0.5));
      const status = statusOf(game);
      if (status === "over") {
        onGameOver();
        break;
      }
      if (status === "won") {
        onWin();
        break;
      }
    }
  }
  if (game.status !== shownStatus) syncDialog();
  ui.updateHud(game.coins, levelTime);

  const alpha = game.status === "running" || game.status === "paused" ? Math.min(acc / game.tickMs, 1) : 1;
  deathTint += ((game.status === "over" ? 1 : 0) - deathTint) * (1 - Math.exp(-dt * 5));
  snakeView.update(game, prev, alpha, dt, time, deathTint);
  coinView.update(game, snakeView.headPosition, dt, time, particles);
}

openMenu();
requestAnimationFrame(frame);
