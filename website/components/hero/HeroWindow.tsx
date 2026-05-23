"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

export interface WindowPos {
  readonly x: number;
  readonly y: number;
}

interface HeroWindowProps {
  readonly title: string;
  readonly initial: WindowPos;
  readonly width: number;
  readonly height: number;
  readonly z: number;
  readonly resetSignal: number;
  readonly titlebarRight?: ReactNode;
  readonly children: ReactNode;
}

export function HeroWindow({
  title,
  initial,
  width,
  height,
  z,
  resetSignal,
  titlebarRight,
  children,
}: HeroWindowProps): React.ReactElement {
  const [pos, setPos] = useState<WindowPos>(initial);
  const dragOffset = useRef<WindowPos | null>(null);

  useEffect(() => {
    setPos(initial);
  }, [resetSignal, initial]);

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      dragOffset.current = { x: e.clientX - pos.x, y: e.clientY - pos.y };
      const onMove = (ev: MouseEvent): void => {
        if (!dragOffset.current) return;
        setPos({ x: ev.clientX - dragOffset.current.x, y: ev.clientY - dragOffset.current.y });
      };
      const onUp = (): void => {
        dragOffset.current = null;
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [pos.x, pos.y],
  );

  return (
    <div
      className="absolute select-none rounded-[10px] bg-[#221f19] text-[#ece8df] shadow-[0_28px_70px_rgba(0,0,0,0.45),0_14px_32px_rgba(0,0,0,0.25),0_0_0_1px_rgba(236,232,223,0.06)] overflow-hidden flex flex-col"
      style={{ left: pos.x, top: pos.y, width, height, zIndex: z }}
    >
      <div
        className="relative flex h-7 items-center justify-between border-b border-white/[0.06] px-2 cursor-grab active:cursor-grabbing"
        onMouseDown={onMouseDown}
      >
        <div className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-full bg-white/15" />
          <span className="inline-block h-2.5 w-2.5 rounded-full bg-white/15" />
          <span className="inline-block h-2.5 w-2.5 rounded-full bg-white/15" />
        </div>
        <div className="pointer-events-none absolute left-1/2 -translate-x-1/2 text-[11px] opacity-70 truncate max-w-[60%]">{title}</div>
        <div className="flex items-center">{titlebarRight}</div>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
    </div>
  );
}
