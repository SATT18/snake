// 3D-змейка: тело из инстансов, голова с глазами, плавная интерполяция между шагами логики.
import * as THREE from "three";
import type { Direction, Point, SnakeGame } from "./game.js";
import { wrapAngle } from "./smooth.js";
import { cellToWorld, TILE_TOP } from "./world.js";

const DIR_VEC: Record<Direction, [number, number]> = {
  up: [0, -1],
  down: [0, 1],
  left: [-1, 0],
  right: [1, 0],
};

/** Угол поворота (вокруг Y), при котором локальная +z смотрит в сторону направления. */
export const yawOf = (dir: Direction): number => Math.atan2(...DIR_VEC[dir]);

const HEAD_ALIVE = new THREE.Color(0x3fcf4a);
const DEAD = new THREE.Color(0x8a2a2a);
const WARNING = new THREE.Color(0xff5a3c);

export class SnakeView {
  readonly head = new THREE.Group();
  yaw = yawOf("right");

  private readonly body: THREE.InstancedMesh;
  private readonly headMat: THREE.MeshPhysicalMaterial;
  private readonly positions: THREE.Vector3[];
  private readonly a = new THREE.Vector3();
  private readonly b = new THREE.Vector3();
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly s = new THREE.Vector3();
  private readonly c1 = new THREE.Color();
  private readonly c2 = new THREE.Color();

  constructor(scene: THREE.Scene, private readonly cols: number, private readonly rows: number) {
    const segGeo = new THREE.SphereGeometry(0.5, 24, 16);
    // На каждую клетку — шар в клетке и шар между соседними клетками, чтобы тело было сплошным
    this.body = new THREE.InstancedMesh(
      segGeo,
      new THREE.MeshPhysicalMaterial({ roughness: 0.35, clearcoat: 0.8, clearcoatRoughness: 0.2 }),
      cols * rows * 2,
    );
    this.body.castShadow = true;
    this.body.receiveShadow = true;
    this.body.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    // boundingSphere у InstancedMesh считается один раз и не следует за инстансами —
    // без этого тело отсекается камерой, когда змейка уползает от стартовой точки
    this.body.frustumCulled = false;
    this.body.setColorAt(0, new THREE.Color()); // создаёт instanceColor до компиляции шейдера
    scene.add(this.body);

    this.headMat = new THREE.MeshPhysicalMaterial({ color: HEAD_ALIVE, roughness: 0.3, clearcoat: 0.8, clearcoatRoughness: 0.15 });
    const headMesh = new THREE.Mesh(segGeo, this.headMat);
    headMesh.scale.set(1, 0.82, 1.08);
    headMesh.castShadow = true;
    this.head.add(headMesh);
    this.addEyes();
    scene.add(this.head);

    this.positions = Array.from({ length: cols * rows }, () => new THREE.Vector3());
  }

  /** Большие мультяшные глаза с бликом. */
  private addEyes(): void {
    const eyeGeo = new THREE.SphereGeometry(1, 16, 12);
    const white = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.15 });
    const pupil = new THREE.MeshStandardMaterial({ color: 0x0b1020, roughness: 0.05 });
    const glint = new THREE.MeshBasicMaterial({ color: 0xffffff });
    for (const side of [-1, 1]) {
      const parts: [THREE.Material, number, number, number, number][] = [
        [white, 0.17, 0.2, 0.27, 0.22],
        [pupil, 0.09, 0.21, 0.32, 0.35],
        [glint, 0.03, 0.18, 0.38, 0.42],
      ];
      for (const [mat, r, x, y, z] of parts) {
        const eye = new THREE.Mesh(eyeGeo, mat);
        eye.scale.setScalar(r);
        eye.position.set(side * x, y, z);
        eye.castShadow = mat === white;
        this.head.add(eye);
      }
    }
  }

  get headPosition(): THREE.Vector3 {
    return this.head.position;
  }

  /** Положение головы на поле без покачивания — для камеры. */
  get headCell(): THREE.Vector3 {
    return this.positions[0];
  }

  setVisible(visible: boolean): void {
    this.body.visible = this.head.visible = visible;
  }

  reset(): void {
    this.yaw = yawOf("right");
  }

  /**
   * prev — позиции до последнего шага логики, alpha — доля пройденного шага (0..1).
   * deathTint плавно перекрашивает змейку при проигрыше.
   */
  update(game: SnakeGame, prev: Point[], alpha: number, dt: number, time: number, deathTint: number): void {
    const snake = game.snake;
    const n = snake.length;
    const { a, b, positions } = this;

    for (let i = 0; i < n; i++) {
      const from = prev[i] ?? snake[i];
      cellToWorld(from.x, from.y, this.cols, this.rows, a);
      cellToWorld(snake[i].x, snake[i].y, this.cols, this.rows, b);
      positions[i].lerpVectors(a, b, alpha);
    }

    const span = Math.max(1, n - 1);
    let count = 0;
    for (let i = 0; i < n; i++) {
      if (i > 0) this.placeSegment(count++, positions[i], i, span, deathTint);
      if (i < n - 1) this.placeSegment(count++, b.lerpVectors(positions[i], positions[i + 1], 0.5), i + 0.5, span, deathTint);
    }
    this.body.count = count;
    this.body.instanceMatrix.needsUpdate = true;
    this.body.instanceColor!.needsUpdate = true;

    // Голова: поворачиваем по фактическому направлению движения, плавно
    const bob = game.status === "running" ? Math.abs(Math.sin(time * 10)) * 0.05 : 0;
    this.head.position.copy(positions[0]).setY(TILE_TOP + 0.41 + bob);
    let dx = snake[0].x - (prev[0]?.x ?? snake[0].x);
    let dz = snake[0].y - (prev[0]?.y ?? snake[0].y);
    if (dx === 0 && dz === 0) [dx, dz] = DIR_VEC[game.direction];
    this.yaw += wrapAngle(Math.atan2(dx, dz) - this.yaw) * (1 - Math.exp(-dt * 18));
    this.head.rotation.y = this.yaw;

    this.headMat.color.copy(HEAD_ALIVE).lerp(DEAD, deathTint * 0.8);
    // Пощада у стены: голова мигает — пора поворачивать
    if (game.stalled && game.status === "running") this.headMat.color.lerp(WARNING, 0.5 + 0.5 * Math.sin(time * 30));
  }

  private placeSegment(index: number, pos: THREE.Vector3, f: number, span: number, deathTint: number): void {
    const t = f / span;
    const scale = 0.88 - 0.28 * t;
    this.s.set(scale, scale * 0.85, scale);
    this.a.copy(pos).setY(TILE_TOP + 0.5 * scale * 0.85);
    this.body.setMatrixAt(index, this.m.compose(this.a, this.q, this.s));

    // Мягкие полосы: зелёный ↔ салатовый, к хвосту чуть темнее
    const stripe = 0.5 + 0.5 * Math.cos(f * Math.PI * 0.7);
    this.c1.setHSL(0.33, 0.7, 0.42 - 0.1 * t);
    this.c2.setHSL(0.22, 0.85, 0.55 - 0.1 * t);
    this.body.setColorAt(index, this.c1.lerp(this.c2, stripe * 0.55).lerp(DEAD, deathTint * 0.8));
  }
}
