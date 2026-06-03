from __future__ import annotations

import unittest
from datetime import date
from decimal import Decimal

from stoxk_tracker.config import asset_by_ticker
from stoxk_tracker.sources import DividendSnapshot, StockAnalysisDividendSource, YahooChartDividendSource


class TrackerTest(unittest.TestCase):
    def test_asset_lookup_is_case_insensitive(self) -> None:
        self.assertEqual(asset_by_ticker("qqqi").ticker, "QQQI")

    def test_stockanalysis_parser_reads_latest_row(self) -> None:
        html = """
        <table>
          <thead>
            <tr><th>Ex-Dividend Date</th><th>Amount</th><th>Record Date</th><th>Pay Date</th></tr>
          </thead>
          <tbody>
            <tr><td>May 20, 2026</td><td>$0.6589</td><td>May 20, 2026</td><td>May 22, 2026</td></tr>
            <tr><td>Apr 20, 2026</td><td>$0.6123</td><td>Apr 20, 2026</td><td>Apr 22, 2026</td></tr>
          </tbody>
        </table>
        """
        source = StockAnalysisDividendSource()
        snapshot = source._parse_latest_row(html, asset_by_ticker("QQQI"))
        self.assertIsNotNone(snapshot)
        self.assertEqual(snapshot.ticker, "QQQI")
        self.assertEqual(snapshot.dividend, Decimal("0.6589"))
        self.assertEqual(snapshot.payment_day, date(2026, 5, 22))
        self.assertEqual(snapshot.ex_date, date(2026, 5, 20))

    def test_snapshot_serialization(self) -> None:
        snapshot = DividendSnapshot(
            ticker="QQQI",
            stock_name="NEOS Nasdaq-100 High Income ETF",
            dividend=Decimal("0.6589"),
            payment_day=date(2026, 5, 22),
            ex_date=date(2026, 5, 20),
            market="US",
            currency="USD",
            source="stockanalysis",
            source_symbol="QQQI",
        )
        payload = snapshot.to_supabase_row()
        self.assertEqual(payload["ticker"], "QQQI")
        self.assertEqual(payload["dividend"], "0.6589")
        self.assertEqual(payload["payment_day"], "2026-05-22")

    def test_yahoo_snapshot_serialization_keeps_payment_day_null(self) -> None:
        snapshot = DividendSnapshot(
            ticker="YMAX",
            stock_name="YieldMax Universe Fund of Option Income ETFs",
            dividend=Decimal("0.3724"),
            payment_day=None,
            ex_date=date(2026, 5, 27),
            market="US",
            currency="USD",
            source="yahoo-chart",
            source_symbol="YMAX",
        )
        payload = snapshot.to_supabase_row()
        self.assertIsNone(payload["payment_day"])


if __name__ == "__main__":
    unittest.main()
