/* RN Passport · English mode: verb-first reading lessons, tap-to-translate words, and spaced vocabulary review.
   Content comes from english.json (built by _build/eng_build.py). Progress lives in S.eng, so it syncs with the gist like NCLEX progress.
   Uses globals from app.js: S, USER, save, esc, $, shuffle, today, addDays, toast, viewSettings, modeSwitch, INT. */
"use strict";
const ENG = (() => {
  const PASS = 0.7, PLACE_PER_LEVEL = 10, REVIEW_MAX = 20;
  const LV = ["", "ระดับ 1 · พื้นฐาน", "ระดับ 2 · ชีวิตประจำวัน", "ระดับ 3 · งานในวอร์ด", "ระดับ 4 · ศัพท์การพยาบาล"];
  const WORD_RE = /([A-Za-z]+(?:['’-][A-Za-z]+)*)/;
  const MARK_RE = /\[([^\]|]+)(?:\|([^\]]+))?\]/g;
  let E = null, loading = null, failed = false;
  let etab = "today", viewId = null, ez = null, reader = null, wfilter = "all";
  const V = {}, ART = {}, GLOSS = {};

  /* ---------- data ---------- */
  function load() {
    if (E || loading) return loading;
    loading = fetch("english.json", { cache: "no-cache" }).then((r) => { if (!r.ok) throw new Error(); return r.json(); }).then((d) => {
      E = d;
      for (const v of d.verbs) V[v.w] = v;
      for (const a of d.articles) { ART[a.id] = a; for (const [k, t] of Object.entries(a.gloss)) if (!GLOSS[k]) GLOSS[k] = t; }
      Object.assign(GLOSS, d.gloss);
      render();
    }).catch(() => { failed = true; loading = null; render(); });
    return loading;
  }
  const st = () => (S.eng = Object.assign({ place: null, w: {}, les: {}, rev: "" }, S.eng || {}));
  const ws = (k) => st().w[k] || { seen: 0, right: 0, wrong: 0, box: 0, due: "", last: null };
  const learning = () => Object.entries(st().w).filter(([k, s]) => s.box > 0 && known(k)).map(([k]) => k);
  const dueWords = () => { const t = today(); return Object.entries(st().w).filter(([k, s]) => s.box > 0 && s.due && s.due <= t && known(k)).map(([k]) => k); };
  const known = (k) => (k.startsWith("g:") ? !!GLOSS[k.slice(2)] : !!V[k]);
  const thOf = (k) => (k.startsWith("g:") ? GLOSS[k.slice(2)] : V[k].th);
  const wordOf = (k) => (k.startsWith("g:") ? k.slice(2) : k);
  const lesRec = (id) => st().les[id] || (st().les[id] = { read: false, attempts: 0, best: 0, passed: false });
  const passedL = (id) => !!(st().les[id] && st().les[id].passed);
  const startId = () => (st().place ? st().place.start : 1);
  function curLesson() {
    for (const a of E.articles) if (a.id >= startId() && !passedL(a.id)) return a.id;
    for (const a of E.articles) if (!passedL(a.id)) return a.id;
    return E.articles[E.articles.length - 1].id;
  }
  function status(k) { const s = st().w[k]; if (!s) return "new"; if (s.box > 0) return "learning"; return s.right > 0 ? "known" : "new"; }

  function recordWord(k, ok, isReview) {
    const s = Object.assign({}, ws(k));
    s.seen++; s.last = ok;
    if (ok) { s.right++; if (s.box > 0) { s.box = Math.min(5, s.box + 1); s.due = addDays(today(), INT[s.box]); if (isReview && s.box >= 4) s.box = 0; } }
    else { s.wrong++; s.box = 1; s.due = addDays(today(), 1); }
    st().w[k] = s;
  }
  function markUnknown(k) { const s = Object.assign({}, ws(k)); s.box = 1; s.due = today(); st().w[k] = s; save(); }
  function markKnown(k) { const s = Object.assign({}, ws(k)); s.box = 0; s.right = Math.max(1, s.right); st().w[k] = s; save(); }

  /* ---------- speech ---------- */
  function speak(text) {
    try { const u = new SpeechSynthesisUtterance(text); u.lang = "en-US"; u.rate = 0.9; speechSynthesis.cancel(); speechSynthesis.speak(u); }
    catch (e) { toast("อุปกรณ์นี้อ่านออกเสียงไม่ได้"); }
  }
  const plainText = (t) => t.replace(MARK_RE, (m, s) => s);

  /* ---------- questions ---------- */
  function pickOthers(pool, n, not) { return shuffle(pool.filter((x) => !not.includes(x))).slice(0, n); }
  function qMeaning(k, idk) {
    const th = thOf(k), w = wordOf(k);
    const pool = k.startsWith("g:") ? [...new Set(Object.values(GLOSS))] : E.verbs.filter((v) => v.lv === V[k].lv).map((v) => v.th);
    const opts = shuffle([th, ...pickOthers([...new Set(pool)], 3, [th])]);
    return { k, t: "meaning", w, opts, ans: opts.indexOf(th), idk };
  }
  function qTh2En(k) {
    const v = V[k], opts = shuffle([v.w, ...pickOthers(E.verbs.filter((x) => x.lv === v.lv).map((x) => x.w), 3, [v.w])]);
    return { k, t: "th2en", w: v.w, opts, ans: opts.indexOf(v.w) };
  }
  function qCloze(k) {
    const c = ART[V[k].a].cloze[k]; if (!c) return qMeaning(k);
    const opts = shuffle([c.a, ...c.o]);
    return { k, t: "cloze", w: k, s: c.s, opts, ans: opts.indexOf(c.a) };
  }
  function qAny(k) { if (k.startsWith("g:")) return qMeaning(k); const r = Math.random(); return r < 0.4 ? qMeaning(k) : r < 0.7 ? qCloze(k) : qTh2En(k); }

  function lessonQuiz(id) {
    const a = ART[id], half = shuffle(a.targets.slice()), list = [];
    a.targets.forEach((k) => list.push(qMeaning(k)));
    half.forEach((k, i) => list.push(i % 2 ? qTh2En(k) : qCloze(k)));
    // keep the two questions on one word apart: meanings first, then mixed
    return [...shuffle(list.slice(0, a.targets.length)), ...shuffle(list.slice(a.targets.length))];
  }
  function placementQuiz() {
    const list = [];
    for (let lv = 1; lv <= 4; lv++) shuffle(E.verbs.filter((v) => v.lv === lv)).slice(0, PLACE_PER_LEVEL).forEach((v) => list.push(qMeaning(v.w, true)));
    return list;
  }
  function openQuiz(kind, list, opts = {}) { ez = { kind, list, i: 0, pick: null, results: [], ...opts }; render(); window.scrollTo(0, 0); }

  /* ---------- views ---------- */
  function render() {
    if (!E) {
      if (!failed) load();
      $("#app").innerHTML = `<main class="wrap">${modeSwitch()}<section class="card"><p class="muted">${failed ? "โหลดบทเรียนภาษาอังกฤษไม่สำเร็จ ตรวจอินเทอร์เน็ตแล้วแตะอีกครั้ง" : "กำลังโหลดบทเรียน…"}</p>${failed ? `<div class="btns"><button class="btn" data-act="e-retry">ลองอีกครั้ง</button></div>` : ""}</section></main>${nav()}`;
      return;
    }
    if (ez) return renderQuiz();
    if (reader != null) return renderReader();
    const v = etab === "today" ? viewToday() : etab === "lessons" ? viewLessons() : etab === "words" ? viewWords() : etab === "stats" ? viewStats() : viewSettings();
    $("#app").innerHTML = `<main class="wrap">${modeSwitch()}${v}</main>${nav()}${sheet()}`;
    if (etab === "words") applyFilter();
  }
  function nav() {
    const items = [["today", "วันนี้", '<path d="M4 6h16M4 12h16M4 18h10"/>'], ["lessons", "บทเรียน", '<path d="M4 5h6a2 2 0 0 1 2 2v12a2 2 0 0 0-2-2H4zM20 5h-6a2 2 0 0 0-2 2v12a2 2 0 0 1 2-2h6z"/>'],
      ["words", "คลังคำ", '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M8 9h8M8 13h8M8 17h5"/>'], ["stats", "สถิติ", '<path d="M5 19V11M12 19V5M19 19v-6"/>'], ["settings", "ตั้งค่า", '<circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"/>']];
    return `<nav class="nav">${items.map(([k, l, p]) => `<button data-tab="${k}" ${etab === k ? 'aria-current="page"' : ""}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${p}</svg>${l}</button>`).join("")}</nav>`;
  }
  function counts() {
    let known = 0, learn = 0;
    for (const v of E.verbs) { const s = status(v.w); if (s === "known") known++; else if (s === "learning") learn++; }
    return { known, learn };
  }
  function header(a) {
    const done = E.articles.filter((x) => passedL(x.id)).length, c = counts();
    return `<header class="pass"><div class="row"><span class="eyebrow">English · Verbs first · ${esc(USER)}</span><span class="pill warn">${esc(LV[a.lv])}</span></div>
      <h1>บทที่ ${a.id} · ${esc(a.title)}</h1>
      <div class="row small"><span>${esc(a.th)}</span><span class="mono">${a.words} words</span></div>
      <div class="bar"><i style="width:${(done / E.articles.length) * 100}%"></i></div>
      <div class="row small"><span>ผ่านแล้ว ${done}/${E.articles.length} บท</span><span>รู้แล้ว ${c.known} · กำลังทวน ${c.learn} จาก ${E.verbs.length} คำ</span></div></header>`;
  }
  function viewToday() {
    const cur = curLesson(), id = viewId != null && ART[viewId] ? viewId : cur, a = ART[id], r = lesRec(id);
    let h = "";
    if (!st().place) {
      h += `<header class="pass"><div class="row"><span class="eyebrow">English · Verbs first · ${esc(USER)}</span></div><h1>เริ่มด้วยแบบทดสอบวัดระดับ</h1>
        <div class="row small"><span>คำกริยา ${PLACE_PER_LEVEL * 4} คำ · ประมาณ 5 นาที · ทำครั้งเดียว</span></div></header>
        <section class="card"><p>แต่ละข้อจะมีคำกริยาภาษาอังกฤษให้เลือกความหมายภาษาไทย ไล่จากคำง่ายไปคำยาก ถ้าไม่รู้ให้กด <b>ไม่รู้</b> แทนการเดา ผลที่ได้แม่นกว่า</p>
        <p class="small muted">ผลสอบจะบอกว่าควรเริ่มที่บทไหน คำที่ตอบไม่ได้จะเข้าคลังทวนให้อัตโนมัติ</p>
        <div class="btns"><button class="btn primary" data-act="e-place">เริ่มทำแบบทดสอบ</button><button class="btn ghost" data-act="e-skipplace">ข้าม เริ่มบทที่ 1 เลย</button></div></section>`;
      return h;
    }
    h += header(a);
    const prev = E.articles.find((x) => x.id === id - 1), next = ART[id + 1];
    h += `<div class="btns daynav"><button class="btn" data-act="e-open" data-id="${id - 1}" ${prev ? "" : "disabled"}>‹ บทก่อนหน้า</button><button class="btn" data-act="e-open" data-id="${id + 1}" ${next ? "" : "disabled"}>บทถัดไป ›</button></div>`;
    if (id !== cur) h += `<section class="card"><b>${passedL(id) ? "📖 ทบทวนบทที่ " + id + " (ผ่านแล้ว)" : "บทที่ " + id}</b><span class="small muted">บทที่ต้องทำต่อคือบทที่ ${cur}</span><div class="btns"><button class="btn" data-act="e-open" data-id="${cur}">ไปบทที่ ${cur}</button></div></section>`;
    // mission 1: read
    h += mission(1, r.read, `อ่านบทความ: ${esc(a.title)}`,
      `<div class="chips">${a.targets.map((k) => `<button class="chip ${status(k)}" data-act="e-word" data-k="${k}">${esc(k)}</button>`).join("")}</div>
       <p class="small muted">คำกริยาเป้าหมาย ${a.targets.length} คำ แตะคำไหนในบทความก็ได้เพื่อดูความหมาย</p>`,
      `<button class="btn ${r.read ? "" : "primary"}" data-act="e-read" data-id="${id}">${r.read ? "อ่านอีกครั้ง" : "เปิดบทความ"}</button>${r.read ? `<span class="pill ok">✓ อ่านแล้ว</span>` : ""}`);
    // mission 2: exercise
    const qn = a.targets.length * 2;
    h += mission(2, r.passed, `แบบฝึกหัด · ${qn} ข้อ`,
      `<p class="small muted">แปลความหมาย · เติมคำในประโยคจากบทความ · เลือกคำอังกฤษจากความหมายไทย · ต้องได้ ≥ ${Math.round(PASS * 100)}%${r.attempts ? ` · ทำไปแล้ว ${r.attempts} ครั้ง · ดีสุด ${Math.round(r.best * 100)}%` : ""}</p>`,
      r.passed ? `<span class="pill ok">✓ ผ่าน ${Math.round(r.best * 100)}%</span> <button class="btn ghost" data-act="e-quiz" data-id="${id}">ทำอีกครั้ง</button>`
        : `<button class="btn primary" data-act="e-quiz" data-id="${id}" ${r.read ? "" : "disabled"}>${r.attempts ? "ทำใหม่" : "เริ่มทำ"}</button>${r.read ? "" : `<span class="small muted">อ่านบทความก่อน</span>`}`,
      !r.passed && r.attempts > 0);
    // mission 3: daily review
    const due = dueWords(), revDone = st().rev === today();
    if (!due.length && !revDone) { st().rev = today(); save(false); }
    const rd = st().rev === today();
    h += mission(3, rd, "ทวนคำศัพท์ประจำวัน",
      `<p class="small muted">${rd ? "ทวนครบแล้ววันนี้" : `มี ${due.length} คำที่ถึงรอบทวนวันนี้`} · คำที่ตอบผิดจะกลับมาอีกใน 1 → 2 → 4 → 8 วัน</p>`,
      rd ? `<span class="pill ok">✓ ครบแล้ว</span>` : `<button class="btn primary" data-act="e-review">เริ่มทวน (${Math.min(due.length, REVIEW_MAX)} คำ)</button>`);
    if (r.passed && rd && id === cur) h += `<section class="card daydone"><div class="stamp">PASSED<br>LESSON ${id}</div><h2>ผ่านบทนี้แล้ว</h2></section>`;
    if (next) h += `<section class="card"><span class="mono small muted">บทถัดไป · ${esc(LV[next.lv])}</span><b>${esc(next.title)} · ${esc(next.th)}</b><span class="small muted">${next.targets.join(", ")}</span><div class="btns"><button class="btn" data-act="e-open" data-id="${next.id}">ไปบทที่ ${next.id} ›</button></div></section>`;
    return h;
  }
  function mission(num, done, title, body, act, fail) {
    return `<section class="card mission ${done ? "done" : fail ? "fail" : ""}"><div class="ic">${done ? "✓" : num}</div><div style="display:grid;gap:8px;min-width:0"><h3>${title}</h3>${body}<div class="btns">${act}</div></div></section>`;
  }
  function viewLessons() {
    const cur = curLesson();
    let h = `<section class="card"><h2>บทเรียน ${E.articles.length} บท</h2><p class="small muted">บทละ 10 คำกริยา · แตะบทไหนก็เปิดได้ · สีเขียว = ผ่านแล้ว · กรอบสีฟ้า = บทที่ต้องทำต่อ${st().place ? ` · ผลวัดระดับให้เริ่มที่บทที่ ${st().place.start}` : ""}</p></section>`;
    for (let lv = 1; lv <= 4; lv++) {
      h += `<section class="card"><h3>${esc(LV[lv])}</h3><div class="lessons">`;
      for (const a of E.articles.filter((x) => x.lv === lv)) {
        const r = st().les[a.id], cls = passedL(a.id) ? "done" : a.id === cur ? "cur" : r && r.attempts ? "fail" : "";
        h += `<button class="lrow ${cls}" data-act="e-open" data-id="${a.id}"><span class="dot">${passedL(a.id) ? "✓" : a.id}</span><span class="lt"><b>${esc(a.title)}</b><span class="small muted">${esc(a.th)} · ${a.targets.slice(0, 4).join(", ")}…</span></span>${r && r.best ? `<span class="small tnum muted">${Math.round(r.best * 100)}%</span>` : ""}</button>`;
      }
      h += `</div></section>`;
    }
    return h;
  }
  function viewWords() {
    const learn = learning(), due = dueWords();
    const glossed = Object.keys(st().w).filter((k) => k.startsWith("g:") && known(k));
    let h = `<section class="card"><h2>คลังคำ</h2><p class="small muted">คำกริยา ${E.verbs.length} คำ เรียงตามบท แตะคำเพื่อฟังเสียงและดูความหมาย</p>
      <div class="statgrid"><div class="stat"><b class="tnum">${learn.length}</b>คำที่กำลังทวน</div><div class="stat"><b class="tnum">${due.length}</b>ถึงรอบวันนี้</div></div>
      <div class="btns"><button class="btn primary" data-act="e-practice" ${learn.length ? "" : "disabled"}>ฝึกคำที่กำลังทวน (สูงสุด ${REVIEW_MAX} คำ)</button></div></section>
      <section class="card"><label for="wsearch">ค้นหา</label><input type="text" id="wsearch" placeholder="พิมพ์คำอังกฤษหรือไทย" autocomplete="off">
      <div class="chips" role="group" aria-label="กรองคำ">${[["all", "ทั้งหมด"], ["learning", "กำลังทวน"], ["known", "รู้แล้ว"], ["new", "ยังไม่เคยเจอ"]].map(([k, l]) => `<button class="chip ${wfilter === k ? "on" : ""}" data-act="e-filter" data-f="${k}" aria-pressed="${wfilter === k}">${l}</button>`).join("")}</div>
      <div class="wlist">`;
    for (const v of E.verbs) h += wrow(v.w, v.w, `${v.p} · ${v.pp}`, v.th);
    for (const k of glossed) h += wrow(k, wordOf(k), "คำจากบทความ", thOf(k));
    return h + `</div></section>`;
  }
  function wrow(k, w, sub, th) {
    const s = status(k), lbl = { new: "ใหม่", learning: "ทวน", known: "รู้แล้ว" }[s];
    return `<button class="wrow" data-act="e-word" data-k="${esc(k)}" data-s="${s}" data-q="${esc((w + " " + th).toLowerCase())}"><span class="ww"><b>${esc(w)}</b><span class="small muted mono">${esc(sub)}</span></span><span class="wt">${esc(th)}</span><span class="pill ${s === "known" ? "ok" : s === "learning" ? "warn" : "dim"}">${lbl}</span></button>`;
  }
  function applyFilter() {
    const q = ($("#wsearch") && $("#wsearch").value.trim().toLowerCase()) || "";
    document.querySelectorAll(".wrow").forEach((r) => { r.hidden = !((wfilter === "all" || r.dataset.s === wfilter) && (!q || r.dataset.q.includes(q))); });
  }
  function viewStats() {
    const c = counts(), p = st().place, done = E.articles.filter((x) => passedL(x.id)).length;
    const all = Object.values(st().w), tot = all.reduce((x, s) => x + s.seen, 0), right = all.reduce((x, s) => x + s.right, 0);
    let h = `<section class="card"><h2>สถิติภาษาอังกฤษ</h2><div class="statgrid">
      <div class="stat"><b class="tnum">${done}/${E.articles.length}</b>บทที่ผ่าน</div><div class="stat"><b class="tnum">${c.known}</b>คำกริยาที่รู้แล้ว</div>
      <div class="stat"><b class="tnum">${c.learn}</b>กำลังทวน</div><div class="stat"><b class="tnum">${tot ? Math.round((right / tot) * 100) : 0}%</b>ความแม่นยำรวม</div></div></section>
      <section class="card"><h3>รู้แล้วรายระดับ</h3>`;
    for (let lv = 1; lv <= 4; lv++) {
      const vs = E.verbs.filter((v) => v.lv === lv), k = vs.filter((v) => status(v.w) === "known").length;
      h += `<div class="mrow"><span>${esc(LV[lv])}</span><span class="mini"><i style="width:${(k / vs.length) * 100}%"></i></span><span class="tnum small">${k}/${vs.length}</span></div>`;
    }
    h += `</section>`;
    if (p) h += `<section class="card"><h3>ผลวัดระดับ (${thDate(p.at)})</h3>${p.by.map((x, i) => `<div class="mrow"><span>${esc(LV[i + 1])}</span><span class="mini"><i style="width:${x * 100}%"></i></span><span class="tnum small">${Math.round(x * 100)}%</span></div>`).join("")}
      <p class="small muted">แนะนำให้เริ่มบทที่ ${p.start}</p><div class="btns"><button class="btn" data-act="e-place">ทำแบบทดสอบวัดระดับอีกครั้ง</button></div></section>`;
    return h;
  }

  /* ---------- reader ---------- */
  function paraHtml(en) {
    let out = "", last = 0;
    const words = (t) => t.split(WORD_RE).map((x, i) => (i % 2 ? `<span class="ew" data-act="e-tap">${esc(x)}</span>` : esc(x))).join("");
    en.replace(MARK_RE, (m, s, l, off) => { out += words(en.slice(last, off)) + `<b class="ew tv" data-act="e-tap" data-k="${esc((l || s).toLowerCase())}">${esc(s)}</b>`; last = off + m.length; return m; });
    return out + words(en.slice(last));
  }
  function renderReader() {
    const a = ART[reader.id], r = lesRec(a.id);
    let h = `<div class="quiz"><div class="wrap"><div class="qtop"><button class="btn ghost" data-act="e-close">✕ ปิด</button><span class="mono small">บทที่ ${a.id}</span><button class="btn" data-act="e-speakall">🔊 ฟังทั้งบท</button></div>
      <section class="card eart"><span class="src">${esc(LV[a.lv])} · ${a.words} words</span><h2>${esc(a.title)}</h2>
      <p class="small muted">แตะคำไหนก็ได้เพื่อดูความหมาย คำตัวหนาคือคำกริยาเป้าหมายของบทนี้ คำที่แตะดูจะเข้าคลังทวน</p>
      ${a.paras.map((p, i) => `<div class="epara"><p class="en">${paraHtml(p.en)}</p>${reader.th[i] ? `<p class="thp">${esc(p.th)}</p>` : ""}<button class="btn ghost small" data-act="e-th" data-i="${i}">${reader.th[i] ? "ซ่อนคำแปล" : "ดูคำแปลไทย"}</button></div>`).join("")}</section>
      <div class="btns"><button class="btn primary block" data-act="e-readdone">${r.read ? "เสร็จ → ทำแบบฝึกหัด" : "✓ อ่านจบแล้ว → ทำแบบฝึกหัด"}</button></div></div></div>${sheet()}`;
    $("#app").innerHTML = h;
  }

  /* ---------- word sheet ---------- */
  let sheetK = null;
  function lookup(raw) {
    const w = raw.toLowerCase().replace(/[’']s$/, "");
    // the article's own note wins (e.g. "record" the noun), then fixed notes like "last", then verb forms
    if ((reader && ART[reader.id].gloss[w]) || E.gloss[w]) return { k: "g:" + w, w };
    if (E.forms[w]) return { k: E.forms[w], w };
    return { k: GLOSS[w] ? "g:" + w : null, w };
  }
  function sheet() {
    if (!sheetK) return "";
    const { k, w } = sheetK;
    if (!k) return `<div class="esheet" role="dialog" aria-label="${esc(w)}"><div class="sh"><div class="row"><b class="big">${esc(w)}</b><button class="btn ghost" data-act="e-say" data-t="${esc(w)}" aria-label="ฟังเสียง">🔊</button><button class="btn ghost" data-act="e-sheetx" aria-label="ปิด">✕</button></div>
      <p class="small muted">คำนี้ยังไม่มีในคลังคำของบทเรียน</p><a class="btn" href="https://translate.google.com/?sl=en&tl=th&text=${encodeURIComponent(w)}" target="_blank" rel="noopener">เปิดใน Google Translate</a></div></div>`;
    const v = V[k], s = status(k), word = wordOf(k);
    const forms = v ? `<div class="forms mono"><span>V1 ${esc(v.w)}</span><span>V2 ${esc(v.p)}</span><span>V3 ${esc(v.pp)}</span><span>-ing ${esc(v.g)}</span></div>` : "";
    const fromForm = v && w !== v.w ? `<p class="small muted">${esc(w)} เป็นรูปหนึ่งของ <b>${esc(v.w)}</b></p>` : "";
    return `<div class="esheet" role="dialog" aria-label="${esc(word)}"><div class="sh"><div class="row"><b class="big">${esc(word)}</b><button class="btn ghost" data-act="e-say" data-t="${esc(word)}" aria-label="ฟังเสียง">🔊</button><button class="btn ghost" data-act="e-sheetx" aria-label="ปิด">✕</button></div>
      ${fromForm}<p class="th">${esc(thOf(k))}</p>${forms}${v && v.ex ? `<p class="ex">“${esc(v.ex)}”</p>` : ""}
      ${v ? `<span class="small muted">${esc(LV[v.lv])} · บทที่ ${v.a}</span>` : `<span class="small muted">คำศัพท์จากบทความ</span>`}
      <div class="btns">${s === "learning" ? `<span class="pill warn">อยู่ในคลังทวน</span><button class="btn" data-act="e-know" data-k="${esc(k)}">รู้แล้ว เอาออก</button>` : `<button class="btn primary" data-act="e-unknown" data-k="${esc(k)}">ยังไม่รู้ → เพิ่มเข้าคลังทวน</button>`}</div></div></div>`;
  }
  function showSheet(x) { sheetK = x; const old = document.querySelector(".esheet"); if (old) old.remove(); if (x) document.querySelector("#app").insertAdjacentHTML("beforeend", sheet()); }

  /* ---------- quiz ---------- */
  function renderQuiz() {
    const z = ez;
    if (z.i >= z.list.length) return renderEnd();
    const q = z.list[z.i], answered = z.pick != null;
    let stem = "";
    if (q.t === "meaning") stem = `<span class="src">${z.kind === "place" ? "แบบทดสอบวัดระดับ · " : ""}คำนี้แปลว่าอะไร</span><div class="qword">${esc(q.w)} <button class="btn ghost" data-act="e-say" data-t="${esc(q.w)}" aria-label="ฟังเสียง">🔊</button></div>`;
    else if (q.t === "th2en") stem = `<span class="src">คำไหนตรงกับความหมายนี้</span><div class="qword th">${esc(V[q.k].th)}</div>`;
    else stem = `<span class="src">เติมคำกริยาที่ถูกต้อง</span><div class="stem en">${esc(q.s).replace("_____", '<span class="blank">_____</span>')}</div>`;
    let h = `<div class="quiz"><div class="wrap"><div class="qtop"><button class="btn ghost" data-act="e-qclose">✕ ออก</button><span class="mono small">${z.i + 1}/${z.list.length}</span></div>
      <div class="qprog"><i style="width:${(z.i / z.list.length) * 100}%"></i></div><section class="card">${stem}</section><div class="opts">`;
    h += q.opts.map((o, i) => {
      let c = "opt"; if (answered) { if (i === q.ans) c += " right"; else if (i === z.pick) c += " wrong"; }
      return `<button class="${c}" data-act="e-pick" data-i="${i}" ${answered ? "disabled" : ""}><span class="k">${String.fromCharCode(65 + i)}</span><span>${esc(o)}</span></button>`;
    }).join("");
    if (q.idk) h += `<button class="opt idk" data-act="e-pick" data-i="-1" ${answered ? "disabled" : ""}><span class="k">?</span><span>ไม่รู้</span></button>`;
    h += `</div>`;
    if (answered) {
      const ok = z.pick === q.ans, v = V[q.k];
      h += `<section class="card"><span class="verdict ${ok ? "ok" : "bad"}">${ok ? "✓ ถูกต้อง" : "✗ ยังไม่ถูก"}</span>
        <div class="row"><b class="big">${esc(wordOf(q.k))}</b><button class="btn ghost" data-act="e-say" data-t="${esc(wordOf(q.k))}" aria-label="ฟังเสียง">🔊</button></div><p class="th">${esc(thOf(q.k))}</p>
        ${v ? `<div class="forms mono"><span>V1 ${esc(v.w)}</span><span>V2 ${esc(v.p)}</span><span>V3 ${esc(v.pp)}</span></div>${v.ex ? `<p class="ex">“${esc(v.ex)}”</p>` : ""}` : ""}</section>
        <button class="btn primary block" data-act="e-next">${z.i + 1 < z.list.length ? "ข้อต่อไป →" : "ดูผล"}</button>`;
    }
    $("#app").innerHTML = h + `</div></div>`;
  }
  function placementResult(z) {
    const by = [0, 0, 0, 0], n = [0, 0, 0, 0];
    z.list.forEach((q, i) => { const lv = V[q.k].lv - 1; n[lv]++; if (z.results[i]) by[lv]++; });
    const frac = by.map((b, i) => (n[i] ? b / n[i] : 0));
    let lv = frac.findIndex((f) => f < PASS) + 1; if (lv === 0) lv = 4;
    const start = E.articles.find((a) => a.lv === lv).id;
    return { at: today(), by: frac, lv, start, score: z.results.filter(Boolean).length / z.list.length };
  }
  function renderEnd() {
    const z = ez, right = z.results.filter(Boolean).length, pct = z.list.length ? right / z.list.length : 0;
    if (!z.finished) {
      z.finished = true;
      if (z.kind === "lesson") { const r = lesRec(z.id); r.attempts++; r.best = Math.max(r.best, pct); r.passed = r.passed || pct >= PASS; }
      if (z.kind === "review") st().rev = today();
      if (z.kind === "place") { z.res = placementResult(z); st().place = z.res; viewId = null; }
      save();
    }
    const missed = [...new Set(z.list.filter((q, i) => !z.results[i]).map((q) => q.k))];
    let h = `<div class="quiz"><div class="wrap"><section class="card" style="text-align:center;gap:14px">`;
    if (z.kind === "place") {
      const p = z.res;
      h += `<span class="mono small muted">ผลวัดระดับ</span><div class="score tnum">${right}/${z.list.length}</div>
        <div style="display:grid;gap:8px;text-align:left">${p.by.map((x, i) => `<div class="mrow"><span>${esc(LV[i + 1])}</span><span class="mini"><i style="width:${x * 100}%"></i></span><span class="tnum small">${Math.round(x * 100)}%</span></div>`).join("")}</div>
        <span class="verdict ok">แนะนำให้เริ่ม${esc(LV[p.lv])} · บทที่ ${p.start}</span>
        <p class="small muted">เกณฑ์คือตอบถูก ≥ 70% ของระดับนั้น คำที่ตอบไม่ได้ ${missed.length} คำเข้าคลังทวนแล้ว บทก่อนหน้าเปิดอ่านได้ทุกเมื่อ</p>`;
    } else {
      const passed = z.kind !== "lesson" || pct >= PASS;
      h += `<span class="mono small muted">${esc(z.title)}</span><div class="score tnum">${Math.round(pct * 100)}%</div><p>ถูก ${right} จาก ${z.list.length} ข้อ</p>
        <span class="verdict ${passed ? "ok" : "bad"}">${z.kind === "lesson" ? (passed ? "ผ่านแบบฝึกหัด" : `ยังไม่ผ่าน · ต้องได้ ≥ ${Math.round(PASS * 100)}%`) : "ทวนครบแล้ว"}</span>`;
    }
    if (missed.length && z.kind !== "place") h += `<div class="missed">${missed.map((k) => `<div class="mrow2"><b>${esc(wordOf(k))}</b><span>${esc(thOf(k))}</span></div>`).join("")}</div><p class="small muted">คำที่ตอบผิดเข้าคลังทวนแล้ว จะกลับมาให้ทวนพรุ่งนี้</p>`;
    h += `<button class="btn primary block" data-act="e-qdone">กลับหน้าบทเรียน</button></section></div></div>`;
    $("#app").innerHTML = h;
  }

  /* ---------- events ---------- */
  function click(t) {
    if (t.dataset.tab) { etab = t.dataset.tab; if (etab === "today") viewId = null; sheetK = null; render(); window.scrollTo(0, 0); return true; }
    const a = t.dataset.act; if (!a || !a.startsWith("e-")) return false;
    if (a === "e-retry") { failed = false; load(); render(); }
    else if (a === "e-place") openQuiz("place", placementQuiz(), { title: "แบบทดสอบวัดระดับ" });
    else if (a === "e-skipplace") { st().place = { at: today(), by: [0, 0, 0, 0], lv: 1, start: 1, score: 0, skipped: true }; save(); render(); }
    else if (a === "e-open") { viewId = +t.dataset.id; etab = "today"; render(); window.scrollTo(0, 0); }
    else if (a === "e-read") { reader = { id: +t.dataset.id, th: {} }; sheetK = null; render(); window.scrollTo(0, 0); }
    else if (a === "e-th") { reader.th[+t.dataset.i] = !reader.th[+t.dataset.i]; const y = window.scrollY; render(); window.scrollTo(0, y); }
    else if (a === "e-speakall") speak(ART[reader.id].paras.map((p) => plainText(p.en)).join(" "));
    else if (a === "e-say") speak(t.dataset.t);
    else if (a === "e-tap") {
      const x = t.dataset.k ? { k: t.dataset.k, w: t.textContent.toLowerCase() } : lookup(t.textContent);
      if (x.k && status(x.k) !== "learning") { markUnknown(x.k); t.classList.add("looked"); }
      showSheet(x);
    }
    else if (a === "e-word") showSheet({ k: t.dataset.k, w: wordOf(t.dataset.k) });
    else if (a === "e-sheetx") showSheet(null);
    else if (a === "e-unknown") { markUnknown(t.dataset.k); toast("เพิ่มเข้าคลังทวนแล้ว"); showSheet(sheetK); refreshRow(t.dataset.k); }
    else if (a === "e-know") { markKnown(t.dataset.k); toast("เอาออกจากคลังทวนแล้ว"); showSheet(sheetK); refreshRow(t.dataset.k); }
    else if (a === "e-readdone") { const id = reader.id; lesRec(id).read = true; save(); reader = null; sheetK = null; openQuiz("lesson", lessonQuiz(id), { id, title: `แบบฝึกหัดบทที่ ${id}` }); }
    else if (a === "e-close") { reader = null; sheetK = null; render(); window.scrollTo(0, 0); }
    else if (a === "e-quiz") { const id = +t.dataset.id; openQuiz("lesson", lessonQuiz(id), { id, title: `แบบฝึกหัดบทที่ ${id}` }); }
    else if (a === "e-review") openQuiz("review", shuffle(dueWords()).slice(0, REVIEW_MAX).map(qAny), { title: "ทวนคำศัพท์ประจำวัน", isReview: true });
    else if (a === "e-practice") openQuiz("practice", shuffle(learning()).slice(0, REVIEW_MAX).map(qAny), { title: "ฝึกคำที่กำลังทวน", isReview: true });
    else if (a === "e-filter") { wfilter = t.dataset.f; document.querySelectorAll("[data-act=e-filter]").forEach((b) => { const on = b.dataset.f === wfilter; b.classList.toggle("on", on); b.setAttribute("aria-pressed", on); }); applyFilter(); }
    else if (a === "e-pick") {
      const z = ez, q = z.list[z.i], i = +t.dataset.i, ok = i === q.ans;
      z.pick = i; z.results.push(ok);
      if (z.kind === "place") {
        if (ok) { if (!st().w[q.k]) st().w[q.k] = { seen: 1, right: 1, wrong: 0, box: 0, due: "", last: true }; }
        else markUnknown(q.k);
        z.i++; z.pick = null; save(false); renderQuiz(); return true; // no feedback during placement: keep it quick
      }
      recordWord(q.k, ok, z.isReview); save(false); renderQuiz();
    }
    else if (a === "e-next") { ez.i++; ez.pick = null; renderQuiz(); $(".quiz")?.scrollTo(0, 0); }
    else if (a === "e-qclose") { if (ez.results.length) save(); ez = null; render(); }
    else if (a === "e-qdone") { ez = null; render(); window.scrollTo(0, 0); }
    return true;
  }
  function refreshRow(k) {
    const row = document.querySelector(`.wrow[data-k="${CSS.escape(k)}"]`);
    if (row) { const tmp = document.createElement("div"); tmp.innerHTML = wrow(k, wordOf(k), V[k] ? `${V[k].p} · ${V[k].pp}` : "คำจากบทความ", thOf(k)); row.replaceWith(tmp.firstChild); applyFilter(); }
    document.querySelectorAll(`.chip[data-k="${CSS.escape(k)}"]`).forEach((c) => { c.classList.remove("new", "learning", "known"); c.classList.add(status(k)); });
  }
  document.addEventListener("input", (e) => { if (e.target.id === "wsearch") applyFilter(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && sheetK) showSheet(null); });

  return { render, click, load, busy: () => !!(ez || reader) };
})();
