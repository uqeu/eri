interface ComparisonRow {
  readonly feature: string;
  readonly eri: string;
  readonly editor: string;
  readonly appBuilder: string;
  readonly chatbot: string;
  readonly automation: string;
}

const COLUMNS: ReadonlyArray<{ key: keyof ComparisonRow; label: string; highlight?: boolean }> = [
  { key: "feature", label: "" },
  { key: "eri", label: "eri", highlight: true },
  { key: "editor", label: "Editor" },
  { key: "appBuilder", label: "App builder" },
  { key: "chatbot", label: "Chatbot" },
  { key: "automation", label: "Automation" },
];

const ROWS: ReadonlyArray<ComparisonRow> = [
  {
    feature: "Voice-first build",
    eri: "yes",
    editor: "no",
    appBuilder: "no",
    chatbot: "no",
    automation: "no",
  },
  {
    feature: "Agent-owned edits",
    eri: "Eri",
    editor: "partial",
    appBuilder: "yes",
    chatbot: "no",
    automation: "partial",
  },
  {
    feature: "Native macOS",
    eri: "yes",
    editor: "yes",
    appBuilder: "browser",
    chatbot: "browser",
    automation: "varies",
  },
  {
    feature: "Sub-2s median edit",
    eri: "1.8s",
    editor: "varies",
    appBuilder: "no",
    chatbot: "no",
    automation: "varies",
  },
  {
    feature: "Switch agent mid-sentence",
    eri: "yes",
    editor: "manual",
    appBuilder: "fixed",
    chatbot: "fixed",
    automation: "manual",
  },
  {
    feature: "Personalized AI",
    eri: "Personalized Eri",
    editor: "no",
    appBuilder: "no",
    chatbot: "no",
    automation: "partial",
  },
  {
    feature: "Code stays local",
    eri: "yes",
    editor: "partial",
    appBuilder: "no",
    chatbot: "no",
    automation: "partial",
  },
  {
    feature: "Bring your own keys",
    eri: "connectors",
    editor: "limited",
    appBuilder: "no",
    chatbot: "manual",
    automation: "yes",
  },
];

function Cell({
  value,
  highlight,
}: {
  readonly value: string;
  readonly highlight: boolean;
}): React.ReactElement {
  if (value === "yes") {
    return (
      <span
        className={
          "inline-flex items-center justify-center h-6 w-6 rounded-full " +
          (highlight
            ? "bg-accent text-ink"
            : "bg-white/[0.06] text-paper/70")
        }
      >
        <span aria-hidden className="text-[12px] font-bold">✓</span>
      </span>
    );
  }
  if (value === "no") {
    return <span className="text-paper/25 font-mono text-sm">—</span>;
  }
  return (
    <span
      className={
        "font-mono text-[12px] " + (highlight ? "text-accent" : "text-paper/65")
      }
    >
      {value}
    </span>
  );
}

export function CompareTable(): React.ReactElement {
  return (
    <section className="relative border-t border-white/[0.06]">
      <div className="mx-auto max-w-7xl px-6 py-24 sm:py-32">
        <div className="max-w-2xl">
          <p className="mono-cap text-accent">The wedge</p>
          <h2 className="mt-4 font-display text-h1 text-balance font-normal">
            How eri compares.
          </h2>
          <p className="mt-5 text-body text-paper/60">
            Eri sits between editor, app builder, chatbot, and automation:
            local workbench power, agent-owned workflow, reviewable artifacts,
            and cloud handoff when the task needs it.
          </p>
        </div>

        <div className="mt-12 overflow-x-auto -mx-6 sm:mx-0">
          <div className="min-w-[720px] sm:min-w-0 px-6 sm:px-0">
            <div className="rounded-xl border border-white/[0.08] overflow-hidden">
              {/* Header */}
              <div className="grid grid-cols-[1.6fr_repeat(5,1fr)] bg-bg-2 border-b border-white/[0.08]">
                {COLUMNS.map((col) => (
                  <div
                    key={col.label}
                    className={
                      "px-4 py-4 mono-cap " +
                      (col.highlight
                        ? "text-accent bg-accent/[0.06]"
                        : "text-paper/50")
                    }
                  >
                    {col.label}
                  </div>
                ))}
              </div>

              {ROWS.map((row, i) => (
                <div
                  key={row.feature}
                  className={
                    "grid grid-cols-[1.6fr_repeat(5,1fr)] items-center border-b border-white/[0.05] last:border-b-0 " +
                    (i % 2 === 1 ? "bg-bg-2/40" : "bg-transparent")
                  }
                >
                  <div className="px-4 py-4 text-[13px] text-paper/85">
                    {row.feature}
                  </div>
                  <div className="px-4 py-4 bg-accent/[0.04]">
                    <Cell value={row.eri} highlight />
                  </div>
                  <div className="px-4 py-4">
                    <Cell value={row.editor} highlight={false} />
                  </div>
                  <div className="px-4 py-4">
                    <Cell value={row.appBuilder} highlight={false} />
                  </div>
                  <div className="px-4 py-4">
                    <Cell value={row.chatbot} highlight={false} />
                  </div>
                  <div className="px-4 py-4">
                    <Cell value={row.automation} highlight={false} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
