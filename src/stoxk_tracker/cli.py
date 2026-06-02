from __future__ import annotations

import argparse
import calendar
import csv
import json
from datetime import date, timedelta
from decimal import Decimal, InvalidOperation
from pathlib import Path

from .config import DEFAULT_DB_PATH, WATCHLIST, asset_by_ticker
from .sources import SourceError, YahooFinanceSource
from .store import DividendStore


def parse_date(value: str | None) -> date | None:
    if value is None:
        return None
    return date.fromisoformat(value)


def parse_amount(value: str) -> Decimal:
    try:
        return Decimal(value)
    except InvalidOperation as exc:
        raise argparse.ArgumentTypeError(f"Invalid amount: {value}") from exc


def next_expected(last_ex_date: str | None, frequency: str) -> str:
    if not last_ex_date:
        return "-"
    last = date.fromisoformat(last_ex_date)
    if frequency == "weekly":
        return (last + timedelta(days=7)).isoformat()
    year = last.year + (1 if last.month == 12 else 0)
    month = 1 if last.month == 12 else last.month + 1
    day = min(last.day, calendar.monthrange(year, month)[1])
    return date(year, month, day).isoformat()


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


def open_store(args: argparse.Namespace) -> DividendStore:
    store = DividendStore(args.db)
    store.init()
    return store


def command_list(args: argparse.Namespace) -> int:
    store = open_store(args)
    try:
        rows = [
            [
                row["ticker"],
                row["name"],
                row["market"],
                row["payment_frequency"],
                row["currency"],
                row["source_symbol"],
            ]
            for row in store.assets()
        ]
        print_table(["Ticker", "Name", "Market", "Freq", "Currency", "Source"], rows)
        return 0
    finally:
        store.close()


def command_sync(args: argparse.Namespace) -> int:
    store = open_store(args)
    source = YahooFinanceSource()
    failures: list[str] = []
    total_inserted = 0
    try:
        for asset in WATCHLIST:
            try:
                events = source.fetch_dividends(asset, args.lookback_days)
            except SourceError as exc:
                failures.append(str(exc))
                continue
            inserted = store.add_events(events)
            total_inserted += inserted
            print(f"{asset.ticker}: fetched {len(events)}, new {inserted}")

        print(f"Inserted {total_inserted} new dividend/distribution events.")
        if failures:
            print("\nFetch failures:")
            for failure in failures:
                print(f"- {failure}")
            return 2
        return 0
    finally:
        store.close()


def command_add(args: argparse.Namespace) -> int:
    asset = asset_by_ticker(args.ticker)
    store = open_store(args)
    try:
        inserted = store.add_manual_event(
            ticker=asset.ticker,
            ex_date=args.ex_date,
            amount=args.amount,
            currency=args.currency or asset.currency,
            payment_date=args.payment_date,
            note=args.note,
        )
        print("Added manual event." if inserted else "Event already exists; nothing added.")
        return 0
    finally:
        store.close()


def command_report(args: argparse.Namespace) -> int:
    store = open_store(args)
    try:
        summary_rows = []
        for row in store.latest_by_asset():
            summary_rows.append(
                [
                    row["ticker"],
                    row["market"],
                    row["payment_frequency"],
                    row["last_ex_date"] or "-",
                    row["last_amount"] or "-",
                    row["currency"],
                    next_expected(row["last_ex_date"], row["payment_frequency"]),
                    row["event_count"],
                ]
            )
        print_table(
            ["Ticker", "Market", "Freq", "Last ex-date", "Last amt", "CCY", "Expected next", "Events"],
            summary_rows,
        )

        recent = store.recent_dividends(args.limit)
        if recent:
            print("\nRecent events")
            print_table(
                ["Ticker", "Ex-date", "Pay-date", "Amount", "CCY", "Source"],
                [
                    [
                        row["ticker"],
                        row["ex_date"],
                        row["payment_date"] or "-",
                        row["amount"],
                        row["currency"],
                        row["source"],
                    ]
                    for row in recent
                ],
            )
        return 0
    finally:
        store.close()


def command_export(args: argparse.Namespace) -> int:
    store = open_store(args)
    try:
        rows = store.export_rows()
        args.output.parent.mkdir(parents=True, exist_ok=True)
        with args.output.open("w", newline="", encoding="utf-8") as handle:
            writer = csv.writer(handle)
            writer.writerow(["ticker", "name", "market", "ex_date", "payment_date", "amount", "currency", "source", "note"])
            for row in rows:
                writer.writerow([row[column] for column in row.keys()])
        print(f"Exported {len(rows)} rows to {args.output}")
        return 0
    finally:
        store.close()


def command_export_dashboard(args: argparse.Namespace) -> int:
    store = open_store(args)
    source = YahooFinanceSource()
    try:
        latest_rows = {row["ticker"]: row for row in store.latest_by_asset()}
        ttm_totals = store.ttm_totals(date.today() - timedelta(days=365))
        exported_at = date.today().isoformat()
        rows: list[dict[str, object]] = []
        failures: list[str] = []

        for asset in WATCHLIST:
            latest = latest_rows.get(asset.ticker)
            recent_dividend = Decimal(latest["last_amount"]) if latest and latest["last_amount"] is not None else None
            recent_dividend_date = latest["last_ex_date"] if latest else None
            ttm_dividend = ttm_totals.get(asset.ticker, Decimal("0"))
            try:
                quote = source.fetch_previous_close(asset)
                price = quote.price
                price_date = quote.price_date.isoformat()
            except SourceError as exc:
                failures.append(str(exc))
                price = None
                price_date = None

            rows.append(
                {
                    "ticker": asset.ticker,
                    "name": asset.name,
                    "market": asset.market,
                    "paymentFrequency": asset.payment_frequency,
                    "currency": asset.currency,
                    "price": str(price) if price is not None else None,
                    "priceDate": price_date,
                    "recentDividend": str(recent_dividend) if recent_dividend is not None else None,
                    "recentDividendDate": recent_dividend_date,
                    "ttmDividend": str(ttm_dividend),
                    "defaultQuantity": 1,
                }
            )

        payload = {
            "exportedAt": exported_at,
            "asOf": exported_at,
            "rows": rows,
            "source": "stoxk",
            "warnings": failures,
        }
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"Exported dashboard snapshot to {args.output}")
        if failures:
            print("Price lookup warnings:")
            for failure in failures:
                print(f"- {failure}")
            return 2
        return 0
    finally:
        store.close()


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Track dividend and ETF distribution events.")
    parser.add_argument("--db", type=Path, default=DEFAULT_DB_PATH, help=f"SQLite DB path. Default: {DEFAULT_DB_PATH}")
    subparsers = parser.add_subparsers(dest="command", required=True)

    list_parser = subparsers.add_parser("list", help="Show tracked assets.")
    list_parser.set_defaults(func=command_list)

    sync_parser = subparsers.add_parser("sync", help="Fetch dividend/distribution history from Yahoo Finance.")
    sync_parser.add_argument("--lookback-days", type=int, default=370)
    sync_parser.set_defaults(func=command_sync)

    add_parser = subparsers.add_parser("add", help="Add a manual dividend/distribution event.")
    add_parser.add_argument("ticker", help="Tracked ticker, for example 441640 or QQQI.")
    add_parser.add_argument("--ex-date", required=True, type=parse_date, help="Ex-dividend/distribution date, YYYY-MM-DD.")
    add_parser.add_argument("--amount", required=True, type=parse_amount, help="Amount per share/unit.")
    add_parser.add_argument("--payment-date", type=parse_date, help="Payment date, YYYY-MM-DD.")
    add_parser.add_argument("--currency", help="Override currency. Defaults to the asset currency.")
    add_parser.add_argument("--note", help="Optional memo.")
    add_parser.set_defaults(func=command_add)

    report_parser = subparsers.add_parser("report", help="Show summary and recent events.")
    report_parser.add_argument("--limit", type=int, default=30)
    report_parser.set_defaults(func=command_report)

    export_parser = subparsers.add_parser("export", help="Export all events to CSV.")
    export_parser.add_argument("--output", type=Path, default=Path("dividends.csv"))
    export_parser.set_defaults(func=command_export)

    dashboard_export_parser = subparsers.add_parser(
        "export-dashboard", help="Export a dashboard snapshot for the Vercel frontend."
    )
    dashboard_export_parser.add_argument("--output", type=Path, default=Path("data/holdings.json"))
    dashboard_export_parser.set_defaults(func=command_export_dashboard)

    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
