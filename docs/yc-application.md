# Eri Labs — YC Fall 2026 Application (paste-ready draft)

Positioning: eri = the AI operating system for a person. "Adaptive personal intelligence
empowering everyone to live smarter, more fulfilled lives." Public copy: never literal "AGI."
**[YOU]** = only Khai can answer. Everything else is paste-ready (edit to taste).

---

## FOUNDERS

**Who writes code / other technical work? Was any done by a non-founder?**
Khai writes and directs all of it, working with AI coding agents (primarily Claude Code) as the
implementation engine. No human non-founders have contributed code — the architecture, the
decisions, and the review are mine; AI agents do much of the implementation under my direction.
That's precisely how a tiny team ships something this broad (a Rust agent harness, a connector
layer, a self-hosted model + fine-tuning pipeline, gaze/voice, web + phone) this fast.

**Are you looking for a cofounder?** [YOU] (yes/no — be honest; solo is fine but YC will ask.)

**Founder video (1 min):** [YOU — must record]. Script below in the Appendix.

### Founder Profile fields — recommendations
- **City:** your real city (Hamilton or Toronto, Canada — the form needs it).
- **Title / main responsibility:** **CEO** (solo technical founder → you're CEO; you can write
  "Founder & CEO"). YC wants one clear CEO.
- **Equity %:** if solo + not yet incorporated, **100%** (the % you expect to hold).
- **Are you a technical founder?** **Yes** (you build the product yourself).
- **Currently in school?** **No** (graduated McMaster Apr 2025).
- **Commit exclusively for the next year?** **Yes** [confirm — this must be a real yes].
- **⚠️ Honour Systems reconciliation:** your email/Twitter are "Honour Systems" and you demo'd
  "Honour Systems" at The Forge in November. Decide the story: is **eri** the evolution/rebrand
  of Honour Systems, or separate? Make it coherent — if eri grew out of Honour Systems, say so
  in the "did you pivot / what did you learn" question (a clean narrative: "Honour Systems
  taught me X → that led to eri"). [YOU — clarify so the app is consistent.]

---

## COMPANY

**Company name:** Eri Labs

**Describe what your company does in 50 characters or less:**
The AI operating system for your life.

**Company URL:** https://tryeri.ca  *(verify)*

**Product link:** https://tryeri.ca  *(+ creds if needed: [YOU])*

**Demo (≤3 min):** [YOU — attach a screen recording: talk to eri hands-free, it reads an email /
checks calendar / acts across apps and answers in its own voice.]

**What is your company going to make?**
Eri is an adaptive personal intelligence — an AI operating system for your life. You wake up,
talk to it, and your day gets mapped and handled. It connects to all your apps and devices,
sees your screen, hears your voice, remembers everything about you, and *does* your digital
work for you across computer and phone — hands-free.

Unlike chatbots and copilots, which hand you a tool you still have to operate, Eri does the
work and reports back in its own voice; you never touch the underlying app. And it's genuinely
*yours*: each person trains their own Eri through everyday use (a per-user fine-tuned model plus
a persistent memory of who you are), so it gets smarter and more personal the more you use it —
your Eri is not the same model as anyone else's.

Under the hood it's a connective intelligence layer over everything you use that monitors,
learns, acts, and self-improves. Most work runs on our own model cheaply; we escalate to a
frontier model only for the hard things. The result is a single brain for your whole life,
not twenty disconnected apps.

**Where do you live now / based after YC?** Hamilton/Toronto, Canada / San Francisco, USA
*(confirm your exact city)*

**Explain your location decision:**
We'll relocate to San Francisco for the batch and the in-person network/intensity; the product
is cloud + on-device, so the team can be based wherever post-batch, but we want to be in SF
during YC. [YOU — adjust to your real plan.]

---

## PROGRESS

**How far along are you?**
Pre-launch (private alpha — honest: not yet public, no users to cite yet). Already built and
working end-to-end:
- **Agentic harness** — Eri CLI + IDE; a tool-using loop with subagents, hooks, permissions.
- **Connectors** — live integration via a hosted tool router (Composio) so Eri reaches a user's
  apps (email, calendar, docs, GitHub, Slack, …) with a flat, token-frugal footprint no matter
  how many apps are connected.
- **Eri's own brain** — a self-hosted model handles most requests cheaply and escalates to a
  frontier model only for hard work (vision always routes to the frontier model). We're
  generating a clean, openly-licensed training corpus now and fine-tuning Eri's own model;
  per-user LoRA personalization is next.
- **Memory** — a bi-temporal, per-user memory engine that learns and recalls who you are.
- **Hands-free** — computer control + calibrated webcam gaze tracking + voice.
- **Cross-device** — phone (iMessage) path; one brain on computer + phone.

**How long have you been working on this / how much full-time?** [YOU — timeline + full-time since when.]

**Tech stack (incl. AI models + AI coding tools):**
- **Core:** a Rust workspace — the agent harness/loop, an MCP client + tool router, an inference
  router, memory, gaze/voice services.
- **Cloud:** Next.js + Supabase (auth, billing, the metered inference proxy, the phone webhook).
- **Connectors:** Composio Tool Router (meta-tool search→schema→execute, so tool-schema tokens
  stay flat as apps are added).
- **Models:** our own self-hosted **Qwen3-32B** (LoRA fine-tuned via Apple **MLX**) as Eri's
  brain; **Claude** as the frontier escalation + all vision reasoning; **Kimi K2.7 Code** and
  local **Qwen2.5-72B / DeepSeek-R1-32B** to *generate* the training corpus (open-licensed,
  never distilling Claude/GPT). Ollama for local serving; MediaPipe + a ridge-regression
  calibrator for gaze.
- **AI coding tools:** Claude Code — this entire codebase is built with it.

**Are people using your product?** No (pre-launch).

**Do you have revenue?** No.

**Same idea as a previous batch / did you pivot?** [YOU — if first application, N/A. We did
refine the surface (IDE shell) but the idea — a personal AI that acts + learns you — has been
consistent.]

**Incubator/accelerator participation?** [YOU — likely No.]

---

## IDEA

**Why this idea? Domain expertise? How do you know people need it?**
I'm a technical founder who can build the whole thing. I did my BS in Math & CS at McMaster,
worked as an ML researcher/engineer at McMaster's BabyLab building a model that cross-references
infants' behavioural + physiological data to flag early neurodevelopmental indicators (alongside
a Canada Research Chair and a PhD student), and have shipped ML systems end-to-end — an LSTM
stock-forecasting engine with candlestick recognition + backtesting, RL game agents, and
FastAPI/Streamlit/Mongo data dashboards. I also led as President of McMaster's Computer Science
Society for two years, running the program and a large exec team — so I can build *and* execute
with people. I went through The Forge's Startup Survivor program and I'm an active member at
Hamilton's Innovation Factory. [YOU — add the personal *itch*: the moment you wished your life
had an operating system; keep it in your voice.]

What I know about the problem: AI just crossed from *answering* to *acting*, but everyone is
still shipping tools — chatbots you operate, copilots bolted onto one app. Nobody is building
the layer that ties a person's whole digital life together and just does it. I've now built the
hard parts (hands-free control, all-app connectors, a memory that learns you, an own-model
architecture that keeps cost low), which convinced me the bottleneck is no longer capability —
it's that no one has made an assistant that acts everywhere and becomes genuinely *yours*.
Everyone I show it to wants the same thing: stop making me operate software — just handle it,
and remember me.

**Competitors? What do you understand that they don't?**
- Chatbots (ChatGPT, Claude apps): you operate them; they don't remember *you*, don't act
  across your tools, aren't hands-free.
- Per-app copilots: locked to one app — your life isn't one app.
- Big assistants (Siri/Alexa/Google): not agentic, don't learn you, locked ecosystems.
What they miss: the value is the **outcome across your whole life**, plus **personalization
that compounds.** The winner does the work, learns the person, and works everywhere — and a
per-user-fine-tuned model + persistent memory is a moat that deepens with every interaction
(your Eri literally can't be cloned).

**How will you make money? How much could you make?**
Consumer subscription for the personal OS. A token-frugal architecture (our own model for the
bulk, frontier model on demand) keeps COGS low and margins healthy. Market = everyone with a
phone and a computer, and the far larger pool of personal tasks/services people pay to
outsource. At consumer-subscription scale this is a multi-billion-dollar revenue opportunity;
"the OS for your life" is a category, not a feature. [YOU — add a concrete estimate if you want.]

**Other ideas you considered:** [YOU — optional.]

---

## EQUITY / CURIOUS / BATCH  (all [YOU])
- Formed a legal entity? · Taken investment? · Currently fundraising? — [YOU]
- What convinced you to apply / YC events attended? — [YOU]
- How did you hear about YC? — [YOU]
- Batch: **Fall 2026**

---

## APPENDIX — 1-minute founder video script (say it naturally, to camera)
"Hi, I'm Khai, founder of Eri Labs. We're building Eri — the AI operating system for your life.
Today you juggle a dozen apps and a dozen chatbots, and you still do all the work yourself.
Eri is different: you just talk to it, hands-free, and it acts across all your apps — reads your
email, checks your calendar, gets things done — and answers in its own voice. The magic is that
it learns *you*: every person trains their own Eri through everyday use, so it gets smarter and
more personal over time. I've already built the hard parts — hands-free control, connections to
all your apps, a memory that learns you, and our own model that keeps it fast and cheap. I want
to give everyone an adaptive personal intelligence that helps them live smarter, more fulfilled
lives. That's Eri." (~55s)
