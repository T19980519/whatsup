-- ============================================================
-- 별일없지? 추가 설정 3 (v1.0): 가족끼리 안부 묻고 답하기 + 받는 사람 고르기
-- - "부모님" 역할을 없애고 모두 같은 가족 구성원 (방장 1명 + 구성원)
-- - 안부: 한 명 또는 가족 모두에게 "별일 없지?" 묻기 → 받은 사람이 "별일 없어요" 답하기
-- - 음성: 한 명에게 보내면 보낸 사람과 받는 사람만 들을 수 있어요
-- - 오전 11시 마감 기능은 없앴어요
-- Supabase SQL Editor 에 전체를 붙여넣고 Run. 여러 번 실행해도 안전해요.
-- ============================================================

-- 1. 역할 정리: parent/family → member ------------------------------
alter table public.members drop constraint if exists members_role_check;
update public.members set role = 'member' where role in ('parent', 'family');
alter table public.members add constraint members_role_check check (role in ('admin', 'member'));

-- 2. 음성에 받는 사람 추가 (비어 있으면 가족 모두) -----------------------
alter table public.voices add column if not exists to_id uuid references public.members(id) on delete cascade;

-- 3. 안부 묻기 / 답하기 -------------------------------------------------
create table if not exists public.asks (
  id          bigint generated always as identity primary key,
  family_id   uuid not null references public.families(id) on delete cascade,
  from_id     uuid not null references public.members(id) on delete cascade,
  to_id       uuid references public.members(id) on delete cascade,   -- 비어 있으면 가족 모두
  created_at  timestamptz not null default now()
);
create index if not exists asks_family_idx on public.asks(family_id, created_at desc);

create table if not exists public.answers (
  ask_id      bigint not null references public.asks(id) on delete cascade,
  from_id     uuid not null references public.members(id) on delete cascade,
  family_id   uuid not null references public.families(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (ask_id, from_id)
);

alter table public.asks    enable row level security;
alter table public.answers enable row level security;

-- 내가 보냈거나, 나에게 왔거나, 가족 모두에게 온 것만 보여요
drop policy if exists asks_read on public.asks;
create policy asks_read on public.asks for select to authenticated
  using (family_id = public.my_family_id()
         and (to_id is null or to_id = public.my_member_id() or from_id = public.my_member_id()));

drop policy if exists answers_read on public.answers;
create policy answers_read on public.answers for select to authenticated
  using (family_id = public.my_family_id()
         and exists (select 1 from public.asks a where a.id = ask_id
                     and (a.to_id is null or a.to_id = public.my_member_id() or a.from_id = public.my_member_id())));

-- 4. 음성 보기 규칙: 받는 사람이 정해진 음성은 두 사람만 -------------------
drop policy if exists voices_read on public.voices;
create policy voices_read on public.voices for select to authenticated
  using (family_id = public.my_family_id()
         and (to_id is null or to_id = public.my_member_id() or sender_id = public.my_member_id()));

drop policy if exists voices_send on public.voices;
create policy voices_send on public.voices for insert to authenticated
  with check (family_id = public.my_family_id()
              and sender_id = public.my_member_id()
              and split_part(path, '/', 1) = family_id::text
              and (to_id is null or exists (select 1 from public.members m
                                            where m.id = to_id and m.family_id = voices.family_id)));

drop policy if exists voices_files_read on storage.objects;
create policy voices_files_read on storage.objects for select to authenticated
  using (bucket_id = 'voices'
         and (storage.foldername(name))[1] = public.my_family_id()::text
         and exists (select 1 from public.voices v where v.path = name
                     and (v.to_id is null or v.to_id = public.my_member_id() or v.sender_id = public.my_member_id())));

-- 5. 기능 함수 바꾸기 --------------------------------------------------
drop function if exists public.check_in();
drop function if exists public.join_family(text, text, boolean, text, int);
drop function if exists public.update_member(uuid, text, text, text, int);
drop table if exists public.checkins;

-- 초대 코드 만들기 (방장만, 가족은 8명까지)
create or replace function public.create_invite()
returns table(code text, expires_at timestamptz) language plpgsql security definer set search_path = '' as $$
declare me public.members; c text; letters text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; i int;
begin
  select * into me from public.members where user_id = auth.uid();
  if me.id is null or me.role <> 'admin' then raise exception '방장만 초대할 수 있어요'; end if;
  if (select count(*) from public.members m where m.family_id = me.family_id) >= 8 then
    raise exception '가족 자리가 다 찼어요 (8명까지)';
  end if;
  loop
    c := '';
    for i in 1..6 loop
      c := c || substr(letters, 1 + floor(random() * length(letters))::int, 1);
    end loop;
    exit when not exists (select 1 from public.invites v where v.code = c);
  end loop;
  insert into public.invites(code, family_id, created_by) values (c, me.family_id, me.id);
  return query select v.code, v.expires_at from public.invites v where v.code = c;
end $$;

-- 초대 코드로 들어오기
create or replace function public.join_family(p_code text, p_name text, p_region text, p_city int)
returns uuid language plpgsql security definer set search_path = '' as $$
declare inv public.invites; mid uuid;
begin
  if auth.uid() is null then raise exception '로그인이 필요해요'; end if;
  if exists (select 1 from public.members where user_id = auth.uid()) then
    raise exception '이미 가족방에 들어가 있어요';
  end if;
  select * into inv from public.invites
    where code = upper(btrim(p_code)) and used_at is null and expires_at > now()
    for update;
  if inv.code is null then raise exception '초대 코드가 맞지 않거나 만료됐어요'; end if;
  if (select count(*) from public.members where family_id = inv.family_id) >= 8 then
    raise exception '가족 자리가 다 찼어요 (8명까지)';
  end if;
  insert into public.members(family_id, user_id, name, role, region, city)
    values (inv.family_id, auth.uid(), btrim(p_name), 'member', p_region, coalesce(p_city, 0))
    returning id into mid;
  update public.invites set used_by = mid, used_at = now() where code = inv.code;
  return inv.family_id;
end $$;

-- 구성원 정보 고치기 (방장은 모두, 다른 사람은 자기 것만)
create or replace function public.update_member(p_member uuid, p_name text, p_region text, p_city int)
returns void language plpgsql security definer set search_path = '' as $$
declare me public.members; t public.members;
begin
  select * into me from public.members where user_id = auth.uid();
  select * into t  from public.members where id = p_member;
  if me.id is null or t.id is null or t.family_id <> me.family_id then raise exception '고칠 수 없어요'; end if;
  if me.role <> 'admin' and t.id <> me.id then raise exception '다른 사람 정보는 방장만 고칠 수 있어요'; end if;
  update public.members set name = btrim(p_name), region = p_region, city = coalesce(p_city, 0) where id = t.id;
end $$;

-- 안부 묻기 (p_to 가 비어 있으면 가족 모두). 10분 안에 같은 사람에게 다시 물으면 한 번으로
create or replace function public.ask_family(p_to uuid)
returns bigint language plpgsql security definer set search_path = '' as $$
declare me public.members; aid bigint;
begin
  select * into me from public.members where user_id = auth.uid();
  if me.id is null then raise exception '가족방에 먼저 들어와 주세요'; end if;
  if p_to is not null and (p_to = me.id or not exists
       (select 1 from public.members where id = p_to and family_id = me.family_id)) then
    raise exception '받는 사람을 다시 골라 주세요';
  end if;
  select a.id into aid from public.asks a
   where a.from_id = me.id and a.to_id is not distinct from p_to and a.created_at > now() - interval '10 minutes'
     and not exists (select 1 from public.answers x where x.ask_id = a.id)
   order by a.created_at desc limit 1;
  if aid is not null then return aid; end if;
  insert into public.asks(family_id, from_id, to_id) values (me.family_id, me.id, p_to) returning id into aid;
  return aid;
end $$;

-- "별일 없어요" 답하기: 나에게 온(또는 가족 모두에게 온) 최근 7일 안부 중 아직 답 안 한 것 모두
create or replace function public.answer_asks()
returns int language plpgsql security definer set search_path = '' as $$
declare me public.members; n int;
begin
  select * into me from public.members where user_id = auth.uid();
  if me.id is null then raise exception '가족방에 먼저 들어와 주세요'; end if;
  insert into public.answers(ask_id, from_id, family_id)
    select a.id, me.id, me.family_id from public.asks a
     where a.family_id = me.family_id and a.from_id <> me.id
       and (a.to_id is null or a.to_id = me.id)
       and a.created_at > now() - interval '7 days'
       and not exists (select 1 from public.answers x where x.ask_id = a.id and x.from_id = me.id);
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function public.create_invite(), public.join_family(text,text,text,int),
  public.update_member(uuid,text,text,int), public.ask_family(uuid), public.answer_asks() from public, anon;
grant execute on function public.create_invite(), public.join_family(text,text,text,int),
  public.update_member(uuid,text,text,int), public.ask_family(uuid), public.answer_asks() to authenticated;

-- 6. 실시간 업데이트에 안부 테이블 추가 ------------------------------------
do $$
declare t text;
begin
  foreach t in array array['voices','members','asks','answers'] loop
    if not exists (select 1 from pg_publication_tables
                   where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
