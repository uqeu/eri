/**
 * Coding-intent classification for phone eri — Phase 3, slice P1 ([[eri-phase3]]).
 *
 * The wedge: text eri a coding task → eri opens a real, tested PR. Before any of
 * that can run, the inbound path has to decide "is THIS message a coding task?"
 * and hand only those to the brain's CodeTurn job — everything else stays normal
 * chat. This is that decision, as a pure, exhaustively-tested classifier.
 *
 * Design bias: CONSERVATIVE. A false positive routes a life-admin text ("fix my
 * dinner reservation", "add milk") into a coding job — bad UX — so a coding task
 * requires BOTH a code-domain signal (repo / PR / test / build / function / a
 * source file …) AND an action verb. The lone exception is "open a PR", which is
 * itself an unambiguous coding signal. Repo extraction is best-effort; a null repo
 * is fine — the connect-flow (P4) resolves the actual target later.
 *
 * Pure + unit-tested. No IO, no model call — it's regex over the message text.
 */

/** The dominant action in a coding task — carried to the CodeTurn payload + telemetry. */
export type CodingVerb = "fix" | "add" | "refactor" | "test" | "review" | "open_pr" | "other";

export interface CodingIntent {
  /** The task text (the user's message, trimmed) — handed to the brain verbatim. */
  task: string;
  /** The dominant action verb detected (best-effort; "other" when a domain signal
   *  is present but the verb is ambiguous). */
  verb: CodingVerb;
  /** A repo hint if the user named one ("in eri", "the checkout repo", owner/repo,
   *  a github URL) — else null (P4 connect-flow resolves the target). */
  repo: string | null;
  /** Rough 0..1 confidence; higher when more/stronger cues co-occur. Advisory —
   *  routing uses the boolean (non-null) result, not this. */
  confidence: number;
}

// "open/make/submit/raise/create a PR" — a standalone coding signal (no other cue needed).
const PR_PHRASE =
  /\b(open|make|submit|raise|create|put\s*up|send|start)\s+(?:up\s+)?(?:a|an|the)?\s*(?:pull\s*requests?|prs?)\b/i;

// Action-verb groups, in mapping-precedence order (first match wins).
const FIX = /\b(fix(es|ed|ing)?|debug(s|ged|ging)?|patch(es|ed|ing)?|repair(s|ed|ing)?|resolv(e|es|ed|ing)|squash(es|ed|ing)?|revert(s|ed|ing)?|unbreak|troubleshoot)\b/i;
const TEST_VERB = /\b(write|add|create|cover|increase)\b[^.]*\btests?\b|\b(unit|integration|e2e|regression)\s+tests?\b/i;
const REFACTOR = /\b(refactor(s|ed|ing)?|renam(e|es|ed|ing)|rewrit(e|es|ing)|rewrote|clean\s*up|simplif(y|ies|ied|ying)|extract(s|ed|ing)?|restructure|modulari[sz]e|deduplicate)\b/i;
const REVIEW = /\b(review(s|ed|ing)?|address(es|ed|ing)?)\b/i;
const ADD = /\b(add(s|ed|ing)?|implement(s|ed|ing)?|introduc(e|es|ed|ing)|creat(e|es|ed|ing)|build(s|t|ing)?|writ(e|es|ing)|wrote|wire\s*up|hook\s*up|integrat(e|es|ed|ing)|install(s|ed|ing)?|set\s*up|scaffold|generate|support)\b/i;
const OTHER_ACTION = /\b(bump(s|ed|ing)?|upgrad(e|es|ed|ing)|updat(e|es|ed|ing)|migrat(e|es|ed|ing)|deploy(s|ed|ing)?|optimi[sz]e|configur(e|es|ed|ing)|remov(e|es|ed|ing)|delet(e|es|ed|ing)|merg(e|es|ed|ing)|ship(s|ped|ping)?|close(s|d)?|enable(s|d)?|disable(s|d)?|port(s|ed|ing)?|expose(s|d)?|validate|sanitize|cache)\b/i;

// A code-domain signal. Deliberately excludes ambiguous life-admin words (class,
// method, table) that collide with "yoga class" / "payment method" / "book a table".
const DOMAIN = new RegExp(
  [
    // VCS / repos / PRs
    "\\brepos?(itory|itories)?\\b",
    "\\bpull\\s*requests?\\b",
    "\\bprs?\\b",
    "\\bbranch(es)?\\b",
    "\\bcommits?\\b",
    "\\bmerge\\s*conflicts?\\b",
    "\\brebase\\b",
    "\\bgit(hub|lab)?\\b",
    "\\bcodebase\\b|\\bcode\\s*base\\b|\\bsource\\s*code\\b",
    // failures / bugs
    "\\bbugs?\\b",
    "\\bregressions?\\b",
    "\\bstack\\s*traces?\\b|\\btracebacks?\\b",
    "\\bexceptions?\\b",
    "\\bnull[- ]?(cart|pointer|ref|reference)?\\b",
    // tests / build / CI
    "\\b(unit|integration|e2e|regression)\\s+tests?\\b",
    "\\bfailing\\s+tests?\\b",
    "\\btests?\\s+(is|are|keep|kept|were|was)\\s+(failing|passing|broken|red|green)\\b",
    "\\btests?\\s+(fail|pass|break|broke|broken)\\b",
    "\\bthe\\s+build\\b|\\bbuild\\s+(is|was|keeps?|failing|broke|broken|error|red|green|passing)\\b",
    "\\bci\\b|\\bci/cd\\b|\\bpipelines?\\b",
    "\\blint(er|ing)?\\b|\\btype\\s*check\\b|\\btype\\s*error\\b|\\bcompil(e|es|ing|er|ation)\\b",
    "\\bdeploys?\\b|\\bdeployment\\b",
    // code structure
    "\\bfunctions?\\b|\\bendpoints?\\b|\\bapi(\\s*route)?s?\\b|\\bcomponents?\\b|\\bmodules?\\b",
    "\\bvariables?\\b|\\bimports?\\b|\\bdependenc(y|ies)\\b|\\bpackages?\\b|\\bnpm\\b|\\bcargo\\b|\\byarn\\b|\\bpnpm\\b",
    "\\bmigrations?\\b|\\bschema\\b|\\bquer(y|ies)\\b|\\bdatabase\\b",
    // files / languages / frameworks
    "\\.(ts|tsx|js|jsx|mjs|cjs|rs|py|go|java|rb|php|cpp|css|scss|html|json|ya?ml|toml|sql|sh)\\b",
    "\\btypescript\\b|\\bjavascript\\b|\\bpython\\b|\\brust\\b|\\bgolang\\b|\\breact\\b|\\bnext\\.?js\\b|\\bnode(\\.?js)?\\b|\\bswift\\b|\\bkotlin\\b",
  ].join("|"),
  "i",
);

/** Slug halves that are English "x/y" idioms or tech pairs, never a repo. */
const STOP_SLUG = new Set([
  "and", "or", "either", "his", "her", "he", "she", "him", "async", "await",
  "tcp", "ip", "ci", "cd", "n", "a", "w", "os", "either", "yes", "no", "on", "off",
]);

/** Words after a bare "in ___" that are common English idioms, not a repo name. */
const STOP_REPO_WORDS = new Set([
  "the", "my", "your", "our", "this", "that", "these", "those", "a", "an", "it", "its",
  "here", "there", "api", "code", "repo", "main", "master", "prod", "production",
  "staging", "dev", "place", "order", "town", "stock", "store", "person", "time",
  "general", "fact", "front", "back", "love", "touch", "charge", "mind", "control",
  "case", "short", "advance", "return", "sync", "common", "total", "doubt", "line",
  "question", "particular", "addition", "hand", "favor", "favour",
]);

interface RepoHint {
  repo: string;
  /** Strong = an explicit repo reference (URL, owner/repo slug, "X repo"); weak =
   *  a bare "in <name>" guess. Only a strong hint can trigger coding on its own. */
  strong: boolean;
}

function stripGitSuffix(seg: string): string {
  return seg.replace(/\.git$/i, "");
}

function isRepoSlug(owner: string, repo: string): boolean {
  const a = owner.toLowerCase();
  const b = repo.toLowerCase();
  if (STOP_SLUG.has(a) || STOP_SLUG.has(b)) return false;
  if (/^\d+$/.test(owner) && /^\d+$/.test(repo)) return false; // "24/7"
  if (/\.[a-z0-9]+$/i.test(repo)) return false; // a file path like src/index.ts
  return true;
}

/** Best-effort repo hint from the message. Order = strongest form first. */
function extractRepoHint(text: string): RepoHint | null {
  // 1. A github/gitlab URL → first two path segments.
  const url = text.match(/(?:github|gitlab)\.com\/([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+)/i);
  if (url) return { repo: `${url[1]}/${stripGitSuffix(url[2])}`, strong: true };

  // 2. "<name> repo" / "repo <name>" / "repository <name>" — explicit repo word.
  const namedBefore = text.match(/\b(?:in|on|for|to|the)\s+(?:the\s+)?([A-Za-z][\w.-]*)\s+repo(?:sitory)?\b/i);
  if (namedBefore) return { repo: namedBefore[1], strong: true };
  const namedAfter = text.match(/\brepo(?:sitory)?\s+([A-Za-z][\w.-]*)/i);
  if (namedAfter) return { repo: namedAfter[1], strong: true };

  // 3. A bare owner/repo slug (not a URL, not a file path, not an English idiom).
  const slug = text.match(/(?<![\/\w.])([a-z0-9][a-z0-9._-]*)\/([a-z0-9][a-z0-9._-]+)(?![\/\w])/i);
  if (slug && isRepoSlug(slug[1], slug[2])) return { repo: `${slug[1]}/${stripGitSuffix(slug[2])}`, strong: true };

  // 4. Last resort: a bare "in <name>" guess, guarded by the idiom stoplist.
  const inName = text.match(/\bin\s+(?:the\s+)?([a-z][a-z0-9._-]{1,30})\b/i);
  if (inName && !STOP_REPO_WORDS.has(inName[1].toLowerCase())) {
    return { repo: inName[1], strong: false };
  }
  return null;
}

/** The dominant action verb, mapped to a CodingVerb; null when no action is present. */
function detectVerb(text: string): CodingVerb | null {
  if (PR_PHRASE.test(text)) return "open_pr";
  if (FIX.test(text)) return "fix";
  if (TEST_VERB.test(text)) return "test";
  if (REFACTOR.test(text)) return "refactor";
  if (REVIEW.test(text)) return "review";
  if (ADD.test(text)) return "add";
  if (OTHER_ACTION.test(text)) return "other";
  return null;
}

/**
 * Classify an inbound message as a coding task or normal chat.
 *
 * Returns a `CodingIntent` when the message is a coding task — an action verb over
 * a code-domain signal (or a strong repo reference), or an "open a PR" phrase.
 * Returns `null` for everything else, which the inbound path answers as normal chat.
 */
export function classifyCodingIntent(text: string): CodingIntent | null {
  const task = text.trim();
  if (!task) return null;

  const verb = detectVerb(task);
  if (!verb) return null;

  const hasDomain = DOMAIN.test(task);
  const repoHint = extractRepoHint(task);
  const strongRepo = repoHint?.strong ?? false;

  // "open a PR" stands alone; otherwise require a domain signal or a strong repo
  // reference, so a bare life-admin verb ("add milk", "fix dinner") never triggers.
  const isCoding = verb === "open_pr" || hasDomain || strongRepo;
  if (!isCoding) return null;

  let confidence = 0.5;
  if (hasDomain) confidence += 0.2;
  if (strongRepo) confidence += 0.25;
  else if (repoHint) confidence += 0.1;
  if (verb === "open_pr") confidence = Math.max(confidence, 0.85);
  confidence = Math.min(1, Math.round(confidence * 100) / 100);

  return { task, verb, repo: repoHint?.repo ?? null, confidence };
}
