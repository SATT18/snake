// Окружение вокруг игрового поля: небо с солнцем, океан, парящие острова с постройками,
// горы на горизонте, облака, птицы и воздушные шары.
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import type { Obstacle } from "./levels.js";
import type { Theme } from "./themes.js";

export const TILE_TOP = 0.1; // высота верхней грани плиток поля

const OCEAN_Y = -7;
const GROUND_Y = -0.02; // верх травяного края острова вокруг поля

export interface World {
  update(time: number, dt: number): void;
  setTheme(theme: Theme): void;
  setObstacles(obstacles: Obstacle[]): void;
}

type Updater = (time: number, dt: number) => void;

// ---------- Утилиты ----------

// Детерминированный ГСЧ: раскладка мира одинаковая при каждом запуске
let seed = 20261027;
function rand(): number {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const range = (a: number, b: number) => a + (b - a) * rand();
const pick = <T>(items: T[]): T => items[Math.floor(rand() * items.length)];

const matCache = new Map<string, THREE.MeshStandardMaterial>();
function mat(color: number, params: THREE.MeshStandardMaterialParameters = {}): THREE.MeshStandardMaterial {
  const key = color + JSON.stringify(params);
  let m = matCache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, roughness: 0.85, ...params });
    matCache.set(key, m);
  }
  return m;
}

function mesh(geo: THREE.BufferGeometry, material: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

const SPHERE = new THREE.SphereGeometry(1, 20, 14);
const LEAF_COLORS = [0x3fae3a, 0x4cbb3f, 0x2f9d4a, 0x6cc644, 0xff9ccf, 0xffb238, 0xff7a3a];
const FLOWER_COLORS = [0xff5c8a, 0xffd23f, 0xffffff, 0xb36bff, 0xff8a3d, 0x5cc8ff];

const grassMat = mat(0x5cb338);
const dirtMat = mat(0xb97a45, { roughness: 0.95 });
const darkDirtMat = mat(0x9c6237, { roughness: 0.95 });
const rockMat = mat(0x8a5a35, { roughness: 1, flatShading: true });
const trunkMat = mat(0x8b5a2b, { roughness: 0.9 });

// ---------- Мир ----------

// Один материал неба на всех: и на сцене, и в сцене для карты окружения — тема меняет оба сразу
const skyMaterial = new THREE.ShaderMaterial({
  side: THREE.BackSide,
  depthWrite: false,
  fog: false,
  uniforms: {
    top: { value: new THREE.Color() },
    horizon: { value: new THREE.Color() },
    bottom: { value: new THREE.Color() },
    sunDir: { value: new THREE.Vector3(0, 1, 0) },
    sunColor: { value: new THREE.Color() },
    sunSize: { value: 900 },
    halo: { value: 0.35 },
  },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 top;
      uniform vec3 horizon;
      uniform vec3 bottom;
      uniform vec3 sunDir;
      uniform vec3 sunColor;
      uniform float sunSize;
      uniform float halo;
      varying vec3 vDir;
      void main() {
        vec3 dir = normalize(vDir);
        float h = dir.y;
        vec3 c = h > 0.0 ? mix(horizon, top, pow(h, 0.55)) : mix(horizon, bottom, pow(-h, 0.4));
        float s = max(dot(dir, sunDir), 0.0);
        c += sunColor * (pow(s, sunSize) * 8.0 + pow(s, 20.0) * halo);
        gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
});

/** Градиентное небо с солнцем. Отдельной функцией — его же используем как карту окружения. */
export function createSky(): THREE.Mesh {
  return new THREE.Mesh(new THREE.SphereGeometry(400, 32, 16), skyMaterial);
}

export function createWorld(scene: THREE.Scene, cols: number, rows: number): World {
  const updaters: Updater[] = [];
  const islandHalf = Math.max(cols, rows) / 2 + 4.5;

  scene.add(createSky());
  const fog = new THREE.Fog(0xffffff, 60, 230);
  scene.fog = fog;

  const stars = createStars();
  scene.add(stars);

  const ocean = createOcean();
  scene.add(ocean.mesh);
  updaters.push(ocean.update);

  scene.add(createIsland(islandHalf));
  scene.add(createHedges(cols, rows));
  scene.add(createGrass(cols, rows, islandHalf));
  scene.add(createRing(cols, rows, islandHalf));
  createIslets(scene, updaters);
  scene.add(createMountains());
  createSkyLife(scene, updaters);

  let obstacleGroup: THREE.Group | null = null;

  return {
    update(time, dt) {
      for (const u of updaters) u(time, dt);
    },
    setTheme(theme) {
      const u = skyMaterial.uniforms;
      u.top.value.set(theme.skyTop);
      u.horizon.value.set(theme.skyHorizon);
      u.bottom.value.set(theme.skyBottom);
      u.sunDir.value.copy(theme.sunDir);
      u.sunColor.value.set(theme.sunDisc);
      u.sunSize.value = theme.sunSize;
      u.halo.value = theme.halo;
      fog.color.set(theme.skyHorizon);

      (ocean.mesh.material as THREE.MeshStandardMaterial).color.set(theme.ocean);
      (stars.material as THREE.PointsMaterial).opacity = theme.stars;
      stars.visible = theme.stars > 0;
      cloudMat.color.set(theme.cloud);
      cloudMat.emissive.set(theme.cloud);
      glow = theme.glow;
      glassMat.emissiveIntensity = 0.9 * glow;
    },
    setObstacles(obstacles) {
      if (obstacleGroup) {
        scene.remove(obstacleGroup);
        obstacleGroup.traverse((o) => {
          if (o instanceof THREE.InstancedMesh) o.dispose();
        });
      }
      obstacleGroup = createObstacles(obstacles, cols, rows);
      scene.add(obstacleGroup);
    },
  };
}

// Множитель свечения окон и фонарей: ночью они горят ярче
let glow = 1;

function createStars(): THREE.Points {
  const count = 1500;
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const y = range(0.04, 1);
    const r = Math.sqrt(1 - y * y);
    const a = range(0, Math.PI * 2);
    positions.set([Math.cos(a) * r * 380, y * 380, Math.sin(a) * r * 380], i * 3);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  return new THREE.Points(
    geometry,
    new THREE.PointsMaterial({
      color: 0xffffff,
      size: 1.8,
      sizeAttenuation: false,
      transparent: true,
      opacity: 0,
      fog: false,
      depthWrite: false,
    }),
  );
}

// ---------- Препятствия уровня ----------

const OBSTACLE_HEDGE_GEO = new RoundedBoxGeometry(1.02, 0.8, 1.02, 3, 0.34);
const OBSTACLE_ROCK_GEO = new THREE.DodecahedronGeometry(0.45, 0);

/** Псевдослучайное число от координат клетки: препятствие выглядит одинаково при каждой загрузке. */
function cellNoise(x: number, y: number, salt: number): number {
  const s = Math.sin(x * 12.9898 + y * 78.233 + salt * 37.719) * 43758.5453;
  return s - Math.floor(s);
}

function createObstacles(obstacles: Obstacle[], cols: number, rows: number): THREE.Group {
  const g = new THREE.Group();
  const hedges = obstacles.filter((o) => o.kind === "hedge");
  const stones = obstacles.filter((o) => o.kind === "rock");
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const s = new THREE.Vector3();
  const p = new THREE.Vector3();
  const c = new THREE.Color();
  const base = TILE_TOP - 0.02;

  if (hedges.length) {
    const mesh = new THREE.InstancedMesh(OBSTACLE_HEDGE_GEO, new THREE.MeshStandardMaterial({ roughness: 0.95 }), hedges.length);
    mesh.castShadow = mesh.receiveShadow = true;
    hedges.forEach((o, i) => {
      const h = 0.8 + cellNoise(o.x, o.y, 1) * 0.25;
      s.set(1, h, 1);
      p.set(o.x - cols / 2 + 0.5, base + 0.4 * h, o.y - rows / 2 + 0.5);
      mesh.setMatrixAt(i, m.compose(p, q.identity(), s));
      mesh.setColorAt(i, c.setHSL(0.31 + cellNoise(o.x, o.y, 2) * 0.03, 0.7, 0.26 + cellNoise(o.x, o.y, 3) * 0.06));
    });
    g.add(mesh);
  }

  if (stones.length) {
    const mesh = new THREE.InstancedMesh(
      OBSTACLE_ROCK_GEO,
      new THREE.MeshStandardMaterial({ roughness: 0.9, flatShading: true }),
      stones.length,
    );
    mesh.castShadow = mesh.receiveShadow = true;
    stones.forEach((o, i) => {
      const n = (k: number) => cellNoise(o.x, o.y, k);
      s.set(0.95 + n(4) * 0.2, 0.7 + n(5) * 0.35, 0.95 + n(6) * 0.2);
      q.setFromEuler(e.set(n(7) * 0.4, n(8) * Math.PI * 2, n(9) * 0.4));
      p.set(o.x - cols / 2 + 0.5, base + 0.3 * s.y, o.y - rows / 2 + 0.5);
      mesh.setMatrixAt(i, m.compose(p, q, s));
      mesh.setColorAt(i, c.setHSL(0.6, 0.06, 0.55 + n(10) * 0.12));
    });
    g.add(mesh);
  }
  return g;
}

function createOcean(): { mesh: THREE.Mesh; update: Updater } {
  const geometry = new THREE.PlaneGeometry(520, 520, 90, 90);
  geometry.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({ color: 0x1c8be0, roughness: 0.12, metalness: 0.05 }),
  );
  mesh.position.y = OCEAN_Y;
  mesh.receiveShadow = true;

  const pos = geometry.attributes.position as THREE.BufferAttribute;
  return {
    mesh,
    update(time) {
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i);
        const z = pos.getZ(i);
        pos.setY(i, Math.sin(x * 0.11 + time * 0.9) * 0.35 + Math.cos(z * 0.09 + time * 0.7) * 0.35);
      }
      pos.needsUpdate = true;
      geometry.computeVertexNormals();
    },
  };
}

// ---------- Главный остров ----------

/** Парящий остров под полем: травяной край, два слоя земли и каменный «корень». */
function createIsland(half: number): THREE.Group {
  const g = new THREE.Group();
  const w = half * 2;
  g.add(
    mesh(new RoundedBoxGeometry(w, 0.5, w, 4, 0.25), grassMat, 0, GROUND_Y - 0.25),
    mesh(new RoundedBoxGeometry(w - 0.6, 2, w - 0.6, 4, 0.4), dirtMat, 0, -1.5),
    mesh(new RoundedBoxGeometry(w - 1.4, 1.2, w - 1.4, 4, 0.4), darkDirtMat, 0, -3),
  );
  const root = mesh(new THREE.CylinderGeometry((w - 2) / Math.SQRT2, 3, 2.6, 4), rockMat, 0, -4.9);
  root.rotation.y = Math.PI / 4;
  g.add(root);
  return g;
}

/** Живая изгородь по периметру поля (она же стены) с цветами сверху. */
function createHedges(cols: number, rows: number): THREE.Group {
  const cells: [number, number][] = [];
  for (let x = -1; x <= cols; x++) cells.push([x, -1], [x, rows]);
  for (let y = 0; y < rows; y++) cells.push([-1, y], [cols, y]);

  const hedges = new THREE.InstancedMesh(
    new RoundedBoxGeometry(1.02, 0.8, 1.02, 3, 0.34),
    new THREE.MeshStandardMaterial({ roughness: 0.95 }),
    cells.length,
  );
  hedges.castShadow = true;
  hedges.receiveShadow = true;

  const flowers: THREE.Vector3[] = [];
  const m = new THREE.Matrix4();
  const c = new THREE.Color();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  const p = new THREE.Vector3();
  cells.forEach(([x, y], i) => {
    const h = 0.85 + rand() * 0.3;
    s.set(1, h, 1);
    p.set(x - cols / 2 + 0.5, GROUND_Y + 0.4 * h, y - rows / 2 + 0.5);
    hedges.setMatrixAt(i, m.compose(p, q, s));
    hedges.setColorAt(i, c.setHSL(0.31 + rand() * 0.03, 0.7, 0.26 + rand() * 0.06));
    if (rand() < 0.45) flowers.push(new THREE.Vector3(p.x + range(-0.3, 0.3), GROUND_Y + 0.8 * h, p.z + range(-0.3, 0.3)));
  });

  const g = new THREE.Group();
  g.add(hedges, createFlowerHeads(flowers));
  return g;
}

/** Травинки на поле и вокруг него — тысячи инстансов одной геометрии. */
function createGrass(cols: number, rows: number, half: number): THREE.InstancedMesh {
  const geo = new THREE.ConeGeometry(0.035, 0.24, 3);
  geo.translate(0, 0.12, 0);
  const spots: THREE.Vector3[] = [];
  for (let i = 0; i < 1400; i++) {
    spots.push(new THREE.Vector3(range(-cols / 2, cols / 2), TILE_TOP, range(-rows / 2, rows / 2)));
  }
  const inner = Math.max(cols, rows) / 2 + 1.05;
  while (spots.length < 2800) {
    const x = range(-half + 0.3, half - 0.3);
    const z = range(-half + 0.3, half - 0.3);
    if (Math.max(Math.abs(x), Math.abs(z)) > inner) spots.push(new THREE.Vector3(x, GROUND_Y, z));
  }

  const grass = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ roughness: 0.9 }), spots.length);
  grass.receiveShadow = true;
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const s = new THREE.Vector3();
  const c = new THREE.Color();
  spots.forEach((p, i) => {
    q.setFromEuler(e.set(range(-0.35, 0.35), range(0, Math.PI * 2), range(-0.35, 0.35)));
    s.set(1, range(0.6, 1.4), 1);
    grass.setMatrixAt(i, m.compose(p, q, s));
    grass.setColorAt(i, c.setHSL(range(0.25, 0.32), range(0.6, 0.75), range(0.3, 0.45)));
  });
  return grass;
}

/** Полоса земли между изгородью и краем острова: деревья, кусты, камни, грибы, цветы. */
function createRing(cols: number, rows: number, half: number): THREE.Group {
  const g = new THREE.Group();
  const inner = Math.max(cols, rows) / 2 + 1.5;
  const placed: THREE.Vector2[] = [];
  const flowerCenters: THREE.Vector3[] = [];

  for (let attempt = 0; attempt < 3000 && placed.length < 70; attempt++) {
    const x = range(-half + 0.8, half - 0.8);
    const z = range(-half + 0.8, half - 0.8);
    if (Math.max(Math.abs(x), Math.abs(z)) < inner) continue;
    const p = new THREE.Vector2(x, z);
    if (placed.some((o) => o.distanceTo(p) < 1.5)) continue;
    placed.push(p);

    // Высота всего, что стоит вокруг поля, ≤ ~3 — чтобы не перекрывать камеру
    const r = rand();
    let obj: THREE.Object3D;
    if (r < 0.3) obj = createTree(pick(LEAF_COLORS), range(0.6, 0.85));
    else if (r < 0.45) obj = createPine(range(0.55, 0.8));
    else if (r < 0.6) obj = createBush(range(0.6, 1));
    else if (r < 0.72) obj = createRock(range(0.5, 1));
    else if (r < 0.84) obj = createMushroom(range(0.8, 1.5));
    else {
      flowerCenters.push(new THREE.Vector3(x, GROUND_Y, z));
      continue;
    }
    obj.position.set(x, GROUND_Y, z);
    obj.rotation.y = range(0, Math.PI * 2);
    g.add(obj);
  }

  // Клумбы + одиночные цветы по всему кольцу
  const heads: THREE.Vector3[] = [];
  for (const c of flowerCenters) {
    for (let i = 0; i < 9; i++) heads.push(c.clone().add(new THREE.Vector3(range(-0.6, 0.6), 0, range(-0.6, 0.6))));
  }
  while (heads.length < flowerCenters.length * 9 + 120) {
    const x = range(-half + 0.4, half - 0.4);
    const z = range(-half + 0.4, half - 0.4);
    if (Math.max(Math.abs(x), Math.abs(z)) > inner - 0.2) heads.push(new THREE.Vector3(x, GROUND_Y, z));
  }
  g.add(createFlowers(heads));
  return g;
}

// ---------- Растения и камни ----------

function createTree(leafColor: number, scale: number): THREE.Group {
  const tree = new THREE.Group();
  tree.add(mesh(new THREE.CylinderGeometry(0.16, 0.24, 1.3, 10), trunkMat, 0, 0.65));
  const leaf = mat(leafColor, { roughness: 0.7 });
  const blobs: [number, number, number, number][] = [
    [0, 1.75, 0, 0.85],
    [0.45, 1.45, 0.2, 0.55],
    [-0.4, 1.5, -0.15, 0.6],
    [0.05, 2.35, 0.05, 0.5],
  ];
  for (const [x, y, z, r] of blobs) {
    const m = mesh(SPHERE, leaf, x, y, z);
    m.scale.setScalar(r);
    tree.add(m);
  }
  tree.scale.setScalar(scale);
  return tree;
}

function createPine(scale: number): THREE.Group {
  const tree = new THREE.Group();
  tree.add(mesh(new THREE.CylinderGeometry(0.12, 0.18, 0.8, 8), trunkMat, 0, 0.4));
  const needles = mat(0x2e7d4f, { roughness: 0.8, flatShading: true });
  for (let i = 0; i < 3; i++) {
    tree.add(mesh(new THREE.ConeGeometry(0.95 - i * 0.22, 1.2, 8), needles, 0, 1.1 + i * 0.65));
  }
  tree.scale.setScalar(scale);
  return tree;
}

function createBush(scale: number): THREE.Group {
  const bush = new THREE.Group();
  const leaf = mat(pick([0x3c9e3a, 0x4fb548, 0x2f8f45]), { roughness: 0.8 });
  for (const [x, y, z, r] of [
    [0, 0.4, 0, 0.5],
    [0.45, 0.3, 0.1, 0.38],
    [-0.4, 0.28, -0.1, 0.35],
  ]) {
    const m = mesh(SPHERE, leaf, x, y, z);
    m.scale.set(r, r * 0.85, r);
    bush.add(m);
  }
  bush.scale.setScalar(scale);
  return bush;
}

function createRock(scale: number): THREE.Mesh {
  const rock = mesh(new THREE.DodecahedronGeometry(0.5, 0), mat(pick([0x9aa3ad, 0x8c939c, 0xa7a29a]), { flatShading: true }));
  rock.scale.set(scale * range(0.8, 1.3), scale * range(0.5, 0.9), scale * range(0.8, 1.2));
  rock.position.y = scale * 0.15;
  return rock;
}

function createMushroom(scale: number): THREE.Group {
  const g = new THREE.Group();
  const cream = mat(0xfff3dc);
  g.add(mesh(new THREE.CylinderGeometry(0.13, 0.18, 0.6, 12), cream, 0, 0.3));

  const capColor = pick([0xe53935, 0xe53935, 0xff7a1a, 0x9c4dff]);
  const cap = mesh(new THREE.SphereGeometry(0.45, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), mat(capColor, { roughness: 0.5 }), 0, 0.55);
  cap.scale.y = 0.75;
  g.add(cap);
  const under = mesh(new THREE.CircleGeometry(0.45, 24), cream, 0, 0.55);
  under.rotation.x = Math.PI / 2;
  g.add(under);

  const spotMat = mat(0xffffff, { roughness: 0.6 });
  const spots: [number, number][] = [[0, 0]];
  for (let i = 0; i < 5; i++) spots.push([(i / 5) * Math.PI * 2 + range(-0.3, 0.3), range(0.55, 0.95)]);
  for (const [theta, phi] of spots) {
    const spot = mesh(SPHERE, spotMat, 0.45 * Math.sin(phi) * Math.cos(theta), 0.55 + 0.45 * Math.cos(phi) * 0.75, 0.45 * Math.sin(phi) * Math.sin(theta));
    spot.scale.set(0.08, 0.08, 0.035); // после lookAt локальная z — нормаль к шляпке
    spot.lookAt(spot.position.clone().multiplyScalar(2).setY(spot.position.y + 1));
    g.add(spot);
  }
  g.scale.setScalar(scale);
  return g;
}

function createFlowerHeads(spots: THREE.Vector3[]): THREE.InstancedMesh {
  const geo = new THREE.SphereGeometry(0.08, 8, 6);
  geo.scale(1, 0.6, 1);
  const heads = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ roughness: 0.6 }), spots.length);
  const m = new THREE.Matrix4();
  const c = new THREE.Color();
  spots.forEach((p, i) => {
    heads.setMatrixAt(i, m.makeTranslation(p.x, p.y + 0.04, p.z));
    heads.setColorAt(i, c.set(pick(FLOWER_COLORS)));
  });
  return heads;
}

function createFlowers(spots: THREE.Vector3[]): THREE.Group {
  const stemGeo = new THREE.CylinderGeometry(0.012, 0.012, 0.26, 4);
  stemGeo.translate(0, 0.13, 0);
  const stems = new THREE.InstancedMesh(stemGeo, mat(0x3f8f2f), spots.length);
  const m = new THREE.Matrix4();
  spots.forEach((p, i) => stems.setMatrixAt(i, m.makeTranslation(p.x, p.y, p.z)));
  const g = new THREE.Group();
  g.add(stems, createFlowerHeads(spots.map((p) => p.clone().setY(p.y + 0.26))));
  return g;
}

// ---------- Постройки ----------

function createWindmill(): { group: THREE.Group; update: Updater } {
  const g = new THREE.Group();
  g.add(mesh(new THREE.CylinderGeometry(0.7, 1.1, 4, 10), mat(0xf2e8d5), 0, 2));
  g.add(mesh(new THREE.ConeGeometry(0.95, 1.3, 10), mat(0xd6453d, { roughness: 0.6 }), 0, 4.65));
  g.add(mesh(new THREE.BoxGeometry(0.6, 1, 0.1), mat(0x7a4a24), 0, 0.5, 1.02));

  const blades = new THREE.Group();
  blades.position.set(0, 3.9, 0.95);
  const wood = mat(0xc8a06a);
  const sail = mat(0xfff8ec, { side: THREE.DoubleSide });
  for (let i = 0; i < 4; i++) {
    const arm = new THREE.Group();
    arm.rotation.z = (i * Math.PI) / 2;
    arm.add(mesh(new THREE.BoxGeometry(0.12, 2.6, 0.08), wood, 0, 1.3));
    arm.add(mesh(new THREE.BoxGeometry(0.55, 1.8, 0.03), sail, 0.33, 1.55));
    blades.add(arm);
  }
  const hub = mesh(SPHERE, wood);
  hub.scale.setScalar(0.2);
  blades.add(hub);
  g.add(blades);

  return { group: g, update: (_t, dt) => (blades.rotation.z -= dt * 0.9) };
}

function createLighthouse(): { group: THREE.Group; update: Updater } {
  const g = new THREE.Group();
  const bands = 6;
  for (let i = 0; i < bands; i++) {
    const r0 = 0.9 - (i / bands) * 0.3;
    const r1 = 0.9 - ((i + 1) / bands) * 0.3;
    g.add(mesh(new THREE.CylinderGeometry(r1, r0, 0.8, 16), mat(i % 2 ? 0xffffff : 0xe04848, { roughness: 0.5 }), 0, 0.4 + i * 0.8));
  }
  const topY = bands * 0.8;
  g.add(mesh(new THREE.CylinderGeometry(0.95, 0.95, 0.15, 16), mat(0x374151), 0, topY + 0.075));
  const lampMat = new THREE.MeshStandardMaterial({ color: 0xfff3c4, emissive: 0xffd36b, emissiveIntensity: 3 });
  g.add(mesh(new THREE.CylinderGeometry(0.45, 0.45, 0.7, 12), lampMat, 0, topY + 0.5));
  g.add(mesh(new THREE.ConeGeometry(0.65, 0.8, 12), mat(0xe04848, { roughness: 0.5 }), 0, topY + 1.25));
  return { group: g, update: (t) => (lampMat.emissiveIntensity = (2.2 + Math.sin(t * 3) * 1.6) * glow) };
}

const glassMat = new THREE.MeshStandardMaterial({ color: 0xffe3a0, emissive: 0xffc861, emissiveIntensity: 0.9 });

function createHouse(roofColor: number): THREE.Group {
  const g = new THREE.Group();
  g.add(mesh(new RoundedBoxGeometry(2.4, 1.7, 2, 2, 0.08), mat(0xfff1d6), 0, 0.85));
  const roof = mesh(new THREE.ConeGeometry(2, 1.3, 4), mat(roofColor, { roughness: 0.6, flatShading: true }), 0, 2.35);
  roof.rotation.y = Math.PI / 4;
  roof.scale.set(1.05, 1, 0.9);
  g.add(roof);
  g.add(mesh(new THREE.BoxGeometry(0.5, 0.9, 0.06), mat(0x7a4a24), 0, 0.45, 1.01));
  g.add(mesh(new THREE.BoxGeometry(0.45, 0.45, 0.06), glassMat, -0.75, 1.05, 1.01));
  g.add(mesh(new THREE.BoxGeometry(0.45, 0.45, 0.06), glassMat, 0.75, 1.05, 1.01));
  g.add(mesh(new THREE.BoxGeometry(0.3, 0.8, 0.3), mat(0xb5523b), 0.6, 2.5, -0.3));
  return g;
}

// ---------- Водопады ----------

let waterTexture: THREE.CanvasTexture | null = null;

function getWaterMaterial(): THREE.MeshBasicMaterial {
  if (!waterTexture) {
    const canvas = document.createElement("canvas");
    canvas.width = 64;
    canvas.height = 128;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#6cc6ff";
    ctx.fillRect(0, 0, 64, 128);
    for (let i = 0; i < 45; i++) {
      ctx.fillStyle = `rgba(255,255,255,${range(0.25, 0.8).toFixed(2)})`;
      ctx.fillRect(range(0, 64), range(0, 128), range(1, 4), range(12, 40));
    }
    waterTexture = new THREE.CanvasTexture(canvas);
    waterTexture.wrapS = waterTexture.wrapT = THREE.RepeatWrapping;
    waterTexture.repeat.set(2, 3);
    waterTexture.colorSpace = THREE.SRGBColorSpace;
  }
  return new THREE.MeshBasicMaterial({ map: waterTexture, transparent: true, opacity: 0.92, side: THREE.DoubleSide });
}

/** Ручей по верху островка и водопад с его края до самого океана. Локально: вода течёт к +z. */
function createWaterfall(size: number, isletY: number): THREE.Group {
  const g = new THREE.Group();
  const water = getWaterMaterial();

  const stream = new THREE.Mesh(new THREE.PlaneGeometry(1.1, size / 2), water);
  stream.rotation.x = -Math.PI / 2;
  stream.position.set(0, 0.32, size / 4);
  g.add(stream);

  const height = 0.3 + isletY - OCEAN_Y;
  const fall = new THREE.Mesh(new THREE.PlaneGeometry(1.1, height), water);
  fall.position.set(0, 0.3 - height / 2, size / 2 + 0.05);
  g.add(fall);

  // Брызги у основания
  const foam = mat(0xffffff, { roughness: 1, emissive: 0xffffff, emissiveIntensity: 0.2 });
  for (let i = 0; i < 4; i++) {
    const puff = new THREE.Mesh(SPHERE, foam);
    puff.scale.setScalar(range(0.4, 0.7));
    puff.position.set(range(-0.6, 0.6), 0.3 - height + 0.2, size / 2 + range(0.1, 0.6));
    g.add(puff);
  }
  return g;
}

// ---------- Островки вокруг ----------

type IsletKind = "windmill" | "forest" | "house" | "mushrooms" | "lighthouse" | "rocks";

function createIslets(scene: THREE.Scene, updaters: Updater[]): void {
  const specs: { angle: number; dist: number; y: number; size: number; kind: IsletKind; fall?: boolean }[] = [
    { angle: 0.25, dist: 27, y: -1, size: 8, kind: "windmill", fall: true },
    { angle: 1.0, dist: 33, y: 2, size: 6, kind: "forest" },
    { angle: 1.75, dist: 27, y: -2.5, size: 7, kind: "house", fall: true },
    { angle: 2.5, dist: 34, y: 1, size: 6.5, kind: "mushrooms" },
    { angle: 3.2, dist: 28, y: -1.5, size: 8, kind: "lighthouse" },
    { angle: 3.95, dist: 33, y: 3, size: 5.5, kind: "forest", fall: true },
    { angle: 4.65, dist: 27, y: -3, size: 6.5, kind: "rocks" },
    { angle: 5.45, dist: 31, y: 0.5, size: 7, kind: "house", fall: true },
  ];

  for (const spec of specs) {
    const g = new THREE.Group();
    const { size } = spec;
    g.add(mesh(new RoundedBoxGeometry(size, 0.6, size, 3, 0.25), grassMat));
    g.add(mesh(new RoundedBoxGeometry(size - 0.3, 1.2, size - 0.3, 3, 0.3), dirtMat, 0, -0.9));
    const root = mesh(new THREE.CylinderGeometry((size - 0.6) / Math.SQRT2, 0.4, size * 0.8, 4), rockMat, 0, -1.5 - size * 0.4);
    root.rotation.y = Math.PI / 4;
    g.add(root);

    const top = 0.3;
    const lim = size / 2 - 0.9;
    const put = (obj: THREE.Object3D, x: number, z: number) => {
      obj.position.set(x, top, z);
      g.add(obj);
    };

    switch (spec.kind) {
      case "windmill": {
        const w = createWindmill();
        put(w.group, -1, -1);
        updaters.push(w.update);
        put(createTree(pick(LEAF_COLORS), 0.9), 2, -1.5);
        put(createBush(1), -2.5, 1.5);
        break;
      }
      case "lighthouse": {
        const l = createLighthouse();
        put(l.group, 0, -0.5);
        updaters.push(l.update);
        put(createRock(1.4), 2.2, 1.6);
        put(createRock(1), -2.3, 2);
        break;
      }
      case "house":
        put(createHouse(pick([0x3b6fd6, 0xd6453d, 0x2fa36b])), -0.6, -0.8);
        put(createTree(pick(LEAF_COLORS), 1.1), 2, 1);
        put(createBush(0.9), -2.3, 1.8);
        break;
      case "mushrooms":
        for (let i = 0; i < 5; i++) put(createMushroom(range(1.5, 3.2)), range(-lim, lim), range(-lim, lim));
        break;
      case "rocks":
        for (let i = 0; i < 4; i++) put(createRock(range(1, 2)), range(-lim, lim), range(-lim, lim));
        put(createPine(1.2), 0, 0);
        break;
      case "forest":
        for (let i = 0; i < 6; i++) {
          const tree = rand() < 0.5 ? createPine(range(0.9, 1.4)) : createTree(pick(LEAF_COLORS), range(0.9, 1.3));
          put(tree, range(-lim, lim), range(-lim, lim));
        }
        break;
    }

    const x = Math.sin(spec.angle) * spec.dist;
    const z = Math.cos(spec.angle) * spec.dist;
    // Локальная +z смотрит на центр: туда же стоят фасады построек и течёт водопад
    g.rotation.y = Math.atan2(-x, -z);
    if (spec.fall) {
      const fall = createWaterfall(size, spec.y);
      fall.position.x = lim * 0.6;
      g.add(fall);
    }
    g.position.set(x, spec.y, z);
    scene.add(g);
  }

  if (waterTexture) {
    const tex = waterTexture;
    updaters.push((_t, dt) => (tex.offset.y += dt * 1.4));
  }
}

function createMountains(): THREE.Group {
  const g = new THREE.Group();
  const colors = [0x6aa85a, 0x7fb069, 0x5e9c76, 0x8fae6b, 0x6f9fb0];
  const snow = mat(0xffffff, { flatShading: true });
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * Math.PI * 2 + range(-0.12, 0.12);
    const d = range(150, 200);
    const h = range(28, 75);
    const r = range(22, 40);
    const m = new THREE.Mesh(new THREE.ConeGeometry(r, h, 7), mat(pick(colors), { flatShading: true }));
    m.position.set(Math.sin(a) * d, OCEAN_Y + h / 2, Math.cos(a) * d);
    m.rotation.y = range(0, Math.PI * 2);
    if (h > 45) {
      const cap = new THREE.Mesh(new THREE.ConeGeometry(r * 0.3, h * 0.3, 7), snow);
      cap.position.y = h / 2 - h * 0.15 + 0.3;
      cap.scale.setScalar(1.02);
      m.add(cap);
    }
    g.add(m);
  }
  return g;
}

// ---------- Небо: облака, птицы, шары ----------

// Отдельный экземпляр (не из кэша): тема перекрашивает облака
const cloudMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, emissive: 0xdbe9ff, emissiveIntensity: 0.25 });

function createCloud(scale: number): THREE.Group {
  const cloud = new THREE.Group();
  const puffs = 4 + Math.floor(rand() * 4);
  for (let i = 0; i < puffs; i++) {
    const r = range(0.8, 1.4);
    const puff = new THREE.Mesh(SPHERE, cloudMat);
    puff.position.set((i - puffs / 2) * 0.9 + range(-0.3, 0.3), range(-0.2, 0.6), range(-0.5, 0.5));
    puff.scale.set(r, r * 0.8, r);
    cloud.add(puff);
  }
  cloud.scale.setScalar(scale);
  return cloud;
}

function createBird(): { group: THREE.Group; left: THREE.Mesh; right: THREE.Mesh } {
  const wingGeo = new THREE.BufferGeometry();
  wingGeo.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0.18, 0, 0, -0.18, 0.9, 0, -0.1], 3));
  wingGeo.computeVertexNormals();
  const white = mat(0xffffff, { side: THREE.DoubleSide, roughness: 0.7 });
  const group = new THREE.Group();
  const body = new THREE.Mesh(SPHERE, white);
  body.scale.set(0.12, 0.1, 0.35);
  const right = new THREE.Mesh(wingGeo, white);
  const left = new THREE.Mesh(wingGeo, white);
  left.scale.x = -1;
  group.add(body, left, right);
  return { group, left, right };
}

function createBalloon(color: number): THREE.Group {
  const g = new THREE.Group();
  const env = mesh(SPHERE, mat(color, { roughness: 0.55 }));
  env.scale.set(2, 2.3, 2);
  const band = mesh(SPHERE, mat(0xffffff, { roughness: 0.55 }));
  band.scale.set(2.03, 0.45, 2.03);
  const skirt = mesh(new THREE.CylinderGeometry(0.7, 1.3, 1.2, 16), mat(color, { roughness: 0.55 }), 0, -2.4);
  const basket = mesh(new THREE.BoxGeometry(0.9, 0.6, 0.9), mat(0x8b5a2b), 0, -3.9);
  g.add(env, band, skirt, basket);
  for (const [x, z] of [
    [0.4, 0.4],
    [-0.4, 0.4],
    [0.4, -0.4],
    [-0.4, -0.4],
  ]) {
    g.add(mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.6, 4), mat(0x5b4636), x, -3.3, z));
  }
  return g;
}

function createSkyLife(scene: THREE.Scene, updaters: Updater[]): void {
  const clouds = new THREE.Group();
  for (let i = 0; i < 18; i++) {
    const a = range(0, Math.PI * 2);
    const d = range(55, 140);
    const cloud = createCloud(range(2, 5));
    cloud.position.set(Math.sin(a) * d, range(12, 40), Math.cos(a) * d);
    cloud.rotation.y = range(0, Math.PI * 2);
    clouds.add(cloud);
  }
  // Низкие облака под островами
  for (let i = 0; i < 6; i++) {
    const a = range(0, Math.PI * 2);
    const d = range(24, 45);
    const cloud = createCloud(range(1.8, 2.8));
    cloud.position.set(Math.sin(a) * d, range(-6, -3), Math.cos(a) * d);
    clouds.add(cloud);
  }
  scene.add(clouds);
  updaters.push((_t, dt) => (clouds.rotation.y += dt * 0.008));

  for (let i = 0; i < 8; i++) {
    const bird = createBird();
    const radius = range(18, 40);
    const height = range(9, 18);
    const speed = range(0.25, 0.45) * (rand() < 0.5 ? 1 : -1);
    const phase = range(0, Math.PI * 2);
    const next = new THREE.Vector3();
    scene.add(bird.group);
    updaters.push((t) => {
      const a = phase + t * speed;
      bird.group.position.set(Math.cos(a) * radius, height + Math.sin(t * 0.7 + phase), Math.sin(a) * radius);
      const b = a + 0.05 * Math.sign(speed);
      next.set(Math.cos(b) * radius, bird.group.position.y, Math.sin(b) * radius);
      bird.group.lookAt(next);
      const flap = Math.sin(t * 9 + phase) * 0.55;
      bird.right.rotation.z = flap;
      bird.left.rotation.z = -flap;
    });
  }

  const balloonColors = [0xff4d4d, 0xffc928, 0x9c4dff, 0x26c6da];
  balloonColors.forEach((color, i) => {
    const balloon = createBalloon(color);
    const a = (i / balloonColors.length) * Math.PI * 2 + 0.6;
    const d = range(50, 80);
    const y = range(14, 26);
    balloon.position.set(Math.sin(a) * d, y, Math.cos(a) * d);
    scene.add(balloon);
    const phase = range(0, 10);
    updaters.push((t) => {
      balloon.position.y = y + Math.sin(t * 0.5 + phase) * 1.2;
      balloon.rotation.y = t * 0.1 + phase;
    });
  });
}
