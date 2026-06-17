import { strict as assert } from "node:assert";
import { analyzeCommunicationStyle, MIN_MESSAGES_FOR_STYLE } from "../agent/style";

// Too few messages → null (eri writes naturally until it's learned the person).
{
  assert.equal(analyzeCommunicationStyle([]), null);
  assert.equal(analyzeCommunicationStyle(["hey", "sup"]), null);
}

// A casual, lowercase, emoji-heavy user → casual descriptor.
{
  const s = analyzeCommunicationStyle([
    "yo what's good",
    "lol nah i'm chillin 😎",
    "u wanna game later 🎮",
    "ngl that's fire",
    "bet 🔥",
  ]);
  assert.ok(s, "enough messages → a descriptor");
  assert.ok(s!.includes("lowercase"));
  assert.ok(/emoji/.test(s!));
  assert.ok(s!.includes("casual"));
}

// A formal, properly-capitalized, no-emoji user → formal descriptor.
{
  const s = analyzeCommunicationStyle([
    "Hello, how are you today?",
    "Could you please send me the report?",
    "Thank you very much for your help.",
    "I appreciate your prompt response.",
    "Let me know when you are available.",
  ]);
  assert.ok(s);
  assert.ok(s!.includes("capitalizes properly"));
  assert.ok(s!.includes("rarely uses emoji"));
  assert.ok(s!.includes("formal"));
}

// Sanity: the threshold constant is exposed and reasonable.
{
  assert.ok(MIN_MESSAGES_FOR_STYLE >= 3);
}

// eslint-disable-next-line no-console
console.log("style.test.ts: all assertions passed");
