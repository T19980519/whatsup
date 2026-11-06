-- ============================================================
-- 별일없지? 추가 설정 6: 푸시 알림 + 앱 아이콘 숫자(배지)
-- - 새 안부, 안부 답장, 새 목소리가 오면 받는 사람 폰에 알림
-- - 아이콘 숫자 = 아직 답 안 한 안부 + 아직 안 들은 목소리
-- - 알림은 Edge Function "push" 가 보내요 (supabase/functions/push/index.ts)
-- Supabase SQL Editor 에 전체를 붙여넣고 Run. 여러 번 실행해도 안전해요.
-- ============================================================

create extension if not exists pg_net;

-- 1. 폰마다 알림 받을 주소 -----------------------------------------------
create table if not exists public.push_subs (
  endpoint    text primary key,
  member_id   uuid not null references public.members(id) on delete cascade,
  p256dh      text not null,
  auth        text not null,
  created_at  timestamptz not null default now()
);
create index if not exists push_subs_member_idx on public.push_subs(member_id);
alter table public.push_subs enable row level security;   -- 앱에서 직접 읽기·쓰기 금지 (아래 함수로만)

create or replace function public.save_push_sub(p_endpoint text, p_p256dh text, p_auth text)
returns void language plpgsql security definer set search_path = '' as $$
declare mid uuid;
begin
  select id into mid from public.members where user_id = auth.uid();
  if mid is null then raise exception '가족방에 먼저 들어와 주세요'; end if;
  if p_endpoint !~ '^https://' or length(p_endpoint) > 1000 then raise exception '알림 주소가 올바르지 않아요'; end if;
  insert into public.push_subs(endpoint, member_id, p256dh, auth) values (p_endpoint, mid, p_p256dh, p_auth)
  on conflict (endpoint) do update set member_id = excluded.member_id, p256dh = excluded.p256dh, auth = excluded.auth, created_at = now();
end $$;

create or replace function public.remove_push_sub(p_endpoint text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  delete from public.push_subs where endpoint = p_endpoint
    and member_id = (select id from public.members where user_id = auth.uid());
end $$;

-- 2. 목소리 '들었음' 기록 -------------------------------------------------
create table if not exists public.voice_listens (
  voice_id    uuid not null references public.voices(id) on delete cascade,
  member_id   uuid not null references public.members(id) on delete cascade,
  listened_at timestamptz not null default now(),
  primary key (voice_id, member_id)
);
alter table public.voice_listens enable row level security;
drop policy if exists listens_read on public.voice_listens;
create policy listens_read on public.voice_listens for select to authenticated
  using (member_id = public.my_member_id());

create or replace function public.mark_listened(p_voice uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare me public.members;
begin
  select * into me from public.members where user_id = auth.uid();
  if me.id is null then return; end if;
  insert into public.voice_listens(voice_id, member_id)
    select v.id, me.id from public.voices v
     where v.id = p_voice and v.family_id = me.family_id
       and (v.to_id is null or v.to_id = me.id or v.sender_id = me.id)
  on conflict do nothing;
end $$;

-- 3. 안 본 개수 (아이콘 숫자) -----------------------------------------------
create or replace function public.unread_count(p_member uuid)
returns int language sql stable security definer set search_path = '' as $$
  select (
    select count(*) from public.asks a
     where a.family_id = m.family_id and a.from_id <> m.id
       and (a.to_id is null or a.to_id = m.id)
       and a.created_at > now() - interval '7 days'
       and not exists (select 1 from public.answers x where x.ask_id = a.id and x.from_id = m.id)
  ) + (
    select count(*) from public.voices v
     where v.family_id = m.family_id and v.sender_id is distinct from m.id
       and (v.to_id is null or v.to_id = m.id)
       and v.created_at > now() - interval '90 days'
       and not exists (select 1 from public.voice_listens l where l.voice_id = v.id and l.member_id = m.id)
  )::int
  from public.members m where m.id = p_member
$$;

revoke all on function public.save_push_sub(text,text,text), public.remove_push_sub(text),
  public.mark_listened(uuid), public.unread_count(uuid) from public, anon;
grant execute on function public.save_push_sub(text,text,text), public.remove_push_sub(text),
  public.mark_listened(uuid) to authenticated;
-- unread_count 는 알림 함수(서버 전용 키)만 써요

-- 4. 알림을 한 번만 보내도록 표시 칸 --------------------------------------
alter table public.asks    add column if not exists notified_at timestamptz;
alter table public.answers add column if not exists notified_at timestamptz;
alter table public.voices  add column if not exists notified_at timestamptz;

-- 5. 새 안부·답장·목소리가 생기면 알림 함수 부르기 ---------------------------
create or replace function public.notify_push() returns trigger
language plpgsql security definer set search_path = '' as $$
declare k text; r jsonb := to_jsonb(NEW);
begin
  if TG_TABLE_NAME = 'answers' then k := (r->>'ask_id') || ':' || (r->>'from_id'); else k := r->>'id'; end if;
  begin
    perform net.http_post(
      url     := 'https://uzlfzlskilcfkpvgmqcp.supabase.co/functions/v1/push',
      body    := jsonb_build_object('table', TG_TABLE_NAME, 'key', k),
      headers := '{"Content-Type": "application/json"}'::jsonb
    );
  exception when others then
    raise warning '알림 요청 실패: %', sqlerrm;  -- 알림이 실패해도 안부·목소리 보내기는 그대로 돼요
  end;
  return NEW;
end $$;

drop trigger if exists push_on_ask on public.asks;
create trigger push_on_ask after insert on public.asks for each row execute function public.notify_push();
drop trigger if exists push_on_answer on public.answers;
create trigger push_on_answer after insert on public.answers for each row execute function public.notify_push();
drop trigger if exists push_on_voice on public.voices;
create trigger push_on_voice after insert on public.voices for each row execute function public.notify_push();

-- 실시간 업데이트에 '들었음' 추가
do $$
begin
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'voice_listens') then
    alter publication supabase_realtime add table public.voice_listens;
  end if;
end $$;
