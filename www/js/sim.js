"use strict";
/* Steady-state circuit engine for the Cambridge Technologies trainer panels (port of sim.py).
   AC (phasors at f Hz) and DC are solved separately by nodal analysis, then superposed. */
const Sim = (() => {
  // ---- assumptions (edit freely) ----
  const R_SRC = 0.5, BURDEN_V = 0.1, OHM_PER_VOLT = 1000.0, R_COIL_I = 0.05, R_COIL_V = 5000.0;
  const INDUCTOR_Q = 20.0, GMIN = 1e-9, BANK_MAX_V = 120.0, WATT_FULL = 300.0, WATT_I_MAX = 2.0;
  const RESISTORS = ["1000", "500", "250"];
  const CAPS = { "3.2": 3.2e-6, "6.4": 6.4e-6, "12.7": 12.7e-6 };
  const INDS = { "3.2": 3.2, "1.6": 1.6, "0.8": 0.8 };

  // ---- CT707: three identical transformers T1..T3 (ASSUMED data, edit freely) ----
  // Primary H1-H2 = 32 V, H3-H4-H5 = 120 V + 120 V (H4 = centre tap); secondary X1..X4 = 0/12/24/60 V and
  // X5..X7 = 0/44/60 V.  Every section is its own winding (X4 and X5 are NOT connected inside the box).
  const TX_LM = 6.0, TX_RC = 3000.0, TX_I_RATED = 1.0, TX_R_PU = 0.04, TX_X_PU = 0.04;
  const TX_SECTIONS = [
    ["H1-H2", "H1", "H2", 32.0], ["H3-H4", "H3", "H4", 120.0], ["H4-H5", "H4", "H5", 120.0],
    ["X1-X2", "X1", "X2", 12.0], ["X2-X3", "X2", "X3", 12.0], ["X3-X4", "X3", "X4", 36.0],
    ["X5-X6", "X5", "X6", 44.0], ["X6-X7", "X6", "X7", 16.0],
  ];

  // ---- complex helpers: [re, im] ----
  const ZERO = [0, 0];
  const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
  const mul = (a, b) => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]];
  const div = (a, b) => { const d = b[0] * b[0] + b[1] * b[1]; return [(a[0] * b[0] + a[1] * b[1]) / d, (a[1] * b[0] - a[0] * b[1]) / d]; };
  const cabs = a => Math.hypot(a[0], a[1]);
  const conj = a => [a[0], -a[1]];
  const rect = (m, deg) => [m * Math.cos(deg * Math.PI / 180), m * Math.sin(deg * Math.PI / 180)];

  // ---- meters ----
  const meter = (id, label, kind, ac, com, ranges) => ({ id, label, kind, ac, com, ranges, unit: kind === "A" ? "A" : "V" });
  const METERS = [
    meter("CT260:A1", "CT260 DC A (1A)", "A", false, "CT260:A1.NEG", [["CT260:A1.POS", 1.0]]),
    meter("CT260:V", "CT260 DC V", "V", false, "CT260:V.NEG", [["CT260:V.25V", 25.0], ["CT260:V.250V", 250.0]]),
    meter("CT260:A2", "CT260 DC A", "A", false, "CT260:A2.NEG", [["CT260:A2.2.5A", 2.5], ["CT260:A2.5A", 5.0], ["CT260:A2.10A", 10.0]]),
    meter("CT261:M1", "CT261 AC A #1", "A", true, "CT261:M1.COM", [["CT261:M1.0.5A", 0.5], ["CT261:M1.2A", 2.0], ["CT261:M1.10A", 10.0]]),
    meter("CT261:M2", "CT261 AC A #2", "A", true, "CT261:M2.COM", [["CT261:M2.0.5A", 0.5], ["CT261:M2.2A", 2.0], ["CT261:M2.10A", 10.0]]),
    meter("CT261:M3", "CT261 AC A #3", "A", true, "CT261:M3.COM", [["CT261:M3.0.5A", 0.5], ["CT261:M3.2A", 2.0], ["CT261:M3.10A", 10.0], ["CT261:M3.20A", 20.0]]),
    meter("CT262:M1", "CT262 AC V #1", "V", true, "CT262:M1.COM", [["CT262:M1.30V", 30.0], ["CT262:M1.150V", 150.0], ["CT262:M1.300V", 300.0]]),
    meter("CT262:M2", "CT262 AC V #2", "V", true, "CT262:M2.COM", [["CT262:M2.30V", 30.0], ["CT262:M2.150V", 150.0], ["CT262:M2.300V", 300.0]]),
    meter("CT262:M3", "CT262 AC V #3", "V", true, "CT262:M3.COM", [["CT262:M3.30V", 30.0], ["CT262:M3.150V", 150.0], ["CT262:M3.300V", 300.0]]),
  ];
  const WATTMETERS = [["CT264:W1", "CT264 W1 (ph1, V12)", 1], ["CT264:W2", "CT264 W2 (ph3, V32)", 3]];
  const METER_IDS = METERS.map(m => m.id).concat(WATTMETERS.map(w => w[0]));

  // ---- supplies ----
  function sources(ctl) {
    const out = [], pct = ctl.pct / 100.0;
    if (ctl.main) {
      [[1, 0], [2, -120], [3, 120]].forEach(([k, ang]) => out.push({ name: "CT160 L" + k + "-LN", p: "CT160:L" + k, n: "CT160:LN", kind: "ac", rating: 15.0, V: rect(120.0, ang) }));
      out.push({ name: "CT160 24VDC", p: "CT160:24VDC+", n: "CT160:24VDC-", kind: "dc", rating: 2.0, V: [24.0, 0] });
      out.push({ name: "CT160 120VDC", p: "CT160:120VDC-D", n: "CT160:120VDC-N", kind: "dc", rating: 2.0, V: [120.0, 0] });
      if (ctl.var) {
        [["A", 0], ["B", -120], ["C", 120]].forEach(([t, ang]) => out.push({ name: "CT160 " + t + "-N var", p: "CT160:" + t, n: "CT160:N", kind: "ac", rating: 5.0, V: rect(120.0 * pct, ang) }));
        out.push({ name: "CT160 0-120VDC", p: "CT160:0-120VDC-E", n: "CT160:0-120VDC-N", kind: "dc", rating: 8.0, V: [120.0 * pct, 0] });
      }
    }
    return out;
  }

  // ---- elements ----
  function bankY(panel, b, sw, w, ac) {
    let y = [0, 0];
    const on = v => !!sw[panel + ":B" + b + ".S" + v];
    if (panel === "CT701") {
      RESISTORS.forEach(v => { if (on(v)) y = add(y, [1.0 / parseFloat(v), 0]); });
    } else if (panel === "CT702") {
      Object.keys(CAPS).forEach(v => { if (on(v) && ac) y = add(y, [0, w * CAPS[v]]); });
    } else if (panel === "CT703") {
      Object.keys(INDS).forEach(v => {
        if (on(v)) { const l = INDS[v], r = 2 * Math.PI * 50.0 * l / INDUCTOR_Q; y = add(y, div([1, 0], [r, ac ? w * l : 0.0])); }
      });
    }
    return y;
  }

  function passives(ctl, sw, ac) {
    const w = ac ? 2 * Math.PI * ctl.f : 0.0, els = [];
    ["CT701", "CT702", "CT703"].forEach(panel => {
      [1, 2, 3].forEach(b => {
        const y = bankY(panel, b, sw, w, ac);
        if (y[0] !== 0 || y[1] !== 0) els.push({ name: "bank:" + panel + ":B" + b, a: panel + ":B" + b + ".L", b: panel + ":B" + b + ".R", y });
      });
    });
    METERS.forEach(m => m.ranges.forEach(([term, rng]) => {
      const r = m.kind === "A" ? BURDEN_V / rng : OHM_PER_VOLT * rng;
      els.push({ name: "m:" + term, a: term, b: m.com, y: [1.0 / r, 0] });
    }));
    [1, 2, 3].forEach(k => els.push({ name: "ci:" + k, a: "CT264:IN.P" + k, b: "CT264:OUT.P" + k, y: [1.0 / R_COIL_I, 0] }));
    els.push({ name: "cv:1", a: "CT264:IN.P1", b: "CT264:IN.P2", y: [1.0 / R_COIL_V, 0] });
    els.push({ name: "cv:3", a: "CT264:IN.P3", b: "CT264:IN.P2", y: [1.0 / R_COIL_V, 0] });
    return els;
  }

  // ---- solver ----
  function solveDense(A, b) {
    const n = b.length;
    for (let i = 0; i < n; i++) {
      let p = i, best = cabs(A[i][i]);
      for (let r = i + 1; r < n; r++) { const v = cabs(A[r][i]); if (v > best) { best = v; p = r; } }
      if (best < 1e-300) throw new Error("singular");
      if (p !== i) { [A[i], A[p]] = [A[p], A[i]]; [b[i], b[p]] = [b[p], b[i]]; }
      const piv = A[i][i], rowi = A[i];
      for (let r = i + 1; r < n; r++) {
        const f = div(A[r][i], piv);
        if (f[0] !== 0 || f[1] !== 0) {
          const rowr = A[r];
          for (let c = i; c < n; c++) rowr[c] = sub(rowr[c], mul(f, rowi[c]));
          b[r] = sub(b[r], mul(f, b[i]));
        }
      }
    }
    const x = new Array(n);
    for (let i = n - 1; i >= 0; i--) {
      let s = b[i];
      for (let c = i + 1; c < n; c++) s = sub(s, mul(A[i][c], x[c]));
      x[i] = div(s, A[i][i]);
    }
    return x;
  }

  function txUsed(wires) {
    const out = new Set();
    wires.forEach(([a, b]) => [a, b].forEach(t => { if (t.startsWith("CT707:T")) out.add(parseInt(t[7], 10)); }));
    return Array.from(out).sort();
  }

  function txGroups(used, ctl, ac) {
    const w = ac ? 2 * Math.PI * ctl.f : 0.0;
    let zm = [0, 0];
    if (w > 0) zm = div(mul([0, w * TX_LM], [TX_RC, 0]), [TX_RC, w * TX_LM]);
    return used.map(t => {
      const n = [], D = [], br = [], names = [];
      TX_SECTIONS.forEach(([name, top, bot, volts]) => {
        n.push(volts / 120.0);
        const r = TX_R_PU * volts / TX_I_RATED, ll = TX_X_PU * volts / TX_I_RATED / (2 * Math.PI * 60.0);
        D.push([r, w * ll]);
        br.push(["CT707:T" + t + "." + top, "CT707:T" + t + "." + bot]);
        names.push("tx:T" + t + ":" + name);
      });
      const m = n.length, u = n.map((nk, k) => div([nk, 0], D[k]));
      let sdot = [0, 0];
      for (let k = 0; k < m; k++) sdot = add(sdot, mul([n[k], 0], u[k]));
      const den = add([1, 0], mul(zm, sdot));
      const Y = [];
      for (let k = 0; k < m; k++) {
        Y.push([]);
        for (let j = 0; j < m; j++) {
          const c = div(mul(zm, mul(u[k], u[j])), den);
          Y[k].push(sub(k === j ? div([1, 0], D[k]) : [0, 0], c));
        }
      }
      return { t, names, branches: br, Y };
    });
  }

  function analyse(wires, els, srcs, groups) {
    groups = groups || [];
    const par = new Map();
    const find = x => { if (!par.has(x)) par.set(x, x); while (par.get(x) !== x) { par.set(x, par.get(par.get(x))); x = par.get(x); } return x; };
    wires.forEach(([a, b]) => { par.set(find(a), find(b)); });
    const E = [];
    els.forEach(e => E.push({ name: e.name, na: find(e.a), nb: find(e.b), y: e.y }));
    srcs.forEach(s => E.push({ name: s.name, na: find(s.p), nb: find(s.n), y: [1.0 / R_SRC, 0] }));
    const deg = new Map();
    const bump = (k, d) => deg.set(k, (deg.get(k) || 0) + d);
    E.forEach(e => { if (e.na !== e.nb) { bump(e.na, 1); bump(e.nb, 1); } });
    groups.forEach(g => {
      g.nodes = g.branches.map(([a, b]) => [find(a), find(b)]);
      g.nodes.forEach(([na, nb]) => { if (na !== nb) { bump(na, 1); bump(nb, 1); } });
    });
    let alive = E.filter(e => e.na !== e.nb), changed = true;
    while (changed) {
      changed = false;
      for (const e of alive.slice()) {
        if (deg.get(e.na) <= 1 || deg.get(e.nb) <= 1) { alive = alive.filter(x => x !== e); bump(e.na, -1); bump(e.nb, -1); changed = true; }
      }
    }
    const nodeSet = new Set();
    alive.forEach(e => { nodeSet.add(e.na); nodeSet.add(e.nb); });
    groups.forEach(g => g.nodes.forEach(([na, nb]) => { nodeSet.add(na); nodeSet.add(nb); }));
    const nodes = Array.from(nodeSet).sort();
    const idx = new Map(); nodes.forEach((n, k) => idx.set(n, k));
    const n = nodes.length;
    const A = Array.from({ length: n }, () => Array.from({ length: n }, () => [0, 0]));
    const rhs = Array.from({ length: n }, () => [0, 0]);
    for (let k = 0; k < n; k++) A[k][k][0] += GMIN;
    alive.forEach(e => {
      const ia = idx.get(e.na), ib = idx.get(e.nb), y = e.y;
      A[ia][ia] = add(A[ia][ia], y); A[ib][ib] = add(A[ib][ib], y);
      A[ia][ib] = sub(A[ia][ib], y); A[ib][ia] = sub(A[ib][ia], y);
    });
    groups.forEach(g => {
      const nd = g.nodes, Y = g.Y;
      for (let k = 0; k < nd.length; k++) {
        const ia = idx.get(nd[k][0]), ib = idx.get(nd[k][1]);
        for (let j = 0; j < nd.length; j++) {
          const y = Y[k][j], ja = idx.get(nd[j][0]), jb = idx.get(nd[j][1]);
          A[ia][ja] = add(A[ia][ja], y); A[ia][jb] = sub(A[ia][jb], y);
          A[ib][ja] = sub(A[ib][ja], y); A[ib][jb] = add(A[ib][jb], y);
        }
      }
    });
    srcs.forEach(s => {
      const pa = find(s.p), na = find(s.n);
      if (idx.has(pa) && idx.has(na) && pa !== na) {
        const inj = mul(s.V, [1.0 / R_SRC, 0]);
        rhs[idx.get(pa)] = add(rhs[idx.get(pa)], inj); rhs[idx.get(na)] = sub(rhs[idx.get(na)], inj);
      }
    });
    let x;
    try { x = n ? solveDense(A, rhs) : []; } catch (e) { x = Array.from({ length: n }, () => [0, 0]); }
    const vn = new Map(); nodes.forEach((nd, k) => vn.set(nd, x[k]));
    const V = t => vn.get(find(t)) || ZERO;
    const res = { V, i: {}, src_i: {}, gi: {}, gv: {} };
    groups.forEach(g => {
      const vv = g.nodes.map(([na, nb]) => sub(vn.get(na), vn.get(nb)));
      g.names.forEach((name, k) => {
        res.gv[name] = vv[k];
        let cur = [0, 0]; for (let j = 0; j < vv.length; j++) cur = add(cur, mul(g.Y[k][j], vv[j]));
        res.gi[name] = cur;
      });
    });
    els.forEach(e => {
      res.i[e.name] = (idx.has(find(e.a)) && idx.has(find(e.b))) ? mul(sub(V(e.a), V(e.b)), e.y) : [0, 0];
    });
    srcs.forEach(s => {
      const pa = find(s.p), na = find(s.n);
      if (idx.has(pa) && idx.has(na) && pa !== na) res.src_i[s.name] = div(sub(s.V, sub(vn.get(pa), vn.get(na))), [R_SRC, 0]);
      else if (pa === na) res.src_i[s.name] = div(s.V, [R_SRC, 0]);
      else res.src_i[s.name] = [0, 0];
    });
    return res;
  }

  const tv = (res, a, b) => sub(res.V(a), res.V(b));

  // ---- top level ----
  function simulate(wires, sw, ctl) {
    const S = sources(ctl);
    const sAc = S.map(s => Object.assign({}, s, { V: s.kind === "ac" ? s.V : [0, 0] }));
    const sDc = S.map(s => Object.assign({}, s, { V: s.kind === "dc" ? s.V : [0, 0] }));
    const used = txUsed(wires);
    const ac = analyse(wires, passives(ctl, sw, true), sAc, txGroups(used, ctl, true));
    const dc = analyse(wires, passives(ctl, sw, false), sDc, txGroups(used, ctl, false));
    const warn = [], readings = {};

    METERS.forEach(m => {
      let best = null;
      m.ranges.forEach(([term, rng]) => {
        const name = "m:" + term;
        let ia, idc;
        if (m.kind === "A") { ia = ac.i[name]; idc = dc.i[name][0]; }
        else { ia = tv(ac, term, m.com); idc = tv(dc, term, m.com)[0]; }
        const val = m.ac ? Math.sqrt(cabs(ia) ** 2 + idc ** 2) : idc;
        const score = Math.abs(val);
        if (best === null || score > best[0]) best = [score, val, term, rng];
      });
      let [score, val, term, rng] = best;
      if (score < 1e-6) { term = m.ranges[0][0]; rng = m.ranges[0][1]; val = 0.0; }
      const frac = val / rng, over = Math.abs(frac) > 1.0;
      readings[m.id] = { id: m.id, label: m.label, kind: m.kind, unit: m.unit, value: val, range: rng, term,
        frac: Math.max(-0.06, Math.min(1.08, frac)), over, neg: !m.ac && val < -1e-9 };
      if (over) warn.push(m.label + ": over range (" + fmtG(Math.abs(val)) + " " + m.unit + " > " + rng + ")");
    });

    WATTMETERS.forEach(([wid, label, k]) => {
      const iAc = ac.i["ci:" + k], iDc = dc.i["ci:" + k][0];
      const va = tv(ac, "CT264:IN.P" + k, "CT264:IN.P2"), vd = tv(dc, "CT264:IN.P" + k, "CT264:IN.P2")[0];
      let p = mul(va, conj(iAc))[0] + vd * iDc;
      if (ctl["w" + (k === 1 ? 1 : 2) + "_minus"]) p = -p;
      const frac = p / WATT_FULL;
      readings[wid] = { id: wid, label, kind: "W", unit: "W", value: p, range: WATT_FULL, term: "",
        frac: Math.max(-0.06, Math.min(1.08, frac)), over: Math.abs(frac) > 1.0, neg: p < -1e-6 };
      if (cabs(iAc) > WATT_I_MAX) warn.push(label + ": current coil " + cabs(iAc).toFixed(2) + " A > " + WATT_I_MAX + " A");
    });

    const srcsOut = [];
    S.forEach(s => {
      const cur = s.kind === "ac" ? ac.src_i[s.name] : dc.src_i[s.name];
      const vt = s.kind === "ac" ? tv(ac, s.p, s.n) : tv(dc, s.p, s.n);
      const pw = mul(vt, conj(cur))[0];
      const over = cabs(cur) > s.rating * 1.0001;
      srcsOut.push({ name: s.name, V: cabs(vt), I: cabs(cur), P: pw, rating: s.rating, over, kind: s.kind });
      if (over) warn.push(s.name + ": " + cabs(cur).toFixed(1) + " A > rating " + s.rating + " A");
    });

    ["CT701", "CT702", "CT703"].forEach(panel => [1, 2, 3].forEach(b => {
      const L = panel + ":B" + b + ".L", R = panel + ":B" + b + ".R";
      const vb = cabs(tv(ac, L, R)), vdc = Math.abs(tv(dc, L, R)[0]);
      if (Math.max(vb, vdc) > BANK_MAX_V + 1e-6) warn.push(panel + " bank " + b + ": " + Math.max(vb, vdc).toFixed(0) + " V > " + BANK_MAX_V + " V max");
    }));
    used.forEach(t => TX_SECTIONS.forEach(([name, top, bot, volts]) => {
      const key = "tx:T" + t + ":" + name;
      const va = Math.sqrt(cabs(ac.gv[key]) ** 2 + cabs(dc.gv[key]) ** 2), ia = Math.sqrt(cabs(ac.gi[key]) ** 2 + cabs(dc.gi[key]) ** 2);
      if (va > volts * 1.05 + 0.5) warn.push("T" + t + " " + name + ": " + va.toFixed(0) + " V > " + volts.toFixed(0) + " V rated");
      if (ia > TX_I_RATED * 1.05) warn.push("T" + t + " " + name + ": " + ia.toFixed(2) + " A > " + TX_I_RATED.toFixed(1) + " A rated");
    }));
    return { readings, sources: srcsOut, warnings: warn, ac, dc };
  }

  // Python-like %.3g
  function fmtG(v) { return String(Number(Number(v).toPrecision(3))); }
  function fmt(r) {
    const v = r.value, u = r.unit;
    if (u === "A" && Math.abs(v) < 1) return (v * 1000.0).toFixed(1) + " mA";
    return Math.abs(v) < 10 ? fmtG(v) + " " + u : v.toFixed(1) + " " + u;
  }

  return { simulate, fmt, fmtG, METERS, WATTMETERS, METER_IDS };
})();
if (typeof module !== "undefined") module.exports = Sim;
