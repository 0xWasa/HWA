import unittest

from simulate import (
    BPS,
    ETH,
    Position,
    ProtocolConfig,
    analytic_metrics,
    monte_carlo,
    pool_metrics,
)


class SimulationTests(unittest.TestCase):
    def setUp(self) -> None:
        self.config = ProtocolConfig()

    def test_harmonic_backing(self) -> None:
        positions = [
            Position(1 * ETH, 1 * ETH),
            Position(2 * ETH, 2 * ETH),
        ]
        metrics = pool_metrics(positions, self.config)
        expected = 4 * ETH // 3
        self.assertLessEqual(abs(metrics.harmonic_backing_wei - expected), 2)

    def test_cashout_floor_at_balanced_value(self) -> None:
        position = Position(1 * ETH, 85 * ETH // 100)
        metrics = analytic_metrics([position], self.config)
        expected_roi = 0.85 / 1.10 - 1
        self.assertAlmostEqual(metrics.purchaser_roi, expected_roi, places=12)
        self.assertAlmostEqual(metrics.keep_probability, 1.0)

    def test_cashout_discount_goes_to_protocol(self) -> None:
        position = Position(1 * ETH, 0)
        metrics = analytic_metrics([position], self.config)
        acquisition_cut = metrics.pool.acquisition_price_wei // 100
        expected_settlement = 15 * ETH // 100
        self.assertEqual(metrics.protocol_acquisition_revenue_wei, acquisition_cut)
        self.assertEqual(
            metrics.protocol_settlement_revenue_ev_wei, expected_settlement
        )

    def test_conservation_identity(self) -> None:
        positions = [
            Position(1 * ETH, 2 * ETH),
            Position(2 * ETH, 1 * ETH // 10),
            Position(3 * ETH, 3 * ETH),
        ]
        metrics = analytic_metrics(positions, self.config)
        self.assertLessEqual(abs(metrics.conservation_error_wei), 512)

    def test_monte_carlo_converges_to_analytic(self) -> None:
        positions = [
            Position(1 * ETH, 2 * ETH),
            Position(2 * ETH, 1 * ETH // 10),
            Position(3 * ETH, 3 * ETH),
        ]
        analytic = analytic_metrics(positions, self.config)
        sampled = monte_carlo(positions, self.config, draws=250_000, seed=7)
        self.assertAlmostEqual(
            sampled.keep_probability, analytic.keep_probability, delta=0.005
        )
        self.assertAlmostEqual(sampled.purchaser_roi, analytic.purchaser_roi, delta=0.01)


if __name__ == "__main__":
    unittest.main()
