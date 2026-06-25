import { strict as assert } from "node:assert";
import { formatWorldModel } from "../messaging/recall";
import { coerceRecallProjection } from "../memory/recall_contract";

async function run() {
  // Null projection → everything empty (the phone falls back to TS recall).
  {
    const c = formatWorldModel(null);
    assert.deepEqual(c.facts, []);
    assert.deepEqual(c.dynamic, []);
    assert.equal(c.style, null);
  }

  // Relations render as natural sentences and lead the facts.
  {
    const p = coerceRecallProjection({
      entities: [
        { name: "Priya", kind: "person", salience: 9 },
        { name: "atlas", kind: "project", salience: 8 },
        { name: "Figma", kind: "app", salience: 2 },
      ],
      relations: [{ src: "Priya", dst: "atlas", kind: "works_with" }],
      recentObservations: [{ text: "Paired with Priya on atlas", ts: 2, kind: "fact" }],
      predictions: [{ after: "open editor", next: "run tests", count: 4 }],
      profile: { communicationStyle: "lowercase, brief", facts: [], preferences: [], dynamicContext: "" },
    });
    const c = formatWorldModel(p);
    assert.ok(c.facts.includes("Priya works with atlas"), "relation sentence present");
    // Figma is a standalone entity (not in a relation) → filled in as "name (kind)"
    assert.ok(c.facts.some((f) => f.includes("Figma")), "standalone entity included");
    assert.ok(c.dynamic.includes("Paired with Priya on atlas"), "observation in dynamic");
    assert.ok(c.dynamic.includes("After open editor, you usually run tests."), "prediction rendered");
    assert.equal(c.style, "lowercase, brief");
  }

  // No relations → entities still surface as standalone facts.
  {
    const p = coerceRecallProjection({ entities: [{ name: "Toronto", kind: "place", salience: 5 }] });
    const c = formatWorldModel(p);
    assert.ok(c.facts.some((f) => f.includes("Toronto")));
  }

  // eslint-disable-next-line no-console
  console.log("recall.test.ts: all assertions passed");
}

run();
