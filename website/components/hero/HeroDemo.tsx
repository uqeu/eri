"use client";

import { useState } from "react";
import { HeroCanvas } from "./HeroCanvas";
import { SceneTabs } from "./SceneTabs";
import { IDEWindow } from "./IDEWindow";
import { HeroBig } from "../HeroBig";
import { PromptPipeline } from "../PromptPipeline";

interface Scene {
  readonly id: string;
  readonly label: string;
  readonly render: () => React.ReactElement;
  readonly scale?: number;
}

const SCENES: ReadonlyArray<Scene> = [
  {
    id: "prototype",
    label: "prototype + reason to switch",
    render: () => <HeroBig />,
    scale: 0.7,
  },
  {
    id: "ide",
    label: "workspace",
    render: () => (
      <div className="h-full w-full">
        <IDEWindow />
      </div>
    ),
  },
  {
    id: "pipeline",
    label: "prompt pipeline",
    render: () => <PromptPipeline />,
    scale: 0.65,
  },
];

export function HeroDemo(): React.ReactElement {
  const [scene, setScene] = useState<number>(0);
  const [resetSignal, setResetSignal] = useState<number>(0);

  function reset(): void {
    setResetSignal((n) => n + 1);
  }
  void resetSignal;

  const current = SCENES[scene]!;
  const scale = current.scale ?? 1;
  const sizePct = `${(1 / scale) * 100}%`;

  return (
    <HeroCanvas onReset={reset}>
      <div className="absolute inset-4 z-10 overflow-hidden rounded-[10px] border border-white/[0.06] bg-[#0A0A0A] shadow-[0_28px_70px_rgba(0,0,0,0.45)]">
        <div className="flex h-7 items-center border-b border-white/[0.06] px-3">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-[#bfd7c1]" aria-hidden />
          <span className="ml-2 text-[10px] uppercase tracking-wider text-white/55">
            eri · {current.label}
          </span>
        </div>
        <div className="h-[calc(100%-1.75rem)] overflow-hidden">
          {scale === 1 ? (
            <div key={current.id} className="h-full w-full">
              {current.render()}
            </div>
          ) : (
            <div
              key={current.id}
              style={{
                width: sizePct,
                height: sizePct,
                transform: `scale(${scale})`,
                transformOrigin: "top left",
              }}
            >
              {current.render()}
            </div>
          )}
        </div>
      </div>

      <div className="absolute bottom-4 left-4 z-50">
        <SceneTabs active={scene} onChange={setScene} count={SCENES.length} />
      </div>
    </HeroCanvas>
  );
}
