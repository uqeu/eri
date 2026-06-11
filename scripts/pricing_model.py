#!/usr/bin/env python3
"""
eri pricing model — the single source of truth for the full per-tier economy.

eri is a credit harness. A signed-in user spends **eri credits** (a synthetic
unit); they never bring their own provider key. Two cost tracks sit under one
plan:

  1. FRONTIER (Claude)  — the eri-credit track. Metered as credits = in + 5*out,
     so a credit's real cost is bounded by Sonnet's INPUT rate ($3/M) regardless
     of the in/out mix. The per-tier eri **context window** (window_for in
     build_agent.rs) caps input tokens per call, so worst-case per-turn cost is
     bounded. This is where the money is at risk and where truncation pays off.

  2. MERCURY (diffusion) — fast "edit with your eyes". Cheap today ($0.25/$0.75
     per M) but NOT free forever — Inception will charge eventually, so keep the
     Mercury allowance honest, not infinite. Metered as turns.

Teams is intentionally NOT offered right now (no per-seat plan). Plans: Free,
Starter, Pro, Pro+.

Run:
    python3 scripts/pricing_model.py
    python3 scripts/pricing_model.py --target-margin 0.5 --cache-hit-rate 0.5

Keep this in sync with website/lib/tiers.ts — the marketing site, the billing
layer, and this model must all agree.
"""

from __future__ import annotations

import argparse
import json
from dataclasses import dataclass
from pathlib import Path


# ─── Mercury 2 pricing (Inception Labs, USD per token) ──────────────────────
MERCURY_INPUT_PER_TOKEN = 0.00000025          # $0.25 / 1M
MERCURY_OUTPUT_PER_TOKEN = 0.00000075         # $0.75 / 1M
MERCURY_CACHED_INPUT_PER_TOKEN = 0.0000000625  # $0.0625 / 1M (~25% of full input)

# ─── Frontier pricing (Claude Sonnet, USD per token) ────────────────────────
# A credit is bounded by the INPUT rate: credits = in + 5*out, and
# 5*out * $3/M == out * $15/M (the real output cost). So credits * $3/M is an
# exact upper bound on Sonnet COGS for any in/out mix — the no-loss meter.
SONNET_INPUT_PER_TOKEN = 0.000003   # $3 / 1M
COST_PER_CREDIT = SONNET_INPUT_PER_TOKEN  # $ per eri credit, worst case

# ─── Observed Mercury usage shape per voice turn ────────────────────────────
AVG_INPUT_TOKENS_PER_TURN = 15_000
AVG_OUTPUT_TOKENS_PER_TURN = 3_000

# ─── Fixed infra cost per active user per month ─────────────────────────────
# Paid tiers carry cloud sync + Stripe + Supabase. Free is deliberately
# local-only (no cloud sync, no Stripe object until upgrade) so it barely costs
# anything even at 1000s of users — see FREE_INFRA.
INFRA_COST_PER_USER_PER_MONTH = 2.0
FREE_INFRA_COST_PER_USER_PER_MONTH = 0.0


@dataclass(frozen=True)
class Tier:
    name: str
    price_monthly: float       # USD/month
    credits_included: int      # frontier credits included (the metered budget)
    credits_ghost: int         # soft overage pool above included (warned, then 402)
    context_window: int        # per-tier eri context window (input cap per call)
    free_turns: int = 0        # bonus Mercury turns (Free tier sweetener)
    infra: float = INFRA_COST_PER_USER_PER_MONTH


# The per-tier numbers (price, credits, context window) come from the repo-root
# tiers.json — the SINGLE SOURCE OF TRUTH shared with the Rust window_for() and
# the TS tiers.ts. free_turns + infra are pricing-model assumptions, set here.
def _load_tiers() -> list[Tier]:
    path = Path(__file__).resolve().parent.parent / "tiers.json"
    data = json.loads(path.read_text(encoding="utf-8"))
    out: list[Tier] = []
    for t in data["tiers"]:
        is_free = t["slug"] == "free"
        out.append(
            Tier(
                name=t["name"],
                price_monthly=float(t["priceMonthly"]),
                credits_included=int(t["creditsIncluded"]),
                credits_ghost=int(t["creditsGhost"]),
                context_window=int(t["contextWindow"]),
                free_turns=50 if is_free else 0,
                infra=(
                    FREE_INFRA_COST_PER_USER_PER_MONTH
                    if is_free
                    else INFRA_COST_PER_USER_PER_MONTH
                ),
            )
        )
    return out


TIERS: list[Tier] = _load_tiers()


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

    # Frontier track: worst-case Claude COGS = all credits (incl + ghost) spent
    # at the bounded per-credit cost.
    credits_hard = tier.credits_included + tier.credits_ghost
    frontier_cogs = credits_hard * COST_PER_CREDIT

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
        "credits": tier.credits_included,
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
        f"{'TIER':<8} {'PRICE':>7} {'CREDITS':>10} {'CTXWIN':>8} "
        f"{'TURNS/MO':>9} {'/DAY':>5} {'MERC$':>7} {'CLAUDE$':>8} "
        f"{'COGS$':>7} {'MARGIN$':>8} {'MARGIN%':>8}"
    )
    print(header)
    print("─" * len(header))
    for r in rows:
        print(
            f"{r['name']:<8} {money(r['price'])} {r['credits']:>10,} "
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
    print("eri full-economy model — eri credits (frontier) + Mercury turns")
    print(f"  Mercury margin target  : {args.target_margin * 100:.0f}%")
    print(f"  Mercury cache hit rate : {args.cache_hit_rate * 100:.0f}%")
    print(f"  $ per eri credit (worst): "
          f"${COST_PER_CREDIT * 1_000_000:.2f} / 1M  (Sonnet input bound)")
    print("  COGS$ column = worst case: BOTH tracks maxed in one month + infra")
    print()
    rows = [compute_tier(t, args.target_margin, args.cache_hit_rate) for t in TIERS]
    print_table(rows)
    print()
    print("Reading this:")
    print("  - CREDITS = frontier credits included (the metered eri-credit budget).")
    print("    Hard cap = included + a ghost pool; beyond it the proxy returns 402.")
    print("  - CTXWIN = the per-tier eri context window: input is compacted to fit")
    print("    it before every call, which is what bounds CLAUDE$ per turn.")
    print("  - CLAUDE$ is WORST CASE (every credit spent at the $3/M bound, no")
    print("    cache). Real cost is far lower (caching, compaction, fast-lane).")
    print("  - MARGIN% is the worst-case combined gross margin. Every PAID tier is")
    print("    margin-positive even if a user maxes both tracks.")
    print("  - Free is local-only (no cloud sync / no Stripe object): infra $0, so")
    print("    1000s of free users cost ~nothing.")
    print("  - No Teams plan right now. Excludes Stripe fees, support, refunds.")


if __name__ == "__main__":
    main()
