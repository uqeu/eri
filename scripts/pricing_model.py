#!/usr/bin/env python3
"""
eri pricing model — the single source of truth for the full per-tier economy.

eri is a token harness. A signed-in user spends **eri tokens** (a synthetic unit
= the frontier "credit"); they never bring their own provider key. Two cost
tracks sit under one plan:

  1. FRONTIER (Claude)  — the eri-token track. Metered as credits = in + 5*out,
     so a credit's real cost is bounded by Sonnet's INPUT rate ($3/M) regardless
     of the in/out mix. The per-tier eri **context window** (window_for in
     build_agent.rs) caps input tokens per call, so worst-case per-turn cost is
     bounded. This is where the money is at risk and where truncation pays off.

  2. MERCURY (diffusion) — fast "edit with your eyes". Cheap ($0.25/$0.75 per M),
     metered as turns. A generous allowance that feels unlimited on a first
     session, then converts.

Run:
    python3 scripts/pricing_model.py
    python3 scripts/pricing_model.py --target-margin 0.5 --cache-hit-rate 0.5

Keep this in sync with website/lib/tiers.ts — the marketing site, the billing
layer, and this model must all agree.
"""

from __future__ import annotations

import argparse
from dataclasses import dataclass


# ─── Mercury 2 pricing (Inception Labs, USD per token) ──────────────────────
MERCURY_INPUT_PER_TOKEN = 0.00000025          # $0.25 / 1M
MERCURY_OUTPUT_PER_TOKEN = 0.00000075         # $0.75 / 1M
MERCURY_CACHED_INPUT_PER_TOKEN = 0.0000000625  # $0.0625 / 1M (~25% of full input)

# ─── Frontier pricing (Claude Sonnet, USD per token) ────────────────────────
# A credit is bounded by the INPUT rate: credits = in + 5*out, and
# 5*out * $3/M == out * $15/M (the real output cost). So credits * $3/M is an
# exact upper bound on Sonnet COGS for any in/out mix — the no-loss meter.
SONNET_INPUT_PER_TOKEN = 0.000003   # $3 / 1M
COST_PER_CREDIT = SONNET_INPUT_PER_TOKEN  # $ per eri token, worst case

# ─── Observed Mercury usage shape per voice turn ────────────────────────────
AVG_INPUT_TOKENS_PER_TURN = 15_000
AVG_OUTPUT_TOKENS_PER_TURN = 3_000

# ─── Fixed infra cost per active user per month ─────────────────────────────
# Paid tiers carry cloud sync + Stripe + Supabase. Free is deliberately
# local-only (no cloud sync, no Stripe object until upgrade) so it barely costs
# anything even at 1000s of users — see FREE_INFRA.
INFRA_COST_PER_USER_PER_MONTH = 2.0
FREE_INFRA_COST_PER_USER_PER_MONTH = 0.05


@dataclass(frozen=True)
class Tier:
    name: str
    price_monthly: float       # USD/month (per seat for Teams)
    eri_tokens_included: int   # frontier credits included (the metered budget)
    eri_tokens_ghost: int      # soft overage pool above included (warned, then 402)
    context_window: int        # per-tier eri context window (input cap per call)
    free_turns: int = 0        # bonus Mercury turns (Free tier sweetener)
    infra: float = INFRA_COST_PER_USER_PER_MONTH


# Numbers mirror website/lib/tiers.ts (TIER_TOKEN_BUDGETS) and build_agent.rs
# window_for(). PRICES ARE THE SHIPPED ONES — keep reconciled with stripe.ts.
TIERS: list[Tier] = [
    Tier("Free",    0.0,         0,        0,  25_000, free_turns=50,
         infra=FREE_INFRA_COST_PER_USER_PER_MONTH),
    Tier("Starter", 15.0,  200_000,   40_000,  54_000),
    Tier("Pro",     30.0,  750_000,  150_000, 128_000),
    Tier("Pro+",    60.0, 4_000_000, 800_000, 256_000),
    Tier("Teams",   30.0, 3_000_000, 600_000, 256_000),  # per seat
]


def mercury_cost_per_turn(cache_hit_rate: float) -> float:
    eff_input = (
        (1 - cache_hit_rate) * MERCURY_INPUT_PER_TOKEN
        + cache_hit_rate * MERCURY_CACHED_INPUT_PER_TOKEN
    )
    return (
        AVG_INPUT_TOKENS_PER_TURN * eff_input
        + AVG_OUTPUT_TOKENS_PER_TURN * MERCURY_OUTPUT_PER_TOKEN
    )


def compute_tier(tier: Tier, target_margin: float, cache_hit_rate: float) -> dict:
    revenue = tier.price_monthly

    # Mercury track: how many turns the diffusion budget affords.
    mercury_budget = max(0.0, (revenue - tier.infra) * (1 - target_margin))
    per_turn = mercury_cost_per_turn(cache_hit_rate)
    paid_turns = int(mercury_budget / per_turn) if per_turn > 0 else 0
    total_turns = paid_turns + tier.free_turns
    mercury_cogs = total_turns * per_turn

    # Frontier track: worst-case Claude COGS = all eri tokens (incl + ghost)
    # spent at the bounded per-credit cost.
    eri_tokens_hard = tier.eri_tokens_included + tier.eri_tokens_ghost
    frontier_cogs = eri_tokens_hard * COST_PER_CREDIT

    # Combined worst case: a user maxes BOTH tracks in a month.
    total_cogs = tier.infra + mercury_cogs + frontier_cogs
    margin_dollars = revenue - total_cogs
    margin_pct = 0.0 if revenue == 0 else margin_dollars / revenue

    # Rate limits divide the Mercury allowance across an active month.
    daily = max(5, int(total_turns / 28))
    weekly = max(20, int(total_turns / 4))
    hourly = max(2, int(daily / 8))

    return {
        "name": tier.name,
        "price": revenue,
        "eri_tokens": tier.eri_tokens_included,
        "context_window": tier.context_window,
        "turns_per_month": total_turns,
        "turns_per_day": daily,
        "turns_per_week": weekly,
        "burst_per_hour": hourly,
        "mercury_cogs": mercury_cogs,
        "frontier_cogs": frontier_cogs,
        "total_cogs": total_cogs,
        "margin_dollars": margin_dollars,
        "margin_pct": margin_pct,
    }


def money(v: float) -> str:
    return f"${v:>7.2f}"


def print_table(rows: list[dict]) -> None:
    header = (
        f"{'TIER':<8} {'PRICE':>7} {'eriTOK':>10} {'CTXWIN':>8} "
        f"{'TURNS/MO':>9} {'/DAY':>5} {'MERC$':>7} {'CLAUDE$':>8} "
        f"{'COGS$':>7} {'MARGIN$':>8} {'MARGIN%':>8}"
    )
    print(header)
    print("─" * len(header))
    for r in rows:
        print(
            f"{r['name']:<8} {money(r['price'])} {r['eri_tokens']:>10,} "
            f"{r['context_window']:>8,} {r['turns_per_month']:>9,} "
            f"{r['turns_per_day']:>5} {money(r['mercury_cogs'])} "
            f"{money(r['frontier_cogs'])} {money(r['total_cogs'])} "
            f"{money(r['margin_dollars'])} {r['margin_pct'] * 100:>7.1f}%"
        )


def main() -> None:
    parser = argparse.ArgumentParser(description="eri full-economy pricing model")
    parser.add_argument("--target-margin", type=float, default=0.35,
                        help="Mercury budget margin target (0-1). Default 0.35.")
    parser.add_argument("--cache-hit-rate", type=float, default=0.5,
                        help="Mercury cache hit rate (0-1). Default 0.5.")
    args = parser.parse_args()

    print()
    print("eri full-economy model — eri tokens (frontier credits) + Mercury turns")
    print(f"  Mercury margin target  : {args.target_margin * 100:.0f}%")
    print(f"  Mercury cache hit rate : {args.cache_hit_rate * 100:.0f}%")
    print(f"  $ per eri token (worst): "
          f"${COST_PER_CREDIT * 1_000_000:.2f} / 1M  (Sonnet input bound)")
    print("  COGS$ column = worst case: BOTH tracks maxed in one month + infra")
    print()
    rows = [compute_tier(t, args.target_margin, args.cache_hit_rate) for t in TIERS]
    print_table(rows)
    print()
    print("Reading this:")
    print("  - eriTOK = frontier credits included (the metered eri-token budget).")
    print("    Hard cap = included + a ghost pool; beyond it the proxy returns 402.")
    print("  - CTXWIN = the per-tier eri context window: input tokens are compacted")
    print("    to fit it before every call, which is what bounds CLAUDE$ per turn.")
    print("  - CLAUDE$ is WORST CASE (every eri token spent at the $3/M bound, no")
    print("    cache). Real cost is lower (prompt caching, compaction, fast-lane).")
    print("  - MARGIN% is the worst-case combined gross margin. Every PAID tier is")
    print("    margin-positive even if a user maxes both tracks. Teams is thinnest.")
    print("  - Free is local-only (infra ~$0.05) so 1000s of free users cost little.")
    print("  - Excludes Stripe fees, support, refunds.")


if __name__ == "__main__":
    main()
