# Apps Script

`Raw_data` 탭의 `배당금` 열을 Supabase 값으로 갱신하는 Google Apps Script입니다.

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
- `installDailyTrigger()`

## 흐름

1. GitHub Actions가 매일 Supabase `dividend_snapshots` 테이블을 갱신합니다.
2. Apps Script가 Supabase를 읽습니다.
3. `Raw_data` 탭에서 컬럼 `B`의 티커를 찾아 컬럼 `E` 값을 업데이트합니다.

## 권장 설정

- Apps Script의 시간대는 `Asia/Seoul`
- `installDailyTrigger()`를 한 번 실행해서 매일 자동 실행 트리거를 만듭니다
- GitHub Action과 Apps Script는 5분 정도 간격을 두는 편이 안전합니다
