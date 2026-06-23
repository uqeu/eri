"use client";

import { forwardRef } from "react";
import * as THREE from "three";

// eri itself — a living mote of light. A bright lime core that the bloom turns
// into a glow, a soft halo shell, and a point light so it actually lights the
// city it passes. The breathing + orbiting sparks live in the parent's frame
// loop (Director) which drives this group's position.
export const Soul3D = forwardRef<THREE.Group>(function Soul3D(_props, ref) {
  return (
    <group ref={ref}>
      <pointLight color="#d9ff57" intensity={9} distance={26} decay={1.6} />
      {/* bright core */}
      <mesh>
        <sphereGeometry args={[0.38, 24, 24]} />
        <meshBasicMaterial color="#f4ffd6" toneMapped={false} />
      </mesh>
      {/* halo shell */}
      <mesh>
        <sphereGeometry args={[0.72, 24, 24]} />
        <meshBasicMaterial
          color="#d9ff57"
          transparent
          opacity={0.32}
          toneMapped={false}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>
    </group>
  );
});
