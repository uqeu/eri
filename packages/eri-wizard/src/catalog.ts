export interface Persona {
  readonly name: string;
  readonly description: string;
}

export const PERSONAS: ReadonlyArray<Persona> = [
  { name: "eri", description: "Default — balanced." },
  { name: "coder", description: "Focused on writing code." },
  { name: "architect", description: "Plans + system design." },
  { name: "debugger", description: "Diagnose failures." },
  { name: "tester", description: "Write + run tests." },
  { name: "shipper", description: "Build + deploy." },
  { name: "mercury", description: "Mercury one-shot HTML drafts." },
];

export interface Template {
  readonly slug: string;
  readonly name: string;
  readonly family: string;
  readonly stack: ReadonlyArray<string>;
}

export const TEMPLATES: ReadonlyArray<Template> = [
  {
    slug: "saas-next",
    name: "SaaS — Next.js (Tailwind + shadcn + Stripe + Supabase)",
    family: "next",
    stack: ["Next.js 15", "Tailwind", "shadcn/ui", "Stripe", "Supabase"],
  },
  {
    slug: "spa-vite",
    name: "SPA — Vite + React + TanStack Router",
    family: "vite-react",
    stack: ["Vite", "React", "TanStack Router", "Tailwind"],
  },
  {
    slug: "content-astro",
    name: "Content — Astro + MDX + Decap CMS",
    family: "astro",
    stack: ["Astro", "MDX", "Decap CMS"],
  },
  {
    slug: "api-rust",
    name: "API — Rust (axum + sqlx + tokio)",
    family: "axum",
    stack: ["axum", "sqlx", "tokio", "Postgres"],
  },
  {
    slug: "api-python",
    name: "API — Python (FastAPI + Pydantic + uv)",
    family: "fastapi",
    stack: ["FastAPI", "Pydantic v2", "SQLAlchemy 2.0", "uv"],
  },
  {
    slug: "mobile-expo",
    name: "Mobile — Expo + Tamagui + Supabase",
    family: "expo",
    stack: ["Expo", "React Native", "Tamagui", "Supabase"],
  },
  {
    slug: "chrome-ext",
    name: "Chrome extension (Manifest V3, Vite + React)",
    family: "chrome-ext",
    stack: ["Manifest V3", "Vite", "React"],
  },
  {
    slug: "vscode-ext",
    name: "VS Code extension (yo code shape)",
    family: "vscode-ext",
    stack: ["yo code", "esbuild", "TypeScript"],
  },
];
