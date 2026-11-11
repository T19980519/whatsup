-- ============================================================
-- 별일없지? 09: 안부 기록 지우기 (보낸 사람 + 방장, 언제든) (2026-11-11)
-- 음성 지우기(02)와 같은 규칙. 안부를 지우면 그 안부에 대한 답(answers)도 함께 지워져요.
-- Supabase SQL Editor 에 전체를 붙여넣고 Run. 여러 번 실행해도 안전해요.
-- ============================================================

create or replace function public.delete_ask(p_ask bigint)
returns void language plpgsql security definer set search_path = '' as $$
declare me public.members; a public.asks;
begin
  select * into me from public.members where user_id = auth.uid();
  select * into a  from public.asks    where id = p_ask;
  if me.id is null or a.id is null or a.family_id <> me.family_id then raise exception '지울 수 없어요'; end if;
  if a.from_id is distinct from me.id and me.role <> 'admin' then
    raise exception '보낸 사람이나 방장만 지울 수 있어요';
  end if;
  delete from public.asks where id = a.id;  -- 답(answers)은 on delete cascade 로 함께 지워져요
end $$;

revoke all on function public.delete_ask(bigint) from public, anon;
grant execute on function public.delete_ask(bigint) to authenticated;
