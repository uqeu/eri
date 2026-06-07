import { strict as assert } from "node:assert";
import { resolveModelRoute } from "../inference/routing";

// Default (flag unset): everything is a passthrough — DeepSeek stays inert.
delete process.env.ERI_DEEPSEEK_FAST;
{
  const r = resolveModelRoute("anthropic", "claude-haiku-4-5");
  assert.equal(r.provider, "anthropic");
  assert.equal(r.model, "claude-haiku-4-5");
  assert.equal(r.rerouted, false);
}

// Flag on + fast-tier model => reroute to DeepSeek's Anthropic-format model.
process.env.ERI_DEEPSEEK_FAST = "true";
{
  const r = resolveModelRoute("anthropic", "claude-haiku-4-5");
  assert.equal(r.provider, "deepseek");
  assert.equal(r.model, "deepseek-v4-flash");
  assert.equal(r.rerouted, true);
}

// Flag on but NON-fast model (Sonnet) stays on Anthropic — only the fast tier
// is cheap-routed; the main builder keeps Claude quality.
{
  const r = resolveModelRoute("anthropic", "claude-sonnet-4-6");
  assert.equal(r.provider, "anthropic");
  assert.equal(r.rerouted, false);
}

// The explicit "fast" alias also reroutes when enabled.
{
  const r = resolveModelRoute("anthropic", "fast");
  assert.equal(r.provider, "deepseek");
  assert.equal(r.rerouted, true);
}

// Non-anthropic providers are never rerouted (Mercury/inception untouched).
{
  const r = resolveModelRoute("inception", "mercury-coder");
  assert.equal(r.provider, "inception");
  assert.equal(r.rerouted, false);
}

delete process.env.ERI_DEEPSEEK_FAST;

// eslint-disable-next-line no-console
console.log("routing.test.ts: all assertions passed");
