import { Folder, FileCode2, Check, Play } from "lucide-react";
import { BUILD } from "./morph";

// Build mode: the pad has morphed into a real IDE — file tree, an open file with
// eri's edits highlighted, a live preview, a green test run. This is the
// showpiece; it has to read as "a full editor that ships", not a 3-line stub.
export function BuildScene(): React.ReactElement {
  return (
    <div className="flex h-full flex-col gap-3 p-4 sm:p-5">
      {/* eri's plan line across the top */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[12px]">
        <span className="shrink-0 text-accent">eri&nbsp;›</span>
        <span className="text-text">{BUILD.request}</span>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-[160px_1fr_minmax(0,210px)]">
        {/* file tree */}
        <div className="hidden min-w-0 flex-col gap-0.5 rounded-xl border border-white/10 bg-black/20 p-3 lg:flex">
          <div className="mb-1.5 font-mono text-[9.5px] uppercase tracking-[0.16em] text-text-ter">
            explorer
          </div>
          {BUILD.files.map((f) => {
            const indented = f.name.startsWith("  ");
            const name = f.name.trim();
            const isDir = name.endsWith("/");
            return (
              <div
                key={f.name}
                className={`flex items-center gap-1.5 rounded-md px-1.5 py-1 text-[12px] ${
                  f.active ? "bg-[rgba(224,255,79,0.10)] text-text" : "text-text-sec"
                }`}
                style={{ paddingLeft: indented ? 16 : 6 }}
              >
                {isDir ? (
                  <Folder size={12} strokeWidth={1.8} className="shrink-0 text-text-ter" />
                ) : (
                  <FileCode2
                    size={12}
                    strokeWidth={1.8}
                    className={`shrink-0 ${f.edited ? "text-accent" : "text-text-ter"}`}
                  />
                )}
                <span className="truncate">{name}</span>
                {f.edited && !isDir && (
                  <span className="ml-auto size-1.5 shrink-0 rounded-full bg-accent" />
                )}
              </div>
            );
          })}
        </div>

        {/* code editor */}
        <div className="flex min-w-0 flex-col overflow-hidden rounded-xl border border-white/10 bg-black/30">
          <div className="flex items-center gap-2 border-b border-white/10 px-3 py-2 font-mono text-[11px] text-text-sec">
            <FileCode2 size={12} strokeWidth={1.8} className="text-accent" />
            {BUILD.activeFile}
          </div>
          <pre className="flex-1 overflow-hidden p-3 font-mono text-[11.5px] leading-[1.55]">
            {BUILD.code.map((line, i) => (
              <div
                key={i}
                className="flex gap-3"
                style={
                  line.add
                    ? {
                        background: "rgba(224,255,79,0.08)",
                        boxShadow: "inset 2px 0 0 #e0ff4f",
                        borderRadius: 2,
                      }
                    : undefined
                }
              >
                <span className="w-4 shrink-0 select-none text-right text-text-ter/60">
                  {i + 1}
                </span>
                <code className={line.add ? "text-text" : "text-text-sec"}>
                  {line.text || " "}
                </code>
              </div>
            ))}
          </pre>
        </div>

        {/* preview + tests */}
        <div className="flex min-w-0 flex-col gap-3">
          <div className="flex flex-1 flex-col overflow-hidden rounded-xl border border-white/10 bg-black/20">
            <div className="border-b border-white/10 px-3 py-2 font-mono text-[10px] uppercase tracking-[0.14em] text-text-ter">
              preview
            </div>
            <div className="flex flex-1 items-center justify-center p-3">
              {/* a tiny app frame showing the toggle eri just wired */}
              <div className="w-full rounded-lg border border-white/12 bg-white/[0.04] p-3">
                <div className="flex items-center justify-between">
                  <div className="h-2 w-12 rounded-full bg-white/25" />
                  <div className="flex h-4 w-7 items-center rounded-full bg-accent/80 px-0.5">
                    <span className="size-3 translate-x-2.5 rounded-full bg-[#0c0c0c] transition-transform" />
                  </div>
                </div>
                <div className="mt-3 space-y-1.5">
                  <div className="h-1.5 w-full rounded-full bg-white/12" />
                  <div className="h-1.5 w-4/5 rounded-full bg-white/10" />
                  <div className="h-1.5 w-2/3 rounded-full bg-white/10" />
                </div>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 rounded-xl border border-[rgba(134,239,172,0.28)] bg-[rgba(134,239,172,0.06)] px-3 py-2">
            <Check size={13} strokeWidth={2.4} className="text-[#86efac]" />
            <span className="font-mono text-[11.5px] text-[#86efac]">{BUILD.tests}</span>
          </div>
        </div>
      </div>

      {/* result strip */}
      <div className="flex items-center gap-2 rounded-lg border border-white/12 px-3 py-2">
        <Play size={12} strokeWidth={2} className="shrink-0 text-accent" />
        <span className="text-[12.5px] text-text">{BUILD.preview}</span>
      </div>
    </div>
  );
}
