# Website Cursor-Style Overhaul — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Phase 1 — repaint the eri website with sage + powder-blue pastels on warm cream/dark, ship a Cursor-style interactive hero with three switchable draggable-window scenes, and collapse the 16-section homepage into a clean 9-section flow with a re-skinned header and footer.

**Architecture:** New `globals.css` + Tailwind tokens drive every other change. A small `ThemeProvider` writes `data-theme` to `<html>` for system/light/dark. The hero is decomposed into single-responsibility pieces under `components/hero/`: a brand canvas, a generic draggable `HeroWindow` primitive (used by all scenes), three scene-specific window components, a `SceneTabs` switcher, and one composing `HeroDemo`. `page.tsx` becomes a thin 9-section composition. Retired components stay on disk, just unreferenced.

**Tech Stack:** Next.js 14 (app router), TypeScript, Tailwind, CSS variables for theme tokens, React hooks for window drag state (no third-party libs).

**Spec reference:** `docs/superpowers/specs/2026-05-23-website-cursor-overhaul-design.md`

---

## File map

```
website/app/globals.css                  edit  — palette tokens, [data-theme] selectors
website/tailwind.config.ts               edit  — sage/blue tokens, drop lime from chrome scope
website/app/layout.tsx                   edit  — wrap in ThemeProvider, suppressHydrationWarning
website/components/ThemeProvider.tsx     new   — sys/light/dark with localStorage
website/components/ThemeToggle.tsx       new   — pill toggle for footer
website/components/SiteHeader.tsx        edit  — warm-bg, sage focus, lilac→none
website/components/FooterBig.tsx         edit  — warm-bg, 5-col grid, mount ThemeToggle
website/components/FeatureCard.tsx       new   — generic text+demo card (used 3×)
website/components/hero/HeroCanvas.tsx   new   — outer rounded canvas + reset button
website/components/hero/HeroWindow.tsx   new   — draggable Mac-chrome window primitive
website/components/hero/SceneTabs.tsx    new   — 1·2·3 selector
website/components/hero/IDEWindow.tsx    new   — Scene 1+2 main window + chat funnel
website/components/hero/VoiceWindow.tsx  new   — Scene 1 overlay
website/components/hero/CLIWindow.tsx    new   — Scene 2 overlay + / commands
website/components/hero/PipelineWindow.tsx  new — Scene 3 wraps PromptPipeline
website/components/hero/HeroDemo.tsx     new   — composes canvas + scenes + tabs
website/components/Hero.tsx              rewrite — headline + CTAs + <HeroDemo />
website/app/page.tsx                     rewrite — 9-section composition
```

---

## Task 1: Repaint globals.css to sage + powder blue

**Files:**
- Modify: `website/app/globals.css` (top variable block)

- [ ] **Step 1: Replace `:root` variables with theme-aware tokens**

Open `website/app/globals.css`. Replace the existing `:root { ... }` block (lines 5-52, ending before the `html, body` rule) with:

```css
:root {
  color-scheme: light dark;

  /* Default (system): light tokens */
  --bg:        #f7f4ef;
  --bg-card:   #efeae0;
  --bg-card-2: #e7e1d4;
  --border:    rgba(42, 38, 32, 0.08);
  --border-strong: rgba(42, 38, 32, 0.16);

  --text:     #2a2620;
  --text-sec: rgba(42, 38, 32, 0.6);
  --text-ter: rgba(42, 38, 32, 0.4);

  --sage:        #bfd7c1;
  --sage-deep:   #8fb592;
  --blue:        #c9dcea;
  --blue-deep:   #9bb7cd;
  --focus-ring:  var(--sage-deep);

  /* Demo-only — lime survives inside the engine */
  --demo-accent: #e0ff4f;

  --text-display: clamp(3rem, 8vw, 6.5rem);
  --text-h1: clamp(2.5rem, 5vw, 4rem);
  --text-h2: clamp(2rem, 3.5vw, 3rem);
  --text-h3: 1.75rem;
  --text-body: 1.0625rem;
  --text-mono-cap: 0.75rem;

  --r-sm: 6px;
  --r-md: 10px;
  --r-lg: 14px;
  --r-xl: 20px;

  --ease-out: cubic-bezier(0.22, 1, 0.36, 1);
  --ease-in-out: cubic-bezier(0.4, 0, 0.2, 1);
  --dur-fast: 120ms;
  --dur-base: 200ms;
  --dur-slow: 400ms;
}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --bg:        #1a1814;
    --bg-card:   #221f19;
    --bg-card-2: #2a2620;
    --border:    rgba(236, 232, 223, 0.08);
    --border-strong: rgba(236, 232, 223, 0.16);

    --text:     #ece8df;
    --text-sec: rgba(236, 232, 223, 0.6);
    --text-ter: rgba(236, 232, 223, 0.4);

    --sage:       #a8c4ab;
    --sage-deep:  #cfe1d1;
    --blue:       #b0c4d6;
    --blue-deep:  #d0dde7;
    --focus-ring: var(--blue-deep);
  }
}

:root[data-theme="dark"] {
  --bg:        #1a1814;
  --bg-card:   #221f19;
  --bg-card-2: #2a2620;
  --border:    rgba(236, 232, 223, 0.08);
  --border-strong: rgba(236, 232, 223, 0.16);

  --text:     #ece8df;
  --text-sec: rgba(236, 232, 223, 0.6);
  --text-ter: rgba(236, 232, 223, 0.4);

  --sage:       #a8c4ab;
  --sage-deep:  #cfe1d1;
  --blue:       #b0c4d6;
  --blue-deep:  #d0dde7;
  --focus-ring: var(--blue-deep);
}
```

- [ ] **Step 2: Replace `html, body` rule and `::selection`**

Below the variable block, replace the existing `html, body` and `::selection` rules with:

```css
html, body {
  background: var(--bg);
  color: var(--text);
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  transition: background var(--dur-base) var(--ease-out), color var(--dur-base) var(--ease-out);
}

::selection {
  background: var(--sage);
  color: var(--text);
}
```

- [ ] **Step 3: Sweep legacy var names**

Inside the same file, find every remaining `--bg-primary`, `--bg-secondary`, `--bg-tertiary`, `--bg-elevated`, `--text-primary`, `--text-secondary`, `--text-tertiary`, `--text-quaternary`, `--accent`, `--accent-bright`, `--accent-muted`, `--accent-faint`, `--border-default`, `--border-hover`, `--border-strong` and map them:

| Old | New |
|---|---|
| `--bg-primary` | `--bg` |
| `--bg-secondary` | `--bg-card` |
| `--bg-tertiary` | `--bg-card-2` |
| `--bg-elevated` | `--bg-card-2` |
| `--text-primary` | `--text` |
| `--text-secondary` | `--text-sec` |
| `--text-tertiary` | `--text-ter` |
| `--text-quaternary` | `--text-ter` |
| `--accent` | `--sage-deep` |
| `--accent-bright` | `--sage` |
| `--accent-muted` | `--sage` (with opacity in rgba — leave callsites for Task 1 step 4 to fix in components) |
| `--accent-faint` | `--sage` |
| `--border-default` | `--border` |
| `--border-hover` | `--border-strong` |
| `--border-strong` | `--border-strong` |

Use editor find-and-replace **within `globals.css` only** for these.

- [ ] **Step 4: Build to surface broken references**

Run from repo root:

```bash
cd website && npm run build 2>&1 | head -80
```

Expected: build may fail with references to old var names in `.tsx` files. Note any files that reference `--accent` or `bg-1/2/3/4` Tailwind tokens; they'll be fixed in Task 2.

- [ ] **Step 5: Commit**

```bash
git add website/app/globals.css
git commit -m "feat(website): swap palette to sage + powder blue on warm cream/dark"
```

---

## Task 2: Update Tailwind config

**Files:**
- Modify: `website/tailwind.config.ts`

- [ ] **Step 1: Replace the `colors` block**

Open `website/tailwind.config.ts`. Replace the existing `colors: { ... }` block (lines 9-19) with:

```ts
colors: {
  // Semantic tokens (drive 99% of the site)
  bg: "var(--bg)",
  "bg-card": "var(--bg-card)",
  "bg-card-2": "var(--bg-card-2)",
  border: "var(--border)",
  "border-strong": "var(--border-strong)",
  text: "var(--text)",
  "text-sec": "var(--text-sec)",
  "text-ter": "var(--text-ter)",
  sage: "var(--sage)",
  "sage-deep": "var(--sage-deep)",
  blue: "var(--blue)",
  "blue-deep": "var(--blue-deep)",
  // Demo-only accent
  "demo-accent": "var(--demo-accent)",
  // Legacy aliases kept for one PR so component sweeps can be incremental
  ink: "var(--text)",
  paper: "var(--bg)",
  accent: "var(--sage-deep)",
  "accent-bright": "var(--sage)",
  muted: "var(--text-sec)",
  "bg-1": "var(--bg)",
  "bg-2": "var(--bg-card)",
  "bg-3": "var(--bg-card-2)",
  "bg-4": "var(--bg-card-2)",
},
```

- [ ] **Step 2: Verify**

```bash
cd website && npx tsc --noEmit tailwind.config.ts 2>&1 | head -10
```

Expected: no type errors.

- [ ] **Step 3: Commit**

```bash
git add website/tailwind.config.ts
git commit -m "feat(website): point Tailwind tokens at new CSS variables"
```

---

## Task 3: ThemeProvider + ThemeToggle

**Files:**
- Create: `website/components/ThemeProvider.tsx`
- Create: `website/components/ThemeToggle.tsx`
- Modify: `website/app/layout.tsx`

- [ ] **Step 1: Create ThemeProvider**

```tsx
// website/components/ThemeProvider.tsx
"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

type Theme = "system" | "light" | "dark";

interface ThemeContextValue {
  readonly theme: Theme;
  readonly setTheme: (t: Theme) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

const STORAGE_KEY = "eri-theme";

function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  if (theme === "system") {
    root.removeAttribute("data-theme");
  } else {
    root.setAttribute("data-theme", theme);
  }
}

export function ThemeProvider({ children }: { readonly children: ReactNode }): React.ReactElement {
  const [theme, setThemeState] = useState<Theme>("system");

  useEffect(() => {
    const stored = (localStorage.getItem(STORAGE_KEY) as Theme | null) ?? "system";
    setThemeState(stored);
    applyTheme(stored);
  }, []);

  function setTheme(next: Theme): void {
    setThemeState(next);
    localStorage.setItem(STORAGE_KEY, next);
    applyTheme(next);
  }

  return <ThemeContext.Provider value={{ theme, setTheme }}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}
```

- [ ] **Step 2: Create ThemeToggle**

```tsx
// website/components/ThemeToggle.tsx
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
```

- [ ] **Step 3: Wrap layout in ThemeProvider**

Open `website/app/layout.tsx`. Add `suppressHydrationWarning` on `<html>` and wrap the body's children in `<ThemeProvider>`. Import at top:

```tsx
import { ThemeProvider } from "@/components/ThemeProvider";
```

Then ensure `<html lang="en" suppressHydrationWarning>` and `<body>{children}</body>` becomes:

```tsx
<body>
  <ThemeProvider>{children}</ThemeProvider>
</body>
```

- [ ] **Step 4: Verify build**

```bash
cd website && npm run build 2>&1 | tail -30
```

Expected: build succeeds (color refs from legacy components still resolve via Tailwind aliases).

- [ ] **Step 5: Commit**

```bash
git add website/components/ThemeProvider.tsx website/components/ThemeToggle.tsx website/app/layout.tsx
git commit -m "feat(website): add system/light/dark ThemeProvider + ThemeToggle pill"
```

---

## Task 4: Re-skin SiteHeader

**Files:**
- Modify: `website/components/SiteHeader.tsx`

- [ ] **Step 1: Read current file**

```bash
cat website/components/SiteHeader.tsx
```

Note any hardcoded `#0a0a0a`, `bg-bg-1`, `text-paper`, or accent classes. They need to become semantic tokens.

- [ ] **Step 2: Rewrite background and link styles**

In `SiteHeader.tsx`, swap class names so the header reads as warm-bg with hairline border:

- Outer header: `className="bg-bg fixed top-0 inset-x-0 z-50 border-b border-border"`
- Inner container: keep grid; wrap in `text-text`
- Nav links: `className="text-text-sec hover:text-text transition-colors text-[14px]"`
- "Download" primary button: `className="rounded-md bg-sage-deep text-bg px-3 py-1.5 text-[13px] font-medium hover:bg-sage transition-colors"`
- "Sign in" / "Contact" ghost buttons: `className="text-text-sec hover:text-text text-[13px]"`

Replace any reference to `var(--accent)` or `text-accent` with `text-sage-deep` or `bg-sage-deep`.

- [ ] **Step 3: Visual smoke**

```bash
cd website && npm run dev
```

Open http://localhost:3000 — header should show cream/warm background, dark text, sage button.

- [ ] **Step 4: Commit**

```bash
git add website/components/SiteHeader.tsx
git commit -m "feat(website): re-skin SiteHeader to warm bg + sage primary"
```

---

## Task 5: Re-skin FooterBig with ThemeToggle

**Files:**
- Modify: `website/components/FooterBig.tsx`

- [ ] **Step 1: Update background and link styles**

In `FooterBig.tsx`:

- Outer footer: `className="bg-bg-card text-text px-6 pt-20 pb-12 border-t border-border"`
- Column headings: `className="text-text-sec text-[13px] pb-3"`
- Footer links: `className="text-text-sec hover:text-text text-[14px] py-1.5 inline-block transition-colors"`
- Bottom-bar wrapper: `className="container flex flex-col md:flex-row items-start md:items-center justify-between gap-4 mt-12 pt-6 border-t border-border text-text-sec text-[13px]"`

- [ ] **Step 2: Mount ThemeToggle in bottom bar**

Import at top:

```tsx
import { ThemeToggle } from "./ThemeToggle";
```

In the bottom-bar right-side cluster (or create one if absent), render:

```tsx
<div className="flex items-center gap-3">
  <ThemeToggle />
</div>
```

- [ ] **Step 3: Build verify**

```bash
cd website && npm run build 2>&1 | tail -20
```

Expected: passes.

- [ ] **Step 4: Commit**

```bash
git add website/components/FooterBig.tsx
git commit -m "feat(website): re-skin FooterBig and mount ThemeToggle"
```

---

## Task 6: FeatureCard component

**Files:**
- Create: `website/components/FeatureCard.tsx`

- [ ] **Step 1: Write the component**

```tsx
// website/components/FeatureCard.tsx
import type { ReactNode } from "react";

interface FeatureCardProps {
  readonly eyebrow?: string;
  readonly title: string;
  readonly body: string;
  readonly ctaHref?: string;
  readonly ctaLabel?: string;
  readonly media: ReactNode;
  readonly mediaSide?: "left" | "right";
}

export function FeatureCard({
  eyebrow,
  title,
  body,
  ctaHref,
  ctaLabel,
  media,
  mediaSide = "right",
}: FeatureCardProps): React.ReactElement {
  const mediaCol = mediaSide === "right" ? "lg:col-start-13 lg:col-end-25" : "lg:col-start-1 lg:col-end-13";
  const textCol = mediaSide === "right" ? "lg:col-start-1 lg:col-end-11" : "lg:col-start-15 lg:col-end-25";
  return (
    <section className="container mb-12 lg:mb-20">
      <div className="grid grid-cols-1 lg:grid-cols-24 gap-6 lg:gap-8 rounded-2xl bg-bg-card border border-border p-6 lg:p-10">
        <div className={`flex flex-col justify-center ${textCol}`}>
          {eyebrow ? <div className="mono-cap text-text-sec mb-3">{eyebrow}</div> : null}
          <h3 className="text-h3 text-text mb-3 text-balance">{title}</h3>
          <p className="text-body text-text-sec max-w-prose">{body}</p>
          {ctaHref && ctaLabel ? (
            <a href={ctaHref} className="mt-6 inline-flex items-center text-sage-deep hover:text-text transition-colors text-[14px]">
              {ctaLabel} <span className="ml-1">→</span>
            </a>
          ) : null}
        </div>
        <div className={`min-h-[360px] rounded-xl overflow-hidden ${mediaCol}`}>{media}</div>
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Extend Tailwind grid to 24 cols**

In `website/tailwind.config.ts`, inside `theme.extend`, add (if not already there):

```ts
gridTemplateColumns: {
  "24": "repeat(24, minmax(0, 1fr))",
},
```

- [ ] **Step 3: Build verify**

```bash
cd website && npm run build 2>&1 | tail -10
```

Expected: passes.

- [ ] **Step 4: Commit**

```bash
git add website/components/FeatureCard.tsx website/tailwind.config.ts
git commit -m "feat(website): add FeatureCard component (text + media, swappable side)"
```

---

## Task 7: HeroWindow draggable primitive

**Files:**
- Create: `website/components/hero/HeroWindow.tsx`

- [ ] **Step 1: Write the component**

```tsx
// website/components/hero/HeroWindow.tsx
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
  readonly resetSignal: number; // bump to snap back to initial
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
```

- [ ] **Step 2: Smoke test by mounting on a throwaway route**

Skip — direct visual verification in Task 12 when wired into the canvas. Build verify only:

```bash
cd website && npm run build 2>&1 | tail -10
```

- [ ] **Step 3: Commit**

```bash
git add website/components/hero/HeroWindow.tsx
git commit -m "feat(hero): add draggable HeroWindow Mac-chrome primitive"
```

---

## Task 8: SceneTabs (1·2·3 selector)

**Files:**
- Create: `website/components/hero/SceneTabs.tsx`

- [ ] **Step 1: Write the component**

```tsx
// website/components/hero/SceneTabs.tsx
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
```

- [ ] **Step 2: Commit**

```bash
git add website/components/hero/SceneTabs.tsx
git commit -m "feat(hero): add SceneTabs 1·2·3 selector"
```

---

## Task 9: IDEWindow + chat funnel

**Files:**
- Create: `website/components/hero/IDEWindow.tsx`

- [ ] **Step 1: Write the component**

```tsx
// website/components/hero/IDEWindow.tsx
"use client";

import { useState } from "react";
import Link from "next/link";

interface Message {
  readonly id: number;
  readonly role: "user" | "assistant";
  readonly text: string;
  readonly cta?: boolean;
}

const SEED: ReadonlyArray<Message> = [
  { id: 1, role: "user", text: "make a landing page based on attached docs explaining what we do" },
  { id: 2, role: "assistant", text: "Done. Fonts preload, critical CSS inlined, color-scheme meta tag added. 280ms first paint." },
];

export function IDEWindow(): React.ReactElement {
  const [messages, setMessages] = useState<ReadonlyArray<Message>>(SEED);
  const [input, setInput] = useState<string>("");

  function send(e: React.FormEvent): void {
    e.preventDefault();
    if (!input.trim()) return;
    const userMsg: Message = { id: Date.now(), role: "user", text: input };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setTimeout(() => {
      const reply: Message = {
        id: Date.now() + 1,
        role: "assistant",
        text: "This needs the real eri running locally.",
        cta: true,
      };
      setMessages((prev) => [...prev, reply]);
    }, 600);
  }

  return (
    <div className="flex h-full w-full">
      {/* Sidebar */}
      <aside className="w-[200px] shrink-0 border-r border-white/[0.06] p-2 text-[11px]">
        <div className="mb-1 px-2 py-1 text-[10px] uppercase tracking-wider text-white/45">In progress · 2</div>
        <div className="space-y-0.5">
          <SidebarRow title="Analyze Tab vs Agent usage" sub="Fetching data" />
          <SidebarRow title="Plan Mission Control" sub="Generating plan" />
        </div>
        <div className="mt-3 mb-1 px-2 py-1 text-[10px] uppercase tracking-wider text-white/45">Ready · 1</div>
        <div className="space-y-0.5">
          <SidebarRow title="Build Landing Page" sub="+52 · done" active />
        </div>
      </aside>

      {/* Chat */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="px-3 pt-2 pb-1 text-[12px] font-medium">Build Landing Page</div>
        <div className="flex-1 overflow-y-auto px-3 py-2 space-y-2">
          {messages.map((m) => (
            <div key={m.id} className={m.role === "user" ? "rounded-md border border-white/[0.08] bg-white/[0.03] px-2 py-1.5 text-[12px]" : "text-[12px] text-white/85"}>
              {m.text}
              {m.cta ? (
                <Link href="/download" className="ml-1 text-[#e0ff4f] underline underline-offset-2 hover:opacity-80">
                  Download eri →
                </Link>
              ) : null}
            </div>
          ))}
        </div>
        <form onSubmit={send} className="border-t border-white/[0.06] p-2">
          <div className="rounded-md border border-white/[0.08] bg-white/[0.02] p-2">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Plan, search, build anything..."
              className="w-full bg-transparent text-[12px] outline-none placeholder:text-white/35"
              spellCheck={false}
              autoCorrect="off"
            />
            <div className="mt-2 flex items-center justify-between">
              <div className="flex items-center gap-2 text-[11px] text-white/55">
                <span className="rounded-full bg-white/[0.06] px-2 py-0.5">Agent</span>
                <span>Composer 2.5</span>
              </div>
              <button type="submit" className="flex h-5 w-5 items-center justify-center rounded-full bg-white/10 text-white/70 hover:bg-white/15">↑</button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

function SidebarRow({ title, sub, active }: { title: string; sub: string; active?: boolean }): React.ReactElement {
  return (
    <div className={"rounded px-2 py-1.5 " + (active ? "bg-white/[0.06]" : "hover:bg-white/[0.03]")}>
      <div className="truncate text-[11px] text-white/90">{title}</div>
      <div className="truncate text-[10px] text-white/45">{sub}</div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add website/components/hero/IDEWindow.tsx
git commit -m "feat(hero): add IDEWindow with chat funnel to /download"
```

---

## Task 10: VoiceWindow (Scene 1 overlay)

**Files:**
- Create: `website/components/hero/VoiceWindow.tsx`

- [ ] **Step 1: Write the component**

```tsx
// website/components/hero/VoiceWindow.tsx
"use client";

export function VoiceWindow(): React.ReactElement {
  return (
    <div className="flex h-full flex-col p-3 text-[12px]">
      <div className="mb-2 text-[10px] uppercase tracking-wider text-white/45">Voice · Gaze</div>
      <div className="flex items-center gap-2">
        <span className="inline-flex h-2 w-2 rounded-full bg-[#e0ff4f]" />
        <span className="text-white/85">listening · sub-second</span>
      </div>
      <div className="mt-2 flex h-8 items-center gap-[3px]">
        {[0.3, 0.6, 0.9, 1.0, 0.7, 0.4, 0.8, 1.0, 0.6, 0.3, 0.5, 0.9, 0.7, 0.4, 0.2].map((s, i) => (
          <span key={i} className="block w-[3px] rounded-full bg-[#e0ff4f]" style={{ height: `${s * 100}%`, opacity: 0.5 + s * 0.5 }} />
        ))}
      </div>
      <div className="mt-3 rounded-md border border-white/[0.08] bg-white/[0.02] p-2">
        <div className="text-[10px] uppercase tracking-wider text-white/45 mb-1">Transcript</div>
        <div className="text-white/90">make the annual price chip glow when toggled</div>
      </div>
      <div className="mt-2 rounded-md border border-[#e0ff4f]/40 bg-[#e0ff4f]/[0.06] p-2">
        <div className="text-[10px] uppercase tracking-wider text-[#e0ff4f]/80 mb-1">Gaze</div>
        <div className="text-white/90">Toggle.billing-cycle <span className="text-white/45">· pricing.tsx · line 47</span></div>
      </div>
      <div className="mt-auto text-[10px] text-white/35">local whisper · on-device</div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add website/components/hero/VoiceWindow.tsx
git commit -m "feat(hero): add VoiceWindow overlay (Scene 1)"
```

---

## Task 11: CLIWindow with `/` commands

**Files:**
- Create: `website/components/hero/CLIWindow.tsx`

- [ ] **Step 1: Write the component**

```tsx
// website/components/hero/CLIWindow.tsx
"use client";

import { useState } from "react";

const COMMANDS = ["transcript", "gaze", "diffuse", "agent", "models", "history", "clear"] as const;

export function CLIWindow(): React.ReactElement {
  const [input, setInput] = useState<string>("");
  const showCommands = input.startsWith("/");
  const filtered = showCommands
    ? COMMANDS.filter((c) => c.startsWith(input.slice(1).toLowerCase()))
    : [];

  function onSubmit(e: React.FormEvent): void {
    e.preventDefault();
    setInput("");
  }

  return (
    <div className="flex h-full flex-col font-mono text-[12px] text-white/90">
      <div className="flex-1 overflow-y-auto px-3 pt-3 pb-2 space-y-2">
        <div className="text-white/85">eri agent · ~/eri/website</div>
        <div className="text-white/85">Analyze Tab vs Agent Usage Patterns</div>
        <div className="rounded border border-white/[0.08] bg-white/[0.02] px-2 py-1.5 text-white/85">
          Help me understand how teams split their focus between Tab and the agents panel across our workspaces.
        </div>
        <div className="space-y-1 text-white/65">
          <div>⬢ Thought · 7s</div>
          <div>⬢ Reviewed workspace usage exports</div>
          <div>⬢ Wrote summary.py · +150</div>
          <div>⬢ Wrote test_usage.py · +90</div>
        </div>
        <div className="text-white/85">All set. Focus share, switching rates, rolling engagement.</div>
      </div>

      {/* Prompt */}
      <form onSubmit={onSubmit} className="border-t border-white/[0.06] p-2">
        <div className="relative">
          <div className="flex items-center gap-1.5 rounded border border-white/15 px-2 py-1.5">
            <span className="text-white/55">→</span>
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="add a follow-up"
              className="w-full bg-transparent outline-none placeholder:text-white/35"
              autoCorrect="off"
              spellCheck={false}
            />
          </div>
          {showCommands && filtered.length > 0 ? (
            <div className="absolute bottom-full left-0 right-0 mb-1 rounded border border-white/10 bg-[#181614] p-1 shadow-lg">
              {filtered.map((c) => (
                <div key={c} className="px-2 py-1 text-white/80 hover:bg-white/[0.06] cursor-pointer">
                  /{c}
                </div>
              ))}
            </div>
          ) : null}
        </div>
        <div className="mt-1 flex items-center gap-2 text-[10px] text-white/45">
          <span>Composer 2.5</span>
          <span>·</span>
          <span>/ for commands · @ for files</span>
        </div>
      </form>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add website/components/hero/CLIWindow.tsx
git commit -m "feat(hero): add CLIWindow with / commands palette"
```

---

## Task 12: PipelineWindow (Scene 3)

**Files:**
- Create: `website/components/hero/PipelineWindow.tsx`

- [ ] **Step 1: Write the wrapper**

```tsx
// website/components/hero/PipelineWindow.tsx
"use client";

import { PromptPipeline } from "../PromptPipeline";

export function PipelineWindow(): React.ReactElement {
  return (
    <div className="h-full w-full overflow-auto bg-[#0A0A0A] p-2">
      <PromptPipeline />
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add website/components/hero/PipelineWindow.tsx
git commit -m "feat(hero): add PipelineWindow wrapping existing PromptPipeline (Scene 3)"
```

---

## Task 13: HeroCanvas + HeroDemo composer

**Files:**
- Create: `website/components/hero/HeroCanvas.tsx`
- Create: `website/components/hero/HeroDemo.tsx`

- [ ] **Step 1: Create HeroCanvas**

```tsx
// website/components/hero/HeroCanvas.tsx
"use client";

import type { ReactNode } from "react";

interface HeroCanvasProps {
  readonly onReset: () => void;
  readonly children: ReactNode;
}

export function HeroCanvas({ onReset, children }: HeroCanvasProps): React.ReactElement {
  return (
    <div
      className="relative w-full overflow-hidden rounded-2xl border border-border bg-[#14120b]"
      style={{ height: "min(720px, 70vh)", minHeight: 560 }}
    >
      {children}
      <button
        type="button"
        onClick={onReset}
        aria-label="Reset layout"
        title="Reset windows"
        className="absolute bottom-4 right-4 inline-flex h-8 w-8 items-center justify-center rounded-full border border-white/15 bg-black/40 text-white/70 hover:bg-black/55 hover:text-white"
      >
        ↻
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Create HeroDemo**

```tsx
// website/components/hero/HeroDemo.tsx
"use client";

import { useState } from "react";
import { HeroCanvas } from "./HeroCanvas";
import { HeroWindow } from "./HeroWindow";
import { SceneTabs } from "./SceneTabs";
import { IDEWindow } from "./IDEWindow";
import { VoiceWindow } from "./VoiceWindow";
import { CLIWindow } from "./CLIWindow";
import { PipelineWindow } from "./PipelineWindow";
import Link from "next/link";

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
```

- [ ] **Step 3: Commit**

```bash
git add website/components/hero/HeroCanvas.tsx website/components/hero/HeroDemo.tsx
git commit -m "feat(hero): add HeroCanvas + HeroDemo with scene switching"
```

---

## Task 14: Rewrite Hero.tsx to use HeroDemo

**Files:**
- Modify: `website/components/Hero.tsx` (full rewrite)

- [ ] **Step 1: Replace contents**

```tsx
// website/components/Hero.tsx
import Link from "next/link";
import { HeroDemo } from "./hero/HeroDemo";

export function Hero(): React.ReactElement {
  return (
    <section className="bg-bg text-text">
      <div className="container pt-20 pb-12 lg:pt-28 lg:pb-16">
        <div className="max-w-3xl mb-8">
          <h1 className="text-h1 text-balance mb-4">
            Built to make you extraordinarily productive in your editor.
          </h1>
          <p className="text-body text-text-sec max-w-prose">
            eri compiles your voice, gaze, and codebase into one diffused edit. Local-first, BYOK, no cloud round-trips for the things that matter.
          </p>
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <Link href="/download" className="inline-flex items-center rounded-md bg-sage-deep px-4 py-2 text-[14px] font-medium text-bg hover:bg-sage transition-colors">
              Download for macOS <span className="ml-2">⤓</span>
            </Link>
            <Link href="/contact" className="inline-flex items-center rounded-md border border-border px-4 py-2 text-[14px] text-text hover:bg-bg-card transition-colors">
              Request a demo <span className="ml-2">→</span>
            </Link>
          </div>
        </div>

        <HeroDemo />
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Visual verify in dev**

```bash
cd website && npm run dev
```

Open http://localhost:3000. Expected:
- Warm cream/dark hero with sage button.
- Demo canvas with two floating windows.
- `1·2·3` tabs at bottom-left switch scenes with crossfade.
- Reset button (↻) at bottom-right snaps windows back.
- Typing in IDE chat and submitting → reply appears with "Download eri →" link.
- In Scene 2 CLI, typing `/` shows command palette.

- [ ] **Step 3: Commit**

```bash
git add website/components/Hero.tsx
git commit -m "feat(website): wire Hero to new interactive HeroDemo"
```

---

## Task 15: Restructure page.tsx to 9 sections

**Files:**
- Modify: `website/app/page.tsx` (full rewrite)

- [ ] **Step 1: Read current to identify reusable pieces**

```bash
cat website/app/page.tsx
```

Note which retired components stay imported (none — drop them).

- [ ] **Step 2: Replace contents**

```tsx
// website/app/page.tsx
import { Hero } from "@/components/Hero";
import { LogoWall } from "@/components/LogoWall";
import { FeatureCard } from "@/components/FeatureCard";
import { EngineRoom } from "@/components/EngineRoom";
import { EriDemo } from "@/components/EriDemo";
import { HeroBig } from "@/components/HeroBig";
import { Testimonials } from "@/components/Testimonials";
import { CtaFooter } from "@/components/CtaFooter";
import { FooterBig } from "@/components/FooterBig";

export default function HomePage(): React.ReactElement {
  return (
    <main>
      <Hero />

      <LogoWall />

      <FeatureCard
        eyebrow="01 · voice + gaze"
        title="Speak the edit. Look at what you mean."
        body="Local Whisper transcribes voice in sub-second; an optional MediaPipe gaze layer tells eri exactly which element you're pointing at. The camera frame never leaves your laptop."
        ctaHref="/features"
        ctaLabel="Learn about voice + gaze"
        mediaSide="right"
        media={<div className="h-full w-full bg-[#14120b]"><EngineRoom /></div>}
      />

      <FeatureCard
        eyebrow="02 · diffusion preview"
        title="See the diff resolve, not the tokens stream."
        body="eri's engine denoises a working patch while you finish your sentence. The preview becomes the answer — no waiting on a cursor."
        ctaHref="/features"
        ctaLabel="How diffusion works"
        mediaSide="left"
        media={<div className="h-full w-full bg-[#14120b]"><HeroBig /></div>}
      />

      <FeatureCard
        eyebrow="03 · iteration history"
        title="Branchable, time-travelable edit history."
        body="Every prompt becomes a node. Fork it, replay it, send the whole branch through a different model. The thing you tried yesterday is one click away."
        ctaHref="/features"
        ctaLabel="See iteration history"
        mediaSide="right"
        media={<div className="h-full w-full bg-[#14120b]"><EriDemo /></div>}
      />

      <Testimonials />

      {/* Frontier 3-card grid */}
      <section className="container mb-16 lg:mb-24">
        <h2 className="text-h2 mb-8 text-balance text-text">Stay on the frontier</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <FrontierCard
            title="Use the best model for every task"
            body="Pick from Claude Opus/Sonnet, GPT-5.5, Gemini 3.1, Grok 4.3 — or eri's own diffusion engine for short edits. Auto-route or override per prompt."
            href="/docs/models"
            cta="Explore models"
          />
          <FrontierCard
            title="Complete codebase understanding"
            body="eri reads your repo the same way Cursor does — semantic search, grep, AST awareness — so prompts ground in your code, not generic patterns."
            href="/docs/context"
            cta="Codebase indexing"
          />
          <FrontierCard
            title="Local-first, BYOK, enduring"
            body="Your key, your machine, your transcripts. No data leaves your laptop unless you point a model call at a remote provider."
            href="/security"
            cta="Read the security model"
          />
        </div>
      </section>

      <CtaFooter />
      <FooterBig />
    </main>
  );
}

function FrontierCard({ title, body, href, cta }: { title: string; body: string; href: string; cta: string }): React.ReactElement {
  return (
    <a href={href} className="block rounded-2xl border border-border bg-bg-card p-6 hover:border-border-strong transition-colors">
      <h3 className="text-h3 mb-2 text-balance text-text">{title}</h3>
      <p className="text-body text-text-sec mb-4">{body}</p>
      <span className="text-sage-deep text-[14px]">{cta} →</span>
    </a>
  );
}
```

- [ ] **Step 3: Verify build**

```bash
cd website && npm run build 2>&1 | tail -30
```

Expected: passes. If any retired component (Promises, WhyEri, etc.) is still imported elsewhere, that's fine — they stay on disk.

- [ ] **Step 4: Visual smoke**

```bash
cd website && npm run dev
```

Open http://localhost:3000 — verify all 9 sections render, light/dark toggle in footer works, hero demo scene tabs switch.

- [ ] **Step 5: Commit**

```bash
git add website/app/page.tsx
git commit -m "feat(website): collapse homepage to 9 Cursor-style sections"
```

---

## Task 16: Final build + visual sweep

- [ ] **Step 1: Production build**

```bash
cd website && npm run build
```

Expected: builds successfully, no type errors.

- [ ] **Step 2: Cross-mode smoke**

```bash
cd website && npm run dev
```

Open http://localhost:3000. Verify in each theme:
- Footer toggle to **Light** — bg cream, text warm ink, sage button.
- Footer toggle to **Dark** — bg warm-near-black, text warm paper.
- Footer toggle to **System** — matches OS preference.

Each FeatureCard reads cleanly (text on one side, embedded demo on the other). Demo canvas in hero shows correct windows for each tab.

- [ ] **Step 3: Commit any final polish**

If you tweaked anything (color, spacing, retired-import cleanup):

```bash
git add -A
git commit -m "polish(website): final pass on overhauled homepage"
```

---

## Self-review

**Spec coverage:**
- Palette: Task 1, Task 2 ✓
- 9-section homepage: Task 15 ✓
- Interactive hero with 3 scenes + drag + reset + chat funnel + CLI commands: Tasks 7–14 ✓
- Header / Footer re-skin + theme toggle: Tasks 3–5 ✓
- Retire 8 components from homepage flow (kept on disk): Task 15 (drop imports) ✓
- Mobile fallback: not addressed in Phase 1 — windows will simply overflow on small screens; spec marked this as Phase 2 polish risk.

**Placeholders:** none. Every code block is complete.

**Type consistency:** `HeroWindow` props (`initial: WindowPos`, `width`, `height`, `z`, `resetSignal`, `titlebarRight`, `children`) are referenced consistently in `HeroDemo`. `SceneTabs` props (`active`, `onChange`, `count`) match call site. `IDEWindow.Message` is local; not referenced cross-file.

**One known soft spot:** Task 15 embeds `EngineRoom`, `HeroBig`, and `EriDemo` inside `FeatureCard` media slots. Each of those components currently assumes a full-bleed section context (their own padding/heights). They may need a defensive wrapper. Acceptable for Phase 1 — visual smoke in Task 16 will catch breakage and one polish commit can absorb it.
