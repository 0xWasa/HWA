from __future__ import annotations

import argparse
import json
import math
import random
from dataclasses import asdict, dataclass
from typing import Iterable, Sequence


ETH = 10**18
BPS = 10_000


@dataclass(frozen=True)
class ProtocolConfig:
    inverse_weight_numerator: int = 10**36
    surcharge_bps: int = 1_000
    protocol_acquisition_cut_bps: int = 100
    protocol_keep_fee_bps: int = 100
    cashout_bps: int = 8_500
    vrf_fee_wei: int = 0
    gas_cost_wei: int = 0


@dataclass(frozen=True)
class Position:
    backing_wei: int
    liquidatable_value_wei: int


@dataclass(frozen=True)
class PoolMetrics:
    active_count: int
    total_weight: int
    weighted_backing_total: int
    harmonic_backing_wei: int
    acquisition_price_wei: int


@dataclass(frozen=True)
class EconomicMetrics:
    pool: PoolMetrics
    purchaser_payoff_ev_wei: float
    purchaser_pnl_ev_wei: float
    purchaser_roi: float
    depositor_fee_income_wei: int
    depositor_selection_loss_ev_wei: float
    depositor_pnl_ev_wei: float
    protocol_acquisition_revenue_wei: int
    protocol_settlement_revenue_ev_wei: float
    protocol_total_revenue_ev_wei: float
    keep_probability: float
    cashout_probability: float
    conservation_error_wei: float


@dataclass(frozen=True)
class MonteCarloMetrics:
    draws: int
    purchaser_payoff_ev_wei: float
    purchaser_pnl_ev_wei: float
    purchaser_roi: float
    depositor_selection_loss_ev_wei: float
    protocol_settlement_revenue_ev_wei: float
    keep_probability: float
    cashout_probability: float


def position_weight(position: Position, config: ProtocolConfig) -> int:
    if position.backing_wei <= 0:
        raise ValueError("backing must be positive")
    weight = config.inverse_weight_numerator // position.backing_wei
    if weight <= 0:
        raise ValueError("backing is too large for the configured numerator")
    return weight


def pool_metrics(positions: Sequence[Position], config: ProtocolConfig) -> PoolMetrics:
    if not positions:
        raise ValueError("the pool must contain at least one position")

    weights = [position_weight(position, config) for position in positions]
    total_weight = sum(weights)
    weighted_backing_total = sum(
        weight * position.backing_wei
        for position, weight in zip(positions, weights, strict=True)
    )
    harmonic_backing_wei = weighted_backing_total // total_weight
    acquisition_price_wei = (
        harmonic_backing_wei * (BPS + config.surcharge_bps) // BPS
    )

    return PoolMetrics(
        active_count=len(positions),
        total_weight=total_weight,
        weighted_backing_total=weighted_backing_total,
        harmonic_backing_wei=harmonic_backing_wei,
        acquisition_price_wei=acquisition_price_wei,
    )


def _outcome_values(
    position: Position, config: ProtocolConfig
) -> tuple[bool, int, int, int]:
    cashout_value = position.backing_wei * config.cashout_bps // BPS
    keep = position.liquidatable_value_wei >= cashout_value

    if keep:
        purchaser_payoff = position.liquidatable_value_wei
        depositor_loss = (
            position.liquidatable_value_wei
            + position.backing_wei * config.protocol_keep_fee_bps // BPS
        )
        protocol_settlement_revenue = (
            position.backing_wei * config.protocol_keep_fee_bps // BPS
        )
    else:
        purchaser_payoff = cashout_value
        depositor_loss = position.backing_wei
        protocol_settlement_revenue = position.backing_wei - cashout_value

    return keep, purchaser_payoff, depositor_loss, protocol_settlement_revenue


def analytic_metrics(
    positions: Sequence[Position], config: ProtocolConfig
) -> EconomicMetrics:
    pool = pool_metrics(positions, config)
    weights = [position_weight(position, config) for position in positions]

    purchaser_payoff_ev = 0.0
    depositor_selection_loss_ev = 0.0
    protocol_settlement_revenue_ev = 0.0
    keep_probability = 0.0

    for position, weight in zip(positions, weights, strict=True):
        probability = weight / pool.total_weight
        keep, purchaser_payoff, depositor_loss, protocol_revenue = _outcome_values(
            position, config
        )
        purchaser_payoff_ev += probability * purchaser_payoff
        depositor_selection_loss_ev += probability * depositor_loss
        protocol_settlement_revenue_ev += probability * protocol_revenue
        if keep:
            keep_probability += probability

    protocol_acquisition_revenue = (
        pool.acquisition_price_wei * config.protocol_acquisition_cut_bps // BPS
    )
    depositor_fee_income = pool.acquisition_price_wei - protocol_acquisition_revenue
    purchaser_cost = (
        pool.acquisition_price_wei + config.vrf_fee_wei + config.gas_cost_wei
    )
    purchaser_pnl_ev = purchaser_payoff_ev - purchaser_cost
    purchaser_roi = purchaser_pnl_ev / purchaser_cost if purchaser_cost else 0.0
    depositor_pnl_ev = depositor_fee_income - depositor_selection_loss_ev
    protocol_total_revenue_ev = (
        protocol_acquisition_revenue + protocol_settlement_revenue_ev
    )

    conservation_error = (
        purchaser_payoff_ev
        - pool.acquisition_price_wei
        + depositor_pnl_ev
        + protocol_total_revenue_ev
    )

    return EconomicMetrics(
        pool=pool,
        purchaser_payoff_ev_wei=purchaser_payoff_ev,
        purchaser_pnl_ev_wei=purchaser_pnl_ev,
        purchaser_roi=purchaser_roi,
        depositor_fee_income_wei=depositor_fee_income,
        depositor_selection_loss_ev_wei=depositor_selection_loss_ev,
        depositor_pnl_ev_wei=depositor_pnl_ev,
        protocol_acquisition_revenue_wei=protocol_acquisition_revenue,
        protocol_settlement_revenue_ev_wei=protocol_settlement_revenue_ev,
        protocol_total_revenue_ev_wei=protocol_total_revenue_ev,
        keep_probability=keep_probability,
        cashout_probability=1.0 - keep_probability,
        conservation_error_wei=conservation_error,
    )


def _weighted_choice_index(weights: Sequence[int], rng: random.Random) -> int:
    target = rng.randrange(sum(weights))
    cumulative = 0
    for index, weight in enumerate(weights):
        cumulative += weight
        if target < cumulative:
            return index
    raise AssertionError("weighted choice fell outside the cumulative range")


def monte_carlo(
    positions: Sequence[Position],
    config: ProtocolConfig,
    draws: int,
    seed: int,
) -> MonteCarloMetrics:
    if draws <= 0:
        raise ValueError("draws must be positive")

    pool = pool_metrics(positions, config)
    weights = [position_weight(position, config) for position in positions]
    rng = random.Random(seed)

    purchaser_payoff_total = 0
    depositor_loss_total = 0
    protocol_settlement_total = 0
    keeps = 0

    for _ in range(draws):
        position = positions[_weighted_choice_index(weights, rng)]
        keep, purchaser_payoff, depositor_loss, protocol_revenue = _outcome_values(
            position, config
        )
        purchaser_payoff_total += purchaser_payoff
        depositor_loss_total += depositor_loss
        protocol_settlement_total += protocol_revenue
        keeps += int(keep)

    purchaser_payoff_ev = purchaser_payoff_total / draws
    purchaser_cost = (
        pool.acquisition_price_wei + config.vrf_fee_wei + config.gas_cost_wei
    )
    purchaser_pnl_ev = purchaser_payoff_ev - purchaser_cost

    return MonteCarloMetrics(
        draws=draws,
        purchaser_payoff_ev_wei=purchaser_payoff_ev,
        purchaser_pnl_ev_wei=purchaser_pnl_ev,
        purchaser_roi=purchaser_pnl_ev / purchaser_cost if purchaser_cost else 0.0,
        depositor_selection_loss_ev_wei=depositor_loss_total / draws,
        protocol_settlement_revenue_ev_wei=protocol_settlement_total / draws,
        keep_probability=keeps / draws,
        cashout_probability=1.0 - keeps / draws,
    )


def _log_uniform(rng: random.Random, minimum: float, maximum: float) -> float:
    return math.exp(rng.uniform(math.log(minimum), math.log(maximum)))


def generate_positions(
    count: int,
    seed: int,
    scenario: str,
    min_backing_eth: float = 0.01,
    max_backing_eth: float = 1.0,
) -> list[Position]:
    if count <= 0:
        raise ValueError("count must be positive")

    rng = random.Random(seed)
    positions: list[Position] = []

    for _ in range(count):
        backing_eth = _log_uniform(rng, min_backing_eth, max_backing_eth)

        if scenario == "balanced":
            value_ratio = rng.lognormvariate(math.log(0.85), 0.12)
        elif scenario == "junk":
            value_ratio = rng.uniform(0.0, 0.20)
        elif scenario == "upside":
            value_ratio = rng.lognormvariate(math.log(1.50), 0.25)
        elif scenario == "mixed":
            bucket = rng.random()
            if bucket < 0.35:
                value_ratio = rng.uniform(0.0, 0.20)
            elif bucket < 0.85:
                value_ratio = rng.lognormvariate(math.log(0.85), 0.18)
            else:
                value_ratio = rng.lognormvariate(math.log(1.80), 0.35)
        else:
            raise ValueError(f"unknown scenario: {scenario}")

        backing_wei = max(1, round(backing_eth * ETH))
        value_wei = max(0, round(backing_eth * value_ratio * ETH))
        positions.append(Position(backing_wei, value_wei))

    return positions


def _eth(value_wei: float) -> float:
    return value_wei / ETH


def report_scenario(
    scenario: str,
    positions: Sequence[Position],
    config: ProtocolConfig,
    draws: int,
    seed: int,
) -> dict[str, object]:
    analytic = analytic_metrics(positions, config)
    sampled = monte_carlo(positions, config, draws=draws, seed=seed)

    return {
        "scenario": scenario,
        "positions": len(positions),
        "analytic": {
            "harmonic_backing_eth": _eth(analytic.pool.harmonic_backing_wei),
            "acquisition_price_eth": _eth(analytic.pool.acquisition_price_wei),
            "purchaser_payoff_ev_eth": _eth(analytic.purchaser_payoff_ev_wei),
            "purchaser_pnl_ev_eth": _eth(analytic.purchaser_pnl_ev_wei),
            "purchaser_roi_pct": analytic.purchaser_roi * 100,
            "depositor_pnl_ev_eth": _eth(analytic.depositor_pnl_ev_wei),
            "protocol_revenue_ev_eth": _eth(analytic.protocol_total_revenue_ev_wei),
            "keep_probability_pct": analytic.keep_probability * 100,
            "cashout_probability_pct": analytic.cashout_probability * 100,
            "conservation_error_wei": analytic.conservation_error_wei,
        },
        "monte_carlo": {
            "draws": draws,
            "purchaser_roi_pct": sampled.purchaser_roi * 100,
            "keep_probability_pct": sampled.keep_probability * 100,
            "cashout_probability_pct": sampled.cashout_probability * 100,
        },
    }


def _print_table(reports: Iterable[dict[str, object]]) -> None:
    header = (
        f"{'scenario':<10} {'HM ETH':>10} {'price ETH':>10} "
        f"{'buyer ROI':>11} {'keep':>9} {'protocol ETH':>13}"
    )
    print(header)
    print("-" * len(header))
    for report in reports:
        analytic = report["analytic"]
        assert isinstance(analytic, dict)
        print(
            f"{report['scenario']:<10} "
            f"{analytic['harmonic_backing_eth']:>10.5f} "
            f"{analytic['acquisition_price_eth']:>10.5f} "
            f"{analytic['purchaser_roi_pct']:>10.2f}% "
            f"{analytic['keep_probability_pct']:>8.2f}% "
            f"{analytic['protocol_revenue_ev_eth']:>13.5f}"
        )


def main() -> None:
    parser = argparse.ArgumentParser(description="MemeBag static economic simulator")
    parser.add_argument("--positions", type=int, default=250)
    parser.add_argument("--draws", type=int, default=100_000)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument(
        "--scenario",
        choices=("all", "balanced", "junk", "upside", "mixed"),
        default="all",
    )
    parser.add_argument("--json", action="store_true", dest="as_json")
    args = parser.parse_args()

    config = ProtocolConfig()
    scenarios = (
        ("balanced", "junk", "upside", "mixed")
        if args.scenario == "all"
        else (args.scenario,)
    )

    reports = []
    for index, scenario in enumerate(scenarios):
        positions = generate_positions(
            count=args.positions,
            seed=args.seed + index,
            scenario=scenario,
        )
        reports.append(
            report_scenario(
                scenario=scenario,
                positions=positions,
                config=config,
                draws=args.draws,
                seed=args.seed + 10_000 + index,
            )
        )

    if args.as_json:
        print(json.dumps({"config": asdict(config), "reports": reports}, indent=2))
    else:
        _print_table(reports)


if __name__ == "__main__":
    main()
