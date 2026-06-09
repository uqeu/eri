import React from "react";
import { Composition } from "remotion";
import { EriLoop, ERI_LOOP } from "./EriLoop";

// Registry for the Remotion CLI / Studio (preview + headless render to PNG/MP4).
// The site itself embeds compositions via @remotion/player and does not use this.
export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="EriLoop"
        component={EriLoop}
        durationInFrames={ERI_LOOP.durationInFrames}
        fps={ERI_LOOP.fps}
        width={ERI_LOOP.width}
        height={ERI_LOOP.height}
      />
    </>
  );
};
