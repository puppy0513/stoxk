from __future__ import annotations

import html
import json
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal, InvalidOperation

from .config import Asset


class SourceError(RuntimeError):
    pass


@dataclass(frozen=True)
class DividendSnapshot:
    ticker: str
    stock_name: str
    dividend: Decimal | None
    payment_day: date | None
    ex_date: date | None
    market: str
    currency: str
    source: str
    source_symbol: str
    updated_at: datetime | None = None

    def to_supabase_row(self) -> dict[str, object]:
        return {
            "ticker": self.ticker,
            "stock_name": self.stock_name,
            "dividend": str(self.dividend) if self.dividend is not None else None,
            "payment_day": self.payment_day.isoformat() if self.payment_day else None,
            "ex_date": self.ex_date.isoformat() if self.ex_date else None,
            "market": self.market,
            "currency": self.currency,
            "source": self.source,
            "source_symbol": self.source_symbol,
            "updated_at": (self.updated_at or datetime.now(tz=UTC)).isoformat(),
        }


def _parse_decimal(value: str) -> Decimal:
    cleaned = value.replace(",", "").replace("$", "").strip()
    if not cleaned or cleaned in {"-", "N/A"}:
        raise InvalidOperation(value)
    return Decimal(cleaned)


def _parse_date(value: str) -> date:
    cleaned = value.strip()
    for fmt in ("%b %d, %Y", "%Y-%m-%d"):
        try:
            return datetime.strptime(cleaned, fmt).date()
        except ValueError:
            continue
    raise ValueError(cleaned)


def _strip_html(value: str) -> str:
    text = re.sub(r"<[^>]+>", "", value, flags=re.S)
    return html.unescape(text).replace("\xa0", " ").strip()


def _fetch_text(url: str) -> str:
    request = urllib.request.Request(
        url,
        headers={
            "Accept": "text/html,application/json",
            "User-Agent": "Mozilla/5.0 (stoxk dividend crawler)",
            "Accept-Language": "en-US,en;q=0.9,ko;q=0.8",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return response.read().decode("utf-8", errors="ignore")
    except urllib.error.HTTPError as exc:
        raise SourceError(f"{url}: HTTP {exc.code}") from exc
    except urllib.error.URLError as exc:
        raise SourceError(f"{url}: {exc.reason}") from exc


class StockAnalysisDividendSource:
    name = "stockanalysis"

    def _candidate_urls(self, asset: Asset) -> list[str]:
        symbol = asset.ticker.lower()
        return [
            f"https://stockanalysis.com/stocks/{symbol}/dividend/",
            f"https://stockanalysis.com/etf/{symbol}/dividend/",
        ]

    def _parse_latest_row(self, html_text: str, asset: Asset) -> DividendSnapshot | None:
        marker = "Pay Date</th>"
        marker_index = html_text.find(marker)
        if marker_index == -1:
            return None

        tbody_start = html_text.find("<tbody>", marker_index)
        tbody_end = html_text.find("</tbody>", tbody_start)
        if tbody_start == -1 or tbody_end == -1:
            return None

        tbody = html_text[tbody_start:tbody_end]
        rows = re.findall(r"<tr[^>]*>(.*?)</tr>", tbody, flags=re.S)
        if not rows:
            return None

        for row in rows:
            cells = [_strip_html(cell) for cell in re.findall(r"<td[^>]*>(.*?)</td>", row, flags=re.S)]
            if len(cells) < 4:
                continue

            try:
                ex_date = _parse_date(cells[0])
                dividend = _parse_decimal(cells[1])
                payment_day = _parse_date(cells[3])
            except (ValueError, InvalidOperation):
                continue

            return DividendSnapshot(
                ticker=asset.ticker,
                stock_name=asset.stock_name,
                dividend=dividend,
                payment_day=payment_day,
                ex_date=ex_date,
                market=asset.market,
                currency=asset.currency,
                source=self.name,
                source_symbol=asset.source_symbol,
            )
        return None

    def fetch_latest(self, asset: Asset) -> DividendSnapshot | None:
        last_error: SourceError | None = None
        for url in self._candidate_urls(asset):
            try:
                html_text = _fetch_text(url)
                snapshot = self._parse_latest_row(html_text, asset)
            except SourceError as exc:
                last_error = exc
                continue
            if snapshot is not None:
                return snapshot
        if last_error is not None:
            raise last_error
        return None


class YahooChartDividendSource:
    name = "yahoo-chart"

    def _fetch_chart(self, symbol: str, start_seconds_ago: int) -> dict:
        period2 = int(time.time())
        period1 = int((datetime.now(tz=UTC) - timedelta(seconds=start_seconds_ago)).timestamp())
        params = urllib.parse.urlencode(
            {
                "period1": period1,
                "period2": period2,
                "interval": "1d",
                "includePrePost": "false",
                "events": "div",
            }
        )
        url = f"https://query1.finance.yahoo.com/v8/finance/chart/{symbol}?{params}"
        request = urllib.request.Request(
            url,
            headers={
                "Accept": "application/json",
                "User-Agent": "Mozilla/5.0 (stoxk dividend crawler)",
            },
        )
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                payload = json.load(response)
        except urllib.error.HTTPError as exc:
            raise SourceError(f"{symbol}: HTTP {exc.code}") from exc
        except urllib.error.URLError as exc:
            raise SourceError(f"{symbol}: {exc.reason}") from exc

        chart = payload.get("chart", {})
        if chart.get("error"):
            raise SourceError(f"{symbol}: {chart['error']}")
        return chart

    def fetch_latest(self, asset: Asset, lookback_days: int = 370) -> DividendSnapshot | None:
        chart = self._fetch_chart(asset.source_symbol, lookback_days * 24 * 3600)
        results = chart.get("result") or []
        if not results:
            return None

        dividends = (results[0].get("events") or {}).get("dividends") or {}
        latest_item: dict | None = None
        for item in dividends.values():
            if latest_item is None or int(item.get("date", 0)) > int(latest_item.get("date", 0)):
                latest_item = item

        if latest_item is None:
            return None

        timestamp = latest_item.get("date")
        amount = latest_item.get("amount")
        if timestamp is None or amount is None:
            return None

        return DividendSnapshot(
            ticker=asset.ticker,
            stock_name=asset.stock_name,
            dividend=Decimal(str(amount)),
            payment_day=None,
            ex_date=datetime.fromtimestamp(int(timestamp), tz=UTC).date(),
            market=asset.market,
            currency=asset.currency,
            source=self.name,
            source_symbol=asset.source_symbol,
        )


class DividendCrawler:
    def __init__(self) -> None:
        self.stockanalysis = StockAnalysisDividendSource()
        self.yahoo = YahooChartDividendSource()

    def fetch_latest(self, asset: Asset) -> DividendSnapshot | None:
        for source in (self.stockanalysis, self.yahoo):
            try:
                snapshot = source.fetch_latest(asset)
            except SourceError:
                continue
            if snapshot is not None:
                return snapshot
        return None
