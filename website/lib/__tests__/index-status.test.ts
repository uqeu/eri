import { strict as assert } from "node:assert";
import { summarizeIndex } from "../connections/index_status";
import { coerceRecallProjection } from "../memory/recall_contract";

// Not yet indexed (null projection) → zeros, empty sample, connected still echoed.
{
  const s = summarizeIndex(null, ["gmail"]);
  assert.deepEqual(s.connected, ["gmail"]);
  assert.equal(s.counts.entities, 0);
  assert.deepEqual(s.sample, []);
  assert.equal(s.updatedAt, null);
}

// A real projection → counts + byKind + top-salience sample + connected sorted.
{
  const p = coerceRecallProjection({
    asOf: 123,
    entities: [
      { id: "e1", kind: "person", name: "Priya", salience: 9 },
      { id: "e2", kind: "project", name: "atlas", salience: 8 },
      { id: "e3", kind: "person", name: "Sam", salience: 5 },
    ],
    relations: [{ src: "Priya", dst: "atlas", kind: "works_with" }],
    recentObservations: [{ text: "paired on atlas", ts: 1, kind: "fact" }],
    predictions: [],
    profile: {},
  });
  const s = summarizeIndex(p, ["googlecalendar", "gmail"]);
  assert.equal(s.counts.entities, 3);
  assert.equal(s.counts.relations, 1);
  assert.equal(s.counts.observations, 1);
  assert.equal(s.byKind.person, 2);
  assert.equal(s.byKind.project, 1);
  assert.equal(s.sample[0].name, "Priya", "highest salience first");
  assert.equal(s.sample.length, 3);
  assert.equal(s.updatedAt, 123);
  assert.deepEqual(s.connected, ["gmail", "googlecalendar"], "connected sorted");
}

// eslint-disable-next-line no-console
console.log("index-status.test.ts: all assertions passed");
