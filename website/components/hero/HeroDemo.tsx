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
            title="eri · workspace"
            initial={{ x: 60, y: 60 }}
            width={760}
            height={460}
            z={10}
            resetSignal={resetSignal}
          >
            <IDEWindow />
          </HeroWindow>
          <HeroWindow
            title="voice · gaze"
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
            title="eri · workspace"
            initial={{ x: 60, y: 60 }}
            width={760}
            height={460}
            z={10}
            resetSignal={resetSignal}
          >
            <IDEWindow />
          </HeroWindow>
          <HeroWindow
            title="eri · cli"
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
        <div className="absolute inset-4 z-10 overflow-hidden rounded-[10px] border border-white/[0.06] bg-[#0A0A0A] shadow-[0_28px_70px_rgba(0,0,0,0.45)]">
          <div className="flex h-7 items-center border-b border-white/[0.06] px-3">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-[#bfd7c1]" aria-hidden />
            <span className="ml-2 text-[10px] uppercase tracking-wider text-white/55">
              eri · prompt pipeline · full view
            </span>
          </div>
          <div className="h-[calc(100%-1.75rem)] overflow-auto">
            <PipelineWindow />
          </div>
        </div>
      ) : null}

      <div className="absolute bottom-4 left-4">
        <SceneTabs active={scene} onChange={setScene} count={3} />
      </div>
    </HeroCanvas>
  );
}
