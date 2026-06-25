import { strict as assert } from "node:assert";
import {
  coerceRecallProjection,
  parseRecallUpload,
  MAX_ENTITIES,
  MAX_RECALL_BYTES,
} from "../memory/recall_contract";

async function run() {
  // A full, valid projection round-trips with its shape intact.
  {
    const p = coerceRecallProjection({
      version: 1,
      asOf: 1750000000000,
      entities: [
        { id: "e1", kind: "person", name: "Priya", salience: 7 },
        { id: "e2", kind: "project", name: "atlas", salience: 3 },
      ],
      relations: [{ src: "Priya", dst: "atlas", kind: "works_with" }],
      recentObservations: [{ text: "Paired with Priya on atlas", ts: 1749990000000, kind: "fact" }],
      predictions: [{ after: "open editor", next: "run tests", count: 4 }],
      profile: { facts: ["likes oat milk"], preferences: ["be brief"], communicationStyle: "lowercase", dynamicContext: "shipping today" },
    });
    assert.equal(p.version, 1);
    assert.equal(p.entities.length, 2);
    assert.equal(p.entities[0].name, "Priya", "sorted by salience desc");
    assert.equal(p.relations.length, 1);
    assert.equal(p.recentObservations[0].text, "Paired with Priya on atlas");
    assert.equal(p.predictions[0].next, "run tests");
    assert.deepEqual(p.profile.facts, ["likes oat milk"]);
    assert.equal(p.profile.communicationStyle, "lowercase");
  }

  // Empty / missing → safe defaults (a fresh user).
  {
    const p = coerceRecallProjection({});
    assert.equal(p.version, 1);
    assert.equal(p.asOf, 0);
    assert.deepEqual(p.entities, []);
    assert.deepEqual(p.relations, []);
    assert.deepEqual(p.recentObservations, []);
    assert.deepEqual(p.predictions, []);
    assert.deepEqual(p.profile, { facts: [], preferences: [], communicationStyle: "", dynamicContext: "" });
    // non-object → also empty, never throws
    assert.equal(coerceRecallProjection(null).entities.length, 0);
    assert.equal(coerceRecallProjection("nope").entities.length, 0);
  }

  // Malformed elements are dropped, not kept.
  {
    const p = coerceRecallProjection({
      entities: [{ name: "Real", salience: 1 }, { kind: "person" /* no name */ }, "garbage"],
    });
    assert.equal(p.entities.length, 1);
    assert.equal(p.entities[0].name, "Real");
  }

  // Relations referencing non-projected entities are dropped (no dangling — §1).
  {
    const p = coerceRecallProjection({
      entities: [{ name: "Priya", salience: 5 }],
      relations: [
        { src: "Priya", dst: "atlas", kind: "works_with" }, // atlas not an entity → dropped
        { src: "Priya", dst: "Priya", kind: "self" }, // both present → kept
      ],
    });
    assert.equal(p.relations.length, 1);
    assert.equal(p.relations[0].dst, "Priya");
  }

  // Predictions need count >= 2 (a learned chain, not a one-off).
  {
    const p = coerceRecallProjection({
      predictions: [
        { after: "a", next: "b", count: 1 }, // dropped
        { after: "c", next: "d", count: 3 }, // kept
      ],
    });
    assert.equal(p.predictions.length, 1);
    assert.equal(p.predictions[0].after, "c");
  }

  // Entities are capped.
  {
    const many = Array.from({ length: MAX_ENTITIES + 20 }, (_, i) => ({ name: `e${i}`, salience: i }));
    const p = coerceRecallProjection({ entities: many });
    assert.equal(p.entities.length, MAX_ENTITIES);
    assert.equal(p.entities[0].salience, MAX_ENTITIES + 19, "highest salience kept");
  }

  // parseRecallUpload — valid body canonicalizes; junk + oversize rejected.
  {
    const ok = parseRecallUpload({ entities: [{ name: "X", salience: 1 }] });
    assert.ok(ok.ok);
    if (ok.ok) {
      const reparsed = coerceRecallProjection(JSON.parse(ok.json));
      assert.equal(reparsed.entities[0].name, "X");
    }
    assert.deepEqual(parseRecallUpload(null), { ok: false, error: "missing_body" });
    assert.deepEqual(parseRecallUpload([]), { ok: false, error: "missing_body" });

    const huge = { recentObservations: Array.from({ length: 5000 }, () => ({ text: "x".repeat(200), ts: 1 })) };
    const big = parseRecallUpload(huge);
    // capped to MAX_OBSERVATIONS, so it should fit; build a genuinely oversize one via profile facts
    assert.ok(big.ok, "bounded arrays keep it under the ceiling");
    const oversize = parseRecallUpload({ profile: { dynamicContext: "y".repeat(MAX_RECALL_BYTES + 10) } });
    assert.deepEqual(oversize, { ok: false, error: "recall_too_large" });
  }

  // eslint-disable-next-line no-console
  console.log("recall-contract.test.ts: all assertions passed");
}

run();
