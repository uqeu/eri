# eri prompt hygiene

Two non-negotiable rules. Future agents (and Khai) read this before
touching anything that changes how text flows through eri.

---

## Rule 1 — caveman is for outbound prompts only, NEVER user voice

`eri_caveman` is the prose compressor we wrote to cut tokens on LLM-bound
text. It works by stripping fillers, articles, and weak verbs. Aggressive
mode hits ~24% compression on system prompts.

**Where caveman MUST be applied:**
- `SYSTEM_PROMPT` / `SURGICAL_SYSTEM_PROMPT` and other static `&'static str` system blocks
- Polish briefs and ship-it prompts sent to Claude Code CLI (`build_polish_prompt`, `build_ship_it_prompt_with_target`)
- Integration prompts (`build_auth0_setup_prompt`, etc.)
- Recap/handoff blocks sent between agents
- Bug-finder prompts to Claude

**Where caveman MUST NOT touch the text:**
- The user's spoken transcript (`VoiceEvent::Final`, `VoiceEvent::Partial`)
- The user's typed prompt in the panel
- Mercury tool-call arguments (structured, lossless required)
- HTML / CSS / JS / any code
- Any text the user will hear played back through TTS (they want to hear their own meaning)
- `ControlCommand::parse` input
- Discord/Slack bot user prompts before they enter Mercury

**Why:** the user's words carry intent through deictic markers ("this",
"here", "the", "that one"), agency markers ("me", "you", "we"), and
emphasis ("really", "actually", "just"). Stripping them changes what
the user is targeting or how confidently they want it changed. Mercury
on a stripped prompt becomes Mercury guessing.

**The rule, in code:** caveman is applied at the LLM call site, never at
the input site. Compose the system prompt + user prompt, then compress
only the system prompt portion. Concretely:

```rust
let system_block = Compressor::new(CompressionLevel::Medium).compress(SYSTEM_PROMPT);
let user_block = ctx.transcript().last().cloned().unwrap_or_default();  // verbatim
let messages = vec![
    ChatMessage::system(system_block),
    ChatMessage::user(user_block),  // never compressed
];
```

---

## Rule 2 — voice command parsers accept natural English, never force syntax

eri's voice command parsers (`ControlCommand::parse`,
`ControlCommand::parse_with_selection`) should accept how a human actually
talks, not require a special grammar. If a user says "hey can you build
me like a coffee shop kinda thing" — that's a build, not a syntax error.

**Do:**
- Accept filler + politeness: "please", "could you", "hey", "can you",
  "would you mind", "actually", "like", "kinda", "sorta", "maybe".
- Accept disfluency: "uh", "um", "you know" mid-sentence — strip before
  matching, don't reject.
- Match intent, not phrasing: any phrasing that means "go back" should
  route to `Undo`. Build a table of synonyms (`go back` / `revert` /
  `take it back` / `nope go back` / `that's wrong`) and match by intent.
- Be case-insensitive and punctuation-tolerant by default.

**Don't:**
- Don't reject prompts that contain extra words.
- Don't require an exact phrase ("you must say 'undo'").
- Don't strip the user's actual content while matching the command
  prefix — preserve what they said for Mercury.
- Don't normalize the user's tone — eri's brain replies should match the
  user's energy (casual, formal, hyped, frustrated).

**Why:** voice is the wedge. If the user has to think about syntax,
we've broken the voice contract. The whole point of eri vs Cursor is
that you don't have to type — and not having to type means not having
to phrase your thoughts in a specific way.

---

## Rule 3 — the brain mirrors the user's tone, doesn't enforce its own

The brain sidecar (Llama-3.2-1B) speaks short verbal acks. Its replies
should sound like the user, not like a manager.

- If the user is hyped ("LET'S GO BUILD ME A COFFEE SHOP"), the brain
  replies hyped ("on it, going hard").
- If the user is casual ("yeah uh build a portfolio"), the brain is
  casual ("got it, portfolio coming").
- If the user is frustrated ("just fix the damn thing"), the brain is
  brief and contrite ("fixing now").

Few-shots in `script/eri_brain_sidecar.py` should include these tones.
Don't over-script the brain — let it match.

---

## Enforcement

`script/eri_strategy_check` should grow a check: any new agent that
adds a `Compressor::new(...).compress(...)` call site MUST add it on
the system-block side, never the user-block side. Future bloat audits
look for violations of these rules first.
