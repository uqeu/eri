"use client";

import { Suspense, useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Environment, Float, MeshDistortMaterial } from "@react-three/drei";
import apartment from "@pmndrs/assets/hdri/apartment.exr";
import type { Group } from "three";

// A field of real iridescent soap bubbles (the reference MeshDistortMaterial:
// transmissive, thin-film-iridescent glass lit by a blurred apartment HDRI).
// Kept barely-there on purpose — clear glass you only catch as light bends.
//
// The scroll does the work: each bubble drifts at its OWN speed (`par`) as you
// move through the pinned section, so they separate with depth — the waabi
// parallax, made of light. `progressRef` carries 0..1 so the drift never
// re-renders React; reduced-motion / no-WebGL gets a calm static field.

interface Spec {
  readonly pos: readonly [number, number, number];
  readonly scale: number;
  readonly distort: number;
  readonly speed: number; // idle float speed
  readonly floatI: number; // idle float amplitude
  readonly par: number; // parallax drift factor — the depth speed
  readonly parX: number; // a little horizontal drift
  readonly thickness: number; // iridescence thickness max → different soap hues
  readonly tint: string;
}

// Spread to the edges so the centre column (headline + demo) stays clear.
const SPECS: readonly Spec[] = [
  { pos: [-4.7, 1.2, 0.0], scale: 1.45, distort: 0.28, speed: 0.5, floatI: 1.6, par: 0.95, parX: 0.5, thickness: 1400, tint: "#cdeef4" },
  { pos: [4.5, -1.4, -0.6], scale: 1.55, distort: 0.22, speed: 0.45, floatI: 1.5, par: 0.4, parX: -0.4, thickness: 900, tint: "#ddd2ff" },
  { pos: [-3.7, -2.0, 0.5], scale: 0.85, distort: 0.3, speed: 0.7, floatI: 2.0, par: 1.15, parX: 0.2, thickness: 1200, tint: "#eef8c6" },
  { pos: [4.0, 1.9, 0.2], scale: 1.0, distort: 0.26, speed: 0.6, floatI: 1.8, par: 0.7, parX: 0.3, thickness: 600, tint: "#ffe7c6" },
  { pos: [-5.1, -0.6, -0.9], scale: 0.65, distort: 0.32, speed: 0.8, floatI: 2.2, par: 1.3, parX: -0.3, thickness: 1600, tint: "#ddd2ff" },
  { pos: [3.2, 0.4, 1.0], scale: 0.6, distort: 0.3, speed: 0.75, floatI: 2.1, par: 0.55, parX: 0.5, thickness: 1000, tint: "#cdeef4" },
  { pos: [0.4, 2.6, -1.3], scale: 1.05, distort: 0.24, speed: 0.55, floatI: 1.7, par: 1.05, parX: -0.2, thickness: 800, tint: "#eef8c6" },
  { pos: [-0.6, -2.8, -0.4], scale: 0.8, distort: 0.28, speed: 0.65, floatI: 1.9, par: 0.5, parX: 0.3, thickness: 1300, tint: "#ffe7c6" },
];

function Bubble({
  spec,
  reduced,
  groupRef,
}: {
  readonly spec: Spec;
  readonly reduced: boolean;
  readonly groupRef: (g: Group | null) => void;
}): React.ReactElement {
  return (
    <group ref={groupRef}>
      <Float
        speed={reduced ? 0 : spec.speed}
        floatIntensity={reduced ? 0 : spec.floatI}
        rotationIntensity={reduced ? 0 : 0.5}
      >
        <mesh position={spec.pos as [number, number, number]} scale={spec.scale}>
          <sphereGeometry args={[1, 48, 48]} />
          <MeshDistortMaterial
            distort={spec.distort}
            speed={reduced ? 0 : 1.2}
            transmission={1.05}
            thickness={-0.5}
            roughness={0}
            iridescence={1}
            iridescenceIOR={1.05}
            iridescenceThicknessRange={[0, spec.thickness]}
            clearcoat={1}
            clearcoatRoughness={0}
            envMapIntensity={1.45}
            color={spec.tint}
            attenuationColor={spec.tint}
            attenuationDistance={1.6}
          />
        </mesh>
      </Float>
    </group>
  );
}

function Field({
  progressRef,
  reduced,
}: {
  readonly progressRef: React.MutableRefObject<number>;
  readonly reduced: boolean;
}): React.ReactElement {
  const groups = useRef<(Group | null)[]>([]);
  useFrame(() => {
    if (reduced) return;
    const p = progressRef.current - 0.5; // -0.5..0.5 across the section
    for (let i = 0; i < SPECS.length; i++) {
      const g = groups.current[i];
      if (!g) continue;
      // each bubble drifts up at its own speed → depth parallax
      g.position.y = p * SPECS[i].par * 6.5;
      g.position.x = p * SPECS[i].parX;
    }
  });
  return (
    <>
      {SPECS.map((s, i) => (
        <Bubble
          key={i}
          spec={s}
          reduced={reduced}
          groupRef={(g) => { groups.current[i] = g; }}
        />
      ))}
    </>
  );
}

export function BubbleField({
  progressRef,
  reduced = false,
}: {
  readonly progressRef: React.MutableRefObject<number>;
  readonly reduced?: boolean;
}): React.ReactElement {
  return (
    <Canvas
      className="tf-canvas"
      dpr={[1, 1.5]}
      gl={{ antialias: true, alpha: true }}
      camera={{ fov: 50, position: [0, 0, 9] }}
      frameloop={reduced ? "demand" : "always"}
      performance={{ min: 0.4 }}
    >
      <Suspense fallback={null}>
        <Field progressRef={progressRef} reduced={reduced} />
        <Environment files={apartment} blur={0.85} />
      </Suspense>
    </Canvas>
  );
}
