"use client";

import { useTheme } from "./ThemeProvider";

const OPTIONS = [
  { value: "system" as const, label: "🖥", aria: "System theme" },
  { value: "light" as const, label: "☉", aria: "Light theme" },
  { value: "dark" as const, label: "☾", aria: "Dark theme" },
];

export function ThemeToggle(): React.ReactElement {
  const { theme, setTheme } = useTheme();
  return (
    <div className="relative flex rounded-full bg-bg-card-2 p-0.5" role="radiogroup" aria-label="Theme">
      {OPTIONS.map((opt) => {
        const active = theme === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={opt.aria}
            onClick={() => setTheme(opt.value)}
            className={
              "relative inline-flex h-7 w-9 items-center justify-center rounded-full text-[14px] transition-colors " +
              (active ? "bg-bg border border-border text-text" : "text-text-sec hover:text-text")
            }
          >
            <span aria-hidden>{opt.label}</span>
          </button>
        );
      })}
    </div>
  );
}
