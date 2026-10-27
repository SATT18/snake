// Рендерер, постобработка, свет и время суток. Качество переключается на лету.
import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { GTAOPass } from "three/addons/postprocessing/GTAOPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { PRESETS, QualityLevel, QualityPreset } from "./quality.js";
import { THEMES, ThemeName } from "./themes.js";
import { createSky, createWorld, World } from "./world.js";

const BASE_FOV = 50;
const MIN_HORIZONTAL_FOV = 62; // в портретной ориентации не даём обзору сузиться
const MAX_FOV = 90;

export class Graphics {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(BASE_FOV, 1, 0.1, 1000);
  readonly world: World;

  private readonly hemi = new THREE.HemisphereLight();
  private readonly sun = new THREE.DirectionalLight();
  private readonly pmrem: THREE.PMREMGenerator;
  private readonly envScene = new THREE.Scene();
  private envTarget: THREE.WebGLRenderTarget | null = null;
  private composer: EffectComposer | null = null;
  private theme: ThemeName | null = null;
  private preset: QualityPreset = PRESETS.high;
  level: QualityLevel = "high";

  constructor(canvas: HTMLCanvasElement, cols: number, rows: number) {
    // antialias работает, когда рисуем сразу на экран (низкое качество, без постобработки)
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    // Neutral сохраняет насыщенность цветов — для яркого мультяшного стиля лучше ACES
    this.renderer.toneMapping = THREE.NeutralToneMapping;

    this.world = createWorld(this.scene, cols, rows);

    // Карта окружения из того же неба: глянцевые поверхности отражают небо текущей темы
    this.pmrem = new THREE.PMREMGenerator(this.renderer);
    this.envScene.add(createSky());

    this.scene.add(this.hemi);
    this.sun.castShadow = true;
    Object.assign(this.sun.shadow.camera, { left: -30, right: 30, top: 30, bottom: -30, near: 1, far: 120 });
    this.sun.shadow.bias = -0.0003;
    this.sun.shadow.normalBias = 0.03;
    this.scene.add(this.sun);

    window.addEventListener("resize", () => this.resize());
  }

  get maxFps(): number {
    return this.preset.maxFps;
  }

  setQuality(level: QualityLevel): void {
    this.level = level;
    this.preset = PRESETS[level];
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.preset.pixelRatio));

    const size = this.preset.shadowMapSize;
    if (this.sun.shadow.mapSize.x !== size) {
      this.sun.shadow.mapSize.set(size, size);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
    }
    this.world.setDetail(this.preset.grassDensity);
    this.buildComposer();
    this.resize();
  }

  /** Постобработка только там, где она по карману: на слабых устройствах рисуем напрямую. */
  private buildComposer(): void {
    this.composer?.dispose();
    this.composer = null;
    if (!this.preset.postprocessing) return;

    // HDR-буфер: bloom работает по яркостям > 1
    const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: this.preset.msaa });
    const composer = new EffectComposer(this.renderer, target);
    composer.addPass(new RenderPass(this.scene, this.camera));
    if (this.preset.ao) {
      const ao = new GTAOPass(this.scene, this.camera, 1, 1);
      ao.updateGtaoMaterial({ radius: 0.6, thickness: 1, scale: 1.1 });
      composer.addPass(ao);
    }
    composer.addPass(new UnrealBloomPass(new THREE.Vector2(1, 1), 0.35, 0.4, 1.0));
    composer.addPass(new OutputPass());
    this.composer = composer;
  }

  resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const aspect = w / h;
    this.renderer.setSize(w, h, false);
    if (this.composer) {
      this.composer.setPixelRatio(this.renderer.getPixelRatio());
      this.composer.setSize(w, h);
    }
    // Вертикальный угол подбираем так, чтобы по горизонтали было видно не меньше MIN_HORIZONTAL_FOV
    const toRad = Math.PI / 180;
    const fovForWidth = (2 * Math.atan(Math.tan((MIN_HORIZONTAL_FOV * toRad) / 2) / aspect)) / toRad;
    this.camera.fov = Math.min(MAX_FOV, Math.max(BASE_FOV, fovForWidth));
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  applyTheme(name: ThemeName): void {
    if (name === this.theme) return;
    this.theme = name;
    const t = THEMES[name];
    this.world.setTheme(t);
    this.hemi.color.set(t.hemiSky);
    this.hemi.groundColor.set(t.hemiGround);
    this.hemi.intensity = t.hemiIntensity;
    this.sun.color.set(t.sunColor);
    this.sun.intensity = t.sunIntensity;
    this.sun.position.copy(t.sunDir).multiplyScalar(50); // совпадает с солнцем (луной) на небе
    this.renderer.toneMappingExposure = t.exposure;

    this.envTarget?.dispose();
    this.envTarget = this.pmrem.fromScene(this.envScene, 0, 0.1, 1000);
    this.scene.environment = this.envTarget.texture;
    this.scene.environmentIntensity = t.envIntensity;
  }

  render(): void {
    if (this.composer) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }
}
