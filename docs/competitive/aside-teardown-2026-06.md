# Aside — competitive teardown (2026-06-25)

> Y Combinator-backed AI browser, launched this week. Tagline:
> **"The most intelligent AI assistant, but it's a browser."**
> Positioning: *"a browser rebuilt for people and agents"* / *"the operating
> system for the AI era."* Source: aside.com + feature/pricing pages.

This is the closest thing to a direct competitor we've seen: same instinct
(an agent that does real work on real accounts), same trust vocabulary
(local-first, audit log, human-at-the-edge). The difference that matters:
**Aside is a browser. eri is the whole machine.** Everything below is what
they can do; the last section is what we take, match, and beat.

---

## 1. Everything Aside is capable of (full capability list)

### Browser agent ("a state-of-the-art agent that lives in your browser")
- **"Unlimited capability"** — anything doable in a browser, across the sites
  you're already logged into, **with no integrations** (it drives the real UI).
- Works inside **email, dashboards, internal tools, docs, spreadsheets**.
- **Signs in for you** across email/dashboards/internal tools (via its own
  password manager, below).
- Handles **"comments, replies, and follow-ups."**
- **"Works with files directly on your computer"** (local filesystem reach).
- **"Ultrabrowse"** — a deep/extended reasoning mode: *"pulls the context it
  needs, handles the follow-ups on its own, and keeps working until it's done."*
- **Long-running** — *"keeps going when a task takes minutes or hours."*
- **"Cloud handoff"** — start a task locally, hand it to the cloud to finish
  (Pro+).
- **"Routines"** — saved/repeatable automations (Free: up to 3; Pro: unlimited).
- **Push notifications as a "heartbeat"** — the agent reacts to events and
  **resumes work in real time** when something happens.
- Benchmarks: claims **#1 on three browser-agent benchmarks** —
  Online-Mind2Web (**99.0%** vs Browser Use 97.7%), BU-Bench-v1, Odyssey —
  *"surpassing OpenAI, Anthropic, and Browser Use."* (Their `/sota` page.)

### Memory + "dreaming" (this is their version of our world model)
- **"Memory that knows what you're working on"** — turns **browsing history
  into memory** so you don't repeat context.
- **"Dreaming"** — an automated **post-task consolidation pass**: *"after each
  task, Aside saves what matters"* and *"gets better at your work over time,"*
  extracting key details and consolidating learning. **This is the "dreams"
  feature.**
- Memory types: **episodic** (task-specific), **semantic** (people, companies,
  decisions), **site-specific** (*"the path that worked"* on a given site).
- **Written in markdown, stored on device**, fully **inspectable and editable**
  — *"you can see where it came from. If something is wrong, edit it."*
- Organized into files for episodic events / companies / projects / users /
  agents / sites / concepts, with **timestamps + token-usage history**.

### Password manager ("the first password manager built for agents")
- **Credentials autofilled into sites, never exposed to the agent** — the model
  acts *with* the login but never *sees* the secret.
- **Hardware-backed E2E encryption**, **Secure Enclave**, **post-quantum
  encryption**.
- **Site-level access control** — *"give the agent access only to what each task
  needs."*
- **Audit log of every AI access** — *"what it used, when, and why."*
- **Passwords + passkeys + sessions** as first-class agent tools;
  **one-click migration** from existing managers.
- **"Human approval at the edge"** for sensitive actions.

### Security / privacy posture
- **Local by default** — tasks, memory, data stay on device; *"never shared
  with model providers."*
- **Sandbox with guardrails** — isolates filesystem + network access.
- **Bring your own subscription** — run on your own ChatGPT or Claude (the
  search result and pricing pages disagree on whether BYO is live; treat as
  "claimed").
- Choose the engine (GPT or Claude).

### Design / UX (the "sick window")
- **"Liquid Glass" design**, **vertical tabs**, model picker in-chrome.
- Native desktop app; the polish is a deliberate selling point.

### Pricing (credits-metered, like ours)
| Tier | Price | Includes |
|---|---|---|
| **Free** | $0 | 500 credits/mo, up to 3 routines, password manager, memory |
| **Pro** | $20/mo | 3× credits, Ultrabrowse, unlimited routines, cloud handoff |
| **Max** | $200/mo | 10× Pro credits, early-access program |
| **Enterprise** | contact | seat mgmt, shared-account agents, access controls, support |

### Distribution / company
- YC-backed, launched ~June 2026, active on X (@AsideAI), `/manifesto`,
  `/docs`, `/community`, use-case blogs (operations, HR, sales, developers,
  researchers).

---

## 2. How eri already stacks up (we are not behind)

| Aside | eri today | Gap? |
|---|---|---|
| Browser agent, no integrations | **Whole-computer** control (control wedge, fast-lane actuation, local→Claude escalation) **+** Composio API actions (61 tools) **+** browser as a fallback | eri is *broader*; Aside is browser-bound |
| "Dreaming" memory consolidation | **sia self-improve loop** (observe→propose→admit, MDL acceptance gate) + **world-model graph** (entities, bi-temporal, typo-tolerant recall) + MemoryStore | We have the *architecture*; we lack the **named post-task pass + markdown-inspectable surface** |
| Episodic/semantic/site memory, editable markdown | world-model entities + recall; **not** yet a user-editable markdown memory surface | **Build: inspectable/editable memory UI** |
| Password manager for agents | **control_safety.rs** already refuses to type passwords (boundary) + **action_log.rs** trust layer (history/undo) | We have the *refusal*; we lack the **vault that autofills-without-exposing** |
| Audit log of every access | **action_log.rs** + `eri control --history/--undo` (honest, persisted) | **At parity** |
| Local-by-default | Cloud-pivot: cloud-primary now (muscle = Claude). Different bet. | Intentional divergence |
| Push "heartbeat" | **proactive.rs** ("after X you usually Y") + proactive iMessage loop | **At parity / ahead** (we're cross-device) |
| Ultrabrowse deep mode | `--mode fast\|thinking\|auto` tiered router | At parity |
| "Liquid Glass" UI | overlay (Cluely-pattern), Agent Manager shell, editorial site | At parity, different aesthetic |
| Cloud handoff | phone↔Mac one-brain (Spectrum), cross-device memory | **Ahead** (they hand a task to cloud; we hand the *whole mind* across devices) |

---

## 3. What to actually take (triaged — not "build all of it")

**Our wedge stays: "everything use," not browser use.** Aside is the proof that
the *browser-only* lane is getting crowded and benchmark-maxed; our answer is
the whole machine + phone, which they structurally can't reach from a browser.

Three things worth lifting, in priority order:

1. **Credential vault for the agent (their password manager).** This is the one
   real capability gap. Pattern to copy: **autofill-into-the-app, never expose
   the secret to the model; site-level scoping; every access in the audit log;
   human approval at the edge.** We already own the two hard halves —
   `control_safety.rs` (the refusal boundary) and `action_log.rs` (the audit
   trail). The vault sits between them. This also upgrades our current behavior
   from *"eri refuses to type your password"* to *"eri logs you in without ever
   seeing it,"* which is strictly better and on-brand for visible trust.
   Prohibited-action rules still hold: eri fills via the vault, it does not
   handle plaintext secrets itself.

2. **Name + surface our "dreaming."** We already consolidate (sia loop). Give it
   a name and a **markdown, inspectable, editable memory surface** like theirs
   (*"you can see where it came from; if it's wrong, edit it"*). This is mostly
   a *surfacing* job over the world-model graph, not new brain work — and
   "edit your own memory" is a trust feature we should be loud about.

3. **The window.** Borrow the *polish bar* (Liquid Glass depth, vertical tabs,
   in-chrome model picker), not the look — our aesthetic is editorial, theirs is
   glassy. Worth a dedicated impeccable pass on the Agent Manager shell.

Everything else (routines, BYO subscription, browser benchmarks) we either have
in another form or shouldn't chase — chasing browser-agent leaderboards pulls us
into their lane instead of ours.

---

---

## 4. Build spec — eri credential vault (handoff for another session)

> Goal: close the one real Aside gap. eri logs you into a site **without ever
> seeing the secret**. The model gets a *capability* ("fill the saved password
> here"), never a *value*. This upgrades today's behavior from "eri refuses to
> type your password" → "eri signs you in and never sees the secret," which is
> strictly better and on-brand for visible trust.

### Naming correction (read first)
The user said "password **hashing**." What we actually want is Aside's
capability (autofill-never-expose), and the right way to build it is **not
hand-rolled crypto**. We store the secret in the **macOS Keychain (Secure
Enclave-backed)** — which is exactly what Aside means by "Secure Enclave." We
never implement our own hashing/encryption. (Security rule: never hand-roll
crypto; lean on the OS keystore.)

### Non-negotiable invariant
A saved secret value must NEVER reach: (a) the model's context/prompt, (b) the
`ActionLog` description, (c) any log line, stdout, or the control-server stream.
The value travels exactly one path: **Keychain → bridge fill → OS input field.**
Everything else sees only a *reference* (`vault:github.com/password`).

### Where it lives
- New module **`crates/eri_cli/src/credential_vault.rs`** (matches the existing
  `control_safety.rs` / `action_log.rs` module pattern; extractable to an
  `eri_vault` crate later if we want a smaller audit surface — additive, not now).
- New crates: **`zeroize`** (wipe secrets from memory on drop) and
  **`security-framework`** (macOS Keychain access). Keep the dep surface tiny.

### Types (sketch — TDD these)
```rust
/// A secret value that never prints and never serializes. Zeroized on drop.
pub struct Secret(/* zeroize::Zeroizing<String> */);
//   - Debug/Display render "Secret(***)"; no Serialize impl at all.

/// Where the secret actually lives. Trait so tests use an in-memory fake and
/// prod uses the Keychain (Secure Enclave) — repository pattern.
pub trait SecretStore: Send + Sync {
    fn get(&self, secret_ref: &str) -> anyhow::Result<Secret>;
    fn put(&self, secret_ref: &str, secret: Secret) -> anyhow::Result<()>;
    fn delete(&self, secret_ref: &str) -> anyhow::Result<()>;
}
pub struct KeychainStore; // macOS impl via security-framework
pub struct InMemoryStore;  // tests only

/// Vault metadata (NO secret values) — this is the only thing persisted to disk.
#[derive(Serialize, Deserialize)]
pub struct CredentialEntry {
    pub id: String,
    pub origin: String,      // "github.com" or a native bundle id
    pub username: String,    // not secret; shown in approval prompt
    pub secret_ref: String,  // Keychain key, e.g. "eri/vault/github.com"
    pub created: String,
    pub last_used: Option<String>,
}

pub enum CredentialField { Username, Password, Totp }

pub enum FillOutcome {
    Filled,                  // value went Keychain → bridge, never returned up
    NeedsApproval(String),   // first use on this origin — prompt the user
    OriginMismatch,          // current origin != entry.origin → refuse (anti-phish)
    NoMatch,                 // no saved credential here → fall through to handback
}
```

### The clean integration (no gate rewrite)
1. **New actuation intent, no secret in it.** Add
   `ControlAction::FillCredential { field: CredentialField }` to the
   `ControlAction` enum (`control_agent.rs`). The model emits THIS to log in;
   it never emits `Type("hunter2")`. Undo plan = `Irreversible("filled a saved
   credential")` in `action_log.rs::undo_plan_for` (keep it total).
2. **Actuator routes it through the vault.** At the actuation match in
   `control_agent.rs` (~line 693, beside `ControlAction::Type(s) =>
   bridge.type_text(s)`), add:
   `ControlAction::FillCredential { field } => vault.fill(current_origin, field, &bridge).await`.
   `fill()` resolves the entry by origin, fetches the `Secret` from the
   `SecretStore`, and calls a **new bridge method `fill_secret(Secret)`** that
   types/pastes into the focused field. The `Secret` is consumed inside
   `fill_secret` and dropped (zeroized); it is never returned, logged, or
   stringified.
3. **The boundary stays exactly as-is.** A model-originated
   `ControlAction::Type(secret_text)` still hits
   `control_safety::classify_refusal` → `Decision::Refuse(Credential)` →
   `Disposition::Refused(handback)` (`control_agent.rs:538`,
   `control_envelope.rs:62`). The ONLY way a secret is ever entered is the
   explicit `FillCredential` path over a saved, origin-matched entry. If the
   vault has `NoMatch`, eri falls through to the existing hand-back message — so
   nothing regresses.

### Human approval at the edge (reuse what exists)
- Add `Permission::UseCredentials` to `control_safety::Permission` (the existing
  y / always / N allowlist + `PermissionStore`). First fill on an origin →
  prompt: *"Sign you into github.com as you@email with your saved password?
  [y / always for this site / N]."* "always" persists a per-origin grant.
- Per-origin grants: extend `PermissionStore` with an `allowed_credential_origins:
  BTreeSet<String>` (mirror the existing `denied_apps` field exactly, incl.
  `#[serde(default)]` so old permission files still load).

### Site-level access control + audit (Aside parity)
- **Origin match is mandatory** before any fill (`FillOutcome::OriginMismatch`
  if the frontmost origin ≠ `entry.origin`). This is the anti-phishing guard —
  a look-alike page can't harvest a saved login.
- **Audit every access.** Record each fill in the `ActionLog` as
  `"filled saved password for github.com"` (origin + field + task, **never the
  value**). This is already the trust surface read by `eri control --history`.
  Optionally add a dedicated `credential_access` flag on `ActionRecord` so the
  history view can show a key glyph.

### Phasing (each lands green, TDD, per finish-what-you-start)
- **P0** username + password fill on a matched browser origin; Keychain store;
  per-origin approval; audit line. `InMemoryStore` for tests.
- **P1** passkeys / WebAuthn and TOTP (`CredentialField::Totp` generating the
  code from a Keychain-stored seed — still never shown to the model).
- **P2** one-click import from an existing manager; a small `eri vault` CLI
  surface (`list` / `forget <origin>`), values never printed.

### Test plan (write first)
- `secret_never_prints_or_serializes` — `format!("{s:?}")` == "Secret(***)";
  assert no `Serialize` (compile-fail doctest or a wrapper test).
- `fill_requires_origin_match` — entry for github.com, current origin evil.com →
  `OriginMismatch`, no store read.
- `first_use_needs_approval_then_persists` — first fill → `NeedsApproval`; after
  "always", `PermissionStore` round-trips the origin grant.
- `model_dictated_secret_still_refused` — `classify_refusal("type my password
  hunter2")` still `Refuse(Credential)`; vault path not taken.
- `audit_records_fill_without_value` — after a fill, the `ActionLog` trail
  contains the origin and "password" but NOT the secret.
- `fill_outcome_nomatch_falls_through_to_handback` — no saved entry → existing
  refusal hand-back, unchanged.

### Acceptance
eri can sign into a saved site hands-free; the secret never appears in the
model context, the action log, or any stream; first use asks once per origin;
a mismatched origin refuses; the existing refusal boundary for dictated secrets
is untouched. Workspace green.

---

## Sources
- https://aside.com/ — homepage / positioning
- https://aside.com/features/browser-agent — agent capabilities, Ultrabrowse
- https://aside.com/features/memory — memory types + "dreaming"
- https://aside.com/features/password-manager — agent password manager
- https://aside.com/pricing — tiers
- https://www.ycombinator.com/companies/aside — YC profile
- https://ahmedatoui.com/en/news/aside-ai-browser-launch — launch writeup
