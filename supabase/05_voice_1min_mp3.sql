-- ============================================================
-- 별일없지? 추가 설정 5: 목소리 최대 1분 + MP3 저장
-- - 앱이 모든 목소리를 MP3(아이폰·안드로이드 모두 재생)로 바꿔 올려요
-- - 서버도 1분이 넘는 목소리와 2MB가 넘는 파일은 받지 않아요
-- - 이미 저장된 예전 목소리(1분 넘는 것)는 그대로 둬요
-- Supabase SQL Editor 에 전체를 붙여넣고 Run. 여러 번 실행해도 안전해요.
-- ============================================================

alter table public.voices drop constraint if exists voices_duration_sec_check;
alter table public.voices drop constraint if exists voices_duration_1min;
alter table public.voices add constraint voices_duration_1min check (duration_sec between 1 and 60) not valid;

alter table public.voices drop constraint if exists voices_size_bytes_check;
alter table public.voices drop constraint if exists voices_size_2mb;
alter table public.voices add constraint voices_size_2mb check (size_bytes between 1 and 2097152) not valid;

update storage.buckets
   set file_size_limit = 2097152,
       allowed_mime_types = array['audio/mpeg','audio/mp4','audio/webm','audio/ogg','audio/aac','audio/x-m4a']
 where id = 'voices';
