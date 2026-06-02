from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path


DEFAULT_DATA_DIR = Path.home() / ".stoxk"
DEFAULT_DB_PATH = DEFAULT_DATA_DIR / "dividends.sqlite3"


@dataclass(frozen=True)
class Asset:
    ticker: str
    name: str
    market: str
    payment_frequency: str
    currency: str
    source_symbol: str


WATCHLIST: tuple[Asset, ...] = (
    Asset("QQQI", "NEOS Nasdaq-100 High Income ETF", "US", "monthly", "USD", "QQQI"),
    Asset("O", "Realty Income", "US", "monthly", "USD", "O"),
    Asset("441640", "KODEX 미국배당커버드콜액티브", "KR", "monthly", "KRW", "441640.KS"),
    Asset("0144L0", "KODEX 미국성장커버드콜액티브", "KR", "monthly", "KRW", "0144L0.KS"),
    Asset("489030", "PLUS 고배당주위클리커버드콜", "KR", "monthly", "KRW", "489030.KS"),
    Asset("486290", "TIGER 미국나스닥100타겟데일리커버드콜", "KR", "monthly", "KRW", "486290.KS"),
    Asset("498400", "KODEX 200타겟위클리커버드콜", "KR", "monthly", "KRW", "498400.KS"),
    Asset("YMAX", "YieldMax Universe Fund of Option Income ETFs", "US", "weekly", "USD", "YMAX"),
    Asset("YMAG", "YieldMax Magnificent 7 Fund of Option Income ETFs", "US", "weekly", "USD", "YMAG"),
    Asset("QDTE", "Roundhill N-100 0DTE Covered Call Strategy ETF", "US", "weekly", "USD", "QDTE"),
)


def asset_by_ticker(ticker: str) -> Asset:
    normalized = ticker.upper()
    for asset in WATCHLIST:
        if asset.ticker.upper() == normalized:
            return asset
    raise KeyError(f"Unknown ticker: {ticker}")

