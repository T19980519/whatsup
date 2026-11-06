-- ============================================================
-- 별일없지? 추가 설정 2: 음성 지우기 (보낸 사람 + 방장, 언제든)
-- Supabase SQL Editor 에 전체를 붙여넣고 Run. 여러 번 실행해도 안전해요.
-- ============================================================

-- 음성 파일 지우기 권한: 같은 가족방이면서, 내가 보낸 음성이거나 내가 방장일 때
drop policy if exists voices_files_delete on storage.objects;
create policy voices_files_delete on storage.objects for delete to authenticated
  using (bucket_id = 'voices'
         and (storage.foldername(name))[1] = public.my_family_id()::text
         and (public.i_am_admin()
              or exists (select 1 from public.voices v
                         where v.path = name and v.sender_id = public.my_member_id())));

-- 음성 기록 지우기 (파일을 먼저 지운 뒤 호출)
create or replace function public.delete_voice(p_voice uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare me public.members; v public.voices;
begin
  select * into me from public.members where user_id = auth.uid();
  select * into v  from public.voices  where id = p_voice;
  if me.id is null or v.id is null or v.family_id <> me.family_id then raise exception '지울 수 없어요'; end if;
  if v.sender_id is distinct from me.id and me.role <> 'admin' then
    raise exception '보낸 사람이나 방장만 지울 수 있어요';
  end if;
  delete from public.voices where id = v.id;
end $$;

revoke all on function public.delete_voice(uuid) from public, anon;
grant execute on function public.delete_voice(uuid) to authenticated;
