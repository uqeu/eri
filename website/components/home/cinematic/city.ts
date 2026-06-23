// Procedural dusk-city generator — pure data, no three/React. A long avenue the
// camera flies down, buildings on both sides, and real devices (phones, laptops,
// monitors) mounted on the faces + floating over the street — each running eri,
// so the city literally glows with screens the soul hops between. Three hero
// devices mark the beats. Deterministic (seeded) so the skyline is stable.

export type DeviceKind = "phone" | "laptop" | "monitor" | "tablet";

export interface BuildingDef {
  readonly pos: readonly [number, number, number];
  readonly scale: readonly [number, number, number];
  readonly tint: number; // 0..1 → subtle hue variance
}

export interface DeviceDef {
  readonly pos: readonly [number, number, number];
  readonly rotY: number;
  readonly kind: DeviceKind;
  readonly scale: number;
  readonly ui: number; // which eri-UI texture (0..3)
}

export interface HeroDevice {
  readonly id: "billboard" | "laptop" | "phone";
  readonly pos: readonly [number, number, number];
  readonly rotY: number;
  readonly kind: DeviceKind;
  readonly scale: number;
}

export interface CityData {
  readonly buildings: readonly BuildingDef[];
  readonly devices: readonly DeviceDef[];
  readonly heroes: readonly HeroDevice[];
  readonly depth: number;
}

// Aspect (width / height) per kind — used by the renderer to size the screen.
export const DEVICE_ASPECT: Record<DeviceKind, number> = {
  phone: 0.48,
  tablet: 0.72,
  laptop: 1.52,
  monitor: 1.62,
};

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const KINDS: DeviceKind[] = ["phone", "laptop", "monitor", "tablet"];

export function buildCity(seed = 42): CityData {
  const rng = mulberry32(seed);
  const buildings: BuildingDef[] = [];
  const devices: DeviceDef[] = [];

  const zNear = 16;
  const zFar = -150;
  const depth = zNear - zFar;
  const avenue = 6.5;

  for (let z = zNear; z > zFar; z -= 6 + rng() * 6) {
    for (const side of [-1, 1] as const) {
      let x = side * (avenue + 0.5 + rng() * 1.5);
      const count = 1 + Math.floor(rng() * 2);
      for (let i = 0; i < count; i++) {
        const w = 4.5 + rng() * 7;
        const d = 4.5 + rng() * 7;
        const h = 7 + rng() * 30 * (0.5 + (Math.abs(z) / depth) * 0.8);
        const bx = x + (w / 2) * side;
        buildings.push({ pos: [bx, h / 2, z], scale: [w, h, d], tint: rng() });

        // a device mounted on the avenue-facing wall, looking toward the centre
        if (rng() < 0.55) {
          const faceX = bx - (w / 2 + 0.12) * side;
          const kind = rng() < 0.4 ? "phone" : KINDS[Math.floor(rng() * 4)];
          devices.push({
            pos: [faceX, 2 + rng() * (h - 3), z + (rng() - 0.5) * d * 0.5],
            rotY: side === -1 ? Math.PI / 2 : -Math.PI / 2,
            kind,
            scale: 0.85 + rng() * 0.9,
            ui: Math.floor(rng() * 4),
          });
        }
        x += (w + 1.5 + rng() * 2.5) * side;
      }
    }
  }

  // devices floating over the avenue — things for the soul to hop between,
  // angled to roughly face the camera path
  for (let i = 0; i < 20; i++) {
    const z = zNear - rng() * depth;
    devices.push({
      pos: [(rng() - 0.5) * 11, 2.5 + rng() * 15, z],
      rotY: (rng() - 0.5) * 0.7,
      kind: KINDS[Math.floor(rng() * 4)],
      scale: 0.7 + rng() * 0.8,
      ui: Math.floor(rng() * 4),
    });
  }

  // hero devices the soul lands on at each beat, spaced down the avenue
  const heroes: HeroDevice[] = [
    { id: "billboard", pos: [4.6, 11, -22], rotY: -0.5, kind: "monitor", scale: 2.4 },
    { id: "laptop", pos: [-4.2, 3.6, -54], rotY: 0.55, kind: "laptop", scale: 2.1 },
    { id: "phone", pos: [3.2, 2.6, -86], rotY: -0.5, kind: "phone", scale: 2.0 },
  ];

  return { buildings, devices, heroes, depth };
}

// Flat list of device world positions (for the electricity to hop between).
export function devicePoints(data: CityData): Array<[number, number, number]> {
  return data.devices.map((d) => [d.pos[0], d.pos[1], d.pos[2]]);
}
