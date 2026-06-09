"use client";

import dynamic from "next/dynamic";

// @remotion/player touches `window`, so load it browser-only.
const Player = dynamic(() => import("@remotion/player").then((m) => m.Player), {
  ssr: false,
  loading: () => null,
});

export interface DemoSpec {
  readonly component: React.ComponentType;
  readonly durationInFrames: number;
  readonly fps: number;
  readonly width: number;
  readonly height: number;
}

interface DemoPlayerProps {
  readonly spec: DemoSpec;
  readonly controls?: boolean;
  readonly className?: string;
}

export function DemoPlayer({
  spec,
  controls = false,
  className,
}: DemoPlayerProps): React.ReactElement {
  return (
    <Player
      component={spec.component}
      durationInFrames={spec.durationInFrames}
      fps={spec.fps}
      compositionWidth={spec.width}
      compositionHeight={spec.height}
      autoPlay
      loop
      controls={controls}
      clickToPlay={false}
      doubleClickToFullscreen
      className={className}
      style={{ width: "100%", height: "auto", display: "block" }}
    />
  );
}
