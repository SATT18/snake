import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { GTAOPass } from "three/addons/postprocessing/GTAOPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { Direction, Point, SnakeGame } from "./game.js";
import { createSky, createWorld, SUN_DIR, TILE_TOP } from "./world.js";

const COLS = 20;
const ROWS = 20;
const BEST_KEY = "snake.best";

const canvas = document.getElementById("board") as HTMLCanvasElement;
const scoreEl = document.getElementById("score")!;
const bestEl = document.getElementById("best")!;
const overlay = document.getElementById("overlay")!;
const overlayTitle = document.getElementById("overlay-title")!;
const overlayText = document.getElementById("overlay-text")!;

const game = new SnakeGame(COLS, ROWS);
let best = loadBest();

// ---------- Рендерер и постобработка ----------

const renderer = new THREE.WebGLRenderer({ canvas, powerPreference: "high-performance" });
const pixelRatio = Math.min(window.devicePixelRatio, 2);
renderer.setPixelRatio(pixelRatio);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
// Neutral сохраняет насыщенность цветов — для яркого мультяшного стиля лучше ACES
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = 1.05;

const scene = new THREE.Scene();

// Карта окружения из того же неба: глянцевые поверхности отражают голубое небо
const pmrem = new THREE.PMREMGenerator(renderer);
const envScene = new THREE.Scene();
envScene.add(createSky());
scene.environment = pmrem.fromScene(envScene, 0, 0.1, 1000).texture;
scene.environmentIntensity = 0.6;

const world = createWorld(scene, COLS, ROWS);

const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 1000);
// Камера от третьего лица: держится за спиной змейки и плавно доворачивает вслед за ней
const CAM_BACK = 8.5;
const CAM_UP = 7.5;
const LOOK_AHEAD = 4;
const camPos = new THREE.Vector3();
const camLook = new THREE.Vector3();
const camFwd = new THREE.Vector3();
const camGoal = new THREE.Vector3();
const lookGoal = new THREE.Vector3();
let camReady = false;

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

// ---------- Свет ----------

scene.add(new THREE.HemisphereLight(0xbfe3ff, 0x5a8a3a, 1.1));

const sun = new THREE.DirectionalLight(0xfff1d6, 3.2);
sun.position.copy(SUN_DIR).multiplyScalar(50); // совпадает с солнцем на небе
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
Object.assign(sun.shadow.camera, { left: -30, right: 30, top: 30, bottom: -30, near: 1, far: 120 });
sun.shadow.bias = -0.0003;
sun.shadow.normalBias = 0.03;
scene.add(sun);

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

// ---------- Частицы: искры от монеты ----------

interface Particle {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  life: number;
  maxLife: number;
  gravity: number;
  size: number;
}

const MAX_PARTICLES = 220;
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

// ---------- Управление ----------

// Камера смотрит из-за спины, поэтому повороты относительные: влево/вправо от курса
const TURN_KEYS: Record<string, "left" | "right"> = {
  ArrowLeft: "left",
  ArrowRight: "right",
  KeyA: "left",
  KeyD: "right",
};
const START_KEYS = new Set(["ArrowUp", "KeyW"]);

const clonePoints = (pts: Point[]): Point[] => pts.map((p) => ({ x: p.x, y: p.y }));

// Позиции змейки до последнего шага: между ними и текущими плавно интерполируем
let prev = clonePoints(game.snake);
let acc = 0;

window.addEventListener("keydown", (e) => {
  const side = TURN_KEYS[e.code];
  if (side) {
    e.preventDefault();
    game.turnRelative(side);
  } else if (START_KEYS.has(e.code)) {
    e.preventDefault();
    game.start();
  } else if (e.code === "Space" || e.code === "KeyP" || e.code === "Escape") {
    e.preventDefault();
    game.togglePause();
  } else if (e.code === "Enter" && game.status === "over") {
    game.reset();
    prev = clonePoints(game.snake);
    acc = 0;
  }
  updateUi();
});

// ---------- Игровой цикл ----------

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

let last = performance.now();
let time = 0;
let shake = 0;
let deathTint = 0;
let headYaw = Math.atan2(1, 0);
let foodKey = "";
let foodAppear = 1;
let sparkleTimer = 0;
let camYaw = headYaw;

function frame(now: number): void {
  const dt = Math.min(now - last, 100) / 1000;
  last = now;
  time += dt;

  if (game.status === "running") {
    acc += dt * 1000;
    while (acc >= game.tickMs) {
      acc -= game.tickMs;
      prev = clonePoints(game.snake);
      const eaten = game.food;
      if (game.step()) burst(eaten);
      // step() меняет status, но TS сузил тип до "running" — сравниваем как string
      if ((game.status as string) === "over") {
        onGameOver();
        break;
      }
      updateUi();
    }
  }

  const alpha = game.status === "running" || game.status === "paused" ? Math.min(acc / game.tickMs, 1) : 1;
  deathTint += ((game.status === "over" ? 1 : 0) - deathTint) * (1 - Math.exp(-dt * 5));

  updateSnake(alpha, dt);
  updateCoin(dt);
  updateParticles(dt);
  updateCamera(dt);
  updateArrow();
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
}

function updateCoin(dt: number): void {
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
  // Курс камеры догоняет курс головы медленнее, чем сама голова, — поворот ощущается плавным
  let diff = headYaw - camYaw;
  diff = Math.atan2(Math.sin(diff), Math.cos(diff));
  camYaw += diff * (1 - Math.exp(-dt * 3));
  camFwd.set(Math.sin(camYaw), 0, Math.cos(camYaw));

  camGoal.copy(positions[0]).setY(0).addScaledVector(camFwd, -CAM_BACK).setY(CAM_UP);
  lookGoal.copy(positions[0]).setY(0).addScaledVector(camFwd, LOOK_AHEAD);
  if (!camReady) {
    camPos.copy(camGoal);
    camLook.copy(lookGoal);
    camReady = true;
  }
  const k = 1 - Math.exp(-dt * 6);
  camPos.lerp(camGoal, k);
  camLook.lerp(lookGoal, k);

  shake *= Math.exp(-dt * 6);
  camera.position.copy(camPos).add(tmpA.set((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake, 0));
  camera.lookAt(camLook);
}

function updateArrow(): void {
  tmpA.copy(coin.position).sub(head.position).setY(0);
  const dist = tmpA.length();
  arrow.visible = dist > 2.5 && game.status !== "over";
  if (!arrow.visible) return;
  tmpA.divideScalar(dist);
  arrow.position.copy(head.position).addScaledVector(tmpA, 0.9).setY(head.position.y + 0.95 + Math.sin(time * 5) * 0.06);
  arrow.rotation.y = Math.atan2(tmpA.x, tmpA.z);
}

function onGameOver(): void {
  prev = clonePoints(game.snake);
  acc = 0;
  shake = 0.7;
  if (game.score > best) {
    best = game.score;
    saveBest(best);
  }
  updateUi();
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
      show("Змейка", "↑ — старт, ← → — поворот");
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
requestAnimationFrame(frame);
