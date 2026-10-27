import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { GTAOPass } from "three/addons/postprocessing/GTAOPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { Direction, Point, SnakeGame, Status } from "./game.js";
import { LEVELS, levelConfig, starsFor } from "./levels.js";
import { isUnlocked, loadProgress, resetProgress, saveResult } from "./progress.js";
import { loadSettings, saveSettings } from "./settings.js";
import { THEMES, ThemeName } from "./themes.js";
import * as ui from "./ui.js";
import { createSky, createWorld, TILE_TOP } from "./world.js";

const COLS = 20;
const ROWS = 20;
const LEVEL_IDS = LEVELS.map((l) => l.id);

const canvas = document.getElementById("board") as HTMLCanvasElement;

// ---------- Рендерер и постобработка ----------

const renderer = new THREE.WebGLRenderer({ canvas, powerPreference: "high-performance" });
const pixelRatio = Math.min(window.devicePixelRatio, 2);
renderer.setPixelRatio(pixelRatio);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
// Neutral сохраняет насыщенность цветов — для яркого мультяшного стиля лучше ACES
renderer.toneMapping = THREE.NeutralToneMapping;

const scene = new THREE.Scene();
const world = createWorld(scene, COLS, ROWS);

// Карта окружения из того же неба: глянцевые поверхности отражают небо текущей темы
const pmrem = new THREE.PMREMGenerator(renderer);
const envScene = new THREE.Scene();
envScene.add(createSky());
let envTarget: THREE.WebGLRenderTarget | null = null;

const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 1000);

// Камера построена по правилам против укачивания:
// - никаких поворотов, которых игрок не просил: в классическом режиме угол обзора неизменен;
// - движение через критически демпфированную пружину — разгон и торможение без рывков;
// - мёртвая зона: камера не дёргается за каждым шагом змейки;
// - в режиме «за спиной» камера вращается вокруг головы по дуге, начинает доворачивать сразу
//   по нажатию (предсказуемо для игрока) и смотрит круто вниз — так вращение воспринимается
//   как поворот карты, а не всего мира, и в кадр попадает всё поле впереди и по бокам.
const CLASSIC_OFFSET = new THREE.Vector3(0, 15, 10.5);
const CLASSIC_FOLLOW = 0.7; // 0 — камера над центром поля, 1 — над головой
const DEAD_ZONE = 1.5;
const CHASE_BACK = 6.5; // насколько камера позади головы
const CHASE_UP = 12; // высота: наклон ~50°, поле впереди видно до самой изгороди
const CHASE_LOOK_AHEAD = 3.5; // голова в нижней трети кадра, больше места впереди
const CHASE_YAW_TIME = 0.16; // сглаживание поворота: 90° укладываются примерно в 0,45 с
const CHASE_MAX_YAW_SPEED = 5; // рад/с — потолок на случай разворота на 180°
const CHASE_FOLLOW_TIME = 0.08; // фокус почти без задержки идёт за головой

const camPos = new THREE.Vector3(30, 14, 30);
const camLook = new THREE.Vector3();
const camFwd = new THREE.Vector3();
const camGoal = new THREE.Vector3();
const lookGoal = new THREE.Vector3();
const camFocus = new THREE.Vector3();
const camPosVel = new THREE.Vector3();
const camLookVel = new THREE.Vector3();
const camFocusVel = new THREE.Vector3();
const yawVel = { v: 0 };
let transition = 1; // 1 → 0 за секунду после старта уровня: плавный въезд камеры

/**
 * Критически демпфированная пружина (как SmoothDamp в Unity): плавно разгоняется и тормозит,
 * не перелетает цель. velocity хранит скорость между кадрами.
 */
function smoothDamp(current: number, target: number, velocity: { v: number }, smoothTime: number, dt: number, maxSpeed = Infinity): number {
  const omega = 2 / smoothTime;
  const x = omega * dt;
  const decay = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
  const maxChange = maxSpeed * smoothTime;
  const change = Math.min(Math.max(current - target, -maxChange), maxChange);
  const temp = (velocity.v + omega * change) * dt;
  velocity.v = (velocity.v - omega * temp) * decay;
  let out = current - change + (change + temp) * decay;
  if (target - current > 0 === out > target) {
    out = target;
    velocity.v = 0;
  }
  return out;
}

const axisVel = { v: 0 };
function smoothDampVec(current: THREE.Vector3, target: THREE.Vector3, velocity: THREE.Vector3, smoothTime: number, dt: number): void {
  for (const axis of ["x", "y", "z"] as const) {
    axisVel.v = velocity[axis];
    current[axis] = smoothDamp(current[axis], target[axis], axisVel, smoothTime, dt);
    velocity[axis] = axisVel.v;
  }
}

// HDR-буфер с MSAA: bloom работает по яркостям > 1, сглаживание не теряется
const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
const composer = new EffectComposer(renderer, target);
composer.setPixelRatio(pixelRatio);
composer.addPass(new RenderPass(scene, camera));
const ao = new GTAOPass(scene, camera, 1, 1);
ao.updateGtaoMaterial({ radius: 0.6, thickness: 1, scale: 1.1 });
composer.addPass(ao);
composer.addPass(new UnrealBloomPass(new THREE.Vector2(1, 1), 0.35, 0.4, 1.0));
composer.addPass(new OutputPass());

function resize(): void {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h, false);
  composer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener("resize", resize);
resize();

// ---------- Свет и время суток ----------

const hemi = new THREE.HemisphereLight();
scene.add(hemi);

const sun = new THREE.DirectionalLight();
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
Object.assign(sun.shadow.camera, { left: -30, right: 30, top: 30, bottom: -30, near: 1, far: 120 });
sun.shadow.bias = -0.0003;
sun.shadow.normalBias = 0.03;
scene.add(sun);

let currentTheme: ThemeName | null = null;

function applyTheme(name: ThemeName): void {
  if (name === currentTheme) return;
  currentTheme = name;
  const t = THEMES[name];
  world.setTheme(t);
  hemi.color.set(t.hemiSky);
  hemi.groundColor.set(t.hemiGround);
  hemi.intensity = t.hemiIntensity;
  sun.color.set(t.sunColor);
  sun.intensity = t.sunIntensity;
  sun.position.copy(t.sunDir).multiplyScalar(50); // совпадает с солнцем (луной) на небе
  renderer.toneMappingExposure = t.exposure;

  envTarget?.dispose();
  envTarget = pmrem.fromScene(envScene, 0, 0.1, 1000);
  scene.environment = envTarget.texture;
  scene.environmentIntensity = t.envIntensity;
}

/** Показывает на острове препятствия и время суток уровня. */
function showScenery(index: number): void {
  applyTheme(LEVELS[index].theme);
  world.setObstacles(LEVELS[index].obstacles);
}

// ---------- Поле ----------

const toWorld = (p: Point, out: THREE.Vector3): THREE.Vector3 =>
  out.set(p.x - COLS / 2 + 0.5, 0, p.y - ROWS / 2 + 0.5);

const tiles = new THREE.InstancedMesh(
  new RoundedBoxGeometry(0.96, 0.12, 0.96, 2, 0.04),
  new THREE.MeshStandardMaterial({ roughness: 0.8 }),
  COLS * ROWS,
);
tiles.receiveShadow = true;
{
  const m = new THREE.Matrix4();
  const c = new THREE.Color();
  const v = new THREE.Vector3();
  let k = 0;
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      toWorld({ x, y }, v);
      tiles.setMatrixAt(k, m.makeTranslation(v.x, TILE_TOP - 0.06, v.z));
      tiles.setColorAt(k, c.set((x + y) % 2 ? 0x7fd34e : 0x6cc340));
      k++;
    }
  }
}
scene.add(tiles);

// ---------- Змейка ----------

const segGeo = new THREE.SphereGeometry(0.5, 32, 20);
// На каждую клетку — шар в клетке и шар между соседними клетками, чтобы тело было сплошным
const body = new THREE.InstancedMesh(
  segGeo,
  new THREE.MeshPhysicalMaterial({ roughness: 0.35, clearcoat: 0.8, clearcoatRoughness: 0.2 }),
  COLS * ROWS * 2,
);
body.castShadow = true;
body.receiveShadow = true;
body.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
// boundingSphere у InstancedMesh считается один раз и не следует за инстансами —
// без этого тело отсекается камерой, когда змейка уползает от стартовой точки
body.frustumCulled = false;
body.setColorAt(0, new THREE.Color()); // создаёт instanceColor до компиляции шейдера
scene.add(body);

const HEAD_ALIVE = new THREE.Color(0x3fcf4a);
const headMat = new THREE.MeshPhysicalMaterial({
  color: HEAD_ALIVE,
  roughness: 0.3,
  clearcoat: 0.8,
  clearcoatRoughness: 0.15,
});
const head = new THREE.Group();
const headMesh = new THREE.Mesh(segGeo, headMat);
headMesh.scale.set(1, 0.82, 1.08);
headMesh.castShadow = true;
head.add(headMesh);

// Большие мультяшные глаза с бликом
const eyeGeo = new THREE.SphereGeometry(1, 20, 14);
const eyeWhite = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.15 });
const eyePupil = new THREE.MeshStandardMaterial({ color: 0x0b1020, roughness: 0.05 });
const eyeGlint = new THREE.MeshBasicMaterial({ color: 0xffffff });
for (const side of [-1, 1]) {
  const parts: [THREE.Material, number, number, number, number][] = [
    [eyeWhite, 0.17, 0.2, 0.27, 0.22],
    [eyePupil, 0.09, 0.21, 0.32, 0.35],
    [eyeGlint, 0.03, 0.18, 0.38, 0.42],
  ];
  for (const [mat, r, x, y, z] of parts) {
    const eye = new THREE.Mesh(eyeGeo, mat);
    eye.scale.setScalar(r);
    eye.position.set(side * x, y, z);
    eye.castShadow = mat === eyeWhite;
    head.add(eye);
  }
}
scene.add(head);

// ---------- Монета (еда) ----------

const gold = new THREE.MeshStandardMaterial({
  color: 0xffc928,
  metalness: 0.6,
  roughness: 0.25,
  emissive: 0xffa000,
  emissiveIntensity: 0.7,
});
const coin = new THREE.Group();
const coinDisc = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.1, 40), gold);
coinDisc.rotation.x = Math.PI / 2;
const coinRim = new THREE.Mesh(new THREE.TorusGeometry(0.36, 0.05, 12, 40), gold);
coin.add(coinDisc, coinRim);
coin.traverse((o) => (o.castShadow = true));
const coinLight = new THREE.PointLight(0xffc040, 3, 4, 2);
scene.add(coin, coinLight);

// Световой столб над монетой — её видно издалека, даже если она за спиной
const beamFade = document.createElement("canvas");
beamFade.width = 1;
beamFade.height = 64;
{
  const ctx = beamFade.getContext("2d")!;
  const grad = ctx.createLinearGradient(0, 0, 0, 64);
  grad.addColorStop(0, "#000");
  grad.addColorStop(1, "#fff");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 1, 64);
}
const beam = new THREE.Mesh(
  new THREE.CylinderGeometry(0.22, 0.32, 10, 20, 1, true),
  new THREE.MeshBasicMaterial({
    color: 0xffd84d,
    alphaMap: new THREE.CanvasTexture(beamFade),
    transparent: true,
    opacity: 0.6,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  }),
);
scene.add(beam);

// Стрелка над головой змейки, указывающая на монету
const arrowGeo = new THREE.ConeGeometry(0.16, 0.42, 16);
arrowGeo.rotateX(Math.PI / 2); // остриё вдоль +z
const arrow = new THREE.Mesh(arrowGeo, gold);
arrow.castShadow = true;
scene.add(arrow);

// ---------- Частицы: искры от монеты и салют при победе ----------

interface Particle {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  life: number;
  maxLife: number;
  gravity: number;
  size: number;
}

const MAX_PARTICLES = 260;
const particles: Particle[] = [];
const particleMesh = new THREE.InstancedMesh(
  new THREE.OctahedronGeometry(0.09),
  new THREE.MeshStandardMaterial({ color: 0xffe066, emissive: 0xffb300, emissiveIntensity: 3 }),
  MAX_PARTICLES,
);
particleMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
particleMesh.frustumCulled = false; // та же причина, что у тела змейки
particleMesh.count = 0;
scene.add(particleMesh);

function spawn(p: Omit<Particle, "maxLife">): void {
  if (particles.length < MAX_PARTICLES) particles.push({ ...p, maxLife: p.life });
}

function burst(at: Point): void {
  const origin = toWorld(at, new THREE.Vector3()).setY(TILE_TOP + 0.5);
  for (let i = 0; i < 30; i++) {
    const a = Math.random() * Math.PI * 2;
    const speed = 2 + Math.random() * 3;
    spawn({
      pos: origin.clone(),
      vel: new THREE.Vector3(Math.cos(a) * speed, 4 + Math.random() * 4, Math.sin(a) * speed),
      life: 0.6 + Math.random() * 0.4,
      gravity: 14,
      size: 1,
    });
  }
}

/** Фонтан искр из головы змейки — уровень пройден. */
function celebrate(): void {
  for (let i = 0; i < 90; i++) {
    const a = Math.random() * Math.PI * 2;
    const speed = 1 + Math.random() * 2.5;
    spawn({
      pos: head.position.clone(),
      vel: new THREE.Vector3(Math.cos(a) * speed, 7 + Math.random() * 5, Math.sin(a) * speed),
      life: 1.2 + Math.random() * 0.8,
      gravity: 10,
      size: 1.3,
    });
  }
}

function setActorsVisible(visible: boolean): void {
  for (const o of [body, head, coin, coinLight, beam, arrow]) o.visible = visible;
}

// ---------- Состояние игры ----------

type Mode = "menu" | "play" | "credits";

const clonePoints = (pts: Point[]): Point[] => pts.map((p) => ({ x: p.x, y: p.y }));
// step() меняет status, а TS сужает тип после проверок — читаем через функцию
const statusOf = (g: SnakeGame): Status => g.status;

const settings = loadSettings();
let mode: Mode = "menu";
let levelIndex = 0;
let game = new SnakeGame(levelConfig(LEVELS[0], COLS, ROWS));
// Позиции змейки до последнего шага: между ними и текущими плавно интерполируем
let prev = clonePoints(game.snake);
let acc = 0;
let levelTime = 0;
let shownStatus: Status | null = null;
let lastWin: { time: number; stars: number; newRecord: boolean } | null = null;

const DIR_VEC: Record<Direction, [number, number]> = {
  up: [0, -1],
  down: [0, 1],
  left: [-1, 0],
  right: [1, 0],
};

const positions = Array.from({ length: COLS * ROWS }, () => new THREE.Vector3());
const tmpA = new THREE.Vector3();
const tmpB = new THREE.Vector3();
const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpS = new THREE.Vector3();
const tmpC = new THREE.Color();
const tmpC2 = new THREE.Color();
const DEAD = new THREE.Color(0x8a2a2a);
const WARNING = new THREE.Color(0xff5a3c);
const START_YAW = Math.atan2(1, 0); // змейка стартует головой вправо

let last = performance.now();
let time = 0;
let shake = 0;
let deathTint = 0;
let headYaw = START_YAW;
let camYaw = START_YAW;
let foodKey = "";
let foodAppear = 1;
let sparkleTimer = 0;

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
      settings.shake = !settings.shake;
      saveSettings(settings);
      ui.showSettings(settings);
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
  ui.showHud(LEVELS[index], index, settings.camera);
  setActorsVisible(true);
}

function restartRun(): void {
  game.reset();
  prev = clonePoints(game.snake);
  acc = 0;
  levelTime = 0;
  deathTint = 0;
  headYaw = START_YAW;
  camYaw = START_YAW;
  yawVel.v = 0;
  camFocusVel.set(0, 0, 0);
  toWorld(game.snake[0], camFocus).multiplyScalar(settings.camera === "classic" ? CLASSIC_FOLLOW : 1);
  transition = 1;
  lastWin = null;
  shownStatus = null;
  particles.length = 0;
}

function openCredits(): void {
  mode = "credits";
  ui.hideMenu();
  ui.hideDialog();
  ui.hideHud();
  setActorsVisible(false);
  applyTheme("night");
  world.setObstacles([]);
  ui.showCredits(() => openMenu());
}

function onGameOver(): void {
  prev = clonePoints(game.snake);
  acc = 0;
  if (settings.shake) shake = 0.35;
}

function onWin(): void {
  const level = LEVELS[levelIndex];
  const stars = starsFor(level, levelTime);
  const { newRecord } = saveResult(level.id, levelTime, stars);
  lastWin = { time: levelTime, stars, newRecord };
  prev = clonePoints(game.snake);
  acc = 0;
  celebrate();
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

window.addEventListener("keydown", (e) => {
  if (mode === "menu") {
    if (ui.handleMenuKey(e.code)) e.preventDefault();
    return;
  }
  if (mode === "credits") {
    if (e.code === "Escape" || e.code === "Enter") {
      e.preventDefault();
      openMenu();
    }
    return;
  }

  if (game.status === "running" || game.status === "ready") {
    if (settings.camera === "classic") {
      const dir = DIRECTION_KEYS[e.code];
      if (dir) {
        e.preventDefault();
        game.turn(dir);
        return;
      }
    } else {
      const side = TURN_KEYS[e.code];
      if (side) {
        e.preventDefault();
        game.turnRelative(side);
        return;
      }
    }
  }
  if (game.status === "running") {
    if (e.code === "Space" || e.code === "KeyP" || e.code === "Escape") {
      e.preventDefault();
      game.togglePause();
    }
    return;
  }
  if (ui.handleDialogKey(e.code)) e.preventDefault();
});

// Свайпы для сенсорных экранов (веб-версия на телефоне): тап — старт, свайп — поворот
let touchStart: { x: number; y: number } | null = null;

window.addEventListener("touchstart", (e) => {
  touchStart = { x: e.touches[0].clientX, y: e.touches[0].clientY };
}, { passive: true });

window.addEventListener("touchend", (e) => {
  const start = touchStart;
  touchStart = null;
  if (!start || mode !== "play" || (game.status !== "running" && game.status !== "ready")) return;
  const dx = e.changedTouches[0].clientX - start.x;
  const dy = e.changedTouches[0].clientY - start.y;
  if (Math.max(Math.abs(dx), Math.abs(dy)) < 30) {
    game.start();
    return;
  }
  const horizontal = Math.abs(dx) > Math.abs(dy);
  if (settings.camera === "classic") game.turn(horizontal ? (dx > 0 ? "right" : "left") : dy > 0 ? "down" : "up");
  else if (horizontal) game.turnRelative(dx > 0 ? "right" : "left");
});

// ---------- Игровой цикл ----------

function frame(now: number): void {
  const dt = Math.min(now - last, 100) / 1000;
  last = now;
  time += dt;

  if (mode === "play") {
    if (game.status === "running") {
      levelTime += dt;
      acc += dt * 1000;
      while (acc >= game.tickMs) {
        acc -= game.tickMs;
        prev = clonePoints(game.snake);
        const eaten = game.food;
        if (game.step()) burst(eaten);
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
    updateSnake(alpha, dt);
    updateCoin(dt);
    updateArrow();
  }

  updateParticles(dt);
  updateCamera(dt);
  world.update(time, dt);

  composer.render();
  requestAnimationFrame(frame);
}

function updateSnake(alpha: number, dt: number): void {
  const snake = game.snake;
  const n = snake.length;

  for (let i = 0; i < n; i++) {
    toWorld(prev[i] ?? snake[i], tmpA);
    toWorld(snake[i], tmpB);
    positions[i].lerpVectors(tmpA, tmpB, alpha);
  }

  const span = Math.max(1, n - 1);
  const scaleAt = (f: number) => 0.88 - 0.28 * (f / span);
  // Мягкие полосы: зелёный ↔ салатовый, к хвосту чуть темнее
  const colorAt = (f: number) => {
    const t = f / span;
    const stripe = 0.5 + 0.5 * Math.cos(f * Math.PI * 0.7);
    tmpC.setHSL(0.33, 0.7, 0.42 - 0.1 * t);
    tmpC2.setHSL(0.22, 0.85, 0.55 - 0.1 * t);
    return tmpC.lerp(tmpC2, stripe * 0.55).lerp(DEAD, deathTint * 0.8);
  };

  const place = (index: number, pos: THREE.Vector3, f: number) => {
    const s = scaleAt(f);
    tmpS.set(s, s * 0.85, s);
    tmpA.copy(pos).setY(TILE_TOP + 0.5 * s * 0.85);
    body.setMatrixAt(index, tmpM.compose(tmpA, tmpQ, tmpS));
    body.setColorAt(index, colorAt(f));
  };

  let count = 0;
  for (let i = 0; i < n; i++) {
    if (i > 0) place(count++, positions[i], i);
    if (i < n - 1) place(count++, tmpB.lerpVectors(positions[i], positions[i + 1], 0.5), i + 0.5);
  }
  body.count = count;
  body.instanceMatrix.needsUpdate = true;
  body.instanceColor!.needsUpdate = true;

  // Голова: поворачиваем по фактическому направлению движения, плавно
  const bob = game.status === "running" ? Math.abs(Math.sin(time * 10)) * 0.05 : 0;
  head.position.copy(positions[0]).setY(TILE_TOP + 0.41 + bob);
  let dx = snake[0].x - (prev[0]?.x ?? snake[0].x);
  let dz = snake[0].y - (prev[0]?.y ?? snake[0].y);
  if (dx === 0 && dz === 0) [dx, dz] = DIR_VEC[game.direction];
  let diff = Math.atan2(dx, dz) - headYaw;
  diff = Math.atan2(Math.sin(diff), Math.cos(diff));
  headYaw += diff * (1 - Math.exp(-dt * 18));
  head.rotation.y = headYaw;
  headMat.color.copy(HEAD_ALIVE).lerp(DEAD, deathTint * 0.8);
  // Пощада у стены: голова мигает — пора поворачивать
  if (game.stalled && game.status === "running") headMat.color.lerp(WARNING, 0.5 + 0.5 * Math.sin(time * 30));
}

function updateCoin(dt: number): void {
  const active = game.status !== "won";
  coin.visible = coinLight.visible = beam.visible = active;
  if (!active) return;

  const key = `${game.food.x},${game.food.y}`;
  if (key !== foodKey) {
    foodKey = key;
    foodAppear = 0;
  }
  foodAppear = Math.min(1, foodAppear + dt / 0.35);

  // easeOutBack — монета «выпрыгивает» с небольшим перелётом
  const c = 1.70158;
  const t = foodAppear - 1;
  const s = 1 + (c + 1) * t * t * t + c * t * t;

  toWorld(game.food, coin.position).setY(TILE_TOP + 0.55 + Math.sin(time * 3) * 0.1);
  coin.scale.setScalar(Math.max(0.001, s));
  coin.rotation.y += dt * 3;
  coinLight.position.copy(coin.position).setY(TILE_TOP + 1);
  coinLight.intensity = (2.5 + Math.sin(time * 4) * 0.6) * foodAppear;
  beam.position.set(coin.position.x, TILE_TOP + 5, coin.position.z);
  beam.scale.set(1, foodAppear, 1);

  // Редкие искорки вокруг монеты
  sparkleTimer -= dt;
  if (sparkleTimer <= 0 && foodAppear === 1) {
    sparkleTimer = 0.18;
    const a = Math.random() * Math.PI * 2;
    spawn({
      pos: coin.position.clone().add(new THREE.Vector3(Math.cos(a) * 0.45, (Math.random() - 0.5) * 0.5, Math.sin(a) * 0.45)),
      vel: new THREE.Vector3(0, 0.6, 0),
      life: 0.6,
      gravity: 0,
      size: 0.6,
    });
  }
}

function updateParticles(dt: number): void {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.life -= dt;
    if (p.life <= 0) {
      particles.splice(i, 1);
      continue;
    }
    p.vel.y -= p.gravity * dt;
    p.pos.addScaledVector(p.vel, dt);
    if (p.pos.y < TILE_TOP + 0.08) {
      p.pos.y = TILE_TOP + 0.08;
      p.vel.y *= -0.4;
      p.vel.x *= 0.7;
      p.vel.z *= 0.7;
    }
  }
  particles.forEach((p, i) => {
    tmpS.setScalar(p.size * (p.life / p.maxLife));
    tmpQ.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, time * 6 + i);
    particleMesh.setMatrixAt(i, tmpM.compose(p.pos, tmpQ, tmpS));
  });
  tmpQ.identity();
  particleMesh.count = particles.length;
  particleMesh.instanceMatrix.needsUpdate = true;
}

function updateCamera(dt: number): void {
  let smoothTime: number;
  transition = Math.max(0, transition - dt);

  if (mode === "play" && settings.camera === "classic") {
    // Фокус догоняет голову, только когда она выходит из мёртвой зоны
    tmpA.copy(positions[0]).multiplyScalar(CLASSIC_FOLLOW).setY(0);
    const d = tmpA.distanceTo(camFocus);
    if (d > DEAD_ZONE) camFocus.lerp(tmpA, (d - DEAD_ZONE) / d);
    camGoal.copy(camFocus).add(CLASSIC_OFFSET);
    lookGoal.copy(camFocus);
    smoothTime = 0.5;
  } else if (mode === "play") {
    // Курс берём с учётом очереди: камера начинает поворот в момент нажатия
    const yawTarget = Math.atan2(...DIR_VEC[game.heading]);
    let diff = yawTarget - camYaw;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    camYaw = smoothDamp(camYaw, camYaw + diff, yawVel, CHASE_YAW_TIME, dt, CHASE_MAX_YAW_SPEED);

    // Позицию считаем из сглаженных курса и фокуса, а не сглаживаем в мире:
    // при повороте камера идёт по дуге вокруг головы и не «срезает угол»
    tmpA.copy(positions[0]).setY(0);
    smoothDampVec(camFocus, tmpA, camFocusVel, CHASE_FOLLOW_TIME, dt);
    camFwd.set(Math.sin(camYaw), 0, Math.cos(camYaw));
    camGoal.copy(camFocus).addScaledVector(camFwd, -CHASE_BACK).setY(CHASE_UP);
    lookGoal.copy(camFocus).addScaledVector(camFwd, CHASE_LOOK_AHEAD);
    // Плавный въезд из меню, дальше — почти жёсткая привязка
    smoothTime = Math.max(0.02, transition * 0.5);
  } else {
    // Меню и титры: медленный облёт острова
    const a = time * 0.05;
    camGoal.set(Math.sin(a) * 30, 14, Math.cos(a) * 30);
    lookGoal.set(0, -1, 0);
    smoothTime = 1.2;
  }

  smoothDampVec(camPos, camGoal, camPosVel, smoothTime, dt);
  smoothDampVec(camLook, lookGoal, camLookVel, smoothTime, dt);

  shake *= Math.exp(-dt * 8);
  camera.position.copy(camPos).add(tmpA.set((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake, 0));
  camera.lookAt(camLook);
}

function updateArrow(): void {
  tmpA.copy(coin.position).sub(head.position).setY(0);
  const dist = tmpA.length();
  arrow.visible = dist > 2.5 && game.status !== "over" && game.status !== "won";
  if (!arrow.visible) return;
  tmpA.divideScalar(dist);
  arrow.position.copy(head.position).addScaledVector(tmpA, 0.9).setY(head.position.y + 0.95 + Math.sin(time * 5) * 0.06);
  arrow.rotation.y = Math.atan2(tmpA.x, tmpA.z);
}

openMenu();
requestAnimationFrame(frame);
