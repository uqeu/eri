# Enterprise-First AI Coding Plays: Competitive Brief

**Scope:** Strategic awareness brief on the enterprise lane in AI coding. eri is not building enterprise SKUs in this session; this document exists so we architect around the requirements that will eventually matter and so we read the regulated-industry opportunity correctly when we get there.

**Vendors covered:** Tabnine, Amazon Q Developer, Augment Code, Sourcegraph Cody Enterprise, Sweep AI, Codeium Enterprise (now Cognition/Windsurf).

---

## 1. Tabnine — The Original Self-Hosted/VPC Play

Tabnine is the canonical "deploy it inside your firewall" AI coding vendor. It started as a code-completion product in 2018 and has spent the last three years quietly hardening into a CIO-procurement product while flashier IDE-fork startups chased individual developers.

**Deployment posture.** This is the moat. Tabnine offers SaaS, single-tenant VPC, on-premises, and fully air-gapped configurations. The air-gapped option is the one that wins regulated deals — code never traverses the internet, the model weights sit inside the customer's network, and update channels are explicit pull operations rather than always-on dependencies. [source: https://docs.tabnine.com/main/welcome/readme/architecture]

**Model strategy.** Tabnine runs a "switchboard" architecture. The default is "Tabnine Protected" — their own model trained exclusively on permissively-licensed open-source code, designed to neutralize the IP-contamination objection that procurement teams raise. On top of that, admins can plug in frontier models from OpenAI, Anthropic, and Mistral as alternatives, with per-model toggles and per-team policy. [source: https://docs.tabnine.com/main/welcome/readme/ai-models/tabnines-private-and-protected-universal-models] [source: https://www.tabnine.com/blog/introducing-switchable-models-for-tabnine-chat/]

The implicit deal: Protected by default for low-risk completion, frontier when the developer opts in, all of it routed through the customer's own infrastructure or audit boundary.

**Pricing.** Code Assistant is $39/user/month and bundles VPC/on-prem/air-gapped deployment into the same SKU. Agentic tier (autonomous agents, MCP tools, CLI access, custom training) is $59/user/month. Larger deployments shift to license-based pricing where the customer self-hosts the model and the cost-per-seat collapses past roughly 50 developers. [source: https://www.tabnine.com/pricing/] [source: https://devtoolsreview.com/pricing/tabnine-pricing/]

**Compliance stack.** SOC 1/2/3, ISO 27001/27017/27018, PCI DSS Level 1, HIPAA, FedRAMP-eligible inheritance through AWS/GCP. This is the table-stakes posture for healthcare, finance, defense-adjacent, and federal-civilian work. [source: https://docs.tabnine.com/main/welcome/readme/security]

**Recognition.** Named a Visionary in the 2025 Gartner Magic Quadrant for AI Code Assistants. Cited in 25+ Gartner reports. This matters more than it should — Gartner placement is a procurement shortcut for buyers who don't want to defend the choice to their board. [source: https://www.wric.com/business/press-releases/globenewswire/9530720/]

**Customer base.** Tabnine doesn't publish a logo wall the way Cursor does, which is itself a signal — regulated enterprises rarely permit named references. Public case material is sparse beyond a Google Cloud infrastructure case study. Reported pilot results: 30-50% of code generated, 15% reduction in review time, 80% of developers ~20% faster. [source: https://cloud.google.com/customers/tabnine]

**What to learn from Tabnine for eri:** they made deployment topology the product. Everything else (model quality, IDE polish, agentic features) was negotiable; the air-gap option was not. If eri ever pursues enterprise, the local-first runtime is structurally similar to an air-gapped deployment — that's a story worth pre-staging architecturally even while we're shipping for individuals.

---

## 2. Amazon Q Developer — The AWS-Native Default

Amazon Q Developer is the rebrand of CodeWhisperer plus a heap of new agentic capability. Its strategic value isn't the assistant itself — it's that AWS can ship it as a tick-box inside an existing enterprise agreement.

**The AWS moat.** Q Developer can answer account-level questions ("list my Lambdas in us-east-2"), generate CLI commands, query AWS pricing, and lean on IAM Identity Center for SSO out of the box. None of these features are individually impressive; the bundle is impressive because every AWS-heavy enterprise already has the contract, the identity provider, the data-residency story, and the billing relationship. The marginal cost of adding Q Developer is procurement-zero. [source: https://aws.amazon.com/q/developer/pricing/]

**Pricing.** Free tier with 50 agentic requests/month and 1,000 lines of Java code transformation. Pro at $19/user/month, which undercuts Cursor Pro and matches Copilot Business. There is no separate "Enterprise" SKU — admins just subscribe seats via IAM Identity Center and inherit AWS Organizations policy. [source: https://aws.amazon.com/q/developer/pricing/] [source: https://docs.aws.amazon.com/amazonq/latest/qdeveloper-ug/q-tiers.html]

**IP indemnity.** Amazon assumes legal liability for IP claims arising from generated code. This is one of the quiet reasons large enterprises pick Q Developer over scrappier alternatives — the indemnity moves a category of legal risk off the customer's balance sheet. [source: https://www.superblocks.com/blog/amazon-qdeveloper-pricing]

**IDE coverage.** VS Code, JetBrains family, Visual Studio, command line, and the AWS console itself. The console integration is underrated for ops-heavy teams who live in the AWS web UI.

**Regulated adoption.** DTCC (Depository Trust & Clearing Corporation) — a Tier-1 financial-market-infrastructure operator — rolled Q Developer to production after a phased POC and reported 40% throughput improvement and a 5% improvement in code repository security scores. Q Developer is approved for SOC, ISO, HIPAA, and PCI use cases. Infosys is bundling Q Developer with its Topaz delivery framework for telecom, manufacturing, and financial services. LSEG/LCH use sibling product Q Business for internal assistants. [source: https://aws.amazon.com/solutions/case-studies/dtcc-case-study/] [source: https://www.infosys.com/newsroom/press-releases/2026/]

**Strategic read.** Q Developer's competitive position is not "best assistant." It's "good-enough assistant pre-approved for the cloud you're already on." That positioning is essentially un-attackable for AWS-resident workloads. For eri, the takeaway is that the cloud incumbents will eventually do this on every cloud — Google has done it with Gemini Code Assist, Microsoft has Copilot, AWS has Q. The defensible lane is the one the hyperscalers structurally can't fill: local-first, modality-novel, cross-cloud-neutral.

---

## 3. Augment Code — The "Context Engine" Pitch

Augment Code is the most credible enterprise challenger that didn't start with a deployment-topology pitch. It started with a context-retrieval pitch — and it works.

**The context engine.** Augment indexes up to 500,000 files across dozens of repositories, holding a live semantic index of code, dependencies, architecture, commit history, documentation, and cross-repo relationships. The pitch is built for codebases too large for any current model's working memory: Pure Storage's 2.1M-line C++ monorepo is the showcase. [source: https://www.augmentcode.com/context-engine] [source: https://www.augmentcode.com/customers/pure-storage]

This is a meaningful differentiator. Cursor, Copilot, and Windsurf all ship "good enough" indexing for repositories under ~100k files; Augment plays in a tier above that where indexing quality is the bottleneck.

**Customers.** Webflow (JS/TS stack, onboarding focus), Pure Storage (C++ at scale, 2,000 engineers), Pigment, Lemonade, ddn, Datastax, GoFundMe. Pure Storage is the most strategically loud — they're publicly building "a new development methodology powered by Augment's Context Engine" with a stated goal of tripling delivery velocity. [source: https://www.augmentcode.com/customers]

**Funding.** Emerged from stealth in April 2024 with $252M, including a $227M Series B led by Sutter Hill with Index, Innovation Endeavors, Lightspeed, and Meritech. The size of the round was the news — a Series B that big at emergence-from-stealth signaled that someone with deep model-economics insight believed enterprise AI coding was a winner-take-much market. [source: https://www.augmentcode.com/]

**Pricing.** Shifted to credit-based on October 20, 2025: Community (free, limited), Indie ($20/mo, 40k credits), Developer ($50/mo, 600 messages), Standard team ($60/mo, up to 20 users), Max team ($200/mo, up to 20 users). Enterprise is custom and required above 20 seats. The credit model is the same kind of consumption-pricing pivot that Cursor and Windsurf did in 2025 — it transfers model-cost variability from vendor to customer, but it also annoys procurement teams. [source: https://www.augmentcode.com/pricing] [source: https://www.augmentcode.com/blog/augment-codes-pricing-is-changing]

**Strategic read.** Augment's bet is that "context quality" is the durable axis as frontier models commoditize. They may be right — at the high end of codebase complexity, the assistant that retrieves the correct three files beats the assistant with the smarter model on the wrong three files. For eri, the implication is that indexing strategy matters even at the local-first/single-developer scale, and that an Augment-style cross-repo graph would be the natural extension if eri ever moves into team scope.

---

## 4. Sourcegraph Cody Enterprise — Pivoted, Refocused, Still Standing

Sourcegraph's 2025 was a public retreat from the IC market and a doubling-down on the enterprise. On July 23, 2025, they terminated Cody Free, Cody Pro, and the Enterprise Starter tier. New signups for the consumer plans had already been switched off on June 25. Cody now exists only as a true enterprise product. [source: https://sourcegraph.com/blog/changes-to-cody-free-pro-and-enterprise-starter-plans]

**The pivot.** Sourcegraph correctly read that they were losing the IC race to Cursor and Copilot. Rather than burn capital chasing that lane, they pulled back to the lane where they actually have a moat: code search and code intelligence over very large, very old codebases. Cody Enterprise is now the agentic layer that sits on top of Sourcegraph's existing code-graph product. Customers like Lyft, Indeed, Workiva, Qualtrics (1,000+ devs), Palo Alto Networks (2,000+ devs), Databricks, Plaid, Uber, Reddit, GE, and Dropbox were already paying for the code-graph product. [source: https://sourcegraph.com/pricing] [source: https://weavai.app/blog/en/2026/04/30/sourcegraph-cody-review-2026-enterprise-ai-at-59-mo/]

**Pricing.** $59/user/month list, almost always discounted via annual contracts. Cody Enterprise can retrieve from up to 10 repositories simultaneously, the architecture explicitly aimed at microservice-heavy enterprises.

**Amp.** Sourcegraph also shipped Amp — an agentic coding tool aimed at IC developers but built on Sourcegraph's code graph. Amp is positioned as free and is meant to keep Sourcegraph in the IC conversation without competing for IC dollars. It's a defensive product: better that ICs at a customer use Amp than abandon Sourcegraph entirely. [source: https://sourcegraph.com/amp]

**Strategic read.** Sourcegraph is the model for "lose the IC race gracefully, keep the enterprise revenue." The lesson for eri is the inverse: it's expensive and embarrassing to pivot away from the IC market once you've claimed it. Cursor will face this question; Augment is sidestepping it by pricing IC out of the cheap tier; Sourcegraph already lived it.

---

## 5. Sweep AI — The Quiet Survivor

Sweep (sweep.dev) is a smaller story. Founded in 2023 by Kevin Lu and William Zeng, YC-backed, raised about $500k. Original pitch was PR-bot — "file a GitHub issue, get a PR" — which got attention in 2023 but largely got eaten by Cursor's agent mode, Copilot Workspaces, Devin, and GitHub's own agentic Copilot. [source: https://www.ycombinator.com/companies/sweep]

**Current product.** Sweep pivoted to a JetBrains-first AI coding assistant. Active development, recent releases through late 2025 (1.24-1.27 between October and December). 4.9 stars and 40k+ installs on the JetBrains marketplace. Custom 1.5B-parameter model for low-latency autocomplete, with no code retained by third parties. [source: https://sweep.dev/] [source: https://github.com/sweepai/]

**Strategic read.** Sweep is not an enterprise-first play. It's interesting as a counter-example: the PR-bot category as a standalone product didn't survive the agentic turn. The work that Sweep originally did got absorbed into the larger assistants. eri should not invest in PR-bot-as-a-feature as a differentiator; it's already commodity. The JetBrains pivot is the right read of an underserved niche, though — the JetBrains user base remains large and badly served by VS Code-fork products.

---

## 6. Codeium Enterprise → Windsurf → Cognition

The Codeium-to-Windsurf-to-Cognition arc is the single most chaotic vendor story of 2025 and matters for understanding the enterprise lane.

**The rebrand.** Codeium → Windsurf in April 2025, alongside a shift from autocomplete plugin to full IDE. [source: https://research.contrary.com/company/windsurf]

**The OpenAI deal that wasn't.** In early May 2025, Bloomberg reported OpenAI had agreed to acquire Windsurf for ~$3B. The deal collapsed in days over the Microsoft IP clause in the OpenAI/Microsoft agreement — anything OpenAI acquired would flow to Microsoft, including GitHub Copilot's competitor. CEO Varun Mohan refused. [source: https://devops.com/openai-acquires-windsurf-for-3-billion-2/]

**The Google reverse-acqui-hire.** On July 11, 2025, Google paid ~$2.4B to hire Mohan, co-founder Douglas Chen, and roughly 40 employees, and to license certain technology — leaving the Windsurf company-shell intact but gutted at the top. [source: https://www.hpcwire.com/aiwire/2025/05/13/openais-3-billion-windsurf-deal-hints-at-bigger-ai-ambitions/]

**The Cognition acquisition.** On July 14, 2025 — three days later — Cognition (makers of Devin) bought the remaining Windsurf entity for ~$250M, picking up $82M ARR, 350+ enterprise customers, ~210 remaining employees, and the brand. Cognition raised a $400M follow-on shortly after. [source: https://venturebeat.com/programming-development/cognition-follows-windsurf-acquisition-with-usd400m-fundraise-showing-strong] [source: https://cognition.ai/blog/windsurf]

**Post-acquisition pricing.** Free $0, Pro ~$15/mo, Teams ~$30/user/mo, Enterprise $60/user/mo with SSO, audit logs, and dedicated support. Notable: the Enterprise tier explicitly undercuts Cursor's $40 Business by sitting at $60 with more enterprise features, while Cursor's $40 tier is intentionally light on those features. [source: https://www.nxcode.io/resources/news/cognition-windsurf-acquisition-swe-1-5-codemaps-2026]

**What happened to the enterprise tier.** It survived. The 350+ enterprise customers transferred to Cognition. Post-acquisition Cognition has continued to invest in the Windsurf enterprise SKU, including new SWE-1.5 models and Codemaps features. The combined Cognition/Windsurf entity is now the third meaningful enterprise AI coding vendor alongside Tabnine and GitHub Copilot Business, with Cody Enterprise and Augment in the next ring.

**Strategic read for eri.** The Codeium/Windsurf saga is a warning shot about the volatility of this category. Three quarters from the Bloomberg-reported $3B deal to the $250M acquisition by a different buyer, with the founder leaving for a hyperscaler in between. Enterprise customers do not love this — every regulated buyer's question now starts with "what happens if you get acquired." A local-first IDE has a structurally better answer to that question than a cloud-tethered one: even if eri the company goes away, eri-the-product on the developer's laptop keeps running until it doesn't.

---

## Cross-Cutting Patterns

### What enterprise buyers actually evaluate

Six dimensions show up in every serious enterprise AI-coding evaluation in 2026 [source: https://www.augmentcode.com/guides/cto-ai-coding-checklist]:

1. **Determinism.** Can the tool produce repeatable output for audit?
2. **Auditability.** Is every agent action attributable to a specific human?
3. **Context persistence.** Does it remember what it did across sessions, can that memory be inspected?
4. **Team-scale administration.** SSO, SCIM, RBAC, seat management, policy enforcement.
5. **Security compliance.** SOC 2 Type II at minimum; HIPAA, FedRAMP, PCI as the workload demands.
6. **Reversibility.** Can the customer rip out the tool without losing data, ownership, or audit history?

The minimum-viable enterprise feature set has stabilized: SOC 2 Type II, SAML SSO, SCIM provisioning, admin controls, audit logs, training-data opt-out, deployment-flexibility (VPC or self-hosted), and contractual SLA. The recommended build order from enterprise-SaaS practitioners is RBAC → audit logs → SSO → SCIM, in that sequence. [source: https://hashorn.com/blog/enterprise-ready-saas-sso-scim-audit-logs]

### The "no-VPC = no-deal" pattern

Regulated industries — healthcare, finance, defense, public sector, certain segments of pharma and energy — operate under data-handling regimes that make cloud-resident developer tools effectively unprocurable. The compliance gate is binary: either the code can stay inside the customer's network boundary, or it cannot, and if it cannot, the procurement review ends. [source: https://techoc.blog/i-reviewed-ai-code-generators-for-regulated-industries/]

The reported pattern: a regional bank evaluating Cursor for three months, killed at procurement when Cursor couldn't produce SOC 2 Type II and didn't have VPC. That story is now a sales-cycle talking point Tabnine and Continue use against Cursor. Cursor knows this — their 2025-2026 enterprise roadmap is essentially trying to close the gap, but the gap is structural: a hosted-cloud IDE has architectural decisions baked in that make air-gap deployment hard to retrofit.

### Where eri's local-first thesis intersects the enterprise lane

eri's local-first runtime is architecturally close to an air-gapped deployment for free. The voice/gaze stack runs locally; the diffusion code-generation call to the paid API is the one network operation, and that call is the same kind of egress that any other licensed compiler or SaaS dependency would make — except it can be policy-gated, logged, and (in principle) routed through a customer-controlled proxy.

That positioning is a regulated-industry pitch waiting to happen:
- "The IDE runs on the developer's laptop with no telemetry."
- "Voice and gaze processing never leave the device."
- "Code-generation requests go through a customer-policy-controlled gateway."
- "Audit logs are local-first and exportable to the customer's SIEM."

The problem is that local-first is necessary but not sufficient. To actually compete in regulated procurement we still need:
- SSO (SAML, OIDC at minimum)
- SCIM for provisioning/deprovisioning
- Centralized audit log export (Splunk, Datadog, Elastic, generic SIEM)
- A documented data-flow diagram, training-data policy, and IP-indemnity stance
- SOC 2 Type II at the company level — not just the product
- A signed BAA template for healthcare and at least one named regulated reference customer

### What eri should NOT chase right now, but should architect around

User has been explicit: not building enterprise features this session. The corresponding architectural disciplines that keep enterprise possible without doing the work today:

1. **Don't bake telemetry into the runtime.** Make telemetry a separable, opt-out module. Enterprise customers will demand the off-switch and will inspect for it.
2. **Don't centralize identity in our own auth.** Use a pluggable identity boundary so SAML/OIDC can drop in later. A single hardcoded auth dependency now will cost months later.
3. **Keep the diffusion-API call abstracted behind a "model gateway" interface.** Today that gateway points at the paid API; tomorrow an enterprise customer needs to point it at their own Bedrock/Vertex/Azure tenant or a customer-controlled proxy. If we hardcode the endpoint, we lose that option.
4. **Local audit log primitive from day one.** Even for individuals, log what the agent did and where. This is a UX win for solo developers ("what changed and why") and an enterprise-readiness primitive for free.
5. **Data residency posture in copy.** Never claim "your code never leaves your machine" if it isn't true; never claim "we don't train on your code" without an explicit policy. These claims become contractual liabilities at the enterprise tier.
6. **Don't paint ourselves into a "no air-gap possible" corner.** Avoid hard dependencies on services we couldn't ship inside a customer network: managed update channels that can't be mirrored, telemetry SDKs that can't be disabled, third-party CDNs in the critical path.

None of this is enterprise feature work. All of it is "don't sabotage the option to do enterprise feature work in 18 months."

### IC-led vs CIO-led adoption: where eri sits

The category has two adoption motions:

- **IC-led (bottom-up):** Cursor, original Copilot, Codeium-era Windsurf, Continue. Developers adopt individually, sometimes on personal credit cards, then the tool reaches department-level visibility, then it goes to procurement only after it's already entrenched. Wins on product velocity and developer love. Loses on regulated industries where IC purchases are blocked at the firewall.

- **CIO-led (top-down):** Tabnine, Amazon Q Developer, Cody Enterprise, GitHub Copilot Business. Sales motion is RFP, security review, compliance attestation, executive sponsor, phased rollout. Wins regulated dollars and large per-deal sizes. Loses on developer love — these tools historically lagged the IC products on raw capability because they were optimized for procurement, not feel.

eri's natural adoption motion is IC-led, like Cursor. The voice/gaze/diffusion stack is a developer-experience bet, not a compliance bet. We'll win the early developers who care about local-first and modality novelty, and we should not pretend otherwise in 2026.

But the local-first runtime is a strategic asset that gives us a credible second act:
- Stage 1 (now): IC-led adoption. Win developers on novelty and local-first feel.
- Stage 2 (12-18 months): Team tier with collaboration features. Light enterprise sketching — SSO, basic audit log, training-data policy.
- Stage 3 (18-36 months): Regulated-industry pitch leaning on the structurally-good local-first story, plus SCIM, SIEM export, BAA, SOC 2 Type II, and named reference customers. By this point the IDE-fork hosted-cloud incumbents will have spent two years trying to retrofit air-gap and will still not have it cleanly; eri's architecture will already permit it.

The closest analog isn't Cursor or Tabnine — it's Sourcegraph in 2018-2021. Started bottom-up as a code-search tool developers loved, became an enterprise code-graph play once the developer base gave them ground to stand on, and built compliance posture deliberately rather than reactively. That arc took roughly six years from founding to clean enterprise positioning. We don't need to start it today, but we shouldn't burn the option.

---

## Sources

- https://www.tabnine.com/pricing/
- https://docs.tabnine.com/main/welcome/readme/security
- https://docs.tabnine.com/main/welcome/readme/architecture
- https://docs.tabnine.com/main/welcome/readme/ai-models/tabnines-private-and-protected-universal-models
- https://www.tabnine.com/blog/introducing-switchable-models-for-tabnine-chat/
- https://devtoolsreview.com/pricing/tabnine-pricing/
- https://www.wric.com/business/press-releases/globenewswire/9530720/
- https://cloud.google.com/customers/tabnine
- https://aws.amazon.com/q/developer/pricing/
- https://docs.aws.amazon.com/amazonq/latest/qdeveloper-ug/q-tiers.html
- https://aws.amazon.com/solutions/case-studies/dtcc-case-study/
- https://www.infosys.com/newsroom/press-releases/2026/accelerate-enterprise-adoption-generative-ai.html
- https://www.superblocks.com/blog/amazon-qdeveloper-pricing
- https://www.augmentcode.com/context-engine
- https://www.augmentcode.com/customers
- https://www.augmentcode.com/customers/pure-storage
- https://www.augmentcode.com/pricing
- https://www.augmentcode.com/blog/augment-codes-pricing-is-changing
- https://www.augmentcode.com/guides/cto-ai-coding-checklist
- https://sourcegraph.com/blog/changes-to-cody-free-pro-and-enterprise-starter-plans
- https://sourcegraph.com/pricing
- https://sourcegraph.com/amp
- https://weavai.app/blog/en/2026/04/30/sourcegraph-cody-review-2026-enterprise-ai-at-59-mo/
- https://sweep.dev/
- https://github.com/sweepai/
- https://www.ycombinator.com/companies/sweep
- https://research.contrary.com/company/windsurf
- https://devops.com/openai-acquires-windsurf-for-3-billion-2/
- https://www.hpcwire.com/aiwire/2025/05/13/openais-3-billion-windsurf-deal-hints-at-bigger-ai-ambitions/
- https://venturebeat.com/programming-development/cognition-follows-windsurf-acquisition-with-usd400m-fundraise-showing-strong
- https://cognition.ai/blog/windsurf
- https://www.nxcode.io/resources/news/cognition-windsurf-acquisition-swe-1-5-codemaps-2026
- https://hashorn.com/blog/enterprise-ready-saas-sso-scim-audit-logs
- https://techoc.blog/i-reviewed-ai-code-generators-for-regulated-industries/
- https://getdx.com/blog/compare-copilot-cursor-tabnine/
- https://www.augmentcode.com/tools/cursor-vs-tabnine
