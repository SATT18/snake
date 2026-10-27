// Монета: вращается, светится, над ней световой столб, а над головой змейки — стрелка к ней.
import * as THREE from "three";
import type { SnakeGame } from "./game.js";
import type { Particles } from "./particles.js";
import { cellToWorld, TILE_TOP } from "./world.js";

export class CoinView {
  private readonly coin = new THREE.Group();
  private readonly light = new THREE.PointLight(0xffc040, 3, 4, 2);
  private readonly beam: THREE.Mesh;
  private readonly arrow: THREE.Mesh;
  private readonly dir = new THREE.Vector3();
  private foodKey = "";
  private appear = 1;
  private sparkleTimer = 0;

  constructor(scene: THREE.Scene, private readonly cols: number, private readonly rows: number) {
    const gold = new THREE.MeshStandardMaterial({
      color: 0xffc928,
      metalness: 0.6,
      roughness: 0.25,
      emissive: 0xffa000,
      emissiveIntensity: 0.7,
    });
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.1, 32), gold);
    disc.rotation.x = Math.PI / 2;
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.36, 0.05, 10, 32), gold);
    this.coin.add(disc, rim);
    this.coin.traverse((o) => (o.castShadow = true));

    // Световой столб — монету видно издалека, даже если она за спиной
    this.beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.22, 0.32, 10, 16, 1, true),
      new THREE.MeshBasicMaterial({
        color: 0xffd84d,
        alphaMap: fadeTexture(),
        transparent: true,
        opacity: 0.6,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );

    const arrowGeo = new THREE.ConeGeometry(0.16, 0.42, 12);
    arrowGeo.rotateX(Math.PI / 2); // остриё вдоль +z
    this.arrow = new THREE.Mesh(arrowGeo, gold);
    this.arrow.castShadow = true;

    scene.add(this.coin, this.light, this.beam, this.arrow);
  }

  setVisible(visible: boolean): void {
    this.coin.visible = this.light.visible = this.beam.visible = this.arrow.visible = visible;
  }

  update(game: SnakeGame, head: THREE.Vector3, dt: number, time: number, particles: Particles): void {
    const active = game.status !== "won";
    this.coin.visible = this.light.visible = this.beam.visible = active;
    if (active) this.updateCoin(game, dt, time, particles);
    this.updateArrow(game, head, time);
  }

  private updateCoin(game: SnakeGame, dt: number, time: number, particles: Particles): void {
    const key = `${game.food.x},${game.food.y}`;
    if (key !== this.foodKey) {
      this.foodKey = key;
      this.appear = 0;
    }
    this.appear = Math.min(1, this.appear + dt / 0.35);

    // easeOutBack — монета «выпрыгивает» с небольшим перелётом
    const c = 1.70158;
    const t = this.appear - 1;
    const s = 1 + (c + 1) * t * t * t + c * t * t;

    const pos = this.coin.position;
    cellToWorld(game.food.x, game.food.y, this.cols, this.rows, pos).setY(TILE_TOP + 0.55 + Math.sin(time * 3) * 0.1);
    this.coin.scale.setScalar(Math.max(0.001, s));
    this.coin.rotation.y += dt * 3;
    this.light.position.copy(pos).setY(TILE_TOP + 1);
    this.light.intensity = (2.5 + Math.sin(time * 4) * 0.6) * this.appear;
    this.beam.position.set(pos.x, TILE_TOP + 5, pos.z);
    this.beam.scale.set(1, this.appear, 1);

    // Редкие искорки вокруг монеты
    this.sparkleTimer -= dt;
    if (this.sparkleTimer <= 0 && this.appear === 1) {
      this.sparkleTimer = 0.18;
      const a = Math.random() * Math.PI * 2;
      particles.spawn({
        pos: pos.clone().add(new THREE.Vector3(Math.cos(a) * 0.45, (Math.random() - 0.5) * 0.5, Math.sin(a) * 0.45)),
        vel: new THREE.Vector3(0, 0.6, 0),
        life: 0.6,
        gravity: 0,
        size: 0.6,
      });
    }
  }

  private updateArrow(game: SnakeGame, head: THREE.Vector3, time: number): void {
    const dir = this.dir.copy(this.coin.position).sub(head).setY(0);
    const dist = dir.length();
    this.arrow.visible = dist > 2.5 && game.status !== "over" && game.status !== "won";
    if (!this.arrow.visible) return;
    dir.divideScalar(dist);
    this.arrow.position.copy(head).addScaledVector(dir, 0.9).setY(head.y + 0.95 + Math.sin(time * 5) * 0.06);
    this.arrow.rotation.y = Math.atan2(dir.x, dir.z);
  }
}

/** Вертикальный градиент прозрачности для светового столба: плотный внизу, тает к верху. */
function fadeTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 64;
  const ctx = canvas.getContext("2d")!;
  const grad = ctx.createLinearGradient(0, 0, 0, 64);
  grad.addColorStop(0, "#000");
  grad.addColorStop(1, "#fff");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 1, 64);
  return new THREE.CanvasTexture(canvas);
}
