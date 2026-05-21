import * as vscode from "vscode";
import { Sidecar } from "../sidecar";
import { AtMentionChip, AtMentionKind, AtMentionRegistry } from "./registry";
import { AtMentionPicker, defaultDocSources } from "./picker";
import {
  AtMentionResolvers,
  ResolverDeps,
  assembleContextBlock,
} from "./resolvers";
import { AtMentionSettingsView } from "./settingsView";
import { DocSourceStore, PastChatStore } from "./storage";

export interface AtMentionsHandle {
  // Pick a mention chip without inserting it. Returns undefined if cancelled.
  pick(kind?: AtMentionKind): Promise<AtMentionChip | undefined>;
  // Resolve a set of chips into a single context block prepended to userPrompt.
  assemble(
    chips: ReadonlyArray<AtMentionChip>,
    userPrompt: string,
  ): Promise<string>;
  // Persist a chat transcript so @PastChats can surface it later.
  savePastChat(title: string, transcript: string): Promise<string>;
  // Push a chip into a listener (composer registers itself here).
  setComposerSink(sink: ((chip: AtMentionChip) => void) | null): void;
  // Forward the registry so the composer's chip rendering can ask about
  // enabled kinds without re-importing internal modules.
  readonly registry: AtMentionRegistry;
  dispose(): void;
}

export function activateAtMentions(
  context: vscode.ExtensionContext,
  getSidecar: () => Sidecar | null,
): AtMentionsHandle {
  const registry = new AtMentionRegistry(context);
  const pastChats = new PastChatStore(context);
  const docSources = new DocSourceStore(context, defaultDocSources());

  const picker = new AtMentionPicker({
    registry,
    listPastChats: () => pastChats.list(),
    listDocSources: () => docSources.list(),
  });

  const resolverDeps: ResolverDeps = {
    context,
    getSidecar,
    listPastChats: async () => pastChats.list().then((list) => list.map((entry) => ({
      id: entry.id,
      title: entry.title,
    }))),
    loadPastChat: (id) => pastChats.load(id),
    listDocSources: () => docSources.list(),
  };
  const resolvers = new AtMentionResolvers(resolverDeps);
  const settings = new AtMentionSettingsView(context, registry);

  let composerSink: ((chip: AtMentionChip) => void) | null = null;

  async function pickAndDispatch(kind?: AtMentionKind): Promise<AtMentionChip | undefined> {
    const chip = kind
      ? await picker.openKind(kind)
      : await picker.openTopLevel();
    if (!chip) {
      return undefined;
    }
    // Hand the chip to whatever surface asked. If a composer is listening it
    // will render the chip in its context strip; otherwise fall back to the
    // active editor / clipboard so the user still gets useful behavior.
    if (composerSink) {
      composerSink(chip);
    } else {
      await fallbackInsert(chip);
    }
    return chip;
  }

  context.subscriptions.push(
    vscode.commands.registerCommand("eri.atMentions.open", () =>
      pickAndDispatch(undefined),
    ),
    vscode.commands.registerCommand("eri.atMentions.manage", () => settings.open()),
    vscode.commands.registerCommand("eri.addDocSource", async () => {
      const label = await vscode.window.showInputBox({
        prompt: "Doc source label (e.g. 'Vue 3')",
      });
      if (!label) {
        return;
      }
      const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, "-");
      const url = await vscode.window.showInputBox({
        prompt: `Doc source URL for ${label}`,
        placeHolder: "https://…",
      });
      if (!url) {
        return;
      }
      await docSources.add({ slug, label, url });
      vscode.window.showInformationMessage(`eri @Docs — added ${label}`);
    }),
    // Per-kind shortcuts so the existing keybindings + command palette entries
    // keep working. We dispatch through the same picker so the chip flow is
    // identical.
    vscode.commands.registerCommand("eri.mentions.openPicker", () =>
      pickAndDispatch(undefined),
    ),
    vscode.commands.registerCommand("eri.mentions.pickFile", () => pickAndDispatch("file")),
    vscode.commands.registerCommand("eri.mentions.pickFolder", () => pickAndDispatch("folder")),
    vscode.commands.registerCommand("eri.mentions.pickSymbol", () => pickAndDispatch("code")),
    vscode.commands.registerCommand("eri.mentions.pickWeb", () => pickAndDispatch("web")),
    vscode.commands.registerCommand("eri.mentions.pickDocs", () => pickAndDispatch("docs")),
    vscode.commands.registerCommand("eri.mentions.pickCodebase", () => pickAndDispatch("codebase")),
    vscode.commands.registerCommand("eri.mentions.pickGit", () => pickAndDispatch("git")),
    vscode.commands.registerCommand("eri.mentions.pickPastChats", () => pickAndDispatch("pastChats")),
    vscode.commands.registerCommand("eri.mentions.pickRecentChanges", () => pickAndDispatch("recentChanges")),
    vscode.commands.registerCommand("eri.mentions.pickLinterErrors", () => pickAndDispatch("linterErrors")),
    vscode.commands.registerCommand("eri.mentions.pickDefinitions", () => pickAndDispatch("definitions")),
    { dispose: () => settings.dispose() },
  );

  return {
    pick: (kind) => pickAndDispatch(kind),
    assemble: async (chips, userPrompt) => {
      const resolutions = await Promise.all(
        chips.map((chip) => resolvers.resolve(chip)),
      );
      return assembleContextBlock(resolutions, userPrompt);
    },
    savePastChat: (title, transcript) => pastChats.save(title, transcript),
    setComposerSink: (sink) => {
      composerSink = sink;
    },
    registry,
    dispose: () => settings.dispose(),
  };
}

async function fallbackInsert(chip: AtMentionChip): Promise<void> {
  const text = renderInlineToken(chip);
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    await vscode.env.clipboard.writeText(text);
    vscode.window.showInformationMessage(`eri — copied ${text} to clipboard`);
    return;
  }
  await editor.edit((builder) => {
    for (const selection of editor.selections) {
      builder.replace(selection, text);
    }
  });
}

// The inline-text form of a chip, used when no composer is listening. Mirrors
// Cursor's `@File path/to/file` rendering.
function renderInlineToken(chip: AtMentionChip): string {
  switch (chip.kind) {
    case "file": return `@File ${chip.label}`;
    case "folder": return `@Folder ${chip.label}`;
    case "code": return `@Code ${chip.label}`;
    case "docs": return `@Docs ${chip.label}`;
    case "web": return `@Web ${chip.label}`;
    case "codebase": return `@Codebase ${chip.label}`;
    case "git": return `@Git ${chip.label}`;
    case "pastChats": return `@PastChats ${chip.label}`;
    case "recentChanges": return "@RecentChanges";
    case "linterErrors": return "@LinterErrors";
    case "definitions": return `@Definitions ${chip.label}`;
    default: return "@Mention";
  }
}

export type { AtMentionChip, AtMentionKind } from "./registry";
