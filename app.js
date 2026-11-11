// 별일없지? v1.0 — 멀리 떨어진 가족끼리 안부를 묻고 짧은 목소리를 주고받는 앱
// 서버: Supabase (supabase/schema.sql → 02 → 03 순서로 설정)

const APP_VERSION = '1.8'; // 새 버전을 올릴 때는 여기와 version.json 두 곳을 같이 바꿔요
// publishable key는 앱에 공개돼도 되는 키예요. secret key는 절대 넣지 마세요.
const SUPABASE_URL = 'https://uzlfzlskilcfkpvgmqcp.supabase.co';
const SUPABASE_KEY = 'sb_publishable_pfOLq5e0i9NnI9ihQrwvtw_7_llihCw';
// 알림용 공개 키 (짝이 되는 비밀 키는 Supabase Edge Function 비밀 값에만 있어요)
const VAPID_PUBLIC = 'BNl452H4EnbdOoXxKi7xdRhGaP-wrj4JDRo3jFo9gkFqOgC5GyURnyKD9N53Zklwkj36EK9g4qciQTA7p1AYCGs';

const MAX_MEMBERS = 8;      // 가족방 최대 인원
const GREET_MAX = 5;        // 내 안부 목소리("별일 없지?") 최대 5초
const MAX_REC = 60;         // 음성 1개당 최대 1분 (서버 저장 공간 아끼기)
const KEEP_DAYS = 90;       // 음성 보관 기간
const QUOTA_MB = 1024;      // 무료 저장 공간 1GB
const ASK_DAYS = 14;        // 소식에 보여줄 안부 기간

// 지역 → 도시(시간대)
const REGIONS = {
  '대한민국': [['서울','Asia/Seoul'],['부산','Asia/Seoul'],['인천','Asia/Seoul'],['대구','Asia/Seoul'],['대전','Asia/Seoul'],['광주','Asia/Seoul'],['울산','Asia/Seoul'],['세종','Asia/Seoul'],['수원 (경기)','Asia/Seoul'],['원주 (강원)','Asia/Seoul'],['청주 (충북)','Asia/Seoul'],['천안 (충남)','Asia/Seoul'],['전주 (전북)','Asia/Seoul'],['순천 (전남)','Asia/Seoul'],['포항 (경북)','Asia/Seoul'],['창원 (경남)','Asia/Seoul'],['제주 (제주)','Asia/Seoul']],
  '캐나다':   [['토론토·몬트리올','America/Toronto'],['밴쿠버','America/Vancouver'],['캘거리·에드먼턴','America/Edmonton'],['위니펙','America/Winnipeg'],['핼리팩스','America/Halifax']],
  '미국':     [['뉴욕·애틀랜타','America/New_York'],['시카고·댈러스','America/Chicago'],['덴버','America/Denver'],['피닉스','America/Phoenix'],['LA·시애틀','America/Los_Angeles'],['앵커리지','America/Anchorage'],['하와이','Pacific/Honolulu']],
  '유럽':     [['런던·리스본','Europe/London'],['파리·베를린·로마','Europe/Paris'],['아테네·헬싱키','Europe/Athens'],['모스크바·이스탄불','Europe/Moscow']],
  '아프리카': [['라고스·카사블랑카','Africa/Lagos'],['카이로','Africa/Cairo'],['요하네스버그','Africa/Johannesburg'],['나이로비','Africa/Nairobi']],
  '호주':     [['시드니·멜버른','Australia/Sydney'],['브리즈번','Australia/Brisbane'],['애들레이드','Australia/Adelaide'],['다윈','Australia/Darwin'],['퍼스','Australia/Perth']],
  '동남아':   [['방콕·하노이','Asia/Bangkok'],['싱가포르·쿠알라룸푸르','Asia/Singapore'],['마닐라','Asia/Manila'],['자카르타','Asia/Jakarta']],
};

// ---------- 공통 도우미 ----------
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const mmss = s => Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
const fmt = (tz, opt) => new Intl.DateTimeFormat('ko-KR', { timeZone: tz, ...opt });
const timeKo = (tz, d) => fmt(tz, { hour: 'numeric', minute: '2-digit' }).format(d);
const cityOf = m => { const c = REGIONS[m && m.region] || REGIONS['대한민국']; return c[m && m.city] || c[0]; };
const tzOf = m => cityOf(m)[1];
const placeOf = m => cityOf(m)[0].replace(/ \(.+\)$/, '');
// 이름 뒤 조사: 받침이 있으면 이/을, 없으면 가/를 (한글이 아니면 '님이/님을')
const hasBatchim = n => { const c = String(n).trim().slice(-1).charCodeAt(0); return c >= 0xAC00 && c <= 0xD7A3 ? (c - 0xAC00) % 28 > 0 : null; };
const subj = n => { const b = hasBatchim(n); return n + (b === null ? '님이' : b ? '이' : '가'); };
const obj = n => { const b = hasBatchim(n); return n + (b === null ? '님을' : b ? '을' : '를'); };
const errMsg = e => (e && (e.message || e.error_description)) || '잠시 후 다시 해 주세요';

function ago(d) {
  const mins = Math.round((Date.now() - d) / 60000);
  if (mins < 1) return '방금';
  if (mins < 60) return mins + '분 전';
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return hrs + '시간 전';
  return new Intl.DateTimeFormat('ko-KR', { month: 'long', day: 'numeric' }).format(d);
}

function toast(t) {
  const el = $('toast'); el.textContent = t; el.classList.add('show');
  clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove('show'), 2400);
}

function face(mood) {
  const eyes = mood === 'happy'
    ? '<path d="M28 44q8-9 16 0M56 44q8-9 16 0" stroke="currentColor" stroke-width="6" fill="none" stroke-linecap="round"/>'
    : '<circle cx="36" cy="42" r="6" fill="currentColor"/><circle cx="64" cy="42" r="6" fill="currentColor"/>';
  const mouth = mood === 'happy' ? '<path d="M34 60q16 18 32 0z" fill="currentColor"/>'
    : '<path d="M38 62q12 10 24 0" stroke="currentColor" stroke-width="6" fill="none" stroke-linecap="round"/>';
  return '<svg class="face" viewBox="0 0 100 90" aria-hidden="true">' + eyes + mouth +
    '<ellipse cx="22" cy="58" rx="8" ry="5" fill="var(--cheek)" opacity=".8"/><ellipse cx="78" cy="58" rx="8" ry="5" fill="var(--cheek)" opacity=".8"/></svg>';
}
const PLAY = '<svg viewBox="0 0 20 20" fill="currentColor"><path d="M4 2.5v15a1 1 0 0 0 1.5.9l12-7.5a1 1 0 0 0 0-1.8l-12-7.5A1 1 0 0 0 4 2.5z"/></svg>';
const PAUSE = '<svg viewBox="0 0 20 20" fill="currentColor" style="margin-left:0"><rect x="4" y="3" width="4.5" height="14" rx="1.5"/><rect x="11.5" y="3" width="4.5" height="14" rx="1.5"/></svg>';
const TRASH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/></svg>';
const GROUP = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7"/><path d="M18 14.5c2.2.6 3.5 2.6 3.5 5.5"/></svg>';
const SUN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4.5" fill="currentColor" stroke="none"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/></svg>';

// ---------- 상태 ----------
const S = {
  me: null,            // 내 구성원 정보
  members: [], asks: [], answers: [], voices: [],
  to: null,            // 받는 사람: 구성원 id 또는 'all'
  tab: 'home', sheet: null, playing: null, delAsk: null, answeredAt: 0,
  avatars: {},        // 구성원 id → { url, at } (사진 주소)
  listened: new Set(), // 내가 들은 목소리 id
  greets: {},          // 구성원 id → { url, at } (안부 목소리 주소)
  greetRec: null,      // 안부 목소리 녹음 중 상태
};
const memberOf = id => S.members.find(m => m.id === id);
const nameOf = id => (memberOf(id) || {}).name || '나간 가족';
const others = () => S.members.filter(m => m.id !== S.me.id);
const isAdmin = () => S.me && S.me.role === 'admin';
// 프로필 사진이 있으면 사진, 없으면 이름 첫 글자
// 사람마다 파스텔 색 (가족방에 들어온 순서대로, 같은 사람은 어디서나 같은 색)
const PASTEL = [['#FFE9A8', '#5A4100'], ['#D8F2E4', '#1F5E3F'], ['#FFDCE5', '#8A1F3D'], ['#E4DCFF', '#43308A'],
  ['#D6ECFF', '#24476E'], ['#FFE3CC', '#7A3E10'], ['#F3E0FF', '#5E2A7A'], ['#DDF5F2', '#1F5A55']];
const avaHtml = (m, cls = '') => {
  const a = m && S.avatars[m.id];
  const i = m ? S.members.findIndex(x => x.id === m.id) : -1;
  const c = PASTEL[(i < 0 ? 0 : i) % PASTEL.length];
  return '<span class="ava' + (cls ? ' ' + cls : '') + '" style="background:' + c[0] + ';color:' + c[1] + '">' +
    (a && a.url ? '<img src="' + esc(a.url) + '" alt="">' : esc((m && m.name || '?').slice(0, 1))) + '</span>';
};
const toName = to => to === 'all' || to == null ? '가족 모두' : nameOf(to);
const unheardVoices = () => S.voices.filter(v => v.sender_id !== S.me.id && !S.listened.has(v.id));
const answeredBy = askId => S.answers.filter(a => a.ask_id === askId);
const pendingAsks = () => S.asks.filter(a => a.from_id !== S.me.id && (a.to_id == null || a.to_id === S.me.id) &&
  Date.now() - new Date(a.created_at) < 7 * 86400000 && !S.answers.some(x => x.ask_id === a.id && x.from_id === S.me.id));

document.querySelector('#verTag').textContent = 'v' + APP_VERSION;
$('verFoot').textContent = 'v' + APP_VERSION;

// ---------- 업데이트 ----------
// version.json(서버의 최신 버전)과 지금 버전을 비교해서, 새 버전이 있으면 파일을 새로 받아 다시 열어요.
const newer = (a, b) => { const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); } return false; };
const APP_FILES = ['./', 'index.html', 'app.js', 'sw.js', 'manifest.webmanifest'];

async function checkUpdate(btn) {
  if (btn) { btn.disabled = true; btn.textContent = '확인 중…'; }
  try {
    const r = await fetch('version.json?t=' + Date.now(), { cache: 'no-store' });
    if (!r.ok) throw new Error(r.status);
    const latest = String((await r.json()).version || '');
    if (!latest || !newer(latest, APP_VERSION)) { toast('이미 최신 버젼 입니다.'); return; }
    toast('새 버젼 v' + latest + '을 받는 중이에요…');
    // 폰에 저장된 예전 파일 대신 서버의 새 파일을 받아 두기
    await Promise.all(APP_FILES.map(f => fetch(f, { cache: 'reload' }).catch(() => {})));
    if (swReg) { try { await swReg.update(); } catch (_) {} }
    if (window.caches) { try { for (const k of await caches.keys()) await caches.delete(k); } catch (_) {} }
    try { sessionStorage.setItem('byeolil-update-to', latest); } catch (_) {}
    location.reload();
  } catch (e) {
    console.error(e); toast('업데이트를 확인하지 못했어요. 인터넷 연결을 확인해 주세요.');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '업데이트'; }
  }
}
// 업데이트 후 다시 열렸을 때 결과 알려 주기
function updateResult() {
  let to = null; try { to = sessionStorage.getItem('byeolil-update-to'); sessionStorage.removeItem('byeolil-update-to'); } catch (_) {}
  if (!to) return;
  setTimeout(() => toast(newer(to, APP_VERSION) ? '새 버젼을 받는 중이에요. 잠시 후 업데이트를 한 번 더 눌러 주세요.' : '최신 버젼으로 업데이트 됐습니다.'), 600);
}
function renderAbout() {
  $('aboutPanel').innerHTML = '<div class="about"><span><b>앱 버젼 v' + APP_VERSION + '</b><br><small>새 기능이 나왔는지 확인하고 바로 받아요.</small></span>' +
    '<button class="btn btn-ghost" id="updateBtn">업데이트</button></div>';
}
document.addEventListener('click', e => { const b = e.target.closest('#updateBtn'); if (b) checkUpdate(b); });

// ---------- 그리기 ----------
function render() {
  if (!S.me) return;
  document.querySelectorAll('#tabs button').forEach(b => b.setAttribute('aria-selected', b.dataset.tab === S.tab));
  $('home').hidden = S.tab !== 'home';
  $('manage').hidden = S.tab !== 'manage';
  renderHome();
  renderManage();
}

function renderHome() {
  const now = new Date();
  // 받은 안부 → 큰 해님 버튼으로 답하기
  renderNotify();
  updateBadge();
  const pend = pendingAsks();
  const justAnswered = Date.now() - S.answeredAt < 60000;
  // 받은 안부가 있을 때만 큰 해님으로 "별일 없어요" 답하기 (11/11 테스트 후 묻기 기능은 위 두 버튼으로만)
  const btn = $('answerBtn');
  $('inbox').hidden = !pend.length && !justAnswered;
  if (pend.length) {
    const names = [...new Set(pend.map(a => nameOf(a.from_id)))];
    $('inboxText').innerHTML = esc(subj(names.join(', '))) + ' 물었어요<small>“별일 없지?” · ' + timeKo(tzOf(S.me), new Date(pend[0].created_at)) + '</small>';
    btn.classList.remove('done'); btn.classList.add('wiggle');
    btn.innerHTML = face('wait') + '<b>별일 없어요</b><small>터치로 답하기</small>';
  } else if (justAnswered) {
    $('inboxText').innerHTML = '안부를 전했어요';
    btn.classList.add('done'); btn.classList.remove('wiggle');
    btn.innerHTML = face('happy') + '<b>답했어요!</b><small>' + timeKo(tzOf(S.me), new Date(S.answeredAt)) + '</small>';
  }

  // 받는 사람 고르기
  const list = others();
  if (S.to !== 'all' && !memberOf(S.to)) S.to = list.length > 1 ? 'all' : list[0] ? list[0].id : null;
  $('people').innerHTML = !list.length
    ? '<p class="empty" style="grid-column:1/-1">아직 가족이 없어요.<br>' + (isAdmin() ? '가족 편집에서 가족을 초대해 주세요.' : '방장에게 초대를 부탁해 주세요.') + '</p>'
    : (list.length > 1 ? '<button class="person" data-to="all" aria-pressed="' + (S.to === 'all') + '"><span class="ava all">' + GROUP + '</span><strong>가족 모두</strong><small>' + list.length + '명</small></button>' : '') +
      list.map(m => '<button class="person" data-to="' + m.id + '" aria-pressed="' + (S.to === m.id) + '">' +
        avaHtml(m) + '<strong>' + esc(m.name) + '</strong>' +
        '<small>' + esc(placeOf(m)) + '<br>' + timeKo(tzOf(m), now) + '</small></button>').join('');
  $('toLine').innerHTML = S.to ? '받는 사람: <b>' + esc(toName(S.to)) + '</b> · 목소리는 1분까지' : '';

  $('askBtn').disabled = !S.to;
  if (!rec) $('micBtn').disabled = !S.to;

  // 소식 (안부 + 음성, 최신순)
  const items = [
    ...S.asks.map(a => ({ kind: 'ask', at: new Date(a.created_at), a })),
    ...S.voices.map(v => ({ kind: 'voice', at: new Date(v.created_at), v })),
  ].sort((x, y) => y.at - x.at).slice(0, 40);
  $('feed').innerHTML = items.length ? items.map(it => it.kind === 'ask' ? askItem(it.a, it.at) : voiceItem(it.v, it.at)).join('')
    : '<p class="empty">아직 소식이 없어요. 위에서 가족에게 안부를 물어보세요.</p>';
}

function askItem(a, at) {
  const mine = a.from_id === S.me.id;
  const ans = answeredBy(a.id);
  let title, chip;
  if (mine) {
    title = esc(toName(a.to_id)) + '에게 안부를 물었어요';
    if (a.to_id == null) {
      const total = S.members.filter(m => m.id !== a.from_id).length;
      chip = ans.length ? '<span class="chip ok">✓ 별일 없대요 · ' + esc(ans.map(x => nameOf(x.from_id)).join(', ')) + ' (' + ans.length + '/' + total + '명)</span>'
        : '<span class="chip wait">아직 답이 없어요</span>';
    } else {
      chip = ans.length ? '<span class="chip ok">✓ 별일 없대요 · ' + ago(new Date(ans[0].created_at)) + '</span>'
        : '<span class="chip wait">아직 답이 없어요</span>';
    }
  } else {
    title = esc(subj(nameOf(a.from_id))) + ' ' + (a.to_id == null ? '가족 모두에게 ' : '') + '안부를 물었어요';
    chip = ans.some(x => x.from_id === S.me.id) ? '<span class="chip ok">✓ 답했어요</span>' : '<span class="chip wait">답을 기다려요</span>';
  }
  const icon = mine ? '<span class="ic">' + SUN + '</span>' : avaHtml(memberOf(a.from_id), 'ic');
  return '<div class="item">' + icon + '<div><strong>' + title + '</strong><em>' + ago(at) + '</em><br>' + chip + '</div></div>';
}

function voiceItem(v, at) {
  const mine = v.sender_id === S.me.id;
  // 화면에는 이름을 <이름>으로 굵게, 읽어주기(aria)용 title은 꺾쇠 없이
  const who = esc(mine ? toName(v.to_id) : nameOf(v.sender_id));
  const rest = mine ? '에게 보낸 나의 음성 안부' : '한테 받은 음성 안부';
  const title = who + rest;
  const shown = '<span class="who">&lt;' + who + '&gt;</span>' + rest;
  const bars = Array.from({ length: 20 }, (_, i) => '<i style="height:' + (5 + Math.abs(Math.sin(i * 1.7 + v.duration_sec)) * 15).toFixed(0) + 'px"></i>').join('');
  const left = KEEP_DAYS - Math.floor((Date.now() - at) / 86400000);
  const canDel = mine || isAdmin();
  const playing = S.playing === v.id;
  return '<div class="msg' + (mine ? ' mine' : '') + '">' +
    '<button class="play" data-play="' + v.id + '" aria-pressed="' + playing + '" aria-label="' + title + ' ' + (playing ? '멈추기' : '듣기') + '">' + (playing ? PAUSE : PLAY) + '</button>' +
    '<div><strong>' + shown + (!mine && !S.listened.has(v.id) ? ' <span class="new">새 목소리</span>' : '') + '</strong><em class="num">' + ago(at) + ' · ' + mmss(v.duration_sec) + '<span class="keep">· ' + left + '일 뒤 삭제</span></em><div class="bars">' + bars + '</div></div>' +
    (canDel ? '<button class="del" data-del="' + v.id + '" aria-label="' + title + ' 지우기">' + TRASH + '</button>' : '') +
    (S.delAsk === v.id ? '<div class="del-ask"><span>이 목소리를 지울까요? 모두의 화면에서 사라지고 되돌릴 수 없어요.</span>' +
      '<button class="btn btn-danger-solid" data-del-yes="' + v.id + '">지우기</button><button class="btn btn-ghost" data-del-no>취소</button></div>' : '') +
    '</div>';
}

function renderManage() {
  const now = new Date();
  $('famCount').textContent = '가족 ' + S.members.length + ' / ' + MAX_MEMBERS + '명';
  $('manageHint').textContent = isAdmin()
    ? '구성원을 눌러 이름과 사는 지역을 바꿀 수 있어요. 내 이름을 누르면 프로필 사진도 넣을 수 있어요.'
    : '내 이름을 눌러 이름, 사는 지역, 프로필 사진을 바꿀 수 있어요.';
  $('members').innerHTML = S.members.map(m => {
    const me = m.id === S.me.id;
    return '<button class="member" data-id="' + m.id + '">' +
      avaHtml(m, m.role === 'admin' ? 'r-admin' : '') +
      '<div><strong>' + esc(m.name) + (me ? ' (본인)' : '') + '</strong><em>' + (m.role === 'admin' ? '방장' : '가족') + ' · ' +
      '<span style="white-space:nowrap">' + esc(m.region + ' ' + placeOf(m)) + '</span> · <span style="white-space:nowrap">지금 ' + timeKo(tzOf(m), now) + '</span></em></div>' +
      (isAdmin() || me ? '<span class="chev">›</span>' : '') + '</button>';
  }).join('');
  const inv = $('inviteBtn');
  inv.hidden = !isAdmin() || !!S.sheet;
  inv.disabled = S.members.length >= MAX_MEMBERS;
  inv.textContent = S.members.length >= MAX_MEMBERS ? '가족 자리가 다 찼어요' : '+ 가족 초대하기';
  $('storePanel').hidden = !isAdmin();
  renderSound();
  renderAbout();
  renderStore();
  renderSheet();
}

function renderStore() {
  const used = S.voices.reduce((a, v) => a + (v.size_bytes || 0), 0) / 1048576;
  const pct = used / QUOTA_MB * 100;
  $('store').innerHTML =
    '<div class="store-top"><span>저장 공간</span><b>' + pct.toFixed(1) + '% 사용</b></div>' +
    '<div class="meter ' + (pct >= 85 ? 'high' : pct >= 60 ? 'mid' : '') + '" role="meter" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + pct.toFixed(0) + '" aria-label="저장 공간 사용량"><i style="width:' + Math.max(2, Math.min(100, pct)) + '%"></i></div>' +
    '<p class="num">' + used.toFixed(1) + 'MB / 1GB · 남은 공간으로 1분짜리 목소리 약 ' + Math.floor((QUOTA_MB - used) * 1024 / 360).toLocaleString() + '개를 더 보낼 수 있어요</p>' +
    '<p>목소리는 ' + KEEP_DAYS + '일이 지나면 자동으로 지워져요. 한 사람에게 보낸 목소리는 보낸 사람과 받는 사람만 들을 수 있어요.</p>';
}

function regionFields(state, prefix) {
  const cities = REGIONS[state.region];
  return '<div class="f2"><label class="f" for="' + prefix + 'Region">사는 지역<select id="' + prefix + 'Region" data-k="region">' +
    Object.keys(REGIONS).map(k => '<option' + (k === state.region ? ' selected' : '') + '>' + k + '</option>').join('') + '</select></label>' +
    '<label class="f" for="' + prefix + 'City">도시<select id="' + prefix + 'City" data-k="city"' + (cities.length > 1 ? '' : ' disabled') + '>' +
    cities.map((c, i) => '<option value="' + i + '"' + (i === state.city ? ' selected' : '') + '>' + c[0] + '</option>').join('') + '</select></label></div>';
}

function renderSheet() {
  const sh = $('sheet');
  if (!S.sheet) { sh.innerHTML = ''; return; }
  if (S.sheet.type === 'invite') {
    const c = S.sheet.code;
    sh.innerHTML = '<div class="sheet"><h4>초대 코드가 만들어졌어요</h4>' +
      '<div class="code">' + c + '</div><p class="link">' + esc(joinLink(c)) + '</p>' +
      '<p class="sub" style="font-size:14px">카카오톡으로 링크를 보내 주세요. 받은 사람은 이름만 적으면 들어와요. <b>48시간 뒤 자동으로 만료</b>되고, 한 사람만 쓸 수 있어요.<br>휴대폰이 서툰 가족은 옆에 있는 가족이 대신 링크를 열어 들어가 주면 돼요.</p>' +
      '<div class="row"><button class="btn btn-sun" data-act="copy">링크 복사</button>' +
      (navigator.share ? '<button class="btn btn-ghost" data-act="share">보내기</button>' : '') + '</div>' +
      '<button class="btn btn-ghost" data-act="close">닫기</button></div>';
    return;
  }
  const m = memberOf(S.sheet.id);
  if (!m) { S.sheet = null; return renderSheet(); }
  const canRemove = isAdmin() && m.id !== S.me.id;
  const self = m.id === S.me.id, hasPhoto = !!m.avatar_path;
  const photoRow = !self ? '' :
    '<div class="photo-row">' + avaHtml(m, 'ava-lg') + '<div class="photo-btns">' +
      '<label class="btn btn-ghost photo-pick">' + (hasPhoto ? '사진 바꾸기' : '프로필 사진 넣기') + '<input type="file" accept="image/*" id="photoInput" class="vh"></label>' +
      (hasPhoto ? '<button class="btn btn-danger" data-act="photoDel">사진 지우기</button>' : '') +
    '</div></div>';
  sh.innerHTML = '<div class="sheet"><h4>' + esc(m.name) + ' 정보 수정</h4>' + photoRow +
    '<label class="f" for="editName">표시 이름<input id="editName" maxlength="10" value="' + esc(S.sheet.name) + '"></label>' +
    regionFields(S.sheet, 'edit') +
    '<p class="sub" style="font-size:14px;margin:0">그곳 지금 시각: <b class="num">' + timeKo(REGIONS[S.sheet.region][S.sheet.city][1], new Date()) + '</b></p>' +
    '<div class="row"><button class="btn btn-sun" data-act="save">저장</button><button class="btn btn-ghost" data-act="close">취소</button></div>' +
    (m.role === 'admin' ? '<p class="sub" style="font-size:13px;margin:0">방장은 가족방에서 내보낼 수 없어요.</p>' : !canRemove ? '' : S.sheet.confirm
      ? '<div class="confirm"><span><b>' + esc(obj(m.name)) + '</b> 가족방에서 내보낼까요? 그 폰에서는 바로 접속이 끊겨요. 다시 들어오려면 새로 초대해야 해요.</span>' +
        '<div class="row"><button class="btn btn-danger-solid" data-act="remove">내보내기</button><button class="btn btn-ghost" data-act="cancelRemove">그대로 두기</button></div></div>'
      : '<button class="btn btn-danger" data-act="askRemove">가족방에서 내보내기</button>') + '</div>';
}

const joinLink = c => location.origin + location.pathname + '?join=' + c;

// ---------- 화면 조작 ----------
$('tabs').addEventListener('click', e => {
  const b = e.target.closest('[data-tab]'); if (!b) return;
  S.tab = b.dataset.tab; S.sheet = null; render(); window.scrollTo({ top: 0 });
});
$('people').addEventListener('click', e => {
  const b = e.target.closest('[data-to]'); if (!b || rec) return;
  S.to = b.dataset.to; try { localStorage.setItem('byeolil-to', S.to); } catch (_) {}
  renderHome();
});
$('members').addEventListener('click', e => {
  const b = e.target.closest('.member'); if (!b) return;
  const m = memberOf(b.dataset.id);
  if (!isAdmin() && m.id !== S.me.id) return toast('다른 사람 정보는 방장만 고칠 수 있어요');
  S.sheet = { type: 'edit', id: m.id, name: m.name, region: m.region, city: m.city || 0, confirm: false };
  renderManage(); $('editName')?.focus();
});
$('sheet').addEventListener('input', e => { if (e.target.id === 'editName') S.sheet.name = e.target.value; });
$('sheet').addEventListener('change', e => {
  if (e.target.id === 'photoInput') { const f = e.target.files && e.target.files[0]; e.target.value = ''; if (f) api.setPhoto(f); return; }
  if (e.target.dataset.k === 'region') { S.sheet.region = e.target.value; S.sheet.city = 0; renderSheet(); $('editRegion')?.focus(); }
  else if (e.target.dataset.k === 'city') { S.sheet.city = +e.target.value; renderSheet(); $('editCity')?.focus(); }
});
$('sheet').addEventListener('click', e => {
  const act = (e.target.closest('[data-act]') || {}).dataset?.act; if (!act) return;
  if (act === 'close') { S.sheet = null; renderManage(); }
  else if (act === 'copy') {
    const t = joinLink(S.sheet.code);
    (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(
      () => toast('초대 링크를 복사했어요. 카카오톡에 붙여 넣어 보내 주세요'),
      () => toast('복사가 안 됐어요. 링크를 길게 눌러 복사해 주세요'));
  }
  else if (act === 'share') navigator.share({ title: '별일없지? 가족방 초대', text: '우리 가족방에 들어와요. 초대 코드: ' + S.sheet.code, url: joinLink(S.sheet.code) }).catch(() => {});
  else if (act === 'save') api.updateMember(S.sheet);
  else if (act === 'photoDel') api.removePhoto();
  else if (act === 'askRemove') { S.sheet.confirm = true; renderSheet(); }
  else if (act === 'cancelRemove') { S.sheet.confirm = false; renderSheet(); }
  else if (act === 'remove') api.removeMember(S.sheet.id);
});
$('inviteBtn').addEventListener('click', () => api.createInvite());
$('answerBtn').addEventListener('click', () => { if (pendingAsks().length) api.answer(); });
$('askBtn').addEventListener('click', () => api.ask());
$('feed').addEventListener('click', e => {
  const d = e.target.closest('[data-del]'); if (d) { S.delAsk = S.delAsk === d.dataset.del ? null : d.dataset.del; return renderHome(); }
  if (e.target.closest('[data-del-no]')) { S.delAsk = null; return renderHome(); }
  const y = e.target.closest('[data-del-yes]'); if (y) { S.delAsk = null; return api.deleteVoice(y.dataset.delYes); }
  const p = e.target.closest('[data-play]'); if (p) api.play(p.dataset.play);
});

// 녹음 버튼: 한 번 누르면 녹음, 다시 누르면 보내기
let rec = null;
(function wireMic() {
  const btn = $('micBtn'), label = btn.querySelector('span'), orig = label.textContent;
  let t0 = null, iv = null, starting = false, to = null;
  btn.addEventListener('click', async () => {
    if (starting) return;
    if (!t0) {
      if (!S.to) return toast('받는 사람을 먼저 골라 주세요');
      starting = true; const ok = await api.startRec(); starting = false;
      if (!ok) return;
      to = S.to; t0 = Date.now(); btn.classList.add('rec');
      const tick = () => {
        const s = Math.min(MAX_REC, Math.round((Date.now() - t0) / 1000));
        label.textContent = '녹음 중 ' + mmss(s) + ' / ' + mmss(MAX_REC) + ' · 누르면 보내요';
        if (s >= MAX_REC) { btn.click(); toast('1분이 되어 자동으로 보냈어요'); }
      };
      tick(); iv = setInterval(tick, 250);
    } else {
      clearInterval(iv);
      const len = Math.max(1, Math.min(MAX_REC, Math.round((Date.now() - t0) / 1000)));
      t0 = null; btn.classList.remove('rec'); label.textContent = orig;
      api.stopRec(len, to);
    }
  });
})();

// ---------- 안부 목소리 ("별일 없지?"를 묻는 사람 목소리로) ----------
const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch (_) { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (_) {} };
const soundOn = () => lsGet('byeolil-sound', 'on') !== 'off';

function renderSound() {
  const me = S.me, has = !!me.greet_path, g = S.greetRec;
  const rec = g ? '<button class="btn btn-voice" data-greet="stop">녹음 중 ' + mmss(g.sec) + ' / ' + mmss(GREET_MAX) + ' · 누르면 끝</button>'
    : has ? '<div class="row"><button class="btn btn-ghost" data-greet="play">내 목소리 듣기</button><button class="btn btn-ghost" data-greet="rec">다시 녹음</button></div>' +
            '<button class="btn btn-danger" data-greet="del">내 안부 목소리 지우기</button>'
          : '<button class="btn btn-voice" data-greet="rec">내 목소리로 "별일 없지?" 녹음하기</button>';
  $('soundPanel').innerHTML =
    '<h3>안부 소리</h3>' +
    '<p class="sub" style="font-size:15px;margin:0">내가 "별일 없지?"를 보내면, 받는 가족의 앱에서 <b>내 목소리</b>로 "별일 없지?"가 들려요. ' +
      (has ? '지금 내 목소리가 등록되어 있어요.' : '아직 녹음하지 않았다면 "띵동" 소리가 나요.') + '</p>' +
    (g ? '' : '<p class="sub" style="font-size:14px;margin:0">녹음 버튼을 누르고 "별일 없지?"라고 말한 뒤 다시 누르세요. ' + GREET_MAX + '초까지예요.</p>') +
    rec +
    '<div class="toggle-row"><span><b>이 폰에서 안부 소리</b><br><small>가족이 안부를 물으면 앱을 열 때와 앱을 보고 있을 때 소리로 알려 드려요.</small></span>' +
    '<button class="switch" role="switch" aria-checked="' + soundOn() + '" data-greet="toggle" aria-label="안부 소리 ' + (soundOn() ? '켜짐' : '꺼짐') + '"><i></i><b>' + (soundOn() ? '켜짐' : '꺼짐') + '</b></button></div>';
}

// "띵동" (안부 목소리가 없을 때)
function chime() {
  const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return Promise.reject();
  const ac = new AC();
  const tone = (f, t, d) => { const o = ac.createOscillator(), g = ac.createGain(); o.type = 'sine'; o.frequency.value = f;
    g.gain.setValueAtTime(0.0001, ac.currentTime + t); g.gain.exponentialRampToValueAtTime(0.35, ac.currentTime + t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + t + d); o.connect(g).connect(ac.destination); o.start(ac.currentTime + t); o.stop(ac.currentTime + t + d + 0.05); };
  return (ac.state === 'suspended' ? ac.resume() : Promise.resolve()).then(() => {
    if (ac.state !== 'running') throw new Error('blocked');
    tone(988, 0, 0.45); tone(784, 0.32, 0.7); setTimeout(() => ac.close(), 1500);
  });
}

const greetAudio = new Audio(); greetAudio.preload = 'none';
let greetWaiting = null; // 폰이 소리를 막았을 때, 첫 터치에 다시 재생
function playGreeting(memberId) {
  const g = S.greets[memberId];
  const go = () => g && g.url ? (greetAudio.src = g.url, greetAudio.play()) : chime();
  return go().catch(() => { greetWaiting = memberId; });
}
document.addEventListener('pointerdown', () => {
  if (greetWaiting == null) return;
  const id = greetWaiting; greetWaiting = null; playGreeting(id);
}, true);

// 아직 소리를 안 들려준 새 안부가 있으면, 가장 최근에 물은 사람 목소리로 한 번
function maybeGreet() {
  if (!S.me) return;
  let done = []; try { done = JSON.parse(lsGet('byeolil-greeted', '[]')); } catch (_) {}
  const fresh = pendingAsks().filter(a => !done.includes(a.id));
  if (!fresh.length) return;
  lsSet('byeolil-greeted', JSON.stringify(done.concat(fresh.map(a => a.id)).slice(-200)));
  if (!soundOn() || rec) return;
  const newest = fresh.sort((x, y) => new Date(y.created_at) - new Date(x.created_at))[0];
  playGreeting(newest.from_id);
}

// 내 안부 목소리 녹음
let gRec = null, gStream = null, gChunks = [], gTimer = null;
async function greetStart() {
  if (!window.MediaRecorder || !navigator.mediaDevices) return toast('이 브라우저는 녹음을 지원하지 않아요');
  try { gStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }); }
  catch (_) { return toast('마이크를 쓸 수 있게 허락해 주세요'); }
  loadLame().catch(() => {});
  const mime = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'].find(t => MediaRecorder.isTypeSupported(t)) || '';
  gChunks = []; gRec = new MediaRecorder(gStream, mime ? { mimeType: mime } : undefined);
  gRec.ondataavailable = e => { if (e.data && e.data.size) gChunks.push(e.data); };
  gRec.start(250);
  const t0 = Date.now(); S.greetRec = { sec: 0 };
  gTimer = setInterval(() => {
    S.greetRec.sec = Math.min(GREET_MAX, Math.floor((Date.now() - t0) / 1000));
    if (Date.now() - t0 >= GREET_MAX * 1000) greetStop(); else renderSound();
  }, 250);
  renderSound();
}
function greetStop() {
  if (!gRec) return;
  clearInterval(gTimer); S.greetRec = null; renderSound();
  const r = gRec; gRec = null;
  r.onstop = async () => {
    gStream.getTracks().forEach(t => t.stop());
    const rawType = (r.mimeType || 'audio/webm').split(';')[0];
    const raw = new Blob(gChunks, { type: rawType });
    if (raw.size < 800) return toast('녹음이 너무 짧아요. 다시 해 주세요');
    toast('저장하는 중…');
    let blob = raw, type = rawType;
    try { const mp3 = await toMp3(raw); if (mp3.blob.size > 500) { blob = mp3.blob; type = 'audio/mpeg'; } } catch (_) {}
    const ext = type === 'audio/mpeg' ? 'mp3' : type === 'audio/mp4' ? 'm4a' : type === 'audio/ogg' ? 'ogg' : 'webm';
    const path = S.me.family_id + '/' + S.me.id + '.' + ext;
    const up = await sb.storage.from('greetings').upload(path, blob, { contentType: type, upsert: true, cacheControl: '60' });
    if (up.error) return toast('저장하지 못했어요: ' + errMsg(up.error));
    if (S.me.greet_path && S.me.greet_path !== path) await sb.storage.from('greetings').remove([S.me.greet_path]);
    const { error } = await sb.rpc('set_greeting', { p_ext: ext });
    if (error) return toast(errMsg(error));
    delete S.greets[S.me.id];
    toast('내 안부 목소리를 저장했어요'); await refresh();
  };
  r.stop();
}
async function greetDelete() {
  if (!S.me.greet_path) return;
  const rm = await sb.storage.from('greetings').remove([S.me.greet_path]);
  if (rm.error) return toast('지우지 못했어요: ' + errMsg(rm.error));
  const { error } = await sb.rpc('set_greeting', { p_ext: null });
  if (error) return toast(errMsg(error));
  delete S.greets[S.me.id];
  toast('내 안부 목소리를 지웠어요. 이제 "띵동" 소리가 나요'); await refresh();
}
document.addEventListener('click', e => {
  const b = e.target.closest('[data-greet]'); if (!b) return;
  const a = b.dataset.greet;
  if (a === 'rec') greetStart();
  else if (a === 'stop') greetStop();
  else if (a === 'del') greetDelete();
  else if (a === 'play') { const g = S.greets[S.me.id]; if (g && g.url) { greetAudio.src = g.url; greetAudio.play().catch(() => toast('재생하지 못했어요')); } }
  else if (a === 'toggle') {
    lsSet('byeolil-sound', soundOn() ? 'off' : 'on'); renderSound();
    toast(soundOn() ? '안부 소리를 켰어요' : '안부 소리를 껐어요');
    if (soundOn()) playGreeting(S.me.id);
  }
});

// 사진을 가운데 기준 정사각형으로 잘라 작은 JPG로 (폰 사진도 30KB 안팎)
async function squareJpeg(file, size) {
  let src;
  try { src = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
  catch (_) {
    src = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = URL.createObjectURL(file); });
  }
  const w = src.width || src.naturalWidth, h = src.height || src.naturalHeight, s = Math.min(w, h);
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, size, size);
  g.drawImage(src, (w - s) / 2, (h - s) / 2, s, s, 0, 0, size, size);
  return new Promise(r => c.toBlob(r, 'image/jpeg', 0.85));
}

// 녹음 파일을 MP3로 바꾸기: 아이폰·안드로이드 어디서나 재생되는 형식
// (모노 22kHz 48kbps → 1분에 약 360KB)
const MP3_RATE = 22050, MP3_KBPS = 48;
let lameReady = null;
function loadLame() {
  if (window.lamejs) return Promise.resolve();
  if (!lameReady) lameReady = new Promise((res, rej) => {
    const sc = document.createElement('script');
    sc.src = 'https://cdn.jsdelivr.net/npm/lamejs@1.2.1/lame.min.js';
    sc.onload = () => res(); sc.onerror = () => { lameReady = null; rej(new Error('MP3 변환기를 불러오지 못했어요')); };
    document.head.appendChild(sc);
  });
  return lameReady;
}
async function toMp3(blob) {
  await loadLame();
  const AC = window.AudioContext || window.webkitAudioContext;
  const ac = new AC();
  let decoded;
  try {
    const buf = await blob.arrayBuffer();
    decoded = await new Promise((res, rej) => {
      const p = ac.decodeAudioData(buf, res, rej);
      if (p && p.then) p.then(res, rej);
    });
  } finally { ac.close && ac.close(); }
  // 모노로 합치고 22kHz로 바꾸기
  const frames = Math.max(1, Math.ceil(decoded.duration * MP3_RATE));
  const off = new (window.OfflineAudioContext || window.webkitOfflineAudioContext)(1, frames, MP3_RATE);
  const src = off.createBufferSource(); src.buffer = decoded; src.connect(off.destination); src.start();
  const rendered = await off.startRendering();
  const f32 = rendered.getChannelData(0);
  const pcm = new Int16Array(f32.length);
  for (let i = 0; i < f32.length; i++) { const v = Math.max(-1, Math.min(1, f32[i])); pcm[i] = v < 0 ? v * 0x8000 : v * 0x7fff; }
  const enc = new window.lamejs.Mp3Encoder(1, MP3_RATE, MP3_KBPS);
  const parts = [];
  for (let i = 0; i < pcm.length; i += 1152) { const d = enc.encodeBuffer(pcm.subarray(i, i + 1152)); if (d.length) parts.push(new Uint8Array(d)); }
  const end = enc.flush(); if (end.length) parts.push(new Uint8Array(end));
  return { blob: new Blob(parts, { type: 'audio/mpeg' }), seconds: decoded.duration };
}

// ---------- 서버 ----------
let sb = null, channel = null, reloadTimer = null;
const audio = new Audio(); audio.preload = 'none';
audio.addEventListener('ended', () => { S.playing = null; renderHome(); });
let recStream = null, chunks = [], recMime = '';

const api = {
  async ask() {
    if (!S.to) return toast('받는 사람을 먼저 골라 주세요');
    const btn = $('askBtn'), sun = $('answerBtn'); btn.disabled = true; sun.disabled = true;
    const { error } = await sb.rpc('ask_family', { p_to: S.to === 'all' ? null : S.to });
    btn.disabled = false; sun.disabled = false;
    if (error) return toast(errMsg(error));
    toast(toName(S.to) + '에게 "별일 없지?"를 보냈어요');
    refresh();
  },
  async answer() {
    const { error } = await sb.rpc('answer_asks');
    if (error) return toast(errMsg(error));
    S.answeredAt = Date.now();
    const b = $('answerBtn'); b.classList.add('pop'); setTimeout(() => b.classList.remove('pop'), 500);
    toast('"별일 없어요"를 전했어요');
    await refresh();
  },
  async startRec() {
    if (!window.MediaRecorder || !navigator.mediaDevices) { toast('이 브라우저는 녹음을 지원하지 않아요'); return false; }
    try { recStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }); }
    catch (_) { toast('마이크를 쓸 수 있게 허락해 주세요'); return false; }
    loadLame().catch(() => {});
    recMime = ['audio/mp4', 'audio/mp4;codecs=mp4a.40.2', 'audio/aac', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus']
      .find(t => MediaRecorder.isTypeSupported(t)) || '';
    chunks = [];
    rec = new MediaRecorder(recStream, recMime ? { mimeType: recMime, audioBitsPerSecond: 32000 } : undefined);
    rec.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
    rec.start(1000);
    renderHome();
    return true;
  },
  stopRec(lenSec, to) {
    if (!rec) return;
    const r = rec; rec = null;
    r.onstop = async () => {
      recStream.getTracks().forEach(t => t.stop());
      renderHome();
      const rawType = (r.mimeType || recMime || 'audio/webm').split(';')[0];
      const raw = new Blob(chunks, { type: rawType });
      if (raw.size < 1000) return toast('녹음이 너무 짧아요. 다시 해 주세요');
      toast('보내는 중…');
      // 아이폰·안드로이드 모두 들을 수 있게 MP3로 바꿔요. 혹시 안 되면 원래 파일 그대로 보내요.
      let blob = raw, type = rawType;
      try { const mp3 = await toMp3(raw); if (mp3.blob.size > 1000) { blob = mp3.blob; type = 'audio/mpeg'; } }
      catch (e) { console.warn('MP3 변환 실패, 원본으로 보냄', e); }
      const ext = type === 'audio/mpeg' ? 'mp3' : type === 'audio/mp4' || type === 'audio/aac' ? 'm4a' : type === 'audio/ogg' ? 'ogg' : 'webm';
      const path = S.me.family_id + '/' + crypto.randomUUID() + '.' + ext;
      const up = await sb.storage.from('voices').upload(path, blob, { contentType: type, upsert: false });
      if (up.error) return toast('보내지 못했어요: ' + errMsg(up.error));
      const ins = await sb.from('voices').insert({
        family_id: S.me.family_id, sender_id: S.me.id, to_id: to === 'all' ? null : to, path, mime: type,
        duration_sec: Math.max(1, Math.min(MAX_REC, lenSec)), size_bytes: blob.size,
      });
      if (ins.error) { await sb.storage.from('voices').remove([path]); return toast('보내지 못했어요: ' + errMsg(ins.error)); }
      toast(toName(to) + '에게 목소리를 보냈어요');
      refresh();
    };
    r.stop();
  },
  play(id) {
    const v = S.voices.find(x => x.id === id); if (!v) return;
    if (S.playing === id) { audio.pause(); S.playing = null; return renderHome(); }
    if (!v.url) { toast('목소리를 불러오는 중이에요. 잠시 후 다시 눌러 주세요'); return refresh(); }
    audio.src = v.url;
    if (v.sender_id !== S.me.id && !S.listened.has(id)) {
      S.listened.add(id);
      sb.rpc('mark_listened', { p_voice: id }).then(({ error }) => { if (error) console.warn(error); });
    }
    audio.play().then(() => { S.playing = id; renderHome(); })
      .catch(() => toast('재생하지 못했어요. 이 폰에서 지원하지 않는 형식일 수 있어요'));
  },
  async deleteVoice(id) {
    const v = S.voices.find(x => x.id === id); if (!v) return;
    if (S.playing === id) { audio.pause(); S.playing = null; }
    const rm = await sb.storage.from('voices').remove([v.path]);
    if (rm.error) return toast('지우지 못했어요: ' + errMsg(rm.error));
    const { error } = await sb.rpc('delete_voice', { p_voice: id });
    if (error) return toast(errMsg(error));
    S.voices = S.voices.filter(x => x.id !== id); renderHome(); renderStore();
    toast('목소리를 지웠어요');
  },
  async setPhoto(file) {
    let blob;
    try { blob = await squareJpeg(file, 320); } catch (_) { return toast('이 사진은 열 수 없어요. 다른 사진을 골라 주세요'); }
    if (!blob) return toast('이 사진은 열 수 없어요. 다른 사진을 골라 주세요');
    toast('사진을 올리는 중…');
    const path = S.me.family_id + '/' + S.me.id + '.jpg';
    const up = await sb.storage.from('avatars').upload(path, blob, { contentType: 'image/jpeg', upsert: true, cacheControl: '60' });
    if (up.error) return toast('사진을 올리지 못했어요: ' + errMsg(up.error));
    const { error } = await sb.rpc('set_avatar', { p_has: true });
    if (error) return toast(errMsg(error));
    delete S.avatars[S.me.id];
    toast('프로필 사진을 바꿨어요'); await refresh();
  },
  async removePhoto() {
    const rm = await sb.storage.from('avatars').remove([S.me.family_id + '/' + S.me.id + '.jpg']);
    if (rm.error) return toast('지우지 못했어요: ' + errMsg(rm.error));
    const { error } = await sb.rpc('set_avatar', { p_has: false });
    if (error) return toast(errMsg(error));
    delete S.avatars[S.me.id];
    toast('프로필 사진을 지웠어요'); await refresh();
  },
  async createInvite() {
    const { data, error } = await sb.rpc('create_invite');
    if (error) return toast(errMsg(error));
    const row = Array.isArray(data) ? data[0] : data;
    S.sheet = { type: 'invite', code: row.code }; renderManage();
  },
  async updateMember(sh) {
    const name = (sh.name || '').trim();
    if (!name) return toast('이름을 적어 주세요');
    const { error } = await sb.rpc('update_member', { p_member: sh.id, p_name: name, p_region: sh.region, p_city: sh.city });
    if (error) return toast(errMsg(error));
    S.sheet = null; toast('저장했어요'); refresh();
  },
  async removeMember(id) {
    const m = memberOf(id);
    const { error } = await sb.rpc('remove_member', { p_member: id });
    if (error) return toast(errMsg(error));
    S.sheet = null; toast(m ? obj(m.name) + ' 내보냈어요' : '내보냈어요'); refresh();
  },
};

// ---------- 알림 (푸시) + 아이콘 숫자 ----------
const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
let swReg = null;
const b64ToBytes = b64 => { const p = '='.repeat((4 - b64.length % 4) % 4); const r = atob((b64 + p).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(r, c => c.charCodeAt(0)); };

function renderNotify() {
  const box = $('notifyCard');
  let html = '';
  if (isIOS && !standalone) {
    html = '<p>아이폰은 <b>홈 화면에 추가한 앱</b>에서만 알림을 받을 수 있어요. 공유 버튼 → 홈 화면에 추가 후, 해님 아이콘으로 열어 주세요.</p>';
  } else if (!pushSupported()) {
    html = '';
  } else if (Notification.permission === 'default') {
    html = '<p>가족이 안부를 묻거나 목소리를 보내면 <b>알림</b>으로 알려 드릴까요?</p><button class="btn btn-sun" id="notifyBtn">알림 켜기</button>';
  } else if (Notification.permission === 'denied') {
    html = '<p>알림이 꺼져 있어요. ' + (isIOS ? '폰 <b>설정 → 알림 → 별일없지</b>에서 켜 주세요.' : '폰 <b>설정 → 애플리케이션(앱) → 별일없지 → 알림</b>에서 켜 주세요.') + '</p>';
  }
  box.innerHTML = html;
  box.hidden = !html;
}

async function savePushSub(ask) {
  if (!pushSupported() || !swReg) return false;
  if (ask) {
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') { renderNotify(); return false; }
  } else if (Notification.permission !== 'granted') return false;
  try {
    let sub = await swReg.pushManager.getSubscription();
    if (!sub) sub = await swReg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(VAPID_PUBLIC) });
    const j = sub.toJSON();
    const { error } = await sb.rpc('save_push_sub', { p_endpoint: j.endpoint, p_p256dh: j.keys.p256dh, p_auth: j.keys.auth });
    if (error) throw error;
    return true;
  } catch (e) { console.error(e); if (ask) toast('알림을 켜지 못했어요. 잠시 후 다시 해 주세요'); return false; }
}

// 아이콘 숫자 = 아직 답 안 한 안부 + 아직 안 들은 목소리
function updateBadge() {
  if (!S.me || !('setAppBadge' in navigator)) return;
  const n = pendingAsks().length + unheardVoices().length;
  (n > 0 ? navigator.setAppBadge(n) : navigator.clearAppBadge()).catch(() => {});
}
// 앱을 열면 이미 뜬 알림은 정리
function clearShownNotifications() {
  if (swReg && swReg.getNotifications) swReg.getNotifications().then(ns => ns.forEach(n => n.close())).catch(() => {});
}

document.addEventListener('click', async e => {
  if (!e.target.closest('#notifyBtn')) return;
  const b = e.target.closest('#notifyBtn'); b.disabled = true;
  const ok = await savePushSub(true);
  b.disabled = false;
  if (ok) toast('알림을 켰어요. 가족 소식이 오면 알려 드릴게요');
  renderNotify();
});

async function loadAll() {
  const vSince = new Date(Date.now() - KEEP_DAYS * 86400000).toISOString();
  const aSince = new Date(Date.now() - ASK_DAYS * 86400000).toISOString();
  const [mem, voi, ask] = await Promise.all([
    sb.from('members').select('*').order('joined_at'),
    sb.from('voices').select('*').gte('created_at', vSince).order('created_at', { ascending: false }).limit(60),
    sb.from('asks').select('*').gte('created_at', aSince).order('created_at', { ascending: false }).limit(60),
  ]);
  for (const r of [mem, voi, ask]) if (r.error) throw r.error;
  const me = mem.data.find(m => m.id === S.me.id);
  if (!me) return false; // 내보내졌어요
  S.me = me; S.members = mem.data; S.asks = ask.data;
  // 프로필 사진 주소 (사진이 바뀐 사람만 새로 받아요)
  const needAva = mem.data.filter(m => m.avatar_path && (!S.avatars[m.id] || S.avatars[m.id].at !== m.avatar_at || S.avatars[m.id].got < Date.now() - 3 * 3600000));
  for (const id of Object.keys(S.avatars)) if (!mem.data.some(m => m.id === id && m.avatar_path)) delete S.avatars[id];
  if (needAva.length) {
    const { data, error } = await sb.storage.from('avatars').createSignedUrls(needAva.map(m => m.avatar_path), 6 * 3600);
    if (!error) data.forEach((d, i) => { if (d.signedUrl) S.avatars[needAva[i].id] = { url: d.signedUrl, at: needAva[i].avatar_at, got: Date.now() }; });
  }
  // 안부 목소리 주소
  const needG = mem.data.filter(m => m.greet_path && (!S.greets[m.id] || S.greets[m.id].at !== m.greet_at || S.greets[m.id].got < Date.now() - 3 * 3600000));
  for (const id of Object.keys(S.greets)) if (!mem.data.some(m => m.id === id && m.greet_path)) delete S.greets[id];
  if (needG.length) {
    const { data, error } = await sb.storage.from('greetings').createSignedUrls(needG.map(m => m.greet_path), 6 * 3600);
    if (!error) data.forEach((d, i) => { if (d.signedUrl) S.greets[needG[i].id] = { url: d.signedUrl, at: needG[i].greet_at, got: Date.now() }; });
  }
  if (ask.data.length) {
    const ans = await sb.from('answers').select('*').in('ask_id', ask.data.map(a => a.id));
    if (ans.error) throw ans.error;
    S.answers = ans.data;
  } else S.answers = [];

  // 음성 주소를 미리 받아 둬요 (아이폰은 누르는 순간 바로 재생해야 해서)
  const old = new Map(S.voices.map(v => [v.id, v]));
  const fresh = v => { const o = old.get(v.id); return o && o.url && o.urlAt > Date.now() - 3 * 3600000 ? o : null; };
  const need = voi.data.filter(v => !fresh(v));
  const urls = {};
  if (need.length) {
    const { data, error } = await sb.storage.from('voices').createSignedUrls(need.map(v => v.path), 6 * 3600);
    if (!error) data.forEach(d => { if (d.signedUrl) urls[d.path] = d.signedUrl; });
  }
  const lis = await sb.from('voice_listens').select('voice_id');
  if (!lis.error) S.listened = new Set(lis.data.map(x => x.voice_id));
  S.voices = voi.data.map(v => {
    const o = fresh(v);
    return o ? { ...v, url: o.url, urlAt: o.urlAt } : { ...v, url: urls[v.path] || null, urlAt: urls[v.path] ? Date.now() : 0 };
  });
  return true;
}

async function refresh() {
  try {
    const ok = await loadAll();
    if (!ok) {
      toast('가족방에서 나가졌어요. 다시 들어오려면 새 초대가 필요해요');
      if (channel) sb.removeChannel(channel);
      channel = null; S.me = null; $('tabs').hidden = true; $('home').hidden = true; $('manage').hidden = true;
      return showOnboard('join');
    }
    render();
    maybeGreet();
  } catch (e) { console.error(e); }
}
const scheduleReload = () => { clearTimeout(reloadTimer); reloadTimer = setTimeout(refresh, 400); };

// ---------- 처음 화면 ----------
const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const standalone = navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
document.querySelectorAll('[data-ios-tip]').forEach(el => { el.hidden = !(isIOS && !standalone); });

function regionPicker(box, state, prefix) {
  const draw = () => { box.innerHTML = regionFields(state, prefix).replace(/^<div class="f2">|<\/div>$/g, ''); };
  box.addEventListener('change', e => {
    if (e.target.dataset.k === 'region') { state.region = e.target.value; state.city = 0; draw(); }
    else if (e.target.dataset.k === 'city') state.city = +e.target.value;
  });
  draw();
}
const joinState = { region: '대한민국', city: 0 };
const createState = { region: '캐나다', city: 0 };
regionPicker(document.querySelector('[data-ob-region="join"]'), joinState, 'obJoin');
regionPicker(document.querySelector('[data-ob-region="create"]'), createState, 'obCreate');
document.querySelectorAll('[data-ob-switch]').forEach(b => b.addEventListener('click', () => showOnboard(b.dataset.obSwitch)));

function showOnboard(mode) {
  $('onboard').hidden = false; $('obLoading').hidden = true;
  $('obJoin').hidden = mode !== 'join'; $('obCreate').hidden = mode !== 'create';
}
function showLoading(text) { $('onboard').hidden = false; $('obLoading').hidden = false; $('obJoin').hidden = $('obCreate').hidden = true; $('obLoading').querySelector('p').textContent = text; }

async function busy(btn, fn) {
  if (btn.disabled) return;
  const t = btn.textContent; btn.disabled = true; btn.textContent = '잠시만요…';
  try { await fn(); } catch (e) { toast(errMsg(e)); }
  finally { btn.disabled = false; btn.textContent = t; }
}
async function ensureSession() {
  const { data: { session } } = await sb.auth.getSession();
  if (session) return session.user;
  const { data, error } = await sb.auth.signInAnonymously();
  if (error) throw error;
  return data.user;
}
$('obCreateBtn').addEventListener('click', e => busy(e.currentTarget, async () => {
  const name = $('obMyName').value.trim();
  if (!name) return toast('내 이름을 적어 주세요');
  await ensureSession();
  const { error } = await sb.rpc('create_family', { p_family_name: $('obFamName').value.trim(), p_my_name: name, p_region: createState.region, p_city: createState.city });
  if (error) throw error;
  toast('가족방을 만들었어요. 가족 편집에서 가족을 초대해 보세요');
  await boot();
}));
$('obJoinBtn').addEventListener('click', e => busy(e.currentTarget, async () => {
  const code = $('obCode').value.trim().toUpperCase();
  const name = $('obJoinName').value.trim();
  if (!/^[A-Z0-9]{6}$/.test(code)) return toast('초대 코드 6자리를 넣어 주세요');
  if (!name) return toast('표시 이름을 적어 주세요');
  await ensureSession();
  const { error } = await sb.rpc('join_family', { p_code: code, p_name: name, p_region: joinState.region, p_city: joinState.city });
  if (error) throw error;
  history.replaceState(null, '', location.pathname);
  toast('가족방에 들어왔어요');
  await boot();
}));

// ---------- 시작 ----------
async function boot() {
  const { data: { session } } = await sb.auth.getSession();
  let row = null;
  if (session) {
    const r = await sb.from('members').select('*').eq('user_id', session.user.id).maybeSingle();
    if (r.error) throw r.error;
    row = r.data;
  }
  if (!row) {
    const code = (new URLSearchParams(location.search).get('join') || '').toUpperCase();
    if (code) $('obCode').value = code;
    return showOnboard(code ? 'join' : 'create');
  }
  S.me = row; S.sheet = null;
  try { S.to = localStorage.getItem('byeolil-to'); } catch (_) {}
  await loadAll();
  $('onboard').hidden = true; $('tabs').hidden = false;
  render();
  maybeGreet();
  savePushSub(false); clearShownNotifications();

  if (channel) sb.removeChannel(channel);
  const f = 'family_id=eq.' + row.family_id;
  channel = sb.channel('family-' + row.family_id);
  for (const t of ['voices', 'members', 'asks', 'answers'])
    channel.on('postgres_changes', { event: '*', schema: 'public', table: t, filter: f }, scheduleReload);
  channel.subscribe();
}

async function start() {
  updateResult();
  if ('serviceWorker' in navigator) {
    try { swReg = await navigator.serviceWorker.register('sw.js'); } catch (e) { console.warn('서비스 워커 등록 실패', e); }
  }
  const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
  sb = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } });
  await boot();
  document.addEventListener('visibilitychange', () => { if (!document.hidden && S.me) { refresh(); clearShownNotifications(); } });
  setInterval(() => { if (S.me && !document.hidden) refresh(); }, 60000);
  setInterval(() => { if (S.me && !rec) renderHome(); }, 30000); // 시계·"몇 분 전" 갱신
}

start().catch(err => { console.error(err); showLoading('서버에 연결하지 못했어요. 인터넷 연결을 확인하고 다시 열어 주세요.'); });
