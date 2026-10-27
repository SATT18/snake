// Статический батчинг: сотни неподвижных мешей мира (деревья, грибы, постройки, острова)
// сливаются в один меш на каждый материал. Один вызов отрисовки вместо десятков —
// главное, что нужно мобильным GPU.
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

const KEEP_ATTRIBUTES = new Set(["position", "normal", "uv"]);

/** Помечает объект как анимируемый: bakeStatic перенесёт его целиком, не сливая. */
export function markDynamic<T extends THREE.Object3D>(object: T): T {
  object.userData.dynamic = true;
  return object;
}

/**
 * Возвращает группу, где все обычные меши из root слиты по материалам (с учётом флагов теней),
 * а инстансы, точки и помеченные markDynamic объекты перенесены как есть с сохранением положения.
 * root после вызова больше не нужен.
 */
export function bakeStatic(root: THREE.Object3D): THREE.Group {
  root.updateMatrixWorld(true);
  const out = new THREE.Group();
  const keep: THREE.Object3D[] = [];
  const buckets = new Map<string, { material: THREE.Material; cast: boolean; receive: boolean; geometries: THREE.BufferGeometry[] }>();

  const visit = (object: THREE.Object3D) => {
    if (object !== root && (object.userData.dynamic || object instanceof THREE.InstancedMesh || object instanceof THREE.Points)) {
      keep.push(object);
      return;
    }
    if (object instanceof THREE.Mesh && !Array.isArray(object.material)) {
      const source = object.geometry as THREE.BufferGeometry;
      // Индексированные и неиндексированные геометрии нельзя слить вместе — приводим к одному виду
      const geometry = source.index ? source.toNonIndexed() : source.clone();
      for (const name of Object.keys(geometry.attributes)) {
        if (!KEEP_ATTRIBUTES.has(name)) geometry.deleteAttribute(name);
      }
      if (!geometry.attributes.uv) {
        geometry.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(geometry.attributes.position.count * 2), 2));
      }
      geometry.applyMatrix4(object.matrixWorld);

      const key = `${object.material.uuid}|${object.castShadow}|${object.receiveShadow}`;
      let bucket = buckets.get(key);
      if (!bucket) {
        bucket = { material: object.material, cast: object.castShadow, receive: object.receiveShadow, geometries: [] };
        buckets.set(key, bucket);
      }
      bucket.geometries.push(geometry);
    }
    for (const child of object.children) visit(child);
  };
  visit(root);

  for (const { material, cast, receive, geometries } of buckets.values()) {
    const merged = mergeGeometries(geometries);
    for (const g of geometries) g.dispose();
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, material);
    mesh.castShadow = cast;
    mesh.receiveShadow = receive;
    out.add(mesh);
  }
  // attach сохраняет мировое положение объекта при смене родителя
  for (const object of keep) out.attach(object);
  return out;
}
