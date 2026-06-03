# Apps Script

`Raw_data` 탭의 `배당금` 열과 `배당주기` 열을 Supabase 값으로 갱신하는 Google Apps Script입니다.

## 설정 탭

스프레드시트에 `설정` 탭을 만들고 아래처럼 넣어주세요.

| A열 | B열 |
| --- | --- |
| `SUPABASE_URL` | `https://xxxx.supabase.co` |
| `SUPABASE_ANON_KEY` | `...` |
| `SPREADSHEET_ID` | `1GoL5LDSzfsYwDo4VogfFsdTHBdEO5y-ZuRM3NXj8Kpo` |
| `SHEET_NAME` | `Raw_data` |

## 엔트리포인트

- `syncRawDataFromSupabase()`

## 흐름

1. GitHub Actions가 매일 Supabase `dividend_snapshots` 테이블을 갱신합니다.
2. Apps Script가 Supabase를 읽습니다.
3. `Raw_data` 탭에서 컬럼 `B`의 티커를 찾아 컬럼 `A`에 종목명, 컬럼 `E`에 배당금을, 컬럼 `K`에 배당주기를 업데이트합니다.
4. `K`열은 고정 사용합니다.

Supabase 컬럼명이 공백을 포함한 `"Dividend Frequency"`라면 Apps Script도 그 정확한 이름을 읽도록 맞춰야 합니다. 이 경우 URL 쿼리 문자열은 인코딩해서 보내야 합니다. 가능하면 나중에는 `dividend_frequency`처럼 snake_case로 바꾸는 편이 더 안정적입니다.

## 권장 설정

- Apps Script의 시간대는 `Asia/Seoul`
- Apps Script 편집기의 Triggers 메뉴에서 `syncRawDataFromSupabase()`를 매일 자동 실행하도록 시간 기반 트리거를 만듭니다
- GitHub Action과 Apps Script는 5분 정도 간격을 두는 편이 안전합니다
