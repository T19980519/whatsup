// 별일없지? — 서버(Supabase) 연결 모드
// index.html 의 SUPABASE_URL / SUPABASE_KEY 가 채워져 있을 때만 동작해요.
// 화면 그리기는 index.html 의 render() 등을 그대로 쓰고, 여기서는 데이터만 채워요.

/* global SUPABASE_URL, SUPABASE_KEY, S, REGIONS, KEEP_DAYS, render, renderFamily, toast, LIVE */

if (SUPABASE_URL && SUPABASE_KEY) start().catch(err => {
  console.error(err);
  showLoading('서버에 연결하지 못했어요. 인터넷 연결을 확인하고 다시 열어 주세요.');
});

async function start() {
  const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
  const sb = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
  });
  document.body.classList.add('live');

  const $ = id => document.getElementById(id);
  const params = new URLSearchParams(location.search);
  const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;

  const errMsg = e => (e && (e.message || e.error_description)) || '잠시 후 다시 해 주세요';
  let me = null;           // 내 구성원 정보 (members 한 줄)
  let channel = null;
  let reloadTimer = null;

  // ---------- 로그인 (초대 코드 방식: 이 폰을 익명 계정으로 기억) ----------
  async function ensureSession() {
    const { data: { session } } = await sb.auth.getSession();
    if (session) return session.user;
    const { data, error } = await sb.auth.signInAnonymously();
    if (error) throw error;
    return data.user;
  }

  // ---------- 처음 화면 (가족방 만들기 / 들어가기) ----------
  function regionPicker(box, state) {
    const draw = () => {
      const cities = REGIONS[state.region];
      box.innerHTML =
        '<label class="f">사는 지역<select data-k="region">' +
          Object.keys(REGIONS).map(k => '<option' + (k === state.region ? ' selected' : '') + '>' + k + '</option>').join('') +
        '</select></label>' +
        '<label class="f">도시<select data-k="city">' +
          cities.map((c, i) => '<option value="' + i + '"' + (i === state.city ? ' selected' : '') + '>' + c[0] + '</option>').join('') +
        '</select></label>';
    };
    box.addEventListener('change', e => {
      if (e.target.dataset.k === 'region') { state.region = e.target.value; state.city = 0; draw(); }
      else if (e.target.dataset.k === 'city') state.city = +e.target.value;
    });
    draw();
  }

  const joinState = { region: '대한민국', city: 0, role: 'family' };
  const createState = { region: '캐나다', city: 0 };
  regionPicker(document.querySelector('[data-ob-region="join"]'), joinState);
  regionPicker(document.querySelector('[data-ob-region="create"]'), createState);
  document.querySelectorAll('[data-ios-tip]').forEach(el => { el.hidden = !(isIOS && !standalone); });
  document.querySelectorAll('[data-ob-role]').forEach(b => b.addEventListener('click', () => {
    joinState.role = b.dataset.obRole;
    document.querySelectorAll('[data-ob-role]').forEach(x => x.setAttribute('aria-pressed', x === b));
  }));
  document.querySelectorAll('[data-ob-switch]').forEach(b => b.addEventListener('click', () => showOnboard(b.dataset.obSwitch)));

  function showOnboard(mode) {
    setScreens(['onboard'], null);
    $('obLoading').hidden = true;
    $('obJoin').hidden = mode !== 'join';
    $('obCreate').hidden = mode !== 'create';
  }

  async function busy(btn, fn) {
    if (btn.disabled) return;
    const t = btn.textContent; btn.disabled = true; btn.textContent = '잠시만요…';
    try { await fn(); } catch (e) { toast(errMsg(e)); }
    finally { btn.disabled = false; btn.textContent = t; }
  }

  $('obCreateBtn').addEventListener('click', e => busy(e.currentTarget, async () => {
    const name = $('obMyName').value.trim();
    if (!name) return toast('내 이름을 적어 주세요');
    await ensureSession();
    const { error } = await sb.rpc('create_family', {
      p_family_name: $('obFamName').value.trim(), p_my_name: name,
      p_region: createState.region, p_city: createState.city,
    });
    if (error) throw error;
    toast('가족방을 만들었어요. 가족정리에서 가족을 초대해 보세요');
    await boot();
  }));

  $('obJoinBtn').addEventListener('click', e => busy(e.currentTarget, async () => {
    const code = $('obCode').value.trim().toUpperCase();
    const name = $('obJoinName').value.trim();
    if (!/^[A-Z0-9]{6}$/.test(code)) return toast('초대 코드 6자리를 넣어 주세요');
    if (!name) return toast('표시 이름을 적어 주세요');
    await ensureSession();
    const { error } = await sb.rpc('join_family', {
      p_code: code, p_name: name, p_as_parent: joinState.role === 'parent',
      p_region: joinState.region, p_city: joinState.city,
    });
    if (error) throw error;
    history.replaceState(null, '', location.pathname);
    toast('가족방에 들어왔어요');
    await boot();
  }));

  // ---------- 화면 전환 (내 역할에 맞는 화면만) ----------
  function setScreens(tabs, first) {
    const all = ['onboard', 'parent', 'me', 'family', 'manage'];
    const roles = document.querySelector('.roles');
    const visibleTabs = tabs.filter(t => t !== 'onboard');
    roles.hidden = visibleTabs.length < 2;
    roles.style.gridTemplateColumns = 'repeat(' + Math.max(visibleTabs.length, 1) + ',1fr)';
    document.querySelectorAll('.roles button').forEach(b => {
      b.hidden = !visibleTabs.includes(b.dataset.role);
      b.setAttribute('aria-selected', b.dataset.role === (first || tabs[0]));
    });
    all.forEach(id => { $(id).hidden = id !== (first || tabs[0]); });
  }

  function screensFor(role) {
    if (role === 'parent') return ['parent'];
    if (role === 'admin') return ['me', 'manage'];
    return ['family', 'manage'];
  }

  // ---------- 데이터 불러오기 ----------
  const fromRow = m => ({
    id: m.id, name: m.name, role: m.role, region: m.region, city: m.city,
    since: new Intl.DateTimeFormat('ko-KR', { month: 'long', day: 'numeric' }).format(new Date(m.joined_at)),
  });

  function whenText(d) {
    const mins = Math.round((Date.now() - d) / 60000);
    if (mins < 1) return '방금';
    if (mins < 60) return mins + '분 전';
    const hrs = Math.round(mins / 60);
    if (hrs < 24) return hrs + '시간 전';
    return new Intl.DateTimeFormat('ko-KR', { month: 'long', day: 'numeric' }).format(d);
  }

  async function loadAll() {
    const since = new Date(Date.now() - KEEP_DAYS * 86400000).toISOString();
    const [mem, voi, chk] = await Promise.all([
      sb.from('members').select('*').order('joined_at'),
      sb.from('voices').select('*').gte('created_at', since).order('created_at', { ascending: false }).limit(100),
      sb.from('checkins').select('checked_at').order('checked_at', { ascending: false }).limit(1),
    ]);
    for (const r of [mem, voi, chk]) if (r.error) throw r.error;

    me = mem.data.find(m => m.id === S.meId) || me;
    S.members = mem.data.map(fromRow);
    if (!S.members.some(m => m.id === S.meId)) return false; // 내보내졌어요

    // 음성 파일 주소를 미리 받아 둬요 (아이폰은 누르는 순간 바로 재생해야 해서)
    const old = new Map(S.msgs.map(m => [m.id, m]));
    const need = voi.data.filter(v => !(old.get(v.id) && old.get(v.id).url && old.get(v.id).urlAt > Date.now() - 3 * 3600000));
    let urls = {};
    if (need.length) {
      const { data, error } = await sb.storage.from('voices').createSignedUrls(need.map(v => v.path), 6 * 3600);
      if (!error) data.forEach(d => { if (d.signedUrl) urls[d.path] = d.signedUrl; });
    }
    S.msgs = voi.data.map(v => {
      const prev = old.get(v.id);
      const url = urls[v.path] || (prev && prev.url) || null;
      const created = new Date(v.created_at);
      return {
        id: v.id, from: v.sender_id, len: v.duration_sec, size: v.size_bytes, path: v.path,
        when: whenText(created), age: Math.floor((Date.now() - created) / 86400000),
        url, urlAt: urls[v.path] ? Date.now() : prev && prev.urlAt,
      };
    });
    S.lastCheck = chk.data[0] ? new Date(chk.data[0].checked_at) : null;
    return true;
  }

  function scheduleReload() {
    clearTimeout(reloadTimer);
    reloadTimer = setTimeout(refresh, 400);
  }

  async function refresh() {
    try {
      const ok = await loadAll();
      if (!ok) { toast('가족방에서 나가졌어요. 다시 들어오려면 새 초대가 필요해요'); return stopLive(); }
      render();
    } catch (e) { console.error(e); }
  }

  function stopLive() {
    if (channel) sb.removeChannel(channel);
    channel = null; LIVE = null; S.meId = null; me = null;
    showOnboard('join');
  }

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
      const code = (params.get('join') || '').toUpperCase();
      if (code) $('obCode').value = code;
      return showOnboard(code ? 'join' : 'create');
    }
    me = row; S.meId = row.id; S.sheet = null;
    await loadAll();
    LIVE = api;
    setScreens(screensFor(row.role));
    render();

    if (channel) sb.removeChannel(channel);
    const f = 'family_id=eq.' + row.family_id;
    channel = sb.channel('family-' + row.family_id)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'voices', filter: f }, scheduleReload)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'checkins', filter: f }, scheduleReload)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'members', filter: f }, scheduleReload)
      .subscribe();
  }

  document.addEventListener('visibilitychange', () => { if (!document.hidden && LIVE) refresh(); });
  setInterval(() => { if (LIVE && !document.hidden) refresh(); }, 60000);

  // ---------- 녹음 ----------
  let rec = null, chunks = [], stream = null, recMime = '';
  const pickMime = () => ['audio/mp4', 'audio/mp4;codecs=mp4a.40.2', 'audio/aac', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus']
    .find(t => window.MediaRecorder && MediaRecorder.isTypeSupported(t)) || '';

  async function startRec() {
    if (!window.MediaRecorder || !navigator.mediaDevices) { toast('이 브라우저는 녹음을 지원하지 않아요'); return false; }
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch (e) {
      toast('마이크를 쓸 수 있게 허락해 주세요'); return false;
    }
    recMime = pickMime();
    chunks = [];
    rec = new MediaRecorder(stream, recMime ? { mimeType: recMime, audioBitsPerSecond: 32000 } : undefined);
    rec.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
    rec.start(1000);
    return true;
  }

  function stopRec(lenSec) {
    if (!rec) return;
    const r = rec; rec = null;
    r.onstop = async () => {
      stream.getTracks().forEach(t => t.stop());
      const type = (r.mimeType || recMime || 'audio/webm').split(';')[0];
      const blob = new Blob(chunks, { type });
      if (blob.size < 1000) return toast('녹음이 너무 짧아요. 다시 해 주세요');
      const ext = type === 'audio/mp4' || type === 'audio/aac' ? 'm4a' : type === 'audio/ogg' ? 'ogg' : 'webm';
      const path = me.family_id + '/' + crypto.randomUUID() + '.' + ext;
      toast('보내는 중…');
      const up = await sb.storage.from('voices').upload(path, blob, { contentType: type, upsert: false });
      if (up.error) return toast('보내지 못했어요: ' + errMsg(up.error));
      const ins = await sb.from('voices').insert({
        family_id: me.family_id, sender_id: me.id, path, mime: type,
        duration_sec: Math.max(1, Math.min(180, lenSec)), size_bytes: blob.size,
      });
      if (ins.error) return toast('보내지 못했어요: ' + errMsg(ins.error));
      toast('목소리를 보냈어요');
      refresh();
    };
    r.stop();
  }

  // ---------- 재생 ----------
  const audio = new Audio();
  audio.preload = 'none';
  audio.addEventListener('ended', () => { S.playing = null; render(); });
  function play(id) {
    const m = S.msgs.find(x => x.id === id);
    if (!m) return;
    if (S.playing === id) { audio.pause(); S.playing = null; return render(); }
    if (!m.url) { toast('음성을 불러오는 중이에요. 잠시 후 다시 눌러 주세요'); return refresh(); }
    audio.src = m.url;
    audio.play().then(() => { S.playing = id; render(); })
      .catch(() => toast('재생하지 못했어요. 이 폰에서 지원하지 않는 형식일 수 있어요'));
  }

  // ---------- 안부·가족 관리 ----------
  async function checkIn() {
    const { data, error } = await sb.rpc('check_in');
    if (error) return toast(errMsg(error));
    S.lastCheck = new Date(data); render();
    const btn = $('checkBtn'); btn.classList.add('pop'); setTimeout(() => btn.classList.remove('pop'), 500);
    toast('안부가 가족 모두에게 전해졌어요');
  }

  async function createInvite() {
    const { data, error } = await sb.rpc('create_invite');
    if (error) return toast(errMsg(error));
    const row = Array.isArray(data) ? data[0] : data;
    S.sheet = { type: 'invite', code: row.code }; renderFamily();
  }

  async function updateMember(sh) {
    const name = (sh.name || '').trim();
    if (!name) return toast('이름을 적어 주세요');
    const { error } = await sb.rpc('update_member', {
      p_member: sh.id, p_name: name, p_role: sh.role, p_region: sh.region, p_city: sh.city,
    });
    if (error) return toast(errMsg(error));
    S.sheet = null; toast('저장했어요'); refresh();
  }

  async function removeMember(id) {
    const m = S.members.find(x => x.id === id);
    const { error } = await sb.rpc('remove_member', { p_member: id });
    if (error) return toast(errMsg(error));
    S.sheet = null; toast((m ? m.name : '') + '님을 내보냈어요'); refresh();
  }

  const api = { startRec, stopRec, play, checkIn, createInvite, updateMember, removeMember, refresh };
  await boot();
}

function showLoading(text) {
  const el = document.getElementById('obLoading');
  if (el) el.querySelector('p').textContent = text;
}
