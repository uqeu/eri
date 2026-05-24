"use strict";
// Pure intent matcher for terminal voice control.
// Maps a free-form transcript to a structured intent against the current
// snapshot of terminals. No vscode imports — keeps this trivially testable.
Object.defineProperty(exports, "__esModule", { value: true });
exports.matchTerminalIntent = matchTerminalIntent;
const DEFAULT_MIN_SCORE = 0.3;
const PRONOUN_ACCEPT_SCORE = 1;
// Words we strip before tokenising to avoid them dominating the Jaccard score.
const STOP_WORDS = new Set([
    "a",
    "an",
    "and",
    "are",
    "as",
    "at",
    "be",
    "by",
    "can",
    "could",
    "do",
    "for",
    "from",
    "go",
    "have",
    "i",
    "if",
    "in",
    "into",
    "is",
    "just",
    "let",
    "me",
    "my",
    "of",
    "on",
    "or",
    "please",
    "the",
    "then",
    "to",
    "up",
    "want",
    "we",
    "with",
    "would",
    "you",
    "your",
]);
// Words whose presence indicates the speaker referred to "the current thing"
// rather than naming a specific terminal.
const PRONOUNS = new Set(["it", "this", "that", "there", "here"]);
// Verb cues that indicate the intent kind.
const FOCUS_VERBS = ["show", "open", "focus", "switch", "reveal", "see", "view"];
const KILL_VERBS = ["kill", "stop", "cancel", "terminate", "abort", "end", "ctrl-c", "ctrl"];
const SEND_VERBS = ["type", "run", "send", "enter"];
const SPAWN_VERBS = ["spawn", "launch", "start", "create", "load", "restore"];
const LAYOUT_NOUNS = ["layout", "stack", "recipe", "preset", "session"];
function matchTerminalIntent(rawTranscript, terminals, options = {}) {
    const transcript = (rawTranscript ?? "").toLowerCase().trim();
    if (transcript.length === 0) {
        return null;
    }
    const tokens = tokenise(transcript);
    if (tokens.length === 0) {
        return null;
    }
    const kind = classifyIntentKind(tokens, transcript);
    if (!kind) {
        return null;
    }
    if (kind === "spawn-layout") {
        const payload = extractLayoutPayload(transcript, tokens);
        if (!payload) {
            return null;
        }
        return { kind, payload, score: 1 };
    }
    // For send intents, prefer the explicit payload extracted from the
    // transcript before scoring terminals.
    let targetingTokens = tokens;
    let sendPayload;
    if (kind === "send") {
        const extracted = extractSendPayload(transcript);
        if (extracted) {
            sendPayload = extracted.payload;
            targetingTokens = tokenise(extracted.targetingHint);
        }
    }
    const minScore = options.minScore ?? DEFAULT_MIN_SCORE;
    const ranked = rankTerminals(targetingTokens, terminals);
    const best = ranked[0];
    // Pronoun + gaze fusion: resolve "it"/"this"/"that one" to the
    // gaze-attended terminal even when token overlap is too thin to claim.
    const hasPronoun = tokens.some((t) => PRONOUNS.has(t));
    if ((!best || best.score < minScore) && hasPronoun && options.gazeAttendedTerminalId) {
        const result = {
            kind,
            terminalId: options.gazeAttendedTerminalId,
            score: PRONOUN_ACCEPT_SCORE,
            resolvedViaGaze: true,
        };
        if (kind === "send" && sendPayload) {
            return { ...result, payload: sendPayload };
        }
        return result;
    }
    if (!best || best.score < minScore) {
        return null;
    }
    const match = {
        kind,
        terminalId: best.terminal.id,
        score: best.score,
    };
    if (kind === "send" && sendPayload) {
        return { ...match, payload: sendPayload };
    }
    return match;
}
function rankTerminals(transcriptTokens, terminals) {
    const verbTokens = new Set([
        ...FOCUS_VERBS,
        ...KILL_VERBS,
        ...SEND_VERBS,
        ...SPAWN_VERBS,
        ...LAYOUT_NOUNS,
        ...PRONOUNS,
    ]);
    const transcriptSet = new Set(transcriptTokens.filter((t) => !STOP_WORDS.has(t) && !verbTokens.has(t)));
    const scored = terminals.map((terminal) => ({
        terminal,
        score: jaccard(transcriptSet, terminalTokens(terminal)),
    }));
    scored.sort((a, b) => {
        if (b.score !== a.score) {
            return b.score - a.score;
        }
        const aActive = a.terminal.lastActiveAt ?? 0;
        const bActive = b.terminal.lastActiveAt ?? 0;
        return bActive - aActive;
    });
    return scored;
}
function terminalTokens(terminal) {
    // We deliberately exclude cwd because long path tokens (e.g. "tmp",
    // "users", "khai") dilute the Jaccard score with words the user never
    // says. Group is included only when it's user-supplied (non-default).
    const parts = [terminal.name];
    if (terminal.group && terminal.group !== "default") {
        parts.push(terminal.group);
    }
    if (terminal.lastCommand) {
        parts.push(terminal.lastCommand);
    }
    const recentBlocks = terminal.blocks.slice(-5);
    for (const block of recentBlocks) {
        parts.push(block.command);
    }
    const all = parts.join(" ");
    return new Set(tokenise(all).filter((t) => !STOP_WORDS.has(t)));
}
function jaccard(a, b) {
    if (a.size === 0 || b.size === 0) {
        return 0;
    }
    let intersection = 0;
    const [smaller, larger] = a.size <= b.size ? [a, b] : [b, a];
    for (const token of smaller) {
        if (larger.has(token)) {
            intersection += 1;
        }
    }
    const union = a.size + b.size - intersection;
    return union === 0 ? 0 : intersection / union;
}
function classifyIntentKind(tokens, transcript) {
    const hasLayoutNoun = tokens.some((t) => LAYOUT_NOUNS.includes(t));
    if (hasLayoutNoun &&
        tokens.some((t) => SPAWN_VERBS.includes(t) || FOCUS_VERBS.includes(t))) {
        return "spawn-layout";
    }
    if (tokens.some((t) => KILL_VERBS.includes(t)) || transcript.includes("ctrl-c") || transcript.includes("ctrl c")) {
        return "kill";
    }
    if (tokens.some((t) => SEND_VERBS.includes(t))) {
        if (extractSendPayload(transcript)) {
            return "send";
        }
        if (tokens.some((t) => FOCUS_VERBS.includes(t))) {
            return "focus";
        }
        return "focus";
    }
    if (tokens.some((t) => FOCUS_VERBS.includes(t))) {
        return "focus";
    }
    if (tokens.some((t) => SPAWN_VERBS.includes(t))) {
        return "spawn-layout";
    }
    return null;
}
function extractLayoutPayload(transcript, tokens) {
    const verbIndex = tokens.findIndex((t) => SPAWN_VERBS.includes(t) || FOCUS_VERBS.includes(t));
    const start = verbIndex === -1 ? 0 : verbIndex + 1;
    const tail = tokens.slice(start).filter((t) => {
        if (STOP_WORDS.has(t)) {
            return false;
        }
        if (LAYOUT_NOUNS.includes(t)) {
            return false;
        }
        return true;
    });
    if (tail.length > 0) {
        return tail.join(" ");
    }
    const layoutNounIdx = tokens.findIndex((t) => LAYOUT_NOUNS.includes(t));
    if (layoutNounIdx > 0) {
        const prev = tokens[layoutNounIdx - 1];
        if (prev && !STOP_WORDS.has(prev)) {
            return prev;
        }
    }
    const stripped = tokens
        .filter((t) => !STOP_WORDS.has(t) &&
        !SPAWN_VERBS.includes(t) &&
        !FOCUS_VERBS.includes(t))
        .join(" ");
    // Silence unused param lint — transcript is intentionally a parameter to keep
    // the helper symmetric with extractSendPayload.
    void transcript;
    return stripped.length > 0 ? stripped : null;
}
function extractSendPayload(transcript) {
    // Two grammatical shapes:
    //   1. "in the dev terminal type cargo check"
    //      target = "in the dev terminal", payload = "cargo check"
    //   2. "run cargo test in the rust shell"
    //      payload = "cargo test", target = "in the rust shell"
    const verbPattern = /\b(type|send|run|enter)\b\s+/i;
    const verbMatch = verbPattern.exec(transcript);
    if (!verbMatch) {
        return null;
    }
    const verbStart = verbMatch.index;
    const afterVerb = transcript.slice(verbStart + verbMatch[0].length).trim();
    if (afterVerb.length === 0) {
        return null;
    }
    const targetSplit = /\s+(?:in|into|on)\s+the\s+/i.exec(afterVerb);
    if (targetSplit) {
        const payload = afterVerb.slice(0, targetSplit.index).trim();
        const targetTail = afterVerb.slice(targetSplit.index + targetSplit[0].length).trim();
        const preVerb = transcript.slice(0, verbStart).trim();
        const hint = [preVerb, targetTail].filter((s) => s.length > 0).join(" ");
        if (payload.length === 0) {
            return null;
        }
        return { payload, targetingHint: hint };
    }
    // Reverse shape: "in the dev terminal type cargo check" — the targeting
    // hint lives BEFORE the verb, payload AFTER.
    const preVerb = transcript.slice(0, verbStart).trim();
    if (preVerb.length > 0) {
        return { payload: afterVerb, targetingHint: preVerb };
    }
    return { payload: afterVerb, targetingHint: "" };
}
function tokenise(text) {
    const out = [];
    const lowered = text.toLowerCase();
    let current = "";
    for (let i = 0; i < lowered.length; i += 1) {
        const ch = lowered.charCodeAt(i);
        const isAlnum = (ch >= 48 && ch <= 57) ||
            (ch >= 97 && ch <= 122) ||
            ch === 45 ||
            ch === 95;
        if (isAlnum) {
            current += lowered[i];
        }
        else if (current.length > 0) {
            out.push(current);
            current = "";
        }
    }
    if (current.length > 0) {
        out.push(current);
    }
    return out;
}
//# sourceMappingURL=intentMatcher.js.map