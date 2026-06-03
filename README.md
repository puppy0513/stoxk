# stoxk

배당금/분배금 자동 수집 파이프라인입니다.

흐름은 이렇게 갑니다.

1. Python이 배당금과 지급일을 크롤링합니다.
2. GitHub Actions가 매일 한 번 그 Python 스크립트를 실행합니다.
3. 결과를 Supabase `dividend_snapshots` 테이블에 upsert 합니다.
4. Google Apps Script가 Supabase를 읽어서 Google Sheets `Raw_data` 탭을 갱신합니다.

## 추적 종목

| Ticker | 종목 | 주기 |
| --- | --- | --- |
| QQQI | NEOS Nasdaq-100 High Income ETF | monthly |
| O | Realty Income | monthly |
| 441640 | KODEX 미국배당커버드콜액티브 | monthly |
| 0144L0 | KODEX 미국성장커버드콜액티브 | monthly |
| 489030 | PLUS 고배당주위클리커버드콜 | monthly |
| 486290 | TIGER 미국나스닥100타겟데일리커버드콜 | monthly |
| 498400 | KODEX 200타겟위클리커버드콜 | monthly |
| YMAX | YieldMax Universe Fund of Option Income ETFs | weekly |
| YMAG | YieldMax Magnificent 7 Fund of Option Income ETFs | weekly |
| QDTE | Roundhill N-100 0DTE Covered Call Strategy ETF | weekly |

## 설치

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -e .
```

## 로컬 사용

watchlist 확인:

```bash
stoxk list
```

Supabase에 최신 배당 스냅샷 업서트:

```bash
export SUPABASE_URL="https://xxxx.supabase.co"
export SUPABASE_SERVICE_ROLE_KEY="..."
stoxk sync
```

현재 Supabase 스냅샷 조회:

```bash
export SUPABASE_URL="https://xxxx.supabase.co"
export SUPABASE_ANON_KEY="..."
stoxk report
```

dry-run:

```bash
stoxk sync --dry-run
```

## Supabase 테이블

`supabase/schema.sql`을 실행하세요.

```sql
create table if not exists public.dividend_snapshots (
  ticker text primary key,
  stock_name text not null,
  dividend numeric,
  payment_day date,
  ex_date date,
  market text not null,
  currency text not null,
  source text not null,
  source_symbol text not null,
  updated_at timestamptz not null default now()
);
```

이 테이블은 GitHub Actions가 서비스 롤 키로 갱신합니다.  
Apps Script는 anon key로 읽기만 합니다.

## GitHub Actions

`.github/workflows/dividend-sync.yml`이 매일 UTC 00:00에 실행됩니다.  
한국 시간으로는 오전 9시입니다.

필수 Secrets:

- `SUPABASE_URL`
- `DIVIDEND_SECRET` - Supabase service role key를 여기에 넣습니다

## Google Apps Script

`apps_script/Code.gs`를 Apps Script 프로젝트에 붙여 넣으세요.

스프레드시트 안에 `설정` 탭을 만들고 아래처럼 넣으세요.

| A열 | B열 |
| --- | --- |
| `SUPABASE_URL` | `https://xxxx.supabase.co` |
| `SUPABASE_ANON_KEY` | `...` |
| `SPREADSHEET_ID` | `1GoL5LDSzfsYwDo4VogfFsdTHBdEO5y-ZuRM3NXj8Kpo` |
| `SHEET_NAME` | `Raw_data` |

실행 함수:

- `syncRawDataFromSupabase()`
- `installDailyTrigger()`

## 주의

- StockAnalysis에서 가져올 수 있는 종목은 `배당금`과 `지급일`이 같이 들어갑니다.
- 한국 종목처럼 지급일이 공개 소스에서 안 잡히는 경우 `payment_day`는 비어 있을 수 있습니다.
- Apps Script는 `Raw_data` 탭의 열 `B`에서 티커를 찾고 열 `E`를 업데이트합니다.
