-- ============================================================
-- 별일없지? 음성 점검 (2026-11-13)
-- 읽기만 해요. 아무것도 바꾸거나 지우지 않아요.
-- Supabase SQL Editor 에 전체를 붙여넣고 Run → 나온 표를 캡처해서 보내 주세요.
-- (SQL Editor는 마지막 결과만 보여 줘서, 모든 점검을 표 하나로 모았어요)
-- ============================================================

select '1 음성 기록' as 항목,
       count(*)::text || '개 · 가장 오래된 ' || coalesce(to_char(min(created_at), 'MM-DD HH24:MI'), '-')
       || ' · 가장 최근 ' || coalesce(to_char(max(created_at), 'MM-DD HH24:MI'), '-') as 내용
  from public.voices
union all
select '2 음성 파일', count(*)::text || '개' from storage.objects where bucket_id = 'voices'
union all
select '3 예약 ' || jobid, jobname || ' | ' || schedule || ' | ' || active::text || ' | ' || left(command, 110)
  from cron.job
union all
(select '4 실행 ' || to_char(start_time, 'MM-DD HH24:MI'), status || ' ' || left(coalesce(return_message, ''), 60)
   from cron.job_run_details order by start_time desc limit 5)
union all
(select '5 정리 결과 ' || to_char(created, 'MM-DD HH24:MI'), coalesce(status_code::text, '-') || ' ' || left(coalesce(content::text, error_msg, ''), 150)
   from net._http_response order by created desc limit 5)
union all
(select '6 가족 ' || coalesce(name, ''), role || ' | 들어온 때 ' || to_char(joined_at, 'MM-DD HH24:MI')
   from public.members order by joined_at);
