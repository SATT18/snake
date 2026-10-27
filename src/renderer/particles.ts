// Искры: от монеты, при её поедании и салют при победе. Один InstancedMesh на все частицы.
import * as THREE from "three";
import { TILE_TOP } from "./world.js";

interface Particle {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  life: number;
  maxLife: number;
  gravity: number;
  size: number;
}

export type ParticleSpec = Omit<Particle, "maxLife">;

const FLOOR = TILE_TOP + 0.08;

export class Particles {
  private readonly items: Particle[] = [];
  private readonly mesh: THREE.InstancedMesh;
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly s = new THREE.Vector3();

  constructor(scene: THREE.Scene, private readonly max = 260) {
    this.mesh = new THREE.InstancedMesh(
      new THREE.OctahedronGeometry(0.09),
      new THREE.MeshStandardMaterial({ color: 0xffe066, emissive: 0xffb300, emissiveIntensity: 3 }),
      max,
    );
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    // boundingSphere у InstancedMesh считается один раз и не следует за инстансами
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    scene.add(this.mesh);
  }

  spawn(p: ParticleSpec): void {
    if (this.items.length < this.max) this.items.push({ ...p, maxLife: p.life });
  }

  /** Брызги во все стороны — монета съедена. */
  burst(origin: THREE.Vector3): void {
    for (let i = 0; i < 30; i++) {
      const a = Math.random() * Math.PI * 2;
      const speed = 2 + Math.random() * 3;
      this.spawn({
        pos: origin.clone(),
        vel: new THREE.Vector3(Math.cos(a) * speed, 4 + Math.random() * 4, Math.sin(a) * speed),
        life: 0.6 + Math.random() * 0.4,
        gravity: 14,
        size: 1,
      });
    }
  }

  /** Фонтан искр вверх — уровень пройден. */
  fountain(origin: THREE.Vector3): void {
    for (let i = 0; i < 90; i++) {
      const a = Math.random() * Math.PI * 2;
      const speed = 1 + Math.random() * 2.5;
      this.spawn({
        pos: origin.clone(),
        vel: new THREE.Vector3(Math.cos(a) * speed, 7 + Math.random() * 5, Math.sin(a) * speed),
        life: 1.2 + Math.random() * 0.8,
        gravity: 10,
        size: 1.3,
      });
    }
  }

  clear(): void {
    this.items.length = 0;
  }

  update(dt: number, time: number): void {
    const items = this.items;
    for (let i = items.length - 1; i >= 0; i--) {
      const p = items[i];
      p.life -= dt;
      if (p.life <= 0) {
        items.splice(i, 1);
        continue;
      }
      p.vel.y -= p.gravity * dt;
      p.pos.addScaledVector(p.vel, dt);
      if (p.pos.y < FLOOR) {
        p.pos.y = FLOOR;
        p.vel.y *= -0.4;
        p.vel.x *= 0.7;
        p.vel.z *= 0.7;
      }
    }
    for (let i = 0; i < items.length; i++) {
      const p = items[i];
      this.s.setScalar(p.size * (p.life / p.maxLife));
      this.q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, time * 6 + i);
      this.mesh.setMatrixAt(i, this.m.compose(p.pos, this.q, this.s));
    }
    this.mesh.count = items.length;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
