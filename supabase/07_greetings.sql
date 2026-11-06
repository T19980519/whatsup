-- ============================================================
-- 별일없지? 추가 설정 7: 내 목소리로 "별일 없지?" (안부 목소리)
-- - 가족마다 자기 목소리로 짧은 "별일 없지?"를 녹음해 두면,
--   그 사람이 안부를 물었을 때 받는 가족의 앱에서 그 목소리가 들려요
-- - 비공개 저장소(greetings)에 두고 같은 가족방 사람만 들을 수 있어요
-- - 녹음·바꾸기·지우기는 본인만
-- Supabase SQL Editor 에 전체를 붙여넣고 Run. 여러 번 실행해도 안전해요.
-- ============================================================

alter table public.members add column if not exists greet_path text;
alter table public.members add column if not exists greet_at   timestamptz;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('greetings', 'greetings', false, 307200, array['audio/mpeg','audio/mp4','audio/webm','audio/ogg','audio/aac'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists greetings_read on storage.objects;
create policy greetings_read on storage.objects for select to authenticated
  using (bucket_id = 'greetings' and (storage.foldername(name))[1] = public.my_family_id()::text);

-- 내 파일 이름은 <가족방>/<내 구성원 id>.<확장자> 만 허용
drop policy if exists greetings_insert on storage.objects;
create policy greetings_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'greetings'
              and split_part(name, '.', 1) = public.my_family_id()::text || '/' || public.my_member_id()::text);

drop policy if exists greetings_update on storage.objects;
create policy greetings_update on storage.objects for update to authenticated
  using (bucket_id = 'greetings' and split_part(name, '.', 1) = public.my_family_id()::text || '/' || public.my_member_id()::text)
  with check (bucket_id = 'greetings' and split_part(name, '.', 1) = public.my_family_id()::text || '/' || public.my_member_id()::text);

drop policy if exists greetings_delete on storage.objects;
create policy greetings_delete on storage.objects for delete to authenticated
  using (bucket_id = 'greetings' and split_part(name, '.', 1) = public.my_family_id()::text || '/' || public.my_member_id()::text);

-- 내 안부 목소리 기록 (파일을 올리거나 지운 뒤 호출). p_ext: mp3, m4a, webm, ogg 중 하나, 비우면 지움
create or replace function public.set_greeting(p_ext text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_ext is not null and p_ext not in ('mp3','m4a','webm','ogg') then raise exception '지원하지 않는 형식이에요'; end if;
  update public.members
     set greet_path = case when p_ext is null then null else family_id::text || '/' || id::text || '.' || p_ext end,
         greet_at   = case when p_ext is null then null else now() end
   where user_id = auth.uid();
  if not found then raise exception '가족방에 먼저 들어와 주세요'; end if;
end $$;

revoke all on function public.set_greeting(text) from public, anon;
grant execute on function public.set_greeting(text) to authenticated;
