"use client";

import { useState } from "react";
import Link from "next/link";
import { HeroCanvas } from "./HeroCanvas";
import { HeroWindow } from "./HeroWindow";
import { SceneTabs } from "./SceneTabs";
import { IDEWindow } from "./IDEWindow";
import { VoiceWindow } from "./VoiceWindow";
import { CLIWindow } from "./CLIWindow";
import { PipelineWindow } from "./PipelineWindow";

export function HeroDemo(): React.ReactElement {
  const [scene, setScene] = useState<number>(0);
  const [resetSignal, setResetSignal] = useState<number>(0);

  function reset(): void {
    setResetSignal((n) => n + 1);
  }

  return (
    <HeroCanvas onReset={reset}>
      {scene === 0 ? (
        <>
          <HeroWindow
            title="eri Desktop"
            initial={{ x: 60, y: 60 }}
            width={760}
            height={460}
            z={10}
            resetSignal={resetSignal}
          >
            <IDEWindow />
          </HeroWindow>
          <HeroWindow
            title="Voice · Gaze"
            initial={{ x: 540, y: 320 }}
            width={360}
            height={300}
            z={20}
            resetSignal={resetSignal}
          >
            <VoiceWindow />
          </HeroWindow>
        </>
      ) : null}

      {scene === 1 ? (
        <>
          <HeroWindow
            title="eri Desktop"
            initial={{ x: 60, y: 60 }}
            width={760}
            height={460}
            z={10}
            resetSignal={resetSignal}
          >
            <IDEWindow />
          </HeroWindow>
          <HeroWindow
            title="eri CLI"
            initial={{ x: 540, y: 320 }}
            width={420}
            height={300}
            z={20}
            resetSignal={resetSignal}
            titlebarRight={
              <Link href="/download" className="rounded px-2 py-0.5 text-[10px] text-white/70 hover:bg-white/10">
                Get eri
              </Link>
            }
          >
            <CLIWindow />
          </HeroWindow>
        </>
      ) : null}

      {scene === 2 ? (
        <HeroWindow
          title="eri · prompt pipeline"
          initial={{ x: 60, y: 40 }}
          width={900}
          height={580}
          z={10}
          resetSignal={resetSignal}
        >
          <PipelineWindow />
        </HeroWindow>
      ) : null}

      <div className="absolute bottom-4 left-4">
        <SceneTabs active={scene} onChange={setScene} count={3} />
      </div>
    </HeroCanvas>
  );
}
