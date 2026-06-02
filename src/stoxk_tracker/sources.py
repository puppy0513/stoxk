from __future__ import annotations

import json
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal

from .config import Asset


class SourceError(RuntimeError):
    pass


@dataclass(frozen=True)
class DividendEvent:
    ticker: str
    ex_date: date
    amount: Decimal
    currency: str
    source: str
    payment_date: date | None = None


@dataclass(frozen=True)
class MarketQuote:
    ticker: str
    price: Decimal
    price_date: date
    currency: str
    source: str


class YahooFinanceSource:
    name = "yahoo"

    def _fetch_chart(self, symbol: str, start_seconds_ago: int, *, include_dividends: bool) -> dict:
        period2 = int(time.time())
        period1 = int((datetime.now(tz=UTC) - timedelta(seconds=start_seconds_ago)).timestamp())
        url = (
            "https://query1.finance.yahoo.com/v8/finance/chart/"
            f"{symbol}?period1={period1}&period2={period2}&interval=1d&includePrePost=false"
        )
        if include_dividends:
            url += "&events=div"
        request = urllib.request.Request(
            url,
            headers={
                "Accept": "application/json",
                "User-Agent": "stoxk-dividend-tracker/0.1",
            },
        )
        try:
            with urllib.request.urlopen(request, timeout=20) as response:
                payload = json.load(response)
        except urllib.error.HTTPError as exc:
            raise SourceError(f"{symbol}: HTTP {exc.code}") from exc
        except urllib.error.URLError as exc:
            raise SourceError(f"{symbol}: {exc.reason}") from exc

        chart = payload.get("chart", {})
        if chart.get("error"):
            raise SourceError(f"{symbol}: {chart['error']}")
        return chart

    def fetch_dividends(self, asset: Asset, lookback_days: int) -> list[DividendEvent]:
        chart = self._fetch_chart(asset.source_symbol, lookback_days * 24 * 3600, include_dividends=True)
        results = chart.get("result") or []
        if not results:
            return []

        dividends = (results[0].get("events") or {}).get("dividends") or {}
        events: list[DividendEvent] = []
        for item in dividends.values():
            timestamp = item.get("date")
            amount = item.get("amount")
            if timestamp is None or amount is None:
                continue
            events.append(
                DividendEvent(
                    ticker=asset.ticker,
                    ex_date=datetime.fromtimestamp(int(timestamp), tz=UTC).date(),
                    amount=Decimal(str(amount)),
                    currency=asset.currency,
                    source=self.name,
                )
            )
        return sorted(events, key=lambda event: event.ex_date)

    def fetch_previous_close(self, asset: Asset, lookback_days: int = 14) -> MarketQuote:
        chart = self._fetch_chart(asset.source_symbol, lookback_days * 24 * 3600, include_dividends=False)
        results = chart.get("result") or []
        if not results:
            raise SourceError(f"{asset.source_symbol}: empty chart result")

        result = results[0]
        timestamps = result.get("timestamp") or []
        closes = ((result.get("indicators") or {}).get("quote") or [{}])[0].get("close") or []

        for timestamp, close in zip(reversed(timestamps), reversed(closes), strict=False):
            if close is None:
                continue
            return MarketQuote(
                ticker=asset.ticker,
                price=Decimal(str(close)),
                price_date=datetime.fromtimestamp(int(timestamp), tz=UTC).date(),
                currency=asset.currency,
                source=self.name,
            )

        raise SourceError(f"{asset.source_symbol}: no close price available")
