# stoxk

배당금/분배금 추적용 CLI입니다. 아래 종목을 기본 watchlist로 관리합니다.

| Ticker | 종목 | 지급 주기 |
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

## 사용법

추적 종목 보기:

```bash
stoxk list
```

Yahoo Finance에서 최근 배당/분배 이벤트 동기화:

```bash
stoxk sync
```

요약 리포트:

```bash
stoxk report
```

자동 조회가 안 되는 항목이나 실제 입금 확인 내역을 직접 추가:

```bash
stoxk add 441640 --ex-date 2026-05-28 --payment-date 2026-06-02 --amount 82 --note "증권사 입금 확인"
```

CSV 내보내기:

```bash
stoxk export --output dividends.csv
```

이 저장소 루트에는 정적 대시보드가 들어 있습니다.

- `index.html`
- `styles.css`
- `app.js`
- `login.html`
- `api/dashboard-data.js`
- `api/cron/daily.js`

Vercel에서는 루트 디렉터리를 이 저장소로 두고 그대로 배포하면 됩니다. 프론트는 기본적으로 `/api/dashboard-data`를 읽고, 이 엔드포인트는 Supabase의 `dashboard_snapshots` 테이블에 저장된 최신 스냅샷을 반환합니다. Cron이 없거나 최초 배포 직후에는 필요한 경우 서버가 직접 스냅샷을 만들어 저장합니다.
표의 `개수`는 브라우저 `localStorage`에 영구 저장됩니다.

Supabase에 `개수`를 저장하려면 Vercel 환경변수로 아래 두 개를 넣어주세요.

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`

사이트 입장을 막으려면 아래도 넣어주세요.

- `PASSWORD` 또는 `SITE_PASSWORD`
- `SESSION_SECRET` - 선택사항입니다. 비워두면 비밀번호 값을 세션 서명 키로 같이 씁니다.
- `CRON_SECRET` - Vercel Cron 전용 비밀값입니다. 크론 호출을 보호합니다.

그리고 Supabase에 아래 테이블을 만들어주세요.

```sql
create table if not exists portfolio_quantities (
  ticker text not null,
  quantity numeric not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists dashboard_snapshots (
  id text primary key,
  payload jsonb not null,
  updated_at timestamptz not null default now()
);
```

이 저장소의 `저장` 버튼은 `api/quantities.js`를 통해 위 테이블을 읽고 씁니다. 개인용 대시보드라면 이 구성이 가장 단순합니다.

중요한 점은, 이 방식은 `anon key`로 호출하므로 Supabase에서 `portfolio_quantities` 테이블에 대해 RLS를 끄거나, 익명 쓰기 정책을 따로 열어줘야 저장이 됩니다. 나중에 여러 사용자로 확장할 때는 auth와 `user_id` 컬럼을 추가하는 쪽이 더 안전합니다.

사이트 접근은 `login.html`에서 비밀번호를 입력한 뒤, `HttpOnly` + `SameSite=Strict` 세션 쿠키로 유지됩니다. `middleware.js`가 페이지와 API를 함께 막기 때문에, 비밀번호를 모르면 대시보드와 저장 API에 직접 들어갈 수 없습니다.

매일 1회 자동 갱신은 `vercel.json`의 Cron Job이 `/api/cron/daily`를 호출하면서 수행합니다. Vercel Cron은 UTC 기준이고, Hobby 플랜은 하루 1회만 가능합니다. 정확한 분 단위 시각 보장은 되지 않습니다.

예:

```text
https://your-app.vercel.app/?source=https://docs.google.com/spreadsheets/d/e/.../pub?output=csv
```

테스트 실행:

```bash
PYTHONPATH=src python3 -m unittest discover -s tests -v
```

## 데이터 저장 위치

기본 SQLite DB는 `~/.stoxk/dividends.sqlite3`에 저장됩니다. 다른 파일을 쓰려면 모든 명령에 `--db`를 붙입니다.

```bash
stoxk --db ./dividends.sqlite3 report
```

## 참고

`sync`는 Yahoo Finance의 배당 이벤트를 사용하므로 보통 `ex-date`와 금액을 저장합니다. 한국 ETF 또는 일부 커버드콜 ETF는 자동 소스가 비거나 늦을 수 있으니, 실제 공시/입금 내역은 `add` 명령으로 보완하는 방식이 안전합니다.

프론트엔드 쪽은 별도 클라우드 데이터베이스가 없어도 돌아갑니다. 혼자 쓰는 대시보드라면 스프레드시트가 꽤 좋은 출발점이고, 여러 사람이 동시에 쓰거나 서버에서 수량까지 저장하려면 Supabase 같은 DB로 옮기는 편이 낫습니다.
