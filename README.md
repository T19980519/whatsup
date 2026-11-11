# 별일없지?

멀리 떨어진 가족끼리 안부를 묻고 짧은 목소리를 주고받는 웹앱(PWA). 연장자도 쓰기 쉽게 큰 버튼 위주.

- 홈: 받는 사람(한 명 또는 가족 모두)을 고르고 "별일 없지?" 물어보기 또는 목소리 보내기(최대 1분, MP3로 저장)
- 안부를 받으면 큰 해님 버튼 "별일 없어요" 한 번으로 답하기. 보낸 사람은 소식에서 답 확인
- 한 사람에게 보낸 목소리는 보낸 사람과 받는 사람만 들을 수 있음. 보낸 사람·방장은 언제든 지우기 가능
- 가족 편집: 카카오톡 초대 링크(6자리 코드, 48시간, 1회용)로 가족 추가, 이름·사는 지역(7개 지역, 도시별 시간대) 수정. 방장 1명 + 가족, 최대 8명
- 프로필 사진: 가족 편집에서 본인 사진 넣기·바꾸기·지우기 (앱에서 정사각형으로 줄여 비공개 저장, 같은 가족만 보기)
- 알림: 새 안부·답장·목소리가 오면 푸시 알림, 아이콘 숫자 = 답 안 한 안부 + 안 들은 목소리 (아이폰은 홈 화면 앱 + 알림 허용 필요)
- 안부 소리: 가족마다 내 목소리로 "별일 없지?"(5초)를 녹음해 두면, 안부를 받은 가족 앱에서 앱을 열 때·보고 있을 때 그 목소리 재생 (없으면 띵동). 이 폰에서 소리 켜기/끄기
- 음성은 90일 보관: 90일이 지나면 매일 새벽 자동으로 파일과 기록을 모두 지움 (미리 알림 없음)

## 서버 연결 (Supabase)
SQL Editor에서 순서대로 실행: `supabase/schema.sql` → `supabase/03_v1_family.sql` → `supabase/04_avatars.sql` → `supabase/05_voice_1min_mp3.sql` → `supabase/06_push.sql` → `supabase/07_greetings.sql` → `supabase/08_cleanup.sql` → `supabase/09_delete_ask.sql` (02는 schema.sql에 포함, 08은 아래 cleanup 함수를 먼저 올린 뒤 실행).
Authentication → Allow anonymous sign-ins 켜기. 연결 정보는 `app.js` 위쪽의 `SUPABASE_URL`, `SUPABASE_KEY`(publishable key).

### 알림 함수 (Edge Function `push`)
- 코드: `supabase/functions/push/index.ts` — 대시보드 Edge Functions에서 이름 `push`로 올리고 JWT 확인(Verify JWT)은 끄기
- Secrets: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` (공개 키는 `app.js`의 `VAPID_PUBLIC`과 같은 값, 비밀 키는 저장소에 넣지 않음)

### 90일 자동 삭제 함수 (Edge Function `cleanup`)
- 코드: `supabase/functions/cleanup/index.ts` — 대시보드 Edge Functions에서 이름 `cleanup`으로 올리고 JWT 확인(Verify JWT)은 끄기 (90일 지난 것만 지우므로 누가 불러도 안전)
- 그다음 SQL Editor에서 `supabase/08_cleanup.sql` 실행 → 매일 한국 새벽 4시쯤 자동 실행
- Secrets 추가 필요 없음

### 새 버전 올리기
`app.js`의 `APP_VERSION`과 `version.json`의 `version`을 같은 숫자로 올려서 함께 커밋. 앱의 가족 편집 → 업데이트 버튼이 `version.json`을 보고 새 버전을 받아요.
