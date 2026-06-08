"use client";

import { useCallback, useState } from "react";

interface PlaygroundEvent {
  kind: string;
  text?: string;
  message?: string;
}

export function Playground(): JSX.Element {
  const [prompt, setPrompt] = useState("");
  const [intent, setIntent] = useState<"ask" | "plan" | "sketch">("ask");
  const [running, setRunning] = useState(false);
  const [output, setOutput] = useState("");
  const [error, setError] = useState<string | null>(null);

  const onSubmit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      if (!prompt.trim() || running) return;
      setRunning(true);
      setOutput("");
      setError(null);
      try {
        const response = await fetch("/api/v1/agent/playground", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ intent, prompt }),
        });
        if (!response.ok) {
          const text = await response.text();
          throw new Error(text || `HTTP ${response.status}`);
        }
        const reader = response.body?.getReader();
        if (!reader) throw new Error("response body missing");
        const decoder = new TextDecoder();
        let buffer = "";
        let collected = "";
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let lineBreak: number;
          while ((lineBreak = buffer.indexOf("\n\n")) >= 0) {
            const block = buffer.slice(0, lineBreak);
            buffer = buffer.slice(lineBreak + 2);
            for (const line of block.split("\n")) {
              if (!line.startsWith("data:")) continue;
              const payload = line.slice(5).trim();
              if (!payload || payload === "[DONE]") continue;
              try {
                const event: PlaygroundEvent = JSON.parse(payload);
                if (event.kind === "token" && event.text) {
                  collected += event.text;
                  setOutput(collected);
                } else if (event.kind === "error") {
                  setError(event.message ?? "agent error");
                }
              } catch {
                // forward-compat
              }
            }
          }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "unknown error");
      } finally {
        setRunning(false);
      }
    },
    [intent, prompt, running],
  );

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {(["ask", "plan", "sketch"] as const).map((mode) => (
          <button
            key={mode}
            type="button"
            onClick={() => setIntent(mode)}
            className={`rounded-full border px-4 py-1.5 text-sm font-medium transition ${
              intent === mode
                ? "border-lime-400/60 bg-lime-400/10 text-lime-200"
                : "border-zinc-700 text-zinc-400 hover:border-zinc-500"
            }`}
          >
            /{mode}
          </button>
        ))}
      </div>
      <textarea
        className="block w-full rounded-2xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-zinc-100 placeholder:text-zinc-600 focus:border-lime-400/50 focus:outline-none"
        rows={4}
        placeholder="describe what you want — e.g. how does tokio's runtime model work?"
        value={prompt}
        onChange={(event) => setPrompt(event.target.value)}
        disabled={running}
      />
      <div className="flex items-center justify-between">
        <p className="text-xs text-zinc-500">
          {intent === "ask"
            ? "One-off Q&A — uses Eri Ask."
            : intent === "plan"
              ? "Step-by-step plan — uses Eri Planner."
              : "HTML draft — uses Eri Sketch."}
        </p>
        <button
          type="submit"
          disabled={running || !prompt.trim()}
          className="rounded-full bg-lime-400 px-5 py-2 text-sm font-semibold text-black disabled:opacity-40"
        >
          {running ? "Running…" : "Run"}
        </button>
      </div>
      {error && (
        <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}
      {output && (
        <pre className="whitespace-pre-wrap rounded-2xl border border-zinc-800 bg-zinc-950 px-4 py-3 font-mono text-sm text-zinc-100">
          {output}
        </pre>
      )}
    </form>
  );
}
