// Plan data for the pricing page. These are eri's real tiers (mirrored from
// Stripe): Free, Starter, Pro, Pro+. Pricing is token-metered on top of each
// plan, so the dollar figure is a monthly floor that includes a usage
// allowance; going past it is opt-in. price = monthly; priceYear = the
// per-month figure when billed yearly (about 20% off).

export type PlanId = "free" | "starter" | "pro" | "proPlus";

export interface Plan {
  id: PlanId;
  name: string;
  // One-line read of who the plan is for.
  forWhom: string;
  // Monthly price in dollars. 0 = free.
  price: number;
  // Per-month price when billed yearly (0 = free).
  priceYear: number;
  // What you get on top of the previous tier.
  carriesOver: string | null;
  features: ReadonlyArray<string>;
  cta: { label: string; href: string };
  recommended: boolean;
}

export const PLANS: ReadonlyArray<Plan> = [
  {
    id: "free",
    name: "Free",
    forWhom: "Meet eri on your Mac.",
    price: 0,
    priceYear: 0,
    carriesOver: null,
    features: [
      "Talk, plan, and write on your Mac",
      "It builds a private model of you",
      "Your model is yours, and it carries up",
      "A small monthly allowance of cloud work",
      "Everything it does is logged and undoable",
    ],
    cta: { label: "Download eri", href: "/download" },
    recommended: false,
  },
  {
    id: "starter",
    name: "Starter",
    forWhom: "Connected, and on your phone.",
    price: 15,
    priceYear: 12,
    carriesOver: "Everything in Free, and",
    features: [
      "Connect your apps and services",
      "eri on your phone over iMessage, WhatsApp, Telegram",
      "It remembers you across every chat and device",
      "No eri branding on what you ship",
      "A full monthly allowance of cloud work",
    ],
    cta: { label: "Get Starter", href: "/download" },
    recommended: false,
  },
  {
    id: "pro",
    name: "Pro",
    forWhom: "The full digital human, hands-free.",
    price: 30,
    priceYear: 24,
    carriesOver: "Everything in Starter, and",
    features: [
      "Hands-free control of your computer",
      "It acts on its own while you are away",
      "Proactive, it does things before you ask",
      "About 10x Starter's monthly usage",
      "Faster, priority responses",
    ],
    cta: { label: "Get Pro", href: "/download" },
    recommended: true,
  },
  {
    id: "proPlus",
    name: "Pro+",
    forWhom: "The most personal eri.",
    price: 60,
    priceYear: 48,
    carriesOver: "Everything in Pro, and",
    features: [
      "Tuned to only you, the way you work",
      "The most monthly usage, for heavy days",
      "First in line for new abilities",
      "Priority support",
    ],
    cta: { label: "Get Pro+", href: "/download" },
    recommended: false,
  },
];

// Feature matrix: an honest at-a-glance comparison. value per plan, in
// [free, starter, pro, proPlus] order.
export interface MatrixRow {
  label: string;
  values: readonly [
    boolean | string,
    boolean | string,
    boolean | string,
    boolean | string,
  ];
}

export interface MatrixGroup {
  title: string;
  rows: ReadonlyArray<MatrixRow>;
}

export const MATRIX: ReadonlyArray<MatrixGroup> = [
  {
    title: "The mind",
    rows: [
      { label: "Talks, plans, and writes with you", values: [true, true, true, true] },
      { label: "Builds a private model of you", values: [true, true, true, true] },
      { label: "Your model is yours, and carries up tiers", values: [true, true, true, true] },
      { label: "Remembers you across chats and devices", values: [false, true, true, true] },
      { label: "Tuned to only you, the way you work", values: [false, false, false, true] },
    ],
  },
  {
    title: "Doing things",
    rows: [
      { label: "Runs on your Mac", values: [true, true, true, true] },
      { label: "Connect your apps and services", values: [false, "Your core apps", "1,000+", "1,000+"] },
      { label: "eri on your phone (iMessage, WhatsApp, Telegram)", values: [false, true, true, true] },
      { label: "Hands-free control of your computer", values: [false, false, true, true] },
      { label: "Acts on its own while you are away", values: [false, false, true, true] },
      { label: "Proactive, does things before you ask", values: [false, false, true, true] },
    ],
  },
  {
    title: "Usage and trust",
    rows: [
      { label: "Monthly cloud-work allowance", values: ["Small", "Full", "About 10x Starter", "The most"] },
      { label: "Response speed", values: ["Standard", "Standard", "Priority", "Priority"] },
      { label: "No eri branding on what you ship", values: [false, true, true, true] },
      { label: "Logged, reversible actions", values: [true, true, true, true] },
      { label: "Stops before anything costly", values: [true, true, true, true] },
      { label: "Metered usage is opt-in, top up with credits", values: [true, true, true, true] },
      { label: "Support", values: ["Community", "Email", "Email", "Priority"] },
    ],
  },
];
