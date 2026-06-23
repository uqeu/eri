"use client";

import { Canvas } from "@react-three/fiber";
import { Environment, Shadow, OrbitControls, MeshDistortMaterial, Float } from "@react-three/drei";
import apartment from "@pmndrs/assets/hdri/apartment.exr";

// eri's soul — an iridescent soap bubble. Faithful to the reference sandbox: a
// distorted, transmissive, thin-film-iridescent sphere lit by a blurred
// apartment HDRI rendered AS the backdrop (that backdrop is what the glass
// refracts — without it the bubble is invisible). The canvas is radial-masked so
// the environment melts into the page instead of sitting in a hard box. WebGL —
// the canvas SoulOrb is the no-WebGL/reduced-motion fallback.

function Bubble(): React.ReactElement {
  return (
    <mesh>
      <sphereGeometry args={[1, 64, 64]} />
      <MeshDistortMaterial
        distort={0.25}
        speed={1.4}
        transmission={1.05}
        thickness={-0.5}
        roughness={0}
        iridescence={1}
        iridescenceIOR={1}
        iridescenceThicknessRange={[0, 1200]}
        clearcoat={1}
        clearcoatRoughness={0}
        envMapIntensity={1.5}
      />
    </mesh>
  );
}

export function BubbleSoul({ className }: { readonly className?: string }): React.ReactElement {
  return (
    <div
      className={className}
      style={{
        WebkitMaskImage: "radial-gradient(circle at 50% 50%, #000 54%, transparent 76%)",
        maskImage: "radial-gradient(circle at 50% 50%, #000 54%, transparent 76%)",
      }}
    >
      <Canvas dpr={[1, 2]} camera={{ fov: 65, position: [0, 0, 4] }}>
        <Float floatIntensity={1.5} speed={0.5}>
          <Bubble />
        </Float>
        <Shadow scale={2} position={[0, -1.35, 0]} opacity={0.15} />
        <OrbitControls enableZoom={false} enablePan={false} />
        <Environment files={apartment} background blur={1} />
      </Canvas>
    </div>
  );
}
