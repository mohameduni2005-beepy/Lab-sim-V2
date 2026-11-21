"use strict";
/* Circuit Jumper - web/Android port.  Needs data.js (PANELS, DIALS) and sim.js (Sim). */
(() => {
  // ------------------------------------------------------------------ constants
  const IMG_W = 2212, PANEL_W = 900, K = PANEL_W / IMG_W;
  const GAP = 50, TOP = 50, ROWGAP = 80, CORNER = 26, GRID = 50;
  const BG0 = "#0a1128", BG1 = "#111c3a", BG2 = "#1b2a52", FG = "#e8eefc", YEL = "#ffd60a", CYAN = "#00e5ff", GRN = "#39ff14";
  const COLORS = ["#e53935", "#212121", "#1e88e5", "#43a047", "#fdd835", "#fb8c00", "#f5f5f5"];
  const SAVE_KEY = "cj_state_v1", SLOT_KEY = "cj_slots_v1";
  const $ = id => document.getElementById(id);

  // ------------------------------------------------------------------ state
  const st = {
    wires: [], sw: {}, pending: null, sel: null, hl: new Set(),
    cols: 2, visible: {}, color: COLORS[0], width: 6, curve: 35,
    sim: { run: true, main: true, var: true, pct: 50, f: 50, w1m: false, w2m: false },
    res: null,
  };
  const view = { s: 0.4, tx: 12, ty: 12 };
  const items = {};          // id -> {panel,name,kind,x,y}
  const origin = {};         // panel -> {x,y} world
  const imgs = {};           // panel -> Image
  const nv = {};             // needle spring state id -> [x, v]
  let worldW = 1000, worldH = 1000;
  let attach = {}, phase = 0, dirty = true, needRedraw = true, simDirty = true, saveTimer = null;
  let ptr = null;            // last pointer position (for the wire preview)

  PANELS.forEach(p => {
    st.visible[p.id] = true;
    p.items.forEach(it => {
      items[p.id + ":" + it.n] = { panel: p.id, name: it.n, kind: it.k, x: it.x, y: it.y };
      if (it.k === "s") st.sw[p.id + ":" + it.n] = false;
    });
  });

  // ------------------------------------------------------------------ canvas
  const canvas = $("c"), ctx = canvas.getContext("2d");
  const sc = document.createElement("canvas"), sctx = sc.getContext("2d");
  let CW = 300, CH = 300, DPR = 1;

  function resize() {
    const r = $("stage").getBoundingClientRect();
    CW = Math.max(100, r.width); CH = Math.max(100, r.height);
    DPR = window.devicePixelRatio || 1;
    canvas.width = Math.round(CW * DPR); canvas.height = Math.round(CH * DPR);
    canvas.style.width = CW + "px"; canvas.style.height = CH + "px";
    sc.width = canvas.width; sc.height = canvas.height;
    dirty = needRedraw = true;
  }

  function rr(c, x, y, w, h, r) {
    r = Math.max(0, Math.min(r, w / 2, h / 2));
    c.beginPath(); c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
  }

  // ------------------------------------------------------------------ layout
  function vis(pid) { return st.visible[pid]; }
  function relayout() {
    const list = PANELS.filter(p => vis(p.id));
    const ncols = Math.max(1, Math.min(st.cols, list.length || 1));
    const nrows = Math.max(1, Math.ceil(list.length / ncols));
    const rowh = new Array(nrows).fill(0);
    list.forEach((p, i) => { rowh[Math.floor(i / ncols)] = Math.max(rowh[Math.floor(i / ncols)], p.h * K + ROWGAP); });
    list.forEach((p, i) => {
      const col = i % ncols, row = Math.floor(i / ncols);
      origin[p.id] = { x: GAP + col * (PANEL_W + GAP), y: TOP + rowh.slice(0, row).reduce((a, b) => a + b, 0) };
    });
    worldW = GAP * (ncols + 1) + PANEL_W * ncols;
    worldH = TOP + rowh.reduce((a, b) => a + b, 0);
  }
  function fit() {
    view.s = Math.max(0.12, Math.min(3, (CW - 24) / worldW)); view.tx = 12; view.ty = 12;
    dirty = needRedraw = true;
  }
  const W2S = (wx, wy) => [wx * view.s + view.tx, wy * view.s + view.ty];
  function itemPos(id) {
    const it = items[id], o = origin[it.panel];
    return W2S(o.x + it.x * K, o.y + it.y * K);
  }

  // ------------------------------------------------------------------ wires
  function refreshAttach() {
    attach = {};
    st.wires.forEach((w, i) => {
      if (!wireVisible(w)) return;
      [w.a, w.b].forEach(id => { (attach[id] = attach[id] || []).push(i); });
    });
  }
  function wireVisible(w) { return vis(items[w.a].panel) && vis(items[w.b].panel); }
  function endPos(id, wi) {
    let [x, y] = itemPos(id);
    const lst = attach[id] || [], n = lst.length;
    if (n > 1) {
      const k = lst.indexOf(wi);
      if (k >= 0) {
        const ang = 2 * Math.PI * k / n - Math.PI / 2, rad = Math.min(11 * view.s, 4 * view.s * n);
        x += rad * Math.cos(ang); y += rad * Math.sin(ang);
      }
    }
    return [x, y];
  }
  function wirePts(wi) {
    const w = st.wires[wi];
    const [ax, ay] = endPos(w.a, wi), [bx, by] = endPos(w.b, wi);
    const d = Math.hypot(bx - ax, by - ay), c = (w.curve === undefined ? 35 : w.curve) / 100;
    const sag = c * 0.9 * d + c * (8 + (wi % 5) * 7) * view.s;
    const mx = (ax + bx) / 2, my = (ay + by) / 2 + sag, pts = [];
    for (let i = 0; i <= 24; i++) {
      const t = i / 24;
      pts.push([(1 - t) * (1 - t) * ax + 2 * (1 - t) * t * mx + t * t * bx, (1 - t) * (1 - t) * ay + 2 * (1 - t) * t * my + t * t * by]);
    }
    return pts;
  }
  const wireWidth = w => Math.max(3, (w.w || 6) * view.s * 1.2);
  function segDist(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay;
    if (dx === 0 && dy === 0) return Math.hypot(px - ax, py - ay);
    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
  }
  function netOf(start) {
    const par = new Map();
    const f = x => { if (!par.has(x)) par.set(x, x); while (par.get(x) !== x) { par.set(x, par.get(par.get(x))); x = par.get(x); } return x; };
    st.wires.forEach(w => { par.set(f(w.a), f(w.b)); });
    const r = f(start), out = [];
    Array.from(par.keys()).forEach(k => { if (f(k) === r) out.push(k); });
    return out.length ? out : [start];
  }
  const label = id => items[id].panel + " " + items[id].name;

  // ------------------------------------------------------------------ hit tests
  function hitItem(x, y) {
    const R = Math.max(24, 17 * view.s); let best = null, bd = R * R;
    for (const id in items) {
      if (!vis(items[id].panel)) continue;
      const [ix, iy] = itemPos(id), d = (ix - x) ** 2 + (iy - y) ** 2;
      if (d <= bd) { best = id; bd = d; }
    }
    return best;
  }
  function hitWire(x, y) {
    refreshAttach();
    for (let i = st.wires.length - 1; i >= 0; i--) {
      if (!wireVisible(st.wires[i])) continue;
      const tol = Math.max(14, 4 * view.s + (st.wires[i].w || 6) * view.s), p = wirePts(i);
      for (let k = 0; k < p.length - 1; k++) if (segDist(x, y, p[k][0], p[k][1], p[k + 1][0], p[k + 1][1]) < tol) return i;
    }
    return null;
  }

  // ------------------------------------------------------------------ drawing: static layer
  function drawStatic() {
    const c = sctx, s = view.s;
    c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, sc.width, sc.height);
    c.setTransform(DPR, 0, 0, DPR, 0, 0);
    c.fillStyle = BG0; c.fillRect(0, 0, CW, CH);
    // grid
    c.lineWidth = 1;
    for (let gx = 0, gi = 0; gx <= worldW + GRID; gx += GRID, gi++) {
      const X = gx * s + view.tx; if (X < -1 || X > CW + 1) continue;
      c.strokeStyle = gi % 5 === 0 ? "#1a2c63" : "#111d45"; c.beginPath(); c.moveTo(X, 0); c.lineTo(X, CH); c.stroke();
    }
    for (let gy = 0, gi = 0; gy <= worldH + GRID; gy += GRID, gi++) {
      const Y = gy * s + view.ty; if (Y < -1 || Y > CH + 1) continue;
      c.strokeStyle = gi % 5 === 0 ? "#1a2c63" : "#111d45"; c.beginPath(); c.moveTo(0, Y); c.lineTo(CW, Y); c.stroke();
    }
    // panels
    PANELS.forEach(p => {
      if (!vis(p.id)) return;
      const o = origin[p.id], x = o.x * s + view.tx, y = o.y * s + view.ty, w = PANEL_W * s, h = p.h * K * s, rc = CORNER * s;
      if (x > CW || y > CH || x + w < 0 || y + h < 0) return;
      // no boxes around the device: photo only, title as plain text above it
      const im = imgs[p.id];
      c.save(); rr(c, x, y, w, h, rc); c.clip();
      c.fillStyle = "#f4f6fa"; c.fillRect(x, y, w, h);
      if (im && im.complete && im.naturalWidth) c.drawImage(im, x, y, w, h); else { c.fillStyle = "#334"; c.fillRect(x, y, w, h); }
      c.restore();
      const fs = Math.max(11, 14 * s), ty = y - Math.max(8, 10 * s);
      c.font = "bold " + fs + "px Segoe UI, Arial, sans-serif"; c.textBaseline = "alphabetic"; c.fillStyle = "#ffc20e";
      c.fillText("\u26A1 " + p.title, x + 2, ty);
      c.textBaseline = "alphabetic";
    });
    // terminals & switches
    refreshAttach();
    const r = Math.max(9, 14 * s);
    for (const id in items) {
      const it = items[id]; if (!vis(it.panel)) continue;
      const [x, y] = itemPos(id);
      if (x < -30 || y < -30 || x > CW + 30 || y > CH + 30) continue;
      if (it.kind === "t") {
        c.lineWidth = 1; c.strokeStyle = "#0a4d8c"; c.beginPath(); c.arc(x, y, r * 1.4, 0, 6.2832); c.stroke();
        c.lineWidth = 2; c.strokeStyle = CYAN; c.beginPath(); c.arc(x, y, r, 0, 6.2832); c.stroke();
        if (st.hl.has(id)) { c.lineWidth = 3; c.strokeStyle = YEL; c.beginPath(); c.arc(x, y, r * 1.7, 0, 6.2832); c.stroke(); }
        if (id === st.pending) { c.lineWidth = 3; c.strokeStyle = "#d500f9"; c.beginPath(); c.arc(x, y, r * 1.7, 0, 6.2832); c.stroke(); }
      } else {
        const on = st.sw[id], rs = r * 1.15;
        c.fillStyle = on ? "#2e7d32" : "#c62828"; c.strokeStyle = "#fff"; c.lineWidth = 2;
        c.beginPath(); c.arc(x, y, rs, 0, 6.2832); c.fill(); c.stroke();
        c.fillStyle = "#fff"; c.font = "bold " + Math.max(7, 8 * s + 2) + "px Consolas, monospace"; c.textAlign = "center"; c.textBaseline = "middle";
        c.fillText(on ? "ON" : "OFF", x, y); c.textAlign = "left"; c.textBaseline = "alphabetic";
      }
    }
    // wires
    st.wires.forEach((w, i) => {
      if (!wireVisible(w)) return;
      const p = wirePts(i), lw = wireWidth(w);
      c.lineCap = "round"; c.lineJoin = "round";
      const path = () => { c.beginPath(); c.moveTo(p[0][0], p[0][1]); for (let k = 1; k < p.length; k++) c.lineTo(p[k][0], p[k][1]); };
      if (i === st.sel) { c.strokeStyle = "#ffffff"; c.lineWidth = lw + 9; c.setLineDash([4, 3]); path(); c.stroke(); c.setLineDash([]); }
      c.strokeStyle = "#000"; c.lineWidth = lw + 3; path(); c.stroke();
      c.strokeStyle = w.color; c.lineWidth = lw; path(); c.stroke();
      [w.a, w.b].forEach(id => {
        const [x, y] = endPos(id, i), pr = Math.max(3.5, lw * 0.9);
        c.fillStyle = w.color; c.strokeStyle = "#000"; c.lineWidth = 2; c.beginPath(); c.arc(x, y, pr, 0, 6.2832); c.fill(); c.stroke();
      });
    });
  }

  // ------------------------------------------------------------------ drawing: dynamic layer
  function needleAngle(d, frac) { return d.a0 + (-2 * d.a0) * frac; }
  function edgeDist(d, th) {
    const sn = Math.sin(th), cs = Math.cos(th);
    if (d.ell) return 1.0 / Math.sqrt((sn / d.ell[0]) ** 2 + (cs / d.ell[1]) ** 2) - 2;
    return Math.max(0, (d.py - d.clip) / Math.max(0.3, cs)) + 1;
  }
  function dialScreen(d, x, y) { const o = origin[d.panel]; return W2S(o.x + x * K, o.y + y * K); }

  function drawDynamic() {
    const c = ctx, s = view.s;
    const live = st.sim.run && st.sim.main && st.wires.length > 0;
    const breathe = 0.5 + 0.5 * Math.sin(phase * 2 * Math.PI);
    if (live) {
      c.save(); c.lineCap = "round"; c.lineJoin = "round";
      st.wires.forEach((w, i) => {
        if (!wireVisible(w)) return;
        const P = wirePts(i);
        c.strokeStyle = "rgba(255,230,120," + (0.12 + 0.18 * breathe).toFixed(3) + ")";
        c.lineWidth = wireWidth(w) + 6 + 4 * breathe;
        c.beginPath(); c.moveTo(P[0][0], P[0][1]);
        for (let k = 1; k < P.length; k++) c.lineTo(P[k][0], P[k][1]);
        c.stroke();
      });
      c.restore();
    }
    if (live) {
      for (const id in items) {
        if (items[id].kind !== "s" || !st.sw[id] || !vis(items[id].panel)) continue;
        const [x, y] = itemPos(id), rad = Math.max(12, 18 * s) * (1 + 0.35 * breathe);
        c.save(); c.strokeStyle = "rgba(57,255,20," + (0.7 - 0.5 * breathe).toFixed(3) + ")";
        c.lineWidth = 2; c.beginPath(); c.arc(x, y, rad, 0, 6.2832); c.stroke(); c.restore();
      }
    }
    // current pulses on the highlighted net
    if (st.hl.size) {
      st.wires.forEach((w, i) => {
        if (!(st.hl.has(w.a) && st.hl.has(w.b)) || !wireVisible(w)) return;
        const P = wirePts(i), cum = [0];
        for (let k = 1; k < P.length; k++) cum.push(cum[k - 1] + Math.hypot(P[k][0] - P[k - 1][0], P[k][1] - P[k - 1][1]));
        const L = cum[cum.length - 1] || 1, rr2 = Math.max(3.5, (w.w || 6) * s * 0.8);
        for (let q = 0; q < 3; q++) {
          const d = ((phase + q / 3) % 1) * L; let k = 1;
          while (k < cum.length - 1 && cum[k] < d) k++;
          const t = (d - cum[k - 1]) / ((cum[k] - cum[k - 1]) || 1);
          const x = P[k - 1][0] + t * (P[k][0] - P[k - 1][0]), y = P[k - 1][1] + t * (P[k][1] - P[k - 1][1]);
          c.fillStyle = "#fff"; c.strokeStyle = YEL; c.lineWidth = 2; c.beginPath(); c.arc(x, y, rr2, 0, 6.2832); c.fill(); c.stroke();
        }
      });
    }
    // wire preview
    if (st.pending && ptr) {
      const [x, y] = itemPos(st.pending);
      c.strokeStyle = st.color; c.lineWidth = Math.max(3, 5 * s); c.setLineDash([8, 5]); c.beginPath(); c.moveTo(x, y); c.lineTo(ptr.x, ptr.y); c.stroke(); c.setLineDash([]);
    }
    // needles + read-outs
    for (const mid in DIALS) {
      const d = DIALS[mid]; if (!vis(d.panel)) continue;
      const rdg = st.res ? st.res.readings[mid] : null;
      const x = (nv[mid] || [0, 0])[0];
      const th = needleAngle(d, Math.max(-0.08, Math.min(1.1, x))), ux = Math.sin(th), uy = -Math.cos(th), r0 = edgeDist(d, th);
      const a = dialScreen(d, d.px + ux * r0, d.py + uy * r0), b = dialScreen(d, d.px + ux * d.R, d.py + uy * d.R);
      c.strokeStyle = "#101010"; c.lineWidth = Math.max(2, 5 * K * s * 1.3); c.lineCap = "round";
      c.beginPath(); c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]); c.stroke();
      if (d.ball) { c.fillStyle = "#101010"; c.beginPath(); c.arc(b[0], b[1], Math.max(3, 6 * K * s * 1.6), 0, 6.2832); c.fill(); }
      if (rdg) {
        const [px, py] = dialScreen(d, d.rd[0], d.rd[1]);
        const txt = Sim.fmt(rdg) + "  [" + rdg.range + rdg.unit + "]";
        const col = rdg.over ? "#ff5252" : (rdg.neg ? "#ffb300" : GRN), fs = Math.max(10, 12 * s + 3);
        c.font = "bold " + fs + "px Consolas, monospace"; c.textAlign = "center"; c.textBaseline = "middle";
        const tw = c.measureText(txt).width;
        c.fillStyle = "#001410"; c.strokeStyle = col; c.lineWidth = 1; rr(c, px - tw / 2 - 8, py - fs * 0.8, tw + 16, fs * 1.6, 8); c.fill(); c.stroke();
        c.fillStyle = col; c.fillText(txt, px, py + 1); c.textAlign = "left"; c.textBaseline = "alphabetic";
      }
    }
  }

  function render() {
    if (dirty) { drawStatic(); dirty = false; }
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(sc, 0, 0);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    drawDynamic();
  }

  // ------------------------------------------------------------------ simulation glue
  function ctl() {
    const m = st.sim;
    return { main: m.main, var: m.var, pct: m.pct, f: m.f, w1_minus: m.w1m, w2_minus: m.w2m };
  }
  function recompute() {
    simDirty = false; st.res = null;
    if (st.sim.run) {
      try { st.res = Sim.simulate(st.wires.map(w => [w.a, w.b]), st.sw, ctl()); } catch (e) { console.error("sim", e); }
    }
    updateReadout(); needRedraw = true;
  }
  function esc(t) { return String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;"); }
  function updateReadout() {
    const el = $("readout"); if (!el) return;
    const r = st.res;
    if (!r) { el.innerHTML = "(المحاكاة متوقفة)"; return; }
    const lines = ['<span class="h">-- الأجهزة --</span>'];
    Sim.METER_IDS.forEach(id => {
      const m = r.readings[id];
      lines.push('<span class="' + (m.over ? "w" : "") + '">' + esc(m.label.slice(0, 15).padEnd(15) + Sim.fmt(m).padStart(10) + "  [" + m.range + m.unit + "]") + "</span>");
    });
    lines.push('', '<span class="h">-- المصادر --</span>');
    r.sources.forEach(sx => {
      if (sx.V > 0.01 || sx.I > 1e-4) lines.push('<span class="' + (sx.over ? "w" : "") + '">' + esc(sx.name.slice(0, 15).padEnd(15) + sx.V.toFixed(1).padStart(6) + "V " + sx.I.toFixed(3).padStart(6) + "A " + sx.P.toFixed(1).padStart(6) + "W") + "</span>");
    });
    if (r.warnings.length) { lines.push('', '<span class="h">-- تحذيرات --</span>'); r.warnings.forEach(w => lines.push('<span class="w">' + esc(w) + "</span>")); }
    el.innerHTML = lines.join("\n");
  }
  function stepPhysics() {
    phase = (phase + 0.03) % 1;
    let moving = false;
    for (const mid in DIALS) {
      const rdg = st.res ? st.res.readings[mid] : null, target = rdg ? rdg.frac : 0;
      let [x, v] = nv[mid] || [0, 0];
      v += (target - x) * 0.14; v *= 0.70; x += v;
      if (Math.abs(target - x) < 1e-4 && Math.abs(v) < 1e-4) { x = target; v = 0; } else moving = true;
      nv[mid] = [x, v];
    }
    return moving;
  }
  let lastT = 0, acc = 0;
  function frame(ts) {
    requestAnimationFrame(frame);
    if (!lastT) lastT = ts;
    acc += Math.min(200, ts - lastT); lastT = ts;
    if (simDirty) { recompute(); checkEvents(); }
    let moving = false;
    while (acc >= 50) { acc -= 50; if (stepPhysics()) moving = true; }
    if (dirty || needRedraw || moving || st.hl.size || st.pending || (st.sim.run && st.wires.length)) { render(); needRedraw = false; }
    updateConn();
  }

  // ------------------------------------------------------------------ state changes
  let connLast = "";
  function updateConn() {
    const el = document.getElementById("connState"); if (!el) return;
    const ok = st.wires.length > 0 && st.sim.main;
    const txt = st.sim.run ? (ok ? "\u25CF جاهز للتشغيل" : "\u25CF غير موصّل") : "\u25CF متوقف";
    const cls = st.sim.run ? (ok ? "ready" : "bad") : "stop";
    const key = txt + cls; if (key === connLast) return; connLast = key;
    el.textContent = txt; el.className = "conn " + cls;
  }
  const hist = [];
  function snapshot() { hist.push(JSON.stringify(st.wires)); if (hist.length > 60) hist.shift(); }
  function undo() {
    if (!hist.length) { status("لا يوجد ما يُراجع"); return; }
    st.wires = JSON.parse(hist.pop()); st.sel = null; st.pending = null; st.hl = new Set(); touch(); status("تم التراجع");
  }
  function touch() { dirty = needRedraw = simDirty = true; clearTimeout(saveTimer); saveTimer = setTimeout(saveState, 400); }
  function status(t) { $("status").textContent = t; }
  function stateObj() {
    return { wires: st.wires, sw: st.sw, sim: st.sim, cols: st.cols, visible: st.visible, color: st.color, width: st.width, curve: st.curve };
  }
  function applyState(o) {
    if (!o) return;
    st.wires = (o.wires || []).filter(w => items[w.a] && items[w.b]);
    Object.keys(o.sw || {}).forEach(k => { if (k in st.sw) st.sw[k] = !!o.sw[k]; });
    if (o.sim) Object.assign(st.sim, o.sim);
    if (o.cols) st.cols = o.cols;
    if (o.visible) Object.keys(o.visible).forEach(k => { if (k in st.visible) st.visible[k] = !!o.visible[k]; });
    if (o.color) st.color = o.color; if (o.width) st.width = o.width; if (o.curve !== undefined) st.curve = o.curve;
    st.sel = null; st.pending = null; st.hl = new Set();
  }
  function saveState() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(stateObj())); } catch (e) { /* ignore */ } }
  function loadState() { try { applyState(JSON.parse(localStorage.getItem(SAVE_KEY) || "null")); } catch (e) { /* ignore */ } }

  // ------------------------------------------------------------------ interaction
  function tap(x, y) {
    const h = hitItem(x, y);
    if (h) {
      const it = items[h];
      if (it.kind === "s") { st.sw[h] = !st.sw[h]; touch(); return; }
      st.hl = new Set(); st.sel = null;
      if (!st.pending) { st.pending = h; status("سلك من: " + label(h) + " ← اختر الطرف الثاني"); }
      else if (st.pending === h) { st.pending = null; status(""); }
      else {
        if (!st.wires.some(w => (w.a === st.pending && w.b === h) || (w.a === h && w.b === st.pending)))
          { snapshot(); st.wires.push({ a: st.pending, b: h, color: st.color, w: st.width, curve: st.curve }); }
        st.pending = null; status("");
      }
      touch(); return;
    }
    const wi = hitWire(x, y);
    if (wi !== null) {
      st.sel = wi; const w = st.wires[wi];
      st.color = w.color; st.width = w.w || 6; st.curve = w.curve === undefined ? 35 : w.curve; syncWireUI();
      status("سلك محدد: " + label(w.a) + " ↔ " + label(w.b)); dirty = needRedraw = true; return;
    }
    st.sel = null; st.pending = null; st.hl = new Set(); status(""); dirty = needRedraw = true;
  }
  function longPress(x, y) {
    if (navigator.vibrate) { try { navigator.vibrate(30); } catch (e) { /* ignore */ } }
    const h = hitItem(x, y);
    if (h && items[h].kind === "t") {
      const net = netOf(h); st.hl = new Set(net); st.pending = null;
      status(net.length > 1 ? "النقطة تضم " + net.length + " أطراف: " + net.map(label).sort().join(", ") : "الطرف غير موصول");
      dirty = needRedraw = true; return;
    }
    const wi = hitWire(x, y);
    if (wi !== null) { snapshot(); st.wires.splice(wi, 1); st.sel = null; st.hl = new Set(); status("تم حذف السلك"); touch(); return; }
    st.hl = new Set(); st.pending = null; status(""); dirty = needRedraw = true;
  }
  function zoomAt(f, cx, cy) {
    const old = view.s, ns = Math.max(0.12, Math.min(3, old * f)); if (ns === old) return;
    const wx = (cx - view.tx) / old, wy = (cy - view.ty) / old;
    view.s = ns; view.tx = cx - wx * ns; view.ty = cy - wy * ns; dirty = needRedraw = true;
  }

  const P = new Map(); let g = { mode: "none" };
  const pt = e => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  function bindCanvas() {
    canvas.addEventListener("contextmenu", e => { e.preventDefault(); const p = pt(e); longPress(p.x, p.y); });
    canvas.addEventListener("pointerdown", e => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      try { canvas.setPointerCapture(e.pointerId); } catch (er) { /* ignore */ }
      const p = pt(e); P.set(e.pointerId, p); ptr = p;
      if (P.size === 1) {
        g = { mode: "one", sx: p.x, sy: p.y, lx: p.x, ly: p.y, moved: false, lp: false };
        g.timer = setTimeout(() => { if (g.mode === "one" && !g.moved && P.size === 1) { g.lp = true; longPress(g.sx, g.sy); } }, 520);
      } else if (P.size === 2) {
        clearTimeout(g.timer);
        const [a, b] = Array.from(P.values());
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        g = { mode: "two", d0: dist(a, b) || 1, s0: view.s, wx: (mid.x - view.tx) / view.s, wy: (mid.y - view.ty) / view.s };
      }
    });
    canvas.addEventListener("pointermove", e => {
      const p = pt(e); ptr = p; if (st.pending) needRedraw = true;
      if (!P.has(e.pointerId)) return;
      P.set(e.pointerId, p);
      if (g.mode === "one" && P.size === 1) {
        if (!g.moved && Math.hypot(p.x - g.sx, p.y - g.sy) > 9) { g.moved = true; clearTimeout(g.timer); }
        if (g.moved) { view.tx += p.x - g.lx; view.ty += p.y - g.ly; dirty = needRedraw = true; }
        g.lx = p.x; g.ly = p.y;
      } else if (g.mode === "two" && P.size === 2) {
        const [a, b] = Array.from(P.values());
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        const ns = Math.max(0.12, Math.min(3, g.s0 * dist(a, b) / g.d0));
        view.s = ns; view.tx = mid.x - g.wx * ns; view.ty = mid.y - g.wy * ns; dirty = needRedraw = true;
      }
    });
    const up = (e, cancel) => {
      const was = g;
      if (!P.has(e.pointerId)) return;
      P.delete(e.pointerId);
      if (was.mode === "one" && P.size === 0) {
        clearTimeout(was.timer);
        if (!cancel && !was.moved && !was.lp) tap(was.sx, was.sy);
        g = { mode: "none" };
      } else if (was.mode === "two") { g = { mode: "none" }; }
      if (P.size === 0) g = { mode: "none" };
    };
    canvas.addEventListener("pointerup", e => up(e, false));
    canvas.addEventListener("pointercancel", e => up(e, true));
    canvas.addEventListener("wheel", e => { e.preventDefault(); const p = pt(e); zoomAt(e.deltaY < 0 ? 1.12 : 1 / 1.12, p.x, p.y); }, { passive: false });
  }

  // ------------------------------------------------------------------ UI (sheets & controls)
  function syncWireUI() {
    document.querySelectorAll(".sw-color").forEach(b => b.classList.toggle("on", b.dataset.color === st.color));
    $("wWidth").value = st.width; $("wCurve").value = st.curve; $("customColor").value = /^#[0-9a-f]{6}$/i.test(st.color) ? st.color : "#ff0000";
  }
  function applyStyle() {
    if (st.sel !== null && st.sel < st.wires.length) {
      const w = st.wires[st.sel]; w.color = st.color; w.w = st.width; w.curve = st.curve;
    }
    syncWireUI(); touch();
  }
  function openSheet(name) {
    if (name === "wire") syncWireUI();
    document.querySelectorAll(".sheet").forEach(s => s.classList.toggle("open", s.id === "sh-" + name && !s.classList.contains("open")));
    document.querySelectorAll("#bar button[data-sheet], #tabs button[data-tab]").forEach(b => {
      const key = b.dataset.sheet || b.dataset.tab;
      const sh = $("sh-" + key);
      b.classList.toggle("on", !!sh && sh.classList.contains("open"));
    });
    setTimeout(() => { resize(); }, 0);
  }
  function buildDevices() {
    const box = $("devList"); box.innerHTML = "";
    PANELS.forEach(p => {
      const l = document.createElement("label"); l.className = "chk";
      const cb = document.createElement("input"); cb.type = "checkbox"; cb.checked = st.visible[p.id];
      cb.addEventListener("change", () => { st.visible[p.id] = cb.checked; relayout(); st.pending = null; st.sel = null; fit(); touch(); });
      l.appendChild(cb); l.appendChild(document.createTextNode(" " + p.title)); box.appendChild(l);
    });
    $("colVal").textContent = st.cols;
  }
  function slots() { try { return JSON.parse(localStorage.getItem(SLOT_KEY) || "{}"); } catch (e) { return {}; } }
  function buildSlots() {
    const box = $("slotList"), sl = slots(); box.innerHTML = "";
    Object.keys(sl).forEach(n => {
      const row = document.createElement("div"); row.className = "slot";
      const b1 = document.createElement("button"); b1.textContent = n;
      b1.addEventListener("click", () => { applyState(sl[n]); relayout(); buildDevices(); syncAll(); fit(); touch(); status("تم فتح: " + n); });
      const b2 = document.createElement("button"); b2.textContent = "✕"; b2.className = "x";
      b2.addEventListener("click", () => { const s2 = slots(); delete s2[n]; localStorage.setItem(SLOT_KEY, JSON.stringify(s2)); buildSlots(); });
      row.appendChild(b1); row.appendChild(b2); box.appendChild(row);
    });
  }
  function syncAll() {
    $("chkRun").checked = st.sim.run; $("chkMain").checked = st.sim.main; $("chkVar").checked = st.sim.var;
    $("pct").value = st.sim.pct; $("pctVal").textContent = st.sim.pct + "%"; $("freq").value = String(st.sim.f);
    $("chkW1").checked = st.sim.w1m; $("chkW2").checked = st.sim.w2m; syncWireUI(); $("colVal").textContent = st.cols;
  }
  function showNets() {
    const seen = new Set(), lines = [];
    st.wires.forEach(w => {
      if (seen.has(w.a)) return;
      const net = netOf(w.a); net.forEach(n => seen.add(n)); lines.push(net.map(label).sort().join(" = "));
    });
    const sws = Object.keys(st.sw).sort().map(k => label(k) + ": " + (st.sw[k] ? "ON" : "OFF"));
    $("netBox").textContent = (lines.length ? lines.join("\n") : "لا توجد وصلات") + "\n\n-- المفاتيح --\n" + sws.join("\n");
  }
  function bindUI() {
    document.querySelectorAll("#bar button[data-sheet]").forEach(b => b.addEventListener("click", () => openSheet(b.dataset.sheet)));
    document.querySelectorAll("#tabs button[data-tab]").forEach(b => b.addEventListener("click", () => {
      const t = b.dataset.tab;
      if (t === "labs") { document.querySelectorAll(".sheet").forEach(s => s.classList.remove("open")); openSheet("__none"); }
      else openSheet(t === "devices" ? "dev" : t);
      document.querySelectorAll("#tabs button[data-tab]").forEach(x => x.classList.toggle("on", x === b));
    }));
    $("zIn").addEventListener("click", () => { zoomAt(1.25, CW / 2, CH / 2); dirty = needRedraw = true; });
    $("zOut").addEventListener("click", () => { zoomAt(0.8, CW / 2, CH / 2); dirty = needRedraw = true; });
    $("bUndo").addEventListener("click", undo);

    $("bWires").addEventListener("click", () => openSheet("wire"));
    const about = $("about");
    const showAbout = () => { about.classList.add("open"); about.setAttribute("aria-hidden", "false"); };
    const hideAbout = () => { about.classList.remove("open"); about.setAttribute("aria-hidden", "true"); };
    $("btnInfo").addEventListener("click", showAbout);
    $("aboutClose").addEventListener("click", hideAbout);
    about.addEventListener("click", e => { if (e.target === about) hideAbout(); });
    $("btnGuide").addEventListener("click", () => status("اضغط مطولاً على طرف لإظهار نفس النقطة، وعلى سلك لحذفه"));

    $("bUndo").addEventListener("click", () => { if (st.wires.length) { st.wires.pop(); st.sel = null; st.hl = new Set(); touch(); } });
    $("btnFit").addEventListener("click", fit);
    // wire sheet
    const sw = $("swatches");
    COLORS.forEach(c => { const b = document.createElement("button"); b.className = "sw-color"; b.dataset.color = c; b.style.background = c; b.addEventListener("click", () => { st.color = c; applyStyle(); }); sw.appendChild(b); });
    $("customColor").addEventListener("input", e => { st.color = e.target.value; applyStyle(); });
    $("wWidth").addEventListener("input", e => { st.width = +e.target.value; applyStyle(); });
    $("wCurve").addEventListener("input", e => { st.curve = +e.target.value; applyStyle(); });
    $("btnDelSel").addEventListener("click", () => { if (st.sel !== null) { st.wires.splice(st.sel, 1); st.sel = null; touch(); } });
    // devices
    $("colMinus").addEventListener("click", () => { st.cols = Math.max(1, st.cols - 1); relayout(); $("colVal").textContent = st.cols; fit(); touch(); });
    $("colPlus").addEventListener("click", () => { st.cols = Math.min(4, st.cols + 1); relayout(); $("colVal").textContent = st.cols; fit(); touch(); });
    $("btnAllDev").addEventListener("click", () => { PANELS.forEach(p => st.visible[p.id] = true); relayout(); buildDevices(); fit(); touch(); });
    // simulation
    const sim = st.sim;
    $("chkRun").addEventListener("change", e => { sim.run = e.target.checked; touch(); });
    $("chkMain").addEventListener("change", e => { sim.main = e.target.checked; touch(); });
    $("chkVar").addEventListener("change", e => { sim.var = e.target.checked; touch(); });
    $("pct").addEventListener("input", e => { sim.pct = +e.target.value; $("pctVal").textContent = sim.pct + "%"; touch(); });
    $("freq").addEventListener("change", e => { sim.f = +e.target.value; touch(); });
    $("chkW1").addEventListener("change", e => { sim.w1m = e.target.checked; touch(); });
    $("chkW2").addEventListener("change", e => { sim.w2m = e.target.checked; touch(); });
    // file
    $("btnClear").addEventListener("click", () => { if (st.wires.length && confirm("مسح كل الأسلاك؟")) { st.wires = []; st.sel = null; st.hl = new Set(); touch(); } });
    $("btnNets").addEventListener("click", showNets);
    $("btnSave").addEventListener("click", () => {
      const n = ($("slotName").value || "").trim() || ("دايرة " + (Object.keys(slots()).length + 1));
      const s2 = slots(); s2[n] = JSON.parse(JSON.stringify(stateObj())); localStorage.setItem(SLOT_KEY, JSON.stringify(s2)); buildSlots(); status("تم الحفظ: " + n);
    });
    $("btnExport").addEventListener("click", () => {
      const t = JSON.stringify(stateObj()); $("jsonBox").value = t;
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(() => status("تم النسخ للحافظة"), () => status("انسخ النص يدوياً"));
    });
    $("btnImport").addEventListener("click", () => {
      try { applyState(JSON.parse($("jsonBox").value)); relayout(); buildDevices(); syncAll(); fit(); touch(); status("تم الاستيراد"); } catch (e) { status("نص غير صالح"); }
    });
  }

  // ------------------------------------------------------------------ boot
  // ---- sound effects: files in sounds/ with synthesized fallback ----
  const SFX = { intro: "sounds/intro.mp3", short: "sounds/short.mp3", reverse: "sounds/reverse.mp3", error: "sounds/error.mp3" };
  const sfxCache = {}, sfxLast = {};
  function playSfx(name) {
    return;   // silent build
    const now = Date.now();
    if (sfxLast[name] && now - sfxLast[name] < 1200) return;      // debounce
    sfxLast[name] = now;
    if (typeof Audio !== "undefined" && SFX[name]) {
      try {
        const a = sfxCache[name] || (sfxCache[name] = new Audio(SFX[name]));
        a.currentTime = 0;
        const p = a.play(); if (p && p.catch) p.then(() => {}, () => playBeep(name));
        a.onerror = () => playBeep(name);
        return;
      } catch (e) { /* fall through */ }
    }
    playBeep(name);
  }
  function playBeep(name) {
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    try {
      if (!introCtx) introCtx = new AC();
      if (introCtx.state === "suspended") introCtx.resume();
      if (introCtx.state !== "running") return;
      const t0 = introCtx.currentTime, o = introCtx.createOscillator(), g = introCtx.createGain();
      const f = name === "short" ? 90 : name === "reverse" ? 520 : 300;
      o.type = name === "short" ? "square" : "triangle";
      o.frequency.setValueAtTime(f, t0); o.frequency.exponentialRampToValueAtTime(f * 0.6, t0 + 0.35);
      g.gain.setValueAtTime(0.25, t0); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.4);
      o.connect(g); g.connect(introCtx.destination); o.start(t0); o.stop(t0 + 0.42);
    } catch (e) { /* ignore */ }
  }

  // ---- classify simulation results into sound events (fires once per new problem) ----
  let prevEvents = new Set();
  function checkEvents() {
    const r = st.res, ev = new Set();
    if (r && st.sim.run && st.sim.main) {
      (r.warnings || []).forEach(w => {
        if (/A > rating|A rated/.test(w)) ev.add("short");
        else if (/over range|V > .*max|V > .*rated/.test(w)) ev.add("error");
      });
      Object.keys(r.readings).forEach(id => {
        const m = r.readings[id];
        if (m.neg && (m.kind !== "W" || true)) ev.add("reverse");
      });
    }
    ev.forEach(e => { if (!prevEvents.has(e)) playSfx(e); });
    prevEvents = ev;
  }

  // ---- intro sound (synthesized with Web Audio, no file needed) ----
  let introDone = false, introCtx = null;
  function playIntroSound() {
    return;   // silent build
    if (introDone) return;
    if (typeof Audio !== "undefined") {
      try {
        const a = new Audio(SFX.intro);
        a.onerror = () => { introDone = false; playIntroSynth(); };
        const p = a.play();
        if (p && p.then) p.then(() => { introDone = true; }, () => { introDone = false; });
        else introDone = true;
        if (introDone) return;
      } catch (e) { /* fall through */ }
    }
    playIntroSynth();
  }
  function playIntroSynth() {
    if (introDone) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try {
      if (!introCtx) introCtx = new AC();
      if (introCtx.state === "suspended") { introCtx.resume(); }
      if (introCtx.state !== "running") return;   // blocked until the user taps
      introDone = true;
      const t0 = introCtx.currentTime, out = introCtx.createGain();
      out.gain.setValueAtTime(0.0001, t0);
      out.gain.exponentialRampToValueAtTime(0.18, t0 + 0.05);
      out.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.4);
      out.connect(introCtx.destination);
      // power-up sweep
      const sw = introCtx.createOscillator(), sg = introCtx.createGain();
      sw.type = "sawtooth";
      sw.frequency.setValueAtTime(180, t0);
      sw.frequency.exponentialRampToValueAtTime(1400, t0 + 0.7);
      sg.gain.setValueAtTime(0.5, t0); sg.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.8);
      sw.connect(sg); sg.connect(out); sw.start(t0); sw.stop(t0 + 0.85);
      // bright "lock-in" ping
      const p = introCtx.createOscillator(), pg = introCtx.createGain();
      p.type = "sine"; p.frequency.setValueAtTime(1760, t0 + 0.62);
      pg.gain.setValueAtTime(0.0001, t0 + 0.62); pg.gain.exponentialRampToValueAtTime(0.7, t0 + 0.64);
      pg.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.35);
      p.connect(pg); pg.connect(out); p.start(t0 + 0.62); p.stop(t0 + 1.4);
    } catch (e) { /* audio not available */ }
  }
  function armIntroSound() {
    playIntroSound();
    if (introDone) return;
    // Android/Chrome block audio until a tap: play on the first touch of the app
    const once = () => { playIntroSound(); if (introDone) { document.removeEventListener("pointerdown", once); } };
    document.addEventListener("pointerdown", once);
  }
  function hideSplash() {
    const sp = document.getElementById("splash"); if (!sp) return;
    sp.classList.add("hide");
    setTimeout(() => { sp.remove(); resize(); fit(); }, 700);
  }
  function boot() {
    PANELS.forEach(p => { const im = new Image(); im.onload = () => { dirty = needRedraw = true; }; im.src = "images/" + p.file; imgs[p.id] = im; });
    loadState(); relayout(); resize(); bindUI(); bindCanvas(); buildDevices(); buildSlots(); syncAll(); fit();
    window.addEventListener("resize", () => { resize(); });
    window.addEventListener("orientationchange", () => setTimeout(() => { resize(); fit(); }, 250));
    document.addEventListener("keydown", e => { if (e.key === "Escape") { st.pending = null; st.hl = new Set(); status(""); dirty = needRedraw = true; } if (e.ctrlKey && e.key === "z") $("bUndo").click(); });
    status("المس طرف ثم طرف آخر لتوصيل سلك • اضغط مطولاً على طرف لإظهار نفس النقطة • اضغط مطولاً على سلك لحذفه");
    requestAnimationFrame(frame);
    setTimeout(hideSplash, 1800);
    // armIntroSound(); // silent build
    window.__cj = { st, view, Sim, tap, longPress, items, origin, itemPos, recompute, render };   // handy for debugging
  }
  boot();
})();
