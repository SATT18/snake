// Плавные переходы для камеры.
import type * as THREE from "three";

/**
 * Критически демпфированная пружина (как SmoothDamp в Unity): плавно разгоняется и тормозит,
 * не перелетает цель. velocity хранит скорость между кадрами.
 */
export function smoothDamp(
  current: number,
  target: number,
  velocity: { v: number },
  smoothTime: number,
  dt: number,
  maxSpeed = Infinity,
): number {
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

const axisVelocity = { v: 0 };

export function smoothDampVec(
  current: THREE.Vector3,
  target: THREE.Vector3,
  velocity: THREE.Vector3,
  smoothTime: number,
  dt: number,
): void {
  for (const axis of ["x", "y", "z"] as const) {
    axisVelocity.v = velocity[axis];
    current[axis] = smoothDamp(current[axis], target[axis], axisVelocity, smoothTime, dt);
    velocity[axis] = axisVelocity.v;
  }
}

/** Угол в диапазоне (-π, π]. */
export function wrapAngle(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}
