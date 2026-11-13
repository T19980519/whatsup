// 별일없지? 30일 지난 목소리 지우기 (Supabase Edge Function "cleanup")
// 하루에 한 번 데이터베이스 예약 작업이 이 함수를 불러요 (supabase/08_cleanup.sql).
// 30일이 지난 목소리는 (2026-11-13: 90일 → 30일) 파일(저장소 voices)과 기록(voices 표, 들었음 표)을 모두 지워요.
// 미리 알림은 보내지 않아요 (2026-11-11 대표 결정).
// 기록 없이 남은 음성 파일(구성원을 내보내면 생겨요)도 하루가 지나면 지워요 (2026-11-13 대표 결정).
//
// SUPABASE_URL 과 SUPABASE_SERVICE_ROLE_KEY 는 Supabase가 자동으로 넣어 줘요.
// 누가 불러도 안전해요: 받은 값은 쓰지 않고, 언제나 '30일 지난 것'만 지워요.

import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_SECRET_KEY")!;
const KEEP_DAYS = 30;
const BATCH = 200;      // 한 번에 지우는 개수
const MAX_ROUNDS = 25;  // 한 번 부를 때 최대 5,000개까지

const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json" } });

async function removeOrphans(): Promise<number> {
  const { data: recs, error } = await db.from("voices").select("path");
  if (error) throw error;
  const keep = new Set((recs ?? []).map((r) => r.path));
  const dayAgo = Date.now() - 86400000;
  const { data: folders, error: e1 } = await db.storage.from("voices").list("", { limit: 1000 });
  if (e1) throw e1;
  let removed = 0;
  for (const f of folders ?? []) {
    if (f.id) continue; // 폴더(가족방)만 봐요
    for (let offset = 0; ; offset += 1000) {
      const { data: objs, error: e2 } = await db.storage.from("voices").list(f.name, { limit: 1000, offset });
      if (e2) throw e2;
      const gone = (objs ?? [])
        .filter((o) => o.id && !keep.has(f.name + "/" + o.name) && new Date(o.created_at).getTime() < dayAgo)
        .map((o) => f.name + "/" + o.name);
      if (gone.length) {
        const { data: del, error: e3 } = await db.storage.from("voices").remove(gone);
        if (e3) throw e3;
        removed += del?.length ?? 0;
      }
      if (!objs || objs.length < 1000) break;
    }
  }
  return removed;
}

Deno.serve(async () => {
  const before = new Date(Date.now() - KEEP_DAYS * 86400000).toISOString();
  let files = 0, rows = 0;
  try {
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const { data, error } = await db.from("voices")
        .select("id, path").lt("created_at", before).order("created_at").limit(BATCH);
      if (error) throw error;
      if (!data || data.length === 0) break;

      // 1) 파일 먼저 지우기 (이미 없는 파일은 그냥 넘어가요)
      const { data: removed, error: e1 } = await db.storage.from("voices").remove(data.map((v) => v.path));
      if (e1) throw e1;
      files += removed?.length ?? 0;

      // 2) 기록 지우기 (들었음 표는 함께 지워져요: on delete cascade)
      const { error: e2 } = await db.from("voices").delete().in("id", data.map((v) => v.id));
      if (e2) throw e2;
      rows += data.length;

      if (data.length < BATCH) break;
    }
    // 3) 기록 없이 남은 파일 지우기: 구성원을 내보내면 그 사람이 받은 음성 기록만 지워지고 파일이 남아요.
    //    방금 올리는 중인 파일을 건드리지 않도록 하루 넘은 것만 지워요.
    const orphans = await removeOrphans();
    console.log("cleanup", { before, files, rows, orphans });
    return json({ ok: true, keepDays: KEEP_DAYS, before, files, rows, orphans });
  } catch (e) {
    console.error("cleanup 실패", e);
    return json({ ok: false, files, rows, error: String((e as Error)?.message ?? e) }, 500);
  }
});
