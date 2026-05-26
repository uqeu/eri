#!/usr/bin/env node
// eri-wizard — interactive setup for new users.
//
// Walks through three steps:
//   1. Sign in (device-code flow against tryeri.ca; opens the user's
//      browser and polls until they approve).
//   2. Pick a persona (eri / architect / coder / debugger / tester /
//      shipper / mercury).
//   3. Pick a starter template (saas-next, spa-vite, api-rust, …).
//
// All choices land in a generated `.eri/persona` + a fresh
// `package.json` (or equivalent) so `eri ship` works on the next
// invocation. Run as `npx eri-wizard` from any directory.

import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

import { startDeviceFlow, pollDeviceFlow, saveCredentials } from "./auth.js";
import { PERSONAS, TEMPLATES } from "./catalog.js";

interface WizardConfig {
  baseUrl: string;
  bearer?: string;
  persona?: string;
  template?: string;
  workspaceRoot: string;
}

async function main(): Promise<void> {
  const config: WizardConfig = {
    baseUrl: process.env.ERI_BASE_URL ?? "https://tryeri.ca",
    workspaceRoot: process.cwd(),
  };

  banner();
  const rl = readline.createInterface({ input, output });
  try {
    await stepSignIn(rl, config);
    await stepPersona(rl, config);
    await stepTemplate(rl, config);
    await stepWriteFiles(config);
    farewell(config);
  } finally {
    rl.close();
  }
}

function banner(): void {
  const lines = [
    "",
    "  ┌─────────────────────────────────────────────┐",
    "  │   eri  ·  let's get you set up              │",
    "  │   three quick questions; ⌃C to bail anytime │",
    "  └─────────────────────────────────────────────┘",
    "",
  ];
  process.stdout.write(lines.join("\n"));
}

function farewell(config: WizardConfig): void {
  const lines = [
    "",
    "  All set. Next moves:",
    `    • cd ${path.relative(process.cwd(), config.workspaceRoot) || "."}`,
    `    • eri ask "what should I build first?"`,
    `    • eri ship "add a hello world endpoint"`,
    "",
  ];
  process.stdout.write(lines.join("\n"));
}

async function stepSignIn(
  rl: readline.Interface,
  config: WizardConfig,
): Promise<void> {
  if (process.env.ERI_API_KEY) {
    process.stdout.write(`  [1/3] Using ERI_API_KEY from environment.\n\n`);
    config.bearer = process.env.ERI_API_KEY;
    return;
  }
  const choice = (
    await rl.question(
      "  [1/3] Sign in to eri now? [Y/n] ",
    )
  )
    .trim()
    .toLowerCase();
  if (choice === "n" || choice === "no") {
    process.stdout.write(
      "         Skipped. Re-run later with `eri auth login` or `npx eri-wizard`.\n\n",
    );
    return;
  }
  const start = await startDeviceFlow(config.baseUrl);
  process.stdout.write(
    `         Open ${start.verificationUrl}\n         Or paste this code: ${start.userCode}\n\n`,
  );
  const polled = await pollDeviceFlow(config.baseUrl, start.deviceCode);
  if (!polled.bearer) {
    process.stdout.write("         Sign-in did not complete; continuing offline.\n\n");
    return;
  }
  await saveCredentials({
    baseUrl: config.baseUrl,
    bearer: polled.bearer,
    userId: polled.userId,
    email: polled.email,
    tier: polled.tier,
  });
  config.bearer = polled.bearer;
  process.stdout.write(`         Signed in as ${polled.email ?? "(no email)"}\n\n`);
}

async function stepPersona(
  rl: readline.Interface,
  config: WizardConfig,
): Promise<void> {
  process.stdout.write("  [2/3] Pick a persona:\n");
  PERSONAS.forEach((p, i) => {
    process.stdout.write(`         ${i + 1}. ${p.name.padEnd(10)} ${p.description}\n`);
  });
  process.stdout.write("\n");
  const raw = (await rl.question("         Number (or name): ")).trim();
  const direct = PERSONAS.find(
    (p) => p.name.toLowerCase() === raw.toLowerCase(),
  );
  if (direct) {
    config.persona = direct.name;
  } else {
    const idx = Number.parseInt(raw, 10) - 1;
    if (Number.isFinite(idx) && idx >= 0 && idx < PERSONAS.length) {
      config.persona = PERSONAS[idx]!.name;
    } else {
      config.persona = "eri";
      process.stdout.write("         Defaulting to: eri\n");
    }
  }
  process.stdout.write(`         Persona: ${config.persona}\n\n`);
}

async function stepTemplate(
  rl: readline.Interface,
  config: WizardConfig,
): Promise<void> {
  process.stdout.write("  [3/3] Pick a template (or 0 to skip):\n");
  process.stdout.write("         0. (skip; I have my own scaffold)\n");
  TEMPLATES.forEach((t, i) => {
    process.stdout.write(`         ${i + 1}. ${t.slug.padEnd(16)} ${t.name}\n`);
  });
  process.stdout.write("\n");
  const raw = (await rl.question("         Number: ")).trim();
  const direct = TEMPLATES.find((t) => t.slug.toLowerCase() === raw.toLowerCase());
  if (direct) {
    config.template = direct.slug;
  } else {
    const idx = Number.parseInt(raw, 10);
    if (idx > 0 && idx <= TEMPLATES.length) {
      config.template = TEMPLATES[idx - 1]!.slug;
    } else {
      config.template = undefined;
      process.stdout.write("         Skipped scaffold.\n");
    }
  }
  process.stdout.write(`         Template: ${config.template ?? "(none)"}\n\n`);
}

async function stepWriteFiles(config: WizardConfig): Promise<void> {
  const eriDir = path.join(config.workspaceRoot, ".eri");
  await fs.mkdir(eriDir, { recursive: true });
  if (config.persona) {
    await fs.writeFile(
      path.join(eriDir, "persona"),
      `${config.persona}\n`,
      "utf8",
    );
  }
  if (config.template) {
    await fs.writeFile(
      path.join(eriDir, "template"),
      `${config.template}\n`,
      "utf8",
    );
  }
  // Quietly leave a marker so the IDE knows the wizard already ran.
  await fs.writeFile(
    path.join(eriDir, "wizard.marker"),
    JSON.stringify({ completedAt: new Date().toISOString() }, null, 2),
    "utf8",
  );
}

main().catch((err) => {
  process.stderr.write(`\nerror: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
