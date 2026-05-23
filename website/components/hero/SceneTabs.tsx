"use client";

interface SceneTabsProps {
  readonly active: number;
  readonly onChange: (i: number) => void;
  readonly count: number;
}

export function SceneTabs({ active, onChange, count }: SceneTabsProps): React.ReactElement {
  return (
    <div className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-black/30 px-1 py-1 backdrop-blur">
      {Array.from({ length: count }).map((_, i) => {
        const isActive = i === active;
        return (
          <button
            key={i}
            type="button"
            onClick={() => onChange(i)}
            aria-label={`Scene ${i + 1}`}
            className={
              "inline-flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-mono transition-colors " +
              (isActive ? "bg-white/15 text-white" : "text-white/55 hover:text-white")
            }
          >
            {i + 1}
          </button>
        );
      })}
    </div>
  );
}
