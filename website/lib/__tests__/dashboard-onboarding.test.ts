import { strict as assert } from "node:assert";
import { dashboardOnboardingSteps } from "../dashboard-onboarding";

{
  const steps = dashboardOnboardingSteps({ activeDevices: 0, tier: "free" });
  assert.equal(steps.length, 5);
  assert.equal(steps[0].id, "download");
  assert.equal(steps[1].status, "todo");
  assert.equal(steps[4].href, "/billing?plan=pro");
}

{
  const steps = dashboardOnboardingSteps({ activeDevices: 1, tier: "pro" });
  assert.equal(steps.find((step) => step.id === "connect")?.status, "done");
  assert.equal(steps.find((step) => step.id === "upgrade")?.status, "done");
}
