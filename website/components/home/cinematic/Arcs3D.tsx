"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { CityData } from "./city";

const K = 8; // points per bolt
const SEG = K - 1;
const DD_ARCS = 14; // device ↔ device bolts
const SOUL_ARCS = 4; // bolts thrown from eri itself
const NUM = DD_ARCS + SOUL_ARCS;

interface Arc {
  ai: number; // -1 → originates at the soul
  bi: number;
  age: number;
  life: number;
  s1: number[]; // jag along perpendicular 1
  s2: number[]; // jag along perpendicular 2
}

const rand = (): number => Math.random();
const seeds = (): number[] => Array.from({ length: K }, () => rand() * 2 - 1);

function nearest(points: THREE.Vector3[], i: number, k: number): number[] {
  return points
    .map((p, j) => ({ j, d: points[i].distanceTo(p) }))
    .filter((o) => o.j !== i)
    .sort((a, b) => a.d - b.d)
    .slice(0, k)
    .map((o) => o.j);
}

function respawn(arc: Arc, i: number, n: number, neighbors: number[][]): void {
  if (i < DD_ARCS) {
    arc.ai = Math.floor(rand() * n);
    const nb = neighbors[arc.ai] ?? [];
    arc.bi = nb.length ? nb[Math.floor(rand() * nb.length)] : Math.floor(rand() * n);
  } else {
    arc.ai = -1;
    arc.bi = Math.floor(rand() * n);
  }
  arc.age = 0;
  arc.life = 0.35 + rand() * 0.9;
  arc.s1 = seeds();
  arc.s2 = seeds();
}

// eri's electricity: bolts jump between nearby screens and from the soul to the
// screens it passes. Anchored at both ends (envelope → 0 at endpoints), jagged
// in the middle, blinking in and out. Additive + bloom makes them glow.
export function Arcs3D({
  data,
  soulRef,
}: {
  readonly data: CityData;
  readonly soulRef: React.RefObject<THREE.Group>;
}): React.ReactElement {
  const points = useMemo(
    () => data.devices.map((d) => new THREE.Vector3(d.pos[0], d.pos[1], d.pos[2])),
    [data],
  );
  const neighbors = useMemo(() => points.map((_, i) => nearest(points, i, 6)), [points]);

  const pos = useMemo(() => new Float32Array(NUM * K * 3), []);
  const col = useMemo(() => new Float32Array(NUM * K * 3), []);
  const index = useMemo(() => {
    const idx: number[] = [];
    for (let i = 0; i < NUM; i++) {
      const base = i * K;
      for (let k = 0; k < SEG; k++) idx.push(base + k, base + k + 1);
    }
    return new Uint16Array(idx);
  }, []);

  const geomRef = useRef<THREE.BufferGeometry>(null);
  const arcs = useRef<Arc[]>(
    Array.from({ length: NUM }, () => ({ ai: 0, bi: 0, age: 0, life: 0, s1: [], s2: [] })),
  );
  const inited = useRef(false);

  const dir = useMemo(() => new THREE.Vector3(), []);
  const up = useMemo(() => new THREE.Vector3(0, 1, 0), []);
  const perp1 = useMemo(() => new THREE.Vector3(), []);
  const perp2 = useMemo(() => new THREE.Vector3(), []);
  const base = useMemo(() => new THREE.Vector3(), []);
  const pt = useMemo(() => new THREE.Vector3(), []);

  useFrame((state, dt) => {
    if (!inited.current) {
      arcs.current.forEach((a, i) => respawn(a, i, points.length, neighbors));
      inited.current = true;
    }
    const t = state.clock.elapsedTime;
    const soul = soulRef.current?.position ?? null;

    for (let i = 0; i < NUM; i++) {
      const arc = arcs.current[i];
      arc.age += dt;
      if (arc.age > arc.life) respawn(arc, i, points.length, neighbors);

      const a = arc.ai === -1 ? soul : points[arc.ai];
      const b = points[arc.bi];
      const env = Math.sin((Math.PI * arc.age) / arc.life);
      const flick = 0.55 + 0.45 * Math.sin(t * 26 + i * 3.1);
      const intensity = a ? Math.max(0, env) * flick : 0;

      let len = 0;
      if (a) {
        dir.copy(b).sub(a);
        len = dir.length() || 0.001;
        dir.multiplyScalar(1 / len);
        perp1.copy(dir).cross(up);
        if (perp1.lengthSq() < 1e-4) perp1.set(1, 0, 0);
        perp1.normalize();
        perp2.copy(dir).cross(perp1).normalize();
      }
      const amp = Math.min(len * 0.14, 1.6);

      for (let k = 0; k < K; k++) {
        const vi = (i * K + k) * 3;
        if (a) {
          const tt = k / (K - 1);
          const shape = Math.sin(Math.PI * tt);
          base.copy(a).addScaledVector(dir, len * tt);
          const j1 = arc.s1[k] + 0.4 * Math.sin(t * 14 + k);
          const j2 = arc.s2[k] + 0.4 * Math.cos(t * 17 + k);
          pt.copy(base)
            .addScaledVector(perp1, j1 * amp * shape)
            .addScaledVector(perp2, j2 * amp * shape);
          pos[vi] = pt.x;
          pos[vi + 1] = pt.y;
          pos[vi + 2] = pt.z;
        } else {
          pos[vi] = b.x;
          pos[vi + 1] = b.y;
          pos[vi + 2] = b.z;
        }
        col[vi] = 0.85 * intensity * 1.7;
        col[vi + 1] = 1.0 * intensity * 1.7;
        col[vi + 2] = 0.34 * intensity * 1.7;
      }
    }

    const g = geomRef.current;
    if (g) {
      (g.attributes.position as THREE.BufferAttribute).needsUpdate = true;
      (g.attributes.color as THREE.BufferAttribute).needsUpdate = true;
    }
  });

  return (
    <lineSegments frustumCulled={false}>
      <bufferGeometry ref={geomRef}>
        <bufferAttribute attach="attributes-position" args={[pos, 3]} />
        <bufferAttribute attach="attributes-color" args={[col, 3]} />
        <bufferAttribute attach="index" args={[index, 1]} />
      </bufferGeometry>
      <lineBasicMaterial
        vertexColors
        transparent
        blending={THREE.AdditiveBlending}
        depthWrite={false}
      />
    </lineSegments>
  );
}
