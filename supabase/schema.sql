-- ============================================================
-- 별일없지? 서버 설계 (Supabase)
-- Supabase 대시보드 → SQL Editor → New query 에 전체를 붙여넣고 Run.
-- 여러 번 실행해도 안전하게 만들었어요 (이미 있으면 건너뜀).
-- ============================================================

-- 1. 테이블 -----------------------------------------------------

-- 가족방
create table if not exists public.families (
  id          uuid primary key default gen_random_uuid(),
  name        text not null default '우리 가족' check (char_length(btrim(name)) between 1 and 30),
  created_at  timestamptz not null default now()
);

-- 가족 구성원 (폰 한 대 = 구성원 한 명 = 가족방 하나)
create table if not exists public.members (
  id          uuid primary key default gen_random_uuid(),
  family_id   uuid not null references public.families(id) on delete cascade,
  user_id     uuid not null unique references auth.users(id) on delete cascade,
  name        text not null check (char_length(btrim(name)) between 1 and 10),
  role        text not null check (role in ('admin','parent','family')),
  region      text not null default '대한민국'
              check (region in ('대한민국','캐나다','미국','유럽','아프리카','호주','동남아')),
  city        int  not null default 0 check (city between 0 and 30),
  joined_at   timestamptz not null default now()
);
create index if not exists members_family_idx on public.members(family_id);

-- 초대 코드 (6자리, 48시간)
create table if not exists public.invites (
  code        text primary key check (code ~ '^[A-HJ-NP-Z2-9]{6}$'),
  family_id   uuid not null references public.families(id) on delete cascade,
  created_by  uuid references public.members(id) on delete set null,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default now() + interval '48 hours',
  used_by     uuid references public.members(id) on delete set null,
  used_at     timestamptz
);

-- 안부 기록 (부모님이 버튼을 누를 때마다 한 줄)
create table if not exists public.checkins (
  id          bigint generated always as identity primary key,
  family_id   uuid not null references public.families(id) on delete cascade,
  member_id   uuid references public.members(id) on delete set null,
  checked_at  timestamptz not null default now()
);
create index if not exists checkins_family_idx on public.checkins(family_id, checked_at desc);

-- 음성 메시지 (파일은 저장소 voices/<가족방 id>/<파일>)
create table if not exists public.voices (
  id            uuid primary key default gen_random_uuid(),
  family_id     uuid not null references public.families(id) on delete cascade,
  sender_id     uuid references public.members(id) on delete set null,
  path          text not null unique,
  mime          text not null,
  duration_sec  int  not null check (duration_sec between 1 and 180),
  size_bytes    int  not null check (size_bytes between 1 and 5242880),
  created_at    timestamptz not null default now()
);
create index if not exists voices_family_idx on public.voices(family_id, created_at desc);

-- 2. 도우미 함수 (내가 속한 가족방 찾기) ------------------------------

create or replace function public.my_family_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select family_id from public.members where user_id = auth.uid()
$$;

create or replace function public.my_member_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select id from public.members where user_id = auth.uid()
$$;

create or replace function public.i_am_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.members where user_id = auth.uid() and role = 'admin')
$$;

-- 3. 보안 규칙 (RLS): 자기 가족방 것만 볼 수 있어요 -------------------

alter table public.families enable row level security;
alter table public.members  enable row level security;
alter table public.invites  enable row level security;
alter table public.checkins enable row level security;
alter table public.voices   enable row level security;

drop policy if exists families_read on public.families;
create policy families_read on public.families for select to authenticated
  using (id = public.my_family_id());

drop policy if exists members_read on public.members;
create policy members_read on public.members for select to authenticated
  using (family_id = public.my_family_id());

drop policy if exists invites_read on public.invites;
create policy invites_read on public.invites for select to authenticated
  using (family_id = public.my_family_id() and public.i_am_admin());

drop policy if exists checkins_read on public.checkins;
create policy checkins_read on public.checkins for select to authenticated
  using (family_id = public.my_family_id());

drop policy if exists voices_read on public.voices;
create policy voices_read on public.voices for select to authenticated
  using (family_id = public.my_family_id());

drop policy if exists voices_send on public.voices;
create policy voices_send on public.voices for insert to authenticated
  with check (family_id = public.my_family_id()
              and sender_id = public.my_member_id()
              and split_part(path, '/', 1) = family_id::text);

-- 바꾸기·지우기는 아래 함수로만 (직접 수정 금지)

-- 4. 기능 함수 --------------------------------------------------

-- 가족방 만들기 (만든 사람이 방장)
create or replace function public.create_family(p_family_name text, p_my_name text, p_region text, p_city int)
returns uuid language plpgsql security definer set search_path = '' as $$
declare fid uuid;
begin
  if auth.uid() is null then raise exception '로그인이 필요해요'; end if;
  if exists (select 1 from public.members where user_id = auth.uid()) then
    raise exception '이미 가족방에 들어가 있어요';
  end if;
  insert into public.families(name) values (coalesce(nullif(btrim(p_family_name), ''), '우리 가족')) returning id into fid;
  insert into public.members(family_id, user_id, name, role, region, city)
    values (fid, auth.uid(), btrim(p_my_name), 'admin', p_region, coalesce(p_city, 0));
  return fid;
end $$;

-- 초대 코드 만들기 (방장만, 48시간)
create or replace function public.create_invite()
returns table(code text, expires_at timestamptz) language plpgsql security definer set search_path = '' as $$
declare me public.members; c text; letters text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; i int;
begin
  select * into me from public.members where user_id = auth.uid();
  if me.id is null or me.role <> 'admin' then raise exception '방장만 초대할 수 있어요'; end if;
  -- 부모님 2분 + 부모님 외 가족 5명(방장 포함)까지
  if (select count(*) filter (where m.role <> 'parent') >= 5 and count(*) filter (where m.role = 'parent') >= 2
        from public.members m where m.family_id = me.family_id) then
    raise exception '가족 자리가 다 찼어요';
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

-- 초대 코드로 가족방 들어오기
create or replace function public.join_family(p_code text, p_name text, p_as_parent boolean, p_region text, p_city int)
returns uuid language plpgsql security definer set search_path = '' as $$
declare inv public.invites; mid uuid; parents int; total int; fam_count int;
begin
  if auth.uid() is null then raise exception '로그인이 필요해요'; end if;
  if exists (select 1 from public.members where user_id = auth.uid()) then
    raise exception '이미 가족방에 들어가 있어요';
  end if;
  select * into inv from public.invites
    where code = upper(btrim(p_code)) and used_at is null and expires_at > now()
    for update;
  if inv.code is null then raise exception '초대 코드가 맞지 않거나 만료됐어요'; end if;
  select count(*) filter (where role = 'parent'), count(*) filter (where role <> 'parent')
    into parents, fam_count from public.members where family_id = inv.family_id;
  if p_as_parent and parents >= 2 then raise exception '부모님은 두 분까지 등록할 수 있어요'; end if;
  if not p_as_parent and fam_count >= 5 then raise exception '가족 자리가 다 찼어요'; end if;
  insert into public.members(family_id, user_id, name, role, region, city)
    values (inv.family_id, auth.uid(), btrim(p_name), case when p_as_parent then 'parent' else 'family' end,
            p_region, coalesce(p_city, 0))
    returning id into mid;
  update public.invites set used_by = mid, used_at = now() where code = inv.code;
  return inv.family_id;
end $$;

-- 구성원 정보 고치기 (방장은 모두, 다른 사람은 자기 이름·지역만)
create or replace function public.update_member(p_member uuid, p_name text, p_role text, p_region text, p_city int)
returns void language plpgsql security definer set search_path = '' as $$
declare me public.members; t public.members; new_role text;
begin
  select * into me from public.members where user_id = auth.uid();
  select * into t  from public.members where id = p_member;
  if me.id is null or t.id is null or t.family_id <> me.family_id then raise exception '고칠 수 없어요'; end if;
  if me.role <> 'admin' and t.id <> me.id then raise exception '방장만 다른 사람을 고칠 수 있어요'; end if;
  new_role := t.role;
  if me.role = 'admin' and t.role <> 'admin' and p_role in ('parent','family') then new_role := p_role; end if;
  if new_role = 'parent' and t.role <> 'parent'
     and (select count(*) from public.members where family_id = t.family_id and role = 'parent') >= 2 then
    raise exception '부모님은 두 분까지 등록할 수 있어요';
  end if;
  update public.members
     set name = btrim(p_name), role = new_role, region = p_region, city = coalesce(p_city, 0)
   where id = t.id;
end $$;

-- 구성원 내보내기 (방장만, 자기 자신은 안 됨)
create or replace function public.remove_member(p_member uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare me public.members; t public.members;
begin
  select * into me from public.members where user_id = auth.uid();
  select * into t  from public.members where id = p_member;
  if me.id is null or me.role <> 'admin' then raise exception '방장만 내보낼 수 있어요'; end if;
  if t.id is null or t.family_id <> me.family_id or t.id = me.id then raise exception '내보낼 수 없어요'; end if;
  delete from public.members where id = t.id;
end $$;

-- 안부 버튼 (부모님만, 1분 안에 두 번 눌러도 한 번으로)
create or replace function public.check_in()
returns timestamptz language plpgsql security definer set search_path = '' as $$
declare me public.members; last_at timestamptz;
begin
  select * into me from public.members where user_id = auth.uid();
  if me.id is null or me.role <> 'parent' then raise exception '부모님만 안부 버튼을 누를 수 있어요'; end if;
  select max(checked_at) into last_at from public.checkins where member_id = me.id;
  if last_at is not null and last_at > now() - interval '1 minute' then return last_at; end if;
  insert into public.checkins(family_id, member_id) values (me.family_id, me.id) returning checked_at into last_at;
  return last_at;
end $$;

revoke all on function public.create_family(text,text,text,int), public.create_invite(),
  public.join_family(text,text,boolean,text,int), public.update_member(uuid,text,text,text,int),
  public.remove_member(uuid), public.check_in() from public, anon;
grant execute on function public.create_family(text,text,text,int), public.create_invite(),
  public.join_family(text,text,boolean,text,int), public.update_member(uuid,text,text,text,int),
  public.remove_member(uuid), public.check_in() to authenticated;

-- 5. 음성 저장소 (비공개, 파일당 5MB) --------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('voices', 'voices', false, 5242880,
        array['audio/mp4','audio/webm','audio/ogg','audio/mpeg','audio/aac','audio/x-m4a'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists voices_files_read on storage.objects;
create policy voices_files_read on storage.objects for select to authenticated
  using (bucket_id = 'voices' and (storage.foldername(name))[1] = public.my_family_id()::text);

drop policy if exists voices_files_upload on storage.objects;
create policy voices_files_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'voices' and (storage.foldername(name))[1] = public.my_family_id()::text);

-- 6. 실시간 업데이트 (새 음성·안부가 오면 화면이 바로 바뀌게) ------------

do $$
declare t text;
begin
  foreach t in array array['voices','checkins','members'] loop
    if not exists (select 1 from pg_publication_tables
                   where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
