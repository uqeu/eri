"use client";

import { useMemo, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { MeshReflectorMaterial } from "@react-three/drei";
import { EffectComposer, Bloom, Vignette } from "@react-three/postprocessing";
import * as THREE from "three";
import { buildCity } from "./city";
import { City3D } from "./City3D";
import { Devices3D } from "./Devices3D";
import { Arcs3D } from "./Arcs3D";
import { Soul3D } from "./Soul3D";

const Z_START = 12;
const Z_END = -118;

// Flies the camera down the avenue following the soul that leads just ahead,
// aimed slightly low so the wet street + its reflections fill the lower frame.
// v1 loops; the directed beat timeline + resolve land next.
function Director({ soulRef }: { readonly soulRef: React.RefObject<THREE.Group> }): null {
  const { camera } = useThree();
  const p = useRef(0);

  useFrame((_, dt) => {
    p.current = (p.current + dt / 28) % 1;
    const pp = p.current;
    const t = performance.now() / 1000;

    const z = THREE.MathUtils.lerp(Z_START - 4, Z_END - 2, pp);
    const sx = Math.sin(pp * 6) * 2.4;
    const sy = 6 + Math.sin(pp * 4) * 1.6;

    const soul = soulRef.current;
    if (soul) {
      soul.position.set(sx, sy, z);
      soul.scale.setScalar(1 + 0.1 * Math.sin(t * 3.2));
    }

    camera.position.set(Math.sin(pp * 1.6) * 1.0, 6.4 + Math.sin(pp * 1.2) * 0.4, z + 13);
    camera.lookAt(sx * 0.5, sy - 1.8, z - 6);
  });

  return null;
}

export function CityScene(): React.ReactElement {
  const city = useMemo(() => buildCity(), []);
  const soulRef = useRef<THREE.Group>(null);

  return (
    <Canvas
      dpr={[1, 1.75]}
      gl={{
        antialias: true,
        alpha: false,
        powerPreference: "high-performance",
        toneMapping: THREE.ACESFilmicToneMapping,
        toneMappingExposure: 1.05,
      }}
      camera={{ fov: 56, near: 0.1, far: 280, position: [0, 7, 26] }}
    >
      <color attach="background" args={["#0b0716"]} />
      <fog attach="fog" args={["#1a0f2e", 14, 116]} />

      {/* dusk light — cool violet fill, soft magenta key, faint warm rim. The
          screens + electricity carry most of the brightness. */}
      <ambientLight intensity={0.45} color="#5566aa" />
      <directionalLight position={[12, 16, 8]} intensity={0.5} color="#ff8a72" />
      <directionalLight position={[-14, 9, -36]} intensity={0.7} color="#7a4dff" />

      <City3D data={city} />
      <Devices3D data={city} />
      <Arcs3D data={city} soulRef={soulRef} />
      <Soul3D ref={soulRef} />
      <Director soulRef={soulRef} />

      {/* wet asphalt avenue — reflects the glowing screens + soul */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, -56]}>
        <planeGeometry args={[70, 380]} />
        <MeshReflectorMaterial
          resolution={512}
          mixBlur={1.1}
          mixStrength={5}
          blur={[320, 110]}
          roughness={0.9}
          depthScale={1.1}
          minDepthThreshold={0.4}
          maxDepthThreshold={1.3}
          color="#0a0712"
          metalness={0.65}
          mirror={0}
        />
      </mesh>

      <EffectComposer multisampling={2}>
        <Bloom luminanceThreshold={0.2} luminanceSmoothing={0.85} intensity={1.0} mipmapBlur />
        <Vignette eskil={false} offset={0.28} darkness={0.9} />
      </EffectComposer>
    </Canvas>
  );
}
