import React from "react";
import { Composition } from "remotion";
import { EriLoop, ERI_LOOP } from "./EriLoop";
import { VoiceClean, VOICE_CLEAN } from "./VoiceClean";
import { GazeAct, GAZE_ACT } from "./GazeAct";
import { BuildCode, BUILD_CODE } from "./BuildCode";
import { MemoryRecall, MEMORY_RECALL } from "./MemoryRecall";

// Registry for the Remotion CLI / Studio (preview + headless render to PNG/MP4).
// The site embeds these via @remotion/player and does not use this registry.
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
      <Composition
        id="VoiceClean"
        component={VoiceClean}
        durationInFrames={VOICE_CLEAN.durationInFrames}
        fps={VOICE_CLEAN.fps}
        width={VOICE_CLEAN.width}
        height={VOICE_CLEAN.height}
      />
      <Composition
        id="GazeAct"
        component={GazeAct}
        durationInFrames={GAZE_ACT.durationInFrames}
        fps={GAZE_ACT.fps}
        width={GAZE_ACT.width}
        height={GAZE_ACT.height}
      />
      <Composition
        id="BuildCode"
        component={BuildCode}
        durationInFrames={BUILD_CODE.durationInFrames}
        fps={BUILD_CODE.fps}
        width={BUILD_CODE.width}
        height={BUILD_CODE.height}
      />
      <Composition
        id="MemoryRecall"
        component={MemoryRecall}
        durationInFrames={MEMORY_RECALL.durationInFrames}
        fps={MEMORY_RECALL.fps}
        width={MEMORY_RECALL.width}
        height={MEMORY_RECALL.height}
      />
    </>
  );
};
