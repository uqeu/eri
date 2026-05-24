// Infer a short, human-readable terminal name from the first substantive
// command the user runs. Pure functions only — no I/O — so this is easy to
// unit-test.

const MAX_LENGTH = 24;

// Ignore-list: commands that are too generic to be useful as a terminal name.
const TRIVIAL_TOKENS: ReadonlySet<string> = new Set([
  "cd",
  "ls",
  "ll",
  "la",
  "clear",
  "cls",
  "pwd",
  "exit",
  "history",
  "echo",
  "source",
  ".",
  "true",
  "false",
  "which",
  "type",
  "alias",
  "unalias",
  "set",
  "unset",
  "export",
]);

// Friendly aliases — known recipes get nice names.
const FRIENDLY: ReadonlyArray<{
  readonly pattern: RegExp;
  readonly name: string;
}> = [
  { pattern: /^npm\s+run\s+dev\b/, name: "dev server" },
  { pattern: /^npm\s+run\s+start\b/, name: "npm start" },
  { pattern: /^npm\s+(test|t)\b/, name: "tests" },
  { pattern: /^npm\s+run\s+build\b/, name: "build" },
  { pattern: /^npm\s+run\s+storybook\b/, name: "storybook" },
  { pattern: /^pnpm\s+(run\s+)?dev\b/, name: "dev server" },
  { pattern: /^pnpm\s+(run\s+)?build\b/, name: "build" },
  { pattern: /^pnpm\s+(run\s+)?test\b/, name: "tests" },
  { pattern: /^yarn\s+(run\s+)?dev\b/, name: "dev server" },
  { pattern: /^yarn\s+(run\s+)?build\b/, name: "build" },
  { pattern: /^yarn\s+(run\s+)?test\b/, name: "tests" },
  { pattern: /^npx\s+vitest\b/, name: "vitest" },
  { pattern: /^npx\s+jest\b/, name: "jest" },
  { pattern: /^npx\s+playwright\b/, name: "playwright" },
  { pattern: /^vite\b/, name: "vite" },
  { pattern: /^next\s+dev\b/, name: "next dev" },
  { pattern: /^next\s+build\b/, name: "next build" },
  { pattern: /^next\s+start\b/, name: "next start" },
  { pattern: /^cargo\s+run\b/, name: "cargo run" },
  { pattern: /^cargo\s+watch\b/, name: "cargo watch" },
  { pattern: /^cargo\s+test\b/, name: "cargo test" },
  { pattern: /^cargo\s+build\b/, name: "cargo build" },
  { pattern: /^go\s+run\b/, name: "go run" },
  { pattern: /^go\s+test\b/, name: "go test" },
  { pattern: /^python\s+-m\s+(\S+)/, name: "python -m" },
  { pattern: /^uvicorn\b/, name: "uvicorn" },
  { pattern: /^gunicorn\b/, name: "gunicorn" },
  { pattern: /^docker\s+compose\s+up\b/, name: "docker up" },
  { pattern: /^docker\s+run\b/, name: "docker run" },
  { pattern: /^psql\b/, name: "psql" },
  { pattern: /^mysql\b/, name: "mysql" },
  { pattern: /^redis-cli\b/, name: "redis-cli" },
  { pattern: /^git\s+log\b/, name: "git log" },
  { pattern: /^git\s+status\b/, name: "git status" },
  { pattern: /^tail\b/, name: "tail" },
];

export interface AutoNameOptions {
  readonly maxLength?: number;
}

// Returns a short name for the given command, or null if the command is too
// trivial to be worth renaming for.
export function inferTerminalName(
  command: string,
  options: AutoNameOptions = {},
): string | null {
  const trimmed = command.trim();
  if (trimmed.length === 0) {
    return null;
  }

  // Drop trailing comment/heredoc markers.
  const noComment = trimmed.split(/\s+#\s/)[0].trim();
  if (noComment.length === 0) {
    return null;
  }

  // Reject simple `cd foo` / `clear` / single-token aliases.
  const firstToken = noComment.split(/\s+/)[0];
  const isSingleToken = !noComment.includes(" ");
  if (TRIVIAL_TOKENS.has(firstToken)) {
    return null;
  }
  if (isSingleToken && firstToken.length < 3) {
    return null;
  }

  for (const friendly of FRIENDLY) {
    if (friendly.pattern.test(noComment)) {
      return truncate(friendly.name, options.maxLength ?? MAX_LENGTH);
    }
  }

  // Generic fallback: keep the first two meaningful tokens.
  const tokens = noComment.split(/\s+/).filter((t) => t.length > 0);
  if (tokens.length === 0) {
    return null;
  }
  const head = tokens.slice(0, 2).join(" ");
  const summary = tokens.length > 2 ? `${head} …` : head;
  return truncate(summary, options.maxLength ?? MAX_LENGTH);
}

function truncate(value: string, max: number): string {
  if (value.length <= max) {
    return value;
  }
  return `${value.slice(0, Math.max(1, max - 1))}…`;
}

// Filter that drops shell prompt artifacts from a command line before we
// attempt to rename. Removes leading `$ `, `% `, `> ` style prompts.
export function stripPromptPrefix(line: string): string {
  return line.replace(/^[\s\$%>#]+/, "");
}
