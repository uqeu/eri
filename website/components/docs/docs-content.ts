// Single source of content for the /docs page. Kept as plain data so the page
// stays declarative and the section list, sidebar, and scroll-spy all read from
// the same place. Substance is pulled from the capabilities spec
// (docs/plans/eri-capabilities-and-thought-stream.md), the phone page, and the
// pricing page so the docs never drift from what the rest of the site claims.

export interface DocSection {
  readonly id: string;
  readonly nav: string;
}

// The left-rail order. Each id matches a section anchor in the page.
export const DOC_SECTIONS: ReadonlyArray<DocSection> = [
  { id: "getting-started", nav: "Getting started" },
  { id: "what-eri-does", nav: "What eri does" },
  { id: "how-eri-works", nav: "How eri works" },
  { id: "thought-stream", nav: "The thought stream" },
  { id: "phone", nav: "eri on your phone" },
  { id: "trust", nav: "Trust and control" },
  { id: "plans", nav: "Plans and usage" },
];

// --- Getting started -------------------------------------------------------

export interface Step {
  readonly title: string;
  readonly body: string;
}

export const GETTING_STARTED: ReadonlyArray<Step> = [
  {
    title: "Download eri for Mac",
    body: "Get the app from the download page and open it. First launch walks you through microphone, screen, and accessibility permissions. These let eri hear you, see what is in front of you, and act for you. Grant what you are comfortable with. You can start keyboard-first and add the rest later.",
  },
  {
    title: "Sign in and sync",
    body: "Sign in with your eri account. Your plan, your memory, and your preferences arrive on this device, so eri picks up where you left off rather than starting from a blank slate.",
  },
  {
    title: "It builds a model of you",
    body: "From the first session, eri keeps a private model of you: your people, your projects, your habits, the way you write. It is quiet at first and gets sharper as it watches you work. That model is what makes its judgment feel like yours over time.",
  },
  {
    title: "Summon it with the hotkey",
    body: "Press the hotkey, set to a key combination of your choice, to pull eri up anywhere on your Mac. Tell it what you want in plain words. It reads the screen, plans the steps, and does them, confirming before anything risky.",
  },
];

// --- What eri does ---------------------------------------------------------

export interface CapabilityGroup {
  readonly heading: string;
  readonly intro: string;
  readonly items: ReadonlyArray<{ app: string; does: string }>;
}

export const CAPABILITY_GROUPS: ReadonlyArray<CapabilityGroup> = [
  {
    heading: "It runs your apps",
    intro: "Pick a task and eri does the whole thing, end to end, in the app you already use.",
    items: [
      { app: "Cursor and your editor", does: "reads the module, makes the change, runs the tests, commits to a branch" },
      { app: "Gmail", does: "triages the inbox, archives the noise, drafts and sends the replies that need you" },
      { app: "Calendar", does: "spots conflicts, moves the meeting, notifies the guests, rebooks the room" },
      { app: "Google Sheets", does: "traces a broken formula, repairs the model, checks that it balances" },
      { app: "Slack", does: "skims the channels, surfaces the threads that need you, summarizes the rest" },
      { app: "Notion", does: "structures the notes from a call, writes the doc, captures the action items" },
      { app: "Spotify", does: "reads the mood, builds a queue, starts it playing" },
      { app: "YouTube and your screen", does: "watches along, summarizes, timestamps the moments worth keeping" },
    ],
  },
  {
    heading: "It reads your screen",
    intro: "eri sees what you are looking at, so you can ask about the thing in front of you without describing it.",
    items: [
      { app: "Point with your words", does: "ask about the chart, the error, the paragraph on screen, and eri already knows what you mean" },
      { app: "Hands-free", does: "it clicks, types, books, and sends, so a task can run while your hands are elsewhere" },
    ],
  },
  {
    heading: "It remembers you",
    intro: "A private model of you that grows with every session and travels between your devices.",
    items: [
      { app: "Your people", does: "who matters, how you talk to them, what you tend to ask for" },
      { app: "Your habits", does: "the things you do in order, so it can anticipate the next step" },
      { app: "Your voice", does: "the way you write and speak, mirrored back so its replies read like you, not like a template" },
    ],
  },
];

// The wider directory under "What eri does": expandable category groups, each
// with a list of apps. `logo` is the slug of a file in /public/logos when we
// have one; apps without a logo are listed by name only. Categories are
// collapsed by default and opened one at a time via a disclosure.
export interface DirectoryApp {
  readonly name: string;
  readonly logo?: string;
}

export interface DirectoryCategory {
  readonly title: string;
  readonly apps: ReadonlyArray<DirectoryApp>;
}

export const APP_DIRECTORY: ReadonlyArray<DirectoryCategory> = [
  {
    title: "Email and calendar",
    apps: [
      { name: "Gmail", logo: "gmail" },
      { name: "Google Calendar", logo: "google-calendar" },
      { name: "Outlook" },
      { name: "Cal.com" },
    ],
  },
  {
    title: "Docs and notes",
    apps: [
      { name: "Notion", logo: "notion" },
      { name: "Google Docs", logo: "google-docs" },
      { name: "Google Sheets", logo: "google-sheets" },
      { name: "Confluence" },
      { name: "Linear docs", logo: "linear" },
    ],
  },
  {
    title: "Dev",
    apps: [
      { name: "Cursor", logo: "cursor" },
      { name: "VS Code" },
      { name: "GitHub", logo: "github" },
      { name: "Linear", logo: "linear" },
      { name: "Jira" },
      { name: "Vercel" },
      { name: "Terminal" },
    ],
  },
  {
    title: "Design",
    apps: [{ name: "Figma", logo: "figma" }],
  },
  {
    title: "Messaging",
    apps: [
      { name: "iMessage", logo: "imessage" },
      { name: "Slack", logo: "slack" },
      { name: "Discord", logo: "discord" },
      { name: "WhatsApp", logo: "whatsapp" },
      { name: "Telegram", logo: "telegram" },
    ],
  },
  {
    title: "Meetings",
    apps: [
      { name: "Zoom", logo: "zoom" },
      { name: "Google Meet" },
    ],
  },
  {
    title: "Storage",
    apps: [
      { name: "Dropbox", logo: "dropbox" },
      { name: "Google Drive" },
    ],
  },
  {
    title: "Media and web",
    apps: [
      { name: "Spotify", logo: "spotify" },
      { name: "YouTube", logo: "youtube" },
      { name: "Maps", logo: "maps" },
      { name: "Your browser" },
    ],
  },
];

export const DIRECTORY_TAIL = "and 1,000+ more through your connections";

// --- How eri works ---------------------------------------------------------

export interface Path {
  readonly title: string;
  readonly body: string;
}

export const PATHS: ReadonlyArray<Path> = [
  {
    title: "Connected integrations",
    body: "Connect a service once and eri talks to it directly through its API: fast, precise, structured. The connector layer reaches more than 1,000 services, so most of what you use is one sign-in away. When a connection exists, this is the path eri takes by default.",
  },
  {
    title: "Direct computer control",
    body: "This is the part that matters most. Even with no connection and no API, eri still does the job, because it lives inside your computer and drives the real apps for you. It sees the screen, moves the pointer, types the keys, reads the result, and keeps going. Connected or not, eri can operate the app anyway.",
  },
];

export const FALLBACK_LINE =
  "eri resolves each task in order: the connected API first, then direct on-screen control if there is no connection or the API falls short. The handoff is automatic, so you never have to care which path ran.";

// --- The thought stream ----------------------------------------------------

// Typed lines for the example run. `kind` drives the mono-block styling.
export interface StreamLine {
  readonly kind: "think" | "cmd" | "out" | "done";
  readonly text: string;
}

export const STREAM_EXAMPLE: ReadonlyArray<StreamLine> = [
  { kind: "think", text: "thinking: reading 42 unread" },
  { kind: "cmd", text: "$ eri gmail triage --inbox" },
  { kind: "out", text: "38 archived, 4 need you" },
  { kind: "done", text: "done: inbox at zero" },
];

// --- eri on your phone -----------------------------------------------------

export const PHONE_CHANNELS: ReadonlyArray<string> = [
  "iMessage",
  "WhatsApp",
  "Telegram",
  "Slack",
  "Discord",
];

// --- Trust and control -----------------------------------------------------

export interface TrustPoint {
  readonly title: string;
  readonly body: string;
}

export const TRUST_POINTS: ReadonlyArray<TrustPoint> = [
  {
    title: "Everything is logged and undoable",
    body: "Every action eri takes is written to a log you can read. Anything reversible can be rolled back from the same place, so you can always see what it touched and take it back.",
  },
  {
    title: "It stops before anything costly",
    body: "Money, mass messages, and deletions make eri pause and ask first. Sensitive actions like passwords, payments, and CAPTCHAs are a hard line it will not cross on its own, not a prompt it tries to talk you past.",
  },
  {
    title: "Your model of you stays yours",
    body: "The private model eri keeps of you is yours. It is there to make eri better at your work, not to be pooled or sold, and you can see what it holds.",
  },
];

// --- Plans and usage -------------------------------------------------------

export interface PlanRow {
  readonly name: string;
  readonly line: string;
}

export const PLANS: ReadonlyArray<PlanRow> = [
  { name: "Free", line: "A local agentic workbench you can trust before you ship." },
  { name: "Starter", line: "A steadier agent with memory across your real projects." },
  { name: "Pro", line: "Local first, with cloud runners for the work that should leave your laptop." },
  { name: "Pro+", line: "A private setup tuned to your repo, your team, and your release path." },
];

export const USAGE_LINE =
  "Each plan includes a monthly allowance of cloud work, and nothing meters while eri is idle. When you reach the allowance, eri pauses paid work and asks before going further, so a busy month never becomes a surprise bill. Metered usage past your allowance is opt-in, and you top up with eri credits whenever you want.";
