// HTML-интерфейс поверх 3D-сцены: HUD, меню уровней, диалоги и титры.
import { isTouchDevice } from "./input.js";
import type { LevelDef } from "./levels.js";
import type { Progress } from "./progress.js";
import { QUALITY_LABELS } from "./quality.js";
import type { CameraMode, Settings } from "./settings.js";

const touch = isTouchDevice();
// На сенсорных экранах прячем подсказки по клавишам
document.body.classList.toggle("touch", touch);

const byId = (id: string) => document.getElementById(id)!;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = "", text = ""): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

export function formatTime(seconds: number, precise = false): string {
  const m = Math.floor(seconds / 60);
  const s = seconds - m * 60;
  const whole = Math.floor(s);
  const ss = String(whole).padStart(2, "0");
  return precise ? `${m}:${ss}.${Math.floor((s - whole) * 10)}` : `${m}:${ss}`;
}

export function starsElement(count: number, big = false): HTMLElement {
  const wrap = el("span", big ? "stars big" : "stars");
  for (let i = 0; i < 3; i++) wrap.append(el("span", i < count ? "star on" : "star", "★"));
  return wrap;
}

// ---------- HUD ----------

const hud = byId("hud");
const controlsHint = byId("controls-hint");
const coinsEl = byId("coins");
const goalEl = byId("goal");
const levelNameEl = byId("level-name");
const timerEl = byId("timer");
let hudKey = "";

const pauseButton = byId("btn-pause");

/** Подсказка по управлению зависит от режима камеры и устройства. */
export function turnHint(camera: CameraMode): string {
  if (touch) return camera === "classic" ? "Свайп — направление" : "Свайп влево / вправо — поворот";
  return camera === "classic" ? "Стрелки / WASD — направление" : "← → / A D — повернуть";
}

export function showHud(level: LevelDef, index: number, camera: CameraMode, onPause: () => void): void {
  levelNameEl.textContent = `${index + 1}. ${level.name}`;
  controlsHint.textContent = touch ? turnHint(camera) : `${turnHint(camera)} · Пробел — пауза · Esc — меню`;
  pauseButton.onclick = onPause;
  goalEl.textContent = String(level.goal);
  hudKey = "";
  hud.classList.remove("hidden");
  controlsHint.classList.remove("hidden");
}

export function hideHud(): void {
  hud.classList.add("hidden");
  controlsHint.classList.add("hidden");
}

export function updateHud(coins: number, seconds: number): void {
  const key = `${coins}|${Math.floor(seconds)}`;
  if (key === hudKey) return;
  hudKey = key;
  coinsEl.textContent = String(coins);
  timerEl.textContent = formatTime(seconds);
}

// ---------- Диалоги ----------

export interface DialogAction {
  label: string;
  hint?: string;
  keys: string[];
  primary?: boolean;
  run: () => void;
}

export interface DialogOptions {
  kicker?: string;
  title: string;
  body: (string | Node)[];
  actions: DialogAction[];
  tone?: "win" | "lose";
}

const dialog = byId("dialog");
const dialogKicker = byId("dialog-kicker");
const dialogTitle = byId("dialog-title");
const dialogBody = byId("dialog-body");
const dialogActions = byId("dialog-actions");
let actions: DialogAction[] = [];

export function showDialog(opts: DialogOptions): void {
  dialog.className = `screen ${opts.tone ?? ""}`;
  dialogKicker.textContent = opts.kicker ?? "";
  dialogTitle.textContent = opts.title;
  dialogBody.replaceChildren(...opts.body.map((b) => (typeof b === "string" ? el("p", "", b) : b)));
  actions = opts.actions;
  dialogActions.replaceChildren(
    ...actions.map((a) => {
      const button = el("button", a.primary ? "primary" : "");
      button.append(a.label);
      if (a.hint) button.append(el("kbd", "", a.hint));
      button.addEventListener("click", () => a.run());
      return button;
    }),
  );
}

export function hideDialog(): void {
  dialog.classList.add("hidden");
  actions = [];
}

/** Выполняет действие диалога, привязанное к клавише. */
export function handleDialogKey(code: string): boolean {
  const action = actions.find((a) => a.keys.includes(code));
  if (!action) return false;
  action.run();
  return true;
}

// ---------- Меню уровней ----------

export interface MenuHandlers {
  onSelect(index: number): void;
  onStart(index: number): void;
  onCredits(): void;
  onReset(): void;
  onToggleCamera(): void;
  onToggleShake(): void;
  onCycleQuality(): void;
}

const menu = byId("menu");
const levelList = byId("level-list");
const creditsButton = byId("btn-credits");
const resetButton = byId("btn-reset");
const cameraButton = byId("btn-camera");
const shakeButton = byId("btn-shake");
const qualityButton = byId("btn-quality");

export function showSettings(settings: Settings): void {
  cameraButton.textContent = `Камера: ${settings.camera === "classic" ? "классическая" : "за спиной"}`;
  shakeButton.textContent = `Тряска: ${settings.shake ? "вкл" : "выкл"}`;
  qualityButton.textContent = `Графика: ${QUALITY_LABELS[settings.quality]}`;
}
let menuState: { unlocked: boolean[]; selected: number; handlers: MenuHandlers } | null = null;

export function showMenu(
  levels: LevelDef[],
  progress: Progress,
  unlocked: boolean[],
  selected: number,
  handlers: MenuHandlers,
): void {
  menuState = { unlocked, selected, handlers };

  levelList.replaceChildren(
    ...levels.map((level, i) => {
      const card = el("button", "level-card");
      card.dataset.theme = level.theme;
      const result = progress[level.id];

      const status = el("span", "level-status");
      if (!unlocked[i]) {
        card.classList.add("locked");
        status.append(el("span", "level-lock", `Пройдите уровень ${i}`));
      } else if (result) {
        card.classList.add("done");
        status.append(starsElement(result.stars), el("span", "level-time", formatTime(result.time, true)));
      } else {
        status.append(el("span", "level-new", "Не пройден"));
      }

      const goal = el("span", "level-goal");
      goal.append(el("span", "coin small"), `${level.goal} монет`);

      card.append(
        el("span", "level-num", unlocked[i] ? String(i + 1) : "🔒"),
        el("span", "level-name", level.name),
        el("span", "level-desc", level.description),
        goal,
        status,
      );
      card.addEventListener("mouseenter", () => selectLevel(i));
      card.addEventListener("click", () => unlocked[i] && handlers.onStart(i));
      return card;
    }),
  );

  const allDone = levels.every((level) => progress[level.id]);
  creditsButton.classList.toggle("hidden", !allDone);
  resetButton.classList.toggle("hidden", Object.keys(progress).length === 0);
  creditsButton.onclick = () => handlers.onCredits();
  cameraButton.onclick = () => handlers.onToggleCamera();
  shakeButton.onclick = () => handlers.onToggleShake();
  qualityButton.onclick = () => handlers.onCycleQuality();
  resetButton.onclick = () => {
    if (confirm("Сбросить прогресс всех уровней?")) handlers.onReset();
  };

  menu.classList.remove("hidden");
  highlight(selected);
}

export function hideMenu(): void {
  menu.classList.add("hidden");
  menuState = null;
}

function highlight(index: number): void {
  Array.from(levelList.children).forEach((card, i) => card.classList.toggle("selected", i === index));
}

function selectLevel(index: number): void {
  if (!menuState || !menuState.unlocked[index] || menuState.selected === index) return;
  menuState.selected = index;
  highlight(index);
  menuState.handlers.onSelect(index);
}

export function handleMenuKey(code: string): boolean {
  if (!menuState) return false;
  const { unlocked, selected, handlers } = menuState;
  const step = code === "ArrowLeft" || code === "KeyA" ? -1 : code === "ArrowRight" || code === "KeyD" ? 1 : 0;
  if (step) {
    for (let i = selected + step; i >= 0 && i < unlocked.length; i += step) {
      if (unlocked[i]) {
        selectLevel(i);
        break;
      }
    }
    return true;
  }
  if (code === "Enter" || code === "Space") {
    handlers.onStart(selected);
    return true;
  }
  if (code === "KeyC") {
    handlers.onToggleCamera();
    return true;
  }
  return false;
}

// ---------- Титры ----------

const CREDITS: { heading: string; lines: [string, string][] }[] = [
  {
    heading: "Создатель",
    lines: [["Андрей · SATT18", "идея, геймдизайн, уровни, тестирование"]],
  },
  {
    heading: "Технологии",
    lines: [
      ["TypeScript", "весь код игры"],
      ["Three.js", "3D-рендеринг на WebGL 2"],
      ["Electron", "нативное приложение для Windows"],
      ["esbuild", "сборка в один бандл"],
      ["electron-builder", "установщик и portable-версия"],
    ],
  },
  {
    heading: "Графика",
    lines: [
      ["PBR-материалы", "с отражениями процедурного неба"],
      ["Мягкие тени", "PCF, карта 4096 × 4096"],
      ["GTAO", "затенение в углах и стыках"],
      ["HDR-bloom", "свечение монет, фонарей, солнца и луны"],
      ["Neutral tone mapping", "сочные цвета без пересветов"],
      ["Инстансинг", "тысячи травинок и тело змейки за один вызов отрисовки"],
      ["Статический батчинг", "сотни мешей мира слиты по материалам: 854 вызова отрисовки → 85"],
      ["Волны на GPU", "океан анимируется в вершинном шейдере"],
      ["Адаптивное качество", "пресеты под устройство и автоснижение при просадке FPS"],
    ],
  },
  {
    heading: "Ключевые решения",
    lines: [
      ["Логика отдельно от отрисовки", "класс SnakeGame не знает ни о DOM, ни о Three.js"],
      ["Фиксированный шаг + интерполяция", "змейка движется плавно при любом FPS"],
      ["Очередь поворотов", "быстрые нажатия не теряются и не разворачивают змейку в себя"],
      ["Камера без укачивания", "пружинное сглаживание, мёртвая зона и никаких поворотов без спроса"],
      ["Уровни — это данные", "препятствия, темп, цель и время суток в одном описании"],
      ["Детерминированный мир", "острова одинаковые при каждом запуске"],
      ["Безопасный Electron", "песочница, contextIsolation и строгая CSP"],
    ],
  },
];

const creditsScreen = byId("credits");
const creditsRoll = byId("credits-roll");
let creditsDone: (() => void) | null = null;

creditsRoll.addEventListener("animationend", () => creditsDone?.());

export function showCredits(onDone: () => void): void {
  const blocks: HTMLElement[] = [el("h1", "logo", "Змейка 3D")];
  for (const section of CREDITS) {
    const block = el("section");
    block.append(el("h3", "", section.heading));
    for (const [main, sub] of section.lines) {
      const line = el("div", "credit-line");
      line.append(el("b", "", main), el("span", "", sub));
      block.append(line);
    }
    blocks.push(block);
  }
  blocks.push(el("p", "credits-thanks", "Спасибо за игру!"));
  creditsRoll.replaceChildren(...blocks);

  creditsDone = onDone;
  creditsScreen.classList.remove("hidden");
  // Перезапуск CSS-анимации прокрутки
  creditsRoll.classList.remove("rolling");
  void creditsRoll.offsetWidth;
  creditsRoll.classList.add("rolling");
}

export function hideCredits(): void {
  creditsScreen.classList.add("hidden");
  creditsRoll.classList.remove("rolling");
  creditsDone = null;
}
