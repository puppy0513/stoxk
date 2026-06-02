from __future__ import annotations

import sqlite3
from collections.abc import Iterable
from datetime import date
from decimal import Decimal
from pathlib import Path

from .config import Asset, WATCHLIST
from .sources import DividendEvent


SCHEMA = """
CREATE TABLE IF NOT EXISTS assets (
  ticker TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  market TEXT NOT NULL,
  payment_frequency TEXT NOT NULL,
  currency TEXT NOT NULL,
  source_symbol TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS dividends (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticker TEXT NOT NULL REFERENCES assets(ticker),
  ex_date TEXT NOT NULL,
  payment_date TEXT,
  amount TEXT NOT NULL,
  currency TEXT NOT NULL,
  source TEXT NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(ticker, ex_date, amount, source)
);
"""


class DividendStore:
    def __init__(self, db_path: Path) -> None:
        self.db_path = db_path
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self.connection = sqlite3.connect(self.db_path)
        self.connection.row_factory = sqlite3.Row

    def close(self) -> None:
        self.connection.close()

    def init(self) -> None:
        self.connection.executescript(SCHEMA)
        self.upsert_assets(WATCHLIST)
        self.connection.commit()

    def upsert_assets(self, assets: Iterable[Asset]) -> None:
        self.connection.executemany(
            """
            INSERT INTO assets (ticker, name, market, payment_frequency, currency, source_symbol)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(ticker) DO UPDATE SET
              name=excluded.name,
              market=excluded.market,
              payment_frequency=excluded.payment_frequency,
              currency=excluded.currency,
              source_symbol=excluded.source_symbol
            """,
            [
                (
                    asset.ticker,
                    asset.name,
                    asset.market,
                    asset.payment_frequency,
                    asset.currency,
                    asset.source_symbol,
                )
                for asset in assets
            ],
        )

    def add_events(self, events: Iterable[DividendEvent]) -> int:
        before = self.connection.total_changes
        self.connection.executemany(
            """
            INSERT OR IGNORE INTO dividends
              (ticker, ex_date, payment_date, amount, currency, source)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            [
                (
                    event.ticker,
                    event.ex_date.isoformat(),
                    event.payment_date.isoformat() if event.payment_date else None,
                    str(event.amount),
                    event.currency,
                    event.source,
                )
                for event in events
            ],
        )
        self.connection.commit()
        return self.connection.total_changes - before

    def add_manual_event(
        self,
        ticker: str,
        ex_date: date,
        amount: Decimal,
        currency: str,
        payment_date: date | None,
        note: str | None,
    ) -> int:
        before = self.connection.total_changes
        self.connection.execute(
            """
            INSERT OR IGNORE INTO dividends
              (ticker, ex_date, payment_date, amount, currency, source, note)
            VALUES (?, ?, ?, ?, ?, 'manual', ?)
            """,
            (
                ticker,
                ex_date.isoformat(),
                payment_date.isoformat() if payment_date else None,
                str(amount),
                currency,
                note,
            ),
        )
        self.connection.commit()
        return self.connection.total_changes - before

    def assets(self) -> list[sqlite3.Row]:
        return list(self.connection.execute("SELECT * FROM assets ORDER BY market, ticker"))

    def recent_dividends(self, limit: int = 100) -> list[sqlite3.Row]:
        return list(
            self.connection.execute(
                """
                SELECT d.*, a.name, a.payment_frequency
                FROM dividends d
                JOIN assets a ON a.ticker = d.ticker
                ORDER BY d.ex_date DESC, d.ticker
                LIMIT ?
                """,
                (limit,),
            )
        )

    def latest_by_asset(self) -> list[sqlite3.Row]:
        return list(
            self.connection.execute(
                """
                SELECT
                  a.ticker,
                  a.name,
                  a.market,
                  a.payment_frequency,
                  a.currency,
                  MAX(d.ex_date) AS last_ex_date,
                  (
                    SELECT d2.amount
                    FROM dividends d2
                    WHERE d2.ticker = a.ticker
                    ORDER BY d2.ex_date DESC, d2.id DESC
                    LIMIT 1
                  ) AS last_amount,
                  COUNT(d.id) AS event_count
                FROM assets a
                LEFT JOIN dividends d ON d.ticker = a.ticker
                GROUP BY a.ticker
                ORDER BY a.market, a.ticker
                """
            )
        )

    def export_rows(self) -> list[sqlite3.Row]:
        return list(
            self.connection.execute(
                """
                SELECT d.ticker, a.name, a.market, d.ex_date, d.payment_date,
                       d.amount, d.currency, d.source, d.note
                FROM dividends d
                JOIN assets a ON a.ticker = d.ticker
                ORDER BY d.ex_date DESC, d.ticker
                """
            )
        )

    def ttm_totals(self, since: date) -> dict[str, Decimal]:
        totals: dict[str, Decimal] = {}
        for row in self.connection.execute(
            """
            SELECT ticker, amount
            FROM dividends
            WHERE ex_date >= ?
            """,
            (since.isoformat(),),
        ):
            ticker = row["ticker"]
            totals[ticker] = totals.get(ticker, Decimal("0")) + Decimal(row["amount"])
        return totals
