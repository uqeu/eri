"use client";

import { Suspense } from "react";
import { Canvas } from "@react-three/fiber";
import { Environment, Float, MeshDistortMaterial } from "@react-three/drei";
import apartment from "@pmndrs/assets/hdri/apartment.exr";

// A single transparent iridescent soap bubble — the same material as the hero
// field (no room backdrop, so it stays see-through over white), tinted a soft
// blue. Used as a small, cute accent (e.g. the eri core in the sync visual).
export function MiniBubble({
  className,
  tint = "#bcd8ff",
}: {
  readonly className?: string;
  readonly tint?: string;
}): React.ReactElement {
  return (
    <Canvas
      className={className}
      dpr={[1, 1.5]}
      gl={{ alpha: true, antialias: true }}
      camera={{ fov: 50, position: [0, 0, 4] }}
    >
      <Suspense fallback={null}>
        <Float speed={1.2} floatIntensity={1.6} rotationIntensity={0.5}>
          <mesh>
            <sphereGeometry args={[1, 48, 48]} />
            <MeshDistortMaterial
              distort={0.28}
              speed={1.2}
              transmission={1.05}
              thickness={-0.5}
              roughness={0}
              iridescence={1}
              iridescenceIOR={1.06}
              iridescenceThicknessRange={[0, 800]}
              clearcoat={1}
              clearcoatRoughness={0}
              envMapIntensity={1.05}
              color={tint}
              attenuationColor={tint}
              attenuationDistance={2.2}
            />
          </mesh>
        </Float>
        <Environment files={apartment} />
      </Suspense>
    </Canvas>
  );
}
