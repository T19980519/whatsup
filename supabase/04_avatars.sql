-- ============================================================
-- 별일없지? 추가 설정 4: 프로필 사진
-- - 가족정리에서 본인 사진을 고르면 가족 목록과 받는 사람 버튼에 보여요
-- - 사진은 비공개 저장소(avatars)에 두고, 같은 가족방 사람만 볼 수 있어요
-- - 사진은 앱에서 작은 크기(정사각형 JPG)로 줄여서 올려요
-- Supabase SQL Editor 에 전체를 붙여넣고 Run. 여러 번 실행해도 안전해요.
-- ============================================================

alter table public.members add column if not exists avatar_path text;
alter table public.members add column if not exists avatar_at   timestamptz;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', false, 1048576, array['image/jpeg'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- 보기: 같은 가족방 사람 사진만
drop policy if exists avatars_read on storage.objects;
create policy avatars_read on storage.objects for select to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = public.my_family_id()::text);

-- 올리기·바꾸기·지우기: 자기 사진 한 장만 (avatars/<가족방>/<내 구성원 id>.jpg)
drop policy if exists avatars_insert on storage.objects;
create policy avatars_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and name = public.my_family_id()::text || '/' || public.my_member_id()::text || '.jpg');

drop policy if exists avatars_update on storage.objects;
create policy avatars_update on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and name = public.my_family_id()::text || '/' || public.my_member_id()::text || '.jpg')
  with check (bucket_id = 'avatars' and name = public.my_family_id()::text || '/' || public.my_member_id()::text || '.jpg');

drop policy if exists avatars_delete on storage.objects;
create policy avatars_delete on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and name = public.my_family_id()::text || '/' || public.my_member_id()::text || '.jpg');

-- 내 사진 있음/없음 기록 (사진 파일을 올리거나 지운 뒤 호출)
create or replace function public.set_avatar(p_has boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.members
     set avatar_path = case when p_has then family_id::text || '/' || id::text || '.jpg' else null end,
         avatar_at   = case when p_has then now() else null end
   where user_id = auth.uid();
  if not found then raise exception '가족방에 먼저 들어와 주세요'; end if;
end $$;

revoke all on function public.set_avatar(boolean) from public, anon;
grant execute on function public.set_avatar(boolean) to authenticated;
