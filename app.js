/* RN Passport · NCLEX daily mission board.
   Course data arrives encrypted (data.enc.json); progress lives in localStorage and can sync to a private GitHub gist. */
"use strict";

const LS_STATE = "rnp-state-v1", LS_KEY = "rnp-key-v1", LS_USER = "rnp-user";
const USERS = ["JUNE", "KIJ"];
let USER = null;
const stateKey = () => `${LS_STATE}-${USER}`;
const gistFile = () => `rn-passport-${USER}.json`;
const DEFAULT_START = "2026-11-23";
const PASS_DAILY = 0.7, PASS_PHASE = 0.65;
const DAILY_SIZE = 30;      // Mon-Fri quiz, untimed
const MIN_PER_Q = 2;        // Saturday exams are timed at NCLEX pace (~5 h / 150 items)
const PHASE_SIZE = 85, MOCK_SIZE = 85; // NCLEX minimum length
const INT = [0, 1, 2, 4, 8, 16];
const DIAG = [40, 45, 52, 58, 64, 70, 75, 82, 90, 95, 100, 105, 113, 120, 128, 141, 157, 164, 181, 186, 198, 253, 256, 276, 278, 279, 281, 289, 290, 298];
const DOW = ["จันทร์", "อังคาร", "พุธ", "พฤหัสบดี", "ศุกร์", "เสาร์"];

let D = null;      // decrypted course data
let Q = {};        // n -> question
let S = null;      // progress state
let PLAN = [];     // study days
let tab = "today", quiz = null, syncTimer = null;

/* ---------- utils ---------- */
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const ymd = (d) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
const parseYmd = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
const addDays = (s, n) => { const d = parseYmd(s); d.setDate(d.getDate() + n); return ymd(d); };
const today = () => ymd(new Date());
const thDate = (s) => parseYmd(s).toLocaleDateString("th-TH", { weekday: "short", day: "numeric", month: "short", year: "2-digit" });
const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const b64d = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const b64e = (u) => btoa(String.fromCharCode(...new Uint8Array(u)));
const fmtLeft = (ms) => { const t = Math.max(0, Math.ceil(ms / 1000)); const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), sec = t % 60; return (h ? h + ":" + String(m).padStart(2, "0") : m) + ":" + String(sec).padStart(2, "0"); };
function toast(t) { const el = $("#toast"); el.textContent = t; el.classList.add("show"); clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove("show"), 2600); }
function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { } }

/* ---------- unlock ---------- */
async function loadEnc() { const r = await fetch("data.enc.json", { cache: "no-cache" }); return r.json(); }
async function decryptWith(key, enc) {
  const buf = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64d(enc.iv) }, key, b64d(enc.ct));
  let text;
  if (enc.gz) text = await new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream("gzip"))).text();
  else text = new TextDecoder().decode(buf);
  return JSON.parse(text);
}
async function deriveKey(pass, enc) {
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(pass.trim().toUpperCase()), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", salt: b64d(enc.salt), iterations: enc.iter, hash: "SHA-256" }, base, { name: "AES-GCM", length: 256 }, true, ["decrypt"]);
}
async function boot() {
  let enc;
  try { enc = await loadEnc(); } catch (e) { $("#app").innerHTML = `<div class="boot">โหลดข้อมูลไม่สำเร็จ ตรวจอินเทอร์เน็ตแล้วรีเฟรชอีกครั้ง</div>`; return; }
  const raw = lsGet(LS_KEY), u = lsGet(LS_USER);
  if (raw && USERS.includes(u)) {
    USER = u;
    try {
      const key = await crypto.subtle.importKey("raw", b64d(raw), "AES-GCM", false, ["decrypt"]);
      return start(await decryptWith(key, enc));
    } catch (e) { /* key from an older build: ask again */ }
  }
  showLock(enc);
}
function showLock(enc, err, picked) {
  const sel = picked || lsGet(LS_USER) || "";
  $("#app").innerHTML = `<div class="lockscreen"><form class="card" id="lockForm">
    <span class="mono small muted">RN PASSPORT · NCLEX</span>
    <h2>เข้าสู่ระบบ</h2>
    <p class="muted small">เลือกชื่อผู้ใช้ แล้วใส่รหัสผ่าน ความคืบหน้าของแต่ละคนเก็บแยกกัน</p>
    <div class="btns" role="radiogroup" aria-label="ชื่อผู้ใช้">${USERS.map((u) => `<button type="button" class="btn ${u === sel ? "primary" : ""}" data-user="${u}" aria-pressed="${u === sel}" style="flex:1">${u}</button>`).join("")}</div>
    <input type="password" id="pass" inputmode="numeric" autocomplete="current-password" placeholder="รหัสผ่าน" required>
    ${err ? `<p class="small" style="color:var(--bad)">${esc(err)}</p>` : ""}
    <button class="btn primary block" type="submit">เปิด</button></form></div>`;
  let chosen = sel;
  document.querySelectorAll("[data-user]").forEach((b) => b.onclick = () => {
    chosen = b.dataset.user;
    document.querySelectorAll("[data-user]").forEach((x) => { const on = x.dataset.user === chosen; x.classList.toggle("primary", on); x.setAttribute("aria-pressed", on); });
  });
  $("#lockForm").onsubmit = async (e) => {
    e.preventDefault();
    if (!USERS.includes(chosen)) { showLock(enc, "กรุณาเลือกชื่อผู้ใช้ก่อน"); return; }
    const btn = e.target.querySelector("button[type=submit]"); btn.disabled = true; btn.textContent = "กำลังตรวจ…";
    try {
      const key = await deriveKey($("#pass").value, enc);
      const data = await decryptWith(key, enc);
      lsSet(LS_KEY, b64e(await crypto.subtle.exportKey("raw", key)));
      lsSet(LS_USER, chosen); USER = chosen;
      start(data);
    } catch (err) { showLock(enc, "รหัสผ่านไม่ถูกต้อง ลองใหม่อีกครั้ง", chosen); }
  };
}

/* ---------- state ---------- */
function freshState() { return { v: 1, updated: 0, start: DEFAULT_START, days: {}, qs: {}, sync: { token: "", gist: "" } }; }
function loadState() {
  try {
    let r = lsGet(stateKey());
    if (!r && lsGet(LS_STATE)) { r = lsGet(LS_STATE); try { localStorage.removeItem(LS_STATE); } catch (e) { } } // progress saved before user IDs existed
    if (r) return Object.assign(freshState(), JSON.parse(r));
  } catch (e) { }
  return freshState();
}
function save(push = true) {
  S.updated = Date.now();
  lsSet(stateKey(), JSON.stringify(S));
  if (push && S.sync.token) { clearTimeout(syncTimer); syncTimer = setTimeout(syncPush, 2000); }
}

/* ---------- plan ---------- */
let PHASE_TAGS = {};
const REVIEW_MODS = ["p1review", "review", "mock"];
function buildPlan() {
  PLAN = []; PHASE_TAGS = {};
  const push = (week, dow, m, missions, label) => PLAN.push({ idx: PLAN.length, week, dow, date: addDays(S.start, week * 7 + dow), mod: m.id, phase: m.phase, missions, label });
  // flatten modules into study days (Mon-Fri); a module may end mid-week
  const learned = [], seq = [];
  for (const m of D.modules) {
    const pages = [];
    for (const f of m.reads) { const P = D.files[f].pages; for (let p = 1; p <= P; p++) pages.push([f, p]); }
    const per = Math.ceil(pages.length / m.days) || 0;
    if (!REVIEW_MODS.includes(m.id)) { learned.push(m.id); (PHASE_TAGS[m.phase] = PHASE_TAGS[m.phase] || []).push(m.id); }
    m._tagsSoFar = learned.slice();
    for (let d = 0; d < m.days; d++) {
      const reads = [];
      for (const [f, p] of pages.slice(d * per, (d + 1) * per)) { const last = reads[reads.length - 1]; if (last && last.f === f && last.b === p - 1) last.b = p; else reads.push({ f, a: p, b: p }); }
      seq.push({ m, reads, last: d === m.days - 1 });
    }
  }
  const weeks = Math.ceil(seq.length / 5);
  for (let w = 0; w < weeks; w++) {
    const days = seq.slice(w * 5, w * 5 + 5), weekDays = [];
    days.forEach((s, d) => {
      const ms = [];
      if (s.reads.length) ms.push({ k: "read", reads: s.reads });
      else if (s.m.id === "p1review") ms.push({ k: "check", text: "ทบทวนสรุปของทุกหัวข้อในเฟส 1 จากโน้ตและข้อที่เคยผิด" });
      if (PLAN.length === 0) ms.push({ k: "quiz", kind: "diag", size: DIAG.length, need: 0, title: `Diagnostic ${DIAG.length} ข้อ (วัดพื้นฐานก่อนเริ่ม)` });
      else ms.push({ k: "quiz", kind: "daily", size: DAILY_SIZE, need: PASS_DAILY });
      ms.push({ k: "review" });
      weekDays.push(PLAN.length);
      push(w, d, s.m, ms, s.m.name);
    });
    const wsize = DAILY_SIZE * days.length, names = [...new Set(days.map((s) => s.m.name))];
    const sat = [{ k: "quiz", kind: "weekly", size: wsize, need: PASS_DAILY, weekDays, title: `สอบรวบยอดประจำสัปดาห์ · ${wsize} ข้อ` }];
    for (const s of days) if (s.last && s.m.phaseEnd) sat.push({ k: "quiz", kind: "phase", phase: s.m.phase, size: PHASE_SIZE, need: PASS_PHASE, title: `สอบปลายเฟส ${s.m.phase} · ${PHASE_SIZE} ข้อ` });
    if (days.some((s) => s.m.id === "mock")) sat.push({ k: "quiz", kind: "mock", size: MOCK_SIZE, need: PASS_PHASE, title: `Mock exam · ${MOCK_SIZE} ข้อ` });
    for (const x of sat) x.minutes = x.size * MIN_PER_Q;
    push(w, 5, days[days.length - 1].m, [...sat, { k: "review" }], names.join(" + "));
  }
}
const modById = (id) => D.modules.find((m) => m.id === id);
function dayRec(i) { const r = S.days[i] || (S.days[i] = {}); r.q = r.q || {}; return r; }
const quizRec = (dayIdx, mi) => (S.days[dayIdx] && S.days[dayIdx].q && S.days[dayIdx].q[mi]) || null;
function missionDone(day, mi) {
  const r = S.days[day.idx] || {}, ms = day.missions[mi];
  if (ms.k === "read") return !!r.read;
  if (ms.k === "check") return !!r.check;
  if (ms.k === "quiz") { const q = quizRec(day.idx, mi); return !!(q && q.passed); }
  if (ms.k === "review") return !!r.reviewDone;
  return false;
}
const dayDone = (day) => day.missions.every((ms, mi) => missionDone(day, mi));
function currentIdx() { for (const d of PLAN) if (!dayDone(d)) return d.idx; return PLAN.length - 1; }

/* ---------- question picking ---------- */
function poolsFor(day) {
  if (day.mod === "mock") return ["late", "mock"];
  return day.phase >= 4 ? ["daily", "late"] : ["daily"]; // Q302-423 join from phase 4
}
function stat(n) { return S.qs[n] || { seen: 0, right: 0, wrong: 0, box: 0, due: "", last: null }; }
function rankAndTake(cands, size, boost) {
  const sc = (q) => { const st = stat(q.n); let s = Math.random() + (boost ? boost(q) : 0);
    if (!st.seen) s += 1.5; else if (st.last === false) s += 1.2; else s -= 1; return s; };
  return cands.map((q) => [sc(q), q.n]).sort((a, b) => b[0] - a[0]).slice(0, size).map((x) => x[1]);
}
function pickQuestions(day, ms, mi) {
  if (ms.kind === "diag") return DIAG.filter((n) => Q[n]);
  if (ms.kind === "weekly") {
    // the exact questions served in this week's Mon-Fri quizzes; same set on every retake
    const rec = quizRec(day.idx, mi);
    if (rec && rec.set) return shuffle(rec.set.slice());
    const set = [];
    for (const di of ms.weekDays) { const dq = quizRec(di, PLAN[di].missions.findIndex((x) => x.k === "quiz")); for (const n of (dq && dq.list) || []) if (!set.includes(n)) set.push(n); }
    if (set.length < ms.size) for (const n of pickQuestions(day, { kind: "daily", size: ms.size * 2 })) { if (set.length >= ms.size) break; if (!set.includes(n)) set.push(n); }
    dayRec(day.idx).q[mi] = Object.assign(rec || { attempts: 0, best: 0, passed: false }, { set: set.slice(0, ms.size) });
    return shuffle(set.slice(0, ms.size));
  }
  if (ms.kind === "phase") {
    const tags = PHASE_TAGS[ms.phase] || [], pools = ms.phase >= 4 ? ["daily", "late"] : ["daily"];
    const cands = D.questions.filter((q) => pools.includes(q.pool) && (ms.phase === 5 || q.tags.some((t) => tags.includes(t))));
    return rankAndTake(cands.length >= ms.size ? cands : D.questions.filter((q) => pools.includes(q.pool)), ms.size);
  }
  if (ms.kind === "mock") return rankAndTake(D.questions.filter((q) => q.pool === "mock" || q.pool === "late"), ms.size, (q) => (q.pool === "mock" ? 1 : 0));
  const mod = modById(day.mod), pools = poolsFor(day);
  const cur = mod && !["p1review", "review", "mock"].includes(mod.id) ? [mod.id] : [];
  const sofar = (mod && mod._tagsSoFar) || [];
  const all = D.questions.filter((q) => pools.includes(q.pool));
  const score = (q) => {
    const st = stat(q.n), inCur = cur.length && q.tags.some((t) => cur.includes(t)), inSoFar = q.tags.some((t) => sofar.includes(t));
    let s = Math.random();
    if (ms.kind === "mock" || day.mod === "review") s += 2;
    else if (inCur) s += 4; else if (inSoFar) s += 2; else s += 0.3;
    if (!st.seen) s += 1.5; else if (st.last === false) s += 1.2; else s -= 1;
    return s;
  };
  return all.map((q) => [score(q), q.n]).sort((a, b) => b[0] - a[0]).slice(0, ms.size).map((x) => x[1]);
}
function dueReview() {
  const t = today();
  return Object.entries(S.qs).filter(([n, st]) => st.box > 0 && st.due && st.due <= t && Q[n]).map(([n]) => +n).slice(0, 15);
}
function grade(q, sel) {
  if (q.t === "self") return sel === true;
  const a = [...q.ans].sort().join(","), b = [...sel].sort().join(",");
  return a === b;
}
function recordAnswer(n, ok, isReview) {
  const st = Object.assign(stat(n), {});
  st.seen++; st.last = ok;
  if (ok) { st.right++; if (st.box > 0) { st.box = Math.min(5, st.box + 1); st.due = addDays(today(), INT[st.box]); if (isReview && st.box >= 4) st.box = 0; } }
  else { st.wrong++; st.box = 1; st.due = addDays(today(), 1); }
  S.qs[n] = st;
}

/* ---------- views ---------- */
function render() {
  if (quiz) return renderQuiz();
  const v = tab === "today" ? viewToday() : tab === "plan" ? viewPlan() : tab === "review" ? viewReviewTab() : tab === "stats" ? viewStats() : viewSettings();
  $("#app").innerHTML = `<main class="wrap">${v}</main>${nav()}`;
}
function nav() {
  const items = [["today", "วันนี้", '<path d="M4 6h16M4 12h16M4 18h10"/>'], ["plan", "แผน", '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M8 3v4M16 3v4M4 10h16"/>'],
    ["review", "ข้อผิด", '<path d="M12 4v10M12 18v.5"/><circle cx="12" cy="12" r="9.5"/>'], ["stats", "สถิติ", '<path d="M5 19V11M12 19V5M19 19v-6"/>'], ["settings", "ตั้งค่า", '<circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"/>']];
  return `<nav class="nav">${items.map(([k, l, p]) => `<button data-tab="${k}" ${tab === k ? 'aria-current="page"' : ""}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${p}</svg>${l}</button>`).join("")}</nav>`;
}
function header(day) {
  const ci = currentIdx(), doneCount = PLAN.filter(dayDone).length;
  const calIdx = PLAN.findIndex((d) => d.date >= today());
  const lag = calIdx < 0 ? 0 : calIdx - ci;
  const status = lag > 0 ? `<span class="pill bad">ช้ากว่าแผน ${lag} วัน</span>` : lag < 0 ? `<span class="pill ok">เร็วกว่าแผน ${-lag} วัน</span>` : `<span class="pill ok">ตรงตามแผน</span>`;
  const examDate = PLAN[PLAN.length - 1].date;
  return `<header class="pass"><div class="row"><span class="eyebrow">RN Passport · ${esc(USER)}</span>${status}</div>
    <h1>วันที่ ${day.idx + 1} · สัปดาห์ ${day.week + 1}</h1>
    <div class="row small"><span>${esc(day.label)}</span><span class="mono">${thDate(day.date)}</span></div>
    <div class="bar"><i style="width:${(doneCount / PLAN.length) * 100}%"></i></div>
    <div class="row small"><span>ผ่านแล้ว ${doneCount}/${PLAN.length} วัน</span><span>เป้าสอบ NCLEX ≈ ${parseYmd(examDate).toLocaleDateString("th-TH", { month: "short", year: "numeric" })}</span></div></header>`;
}
function viewToday() {
  const ci = currentIdx(), day = PLAN[ci], rec = dayRec(ci);
  let h = header(day);
  if (new Date().getDay() === 0) h += `<section class="card"><b>วันอาทิตย์: วันพัก</b><span class="small muted">ถ้ายังมีภารกิจค้าง ทำต่อได้ ไม่บังคับ</span></section>`;
  if (day.date > today()) h += `<section class="card"><span class="small">คุณทำล่วงหน้าแผนอยู่ ภารกิจนี้ตามปฏิทินคือ ${thDate(day.date)}</span></section>`;
  day.missions.forEach((ms, i) => { h += missionCard(day, ms, i, rec); });
  const next = PLAN[ci + 1];
  if (next) h += `<section class="card locked"><span class="mono small muted">🔒 พรุ่งนี้ · ${thDate(next.date)}</span><b>${esc(next.label)}</b><span class="small muted">ปลดล็อกเมื่อผ่านภารกิจวันนี้ครบทุกข้อ</span></section>`;
  return h;
}
function missionCard(day, ms, mi, rec) {
  const num = mi + 1, done = missionDone(day, mi);
  let title = "", body = "", act = "";
  if (ms.k === "read") {
    title = `อ่านเนื้อหา: ${esc(day.label)}`;
    body = `<div class="reads">${ms.reads.map((r) => { const F = D.files[r.f];
      return `<div class="read"><span><b>${esc(F.title)}</b><br><span class="small muted">โฟลเดอร์ ${esc(F.folder)}</span></span><span class="pill dim tnum">หน้า ${r.a}${r.b !== r.a ? "–" + r.b : ""} / ${F.pages}</span></div>`; }).join("")}</div>`;
    act = done ? `<span class="pill ok">✓ อ่านจบแล้ว</span>` : `<button class="btn primary" data-act="read">✓ อ่านจบแล้ว</button>`;
  } else if (ms.k === "check") {
    title = "ภารกิจ"; body = `<p>${esc(ms.text)}</p>`;
    act = done ? `<span class="pill ok">✓ ทำแล้ว</span>` : `<button class="btn primary" data-act="check">✓ ทำแล้ว</button>`;
  } else if (ms.k === "quiz") {
    const q = quizRec(day.idx, mi);
    title = ms.title || (ms.kind === "diag" ? `Diagnostic ${ms.size} ข้อ` : `ข้อสอบ ${esc(day.label)} · ${ms.size} ข้อ`);
    const scope = ms.kind === "weekly" ? "ข้อสอบทั้งหมดที่ทำในวันจันทร์–ศุกร์ของสัปดาห์นี้ · " : ms.kind === "phase" ? `ครอบคลุมทุกหัวข้อในเฟส ${ms.phase} · ` : ms.kind === "mock" ? "ข้อสอบชุดสำรองสำหรับ Mock · " : "";
    const need = scope + (ms.need ? `ต้องได้ ≥ ${Math.round(ms.need * 100)}%` : "ทำให้ครบทุกข้อ") + (ms.minutes ? ` · ⏱ จับเวลา ${ms.minutes} นาที (2 นาที/ข้อ แบบ NCLEX)` : " · ไม่จับเวลา");
    body = `<p class="small muted">${need}${q && q.attempts ? ` · ทำไปแล้ว ${q.attempts} ครั้ง · คะแนนดีสุด ${Math.round(q.best * 100)}%` : ""}</p>`;
    act = done ? `<span class="pill ok">✓ ผ่าน ${Math.round(q.best * 100)}%</span> <button class="btn ghost" data-act="quiz" data-mi="${mi}">ทำอีกรอบ</button>`
      : `<button class="btn primary" data-act="quiz" data-mi="${mi}">${q && q.attempts ? (ms.kind === "weekly" ? "สอบใหม่ (ชุดเดิม สลับลำดับ)" : "ทำชุดใหม่") : "เริ่มทำ"}${ms.minutes ? ` · ⏱ ${ms.minutes} นาที` : ""}</button>`;
  } else if (ms.k === "review") {
    const due = dueReview();
    title = "ทบทวนข้อที่เคยผิด";
    if (!due.length && !done) { rec.reviewDone = true; save(false); return missionCard(day, ms, mi, rec); }
    body = `<p class="small muted">${done ? "ทบทวนครบแล้ว" : `มี ${due.length} ข้อที่ถึงรอบทบทวนวันนี้`}</p>`;
    act = done ? `<span class="pill ok">✓ ครบแล้ว</span>` : `<button class="btn primary" data-act="review">เริ่มทบทวน</button>`;
  }
  const fq = ms.k === "quiz" && quizRec(day.idx, mi), fail = fq && fq.attempts > 0 && !fq.passed;
  return `<section class="card mission ${done ? "done" : fail ? "fail" : ""}"><div class="ic">${done ? "✓" : num}</div><div style="display:grid;gap:8px;min-width:0"><h3>${title}</h3>${body}<div class="btns">${act}</div></div></section>`
    + (num === day.missions.length && dayDone(day) ? dayDoneCard(day) : "");
}
function dayDoneCard(day) {
  const next = PLAN[day.idx + 1];
  return `<section class="card daydone"><div class="stamp">PASSED<br>DAY ${day.idx + 1}</div><h2>ผ่านภารกิจวันนี้แล้ว</h2>${next ? `<p class="small">วันถัดไปปลดล็อกแล้ว: ${esc(next.label)} (${thDate(next.date)})</p>` : ""}</section>`;
}
function viewPlan() {
  const ci = currentIdx(); let h = `<section class="card"><h2>แผน ${Math.max(...PLAN.map((d) => d.week)) + 1} สัปดาห์</h2><p class="small muted">เริ่ม ${thDate(S.start)} · จ.–ส. · วงสีเขียว = ผ่าน, กรอบสีฟ้า = วันนี้</p></section><section class="card">`;
  const weeks = {}; PLAN.forEach((d) => (weeks[d.week] = weeks[d.week] || []).push(d));
  for (const [w, days] of Object.entries(weeks)) {
    h += `<div class="week" ${+w === PLAN[ci].week ? 'id="curweek"' : ""}><div class="row" style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap"><b>สัปดาห์ ${+w + 1} · ${esc(days[0].label)}</b><span class="small muted mono">${thDate(days[0].date)}</span></div>
    <div class="dots">${days.map((d) => `<span class="dot ${dayDone(d) ? "done" : d.idx === ci ? "cur" : ""} ${d.dow === 5 ? "sat" : ""}" title="${thDate(d.date)}">${DOW[d.dow].slice(0, 2)}</span>`).join("")}</div></div>`;
  }
  return h + `</section>`;
}
function viewReviewTab() {
  const wrong = Object.entries(S.qs).filter(([, s]) => s.box > 0).map(([n]) => +n);
  const due = dueReview();
  return `<section class="card"><h2>ข้อที่เคยผิด</h2><p class="small muted">ข้อที่ตอบผิดจะกลับมาให้ทบทวนตามรอบ 1 → 2 → 4 → 8 → 16 วัน ตอบถูกต่อเนื่องจะหลุดออกจากรายการ</p>
    <div class="statgrid"><div class="stat"><b class="tnum">${wrong.length}</b>ข้อในรายการ</div><div class="stat"><b class="tnum">${due.length}</b>ถึงรอบวันนี้</div></div>
    <div class="btns"><button class="btn primary" data-act="practice" ${wrong.length ? "" : "disabled"}>ฝึกข้อที่ผิดทั้งหมด (สูงสุด 20 ข้อ)</button></div></section>`;
}
function viewStats() {
  const seen = Object.values(S.qs), tot = seen.reduce((a, s) => a + s.seen, 0), right = seen.reduce((a, s) => a + s.right, 0);
  const byMod = D.modules.filter((m) => !["p1review", "review", "mock"].includes(m.id)).map((m) => {
    let r = 0, t = 0; for (const q of D.questions) if (q.tags.includes(m.id) && S.qs[q.n]) { r += S.qs[q.n].right; t += S.qs[q.n].seen; }
    return { m, r, t };
  });
  const diagRec = quizRec(0, 1);
  return `<section class="card"><h2>สถิติ</h2><div class="statgrid">
    <div class="stat"><b class="tnum">${PLAN.filter(dayDone).length}</b>วันที่ผ่าน</div>
    <div class="stat"><b class="tnum">${tot}</b>ข้อที่ทำทั้งหมด</div>
    <div class="stat"><b class="tnum">${tot ? Math.round((right / tot) * 100) : 0}%</b>ความแม่นยำรวม</div>
    <div class="stat"><b class="tnum">${Object.keys(S.qs).length}/500</b>ข้อที่เคยเห็น</div></div></section>
    <section class="card"><h3>ความแม่นยำรายโมดูล</h3>${byMod.map(({ m, r, t }) => `<div class="mrow"><span>${esc(m.name)}</span><span class="mini"><i style="width:${t ? (r / t) * 100 : 0}%"></i></span><span class="tnum small">${t ? Math.round((r / t) * 100) + "%" : "–"}</span></div>`).join("")}</section>
    ${diagRec ? `<section class="card"><h3>Diagnostic (สัปดาห์แรก)</h3><p>คะแนน ${Math.round(diagRec.best * 100)}% จาก ${DIAG.length} ข้อ</p></section>` : ""}`;
}
function viewSettings() {
  return `<section class="card"><h2>ตั้งค่า</h2>
    <label for="startDate">วันเริ่มแผน (ต้องเป็นวันจันทร์)</label><input type="date" id="startDate" value="${S.start}">
    <div class="btns"><button class="btn" data-act="saveStart">บันทึกวันเริ่ม</button></div></section>
    <section class="card"><h3>ซิงก์ iPad ↔ มือถือ (GitHub Gist)</h3>
    <p class="small muted">สร้าง token ที่ github.com → Settings → Developer settings → Personal access tokens → <b>Fine-grained</b> หรือ classic โดยเลือกสิทธิ์ <b>gist</b> อย่างเดียว แล้ววางที่นี่ ทำครั้งเดียวต่อเครื่อง ความคืบหน้าจะเก็บใน secret gist ของคุณ</p>
    <input type="password" id="token" placeholder="ghp_… หรือ github_pat_…" value="${esc(S.sync.token)}">
    <div class="btns"><button class="btn primary" data-act="saveToken">บันทึกและซิงก์</button><button class="btn" data-act="syncNow" ${S.sync.token ? "" : "disabled"}>ซิงก์ตอนนี้</button></div>
    <p class="small muted" id="syncMsg">${S.sync.gist ? "เชื่อมกับ gist แล้ว" : "ยังไม่ได้เชื่อม"}</p></section>
    <section class="card"><h3>สำรอง / ย้ายข้อมูล</h3><p class="small muted">คัดลอกรหัสนี้ไปวางในเครื่องอื่น หรือเก็บไว้กันข้อมูลหาย</p>
    <textarea id="backup" spellcheck="false"></textarea><div class="btns"><button class="btn" data-act="exportB">สร้างรหัสสำรอง</button><button class="btn" data-act="importB">นำเข้ารหัส</button></div></section>
    <section class="card"><h3>ผู้ใช้: ${esc(USER)}</h3><p class="small muted">ออกจากระบบเพื่อสลับผู้ใช้ ความคืบหน้าของแต่ละคนยังอยู่ครบ</p><div class="btns"><button class="btn" data-act="forget">ออกจากระบบ / สลับผู้ใช้</button></div></section>`;
}

/* ---------- quiz ---------- */
let timerTick = null;
function openQuiz(kind, list, opts = {}) {
  quiz = { kind, list, i: 0, sel: [], checked: false, results: [], ...opts };
  clearInterval(timerTick);
  if (opts.minutes) {
    quiz.deadline = Date.now() + opts.minutes * 60000;
    timerTick = setInterval(() => {
      if (!quiz || !quiz.deadline) { clearInterval(timerTick); return; }
      const left = quiz.deadline - Date.now(), el = document.getElementById("qtimer");
      if (left <= 0) { clearInterval(timerTick); quiz.timeUp = true; quiz.i = quiz.list.length; renderQuiz(); return; }
      if (el) { el.textContent = fmtLeft(left); el.classList.toggle("low", left < 5 * 60000); }
    }, 1000);
  }
  render();
}
function explain(q) {
  const tag = (src) => `<span class="src">${src === "claude" ? "· เขียนโดย Claude" : "· จากเฉลยของผู้สอน"}</span>`;
  const whySrc = q.whySrc || (q.src === "official" ? "official" : "claude");
  return `<section class="card ex"><h3>📌 โจทย์ถามอะไร ${tag(q.thSrc)}</h3><p>${esc(q.th || "—")}</p></section>
    <section class="card ex"><h3>✅ ทำไมคำตอบเป็นข้อนี้ ${tag(whySrc)}</h3><div class="why">${esc(q.why || "—")}</div></section>
    ${q.whyAdd ? `<section class="card ex"><h3>🇹🇭 อธิบายเพิ่มเติม ${tag("claude")}</h3><div class="why">${esc(q.whyAdd)}</div></section>` : ""}
    <section class="card ex tech"><h3>💡 เทคนิคหาคำตอบ</h3>${(q.tech || []).map((t) => `<p>${esc(t)}</p>`).join("")}</section>`;
}
function renderQuiz() {
  const z = quiz;
  if (z.i >= z.list.length) return renderQuizEnd();
  const q = Q[z.list[z.i]];
  const multi = q.t === "sata";
  let h = `<div class="quiz"><div class="wrap"><div class="qtop"><button class="btn ghost" data-act="qclose">✕ Exit</button>${z.deadline ? `<span class="timer mono" id="qtimer">${fmtLeft(z.deadline - Date.now())}</span>` : ""}<span class="mono small">${z.i + 1}/${z.list.length}</span></div>
    <div class="qprog"><i style="width:${(z.i / z.list.length) * 100}%"></i></div>
    <section class="card"><span class="src">Question ${q.n}${multi ? " · Select all that apply" : ""}</span><div class="stem">${esc(q.stem)}</div></section>`;
  if (q.t === "self") {
    h += z.checked ? `<section class="card"><b>Answer key</b><div class="why">${esc(q.key || "ดูคำอธิบายด้านล่าง")}</div></section>${explain(q)}
      <div class="btns"><button class="btn primary" data-act="selfmark" data-v="1">✓ I got it right</button><button class="btn" data-act="selfmark" data-v="0">✗ I got it wrong</button></div>`
      : `<p class="small muted">NGN item (matrix / cloze / highlight): work out your answer, then reveal the key and mark yourself.</p><button class="btn primary block" data-act="reveal">Reveal answer</button>`;
  } else {
    h += `<div class="opts">${q.opts.map((o, i) => {
      let c = "opt"; if (z.sel.includes(i)) c += " sel";
      if (z.checked) { if (q.ans.includes(i)) c += " right"; else if (z.sel.includes(i)) c += " wrong"; }
      return `<button class="${c}" data-act="pick" data-i="${i}" ${z.checked ? "disabled" : ""}><span class="k">${String.fromCharCode(65 + i)}</span><span>${esc(o)}</span></button>`; }).join("")}</div>`;
    if (z.checked) {
      const ok = z.results[z.results.length - 1];
      h += `<section class="card"><span class="verdict bad">✗ Incorrect</span><span>Correct answer: <b>${q.ans.map((a) => String.fromCharCode(65 + a) + ". " + esc(q.opts[a])).join("<br>")}</b></span></section>${explain(q)}
        <button class="btn primary block" data-act="qnext">${z.i + 1 < z.list.length ? "Next →" : "See results"}</button>`;
    } else h += `<button class="btn primary block" data-act="qcheck" ${z.sel.length ? "" : "disabled"}>Submit</button>`;
  }
  $("#app").innerHTML = h + `</div></div>`;
}
function renderQuizEnd() {
  const z = quiz, right = z.results.filter(Boolean).length, pct = z.list.length ? right / z.list.length : 0;
  const need = z.need ?? 0, passed = need ? pct >= need : true;
  if (!z.finished) {
    z.finished = true; clearInterval(timerTick);
    if (z.day != null) {
      const rec = dayRec(z.day);
      if (z.kind === "review") rec.reviewDone = true;
      else { const q = rec.q[z.mi] || { attempts: 0, best: 0, passed: false }; q.attempts++; q.best = Math.max(q.best, pct); if (passed && !q.passed) q.list = z.list.slice(); q.passed = q.passed || passed; rec.q[z.mi] = q; }
    }
    save();
  }
  const msg = (z.timeUp ? "⏱ Time is up · " : "") + (z.kind === "review" ? "Review complete" : passed ? "PASSED" : `NOT PASSED · you need ≥ ${Math.round(need * 100)}%`);
  $("#app").innerHTML = `<div class="quiz"><div class="wrap"><section class="card" style="text-align:center;gap:14px">
    <span class="mono small muted">${esc(z.title || "ผลการทำ")}</span><div class="score tnum">${Math.round(pct * 100)}%</div><p>${right} / ${z.list.length} correct</p>
    <span class="verdict ${passed ? "ok" : "bad"}">${msg}</span>
    ${!passed && z.kind !== "review" ? `<p class="small muted">${z.kind === "weekly" ? "Retake the same 150 questions in a new order until you pass." : "Take a new set until you pass."} Every missed item is now in your review list.</p>` : ""}
    <button class="btn primary block" data-act="qdone">Back to missions</button></section></div></div>`;
}

/* ---------- sync (gist) ---------- */
const GH = "https://api.github.com";
const ghHeaders = () => ({ Authorization: `Bearer ${S.sync.token}`, Accept: "application/vnd.github+json" });
async function ensureGist() {
  if (S.sync.gist) return S.sync.gist;
  const r = await fetch(`${GH}/gists?per_page=100`, { headers: ghHeaders() });
  if (!r.ok) throw new Error(r.status === 401 ? "token ไม่ถูกต้อง" : "เชื่อม GitHub ไม่สำเร็จ");
  const found = (await r.json()).find((g) => g.files && g.files[gistFile()]);
  if (found) { S.sync.gist = found.id; return found.id; }
  const c = await fetch(`${GH}/gists`, { method: "POST", headers: ghHeaders(), body: JSON.stringify({ public: false, description: `RN Passport progress · ${USER}`, files: { [gistFile()]: { content: JSON.stringify(progressOnly()) } } }) });
  if (!c.ok) throw new Error("สร้าง gist ไม่สำเร็จ (token ต้องมีสิทธิ์ gist)");
  S.sync.gist = (await c.json()).id; return S.sync.gist;
}
const progressOnly = () => ({ v: S.v, updated: S.updated, start: S.start, days: S.days, qs: S.qs });
async function syncPull() {
  const id = await ensureGist();
  const r = await fetch(`${GH}/gists/${id}`, { headers: ghHeaders(), cache: "no-store" });
  if (!r.ok) throw new Error("ดึงข้อมูลไม่สำเร็จ");
  const g = await r.json(), f = g.files[gistFile()];
  if (!f) throw new Error("ไม่พบไฟล์ของผู้ใช้นี้ใน gist");
  let content = f.content;
  if (f.truncated) content = await (await fetch(f.raw_url)).text();
  const remote = JSON.parse(content || "{}");
  if ((remote.updated || 0) > (S.updated || 0)) { Object.assign(S, remote); lsSet(stateKey(), JSON.stringify(S)); buildPlan(); return "pulled"; }
  return "kept";
}
async function syncPush() {
  try {
    const id = await ensureGist();
    const r = await fetch(`${GH}/gists/${id}`, { method: "PATCH", headers: ghHeaders(), body: JSON.stringify({ files: { [gistFile()]: { content: JSON.stringify(progressOnly()) } } }) });
    if (!r.ok) throw new Error();
    lsSet(stateKey(), JSON.stringify(S));
  } catch (e) { toast("ซิงก์ไม่สำเร็จ จะลองใหม่ครั้งถัดไป"); }
}
async function syncNow(silent) {
  if (!S.sync.token) return;
  try { const res = await syncPull(); if (res === "kept") await syncPush(); if (!silent) toast(res === "pulled" ? "โหลดความคืบหน้าจากเครื่องอื่นแล้ว" : "ซิงก์แล้ว"); render(); }
  catch (e) { if (!silent) toast(e.message || "ซิงก์ไม่สำเร็จ"); }
}

/* ---------- events ---------- */
document.addEventListener("click", async (e) => {
  const t = e.target.closest("[data-act],[data-tab]"); if (!t) return;
  if (t.dataset.tab) { tab = t.dataset.tab; render(); window.scrollTo(0, 0); if (tab === "plan") setTimeout(() => $("#curweek")?.scrollIntoView({ block: "center" }), 50); return; }
  const a = t.dataset.act, ci = currentIdx(), day = PLAN[ci];
  if (a === "read") { dayRec(ci).read = true; save(); render(); }
  else if (a === "check") { dayRec(ci).check = true; save(); render(); }
  else if (a === "quiz") { const mi = +t.dataset.mi, ms = day.missions[mi]; openQuiz(ms.kind, pickQuestions(day, ms, mi), { day: ci, mi, need: ms.need, minutes: ms.minutes, title: ms.title || (ms.kind === "diag" ? "Diagnostic" : `ข้อสอบ ${day.label}`) }); }
  else if (a === "review") { const list = dueReview(); openQuiz("review", list, { day: ci, title: "ทบทวนข้อที่เคยผิด", isReview: true }); }
  else if (a === "practice") { const list = shuffle(Object.entries(S.qs).filter(([, s]) => s.box > 0).map(([n]) => +n)).slice(0, 20); openQuiz("practice", list, { title: "ฝึกข้อที่ผิด", isReview: true }); }
  else if (a === "pick") { const i = +t.dataset.i, q = Q[quiz.list[quiz.i]]; if (q.t === "sata") quiz.sel = quiz.sel.includes(i) ? quiz.sel.filter((x) => x !== i) : [...quiz.sel, i]; else quiz.sel = [i]; renderQuiz(); }
  else if (a === "qcheck") {
    const n = quiz.list[quiz.i], ok = grade(Q[n], quiz.sel);
    quiz.results.push(ok); recordAnswer(n, ok, quiz.isReview); save(false);
    if (ok) { quiz.i++; quiz.sel = []; quiz.checked = false; toast("✓ Correct"); renderQuiz(); $(".quiz")?.scrollTo(0, 0); } // right: straight to the next item
    else { quiz.checked = true; renderQuiz(); } // wrong: show the key and rationale
  }
  else if (a === "reveal") { quiz.checked = true; renderQuiz(); }
  else if (a === "selfmark") { const n = quiz.list[quiz.i], ok = t.dataset.v === "1"; quiz.results.push(ok); recordAnswer(n, ok, quiz.isReview); quiz.i++; quiz.sel = []; quiz.checked = false; save(false); renderQuiz(); window.scrollTo(0, 0); }
  else if (a === "qnext") { quiz.i++; quiz.sel = []; quiz.checked = false; renderQuiz(); $(".quiz")?.scrollTo(0, 0); }
  else if (a === "qclose") { clearInterval(timerTick); if (quiz.results.length) save(); quiz = null; render(); }
  else if (a === "qdone") { quiz = null; render(); window.scrollTo(0, 0); }
  else if (a === "saveStart") { const v = $("#startDate").value; if (!v) return; if (parseYmd(v).getDay() !== 1) { toast("กรุณาเลือกวันจันทร์"); return; } S.start = v; buildPlan(); save(); toast("บันทึกวันเริ่มแล้ว"); render(); }
  else if (a === "saveToken") { S.sync.token = $("#token").value.trim(); S.sync.gist = ""; save(false); await syncNow(); }
  else if (a === "syncNow") { await syncNow(); }
  else if (a === "exportB") { $("#backup").value = btoa(unescape(encodeURIComponent(JSON.stringify(progressOnly())))); $("#backup").select(); toast("สร้างรหัสสำรองแล้ว คัดลอกเก็บไว้"); }
  else if (a === "importB") { try { const o = JSON.parse(decodeURIComponent(escape(atob($("#backup").value.trim())))); Object.assign(S, o); S.updated = Date.now(); buildPlan(); save(); toast("นำเข้าข้อมูลแล้ว"); render(); } catch (err) { toast("รหัสไม่ถูกต้อง"); } }
  else if (a === "forget") { try { localStorage.removeItem(LS_KEY); localStorage.removeItem(LS_USER); } catch (err) { } location.reload(); }
});
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && S && S.sync.token && !quiz) syncNow(true); });

/* ---------- start ---------- */
function start(data) {
  D = data; Q = {}; for (const q of D.questions) Q[q.n] = q;
  S = loadState(); buildPlan(); render();
  if (S.sync.token) syncNow(true);
}
boot();
