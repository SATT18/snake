// Время суток для уровней: небо, солнце (или луна), свет и цвет воды.
import * as THREE from "three";

export type ThemeName = "day" | "afternoon" | "sunset" | "night";

export interface Theme {
  skyTop: number;
  skyHorizon: number;
  skyBottom: number;
  sunDir: THREE.Vector3;
  sunDisc: number; // цвет диска на небе
  sunSize: number; // чем больше, тем меньше диск
  halo: number; // яркость ореола вокруг диска
  sunColor: number;
  sunIntensity: number;
  hemiSky: number;
  hemiGround: number;
  hemiIntensity: number;
  envIntensity: number;
  exposure: number;
  ocean: number;
  cloud: number;
  stars: number; // непрозрачность звёзд
  glow: number; // множитель для окон и фонарей
}

const dir = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z).normalize();

export const THEMES: Record<ThemeName, Theme> = {
  day: {
    skyTop: 0x2f8cff,
    skyHorizon: 0xcdeeff,
    skyBottom: 0x7cc8ff,
    sunDir: dir(-0.5, 0.6, -0.62),
    sunDisc: 0xfff0c8,
    sunSize: 900,
    halo: 0.35,
    sunColor: 0xfff1d6,
    sunIntensity: 3.2,
    hemiSky: 0xbfe3ff,
    hemiGround: 0x5a8a3a,
    hemiIntensity: 1.1,
    envIntensity: 0.6,
    exposure: 1.05,
    ocean: 0x1c8be0,
    cloud: 0xffffff,
    stars: 0,
    glow: 1,
  },
  afternoon: {
    skyTop: 0x3a7fe0,
    skyHorizon: 0xffe4bd,
    skyBottom: 0x8fc5e8,
    sunDir: dir(0.6, 0.42, -0.68),
    sunDisc: 0xffe0a0,
    sunSize: 800,
    halo: 0.45,
    sunColor: 0xffdcaa,
    sunIntensity: 3,
    hemiSky: 0xd8e6ff,
    hemiGround: 0x6a7a3a,
    hemiIntensity: 1,
    envIntensity: 0.55,
    exposure: 1.05,
    ocean: 0x2a86c8,
    cloud: 0xfff3e0,
    stars: 0,
    glow: 1,
  },
  sunset: {
    skyTop: 0x3b4fa8,
    skyHorizon: 0xff9a5c,
    skyBottom: 0x6f6fb0,
    sunDir: dir(0.15, 0.16, -0.98),
    sunDisc: 0xffb070,
    sunSize: 500,
    halo: 0.75,
    sunColor: 0xff9a5a,
    sunIntensity: 2.6,
    hemiSky: 0xffb59a,
    hemiGround: 0x4a3a5a,
    hemiIntensity: 0.9,
    envIntensity: 0.5,
    exposure: 1,
    ocean: 0x3c5fa8,
    cloud: 0xffc6a8,
    stars: 0.15,
    glow: 1.6,
  },
  night: {
    skyTop: 0x050b24,
    skyHorizon: 0x1c2c5a,
    skyBottom: 0x0a1430,
    sunDir: dir(0.4, 0.55, -0.73), // луна
    sunDisc: 0xdfe8ff,
    sunSize: 700,
    halo: 0.12,
    sunColor: 0x9fb6ff,
    sunIntensity: 0.9,
    hemiSky: 0x3a4f8a,
    hemiGround: 0x101828,
    hemiIntensity: 0.55,
    envIntensity: 0.35,
    exposure: 1.15,
    ocean: 0x0f2a55,
    cloud: 0x4a5680,
    stars: 1,
    glow: 3,
  },
};
