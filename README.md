# 별일없지?

한국에 계신 부모님과 해외(토론토)에 사는 가족을 잇는 안부 앱.

- 부모님: 큰 해님 버튼 "별일 없어요" 한 번 + 목소리 남기기(최대 3분)
- 가족: 안부 상태 확인, 한국/토론토 시차 자동 계산, 음성 메시지 주고받기
- 방장: 가족 초대(48시간 코드), 이름·역할 수정, 내보내기, 저장 공간 확인
- 메뉴: 부모님 / 본인 / 우리가족 / 가족정리(방장: 멤버 추가·수정, 사는 지역 설정)
- 지역: 대한민국, 캐나다, 미국, 유럽, 아프리카, 호주, 동남아 (시간대가 여러 개면 도시 선택). 각 멤버 현지 시각 표시
- 안부 마감: 부모님이 계신 곳 시간 오전 11시, 놓치면 가족 전원에게 푸시 알림
- 음성은 90일 뒤 자동 삭제

현재 단계: 화면 시안(index.html), 소개 페이지(intro.html). GitHub Pages로 배포, 폰 홈 화면에 앱처럼 추가 가능(manifest.webmanifest, icons/). 다음 단계: Supabase 연결, 실제 녹음, 푸시 알림.

## 서버 연결 (Supabase)
1. Supabase 프로젝트의 SQL Editor에서 `supabase/schema.sql` 전체를 실행
2. Authentication → Sign In / Providers → Allow anonymous sign-ins 켜기
3. `index.html` 위쪽의 `SUPABASE_URL`, `SUPABASE_KEY`(publishable key)를 채우기. 비어 있으면 시연 모드로 동작
4. 서버 코드는 `live.js`. 가족방·초대 코드·안부 기록·음성(비공개 저장소 voices)은 보안 규칙(RLS)으로 같은 가족만 볼 수 있음
