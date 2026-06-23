"use client";

import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { DEVICE_ASPECT, type CityData, type DeviceDef } from "./city";
import { makeEriUITextures } from "./eriScreens";

const BASE_H = 1.5; // a unit device is ~1.5 tall before its per-device scale

function deviceSize(d: DeviceDef): { w: number; h: number } {
  const h = BASE_H * d.scale;
  return { w: h * DEVICE_ASPECT[d.kind], h };
}

// One device: a dark bezel slab with a glowing eri screen on the front. Cheap —
// shared geometry + a handful of shared materials, scaled per instance.
function Device({
  def,
  boxGeo,
  planeGeo,
  bezelMat,
  faceMats,
}: {
  readonly def: DeviceDef;
  readonly boxGeo: THREE.BoxGeometry;
  readonly planeGeo: THREE.PlaneGeometry;
  readonly bezelMat: THREE.Material;
  readonly faceMats: readonly THREE.Material[];
}): React.ReactElement {
  const { w, h } = deviceSize(def);
  const depth = 0.16 * def.scale;
  return (
    <group position={def.pos as [number, number, number]} rotation={[0, def.rotY, 0]}>
      <mesh geometry={boxGeo} material={bezelMat} scale={[w + 0.12, h + 0.12, depth]} />
      <mesh
        geometry={planeGeo}
        material={faceMats[def.ui % faceMats.length]}
        scale={[w, h, 1]}
        position={[0, 0, depth / 2 + 0.011]}
      />
    </group>
  );
}

export function Devices3D({ data }: { readonly data: CityData }): React.ReactElement {
  const textures = useMemo(makeEriUITextures, []);
  const boxGeo = useMemo(() => new THREE.BoxGeometry(1, 1, 1), []);
  const planeGeo = useMemo(() => new THREE.PlaneGeometry(1, 1), []);
  const bezelMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: "#070709",
        roughness: 0.45,
        metalness: 0.5,
      }),
    [],
  );
  const faceMats = useMemo(
    () =>
      textures.map(
        (t) =>
          new THREE.MeshBasicMaterial({
            map: t,
            toneMapped: false,
            side: THREE.FrontSide,
          }),
      ),
    [textures],
  );

  // dispose GPU resources on unmount
  useEffect(() => {
    return () => {
      boxGeo.dispose();
      planeGeo.dispose();
      bezelMat.dispose();
      faceMats.forEach((m) => m.dispose());
      textures.forEach((t) => t.dispose());
    };
  }, [boxGeo, planeGeo, bezelMat, faceMats, textures]);

  return (
    <group>
      {data.devices.map((def, i) => (
        <Device
          key={i}
          def={def}
          boxGeo={boxGeo}
          planeGeo={planeGeo}
          bezelMat={bezelMat}
          faceMats={faceMats}
        />
      ))}
    </group>
  );
}
