# SaaS / AI Dev-Tool Pricing Benchmarks

Reference data for validating eri's pricing model. All figures sourced from public reports as of 2025–2026.

---

## 1. Gross Margin Benchmarks

- **Public SaaS median gross margin: ~72–78%**, with top quartile >80%. 63% of public SaaS companies posted GM >70% in Q2 2025; 23% cleared 80%. — *Benchmarkit 2025 SaaS Performance Metrics*
- **Investor expectation at scale: 75–85% GM once past $50M ARR.** Companies above 80% GM traded at 7.2x EV/TTM revenue vs 3.5x for those <60% (a 105% premium). — *High Alpha / SEG SaaS Index 2025*
- **AI-native company GM benchmark: ~65%** (Bessemer State of AI 2025), well below the 80–90% ceiling of classical SaaS. Early-stage GM has compressed ~10pts YoY driven by AI COGS. — *Bessemer State of AI 2025; Benchmarkit*
- **Microsoft Cloud GM dropped to ~64%** YoY, explicitly attributed to "continued investments in AI and increased GitHub Copilot usage." — *MSFT FY2024 earnings call*
- **GitHub Copilot reportedly loses ~$20/user/month** on a $10/mo plan; some heavy users cost MS up to $80/mo. Effective GM is sharply **negative** — explicit loss-leader. — *WSJ via AIBusiness / Thurrott, Oct 2023*
- **Cursor unit economics:** Bessemer pegs LLM-native GM at ~65%. After June 2025 repricing, Cursor moved to a pass-through credit model ($20 plan ≈ $20 of API spend at list rates), implying their margin sits in infra/routing optimization rather than markup. — *Vantage; Finout 2026 Cursor guide*
- **Vercel historical:** sat at **0% GM at $2M ARR**, scaled to **70%+ GM past $8M and $200M ARR** without product compromise. Proof that AI/infra GM can be a stage-of-growth issue, not a permanent ceiling. — *Notable Capital, "Margin Trap Myth"*
- **Practical floors:**
  - **<60% GM** = VC red flag at Series A+ (multiples crater).
  - **<30% GM = loss-leader / "infrastructure" territory** — defensible only with a credible path to 60%+ (volume discounts, caching, model distillation, routing).

## 2. Freemium Loss / Conversion Rates

- **Developer-tool freemium conversion: 1–3%** (one of the lowest converting SaaS segments). Free-trial models on dev/infra convert higher at **5–15%**. — *First Page Sage 2026; Userpilot*
- **General freemium 30-day conversion: 2–5%**, with a high-ROI tail at 8–15%. ChartMogul 2026: cross-vertical freemium average **5.6%**. — *ChartMogul; Guru Startups*
- **B2B SMB SaaS: 2–5%**; productivity tools 3–7%. — *First Page Sage*
- **Time-to-value matters:** products with <5-min TTV see 13–16% visitor-to-signup on freemium vs 7–8% on trials. — *Userpilot 2025*
- **Free-tier behavior of comparable products:**
  - **Vercel Hobby:** generous compute (1M invocations, 100GB transfer, 4 CPU-hrs) — explicit loss-leader, recoups via Pro at $20/seat + usage credits. — *Vercel pricing docs 2026*
  - **Linear Free:** 250 issues, unlimited members — restrictive on workload, not seats. Upgrade trigger = scale. — *Linear pricing*
  - **Notion Free:** unlimited blocks single-user, 7-day history. Upgrade trigger = inviting a teammate. — *Notion pricing*
- **Free-tier as % of revenue / COGS:** no clean public figure, but ProfitWell finds freemium companies see **~50% lower CAC** vs no-free-plan peers, partly offsetting free-tier COGS. — *ProfitWell via Cadence*
- **Loss/churn rate of free users:** industry-typical free-user 30/90/180-day churn before conversion is **70 / 85 / 92%** for low-touch B2C dev tools (i.e. only ~8% remain active at 6 months without converting). — *Userpilot / First Page Sage benchmark synthesis*

## 3. AI Product Cost Considerations

- **Token-cost / revenue ratio:**
  - Cursor Pro $20/mo ≈ 225 Claude 3.5 Sonnet, 500 GPT-4o, or 550 Gemini requests at list API rates → effective **~100% pass-through** (token COGS = revenue) on the marginal user. Margin comes from cached/routed/distilled requests on top. — *Vantage 2026 Cursor breakdown*
  - Copilot at $10/mo loses ~$20/user → **token COGS ≈ 300% of revenue** for heavy users. — *AIBusiness 2023*
- **Token-price tailwind:** API token prices have dropped **>80% over 2 years** since GPT-3. The same product spec becomes margin-positive over time if revenue holds. — *Notable Capital*
- **Burn per user tolerated by stage** (synthesized from a16z spending report, Zeni burn data):
  - **Seed:** $5–$25/user/mo of AI COGS acceptable if engagement/retention is strong and there's a credible path to break-even on token-price decline.
  - **Series A:** target **GM ≥ 50%**, AI COGS ≤ 50% of ARPU; explicit roadmap to 70%+ at scale.
  - **Series B:** GM ≥ 65–70% non-negotiable; investors penalize "AI is expensive" excuses.
- **Cost-reduction levers** in scope at every stage: prompt caching (30–50% savings), self-hosted distilled models (<$0.55 per M tokens for Llama-3 70B), aggressive routing to cheaper models for low-stakes calls. — *Runpod; Adaline Labs*

---

## Recommendation for eri

**Target gross margin: 55–65% at launch, 70%+ by Series A.**
- Below 55% GM = burning runway on every paying user; only justifiable if retention/expansion is extraordinary.
- Mercury 2 API is the COGS dial — model the marginal cost per active session and price the paid tier at ≥2x that floor.

**Free tier: target 2–4% conversion at ≤$3/free-user/mo of COGS.**
- Restrict the free tier on *workload* (sessions, generation minutes), not on *seats* — mirrors Linear's playbook and avoids Copilot's "heavy user wipeout" trap.
- Assume 85% of free signups churn within 90 days; the free tier exists to feed the 15% who stick, not to subsidize the masses.

**Hard guardrails:**
- If any cohort's token COGS > 80% of its ARPU for >60 days, gate the experience (rate-limit, route to cheaper model) before raising prices.
- Voice/gaze/TTS run locally (zero marginal COGS) — lean on this as a structural margin advantage vs Cursor/Copilot.

---

### Sources

- [Benchmarkit 2025 SaaS Performance Metrics](https://www.benchmarkit.ai/2025benchmarks)
- [CloudZero – SaaS Gross Margin Benchmarks 2025](https://www.cloudzero.com/blog/saas-gross-margin-benchmarks/)
- [High Alpha 2025 SaaS Benchmarks Report](https://www.highalpha.com/saas-benchmarks)
- [Notable Capital – The Margin Trap Myth (Vercel 0%→70% case)](https://www.notablecap.com/blog/the-gross-margin-trap-myth)
- [Vantage – Cursor Pricing Explained 2026](https://www.vantage.sh/blog/cursor-pricing-explained)
- [Finout – What Happened to Cursor Pricing 2026](https://www.finout.io/blog/what-happened-to-cursor-pricing-2026-guide-5-cost-cutting-tips)
- [AIBusiness – Copilot Loses $20/user/month](https://aibusiness.com/nlp/github-copilot-loses-20-a-month-per-user)
- [Thurrott – Copilot Loses $20/user Report](https://www.thurrott.com/cloud/290661/report-github-copilot-loses-an-average-of-20-per-user-per-month)
- [First Page Sage – SaaS Freemium Conversion Rates 2026](https://firstpagesage.com/seo-blog/saas-freemium-conversion-rates/)
- [Userpilot – SaaS Average Conversion Rate Benchmarks](https://userpilot.com/blog/saas-average-conversion-rate/)
- [Guru Startups – Freemium to Paid Benchmarks 2025](https://www.gurustartups.com/reports/freemium-to-paid-conversion-rate-benchmarks)
- [a16z – AI Application Spending Report](https://a16z.com/the-ai-application-spending-report-where-startup-dollars-really-go/)
- [Sacra – Vercel revenue, valuation & funding](https://sacra.com/c/vercel/)
- [Sacra – Replit revenue & funding](https://sacra.com/c/replit/)
- [Vercel Pricing](https://vercel.com/pricing)
- [Adaline Labs – Token Burnout](https://labs.adaline.ai/p/token-burnout-why-ai-costs-are-climbing)
- [Runpod – LLM Inference Optimization Playbook](https://www.runpod.io/articles/guides/llm-inference-optimization-playbook)
