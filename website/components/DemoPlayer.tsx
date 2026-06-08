"use client";

import dynamic from "next/dynamic";
import { EriLoop, ERI_LOOP } from "@/remotion/EriLoop";

// @remotion/player touches `window`, so load it browser-only. Until it mounts we
// show a matching dark placeholder to avoid a layout flash.
const Player = dynamic(
  () => import("@remotion/player").then((m) => m.Player),
  {
    ssr: false,
    loading: () => (
      <div
        style={{ aspectRatio: `${ERI_LOOP.width} / ${ERI_LOOP.height}` }}
        className="w-full rounded-xl border border-border bg-bg-card"
      />
    ),
  },
);

interface DemoPlayerProps {
  /** Show the scrubber/controls (default: clean autoplay loop, no controls). */
  readonly controls?: boolean;
  readonly className?: string;
}

export function DemoPlayer({
  controls = false,
  className,
}: DemoPlayerProps): React.ReactElement {
  return (
    <div className={`win-chrome overflow-hidden rounded-xl ${className ?? ""}`}>
      <Player
        component={EriLoop}
        durationInFrames={ERI_LOOP.durationInFrames}
        fps={ERI_LOOP.fps}
        compositionWidth={ERI_LOOP.width}
        compositionHeight={ERI_LOOP.height}
        autoPlay
        loop
        controls={controls}
        clickToPlay={false}
        doubleClickToFullscreen
        style={{ width: "100%", height: "auto", display: "block" }}
      />
    </div>
  );
}
