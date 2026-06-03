from __future__ import annotations

import argparse
import json
from datetime import date
from pathlib import Path

from .config import WATCHLIST
from .sources import DividendCrawler, DividendSnapshot
from .supabase import SupabaseClient, SupabaseError


def print_table(headers: list[str], rows: list[list[object]]) -> None:
    widths = [len(header) for header in headers]
    rendered = [[str(value) if value is not None else "-" for value in row] for row in rows]
    for row in rendered:
        widths = [max(width, len(cell)) for width, cell in zip(widths, row, strict=True)]

    def fmt(row: list[str]) -> str:
        return "  ".join(cell.ljust(width) for cell, width in zip(row, widths, strict=True))

    print(fmt(headers))
    print(fmt(["-" * width for width in widths]))
    for row in rendered:
        print(fmt(row))


def _parse_date(value: str | None) -> date | None:
    if not value:
        return None
    return date.fromisoformat(value)


def command_list(_: argparse.Namespace) -> int:
    rows = [
        [
            asset.ticker,
            asset.stock_name,
            asset.market,
            asset.payment_frequency,
            asset.currency,
            asset.source_symbol,
        ]
        for asset in WATCHLIST
    ]
    print_table(["Ticker", "Stock name", "Market", "Freq", "Currency", "Source"], rows)
    return 0


def command_sync(args: argparse.Namespace) -> int:
    crawler = DividendCrawler()
    client = None
    existing_rows: dict[str, dict[str, object]] = {}

    if not args.dry_run:
        client = SupabaseClient.from_env(require_write_key=True)
        existing_rows = {row["ticker"]: row for row in client.fetch_dividend_snapshots()}

    snapshots: list[DividendSnapshot] = []
    warnings: list[str] = []
    for asset in WATCHLIST:
        try:
            snapshot = crawler.fetch_latest(asset)
        except Exception as exc:  # pragma: no cover - network issues are handled as warnings
            warnings.append(f"{asset.ticker}: {exc}")
            continue

        if snapshot is None or snapshot.dividend is None:
            warnings.append(f"{asset.ticker}: no dividend snapshot found")
            continue

        previous = existing_rows.get(asset.ticker, {})
        merged_payment_day = snapshot.payment_day or _parse_date(previous.get("payment_day"))
        merged_ex_date = snapshot.ex_date or _parse_date(previous.get("ex_date"))
        snapshots.append(
            DividendSnapshot(
                ticker=snapshot.ticker,
                stock_name=snapshot.stock_name,
                dividend=snapshot.dividend,
                payment_day=merged_payment_day,
                ex_date=merged_ex_date,
                market=snapshot.market,
                currency=snapshot.currency,
                source=snapshot.source,
                source_symbol=snapshot.source_symbol,
            )
        )

    if args.dry_run:
        print(json.dumps([snapshot.to_supabase_row() for snapshot in snapshots], ensure_ascii=False, indent=2))
    else:
        inserted = client.upsert_dividend_snapshots(snapshots) if client else 0
        print(f"Upserted {inserted} dividend snapshot rows into Supabase.")

    if warnings:
        print("\nWarnings:")
        for warning in warnings:
            print(f"- {warning}")
        return 2

    return 0


def command_report(_: argparse.Namespace) -> int:
    client = SupabaseClient.from_env(allow_anon=True)
    rows = client.fetch_dividend_snapshots()
    print_table(
        ["Ticker", "Stock name", "Dividend", "Pay date", "Ex-date", "Market", "Updated"],
        [
            [
                row["ticker"],
                row["stock_name"],
                row.get("dividend"),
                row.get("payment_day") or "-",
                row.get("ex_date") or "-",
                row.get("market"),
                row.get("updated_at"),
            ]
            for row in rows
        ],
    )
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Track dividend and distribution data in Supabase.")
    subparsers = parser.add_subparsers(dest="command", required=True)

    list_parser = subparsers.add_parser("list", help="Show the configured watchlist.")
    list_parser.set_defaults(func=command_list)

    sync_parser = subparsers.add_parser("sync", help="Crawl dividends and upsert them into Supabase.")
    sync_parser.add_argument("--dry-run", action="store_true", help="Print the payload instead of writing to Supabase.")
    sync_parser.set_defaults(func=command_sync)

    report_parser = subparsers.add_parser("report", help="Read the current Supabase dividend snapshot.")
    report_parser.set_defaults(func=command_report)

    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    try:
        return args.func(args)
    except SupabaseError as exc:
        parser.exit(2, f"{exc}\n")


if __name__ == "__main__":
    raise SystemExit(main())
