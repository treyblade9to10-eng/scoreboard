// Video safety: recordings are written to the phone's storage every 2 seconds while you film,
// and split into 10-minute parts. If Safari crashes, reloads, or you tap Done by mistake, the video is still here.
const VS = {
  p: null, PART_MS: 10 * 60 * 1000,
  open() { return this.p = this.p || new Promise((ok, bad) => { const r = indexedDB.open("scoreboard-video", 1); r.onupgradeneeded = () => { const d = r.result; d.createObjectStore("parts", { keyPath: "id" }); d.createObjectStore("chunks", { autoIncrement: true }).createIndex("pid", "pid"); }; r.onsuccess = () => ok(r.result); r.onerror = () => bad(r.error); }); },
  async tx(stores, mode, fn) { const d = await this.open(); return new Promise((ok, bad) => { const t = d.transaction(stores, mode); let out; const r = fn(t); if (r && "onsuccess" in r) r.onsuccess = () => out = r.result; t.oncomplete = () => ok(out); t.onerror = () => bad(t.error); t.onabort = () => bad(t.error); }); },
  putPart(p) { return this.tx(["parts"], "readwrite", t => t.objectStore("parts").put(p)); },
  addChunk(pid, i, blob) { return this.tx(["chunks"], "readwrite", t => t.objectStore("chunks").add({ pid, i, blob })); },
  parts() { return this.tx(["parts"], "readonly", t => t.objectStore("parts").getAll()).then(a => a || []); },
  chunks(pid) { return this.tx(["chunks"], "readonly", t => t.objectStore("chunks").index("pid").getAll(pid)).then(a => (a || []).sort((x, y) => x.i - y.i)); },
  async file(part) { const ch = await this.chunks(part.id); return new File(ch.map(c => c.blob), part.name, { type: part.type || "video/mp4" }); },
  async del(pid) {
    const keys = await this.tx(["chunks"], "readonly", t => t.objectStore("chunks").index("pid").getAllKeys(pid)) || [];
    await this.tx(["chunks", "parts"], "readwrite", t => { const c = t.objectStore("chunks"); keys.forEach(k => c.delete(k)); t.objectStore("parts").delete(pid); });
  },
};
navigator.storage?.persist?.().catch(() => {}); // ask Safari not to clear our storage

// ---------- recording ----------
const VR = { rid: null, part: null, chain: Promise.resolve(), timer: 0, g: null, mime: "", stream: null, partNo: 0, stopping: false };
function startSafeRecording(g, stream, mime) {
  Object.assign(VR, { rid: uid(), g, stream, mime, partNo: 0, stopping: false, started: Date.now() });
  storageCheck();
  startPart();
  VR.timer = setInterval(() => { if (!VR.stopping && Date.now() - VR.part.t0 >= VS.PART_MS) rotatePart(); }, 5000);
}
function partName(g, n) {
  const A = sideTeam(g, "away"), H = sideTeam(g, "home"), d = new Date(VR.started);
  return `Scoreboard-${A.abbr}-vs-${H.abbr}-${d.toISOString().slice(0, 10)}-${String(d.getHours()).padStart(2, "0")}${String(d.getMinutes()).padStart(2, "0")}-part${n}.${(VR.mime || "video/mp4").includes("webm") ? "webm" : "mp4"}`;
}
function startPart() {
  const g = VR.g, n = ++VR.partNo;
  let r; try { r = new MediaRecorder(VR.stream, VR.mime ? { mimeType: VR.mime, videoBitsPerSecond: 5_000_000 } : undefined); } catch (e) { r = new MediaRecorder(VR.stream); }
  const A = sideTeam(g, "away"), H = sideTeam(g, "home");
  const meta = { id: VR.rid + "-" + n, rid: VR.rid, gid: g.id, n, name: partName(g, n), type: r.mimeType || VR.mime || "video/mp4", started: Date.now(), ended: 0, secs: 0, done: false, saved: false, label: `${A.abbr} vs ${H.abbr}${g.title ? " · " + g.title : ""}` };
  const P = { r, meta, i: 0, t0: Date.now() };
  VS.putPart(meta).catch(e => storageFail(e));
  r.ondataavailable = e => {
    if (!e.data || !e.data.size) return;
    const blob = e.data, i = P.i++;
    VR.chain = VR.chain.then(() => VS.addChunk(meta.id, i, blob)).then(() => { if (i % 5 === 4) { meta.ended = Date.now(); return VS.putPart(meta); } }).catch(err => storageFail(err));
  };
  r.onstop = () => {
    meta.ended = Date.now(); meta.secs = Math.round((meta.ended - meta.started) / 1000); meta.done = true;
    VR.chain = VR.chain.then(() => VS.putPart(meta)).catch(err => storageFail(err));
    P.finished = VR.chain;
  };
  r.start(2000); VR.part = P; REC.rec = r;
  if (n === 1) REC.t0 = Date.now();
}
function rotatePart() { // start the next part, then stop the old one a moment later so nothing is missed
  const old = VR.part; old.meta.multi = true; startPart();
  setTimeout(() => { try { old.r.state !== "inactive" && old.r.stop(); } catch (e) {} }, 400);
  toast(`Part ${VR.partNo - 1} saved on this phone. Still recording.`);
}
async function stopSafeRecording() {
  if (!VR.part) return; VR.stopping = true; clearInterval(VR.timer);
  const P = VR.part; try { P.r.state !== "inactive" && P.r.stop(); } catch (e) {}
  await new Promise(ok => setTimeout(ok, 300)); await VR.chain;
  const rid = VR.rid, g = VR.g; VR.part = null; REC.rec = null;
  document.getElementById("recBtn")?.classList.remove("on"); const rt = document.getElementById("recTime"); if (rt) rt.textContent = "";
  showRecordingDialog(rid, g);
}
let storageWarned = 0;
function storageFail(e) { console.warn("video storage", e); if (Date.now() - storageWarned > 30000) { storageWarned = Date.now(); toast("Phone storage is full! Stop and save your video to Photos now."); } }
async function storageCheck() {
  try { const est = await navigator.storage?.estimate?.(); if (est && est.quota && est.quota - est.usage < 800e6) toast(`Only about ${Math.round((est.quota - est.usage) / 1e6)} MB of space left for video. Save old videos to Photos and delete them here.`); } catch (e) {}
}

// ---------- after recording / saved videos ----------
const fmtDur = s => s >= 3600 ? `${Math.floor(s / 3600)}:${String(Math.floor(s / 60) % 60).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}` : fmtClock(s);
async function showRecordingDialog(rid, g) {
  const parts = (await VS.parts()).filter(p => p.rid === rid).sort((a, b) => a.n - b.n);
  const d = document.createElement("div"); d.className = "savedlg";
  d.innerHTML = `<div class="savedlg-in"><h3>Video saved on this phone</h3>
    <p class="muted">It's kept in Scoreboard until you delete it, so it's safe even if you close this. Tap <b>Save to Photos</b> and pick <b>Save Video</b>.${parts.length > 1 ? ` Long videos are split into ${parts.length} parts.` : ""}</p>
    <div class="vlist">${parts.map(p => partRow(p)).join("")}</div>
    ${parts.length > 1 ? `<button class="primary big" data-act="vSaveAll" data-v="${rid}">Save all ${parts.length} parts to Photos</button>` : ""}
    <button class="ghost" data-act="closeDlg">Done</button></div>`;
  document.body.appendChild(d);
}
function partRow(p) {
  const secs = p.secs || Math.round(((p.ended || p.started) - p.started) / 1000);
  return `<div class="vrow"><div><b>${esc(p.label || "Video")}${p.n > 1 || p.multi ? ` · part ${p.n}` : ""}</b><small>${new Date(p.started).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} · ${fmtDur(secs)}${p.saved ? " · saved to Photos" : ""}${!p.done ? " · recovered (about)" : ""}</small></div>
    <button class="small" data-act="vWatch" data-v="${p.id}">Watch</button><button class="small ${p.saved ? "" : "primary"}" data-act="vSave" data-v="${p.id}">Save to Photos</button><button class="small x" data-act="vDel" data-v="${p.id}">✕</button></div>`;
}
async function sharePart(p) {
  const f = await VS.file(p);
  if (!f.size) return toast("That part is empty");
  if (navigator.canShare && navigator.canShare({ files: [f] })) {
    try { await navigator.share({ files: [f] }); p.saved = true; await VS.putPart(p); }
    catch (e) { if (e.name !== "AbortError") { toast("Couldn't open Save. Try Download instead."); dl(f); } }
  } else { dl(f); p.saved = true; await VS.putPart(p); }
}
function dl(f) { const a = document.createElement("a"); a.href = URL.createObjectURL(f); a.download = f.name; a.click(); }
async function renderVideos(el, gid) {
  if (!el) return;
  let parts = []; try { parts = await VS.parts(); } catch (e) { el.innerHTML = `<p class="muted">Saved videos aren't available in this browser.</p>`; return; }
  parts = parts.filter(p => !gid || p.gid === gid).sort((a, b) => b.started - a.started);
  const live = VR.part && VR.part.meta.id;
  parts = parts.filter(p => p.id !== live);
  const est = await navigator.storage?.estimate?.().catch(() => null);
  el.innerHTML = parts.length ? `${parts.map(partRow).join("")}${est ? `<p class="muted">Videos use about ${(est.usage / 1e9).toFixed(1)} GB on this phone. Delete ones you've saved to Photos to free space.</p>` : ""}`
    : `<p class="muted">No videos yet. Everything you record shows up here, even if you forget to save it.</p>`;
}
async function unsavedCount() { try { return (await VS.parts()).filter(p => !p.saved).length; } catch (e) { return 0; } }
function viewVideos() {
  $app.innerHTML = `<header class="top"><button class="back" data-act="backHome">‹ Back</button><h1>Videos</h1></header>
    <section class="card"><p class="muted">Every recording is kept here until you delete it. Save them to Photos, then delete them here to free up space.</p><div id="allVids"><p class="muted">Loading...</p></div></section>`;
  renderVideos(document.getElementById("allVids"));
}
async function homeVideoBanner() {
  const n = await unsavedCount(), el = document.getElementById("vidBanner"); if (!el) return;
  el.innerHTML = n ? `<a class="vbanner" href="#/videos"><b>${n} video${n === 1 ? "" : "s"} not saved to Photos yet</b><span>Tap to see them and save</span></a>` : `<a class="vlink" href="#/videos">Videos on this phone</a>`;
}
const vRefresh = () => { if (location.hash === "#/videos") viewVideos(); else { const g = currentGame(); renderVideos(document.getElementById("vidList"), g && g.id); } };
Object.assign(ACT, {
  vWatch: async el => { const p = (await VS.parts()).find(x => x.id === el.dataset.v); if (!p) return; const f = await VS.file(p); showSaveDialog(f); },
  vSave: async el => { const p = (await VS.parts()).find(x => x.id === el.dataset.v); if (p) { await sharePart(p); vRefresh(); const d = el.closest(".savedlg"); if (d) d.querySelector(`[data-v="${p.id}"].primary`)?.classList.remove("primary"); } },
  vSaveAll: async el => {
    const parts = (await VS.parts()).filter(p => p.rid === el.dataset.v).sort((a, b) => a.n - b.n), files = await Promise.all(parts.map(p => VS.file(p)));
    if (navigator.canShare && navigator.canShare({ files })) { try { await navigator.share({ files }); for (const p of parts) { p.saved = true; await VS.putPart(p); } } catch (e) { if (e.name !== "AbortError") files.forEach(dl); } }
    else files.forEach(dl);
    vRefresh();
  },
  vDel: async el => {
    const p = (await VS.parts()).find(x => x.id === el.dataset.v); if (!p) return;
    if (!confirm(p.saved ? "Delete this video from Scoreboard? (Your copy in Photos stays.)" : "This video is NOT saved to Photos yet. Delete it forever?")) return;
    await VS.del(p.id); el.closest(".vrow")?.remove(); vRefresh();
  },
});
