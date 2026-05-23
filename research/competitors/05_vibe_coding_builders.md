# Vibe-Coding & No-IDE App Builders — Competitive Brief

> Companion to the Cursor briefs (`01–03`) in `../cursor/`. Cursor is the IDE-shaped competitor; this brief covers the **browser-shaped** competitors: prompt-to-deployed-app tools where the chat *is* the interface and the preview *is* the product. eri shares more UX DNA with this category than with Cursor — both are voice-friendly, preview-first, ephemeral-feeling surfaces — so we have to know them cold.

---

## 0. Category context — why this exists

The phrase "vibe coding" was coined by Andrej Karpathy on 2 February 2025 on X. He described it as giving in fully to AI suggestions — talking to the assistant, accepting diffs without reading them, pasting errors back until things compile [source: https://en.wikipedia.org/wiki/Vibe_coding]. Merriam-Webster listed it as a trending slang term within five weeks; Collins named it Word of the Year 2025 [source: https://en.wikipedia.org/wiki/Vibe_coding]. The term retro-fit a category of tools that had been emerging since mid-2024 — tools where you never open a terminal, never `npm install`, never see a file tree unless you ask. Bolt.new shipped Oct 2024, Lovable (formerly GPT Engineer) rebranded Nov 2024, v0 had been around since late 2023, Replit Agent launched Sept 2024.

By mid-2026 the category is mature enough that the leaders are a clear set of five, with Replit Agent and Lovable defining the "full app" end and v0 defining the "single component" end. Same.dev occupies a narrower clone-a-site niche. Combined ARR across the top three is north of half a billion dollars and growing triple-digit percent year-over-year — Lovable alone reportedly hit $200M ARR within twelve months of its rebrand [source: https://aifundingtracker.com/lovable-vibe-coding-revenue/].

These are eri's *nearest* competitors on the **voice → preview** loop. Not because they support voice (most don't, well) but because their UX paradigm is the same one eri uses: *the preview is the primary surface, the code is secondary*. That's a deep architectural alignment, and a deep competitive risk.

---

## 1. Replit Agent

### What it is
A natural-language-driven build-and-deploy environment layered on top of Replit's long-running browser IDE and hosting platform. You describe an app, Agent scaffolds it, then iterates with you through a chat side-panel while the project runs in Replit's Linux container — a real VM in the cloud, not a sandbox in your tab. Agent 3 (current release as of Q1 2026) can run autonomously for up to ~200 minutes, generates its own Playwright-style browser tests, and reports defects it finds against the running app before fixing them [source: https://replit.com/products/agent]. A new pro-prosumer tier shipped February 2026 [source: https://hackceleration.com/replit-review/].

### Pricing (2026)
- **Starter** — free, limited daily Agent credits, one published app, "limited" Agent intelligence
- **Core** — $20/mo, includes ~$25/mo in usage credits (6-month expiry), full Agent access, up to 5 collaborators
- **Pro** — $100/mo, ~15 builders, pooled credits, tiered usage pricing, one-month credit rollover; replaced the older "Teams" tier on Feb 20 2026
- **Enterprise** — custom

Reported real-world bills show ~$0.25 per Agent checkpoint and ~$0.05 per Assistant checkpoint; a heavy user logged 632 Agent checkpoints in one period = $158, plus $48 of Assistant = $206 just in checkpoint charges on top of subscription [source: https://checkthat.ai/brands/replit/pricing]. This is the loudest pricing complaint in the category: "effort-based" marketing, fixed-rate-per-checkpoint reality.

### Underlying stack & model
Replit Agent runs on **Anthropic Claude** (3.5 Sonnet at the platform's pivotal v2 launch; presumed upgraded to current Claude generation through Vertex AI by 2026). Replit's president Michele Catasta has stated publicly that they picked Claude because "the vast majority of what the agent does is code-based, and Claude is by far the best model available" [source: https://claude.com/customers/replit]. Generated projects can target 50+ languages — Python, Node/TS, Go, Rust, Java — but the Agent-built path optimises for Node/Vite/React with a Postgres-backed Replit-managed database, plus Replit Auth and Replit Hosting baked in [source: https://till-freitag.com/en/blog/replit-2026-platform-en].

### Streaming UX
Two panes. Left: chat with Agent, which streams a plan (numbered steps), then streams file-by-file diffs as it writes, then narrates terminal commands as it runs them. Right: live preview iframe of the running app, automatically reloading whenever Agent restarts the dev server. Long autonomous runs ("extended thinking" + "high-power models" toggles) show a collapsing progress log. Agent 3 surfaces a *defects panel* — defects it found via its own browser-driven smoke test before you saw them — and you can accept-all or step through fixes one by one.

### Deployment story
This is Replit's structural advantage. The thing you're building **is already deployed** the entire time. Every Replit project has a public URL the moment Agent scaffolds it; "Publish" promotes it from preview to production hosting, adds a custom domain if you want, and attaches the managed Postgres / Auth / object storage. No GitHub repo required, no Vercel/Netlify hand-off, no CI/CD config. For mobile, Replit added an Expo path that produces an installable PWA or a wrapped iOS/Android build [source: https://replit.com/products/agent].

### Strengths
- **Real container, not sandbox** — anything that runs on Linux runs here: Python ML libraries, native deps, background workers, cron, sockets. None of the WebContainer restrictions Bolt has.
- **Owns the whole stack vertically** — DB, auth, hosting, monitoring, secrets, custom domains. Zero integration choreography for the user.
- **Best autonomy** — Agent 3's self-test loop is genuinely useful and ahead of competitors in this dimension as of mid-2026.
- **Polyglot** — only tool in this list comfortable building a Python/FastAPI backend or a Go service.

### Weaknesses
- **Slowest TTFP (time-to-first-preview)** — boot-a-container latency is higher than Lovable/Bolt's WebContainer hot-start.
- **Credit anxiety** — the checkpoint pricing model creates the most user-reported "I burned $200 in a weekend" stories of any tool in the category [source: https://checkthat.ai/brands/replit/pricing].
- **Steeper surface area** — file tree, shell, package manager, deployment settings are all visible by default. Non-coders bounce off this even though Agent papers over them.
- **Bug loops** — pre-Agent-3 reports of "Agent introduces bug, fixes wrong thing, charges another checkpoint" persist anecdotally even in Agent 3 [source: https://lovable.dev/guides/bolt-vs-replit-vs-lovable].

---

## 2. Lovable (formerly GPT Engineer)

### What it is
Probably the cleanest expression of "vibe coding" as a product. Lovable is a single chat box on a marketing-quality page. You type a prompt, you watch a React + Tailwind + Supabase app assemble itself in a live preview on the right, you keep chatting until it does what you want, you click Publish and it goes live on a `*.lovable.app` subdomain (or your own domain). The brand-new "Chat Mode" agent (Lovable 2.0, Feb 2026) doesn't touch code — it just reasons, queries the DB, reads logs, and answers questions [source: https://lovable.dev/blog/lovable-2-0].

### Pricing (2026)
- **Free** — 5 daily credits, public projects only
- **Pro** — $25/mo, 100 monthly credits
- **Business** — $50/mo, SSO, team workspace
- **Enterprise** — custom

Credits are the single biggest source of user pain. Users routinely report burning 60–150 credits chasing a single layout bug or fighting a hallucinated Supabase RLS policy, and the free tier's 5/day is reportedly exhausted in ~3 chat turns [source: https://www.taskade.com/blog/lovable-review].

### Underlying stack & model
Lovable scaffolds **React + Vite + Tailwind + shadcn/ui** on the frontend and **Supabase** (Postgres + Auth + Storage + Edge Functions) on the backend. The model layer is undisclosed in detail but observed behaviour is consistent with Claude-class models with retrieval over the project's own code. It is opinionated to the point of inflexibility: there is no "use Next.js instead" or "use MySQL instead." The opinion is the product.

### Streaming UX
Chat on the left, live preview iframe on the right. As the agent works, you see a streamed "task list" — *Setting up auth*, *Creating users table*, *Building the dashboard component* — each item flipping from spinner to checkmark. File diffs are tucked behind a collapsed "code" view; the default surface is the running app, not the code. "Visual Edits" lets you click any element in the preview and edit its CSS with a sidebar [source: https://lovable.dev/blog/lovable-2-0]. This is the most committed "preview is the product" UX in the category.

### Deployment story
One click. Publishing pushes the built app to Lovable's own CDN-backed hosting under `*.lovable.app`. Custom domains are purchasable inside the product. The Supabase project is real Supabase — you can connect to it externally with the project's API URL and anon key, run SQL in the Supabase console, and continue developing in Cursor or Claude Code if you want to exit the vibe-coding lane.

### Strengths
- **Fastest credible TTFP** — twenty seconds from blank page to "I can click a working signup form."
- **Strongest non-developer UX** — the chat is the only thing they have to learn.
- **Vertical stack lock** — React/Supabase is a defensible, popular, well-documented combination; the AI is fluent in it because everyone has written tutorials about it.
- **Growth signal** — fastest ARR ramp in European startup history [source: https://aitoolanalysis.com/lovable-review/]. Whatever they're doing on UX, the market is voting for it loudly.

### Weaknesses
- **Greenfield only** — Lovable struggles to import or refactor anything significant from an existing repo.
- **Backend ceiling** — Supabase Edge Functions are the only backend story. Anything that needs a long-running Python worker, a queue, or a non-Postgres DB requires leaving the product.
- **Credit burn on complex bugs** — the same agent that nails a simple landing page can spiral on a moderately complex state bug, eating credits while it fights itself [source: https://www.taskade.com/blog/lovable-review].
- **RLS footguns** — auto-generated Supabase row-level-security policies are often subtly wrong, leaking data or blocking legitimate access [source: https://lovable.dev/guides/bolt-vs-replit-vs-lovable].

---

## 3. v0 by Vercel

### What it is
v0 started in late 2023 as a *single-component* generator — describe a UI, get a self-contained React snippet using shadcn/ui — and steadily widened its scope. By February 2026, v0 added Git workflows, a VS Code-style integrated editor, database connectivity, agentic multi-step planning, and one-click deploy [source: https://www.nxcode.io/resources/news/v0-by-vercel-complete-guide-2026]. It now sits between "component painter" and "full Next.js app builder," with the Vercel deploy chain as its irreducible advantage.

### Pricing (2026)
- **Free** — $5 of credits monthly, hobby use
- **Premium** — $20/mo
- **Team** — $30/user/mo
- **Business** — $100/user/mo
- **Enterprise** — custom

In Feb 2026 v0 switched from fixed credit counts to **token-based pricing** with three model tiers, so cost-per-generation now depends on which underlying model you route to and how complex the request is [source: https://uibakery.io/blog/vercel-v0-pricing-explained-what-you-get-and-how-it-compares].

### Underlying stack & model
**Next.js + React + Tailwind + shadcn/ui**, with optional Drizzle/Prisma + Vercel Postgres/Neon when you ask for a DB. Underlying model layer is undisclosed but multi-tier (lite/standard/heavy) and consistent with frontier models routed behind Vercel AI Gateway. Notably, v0's *generative UI* technique — streaming React Server Components from the LLM rather than streaming text — was open-sourced as Vercel AI SDK 3.0 and is now industry standard [source: https://vercel.com/blog/ai-sdk-3-generative-ui].

### Streaming UX
v0 has the most visually distinctive streaming UX of the category. Components don't appear after generation completes — they progressively materialise in the preview pane as the React tree streams in. You see the skeleton header → then the nav links populate → then the hero text fades in → then the card grid lays itself out. This is technically streaming RSC payloads rendered live. It feels less like "AI writing code" and more like "AI painting an app." When you ask for changes, only the touched components re-stream; the rest of the preview stays mounted.

### Deployment story
Inside the Vercel walled garden, deploy is one button and you're on the Vercel edge network with their preview URLs, branch previews, environment variables, analytics, observability, and AI Gateway billing already wired. Outside the garden — exporting code, running locally, deploying elsewhere — is supported (it's just Next.js, after all) but undermines the value prop.

### Strengths
- **Highest code quality** — v0 generates the cleanest, most idiomatic React/Next.js/Tailwind output of any tool in the category by broad reviewer consensus [source: https://www.nxcode.io/resources/news/v0-by-vercel-complete-guide-2026].
- **Streaming UI is best in class** — the RSC-streamed preview is genuinely faster to *feel* than any competitor.
- **Deploy is invisible** — for Vercel customers this is the lowest-friction prompt-to-production path in the world.
- **Ecosystem leverage** — shadcn registry, AI SDK, AI Gateway all interlock. Hard for a non-Vercel competitor to match.

### Weaknesses
- **UI-biased** — v0 excels at landing pages, dashboards, and component-level work but still defers to external tools for substantial backend logic, auth, and complex DB schemas [source: https://www.nxcode.io/resources/news/v0-by-vercel-complete-guide-2026].
- **Next.js-only** — if you want Vite, Remix, Astro, or anything non-React, v0 is not for you.
- **Walled garden** — value collapses outside the Vercel ecosystem.
- **Token pricing opacity** — the Feb 2026 switch made cost-per-request hard to predict for non-power-users.

---

## 4. Bolt.new (StackBlitz)

### What it is
StackBlitz's WebContainer technology — a full Node.js runtime running entirely in your browser tab via WASM — was the technical prerequisite for Bolt.new. The product wraps WebContainers in a chat agent that can install npm packages, run the dev server, execute build commands, and even hit external APIs from a sandbox that lives entirely client-side. Open-sourced as `bolt.diy`; commercial product hosted at bolt.new [source: https://github.com/stackblitz/bolt.new].

### Pricing (2026)
- **Free** — limited daily tokens, public projects
- **Pro** — ~$20–25/mo (sources differ; pricing page authoritative)
- Higher tiers exist for teams and enterprise

Token-based pricing: a single landing page might be 50K–100K tokens; a multi-page app with DB and auth, 500K–2M tokens during initial build, more per iteration [source: https://blog.vibecoder.me/bolt-new-complete-guide].

### Underlying stack & model
**Anthropic Claude** is the primary model ("Bolt AI is powered by Claude and other major LLMs") [source: https://capacity.so/blog/what-is-bolt-new]. Scaffolds default to React/Vite or Next.js + Node + Tailwind + Postgres (or SQLite for in-browser dev). The whole stack must be runnable in WebContainer constraints — pure JS/TS, no native deps.

### Streaming UX
Three-pane layout: file tree (collapsed by default), code editor, live preview. The chat side-panel narrates the agent's plan and streams diffs into the editor. Because the WebContainer is right there, you watch `npm install` actually run, you see the dev server start, you see Vite HMR fire when the agent edits a component. This is the most *transparent* streaming UX in the category — it doesn't hide that this is a real dev environment, it just makes the agent the primary user of it.

### Deployment story
One-click deploy to **Netlify** is the headline integration; Bolt + Netlify announced crossing 1 million AI-generated sites deployed in 2025 [source: https://www.netlify.com/press/bolt-netlify-1-million-ai-generated-websites/]. By default new projects deploy to Bolt's own hosting; you can opt into Netlify per-project [source: https://support.bolt.new/building/deploy]. Static assets to CDN, serverless functions for any server-side bits.

### Strengths
- **Most transparent dev environment** — power users can drop into the file tree, edit code by hand, see exactly what the agent did, intervene at any layer. No black box.
- **Zero-latency preview** — WebContainer means the dev server is in your tab, no round-trip to a cloud VM. HMR is genuinely instant.
- **Open source flank** — bolt.diy lets self-hosters run the same UX against any model. This is unusual in the category and partially protects against frontier-lab competition.
- **Strong default stack** — Vite + React is the modern default; many devs prefer this over Lovable's opinionated stack.

### Weaknesses
- **WebContainer limits** — no native dependencies, no Python, doesn't work reliably on Safari or many mobile browsers, anything needing C extensions is out [source: https://www.nxcode.io/resources/news/bolt-new-vs-lovable-2026].
- **JS-only backend** — Node/serverless only. No Go, no Rust, no Python.
- **Generated dependencies are noisy** — reviewers consistently flag that Bolt-generated projects bloat their `package.json` with unused libs [source: https://lovable.dev/guides/bolt-vs-replit-vs-lovable].
- **Default styling less polished than Lovable's** — works fine, doesn't look as nice out of the box.

---

## 5. Same.dev / Same.new

### What it is
Y Combinator-backed niche tool. You paste any public URL; Same scrapes it and rebuilds a pixel-similar React/Tailwind clone you can fork and customise. Chat agent helps you modify the clone. Output auto-deploys to Netlify [source: https://app.daily.dev/posts/ai-powered-website-cloning-with-same-dev-4ihm6oq9h]. Same is less "build an app from a prompt" and more "build an app from a reference."

### Pricing
Lightweight free tier with credit-gated paid tiers; pricing not as well-documented publicly as the other four because Same is meaningfully smaller in usage and revenue.

### Underlying stack & model
Frontend-only output: React + Tailwind, no backend, no DB, no auth. The agent layer is undisclosed but consistent with frontier visual-language models capable of layout interpretation from screenshots.

### Streaming UX
Paste a URL → see Same crawl the target → watch its clone appear in the right pane component-by-component → chat with the agent to modify. The crawl/clone phase is what's distinctive; everything after is conventional.

### Deployment story
Auto-deploy to Netlify on every save. Free public URL. No custom backend wiring because there is no backend.

### Strengths
- **Best-in-class clone fidelity** — when you want to start from a reference rather than a prompt, Same is the sharpest tool for that.
- **YC pedigree + focused scope** — does one thing well.
- **Auto-Netlify** — frictionless publish.

### Weaknesses
- **Frontend-only** — no backend generation, no DB, no auth. Output is starter code, not an app [source: https://app.daily.dev/posts/ai-powered-website-cloning-with-same-dev-4ihm6oq9h].
- **Legal/ethical surface area** — Netcraft has flagged Same as a vector for automated brand impersonation and phishing at scale, which is a real risk to the product's long-term standing [source: https://www.netcraft.com/blog/same-automated-impersonation-for-all].
- **Narrow** — Same's category is "clone a thing." Lovable and Bolt can also clone if shown a screenshot. Same's moat is shrinking.

---

## Cross-cutting analysis

### What this category does that IDE-shaped tools can't — the deploy-ability moat

Cursor, Windsurf, Claude Code, and every other IDE-shaped competitor stop at "you have working code on your laptop." Lovable, Bolt, v0, Replit, Same all stop at "your friend can click a URL right now and use the thing you just thought of." That gap — *from working code to working URL* — is enormous in user-perceived value, and it's the structural reason this category has compounded faster than the IDE category despite (or because of) being less powerful at the code-craft layer.

The deploy moat compounds in several ways:

1. **Onboarding loop closes in one session.** A non-developer types a prompt at 9pm, has a URL at 9:15pm, sends it to their cofounder at 9:16pm. The product proves itself the first time.
2. **Shareable artefacts become marketing.** Every Lovable subdomain, every Bolt-on-Netlify URL, every Vercel preview link is implicit advertising. Cursor outputs have no such footprint.
3. **Pricing scales with hosting, not seats.** Replit, Lovable, and Vercel earn revenue from hosting workloads after the build is done — a per-app annuity Cursor structurally cannot have.
4. **Lock-in via running infra.** Once a Lovable app has real users, migrating it out of Lovable's Supabase project is friction users won't bother with.

This moat is what eri must respect even though eri is fundamentally an IDE-shaped product. We have to *narrow* the gap aggressively — see "What eri can borrow," below.

### "Preview as the primary surface" — eri's structural similarity

The defining UX bet of this category is that **the running app, not the source code, is the thing the human is looking at most of the time.** Lovable hides the file tree by default. v0 streams components into a preview that updates faster than the code panel could. Bolt's default layout still gives most of the screen to the preview. Replit Agent's chat panel is narrow; the preview pane is wide.

eri makes the same bet, for a different reason — *because the human's mouth and eyes are the input devices, not their hands on a keyboard.* When someone is dictating and looking, they need a visual target to dictate *toward*. A file tree is not that target. A live, running, manipulable preview is.

This is the deepest UX alignment between eri and this category. It is also a fight we must win on different terms — see below.

### Where these tools cap out

Across all five tools, the failure modes converge on the same set of problems:

- **Complex multi-file refactors.** All of these tools shine on greenfield. Reviewers consistently report they fall apart when asked to make a coordinated change across 20+ existing files, particularly when those files have interdependencies the agent didn't author [source: https://lovable.dev/guides/bolt-vs-replit-vs-lovable].
- **Stateful systems.** Anything with non-trivial state — queues, background jobs, websockets at scale, distributed coordination — exceeds the scaffolds these tools default to. The single-process, single-DB, request/response model is built deep into the templates.
- **Performance work.** None of these tools profile generated code. None of them notice when their generation creates an N+1, a render-thrash, or a memory leak.
- **Integrations beyond the happy path.** Stripe, OAuth providers, third-party SaaS APIs — generated integrations usually work for the demo flow and break the first time a user does something off-script [source: https://lovable.dev/guides/bolt-vs-replit-vs-lovable].
- **Migration off the platform.** Lovable to a different host. Replit to AWS. v0 to non-Next.js. Same to a real app. All advertised, all painful in practice.
- **Existing codebases.** The single biggest cap. None of these tools meaningfully edit existing repos. They are greenfield generators with a "save" button.

That last point is critical. **Cursor is the dominant tool for existing codebases. Lovable/Bolt/v0/Replit are dominant tools for greenfield.** No browser-shaped product has cracked the existing-codebase problem yet. This is where eri can attack — see below.

### What eri can borrow

Concrete patterns from this category that should land in eri:

1. **Preview-as-canvas pattern.** Make the running app the largest pane by default. Code is a drawer. The user is looking at their app, not their code.
2. **Streamed structural rendering.** v0's RSC-streamed preview is technically remarkable and emotionally satisfying. eri's diffusion-edit step should *paint* changes into the preview the same way — not flicker, not full-reload, but progressively materialise.
3. **One-prominent-button deploy.** Lovable, Bolt, v0, Replit, Same — *all five* have a deploy button at the top-right of the canvas. eri should too, even though we're a local-first IDE. A "share this state of my code as a running app" button removes Cursor-grade friction and steals their party trick.
4. **Shareable preview URLs.** Every change should be capable of producing an ephemeral preview link the user can text to a friend. The link is the marketing.
5. **Plan → checklist streaming.** Lovable's streamed task list — *Setting up auth ✓, Creating users table ✓, Building dashboard ⟳* — is the right granularity for non-technical observability into a long agent run. eri's voice-driven loops should narrate themselves at this level.
6. **Visual edits.** Lovable 2.0's click-and-edit-CSS pattern is a powerful complement to voice. Look at element, say "make it bigger and red." Gaze + voice should make this dramatically faster than Lovable's mouse-driven version.
7. **Defects panel.** Replit Agent 3's *self-test-then-report* loop is the right pattern for autonomy. eri should ship an analogous "things I noticed about your code that you didn't ask me about" surface.

### Where eri wins

We don't win by being a better Lovable. We win by being the first tool that *combines this category's preview-first UX with Cursor's existing-codebase competence*, and doing it with voice + gaze as the primary interaction mode.

Specifically:

1. **Existing codebases.** None of the five competitors can meaningfully edit a 100k-line existing repository. eri can, by inheriting the index/retrieval discipline of the IDE-shaped tools and the preview-first surface of the browser-shaped tools.
2. **Voice + gaze ergonomics.** Lovable's chat box assumes hands on the keyboard. Same with Bolt, v0, Replit. eri assumes mouth and eyes. The interaction bandwidth is meaningfully different — you can dictate while pointing at the thing you mean, which is a thing none of these tools support and which radically reduces the verbal precision required to express an edit.
3. **Diffusion-style structural edits.** The competitor pattern is *token-by-token streaming generation of new files*. eri can do *parallel structural rewrites of existing files* — which is the operation the competitors structurally cannot do, because their UX assumes the AI is the author of every line.
4. **Local-first + private codebase.** Lovable/Bolt/v0/Replit all require you to send your codebase to their servers. For real companies with real IP, this is a non-starter. eri running locally with privacy-preserving inference for the sensitive paths is a deliverable competitive advantage.
5. **Adaptive, predictive collaboration.** The competitors' agents are *reactive* — wait for prompt, respond. eri's runtime spine can be *anticipatory* — notice gaze patterns, dictation pauses, file-switch sequences, and predict the next likely move before the user articulates it. The category leaders haven't even tried this.
6. **No credit anxiety.** The single loudest complaint across Lovable, Bolt, v0, and Replit is *credit burn*. eri's pricing model (paid wrap on diffusion gen, local for everything else) lets us undercut their per-operation cost dramatically while delivering more determinism.
7. **No greenfield bias.** Their default user is starting from nothing. Our default user has a job, a repo, and a deadline.

### The asymmetric threat

The one thing to take seriously: **the browser-shaped tools are getting incrementally better at editing existing code each quarter.** v0's Git integration (Feb 2026) is the first credible attempt by a browser-shaped tool at the existing-repo problem. Replit Agent 3's autonomous test loop is moving into territory that genuinely competes with Cursor on quality, not just convenience. If a Lovable or a v0 or a Bolt cracks the "import my existing repo and feel native in it" problem before eri ships the preview-first surface and shareable deploys, the window closes. Six to twelve months.

---

## Quick comparison table

| Tool | Stack | Model | Deploy target | Edits existing repos? | Pricing entry | Greatest strength | Greatest weakness |
|---|---|---|---|---|---|---|---|
| **Replit Agent** | Linux container, polyglot (Node/Python/Go/Rust default) | Claude (Vertex AI) | Replit Hosting + custom domain | Partial (single project, not import) | Free → $20 → $100 | Real VM, owns full stack | Credit anxiety, slowest TTFP |
| **Lovable** | React + Vite + shadcn + Supabase | Frontier (undisclosed) | Lovable subdomain / custom domain | No | Free → $25 → $50 | Cleanest non-dev UX, fastest growth | Backend ceiling, RLS footguns |
| **v0** | Next.js + Tailwind + shadcn | Multi-tier (undisclosed, Vercel-routed) | Vercel | Partial (Feb 2026 Git integration) | Free → $20 → $30/seat | Best code quality, streamed RSC preview | UI-biased, Next.js-only |
| **Bolt.new** | Vite/Next + Tailwind + Node | Claude (+ others) | Netlify / Bolt Hosting | No | Free → ~$20 | Most transparent, instant HMR | WebContainer limits, no native deps |
| **Same.dev** | React + Tailwind (frontend only) | Frontier visual-language (undisclosed) | Netlify | No | Free + credits | URL-to-clone fidelity | No backend, IP/phishing concerns |
| **eri (positioning)** | Local repos, any stack | Local + paid diffusion wrap | Local + share-link export | **Yes (defining feature)** | Subscription + diffusion metering | Voice + gaze on existing repos | Newer product, no install base |

---

## Sources

- Replit pricing & Agent 3: [hackceleration](https://hackceleration.com/replit-review/), [Replit product page](https://replit.com/products/agent), [Replit pricing](https://replit.com/pricing), [checkthat.ai breakdown](https://checkthat.ai/brands/replit/pricing), [Till Freitag platform review](https://till-freitag.com/en/blog/replit-2026-platform-en), [Anthropic customer case study](https://claude.com/customers/replit)
- Lovable: [Lovable 2.0 announcement](https://lovable.dev/blog/lovable-2-0), [Lovable homepage](https://lovable.dev/), [Taskade review](https://www.taskade.com/blog/lovable-review), [AI Tool Analysis review](https://aitoolanalysis.com/lovable-review/), [AI Funding Tracker on ARR](https://aifundingtracker.com/lovable-vibe-coding-revenue/), [Lovable's own comparison page](https://lovable.dev/guides/bolt-vs-replit-vs-lovable)
- v0: [nxcode 2026 guide](https://www.nxcode.io/resources/news/v0-by-vercel-complete-guide-2026), [UI Bakery pricing breakdown](https://uibakery.io/blog/vercel-v0-pricing-explained-what-you-get-and-how-it-compares), [Vercel AI SDK 3.0 announcement](https://vercel.com/blog/ai-sdk-3-generative-ui), [shadcn/v0 docs](https://ui.shadcn.com/docs/v0)
- Bolt.new: [Bolt pricing](https://bolt.new/pricing), [bolt.new repo](https://github.com/stackblitz/bolt.new), [Netlify press](https://www.netlify.com/press/bolt-netlify-1-million-ai-generated-websites/), [Bolt deploy docs](https://support.bolt.new/building/deploy), [Capacity guide](https://capacity.so/blog/what-is-bolt-new), [VibeCoder blog](https://blog.vibecoder.me/bolt-new-complete-guide)
- Same.dev: [Same homepage](https://same.new/), [daily.dev coverage](https://app.daily.dev/posts/ai-powered-website-cloning-with-same-dev-4ihm6oq9h), [Netcraft on misuse](https://www.netcraft.com/blog/same-automated-impersonation-for-all)
- Category framing: [Wikipedia: Vibe coding](https://en.wikipedia.org/wiki/Vibe_coding), [Simon Willison on vibe coding](https://simonwillison.net/2025/Mar/19/vibe-coding/), [Google Cloud explainer](https://cloud.google.com/discover/what-is-vibe-coding)
