-- 별일없지? 08: 90일 지난 목소리 매일 자동 삭제 (2026-11-11)
-- 먼저 Edge Function "cleanup"을 올린 뒤 (README 참고) SQL Editor에서 실행하세요.
-- 매일 한국 시각 새벽 4시 7분(UTC 19:07)에 cleanup 함수를 불러요.
-- 여러 번 실행해도 괜찮아요 (예약이 하나만 남아요).

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule('whatsup-cleanup-voices')
 where exists (select 1 from cron.job where jobname = 'whatsup-cleanup-voices');

select cron.schedule(
  'whatsup-cleanup-voices',
  '7 19 * * *',
  $$ select net.http_post(
       url     := 'https://uzlfzlskilcfkpvgmqcp.supabase.co/functions/v1/cleanup',
       body    := '{}'::jsonb,
       headers := '{"Content-Type": "application/json"}'::jsonb,
       timeout_milliseconds := 60000
     ); $$
);

-- 확인: 아래가 한 줄 나오면 예약 완료
-- select jobname, schedule, active from cron.job where jobname = 'whatsup-cleanup-voices';
-- 실행 결과 보기 (다음 날 이후):
-- select status, return_message, start_time from cron.job_run_details
--  where jobid = (select jobid from cron.job where jobname = 'whatsup-cleanup-voices')
--  order by start_time desc limit 5;
