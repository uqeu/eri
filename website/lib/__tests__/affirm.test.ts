import { strict as assert } from "node:assert";
import { isAffirmation, isNegation } from "../imessage/affirm";

// Natural affirmations — however a person says "yes, go".
for (const yes of ["yes", "Yes", "yeah", "yep", "go", "go ahead", "do it", "confirm", "sure", "ok", "okay", "sounds good", "please do", "let's go", "👍", "yes please!"]) {
  assert.equal(isAffirmation(yes), true, `should affirm: ${yes}`);
}

// Natural negations.
for (const no of ["no", "nope", "nah", "don't", "cancel", "stop", "nevermind", "no thanks", "👎"]) {
  assert.equal(isNegation(no), true, `should negate: ${no}`);
}

// A normal message is NEITHER — confirmation must not trigger on real sentences.
for (const msg of ["yes do you know what time it is", "no idea what that is", "what was I working on?", "can you go to the store list", "okay so here's the thing"]) {
  assert.equal(isAffirmation(msg), false, `not an affirmation: ${msg}`);
  assert.equal(isNegation(msg), false, `not a negation: ${msg}`);
}

// eslint-disable-next-line no-console
console.log("affirm.test.ts: all assertions passed");
