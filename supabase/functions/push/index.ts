// 별일없지? 푸시 알림 보내기 (Supabase Edge Function "push")
// 새 안부·답장·목소리가 생기면 데이터베이스가 이 함수를 불러요 (supabase/06_push.sql).
// 받는 사람의 폰마다 알림을 보내고, 아이콘 숫자(안 본 개수)도 함께 보내요.
//
// 필요한 비밀 값 (Supabase → Edge Functions → Secrets):
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY
// SUPABASE_URL 과 SUPABASE_SERVICE_ROLE_KEY 는 Supabase가 자동으로 넣어 줘요.
//
// 이 함수는 누가 불러도 안전하게 만들었어요: 받은 값(표 이름·번호)만 믿지 않고
// 데이터베이스에서 직접 다시 읽고, 10분 안에 생긴 것만, 한 번만 알림을 보내요.

import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_SECRET_KEY")!;
const VAPID_PUBLIC = Deno.env.get("VAPID_PUBLIC_KEY")!;
const VAPID_PRIVATE = Deno.env.get("VAPID_PRIVATE_KEY")!;
const APP_URL = "https://t19980519.github.io/whatsup/";

webpush.setVapidDetails(APP_URL, VAPID_PUBLIC, VAPID_PRIVATE);
const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

// 이름 뒤 조사: 받침이 있으면 '이', 없으면 '가' (한글이 아니면 '님이')
function subj(n: string) {
  const c = n.trim().slice(-1).charCodeAt(0);
  if (c < 0xac00 || c > 0xd7a3) return n + "님이";
  return n + ((c - 0xac00) % 28 ? "이" : "가");
}
const mmss = (s: number) => Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
const RECENT_MS = 10 * 60 * 1000;
const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json" } });

type Msg = { recipients: string[]; title: string; body: string; tag: string };

// 표 이름과 번호로 알림 내용 만들기. 이미 보냈거나 오래된 것이면 null
async function buildMessage(table: string, key: string): Promise<Msg | null> {
  const recentEnough = (t: string) => Date.now() - new Date(t).getTime() < RECENT_MS;
  const familyMembers = async (fid: string) =>
    (await db.from("members").select("id,name").eq("family_id", fid)).data ?? [];

  if (table === "asks") {
    const { data: a } = await db.from("asks").select("*").eq("id", Number(key)).maybeSingle();
    if (!a || a.notified_at || !recentEnough(a.created_at)) return null;
    const { data: claimed } = await db.from("asks").update({ notified_at: new Date().toISOString() })
      .eq("id", a.id).is("notified_at", null).select("id");
    if (!claimed?.length) return null;
    const mem = await familyMembers(a.family_id);
    const from = mem.find((m) => m.id === a.from_id)?.name ?? "가족";
    const recipients = a.to_id ? [a.to_id] : mem.filter((m) => m.id !== a.from_id).map((m) => m.id);
    return { recipients, title: "별일없지?", body: subj(from) + ' "별일 없지?" 하고 안부를 물었어요', tag: "ask-" + a.id };
  }

  if (table === "answers") {
    const [askId, fromId] = key.split(":");
    const { data: x } = await db.from("answers").select("*").eq("ask_id", Number(askId)).eq("from_id", fromId).maybeSingle();
    if (!x || x.notified_at || !recentEnough(x.created_at)) return null;
    const { data: claimed } = await db.from("answers").update({ notified_at: new Date().toISOString() })
      .eq("ask_id", x.ask_id).eq("from_id", x.from_id).is("notified_at", null).select("ask_id");
    if (!claimed?.length) return null;
    const { data: a } = await db.from("asks").select("from_id,family_id").eq("id", x.ask_id).maybeSingle();
    if (!a) return null;
    const mem = await familyMembers(a.family_id);
    const who = mem.find((m) => m.id === x.from_id)?.name ?? "가족";
    return { recipients: [a.from_id], title: "별일없지?", body: subj(who) + ' "별일 없어요"라고 답했어요', tag: "answer-" + x.ask_id + "-" + x.from_id };
  }

  if (table === "voices") {
    const { data: v } = await db.from("voices").select("*").eq("id", key).maybeSingle();
    if (!v || v.notified_at || !recentEnough(v.created_at)) return null;
    const { data: claimed } = await db.from("voices").update({ notified_at: new Date().toISOString() })
      .eq("id", v.id).is("notified_at", null).select("id");
    if (!claimed?.length) return null;
    const mem = await familyMembers(v.family_id);
    const from = mem.find((m) => m.id === v.sender_id)?.name ?? "가족";
    const recipients = v.to_id ? [v.to_id] : mem.filter((m) => m.id !== v.sender_id).map((m) => m.id);
    return { recipients, title: "별일없지?", body: from + "의 목소리가 왔어요 (" + mmss(v.duration_sec) + ")", tag: "voice-" + v.id };
  }
  return null;
}

async function sendTo(memberId: string, msg: Msg) {
  const { data: subs } = await db.from("push_subs").select("*").eq("member_id", memberId);
  if (!subs?.length) return 0;
  const { data: count } = await db.rpc("unread_count", { p_member: memberId });
  const payload = JSON.stringify({ title: msg.title, body: msg.body, tag: msg.tag, badge: count ?? 0, url: APP_URL });
  let sent = 0;
  await Promise.all(subs.map(async (s) => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload,
        { TTL: 60 * 60 * 24, urgency: "high" });
      sent++;
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) await db.from("push_subs").delete().eq("endpoint", s.endpoint); // 없어진 폰
      else console.error("push failed", code, (e as Error).message);
    }
  }));
  return sent;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  let table = "", key = "";
  try { ({ table, key } = await req.json()); } catch { return json({ error: "bad body" }, 400); }
  if (!["asks", "answers", "voices"].includes(table) || typeof key !== "string" || key.length > 100) return json({ error: "bad input" }, 400);
  const msg = await buildMessage(table, key);
  if (!msg) return json({ skipped: true });
  let sent = 0;
  for (const r of msg.recipients) sent += await sendTo(r, msg);
  return json({ sent, recipients: msg.recipients.length });
});
