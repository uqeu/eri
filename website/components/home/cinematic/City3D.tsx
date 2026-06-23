"use client";

import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { CityData } from "./city";

// Dark building silhouettes with faint warm windows so they read as a lived-in
// city without competing with the devices + electricity (the real glow). The
// emissive window texture keeps them from being flat black; lights add a cool
// dusk rim. Instanced for cost.
function makeWindowTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 64;
  c.height = 128;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#05040a";
  ctx.fillRect(0, 0, c.width, c.height);
  for (let y = 6; y < c.height - 4; y += 9) {
    for (let x = 5; x < c.width - 4; x += 8) {
      const r = Math.random();
      if (r > 0.66) {
        ctx.fillStyle =
          r > 0.96 ? "rgba(217,255,87,0.8)" : "rgba(255,196,140,0.7)";
        ctx.fillRect(x, y, 3, 4);
      }
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1, 2);
  return tex;
}

export function City3D({ data }: { readonly data: CityData }): React.ReactElement {
  const ref = useRef<THREE.InstancedMesh>(null);
  const windowTex = useMemo(makeWindowTexture, []);

  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const m = new THREE.Matrix4();
    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const scl = new THREE.Vector3();
    data.buildings.forEach((b, i) => {
      pos.set(b.pos[0], b.pos[1], b.pos[2]);
      scl.set(b.scale[0], b.scale[1], b.scale[2]);
      m.compose(pos, quat, scl);
      mesh.setMatrixAt(i, m);
    });
    mesh.instanceMatrix.needsUpdate = true;
  }, [data]);

  useEffect(() => () => windowTex.dispose(), [windowTex]);

  return (
    <instancedMesh
      ref={ref}
      args={[undefined, undefined, data.buildings.length]}
      castShadow={false}
      receiveShadow={false}
    >
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial
        color="#0b0a16"
        emissive="#ffffff"
        emissiveMap={windowTex}
        emissiveIntensity={0.4}
        roughness={0.85}
        metalness={0.25}
      />
    </instancedMesh>
  );
}
