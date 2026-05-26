import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { PERSONAS, TEMPLATES } from "./catalog.js";

describe("wizard catalog", () => {
  it("ships at least 7 personas", () => {
    assert.ok(PERSONAS.length >= 7);
    const names = PERSONAS.map((p) => p.name);
    for (const required of ["eri", "coder", "architect", "tester"]) {
      assert.ok(names.includes(required), `missing persona: ${required}`);
    }
  });

  it("ships at least 8 templates", () => {
    assert.ok(TEMPLATES.length >= 8);
    const slugs = TEMPLATES.map((t) => t.slug);
    for (const required of ["saas-next", "api-rust", "api-python"]) {
      assert.ok(slugs.includes(required), `missing template: ${required}`);
    }
  });

  it("each template names at least one tech in its stack", () => {
    for (const t of TEMPLATES) {
      assert.ok(t.stack.length > 0, `template ${t.slug} has empty stack`);
    }
  });
});
