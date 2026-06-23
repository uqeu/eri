"use client";

import dynamic from "next/dynamic";
import { useWebGLAvailable, usePrefersReducedMotion, CanvasErrorBoundary } from "./cinematic/WebglGuard";
import { SoulOrb } from "./SoulOrb";

// Picks eri's visual: the iridescent WebGL bubble when WebGL is available, the
// canvas-2D ocean orb as the fallback (no-WebGL, reduced-motion, or if the
// bubble throws). Client-only so the WebGL canvas never runs on the server.
const BubbleSoul = dynamic(() => import("./BubbleSoul").then((m) => m.BubbleSoul), {
  ssr: false,
  loading: () => <SoulOrb className="h-full w-full" />,
});

export function HeroSoulVisual({ className }: { readonly className?: string }): React.ReactElement {
  const webgl = useWebGLAvailable();
  const reduced = usePrefersReducedMotion();
  const showBubble = webgl !== false && !reduced;

  return (
    <div className={className}>
      {showBubble ? (
        <CanvasErrorBoundary fallback={<SoulOrb className="h-full w-full" />}>
          <BubbleSoul className="h-full w-full" />
        </CanvasErrorBoundary>
      ) : (
        <SoulOrb className="h-full w-full" />
      )}
    </div>
  );
}
