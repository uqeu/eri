#!/usr/bin/env python3
"""
eri pricing model — computes per-tier Mercury 2 token budgets and rate limits.

Run with:
    python3 scripts/pricing_model.py
    python3 scripts/pricing_model.py --target-margin 0.6
    python3 scripts/pricing_model.py --cache-hit-rate 0.5

The output is a table the billing layer and the marketing site should both
agree with. Adjust the assumptions at the top and re-run if Inception
changes pricing, our infra cost shifts, or our usage mix moves.
"""

from __future__ import annotations

import argparse
from dataclasses import dataclass


# ─── Mercury 2 pricing (Inception Labs, USD per token) ──────────────────────
PRICE_INPUT_PER_TOKEN = 0.00000025          # $0.25 / 1M
PRICE_OUTPUT_PER_TOKEN = 0.00000075         # $0.75 / 1M
PRICE_CACHED_INPUT_PER_TOKEN = 0.0000000625 # $0.0625 / 1M (assumed 25% of full input)


# ─── Observed usage shape per voice turn ────────────────────────────────────
# eri sends whole files for diffusion edits, so input >> output.
# Initial build:  ~10k in, ~5k out.   Iterate: ~20k in, ~2k out.
# Average across mix:
AVG_INPUT_TOKENS_PER_TURN = 15_000
AVG_OUTPUT_TOKENS_PER_TURN = 3_000


# ─── Fixed infra costs per active user per month (Vercel, Supabase, Stripe) ─
INFRA_COST_PER_USER_PER_MONTH = 2.0


# ─── Public tier prices (locked) ────────────────────────────────────────────
@dataclass(frozen=True)
class Tier:
    name: str
    price_monthly: float     # USD/month
    seats: int = 1
    free_turns: int = 0      # bonus turns above the budget (Free tier only)


TIERS: list[Tier] = [
    Tier("Free",      0.0,  free_turns=50),
    Tier("Starter",  15.0),
    Tier("Pro",      25.0),
    Tier("Pro+",     45.0),
    Tier("Teams",    30.0),  # per seat
]


def cost_per_turn(cache_hit_rate: float) -> float:
    """Effective $ per voice turn given a cache hit rate (0.0 - 1.0)."""
    effective_input_price = (
        (1 - cache_hit_rate) * PRICE_INPUT_PER_TOKEN
        + cache_hit_rate * PRICE_CACHED_INPUT_PER_TOKEN
    )
    input_cost = AVG_INPUT_TOKENS_PER_TURN * effective_input_price
    output_cost = AVG_OUTPUT_TOKENS_PER_TURN * PRICE_OUTPUT_PER_TOKEN
    return input_cost + output_cost


def compute_tier(tier: Tier, target_margin: float, cache_hit_rate: float) -> dict:
    """How many Mercury turns can this tier afford while preserving margin?"""
    revenue = tier.price_monthly
    infra = INFRA_COST_PER_USER_PER_MONTH
    mercury_budget = max(0.0, (revenue - infra) * (1 - target_margin))

    per_turn = cost_per_turn(cache_hit_rate)
    paid_turns = int(mercury_budget / per_turn) if per_turn > 0 else 0
    total_turns = paid_turns + tier.free_turns

    daily_soft_cap = max(5, int(total_turns / 28))   # divide into ~28 active days
    weekly_soft_cap = max(20, int(total_turns / 4))   # rolling 7-day window
    hourly_burst_cap = max(2, int(daily_soft_cap / 8))  # 8 active hours
    monthly_input_tokens = total_turns * AVG_INPUT_TOKENS_PER_TURN
    monthly_output_tokens = total_turns * AVG_OUTPUT_TOKENS_PER_TURN

    return {
        "name": tier.name,
        "price": tier.price_monthly,
        "mercury_budget": mercury_budget,
        "turns_per_month": total_turns,
        "turns_per_week": weekly_soft_cap,
        "turns_per_day": daily_soft_cap,
        "burst_per_hour": hourly_burst_cap,
        "input_tokens_month": monthly_input_tokens,
        "output_tokens_month": monthly_output_tokens,
        "cost_per_turn": per_turn,
        "projected_monthly_cost": total_turns * per_turn,
        "projected_margin_dollars": revenue - infra - total_turns * per_turn,
        "projected_margin_pct": (
            0.0 if revenue == 0 else
            (revenue - infra - total_turns * per_turn) / revenue
        ),
    }


def format_money(value: float) -> str:
    return f"${value:>7.2f}"


def format_int(value: int) -> str:
    return f"{value:>7,}"


def print_table(rows: list[dict]) -> None:
    header = (
        f"{'TIER':<10} {'PRICE':>8} {'BUDGET':>8} "
        f"{'TURNS/MO':>9} {'/WK':>6} {'/DAY':>6} {'/HR':>5} "
        f"{'COST':>8} {'MARGIN $':>10} {'MARGIN %':>9}"
    )
    print(header)
    print("─" * len(header))
    for row in rows:
        print(
            f"{row['name']:<10} "
            f"{format_money(row['price'])} "
            f"{format_money(row['mercury_budget'])} "
            f"{format_int(row['turns_per_month'])} "
            f"{row['turns_per_week']:>6} "
            f"{row['turns_per_day']:>6} "
            f"{row['burst_per_hour']:>5} "
            f"{format_money(row['projected_monthly_cost'])} "
            f"{format_money(row['projected_margin_dollars'])} "
            f"{row['projected_margin_pct'] * 100:>8.1f}%"
        )


def main() -> None:
    parser = argparse.ArgumentParser(description="eri tier pricing model")
    parser.add_argument(
        "--target-margin",
        type=float,
        default=0.35,
        help="Gross margin target (0-1). Default 0.35 = 35%%.",
    )
    parser.add_argument(
        "--cache-hit-rate",
        type=float,
        default=0.5,
        help="Mercury cache hit rate (0-1). Default 0.5.",
    )
    args = parser.parse_args()

    print()
    print(f"Assumptions:")
    print(f"  Target gross margin       : {args.target_margin * 100:.0f}%")
    print(f"  Mercury cache hit rate    : {args.cache_hit_rate * 100:.0f}%")
    print(f"  Avg input tokens / turn   : {AVG_INPUT_TOKENS_PER_TURN:,}")
    print(f"  Avg output tokens / turn  : {AVG_OUTPUT_TOKENS_PER_TURN:,}")
    print(f"  Infra cost / user / month : ${INFRA_COST_PER_USER_PER_MONTH:.2f}")
    print(f"  Effective $ / turn        : ${cost_per_turn(args.cache_hit_rate):.5f}")
    print()
    rows = [compute_tier(tier, args.target_margin, args.cache_hit_rate) for tier in TIERS]
    print_table(rows)
    print()
    print("Notes:")
    print("  - turns/day is a soft cap. Allow occasional overrun, cut off at 2x.")
    print("  - burst/hr stops a runaway agent from emptying the day in 5 minutes.")
    print("  - MARGIN % is gross. Doesn't account for Stripe fees, support, refunds.")
    print("  - Teams shown PER SEAT. Multiply by seat count for total.")
    print("  - Re-run with --target-margin 0.5 to see how generous limits could be.")


if __name__ == "__main__":
    main()
