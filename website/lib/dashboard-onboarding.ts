export type OnboardingStepStatus = "done" | "todo";

export interface DashboardOnboardingInput {
  readonly activeDevices: number | null;
  readonly tier: string;
}

export interface DashboardOnboardingStep {
  readonly id: string;
  readonly title: string;
  readonly body: string;
  readonly href: string;
  readonly cta: string;
  readonly status: OnboardingStepStatus;
}

export function dashboardOnboardingSteps(
  input: DashboardOnboardingInput,
): ReadonlyArray<DashboardOnboardingStep> {
  const hasDevice = (input.activeDevices ?? 0) > 0;
  const isPaid = input.tier !== "free";
  return [
    {
      id: "download",
      title: "Download Eri",
      body: "Install the app, then open the Agent Manager on first launch.",
      href: "/install",
      cta: "Download",
      status: "todo",
    },
    {
      id: "connect",
      title: "Connect this account",
      body: "Sign into Eri from the app or CLI so usage, billing, and devices match.",
      href: "/devices",
      cta: hasDevice ? "View devices" : "Connect",
      status: hasDevice ? "done" : "todo",
    },
    {
      id: "manager",
      title: "Open Agent Manager",
      body: "Use the manager to plan, edit, preview, review, and ship from one task surface.",
      href: "/docs/ide",
      cta: "Read workbench guide",
      status: hasDevice ? "done" : "todo",
    },
    {
      id: "first-task",
      title: "Run the first task",
      body: "Try: plan a change, edit it, open Preview, run Review, then create a checkpoint.",
      href: "/docs/quickstart",
      cta: "Quickstart",
      status: "todo",
    },
    {
      id: "upgrade",
      title: "Unlock hosted Ship",
      body: "Paid plans enable the builder and checker loop with higher usage limits.",
      href: "/billing?plan=pro",
      cta: isPaid ? "Billing" : "Upgrade",
      status: isPaid ? "done" : "todo",
    },
  ];
}
