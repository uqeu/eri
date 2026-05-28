"use strict";
// Phase 23c — full preferences schema. ~110 optional fields across 14
// categories. Mirrors the plan's PRD spec; the sidecar treats the
// document opaquely (any JSON) so the schema evolves IDE-side without
// requiring a sidecar restart.
//
// Each field carries a (category, key, kind, options?, default) tuple
// so the dashboard editor + onboarding flow can render the same set
// without duplicating the catalog.
Object.defineProperty(exports, "__esModule", { value: true });
exports.PREFERENCE_FIELDS = void 0;
exports.fieldsByCategory = fieldsByCategory;
exports.totalFieldCount = totalFieldCount;
const enumKind = (values) => ({
    kind: "enum",
    values,
});
const stringArrayKind = { kind: "stringArray" };
exports.PREFERENCE_FIELDS = [
    // ---------------- stack (about 30 fields) ----------------
    { category: "stack", path: "stack.frontend", label: "Frontend", kind: enumKind(["next", "vite-react", "astro", "remix", "solidstart", "qwik", "svelte-kit", "nuxt", "expo"]) },
    { category: "stack", path: "stack.ui", label: "UI library", kind: enumKind(["shadcn", "tailwind-only", "mantine", "chakra", "mui", "ant", "tamagui", "park-ui"]) },
    { category: "stack", path: "stack.css", label: "CSS approach", kind: enumKind(["tailwind", "css-modules", "vanilla-extract", "panda", "styled-components", "emotion", "uno"]) },
    { category: "stack", path: "stack.iconLibrary", label: "Icons", kind: enumKind(["lucide", "heroicons", "phosphor", "tabler", "radix-icons", "feather", "carbon"]) },
    { category: "stack", path: "stack.fonts.sans", label: "Sans-serif font", kind: enumKind(["inter", "geist", "satoshi", "space-grotesk", "manrope", "system"]) },
    { category: "stack", path: "stack.fonts.mono", label: "Monospace font", kind: enumKind(["geist-mono", "jetbrains-mono", "fira-code", "ibm-plex-mono", "berkeley"]) },
    { category: "stack", path: "stack.fonts.display", label: "Display font", kind: enumKind(["funnel-display", "fraunces", "instrument-serif", "tobias", "none"]) },
    { category: "stack", path: "stack.fonts.serif", label: "Serif font", kind: enumKind(["ibm-plex-serif", "lora", "merriweather", "tiempos", "none"]) },
    { category: "stack", path: "stack.stateMgmt", label: "State management", kind: enumKind(["zustand", "jotai", "redux-toolkit", "valtio", "mobx", "context", "tanstack-query-only"]) },
    { category: "stack", path: "stack.forms", label: "Forms", kind: enumKind(["react-hook-form", "formik", "tanstack-form", "conform", "uncontrolled"]) },
    { category: "stack", path: "stack.validation", label: "Validation", kind: enumKind(["zod", "yup", "valibot", "io-ts", "ajv", "joi"]) },
    { category: "stack", path: "stack.animation", label: "Animation", kind: enumKind(["framer-motion", "auto-animate", "motion-one", "css-only", "react-spring"]) },
    { category: "stack", path: "stack.dataFetch", label: "Data fetching", kind: enumKind(["tanstack-query", "swr", "rtk-query", "fetch-only", "trpc", "graphql-client"]) },
    { category: "stack", path: "stack.router", label: "Router", kind: enumKind(["next-router", "tanstack-router", "react-router", "wouter", "file-based"]) },
    { category: "stack", path: "stack.auth", label: "Auth", kind: enumKind(["next-auth", "clerk", "supabase-auth", "lucia", "better-auth", "custom"]) },
    { category: "stack", path: "stack.backend", label: "Backend", kind: enumKind(["next-api", "axum", "fastapi", "express", "fastify", "hono", "go-chi", "rails", "django"]) },
    { category: "stack", path: "stack.db", label: "Database", kind: enumKind(["postgres", "mysql", "sqlite", "mongodb", "cockroach", "planetscale", "neon", "supabase"]) },
    { category: "stack", path: "stack.orm", label: "ORM", kind: enumKind(["drizzle", "prisma", "kysely", "sqlx", "diesel", "sea-orm", "raw-sql", "sqlalchemy"]) },
    { category: "stack", path: "stack.queue", label: "Queue", kind: enumKind(["bullmq", "inngest", "trigger.dev", "temporal", "celery", "sidekiq", "none"]) },
    { category: "stack", path: "stack.cache", label: "Cache", kind: enumKind(["redis", "upstash", "memcached", "in-memory", "none"]) },
    { category: "stack", path: "stack.email", label: "Email", kind: enumKind(["resend", "postmark", "sendgrid", "ses", "loops", "react-email", "none"]) },
    { category: "stack", path: "stack.payments", label: "Payments", kind: enumKind(["stripe", "lemon-squeezy", "paddle", "polar", "none"]) },
    { category: "stack", path: "stack.analytics", label: "Analytics", kind: enumKind(["posthog", "plausible", "umami", "fathom", "mixpanel", "amplitude", "none"]) },
    { category: "stack", path: "stack.monitoring", label: "Monitoring", kind: enumKind(["sentry", "datadog", "betterstack", "highlight", "axiom", "none"]) },
    { category: "stack", path: "stack.logging", label: "Logging", kind: enumKind(["pino", "winston", "log-slog", "tracing", "loguru", "console-only"]) },
    { category: "stack", path: "stack.tracing", label: "Tracing", kind: enumKind(["opentelemetry", "datadog-apm", "honeycomb", "none"]) },
    { category: "stack", path: "stack.deployment", label: "Deployment", kind: enumKind(["vercel", "netlify", "cloudflare", "fly", "railway", "render", "self-host", "k8s"]) },
    { category: "stack", path: "stack.container", label: "Container", kind: enumKind(["docker", "buildpacks", "nixpacks", "none"]) },
    { category: "stack", path: "stack.ci", label: "CI", kind: enumKind(["github-actions", "circleci", "gitlab-ci", "buildkite", "earthly", "none"]) },
    { category: "stack", path: "stack.packageManager", label: "Package manager", kind: enumKind(["pnpm", "npm", "yarn", "bun", "deno"]) },
    { category: "stack", path: "stack.monorepo", label: "Monorepo", kind: enumKind(["turbo", "nx", "moon", "rush", "none"]) },
    { category: "stack", path: "stack.cdn", label: "CDN", kind: enumKind(["cloudflare", "vercel", "fastly", "bunny", "none"]) },
    // ---------------- testing ----------------
    { category: "testing", path: "testing.unitFramework", label: "Unit framework", kind: enumKind(["vitest", "jest", "node-test", "deno-test", "bun-test", "mocha", "pytest", "go-test", "cargo-test"]) },
    { category: "testing", path: "testing.e2eFramework", label: "E2E framework", kind: enumKind(["playwright", "cypress", "puppeteer", "selenium", "none"]) },
    { category: "testing", path: "testing.componentTests", label: "Component tests", kind: enumKind(["testing-library", "storybook-test", "playwright-ct", "none"]) },
    { category: "testing", path: "testing.mockingLib", label: "Mocking", kind: enumKind(["msw", "vi-mock", "nock", "mockoon", "wiremock"]) },
    { category: "testing", path: "testing.coverageThreshold", label: "Coverage %", kind: "number" },
    { category: "testing", path: "testing.coverageTool", label: "Coverage tool", kind: enumKind(["v8", "istanbul", "tarpaulin", "coverage.py"]) },
    { category: "testing", path: "testing.snapshotPolicy", label: "Snapshots", kind: enumKind(["inline", "external", "off"]) },
    { category: "testing", path: "testing.preCommitRun", label: "Pre-commit", kind: enumKind(["lint+typecheck", "lint", "tests", "none"]) },
    // ---------------- codeStyle ----------------
    { category: "codeStyle", path: "codeStyle.formatter", label: "Formatter", kind: enumKind(["prettier", "biome", "dprint", "rustfmt", "black", "gofmt"]) },
    { category: "codeStyle", path: "codeStyle.linter", label: "Linter", kind: enumKind(["eslint", "biome", "oxlint", "ruff", "clippy", "golangci-lint"]) },
    { category: "codeStyle", path: "codeStyle.linterConfig", label: "Lint config", kind: enumKind(["airbnb", "standard", "next", "antfu", "xo", "custom"]) },
    { category: "codeStyle", path: "codeStyle.indentation", label: "Indentation", kind: enumKind(["spaces:2", "spaces:4", "tabs"]) },
    { category: "codeStyle", path: "codeStyle.lineLength", label: "Line length", kind: enumKind(["80", "100", "120", "160"]) },
    { category: "codeStyle", path: "codeStyle.quoteStyle", label: "Quotes", kind: enumKind(["single", "double", "backtick-preferred"]) },
    { category: "codeStyle", path: "codeStyle.semicolons", label: "Semicolons", kind: "boolean" },
    { category: "codeStyle", path: "codeStyle.trailingComma", label: "Trailing comma", kind: enumKind(["all", "es5", "none"]) },
    { category: "codeStyle", path: "codeStyle.bracketSpacing", label: "Bracket spacing", kind: "boolean" },
    { category: "codeStyle", path: "codeStyle.arrowParens", label: "Arrow parens", kind: enumKind(["always", "avoid"]) },
    { category: "codeStyle", path: "codeStyle.endOfLine", label: "EOL", kind: enumKind(["lf", "crlf", "auto"]) },
    // ---------------- naming ----------------
    { category: "naming", path: "naming.files", label: "File names", kind: enumKind(["kebab-case", "PascalCase", "camelCase", "snake_case"]) },
    { category: "naming", path: "naming.functions", label: "Functions", kind: enumKind(["camelCase", "snake_case"]) },
    { category: "naming", path: "naming.variables", label: "Variables", kind: enumKind(["camelCase", "snake_case"]) },
    { category: "naming", path: "naming.constants", label: "Constants", kind: enumKind(["SCREAMING_SNAKE_CASE", "camelCase"]) },
    { category: "naming", path: "naming.types", label: "Types", kind: enumKind(["PascalCase"]) },
    { category: "naming", path: "naming.interfaces", label: "Interfaces", kind: enumKind(["PascalCase", "IPrefix"]) },
    { category: "naming", path: "naming.enums", label: "Enums", kind: enumKind(["PascalCase"]) },
    { category: "naming", path: "naming.hooks", label: "Hooks", kind: enumKind(["useCamelCase"]) },
    { category: "naming", path: "naming.events", label: "Event handlers", kind: enumKind(["onPascalCase", "handlePascalCase"]) },
    { category: "naming", path: "naming.boolPrefix", label: "Boolean prefix", kind: enumKind(["is", "has", "should", "any"]) },
    { category: "naming", path: "naming.noAbbreviations", label: "Forbid abbreviations", kind: "boolean" },
    // ---------------- fileOrg ----------------
    { category: "fileOrg", path: "fileOrg.structure", label: "Structure", kind: enumKind(["by-feature", "by-type", "by-domain"]) },
    { category: "fileOrg", path: "fileOrg.srcRoot", label: "src root", kind: enumKind(["src", "lib", "app", "none"]) },
    { category: "fileOrg", path: "fileOrg.monorepo", label: "Monorepo layout", kind: enumKind(["none", "apps+packages", "apps+libs"]) },
    { category: "fileOrg", path: "fileOrg.componentLocation", label: "Component location", kind: enumKind(["co-located", "components-dir", "feature-dir"]) },
    { category: "fileOrg", path: "fileOrg.testLocation", label: "Test location", kind: enumKind(["co-located", "__tests__-dir", "tests-dir", "test-mirror"]) },
    { category: "fileOrg", path: "fileOrg.barrelFiles", label: "Barrel files", kind: "boolean" },
    { category: "fileOrg", path: "fileOrg.absImports", label: "Absolute imports", kind: "boolean" },
    { category: "fileOrg", path: "fileOrg.absImportRoot", label: "Absolute import root", kind: enumKind(["@", "~", "src", "@app"]) },
    // ---------------- comments ----------------
    { category: "comments", path: "comments.publicApiDocs", label: "Public API docs", kind: enumKind(["required", "preferred", "off"]) },
    { category: "comments", path: "comments.format", label: "Doc format", kind: enumKind(["jsdoc", "tsdoc", "rustdoc", "google-pydoc", "numpy-pydoc", "godoc"]) },
    { category: "comments", path: "comments.inlinePolicy", label: "Inline comments", kind: enumKind(["explain-why-only", "minimal", "verbose"]) },
    { category: "comments", path: "comments.todoFormat", label: "TODO format", kind: enumKind(["TODO", "TODO(name)", "FIXME"]) },
    { category: "comments", path: "comments.headerComments", label: "Header comments", kind: enumKind(["off", "spdx-license", "company-copyright"]) },
    // ---------------- git ----------------
    { category: "git", path: "git.commitFormat", label: "Commit format", kind: enumKind(["conventional", "gitmoji", "free-form"]) },
    { category: "git", path: "git.commitScope", label: "Commit scope", kind: enumKind(["lowercase", "PascalCase", "off"]) },
    { category: "git", path: "git.commitBody", label: "Commit body", kind: enumKind(["always", "for-non-trivial", "rare"]) },
    { category: "git", path: "git.branchPrefix", label: "Branch prefix", kind: enumKind(["khai/", "feat/", "user/", "none"]) },
    { category: "git", path: "git.mergeStyle", label: "Merge style", kind: enumKind(["squash", "merge", "rebase"]) },
    { category: "git", path: "git.signCommits", label: "Sign commits", kind: "boolean" },
    { category: "git", path: "git.coAuthorsOnPair", label: "Co-authors on pair", kind: "boolean" },
    { category: "git", path: "git.prTemplate", label: "PR template", kind: enumKind(["summary+test-plan", "minimal", "custom"]) },
    { category: "git", path: "git.autoOpenPr", label: "Auto-open PR", kind: "boolean" },
    { category: "git", path: "git.prDraftFirst", label: "Draft PRs first", kind: "boolean" },
    // ---------------- docs ----------------
    { category: "docs", path: "docs.readmeStructure", label: "README", kind: enumKind(["claude-style", "stripe-style", "minimal", "thorough"]) },
    { category: "docs", path: "docs.changelog", label: "Changelog", kind: enumKind(["keepachangelog", "commit-derived", "off"]) },
    { category: "docs", path: "docs.adr", label: "ADR", kind: enumKind(["lightweight", "MADR", "off"]) },
    { category: "docs", path: "docs.apiDocs", label: "API docs", kind: enumKind(["auto-generated", "hand-written", "none"]) },
    { category: "docs", path: "docs.screenshots", label: "Screenshots", kind: enumKind(["always", "on-significant-ui-change", "never"]) },
    // ---------------- a11y ----------------
    { category: "a11y", path: "a11y.level", label: "WCAG level", kind: enumKind(["WCAG-AA", "WCAG-AAA", "best-effort"]) },
    { category: "a11y", path: "a11y.minContrast", label: "Min contrast", kind: "number" },
    { category: "a11y", path: "a11y.altTextRequired", label: "Alt text required", kind: "boolean" },
    { category: "a11y", path: "a11y.keyboardNavRequired", label: "Keyboard nav", kind: "boolean" },
    { category: "a11y", path: "a11y.reducedMotion", label: "Reduced motion", kind: enumKind(["respect", "ignore"]) },
    // ---------------- performance ----------------
    { category: "performance", path: "performance.bundleSizeBudgetKb", label: "Bundle budget (KB)", kind: "number" },
    { category: "performance", path: "performance.lighthousePerf", label: "Lighthouse perf target", kind: "number" },
    { category: "performance", path: "performance.lighthouseA11y", label: "Lighthouse a11y target", kind: "number" },
    { category: "performance", path: "performance.lighthouseSeo", label: "Lighthouse SEO target", kind: "number" },
    { category: "performance", path: "performance.imageOptimization", label: "Images", kind: enumKind(["next-image", "sharp", "cloudinary", "manual"]) },
    { category: "performance", path: "performance.lazyLoadDefault", label: "Lazy-load default", kind: "boolean" },
    { category: "performance", path: "performance.prefetchPolicy", label: "Prefetch", kind: enumKind(["viewport", "hover", "off"]) },
    // ---------------- security ----------------
    { category: "security", path: "security.secretHandling", label: "Secret handling", kind: enumKind(["env-only", "secret-manager", "doppler"]) },
    { category: "security", path: "security.cspDefault", label: "CSP", kind: enumKind(["strict", "moderate", "report-only"]) },
    { category: "security", path: "security.headers", label: "Headers", kind: enumKind(["owasp-recommended", "minimal"]) },
    { category: "security", path: "security.depAudit", label: "Dep audit", kind: enumKind(["auto-on-install", "weekly", "off"]) },
    { category: "security", path: "security.encryptAtRest", label: "Encrypt at rest", kind: "boolean" },
    // ---------------- i18n ----------------
    { category: "i18n", path: "i18n.library", label: "i18n library", kind: enumKind(["next-intl", "react-intl", "i18next", "lingui", "none"]) },
    { category: "i18n", path: "i18n.defaultLocale", label: "Default locale", kind: "string" },
    { category: "i18n", path: "i18n.locales", label: "Supported locales", kind: stringArrayKind },
    { category: "i18n", path: "i18n.rtlSupport", label: "RTL support", kind: "boolean" },
    { category: "i18n", path: "i18n.fallbackStrategy", label: "Fallback", kind: enumKind(["key", "default-locale"]) },
    // ---------------- workflow ----------------
    { category: "workflow", path: "workflow.dayMode", label: "Day mode", kind: enumKind(["morning", "evening", "night", "always"]) },
    { category: "workflow", path: "workflow.wipBranching", label: "WIP branching", kind: enumKind(["feature-branches", "trunk-based"]) },
    { category: "workflow", path: "workflow.verbosity", label: "Verbosity", kind: enumKind(["terse", "explain-decisions", "show-work"]) },
    { category: "workflow", path: "workflow.askBeforeBigChanges", label: "Ask before big changes", kind: "boolean" },
    { category: "workflow", path: "workflow.previewBeforeApply", label: "Preview before apply", kind: "boolean" },
    { category: "workflow", path: "workflow.voiceShortPhrases", label: "Voice short phrases", kind: "boolean" },
    { category: "workflow", path: "workflow.gazeAssist", label: "Gaze assist", kind: enumKind(["on", "subtle", "off"]) },
    { category: "workflow", path: "workflow.musicMood", label: "Music mood", kind: enumKind(["lofi", "ambient", "silent"]) },
    { category: "workflow", path: "workflow.celebrateShips", label: "Celebrate ships", kind: "boolean" },
    // ---------------- models ----------------
    { category: "models", path: "models.preferredFrontier", label: "Preferred frontier", kind: enumKind(["sonnet", "gpt-4o", "gemini-flash-thinking", "auto"]) },
    { category: "models", path: "models.byokKeysSet", label: "BYOK providers set", kind: stringArrayKind },
    { category: "models", path: "models.neverUseOpus", label: "Never use Opus", kind: "boolean" },
    { category: "models", path: "models.allowPremiumWithByok", label: "Allow premium w/ BYOK", kind: "boolean" },
    { category: "models", path: "models.tokenBudgetPerTurn", label: "Token budget per turn", kind: "number" },
];
function fieldsByCategory() {
    const out = {};
    for (const f of exports.PREFERENCE_FIELDS) {
        (out[f.category] = out[f.category] ?? []).push(f);
    }
    return out;
}
function totalFieldCount() {
    return exports.PREFERENCE_FIELDS.length;
}
//# sourceMappingURL=preferencesSchema.js.map