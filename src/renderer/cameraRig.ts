// Камера построена по правилам против укачивания:
// - никаких поворотов, которых игрок не просил: в классическом режиме угол обзора неизменен;
// - движение через критически демпфированную пружину — разгон и торможение без рывков;
// - мёртвая зона: классическая камера не дёргается за каждым шагом змейки;
// - в режиме «за спиной» камера вращается вокруг головы по дуге, начинает доворачивать сразу
//   по нажатию (предсказуемо для игрока) и смотрит круто вниз — так вращение воспринимается
//   как поворот карты, а не всего мира, и в кадр попадает всё поле впереди и по бокам.
import * as THREE from "three";
import { smoothDamp, smoothDampVec, wrapAngle } from "./smooth.js";

export type RigMode = "orbit" | "classic" | "chase";

const CLASSIC_OFFSET = new THREE.Vector3(0, 15, 10.5);
const CLASSIC_FOLLOW = 0.7; // 0 — камера над центром поля, 1 — над головой
const DEAD_ZONE = 1.5;
const CHASE_BACK = 6.5; // насколько камера позади головы
const CHASE_UP = 12; // высота: наклон ~50°, поле впереди видно до самой изгороди
const CHASE_LOOK_AHEAD = 3.5; // голова в нижней трети кадра, больше места впереди
const CHASE_YAW_TIME = 0.16; // сглаживание поворота: 90° укладываются примерно в 0,45 с
const CHASE_MAX_YAW_SPEED = 5; // рад/с — потолок на случай разворота на 180°
const CHASE_FOLLOW_TIME = 0.08; // фокус почти без задержки идёт за головой
const ORBIT_RADIUS = 30;
const ORBIT_SPEED = 0.05;

export class CameraRig {
  private readonly pos = new THREE.Vector3(30, 14, 30);
  private readonly look = new THREE.Vector3();
  private readonly posVel = new THREE.Vector3();
  private readonly lookVel = new THREE.Vector3();
  private readonly focus = new THREE.Vector3();
  private readonly focusVel = new THREE.Vector3();
  private readonly goal = new THREE.Vector3();
  private readonly lookGoal = new THREE.Vector3();
  private readonly fwd = new THREE.Vector3();
  private readonly tmp = new THREE.Vector3();
  private readonly yawVel = { v: 0 };
  private yaw = 0;
  private transition = 1; // 1 → 0 за секунду после старта уровня: плавный въезд камеры
  private shakeAmount = 0;
  shakeEnabled = true;

  constructor(private readonly camera: THREE.PerspectiveCamera) {}

  /** Старт уровня: камера сразу смотрит по курсу змейки и плавно въезжает на место. */
  reset(mode: RigMode, head: THREE.Vector3, yaw: number): void {
    this.yaw = yaw;
    this.yawVel.v = 0;
    this.focusVel.set(0, 0, 0);
    this.focus.copy(head).setY(0);
    if (mode === "classic") this.focus.multiplyScalar(CLASSIC_FOLLOW);
    this.transition = 1;
  }

  shake(amount: number): void {
    if (this.shakeEnabled) this.shakeAmount = amount;
  }

  update(dt: number, mode: RigMode, head: THREE.Vector3, targetYaw: number, time: number): void {
    this.transition = Math.max(0, this.transition - dt);
    // В портретной ориентации поднимаем камеру выше: поле узкое, а смотреть нужно вперёд
    const portrait = this.camera.aspect < 1 ? 1.25 : 1;
    let smoothTime: number;

    if (mode === "classic") {
      // Фокус догоняет голову, только когда она выходит из мёртвой зоны
      this.tmp.copy(head).multiplyScalar(CLASSIC_FOLLOW).setY(0);
      const d = this.tmp.distanceTo(this.focus);
      if (d > DEAD_ZONE) this.focus.lerp(this.tmp, (d - DEAD_ZONE) / d);
      this.goal.copy(CLASSIC_OFFSET).multiplyScalar(portrait).add(this.focus);
      this.lookGoal.copy(this.focus);
      smoothTime = 0.5;
    } else if (mode === "chase") {
      this.yaw = smoothDamp(this.yaw, this.yaw + wrapAngle(targetYaw - this.yaw), this.yawVel, CHASE_YAW_TIME, dt, CHASE_MAX_YAW_SPEED);
      // Позицию считаем из сглаженных курса и фокуса, а не сглаживаем в мире:
      // при повороте камера идёт по дуге вокруг головы и не «срезает угол»
      this.tmp.copy(head).setY(0);
      smoothDampVec(this.focus, this.tmp, this.focusVel, CHASE_FOLLOW_TIME, dt);
      this.fwd.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
      this.goal.copy(this.focus).addScaledVector(this.fwd, -CHASE_BACK * portrait).setY(CHASE_UP * portrait);
      this.lookGoal.copy(this.focus).addScaledVector(this.fwd, CHASE_LOOK_AHEAD);
      // Плавный въезд из меню, дальше — почти жёсткая привязка
      smoothTime = Math.max(0.02, this.transition * 0.5);
    } else {
      // Меню и титры: медленный облёт острова
      const a = time * ORBIT_SPEED;
      const r = ORBIT_RADIUS * portrait;
      this.goal.set(Math.sin(a) * r, 14 * portrait, Math.cos(a) * r);
      this.lookGoal.set(0, -1, 0);
      smoothTime = 1.2;
    }

    smoothDampVec(this.pos, this.goal, this.posVel, smoothTime, dt);
    smoothDampVec(this.look, this.lookGoal, this.lookVel, smoothTime, dt);

    this.shakeAmount *= Math.exp(-dt * 8);
    const s = this.shakeAmount;
    this.camera.position.copy(this.pos).add(this.tmp.set((Math.random() - 0.5) * s, (Math.random() - 0.5) * s, 0));
    this.camera.lookAt(this.look);
  }
}
