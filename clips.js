// Camera extras: instant replay (baked into the video), highlight clips (saved on the phone), sound mixing.

// ---------- saved clips (IndexedDB, so they survive closing the camera) ----------
const ClipDB = {
  p: null, mem: [],
  open() { return this.p = this.p || new Promise((ok, bad) => { const r = indexedDB.open("scoreboard-clips", 1); r.onupgradeneeded = () => r.result.createObjectStore("clips", { keyPath: "id" }); r.onsuccess = () => ok(r.result); r.onerror = () => bad(r.error); }); },
  async tx(mode, fn) { const d = await this.open(); return new Promise((ok, bad) => { const t = d.transaction("clips", mode), st = t.objectStore("clips"), r = fn(st); t.oncomplete = () => ok(r && r.result); t.onerror = () => bad(t.error); }); },
  async put(c) { try { await this.tx("readwrite", st => st.put(c)); } catch (e) { console.warn("clip kept in memory only", e); this.mem.push(c); } },
  async all() { let a = []; try { a = await this.tx("readonly", st => st.getAll()) || []; } catch (e) {} return a.concat(this.mem); },
  async del(id) { this.mem = this.mem.filter(c => c.id !== id); try { await this.tx("readwrite", st => st.delete(id)); } catch (e) {} },
};

// ---------- audio ----------
function camAudioTracks() { return REC.mix ? REC.mix.getAudioTracks() : (REC.stream ? REC.stream.getAudioTracks() : []); }

// ---------- instant replay ring buffer ----------
const RB = { frames: [], fps: 12, max: 84, last: 0, w: 0, h: 0 };
function rbCapture(v, W, H, now) {
  if (now - RB.last < 1000 / RB.fps) return; RB.last = now;
  const w = Math.round(W / 4), h = Math.round(H / 4);
  if (w !== RB.w || h !== RB.h) { RB.frames = []; RB.w = w; RB.h = h; }
  let c; if (RB.frames.length >= RB.max) c = RB.frames.shift().c; else { c = document.createElement("canvas"); c.width = w; c.height = h; }
  c.getContext("2d").drawImage(v, 0, 0, w, h); RB.frames.push({ c, t: now });
}
function startReplay(g) {
  if (REC.replay) { endReplay(g); return; }
  if (RB.frames.length < 18) return toast("Need a couple more seconds of video first");
  REC.replay = { frames: RB.frames.slice(), start: performance.now(), speed: .5 };
  RT.bq = RT.bq.filter(b => b.kind === "player");
  updateCamButtons();
}
function endReplay(g) { REC.replay = null; REC.wipeAt = performance.now(); RB.last = 0; updateCamButtons(); }
function drawReplay(ctx, W, H, now, g) {
  const R = REC.replay; if (!R) return false;
  const el = (now - R.start) / 1000, idx = Math.floor(el * RB.fps * R.speed);
  if (idx >= R.frames.length) { endReplay(g); return false; }
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";
  ctx.drawImage(R.frames[idx].c, 0, 0, W, H);
  ctx.fillStyle = "rgba(0,0,0,.08)"; ctx.fillRect(0, 0, W, H);
  return true;
}
function drawWipe(ctx, W, H, now, g) {
  let p = null;
  if (REC.replay) { const el = now - REC.replay.start; if (el < 450) p = el / 450; }
  else if (REC.wipeAt && now - REC.wipeAt < 450) p = (now - REC.wipeAt) / 450;
  if (p == null) return;
  const T = sideTeam(g, g.s.ball || "away"); ScoreBug.wipe(ctx, W, H, p, T.c1, T.c2);
}

// ---------- highlights: two staggered recorders so the last 12-24 seconds are always ready ----------
const HL = { active: false, slots: [], timer: 0, canvas: null, ctx: null, stream: null, len: 24 };
function hlFrame() {
  if (!HL.active || !HL.canvas) return;
  const W = REC.canvas.width, H = REC.canvas.height, k = Math.min(1, 960 / Math.max(W, H)), w = Math.round(W * k), h = Math.round(H * k);
  if (HL.canvas.width !== w || HL.canvas.height !== h) { HL.canvas.width = w; HL.canvas.height = h; }
  HL.ctx.drawImage(REC.canvas, 0, 0, w, h);
}
function hlRecorder(i) {
  const stream = new MediaStream([...HL.stream.getVideoTracks(), ...camAudioTracks()]), mime = pickMime(), chunks = [];
  let r; try { r = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: 3_000_000 } : undefined); } catch (e) { r = new MediaRecorder(stream); }
  const o = { r, t0: Date.now(), keep: null };
  r.ondataavailable = e => e.data && e.data.size && chunks.push(e.data);
  r.onstop = () => { if (o.keep) o.keep(new Blob(chunks, { type: r.mimeType || mime || "video/mp4" })); };
  r.start(1000); HL.slots[i] = o;
}
function hlStart() {
  if (HL.active || !window.MediaRecorder || !REC.canvas || !REC.canvas.captureStream) return;
  HL.canvas = HL.canvas || document.createElement("canvas"); HL.ctx = HL.canvas.getContext("2d");
  HL.canvas.width = 960; HL.canvas.height = 540; hlFrame();
  HL.stream = HL.canvas.captureStream(30); HL.active = true; HL.slots = [];
  try { hlRecorder(0); } catch (e) { console.warn("highlights off", e); HL.active = false; return; }
  HL.half = setTimeout(() => HL.active && hlRecorder(1), HL.len * 500);
  HL.timer = setInterval(() => {
    if (!HL.active) return; const now = Date.now();
    HL.slots.forEach((o, i) => { if (o && now - o.t0 > HL.len * 1000) { o.r.stop(); hlRecorder(i); } });
  }, 500);
  updateCamButtons();
}
function hlStop() {
  HL.active = false; clearInterval(HL.timer); clearTimeout(HL.half);
  HL.slots.forEach(o => { try { o && o.r.state !== "inactive" && o.r.stop(); } catch (e) {} }); HL.slots = [];
  HL.stream?.getTracks().forEach(t => t.stop()); HL.stream = null; updateCamButtons();
}
function grabHighlight(g) {
  if (!HL.active) return toast(g.hlOn === false ? "Highlights are off (Look tab)" : "Highlights aren't ready on this phone");
  const now = Date.now(); let bi = -1;
  HL.slots.forEach((o, i) => { if (o && now - o.t0 >= 3000 && (bi < 0 || o.t0 < HL.slots[bi].t0)) bi = i; });
  if (bi < 0) return toast("Give it a few seconds, then tap Highlight");
  const o = HL.slots[bi], last = [...g.plays].reverse().find(p => p.desc && p.type !== "adj");
  const A = sideTeam(g, "away"), H = sideTeam(g, "home"), q = g.s.qtr, clock = fmtClock(curClock(g.s));
  o.keep = async blob => {
    const ext = (blob.type || "").includes("mp4") ? "mp4" : "webm", id = uid();
    await ClipDB.put({ id, gid: g.id, created: Date.now(), secs: Math.round((Date.now() - o.t0) / 1000), label: last ? last.desc : `${A.abbr} ${g.s.away.score}, ${H.abbr} ${g.s.home.score}`, q, clock, type: blob.type, name: `Highlight-${A.abbr}-${H.abbr}-Q${q}-${clock.replace(":", "")}.${ext}`, blob });
    HL.count = (HL.count || 0) + 1; updateCamButtons(); toast("Highlight saved");
    if (location.hash.endsWith("/record")) renderClips(g);
  };
  o.r.stop(); hlRecorder(bi);
  const b = document.getElementById("hlBtn"); if (b) { b.classList.add("flash"); setTimeout(() => b.classList.remove("flash"), 600); }
}
function updateCamButtons() {
  const r = document.getElementById("rpBtn"); if (r) { r.textContent = REC.replay ? "End replay" : "Replay"; r.classList.toggle("on", !!REC.replay); }
  const h = document.getElementById("hlBtn"); if (h) { h.textContent = HL.count ? `Highlight (${HL.count})` : "Highlight"; h.disabled = !HL.active; }
}

// ---------- camera open / close ----------
function camExtrasStart(g) {
  REC.mix = SFX.mix(REC.stream ? REC.stream.getAudioTracks() : []);
  HL.count = 0; RB.frames = []; REC.replay = null;
  if (g.hlOn !== false) setTimeout(() => document.getElementById("recov") && hlStart(), 1500);
  updateCamButtons();
}
function camExtrasStop() {
  hlStop(); REC.replay = null; RB.frames = [];
  SFX.setCam(false);
}

// ---------- highlights list on the Record tab ----------
async function renderClips(g) {
  const el = document.getElementById("clipList"); if (!el) return;
  const list = (await ClipDB.all()).filter(c => c.gid === g.id).sort((a, b) => a.created - b.created);
  el.innerHTML = list.length ? `${list.map(c => `<div class="clip"><div><b>Q${esc(c.q)} ${esc(c.clock)}</b> <small>${c.secs || ""}s</small><span>${esc(c.label)}</span></div>
      <button class="small" data-act="clipWatch" data-v="${c.id}">Watch</button><button class="small x" data-act="clipDel" data-v="${c.id}">✕</button></div>`).join("")}
    <div class="row"><button data-act="clipSaveAll">Save all ${list.length} to Photos</button></div>`
    : `<p class="muted">No highlights yet. While the camera is open, tap <b>Highlight</b> right after a big play.</p>`;
}
const clipFile = c => new File([c.blob], c.name, { type: c.type || "video/mp4" });
Object.assign(ACT, {
  replay: (el, g) => startReplay(g),
  highlight: (el, g) => grabHighlight(g),
  clipWatch: async el => { const c = (await ClipDB.all()).find(x => x.id === el.dataset.v); if (c) showSaveDialog(clipFile(c)); },
  clipDel: async (el, g) => { if (!confirm("Delete this highlight?")) return; await ClipDB.del(el.dataset.v); renderClips(g); },
  clipSaveAll: async (el, g) => {
    const files = (await ClipDB.all()).filter(c => c.gid === g.id).map(clipFile);
    if (navigator.canShare && navigator.canShare({ files })) { try { await navigator.share({ files }); } catch (e) {} }
    else files.forEach(f => shareFile(f));
  },
});

// start the app once every script has loaded
document.fonts.ready.then(() => Promise.all(["800 40px Barlow", "700 40px Barlow", "600 40px Barlow", "700 40px SairaC", "800 40px SairaC", "600 40px SairaC", "600 40px Teko", "500 40px Teko"].map(f => document.fonts.load(f)))).finally(route);
