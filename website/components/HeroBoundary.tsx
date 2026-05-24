// Below-the-fold boundary block for HeroBig.
//
// Three plain-English columns that frame the architectural boundary: what's
// local, what's bundled (vs. metered), and the one thing that leaves the
// machine. Each column gets one concrete proof point — a path, a flag, a
// number — rather than another adjective.

interface LocalProof {
  readonly label: string;
  readonly value: string;
}

const LOCAL_PROOFS: ReadonlyArray<LocalProof> = [
  { label: "Voice transcription", value: "Whisper, in-process" },
  { label: "Gaze tracking", value: "MediaPipe, on-device" },
  { label: "Tab completion", value: "Embedded llama.cpp" },
  { label: "Apply / diff", value: "Local fast-apply" },
  { label: "Semantic index", value: "~/.eri/index.sqlite" },
  { label: "TTS playback", value: "Cached presets, no upload" },
];

interface BundleItem {
  readonly label: string;
  readonly note: string;
}

const BUNDLE_ITEMS: ReadonlyArray<BundleItem> = [
  { label: "Tab completion", note: "Local engine, bundled in subscription" },
  { label: "Diffusion edits", note: "Multi-line patches, one resolve" },
  { label: "Semantic search", note: "Index lives on your disk" },
  { label: "Voice + gaze", note: "Always available, no add-on" },
  { label: "MCP servers", note: "Plug in tools you already trust" },
  { label: "Checkpoints", note: "Rewind any agent turn locally" },
];

export function HeroBoundary(): React.ReactElement {
  return (
    <div className="mt-20 sm:mt-24">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 mb-10">
        <div className="max-w-2xl">
          <p className="mono-cap text-accent">Where the work happens</p>
          <h3
            className="mt-4 font-display text-balance"
            style={{
              fontWeight: 400,
              fontSize: "clamp(1.75rem, 3vw, 2.5rem)",
              lineHeight: 1.05,
              letterSpacing: "-0.025em",
            }}
          >
            One price. Hard cap.{" "}
            <span className="italic text-paper/65">
              No credit pools, no auto-routing surprises, no metered overage.
            </span>
          </h3>
        </div>
        <p className="text-[13px] text-paper/50 font-mono shrink-0 sm:text-right">
          three columns · one boundary
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <article className="rounded-lg border border-white/[0.06] bg-bg-2/60 p-6 flex flex-col">
          <div className="flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-hidden />
            <p className="mono-cap text-paper/55">Local-first</p>
          </div>
          <h4
            className="mt-4 font-display text-2xl text-paper text-balance"
            style={{ fontWeight: 400, letterSpacing: "-0.02em" }}
          >
            The editor does the work on your hardware.
          </h4>
          <p className="mt-3 text-[14px] leading-relaxed text-paper/60">
            Whisper transcribes voice. MediaPipe reads your gaze. An embedded
            inference runtime drives Tab and fast-apply. Your semantic index
            lives on your disk. Nothing in this list ever leaves the machine.
          </p>
          <ul className="mt-5 space-y-2 text-[12px] font-mono text-paper/65">
            {LOCAL_PROOFS.map((row) => (
              <li
                key={row.label}
                className="flex items-start justify-between gap-3"
              >
                <span className="text-paper/45">{row.label}</span>
                <span className="text-paper/80 text-right">{row.value}</span>
              </li>
            ))}
          </ul>
          <div className="mt-auto pt-5">
            <div className="rounded-md border border-white/[0.06] bg-black/30 px-3.5 py-2.5">
              <p className="font-mono text-[11px] text-paper/45">Proof</p>
              <p className="mt-1 font-mono text-[12px] text-paper/85 break-all">
                ~/.eri/index.sqlite
              </p>
            </div>
          </div>
        </article>

        <article className="rounded-lg border border-accent/30 bg-accent/[0.025] p-6 flex flex-col">
          <div className="flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-hidden />
            <p className="mono-cap text-accent">Bundled, not metered</p>
          </div>
          <h4
            className="mt-4 font-display text-2xl text-paper text-balance"
            style={{ fontWeight: 400, letterSpacing: "-0.02em" }}
          >
            Every feature is in the price. There is no second meter.
          </h4>
          <p className="mt-3 text-[14px] leading-relaxed text-paper/65">
            Tab, diffusion edits, semantic search, voice, gaze, MCP,
            checkpoints — all included. Tab runs in-process on your machine,
            so the heaviest call in the loop has no per-token cost. Subscribe
            once; nothing else opens a tab in your billing console.
          </p>
          <ul className="mt-5 space-y-2.5 text-[13px] text-paper/75">
            {BUNDLE_ITEMS.map((item) => (
              <li key={item.label} className="flex items-start gap-2.5">
                <span
                  aria-hidden
                  className="mt-[7px] inline-block h-1 w-1 shrink-0 rounded-full bg-accent"
                />
                <span>
                  <span className="text-paper">{item.label}</span>
                  <span className="text-paper/50"> — {item.note}</span>
                </span>
              </li>
            ))}
          </ul>
          <div className="mt-auto pt-5">
            <div className="rounded-md border border-accent/25 bg-black/30 px-3.5 py-2.5">
              <p className="font-mono text-[11px] text-accent/70">Proof</p>
              <p className="mt-1 font-mono text-[12px] text-paper/85">
                Tab runs via embedded inference. No per-token cost to you.
              </p>
            </div>
          </div>
        </article>

        <article className="rounded-lg border border-white/[0.06] bg-bg-2/60 p-6 flex flex-col">
          <div className="flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-hidden />
            <p className="mono-cap text-paper/55">Honest about cloud</p>
          </div>
          <h4
            className="mt-4 font-display text-2xl text-paper text-balance"
            style={{ fontWeight: 400, letterSpacing: "-0.02em" }}
          >
            One thing crosses the wire. We tell you which one and when.
          </h4>
          <p className="mt-3 text-[14px] leading-relaxed text-paper/60">
            Planning and multi-file reasoning route to the diffusion engine —
            and only that. Every call shows the model, the token count, and
            the wall-clock latency in the iterator panel. Flip on audit and
            every call lands in a log file you own.
          </p>
          <ul className="mt-5 space-y-2 text-[12px] font-mono text-paper/65">
            <li className="flex items-start justify-between gap-3">
              <span className="text-paper/45">Crosses the wire</span>
              <span className="text-paper/80 text-right">Planner only</span>
            </li>
            <li className="flex items-start justify-between gap-3">
              <span className="text-paper/45">Visible per turn</span>
              <span className="text-paper/80 text-right">
                Model · tokens · latency
              </span>
            </li>
            <li className="flex items-start justify-between gap-3">
              <span className="text-paper/45">Off by default</span>
              <span className="text-paper/80 text-right">Telemetry</span>
            </li>
            <li className="flex items-start justify-between gap-3">
              <span className="text-paper/45">Opt-in</span>
              <span className="text-paper/80 text-right">Audit log</span>
            </li>
          </ul>
          <div className="mt-auto pt-5">
            <div className="rounded-md border border-white/[0.06] bg-black/30 px-3.5 py-2.5">
              <p className="font-mono text-[11px] text-paper/45">Proof</p>
              <p className="mt-1 font-mono text-[12px] text-paper/85 break-all">
                ~/.eri/audit.log
              </p>
            </div>
          </div>
        </article>
      </div>
    </div>
  );
}
