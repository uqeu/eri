# Cursor: Pricing, Business Model, Customer Ecosystem, and Competitive Positioning (May 2026)

This brief reviews how Cursor (Anysphere, Inc.) charges, how it makes money, who its customers are, and where it sits relative to Copilot, Windsurf, Continue, Cody, and a new generation of agent-first competitors. It reflects the post-June-2025 "credit pool" pricing reset and the May 2026 release of Composer 2.5.

---

## 1. Current Pricing Tiers (May 2026)

Cursor abandoned its old "fast/slow request" allotment in June 2025 and now sells **credit pools** on top of a flat seat fee. The 2026 lineup has six paid SKUs plus a Free tier [source: https://cursor.com/pricing] [source: https://aiproductivity.ai/blog/cursor-pricing/].

| Tier | Price (USD) | What's included | Notable exclusions / catches |
|---|---|---|---|
| Hobby (Free) | $0 | Limited agent requests; limited Tab completions; full editor UI; SOC2-grade infra | No frontier-model access in agent mode; no cloud agents; no MCP/skills/hooks; throttled |
| Pro | $20/mo (annual ~$16/mo) | Extended agent limits; frontier model access (Claude Sonnet 4.6, GPT-5.2, Gemini 2.x, Composer 2.5); MCPs / skills / hooks; cloud agents; usage-based Bugbot | $20 credit pool roughly equates to 200–300 frontier-model requests in practice; rate-limit caps (1 req/min, 30 req/hour reported); Composer Opus-tier still hits the credit pool fast |
| Pro+ | $60/mo | Same features as Pro with ~3× the credit pool | Same overage model as Pro |
| Ultra | $200/mo | ~20× usage multiplier; priority access to new model rollouts; preferred routing during peak load | Designed for agent-mode power users; still credit-metered for premium models |
| Teams | $40/user/mo | Everything in Pro + shared team context for cloud agents; team rules/skills/automations; security-review agent; SAML/OIDC SSO; enforced team-level privacy mode; team plugin marketplace; usage analytics; centralized billing | Per-seat — small teams pay more than two Pros |
| Enterprise | Custom (typically ~$500–$1,000/user/year, sometimes higher with pooled credits) | Pooled usage across the org; invoice/PO billing; SCIM seat management; AI code-tracking API and audit logs; granular admin + model controls; priority support; custom Bugbot plan | No on-prem/VPC option (cloud-only as of May 2026) [source: https://harini.blog/2025/05/07/detailed-security-and-enterprise-readiness-report-cursor-ai-ide/] |

**Overage / usage-based pricing.** Every plan ships with a "monthly allowance" of model usage. Once consumed, "on-demand" usage is billed in arrears at the underlying API pass-through rate plus a margin. Auto-routed traffic is metered at roughly $1.25/M input, $6/M output, $0.25/M cache read [source: https://aiproductivity.ai/blog/cursor-pricing/] [source: https://cursor.com/pricing]. Pro users have reported single-week overages of ~$350 when running agent loops heavily [source: https://www.finout.io/blog/what-happened-to-cursor-pricing-2026-guide-5-cost-cutting-tips].

**Annual billing.** Annual contracts get a roughly 20% discount on Pro and Teams; Enterprise is negotiated.

---

## 2. The Old "Fast / Slow Request" Model and What Replaced It

Until June 2025 Cursor sold a fixed number of "fast" premium requests per month (500 on Pro) that ran on dedicated capacity, with "slow" requests as a fallback during peak load. The model was simple but unsustainable because users routed expensive Opus-class calls through the same flat bucket as cheap completions [source: https://tessl.io/blog/cursor-new-pricing-structure-explained/].

In June 2025 Cursor replaced this with a **dollar-denominated credit pool**: your $20 buys ~$20 of model spend (with margin), and individual frontier calls debit the pool at their underlying cost. The legacy "500 requests" expectation now translates to roughly 200–300 frontier calls on the same plan. The migration was poorly communicated, triggered chargebacks, and led to a public apology on July 4, 2025 with retroactive refunds [source: https://www.fintechweekly.com/magazine/articles/cursor-pricing-change-user-backlash-refund] [source: https://medium.com/@jimeng_57761/when-cursor-silently-raised-their-price-by-over-20-and-more-what-is-the-message-the-users-are-6af93385f362].

In 2026 the "fast/slow" language is mostly gone. Rate-limit complaints persist (1 req/min, 30 req/hour for some users), but they are now enforced via concurrency caps rather than a queue [source: https://www.finout.io/blog/what-happened-to-cursor-pricing-2026-guide-5-cost-cutting-tips].

---

## 3. Auto vs Manual Model Selection

"Auto" is Cursor's first-party router. When selected, Cursor picks the cheapest competent model for each request: a small, fast model for Tab completions, and a higher-capability model for multi-file Composer edits. Auto is marketed as **unlimited and outside the credit pool**, billed via a flat router rate ($1.25/M in, $6/M out, $0.25/M cache read) which is cheap enough that most users never hit a cap [source: https://aiproductivity.ai/blog/cursor-pricing/].

Independent testing in 2026 finds Auto reliably defers to the cheapest model that solves the task. Critics on Reddit and Medium argue Auto is biased toward whichever model is cheapest for Cursor at that moment (now often Composer 2.5), and that "Auto" routes some prompts that would benefit from Opus to a weaker model [source: https://dev.to/nedcodes/i-tested-whether-cursors-auto-mode-actually-picks-the-right-model-20ml] [source: https://medium.com/@zulfiqarajillani/hidden-costs-of-cursor-auto-model-pricing-forcing-me-to-leave-my-favorite-ai-editor-cc6268e756ac]. Manual model selection (Claude Sonnet 4.6, Opus 4.6/4.7, GPT-5.x, Gemini 2.x, Composer 2.5) bills against the credit pool at provider rates.

---

## 4. BYOK (Bring Your Own Keys)

Cursor supports BYOK for OpenAI, Anthropic, Google, Azure, and AWS Bedrock keys. With a BYOK key Cursor charges your provider directly for token usage and the request does **not** count against Cursor's credit pool [source: https://cursor.com/help/models-and-usage/api-keys].

The major catch: **Cursor's premium agent features (Agent mode, the inline Edit experience, Composer 2.5 itself) cannot run on BYOK keys**. They depend on Cursor-fine-tuned models served only via Cursor's billing. The in-app error message — *"Agent and Edit rely on custom models that cannot be billed to an API key"* — has become a common complaint and a frequent driver of churn to BYOK-friendly tools like Continue, Cline, Claude Code, and Zed [source: https://apidog.com/blog/cursor-byok-ban-alternative/] [source: https://forum.cursor.com/t/byok-bring-your-own-key/25578].

Net effect: BYOK is real but covers only the lower-value surface area (Chat with a vanilla provider model, some Tab completion settings). The features users actually pay for are locked to Cursor's billing rails.

---

## 5. Unit Economics, Gross Margin, and the "Break-Even at $20" Question

Cursor's unit economics are the most-discussed topic in AI infra. Public reporting and analyst estimates in late 2025 and early 2026 indicate Cursor was running at **negative gross margin** at the Pro tier: Foundamental estimated Cursor was paying Anthropic roughly $650M/yr while generating ~$500M/yr in revenue, implying ~-30% gross margin [source: https://andreagao.com/posts/cursor-losing-money-for-user/]. One leaked sample showed an average Pro user paying $180/yr and consuming $838–$2,015 of underlying tokens [source: https://www.finout.io/blog/what-happened-to-cursor-pricing-2026-guide-5-cost-cutting-tips].

Two 2025-2026 moves reset the picture:

1. **Composer 2.5 (Nov 2025 → May 2026)** — Cursor's in-house model fine-tuned on top of Moonshot AI's open-source Kimi K2.5 base, with ~85% of compute spent on Cursor's own RL post-training pipeline. It claims Opus-4.7-class quality at roughly one-tenth the inference cost [source: https://cursor.com/blog/composer-2-5] [source: https://the-decoder.com/cursors-composer-2-5-matches-opus-4-7-and-gpt-5-5-benchmarks-at-a-fraction-of-the-cost/].
2. **Auto router + Kimi K2.5 fallback (early 2026)** — Cursor leans on cheaper long-context models for routine work and reserves Anthropic/OpenAI capacity for the genuinely-hard prompts.

Analysts now describe Cursor as **break-even or slightly positive at the enterprise segment, still leaky on heavy Pro users**, with profitability projected late 2026 if Composer 2.5 carries more traffic [source: https://mktclarity.com/blogs/news/is-cursor-profitable] [source: https://www.finout.io/blog/what-happened-to-cursor-pricing-2026-guide-5-cost-cutting-tips]. The strategic implication is clear: every dollar of revenue depends on continuing to migrate traffic off Anthropic/OpenAI and onto Cursor's own model.

---

## 6. Revenue and Scale

- **ARR trajectory**: $100M (Jan 2025) → $500M (Jun 2025) → $1B (Nov 2025) → $2B (Feb 2026). Internal forecasts cited in press reach $6B by EOY 2026 [source: https://techcrunch.com/2026/03/02/cursor-has-reportedly-surpassed-2b-in-annualized-revenue/] [source: https://letsdatascience.com/blog/cursor-2-billion-funding-round-50-billion-valuation].
- **Users**: 7M+ monthly active, 1M+ daily active, 360k paying customers, 50k+ paying teams, ~700k enterprise seats [source: https://www.getpanto.ai/blog/cursor-ai-statistics] [source: https://dev.to/alanwest/cursor-hit-1-million-daily-users-what-are-they-doing-right-4nm2].
- **Code generated**: ~1B lines/day attributed to Cursor sessions.
- **Mindshare**: 82.2% awareness in State of AI 2025; 69% awareness in JetBrains 2026 dev survey, with 18% reporting active use at work (vs. 29% for Copilot) [source: https://www.getpanto.ai/blog/cursor-ai-statistics].

Cursor was the fastest B2B SaaS in history to reach $2B ARR (≈3 years from zero) [source: https://thenextweb.com/news/cursor-anysphere-2-billion-funding-50-billion-valuation-ai-coding].

---

## 7. Customer Base

Cursor publishes a partial logo wall and several case studies on cursor.com/customers. Named heavy users include **OpenAI, Shopify, Stripe, Uber, Adobe, Spotify, Midjourney, NVIDIA, Google, and Instacart**. Anysphere claims **64% of Fortune 500 companies** use Cursor in some capacity, with NVIDIA's Jensen Huang publicly naming it his "favorite enterprise AI service" [source: https://cursor.com/enterprise] [source: https://aifundingtracker.com/cursor-revenue-valuation/].

The enterprise segment accounts for roughly 34% of revenue (~$336M ARR on ~700k seats), with the rest split between Pro/Pro+/Ultra and Teams [source: https://aifundingtracker.com/cursor-revenue-valuation/]. Influencer presence is heavy on Twitter/X (a16z partner posts, founder threads, "ship-with-Cursor" demos), and the product is a near-default reference in YC startup pitch decks.

---

## 8. Business and Enterprise Plan Specifics

Teams ($40/user/mo) gets the org-level features most paying companies actually want:

- SAML/OIDC SSO and enforced privacy mode at the team level
- Shared cloud-agent context, team-wide rules / skills / automations
- Team plugin marketplace for private MCP servers and internal skills
- Usage analytics dashboard and centralized billing
- A security-review agent that runs against PRs

Enterprise adds:

- **SCIM 2.0** for IdP-driven provisioning (Okta, Entra ID, Google Workspace)
- Pooled credit usage across all seats (no per-user caps)
- Invoice / PO billing
- AI code-tracking API + audit logs (which lines of code came from which model on which day)
- Granular admin model controls (allow/deny lists per model, per project)
- Custom Bugbot configuration
- **SOC 2 Type II** on AWS, AES-256 at rest, TLS 1.2+ in transit, annual pentest
- Org-wide enforced Privacy Mode (zero retention by Cursor or model providers)
- Priority support and dedicated CSM

**No self-hosted / VPC / on-prem option exists as of May 2026.** This is the single most common enterprise rejection reason; Tabnine and Continue both win deals on this basis [source: https://cursor.com/docs/enterprise] [source: https://harini.blog/2025/05/07/detailed-security-and-enterprise-readiness-report-cursor-ai-ide/] [source: https://www.augmentcode.com/tools/cursor-vs-tabnine].

---

## 9. Free Tier Sustainability and Conversion

The Hobby tier is intentionally narrow: a small monthly bucket of Agent requests, Tab completions on a smaller in-house model, and no MCPs / cloud agents / skills. The free tier is the funnel and it is **aggressively capped** — most active users report hitting limits within hours per day and seeing weaker model output (no Claude Sonnet 4.6 / GPT-5.2 access in agent mode). Once limits hit, the in-product nudge is a single upgrade CTA [source: https://www.aitooldiscovery.com/guides/cursor-reddit].

Cursor has not published a Free→Pro conversion rate, but given $2B ARR on ~7M MAU at a mix of $20/$40 seats, the implied paid base is ~5–7% of MAU, which is high for a developer tool.

---

## 10. Competitor Pricing Side-by-Side

| Tool | Free tier | Individual | Business / Team | Enterprise |
|---|---|---|---|---|
| **Cursor** | Capped agent + Tab | $20 Pro, $60 Pro+, $200 Ultra | $40/seat (Teams) | Custom ~$500–$1,000/user/yr |
| **GitHub Copilot** | 50 completions, 2k Chat/mo | $10/mo Pro (300 premium req) | $19/user/mo Business | $39/user/mo Enterprise |
| **Windsurf** (post-Devin merger) | Free with limits | $20/mo Pro (includes Devin CLI) | $35/user/mo Teams | Custom Enterprise |
| **Continue.dev** | Open source, free | BYOK only — pay providers directly | Self-hosted Hub or $10/user Hub-managed | Self-hosted, BYOK |
| **Cody (Sourcegraph)** | Cody Free/Pro **discontinued July 2025** | n/a (consumer wound down) | Enterprise only, custom | Custom; sells primarily to large orgs |
| **Replit Agent** | Free tier with limits | $20/mo Core | $40/seat Teams | Custom Enterprise |
| **Lovable / v0** | Free with limits | $20/mo Pro | $25–$30/seat Teams | Custom Enterprise |

Sources: [https://dev.to/rahulxsingh/github-copilot-vs-codeium-windsurf-which-ai-coding-tool-wins-in-2026-fed], [https://techsifted.com/reviews/github-copilot-pricing-2026/], [https://www.developersdigest.tech/blog/ai-coding-tools-pricing-2026], [https://www.nxcode.io/resources/news/cursor-alternative-2026-best-ai-code-editors].

Three patterns stand out. (a) Copilot remains the **cheapest credible** offering ($10 individual / $19 business) and pairs with enterprise GitHub bundles. (b) Windsurf has become the closest 1:1 alternative on price and feel after the Devin acquisition. (c) Continue is the **BYOK escape hatch** for users who run their own keys — its growth is largely Cursor-overage refugees. (d) Cody has effectively conceded the IC market to Cursor/Copilot and now positions only at the enterprise tier.

---

## 11. MCP and Plugin Ecosystem

Cursor migrated from the VS Code Marketplace to **OpenVSX** in June 2025 after Microsoft restricted Marketplace use to its own products. Anysphere now publishes and maintains forks of popular extensions ("Published by Anysphere") to guarantee compatibility [source: https://forum.cursor.com/t/extension-marketplace-changes-transition-to-openvsx/109138].

The **Cursor Marketplace** for plugins launched alongside Cursor 3.0 in April 2026. A "plugin" bundles MCP servers + skills + subagents + rules + hooks into a single installable unit. At launch the marketplace had 30+ partners including **Atlassian, Datadog, GitLab, Glean, Hugging Face, monday.com, and PlanetScale** [source: https://cursor.com/blog/new-plugins] [source: https://cursor.com/changelog/2-6]. Teams and Enterprise plans can stand up **private team marketplaces** with central governance — a key differentiator over Copilot's extension model, which is broader but less curated.

The MCP layer is the most important strategic surface here: Cursor is positioning MCP as the universal connector between agents and SaaS systems, and the marketplace is its lever for keeping that gravity inside Cursor.

---

## 12. Install Base, Downloads, and DAUs

- **7M+ monthly active users**, **1M+ daily active users** [source: https://dev.to/alanwest/cursor-hit-1-million-daily-users-what-are-they-doing-right-4nm2].
- **500k downloads in year one**, now generating ~1B lines of code per day.
- **360k paying customers**, **50k+ paying teams**, **~700k enterprise seats** [source: https://www.getpanto.ai/blog/cursor-ai-statistics].
- A LinkedIn analysis flagged a **temporary 18% growth dip** in Q1 2026 attributed to pricing-change churn before enterprise growth reaccelerated [source: https://www.linkedin.com/posts/tschlottke_cursor-went-from-62-growth-to-18-in-6-activity-7404158026494152705-MhXB].

GitHub-stars metric is not particularly meaningful for Cursor since the product itself is closed-source; the cursor/plugins repo and various community ports do have material traction (tens of thousands of stars combined).

---

## 13. Funding History

| Round | Date | Lead(s) | Amount | Post-money |
|---|---|---|---|---|
| Seed | 2022–2023 | OpenAI Startup Fund, others | ~$11M | — |
| Series A | Aug 2024 | Andreessen Horowitz | ~$60M | $400M |
| Series B | Jan 2025 | Thrive, a16z | ~$105M | $2.6B |
| Series C | May 2025 | Thrive (lead); a16z, Accel, DST | $900M | $9.9B |
| Series D | Nov 2025 | Coatue (lead); Nvidia, Google, returning | $2.3B | $29.3B |
| Series E (reported in talks) | Apr 2026 | a16z + Thrive (co-lead); Nvidia strategic | ~$2B+ | ~$50B pre |

Sources: [https://techcrunch.com/2026/04/17/sources-cursor-in-talks-to-raise-2b-at-50b-valuation-as-enterprise-growth-surges/], [https://thenextweb.com/news/cursor-anysphere-2-billion-funding-50-billion-valuation-ai-coding], [https://techcrunch.com/2025/05/04/cursor-is-reportedly-raising-funds-at-9-billion-valuation-from-thrive-a16z-and-accel/], [https://en.wikipedia.org/wiki/Anysphere].

There were also separate-track reports of a **SpaceX-led acquisition offer at ~$60B** in late April 2026, which appears to have been an option/structured deal rather than a closed acquisition [source: https://www.bloomberg.com/news/articles/2026-04-22/andreessen-thrive-poised-for-windfall-from-spacex-s-cursor-bid] [source: https://news.ycombinator.com/item?id=47855293]. The relationship between Anysphere and SpaceX's "Colossus 2" cluster is also the venue Cursor uses to train its larger next-generation model.

---

## 14. Public Roadmap and 2026 Direction

What Cursor has publicly committed to in 2026:

- **Composer 2.5** shipped May 18, 2026 as Cursor's flagship in-house model: Opus-4.7-quality on coding benchmarks at roughly 1/10 the inference cost; built on Kimi K2.5 base + heavy RL post-training [source: https://cursor.com/blog/composer-2-5].
- **A larger frontier model trained from scratch with SpaceXAI / Colossus 2 (10× more compute)** is the publicly-disclosed successor effort. No release date. There is **no announced "Composer 3"** — the line was renamed implicitly with Cursor 3.0 in April 2026 [source: https://medium.com/@tentenco/cursor-3-ships-an-agent-first-interface-heres-what-it-actually-changes-1f2bf8f383e2].
- **Agent-first UX**: Cursor 3.0 reorients the IDE around long-running cloud agents rather than file-centric editing. Background-agent and Bugbot become first-class.
- **Marketplace expansion**: more first-party plugins for enterprise SaaS, private team marketplaces.
- **Enterprise compliance**: SOC 2 Type II continues, FedRAMP and ISO 27001 work referenced in interviews but no firm date.

Notably **not** on the public roadmap: on-prem / VPC deployment, JetBrains support, native mobile.

---

## 15. Team Composition

Anysphere was founded in 2022 by four MIT undergraduates:

- **Michael Truell** — CEO. Fundraising, strategy.
- **Sualeh Asif** — Chief Product Officer. Product/UX direction.
- **Arvid Lunnemark** — CTO. Engineering and infrastructure.
- **Aman Sanger** — COO. Operations, pricing, growth, dev community.

All four became paper billionaires by late 2025 [source: https://www.founded.com/meet-the-20-year-old-billionaire-founders-of-cursor-the-ai-coding-startup-valued-at-29-3-billion/] [source: https://en.wikipedia.org/wiki/Anysphere]. Headquartered in San Francisco. Public headcount is not consistently disclosed; press in early 2026 references the team having grown to "several hundred" with aggressive hiring in research (post-training, evals) and forward-deployed engineering for enterprise customers.

Founder presence is high on X (@amanrsanger, @sualehasif996, @arvidkahl-style threads from Lunnemark) and they regularly drop research notes about Composer training, eval methodology, and infrastructure choices.

---

## 16. Competitive Positioning Stance

Cursor's official position is conspicuously **non-combative**: blog posts and founder threads almost never name Copilot, Windsurf, or Continue. The implicit positioning is "we're the only AI-native IDE; everyone else bolts AI onto an existing editor." Sanger's interviews emphasize three lines:

1. **The IDE is the product.** Cursor argues that being a fork (not a plugin) is what allows the agent loop to actually work — they can change the editor, not just hover over it. This is the implicit shot at Copilot.
2. **Frontier model access matters more than features.** Cursor markets early access to Claude/GPT/Gemini frontier model versions as a core differentiator over Windsurf.
3. **Composer 2.5 is a moat.** With an in-house, lower-cost model that's competitive on benchmarks, Cursor reframes its margin story without admitting it had a margin problem.

Externally, the comparisons that draw blood — Aman Sanger has discussed unit economics of Cursor vs. Claude Code on podcasts — are aimed at **Claude Code (Anthropic's own CLI)**, which is now seen as the most serious threat for technical-IC users who don't need the IDE polish [source: https://www.aicerts.ai/news/cursors-coding-ai-billionaire-surge/] [source: https://ucstrategies.com/news/cursor-hit-2b-revenue-while-developers-quietly-switched-to-cheaper-rivals/].

---

## 17. Distribution and Acquisition

Cursor's growth playbook is the canonical "developer-tool viral loop" of the 2020s [source: https://www.news.aakashg.com/p/how-cursor-grows] [source: https://www.productgrowth.blog/p/how-cursor-ai-hacked-growth]:

- **Twitter/X** is the single biggest channel — founders + a16z + influencer demos drove early growth.
- **Hacker News** launches (the original "Cursor has raised $60M" thread is a reference point [source: https://news.ycombinator.com/item?id=41325543]).
- **YouTube demos** from indie hackers and "vibe-coding" creators turned each model release into a fresh wave.
- **Discord and forum.cursor.com** were used as collaborator channels where the team explicitly responded to early adopters, generating a sense of co-ownership.
- **Enterprise top-down adoption** has now overtaken individual viral as the primary growth engine: a Fortune 500 CTO buys Cursor, then it rolls out to thousands of seats, which is also where the better unit economics live.

The "10× faster" first-experience moment in Composer is the actual product engine — sharable demos make the loop go.

---

## 18. Churn, Complaints, and Why Users Leave

Recurring themes from forum.cursor.com, /r/cursor (now /r/cursor_ai), Trustpilot, and Twitter:

1. **Billing surprises.** The June 2025 credit-pool migration is still cited as the canonical bad memory. Users who used to get "500 fast requests" for $20 now run out at ~225 equivalent requests, and overages are large and unfamiliar. Some report single-week bills in the hundreds [source: https://www.fintechweekly.com/magazine/articles/cursor-pricing-change-user-backlash-refund] [source: https://www.finout.io/blog/what-happened-to-cursor-pricing-2026-guide-5-cost-cutting-tips].
2. **Rate-limit ceilings.** 1 req/min and ~30 req/hour caps catch heavy agent users mid-flow.
3. **BYOK is hobbled.** Power users who want to plug in their own Anthropic/OpenAI keys discover that Agent + Edit refuse to run on BYOK and churn to Continue, Cline, or Claude Code [source: https://apidog.com/blog/cursor-byok-ban-alternative/].
4. **VS Code lock-in.** JetBrains, Neovim, and Emacs users have no path to Cursor and choose Copilot, Codeium/Windsurf, or Continue instead [source: https://www.aitooldiscovery.com/guides/cursor-reddit].
5. **Privacy / no-VPC.** Regulated industries (defense, healthcare, finance) cannot satisfy "no data leaves our perimeter" requirements with Cursor's cloud-only enterprise offering.
6. **Auto-mode opacity.** Users feel they cannot tell whether their request was routed to a frontier model or a cheap one, and suspect Cursor underpicks Opus to protect margin [source: https://medium.com/@zulfiqarajillani/hidden-costs-of-cursor-auto-model-pricing-forcing-me-to-leave-my-favorite-ai-editor-cc6268e756ac].
7. **Migration to Claude Code / Windsurf.** The most-named alternatives in switching threads are Anthropic Claude Code (for CLI-comfortable engineers) and Windsurf (for editor-shaped users).

Despite the volume of complaints, Cursor's ARR continues to grow because enterprise adoption is decoupled from the IC complaint loop — the people writing angry forum posts are not the people authorizing $2M Enterprise contracts.

---

## Sources

- [Cursor pricing page](https://cursor.com/pricing)
- [Cursor Enterprise overview](https://cursor.com/enterprise)
- [Cursor Enterprise docs](https://cursor.com/docs/enterprise)
- [Cursor Identity and Access Management docs](https://cursor.com/docs/enterprise/identity-and-access-management)
- [Cursor BYOK docs](https://cursor.com/help/models-and-usage/api-keys)
- [Cursor Marketplace launch blog](https://cursor.com/blog/new-plugins)
- [Cursor 2.6 changelog (MCP apps + team marketplaces)](https://cursor.com/changelog/2-6)
- [Introducing Composer 2.5 (Cursor blog)](https://cursor.com/blog/composer-2-5)
- [Cursor surpasses $2B ARR (TechCrunch)](https://techcrunch.com/2026/03/02/cursor-has-reportedly-surpassed-2b-in-annualized-revenue/)
- [Cursor in talks to raise $2B at $50B valuation (TechCrunch)](https://techcrunch.com/2026/04/17/sources-cursor-in-talks-to-raise-2b-at-50b-valuation-as-enterprise-growth-surges/)
- [Andreessen, Thrive poised for windfall from SpaceX's Cursor bid (Bloomberg)](https://www.bloomberg.com/news/articles/2026-04-22/andreessen-thrive-poised-for-windfall-from-spacex-s-cursor-bid)
- [Anysphere $900M Series C at $9.9B (TechCrunch)](https://techcrunch.com/2025/05/04/cursor-is-reportedly-raising-funds-at-9-billion-valuation-from-thrive-a16z-and-accel/)
- [Anysphere Wikipedia](https://en.wikipedia.org/wiki/Anysphere)
- [Cursor pricing explained (Vantage)](https://www.vantage.sh/blog/cursor-pricing-explained)
- [What Happened to Cursor Pricing (Finout)](https://www.finout.io/blog/what-happened-to-cursor-pricing-2026-guide-5-cost-cutting-tips)
- [Cursor backlash + refund timeline (FinTech Weekly)](https://www.fintechweekly.com/magazine/articles/cursor-pricing-change-user-backlash-refund)
- [Cursor's new pricing structure explained (Tessl)](https://tessl.io/blog/cursor-new-pricing-structure-explained/)
- [Hidden costs of Cursor Auto mode (Medium / Zulfiqar Jillani)](https://medium.com/@zulfiqarajillani/hidden-costs-of-cursor-auto-model-pricing-forcing-me-to-leave-my-favorite-ai-editor-cc6268e756ac)
- [Cursor's pricing disaster timeline (We Are Founders)](https://www.wearefounders.uk/cursors-pricing-disaster-the-full-timeline-of-how-an-ai-coding-darling-burned-its-most-loyal-users/)
- [How much money is Cursor losing? (Andrea Gao)](https://andreagao.com/posts/cursor-losing-money-for-user/)
- [Is Cursor profitable today? (Market Clarity)](https://mktclarity.com/blogs/news/is-cursor-profitable)
- [BYOK ban alternatives (Apidog)](https://apidog.com/blog/cursor-byok-ban-alternative/)
- [BYOK community thread (forum.cursor.com)](https://forum.cursor.com/t/byok-bring-your-own-key/25578)
- [OpenVSX transition thread](https://forum.cursor.com/t/extension-marketplace-changes-transition-to-openvsx/109138)
- [Cursor Reddit roundup 2026 (AI Tool Discovery)](https://www.aitooldiscovery.com/guides/cursor-reddit)
- [Cursor AI statistics 2026 (getpanto)](https://www.getpanto.ai/blog/cursor-ai-statistics)
- [Cursor hits 1M daily users (dev.to)](https://dev.to/alanwest/cursor-hit-1-million-daily-users-what-are-they-doing-right-4nm2)
- [Detailed enterprise security report (harini.blog)](https://harini.blog/2025/05/07/detailed-security-and-enterprise-readiness-report-cursor-ai-ide/)
- [Cursor Composer 2.5 matches Opus 4.7 (The Decoder)](https://the-decoder.com/cursors-composer-2-5-matches-opus-4-7-and-gpt-5-5-benchmarks-at-a-fraction-of-the-cost/)
- [How Cursor grows (Aakash Gupta)](https://www.news.aakashg.com/p/how-cursor-grows)
- [Growth Machines: The Cursor Story (BuilderLab)](https://www.builderlab.ai/p/growth-machines-the-cursor-story)
- [GitHub Copilot pricing 2026 (TechSifted)](https://techsifted.com/reviews/github-copilot-pricing-2026/)
- [AI coding tools pricing comparison (Developers Digest)](https://www.developersdigest.tech/blog/ai-coding-tools-pricing-2026)
- [Best Cursor alternatives 2026 (NxCode)](https://www.nxcode.io/resources/news/cursor-alternative-2026-best-ai-code-editors)
- [Cursor vs Tabnine enterprise (Augment Code)](https://www.augmentcode.com/tools/cursor-vs-tabnine)
- [Meet the billionaire founders of Cursor (Founded)](https://www.founded.com/meet-the-20-year-old-billionaire-founders-of-cursor-the-ai-coding-startup-valued-at-29-3-billion/)
- [Cursor 3 ships agent-first interface (Medium / Ewan Mak)](https://medium.com/@tentenco/cursor-3-ships-an-agent-first-interface-heres-what-it-actually-changes-1f2bf8f383e2)
- [Cursor Has Raised $60M (Hacker News)](https://news.ycombinator.com/item?id=41325543)
- [SpaceX says it has agreement to acquire Cursor for $60B (Hacker News)](https://news.ycombinator.com/item?id=47855293)
