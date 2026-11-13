// 별일없지? 30일 지난 목소리 지우기 (Supabase Edge Function "cleanup")
// 하루에 한 번 데이터베이스 예약 작업이 이 함수를 불러요 (supabase/08_cleanup.sql).
// 30일이 지난 목소리는 (2026-11-13: 90일 → 30일) 파일(저장소 voices)과 기록(voices 표, 들었음 표)을 모두 지워요.
// 미리 알림은 보내지 않아요 (2026-11-11 대표 결정).
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
    console.log("cleanup", { before, files, rows });
    return json({ ok: true, keepDays: KEEP_DAYS, before, files, rows });
  } catch (e) {
    console.error("cleanup 실패", e);
    return json({ ok: false, files, rows, error: String((e as Error)?.message ?? e) }, 500);
  }
});
