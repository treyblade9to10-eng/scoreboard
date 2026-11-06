// Sound effects made in code (no sound files): air horn, ref whistle, crowd, buzzer, chime.
// While the camera is open they get mixed with the microphone into the recording.
window.SFX = (() => {
  let ctx = null, out = null, spk = null, dest = null, micSrc = null, noise = null;
  const S = { on: true, hear: localStorage.getItem("sb-hear") === "1", camOpen: false, loud: false };
  function ensure() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return null;
      ctx = new AC(); out = ctx.createGain(); out.gain.value = .9; spk = ctx.createGain(); out.connect(spk); spk.connect(ctx.destination);
      const n = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate), d = n.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; noise = n;
    }
    if (ctx.state === "suspended") ctx.resume();
    speaker(); return ctx;
  }
  // out loud when not filming, when asked, or in screen rec / TV mode (so screen recordings and the TV get the sounds)
  function speaker() { if (spk) spk.gain.value = !S.camOpen || S.hear || S.loud ? 1 : 0; }
  // returns a MediaStream with mic + sound effects mixed, or null if that can't be done
  function mix(micTracks) {
    try {
      if (!ensure() || !ctx.createMediaStreamDestination) return null;
      if (!dest) { dest = ctx.createMediaStreamDestination(); out.connect(dest); }
      micSrc?.disconnect(); micSrc = null;
      if (micTracks && micTracks.length) { micSrc = ctx.createMediaStreamSource(new MediaStream(micTracks)); micSrc.connect(dest); }
      return dest.stream;
    } catch (e) { console.warn("sound mix failed", e); return null; }
  }
  const env = (g, t, a, hold, rel, peak) => { g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(peak, t + a); g.gain.setValueAtTime(peak, t + a + hold); g.gain.exponentialRampToValueAtTime(.0001, t + a + hold + rel); };
  function horn() {
    if (!ensure()) return; const t = ctx.currentTime;
    for (const [start, len] of [[0, .45], [.55, 1.1]]) {
      const g = ctx.createGain(), f = ctx.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = 2200; g.connect(out); f.connect(g);
      env(g, t + start, .03, len, .25, .22);
      for (const hz of [233, 294, 349]) { const o = ctx.createOscillator(); o.type = "sawtooth"; o.frequency.setValueAtTime(hz * .97, t + start); o.frequency.linearRampToValueAtTime(hz, t + start + .08); o.connect(f); o.start(t + start); o.stop(t + start + len + .4); }
    }
  }
  function whistle(n = 1) {
    if (!ensure()) return; const t0 = ctx.currentTime;
    for (let k = 0; k < n; k++) {
      const t = t0 + k * .5, o = ctx.createOscillator(), lfo = ctx.createOscillator(), lg = ctx.createGain(), g = ctx.createGain();
      o.type = "sine"; o.frequency.value = 2900; lfo.frequency.value = 32; lg.gain.value = 140; lfo.connect(lg); lg.connect(o.frequency);
      o.connect(g); g.connect(out); env(g, t, .02, k === n - 1 ? .5 : .22, .08, .3);
      o.start(t); lfo.start(t); o.stop(t + 1); lfo.stop(t + 1);
    }
  }
  function crowd(len = 2.5, level = .5) {
    if (!ensure()) return; const t = ctx.currentTime, src = ctx.createBufferSource(), bp = ctx.createBiquadFilter(), lp = ctx.createBiquadFilter(), g = ctx.createGain();
    src.buffer = noise; src.loop = true; bp.type = "bandpass"; bp.frequency.value = 1000; bp.Q.value = .5; lp.type = "lowpass"; lp.frequency.value = 3000;
    src.connect(bp); bp.connect(lp); lp.connect(g); g.connect(out);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(level, t + .4); g.gain.setValueAtTime(level, t + len * .45); g.gain.exponentialRampToValueAtTime(.0001, t + len);
    src.start(t); src.stop(t + len + .1);
  }
  function buzzer() {
    if (!ensure()) return; const t = ctx.currentTime, g = ctx.createGain(), f = ctx.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = 1400; f.connect(g); g.connect(out); env(g, t, .01, 1.1, .1, .16);
    for (const hz of [196, 199]) { const o = ctx.createOscillator(); o.type = "square"; o.frequency.value = hz; o.connect(f); o.start(t); o.stop(t + 1.3); }
  }
  function chime() {
    if (!ensure()) return; const t = ctx.currentTime;
    [[659, 0], [880, .14]].forEach(([hz, d]) => { const o = ctx.createOscillator(), g = ctx.createGain(); o.type = "triangle"; o.frequency.value = hz; o.connect(g); g.connect(out); env(g, t + d, .01, .08, .5, .25); o.start(t + d); o.stop(t + d + .8); });
  }
  const PLAY = { horn, whistle: () => whistle(2), crowd: () => crowd(3, .55), buzzer, chime };
  function forBanner(kind, text) {
    if (!S.on) return;
    const t = String(text || "").toLowerCase();
    if (kind === "td") { horn(); crowd(4, .6); }
    else if (kind === "fg") { if (t === "final") { buzzer(); crowd(4, .5); } else crowd(2.5, .45); }
    else if (kind === "flag") whistle(2);
    else if (kind === "to") {
      if (/timeout|injury|two-minute/.test(t)) whistle(1);
      else if (/end of|halftime|final/.test(t)) buzzer();
      else if (/first down/.test(t)) chime();
      else if (/interception|fumble|turnover|stop|sack|onside/.test(t)) crowd(2.5, .5);
    }
  }
  return {
    S, ensure, mix, forBanner, ctx: () => ctx, running: () => !!ctx && ctx.state === "running",
    setLoud(v) { S.loud = v; speaker(); }, play: k => PLAY[k] && PLAY[k](),
    setCam(open) { S.camOpen = open; speaker(); },
    setHear(v) { S.hear = v; localStorage.setItem("sb-hear", v ? "1" : "0"); speaker(); },
  };
})();
