from __future__ import annotations

import tempfile
import unittest
from datetime import date
from decimal import Decimal
from pathlib import Path

from stoxk_tracker.cli import next_expected
from stoxk_tracker.config import asset_by_ticker
from stoxk_tracker.sources import DividendEvent
from stoxk_tracker.store import DividendStore


class TrackerTest(unittest.TestCase):
    def test_asset_lookup_is_case_insensitive(self) -> None:
        self.assertEqual(asset_by_ticker("qqqi").ticker, "QQQI")

    def test_next_expected_uses_frequency(self) -> None:
        self.assertEqual(next_expected("2026-01-01", "weekly"), "2026-01-08")
        self.assertEqual(next_expected("2026-01-31", "monthly"), "2026-02-28")

    def test_store_ignores_duplicate_events(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            db_path = Path(temporary_directory) / "dividends.sqlite3"
            store = DividendStore(db_path)
            try:
                store.init()
                event = DividendEvent("QQQI", date(2026, 1, 1), Decimal("0.10"), "USD", "test")
                self.assertEqual(store.add_events([event]), 1)
                self.assertEqual(store.add_events([event]), 0)
                rows = store.recent_dividends()
                self.assertEqual(len(rows), 1)
                self.assertEqual(rows[0]["ticker"], "QQQI")
            finally:
                store.close()

    def test_ttm_totals_sum_events(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            db_path = Path(temporary_directory) / "dividends.sqlite3"
            store = DividendStore(db_path)
            try:
                store.init()
                store.add_events(
                    [
                        DividendEvent("QQQI", date(2026, 1, 1), Decimal("0.10"), "USD", "test"),
                        DividendEvent("QQQI", date(2026, 2, 1), Decimal("0.20"), "USD", "test"),
                    ]
                )
                totals = store.ttm_totals(date(2025, 12, 31))
                self.assertEqual(totals["QQQI"], Decimal("0.30"))
            finally:
                store.close()


if __name__ == "__main__":
    unittest.main()
