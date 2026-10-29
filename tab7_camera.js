/**
 * ==============================================================================
 * tab7_camera.js — 【カメラ】操作UI・平面/立面の描画・視界(頭被り)判定の公開
 *
 * 依存: camera_base.js (状態), camera_angle.js (計算)
 * 他モジュール向け API:
 *   tabCameraModule.getBlockedSeatIds() → Set<seatId>   選択カメラで頭被りになる客席 (tab6 が赤表示に使用)
 *   tabCameraModule.getFovSelection()   → {seatIds, guestIds, podiumIds, equipIds, itemIds, monitorIds, panelIds, screenIds} | null
 *                                       完全に画角内の客席・登壇者・司会台・機材・舞台什器・モニター・パネル・スクリーン (立面図の絞り込み)
 *   tabCameraModule.analyze(cam)        → {aim, sim}    照準・画角 / 頭被りシミュレーション
 * ==============================================================================
 */
(function () {
  'use strict';

  const U = window.Core.util;
  const { $, num } = U;
  const commit = (l) => window.Core.commit(l);
  const redraw = () => window.Core.requestRender();
  const CB = window.CameraBase;
  const CA = window.CameraAngle;

  let showFovProjection = true;          // 画角内の客席・登壇者だけを立面図に表示

  // ---------------------------------------------------------------- 計算の窓口
  function guestTargets() {
    return window.tabGuestsModule ? window.tabGuestsModule.getAimTargets() : [];
  }

  /** 照準・画角と頭被りシミュレーション。※自動ショットでは cam.fov を計算値で更新する仕様 */
  function analyze(cam) {
    if (!cam) return null;
    try {
      const aim = CA.calculateAimAndFov(cam, window.stage, guestTargets(), CB.CAMERA_MODELS);
      const sim = CA.simulateHeightClearance(cam, aim, window.seats, window.totalHeadZ, undefined, window.chair);
      return { aim, sim };
    } catch (e) {
      window.debugBox && window.debugBox.error('カメラ計算エラー: ' + e.message);
      return null;
    }
  }

  function getBlockedSeatIds() {
    const a = analyze(CB.getSelected());
    return new Set(a ? a.sim.blockedSeats.map(s => s.id) : []);
  }

  function inFov(cam, aim, px, py) {
    const half = (aim.fov / 2) * Math.PI / 180;
    let d = Math.atan2(py - cam.y, px - cam.x) - aim.hAngle;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    return Math.abs(d) <= half && Math.hypot(px - cam.x, py - cam.y) * Math.cos(d) > 0;
  }

  /**
   * 「完全に」画角内か。足跡の中心・四隅・各辺の中点のすべてが水平画角の内側にあること。
   * zr=[下,上] (mm) を渡すと、その高さの範囲も垂直画角の内側に収まっていること (現在は使っていない)。
   */
  function rectFullyInFov(cam, aim, cx, cy, w, d, angleDeg, zr) {
    const r = (angleDeg || 0) * Math.PI / 180, c = Math.cos(r), s = Math.sin(r), hw = (w || 0) / 2, hd = (d || 0) / 2;
    const pts = [[0, 0], [-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd], [0, -hd], [0, hd], [-hw, 0], [hw, 0]];
    const lens = cam.lensH || 0;
    const ground = Math.max(Math.hypot(aim.targetX - cam.x, aim.targetY - cam.y), 1);
    const thetaC = Math.atan2(aim.targetZ - lens, ground), halfV = (aim.vFov / 2) * Math.PI / 180;
    return pts.every(q => {
      const px = cx + q[0] * c - q[1] * s, py = cy + q[0] * s + q[1] * c;
      if (!inFov(cam, aim, px, py)) return false;
      if (!zr) return true;
      let diff = Math.atan2(py - cam.y, px - cam.x) - aim.hAngle;
      while (diff > Math.PI) diff -= 2 * Math.PI;
      while (diff < -Math.PI) diff += 2 * Math.PI;
      const depth = Math.max(Math.hypot(px - cam.x, py - cam.y) * Math.cos(diff), 1);       // 光軸方向の水平距離
      return zr.every(z => { const ang = Math.atan2(z - lens, depth); return ang >= thetaC - halfV - 1e-6 && ang <= thetaC + halfV + 1e-6; });
    });
  }

  function getFovSelection() {
    if (!showFovProjection) return null;
    const cam = CB.getSelected();
    const a = analyze(cam);
    if (!a) return null;
    const A = a.aim, ch = window.chair || { w: 500, d: 500 };
    const Z = (mod, fn, o) => { const m = window[mod]; return (m && m[fn]) ? m[fn](o) : null; };
    const fm = window.tabFacilityModule;
    return {
      // 客席・登壇者は高さは問わず、足跡の全体が水平画角に入っているものだけ (登壇者の足元を意図的に切る構図があるため)
      seatIds: new Set(window.seats.filter(s => rectFullyInFov(cam, A, s.x, s.y, ch.w, ch.d, s.angle, null)).map(s => s.id)),
      guestIds: new Set(window.tabGuestsModule.list.filter(g => rectFullyInFov(cam, A, g.x, g.y, 500, 500, 0, null)).map(g => g.id)),
      // それ以外の物も、平面図の扇形 (水平画角) の中に足跡の全体が入っていれば表示する (高さは問わない)
      podiumIds: new Set((window.podiums || []).filter(p => rectFullyInFov(cam, A, p.x, p.y, p.w, p.d, p.angle, null)).map(p => p.id)),
      equipIds: new Set((window.equipments || []).filter(e => rectFullyInFov(cam, A, e.x, e.y, e.w, e.d, e.angle, null)).map(e => e.id)),
      itemIds: new Set((window.stageItems || []).filter(e => rectFullyInFov(cam, A, e.x, e.y, e.w, e.shape === 'circle' ? e.w : e.d, e.angle, null)).map(e => e.id)),
      monitorIds: new Set((window.monitors || []).filter(m => rectFullyInFov(cam, A, m.x, m.y, Math.max(m.w || 0, m.baseW || 0), m.baseD || 400, m.panAngle, null)).map(m => m.id)),
      panelIds: new Set((window.panels || []).filter(p => {
        const pos = fm && fm.getPanelPos ? fm.getPanelPos(p) : { x: p.x, y: p.y };
        return rectFullyInFov(cam, A, pos.x + p.w / 2, pos.y + p.d / 2, p.w, p.d, 0, null);
      }).map(p => p.id)),
      screenIds: new Set((window.screens || []).filter(s => rectFullyInFov(cam, A, s.x, s.y, s.w, 100, s.angle, null)).map(s => s.id))
    };
  }

  // ---------------------------------------------------------------- ファインダー (カメラ位置から見た16:9の映り)
  /** ピンホール投影。aim の照準点へ向けたカメラから、ワールド座標 (x右, y手前, z上) を画面へ */
  function makeProjector(cam, aim, W, H) {
    let fx = aim.targetX - cam.x, fy = aim.targetY - cam.y, fz = aim.targetZ - (cam.lensH || 0);
    const fl = Math.hypot(fx, fy, fz) || 1; fx /= fl; fy /= fl; fz /= fl;
    let rx = -fy, ry = fx; const rl = Math.hypot(rx, ry) || 1; rx /= rl; ry /= rl;      // 画面の右 (水平)
    const ux = fy * 0 - fz * ry, uy = fz * rx - fx * 0, uz = fx * ry - fy * rx;             // 上 = F × R
    const f = (W / 2) / Math.tan(aim.fov * Math.PI / 360);
    return (x, y, z) => {
      const dx = x - cam.x, dy = y - cam.y, dz = z - (cam.lensH || 0);
      const dep = dx * fx + dy * fy + dz * fz;
      if (dep < 100) return null;                                       // カメラの後ろ・直近は描かない
      return { x: W / 2 + f * (dx * rx + dy * ry) / dep, y: H / 2 - f * (dx * ux + dy * uy + dz * uz) / dep, dep, s: f / dep };
    };
  }

  function boxCorners(cx, cy, w, d, ang, z0, z1) {
    const a = (ang || 0) * Math.PI / 180, c = Math.cos(a), sn = Math.sin(a), pts = [];
    [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(q => {
      const lx = q[0] * w / 2, ly = q[1] * d / 2;
      pts.push([cx + lx * c - ly * sn, cy + lx * sn + ly * c]);
    });
    return { pts, z0, z1 };
  }


  // ---------------------------------------------------------------- 登壇者の部位ごとの被り判定
  const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  /** 線分 p1-q1 と 線分 p2-q2 の最短距離 */
  function segSegDist(p1, q1, p2, q2) {
    const d1 = sub3(q1, p1), d2 = sub3(q2, p2), r = sub3(p1, p2);
    const a = dot3(d1, d1), e = dot3(d2, d2), f = dot3(d2, r);
    let sN, tN;
    const cl = (v) => Math.max(0, Math.min(1, v));
    if (a <= 1e-9 && e <= 1e-9) { sN = 0; tN = 0; }
    else if (a <= 1e-9) { sN = 0; tN = cl(f / e); }
    else {
      const c = dot3(d1, r);
      if (e <= 1e-9) { tN = 0; sN = cl(-c / a); }
      else {
        const b = dot3(d1, d2), den = a * e - b * b;
        sN = den > 1e-9 ? cl((b * f - c * e) / den) : 0;
        tN = (b * sN + f) / e;
        if (tN < 0) { tN = 0; sN = cl(-c / a); } else if (tN > 1) { tN = 1; sN = cl((b - c) / a); }
      }
    }
    const c1 = [p1[0] + d1[0] * sN, p1[1] + d1[1] * sN, p1[2] + d1[2] * sN], c2 = [p2[0] + d2[0] * tN, p2[1] + d2[1] * tN, p2[2] + d2[2] * tN];
    return Math.hypot(c1[0] - c2[0], c1[1] - c2[1], c1[2] - c2[2]);
  }
  /** 線分 A→B が 回転した直方体に当たるか (中心 cx,cy / 幅 w 奥行 d / 角度 / z0..z1) */
  function segHitsBox(A, B, bx) {
    const r = -(bx.ang || 0) * Math.PI / 180, c = Math.cos(r), sn = Math.sin(r);
    const loc = (P) => [(P[0] - bx.cx) * c - (P[1] - bx.cy) * sn, (P[0] - bx.cx) * sn + (P[1] - bx.cy) * c, P[2]];
    const a = loc(A), b = loc(B), lo = [-bx.w / 2, -bx.d / 2, bx.z0], hi = [bx.w / 2, bx.d / 2, bx.z1];
    let t0 = 0, t1 = 1;
    for (let i = 0; i < 3; i++) {
      const dd = b[i] - a[i];
      if (Math.abs(dd) < 1e-9) { if (a[i] < lo[i] || a[i] > hi[i]) return false; }
      else {
        let u = (lo[i] - a[i]) / dd, v = (hi[i] - a[i]) / dd;
        if (u > v) { const t = u; u = v; v = t; }
        t0 = Math.max(t0, u); t1 = Math.min(t1, v);
        if (t0 > t1) return false;
      }
    }
    return true;
  }

  /** 視線を遮る物 (客席の人・椅子、テーブル、舞台什器、司会台、機材、モニター) を球/カプセル/箱にして返す */
  function buildBlockers() {
    const st = window.stage, inSt = (x, y) => window.isInsideStage(x, y);
    const caps = [], boxes = [];
    const ch = window.chair || { w: 500, d: 500, h: 420, backH: 400 }, headZ = window.totalHeadZ || 1270;
    (window.seats || []).forEach(sd => {
      const bz = inSt(sd.x, sd.y) ? st.h : 0, r = (sd.angle || 0) * Math.PI / 180;
      const bx = sd.x - 40 * Math.sin(r), by = sd.y + 40 * Math.cos(r);           // 胴は椅子の背側へ寄る
      caps.push({ a: [bx, by, bz + headZ - 110], b: [bx, by, bz + headZ - 110], r: 105 });                    // 頭
      caps.push({ a: [bx, by, bz + ch.h + 40], b: [bx, by, bz + headZ - 260], r: 140 });                      // 胴
      const bk = [sd.x - (ch.d / 2 - 15) * Math.sin(r), sd.y + (ch.d / 2 - 15) * Math.cos(r)];
      boxes.push({ cx: bk[0], cy: bk[1], w: ch.w, d: 30, ang: sd.angle || 0, z0: bz + ch.h, z1: bz + ch.h + ch.backH });   // 背もたれ
    });
    const TS = window.tabSeatsModule;
    ((TS && TS.getTables && TS.getTables()) || []).forEach(tb => {
      const bz = inSt(tb.x, tb.y) ? st.h : 0;
      boxes.push({ cx: tb.x, cy: tb.y, w: tb.w, d: tb.d, ang: tb.angle || 0, z0: bz + tb.h - 40, z1: bz + tb.h });
    });
    (window.stageItems || []).forEach(it => {
      const bz = it.baseType === 'floor' ? 0 : (it.baseType === 'stage' ? st.h : (inSt(it.x, it.y) ? st.h : 0));
      const D = it.category !== 'chair' && it.shape === 'circle' ? it.w : (it.d || 450), H0 = it.h || 700;
      if (it.category === 'table') boxes.push({ cx: it.x, cy: it.y, w: it.w, d: D, ang: it.angle || 0, z0: bz + H0 - 50, z1: bz + H0 });
      else if (it.category === 'chair') boxes.push({ cx: it.x, cy: it.y, w: it.w, d: D, ang: it.angle || 0, z0: bz + H0 - 40, z1: bz + H0 });
      else boxes.push({ cx: it.x, cy: it.y, w: it.w, d: D, ang: it.angle || 0, z0: bz, z1: bz + H0 });
    });
    (window.podiums || []).filter(p => p.enabled).forEach(p => { const bz = inSt(p.x, p.y) ? st.h : 0; boxes.push({ cx: p.x, cy: p.y, w: p.w, d: p.d, ang: p.angle || 0, z0: bz, z1: bz + p.h }); });
    (window.equipments || []).forEach(e => { const bz = (inSt(e.x, e.y) ? st.h : 0) + (e.mountH || 0); boxes.push({ cx: e.x, cy: e.y, w: e.w, d: e.d, ang: e.angle || 0, z0: bz, z1: bz + (e.h || 1000) }); });
    const MM = window.tabMonitorModule;
    (window.monitors || []).forEach(m => {
      const zr = MM && MM.getZRange ? MM.getZRange(m) : [0, m.h || 600];
      boxes.push({ cx: m.x, cy: m.y, w: m.w || 600, d: 60, ang: m.panAngle || 0, z0: zr[1] - (m.h || 600), z1: zr[1] });
    });
    return { caps, boxes };
  }

  /** 各登壇者の部位が、カメラのレンズから見えているか。vis = 見えている割合 (0〜1) */
  function computeGuestVisibility(cam) {
    const G = window.tabGuestsModule;
    if (!cam || !G || !G.getBodyParts) return [];
    const { caps, boxes } = buildBlockers();
    const L = [cam.x, cam.y, cam.lensH || 0];
    const people = G.list.map(g => ({ g, parts: G.getBodyParts(g) }));
    return people.map(pp => {
      const others = [];
      people.forEach(o => { if (o !== pp) o.parts.forEach(q => others.push({ a: q.a, b: q.b, r: q.r })); });
      pp.parts.forEach(pt => {
        const n = (pt.a[0] === pt.b[0] && pt.a[1] === pt.b[1] && pt.a[2] === pt.b[2]) ? 1 : 5;
        let seen = 0;
        for (let i = 0; i < n; i++) {
          const t = n === 1 ? 0.5 : (i + 0.5) / n;
          const T = [pt.a[0] + (pt.b[0] - pt.a[0]) * t, pt.a[1] + (pt.b[1] - pt.a[1]) * t, pt.a[2] + (pt.b[2] - pt.a[2]) * t];
          const dv = sub3(T, L), dl = Math.hypot(dv[0], dv[1], dv[2]) || 1, cut = Math.min(pt.r + 60, dl * 0.5);
          const E = [T[0] - dv[0] / dl * cut, T[1] - dv[1] / dl * cut, T[2] - dv[2] / dl * cut];     // 部位自身の手前で止める
          let blocked = false;
          for (let k = 0; k < caps.length && !blocked; k++) { const c = caps[k]; if (segSegDist(L, E, c.a, c.b) < c.r) blocked = true; }
          for (let k = 0; k < others.length && !blocked; k++) { const c = others[k]; if (segSegDist(L, E, c.a, c.b) < c.r) blocked = true; }
          for (let k = 0; k < boxes.length && !blocked; k++) if (segHitsBox(L, E, boxes[k])) blocked = true;
          if (!blocked) seen++;
        }
        pt.vis = seen / n;
      });
      return { guest: pp.g, parts: pp.parts };
    });
  }

  /** 被りの要約: [{ name: '登壇者 1', hidden: ['左膝', ...], partial: [...] }] */
  function summarizeOcclusion(vis) {
    return vis.map(v => ({
      name: v.guest.name || v.guest.id,
      hidden: v.parts.filter(p => p.vis < 0.4).map(p => p.name),
      partial: v.parts.filter(p => p.vis >= 0.4 && p.vis < 1).map(p => p.name)
    }));
  }

  /** ファインダー(別ウィンドウ)の描画。会場の物は客席・テーブル・什器・モニターまで全て立体で描く */
  function renderFinder(cam, a, target) {
    const cv = target || document.getElementById('finderCanvas');
    if (!cv) return;
    const win = document.getElementById('finder-win');
    if (!target && win && win.classList.contains('min')) return;
    const g = cv.getContext('2d'), W = cv.width, H = cv.height;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = '#f6f8fb'; g.fillRect(0, 0, W, H);
    const title = target ? null : document.getElementById('finderTitle');
    if (!cam || !a) { if (title) title.textContent = ''; g.fillStyle = '#64748b'; g.font = '14px sans-serif'; g.textAlign = 'center'; g.fillText('カメラがありません', W / 2, H / 2); return; }
    if (title) title.textContent = cam.name + '  H-FOV ' + a.aim.fov.toFixed(1) + '° / f ' + CA.focalFromFov(a.aim.fov, CB.getSensorW(cam)).toFixed(1) + 'mm / レンズ高 ' + Math.round(cam.lensH) + 'mm';
    const P = makeProjector(cam, a.aim, W, H);
    // 地平線より下を床色に
    const hz = P(cam.x + Math.cos(a.aim.hAngle) * 1e6, cam.y + Math.sin(a.aim.hAngle) * 1e6, cam.lensH || 0);
    if (hz) { g.fillStyle = '#e8ecf2'; g.fillRect(0, Math.max(0, hz.y), W, H); }
    const st = window.stage, items = [];
    const inSt = (x, y) => window.isInsideStage(x, y);
    const rot = (cx, cy, ang, lx, ly) => { const r = (ang || 0) * Math.PI / 180; return [cx + lx * Math.cos(r) - ly * Math.sin(r), cy + lx * Math.sin(r) + ly * Math.cos(r)]; };
    const add = (cx, cy, w, d, ang, z0, z1, fill, stroke) => items.push(Object.assign(boxCorners(cx, cy, w, d, ang, z0, z1), { fill, stroke }));
    add(st.x + st.w / 2, st.y + st.d / 2, st.w, st.d, 0, 0, st.h, '#ffffff', '#0f172a');
    const fac = window.tabFacilityModule;
    (window.panels || []).filter(p => p.enabled !== false).forEach(p => {
      const pos = fac.getPanelPos(p), zr = fac.getPanelZRange(p);
      add(pos.x + p.w / 2, pos.y + p.d / 2, p.w, p.d, 0, zr[0], zr[1], '#aab8cc', '#334155');
    });
    (window.screens || []).forEach(sc => add(sc.x, sc.y, sc.w, 100, sc.angle || 0, sc.bottomZ, sc.bottomZ + sc.h, '#e0f2fe', '#0284c7'));
    (window.podiums || []).filter(p => p.enabled).forEach(p => {
      const bz = inSt(p.x, p.y) ? st.h : 0;
      add(p.x, p.y, p.w, p.d, p.angle || 0, bz, bz + p.h, '#dbeafe', '#2563eb');
    });
    (window.equipments || []).forEach(e => {
      const bz = (inSt(e.x, e.y) ? st.h : 0) + (e.mountH || 0);
      add(e.x, e.y, e.w, e.d, e.angle || 0, bz, bz + (e.h || 1000), '#e2e8f0', '#64748b');
    });
    // 舞台什器 (机・椅子・展示台)
    (window.stageItems || []).forEach(it => {
      const bz = it.baseType === 'floor' ? 0 : (it.baseType === 'stage' ? st.h : (inSt(it.x, it.y) ? st.h : 0));
      const D = it.category !== 'chair' && it.shape === 'circle' ? it.w : (it.d || 450), H0 = it.h || 700;
      if (it.category === 'table') add(it.x, it.y, it.w, D, it.angle || 0, bz + H0 - 50, bz + H0, '#f3e8d4', '#a07c4a');
      else if (it.category === 'chair') {
        add(it.x, it.y, it.w, D, it.angle || 0, bz + H0 - 40, bz + H0, '#e2e8f0', '#475569');
        const bk = rot(it.x, it.y, it.angle, 0, D / 2 - 12);
        add(bk[0], bk[1], it.w, 24, it.angle || 0, bz + H0, bz + H0 + (it.chairType === 'high' ? 220 : 320), '#cbd5e1', '#475569');
      } else add(it.x, it.y, it.w, D, it.angle || 0, bz, bz + H0, '#fde68a', '#b45309');
    });
    // モニター
    const MM = window.tabMonitorModule;
    (window.monitors || []).forEach(m => {
      const zr = MM && MM.getZRange ? MM.getZRange(m) : [0, (m.h || 600)];
      const bw = m.baseW || 400, bd = m.baseD || 400;
      if (m.stand === 'low') add(m.x, m.y, bw, bd, m.panAngle || 0, zr[0] + 40, zr[0] + 80, '#64748b', '#334155');
      add(m.x, m.y, m.w || 600, 60, m.panAngle || 0, zr[1] - (m.h || 600), zr[1], '#0f172a', '#38bdf8');
    });
    // テーブル (客席側)
    const TS = window.tabSeatsModule;
    const tables = TS && TS.getTables ? TS.getTables() : [];
    tables.forEach(tb => {
      const bz = inSt(tb.x, tb.y) ? st.h : 0;
      add(tb.x, tb.y, tb.w, tb.d, tb.angle || 0, bz + tb.h - 40, bz + tb.h, '#f3e8d4', '#a07c4a');
      [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(q => {
        const c = rot(tb.x, tb.y, tb.angle, q[0] * (tb.w / 2 - 40), q[1] * (tb.d / 2 - 40));
        add(c[0], c[1], 40, 40, 0, bz, bz + tb.h - 40, '#d6c3a1', '#a07c4a');
      });
    });
    const quad = (pts, fill, stroke) => {
      g.beginPath(); pts.forEach((q, i) => i ? g.lineTo(q.x, q.y) : g.moveTo(q.x, q.y)); g.closePath();
      g.fillStyle = fill; g.fill(); g.strokeStyle = stroke; g.lineWidth = 1; g.stroke();
    };
    const drawables = [];
    const addBoxes = (list) => list.forEach(b => {
      const lo = b.pts.map(q => P(q[0], q[1], b.z0)), hi = b.pts.map(q => P(q[0], q[1], b.z1));
      if (lo.some(v => !v) || hi.some(v => !v)) return;
      const dep = (lo.concat(hi)).reduce((m, v) => m + v.dep, 0) / 8;
      drawables.push({ dep, draw() {
        quad(lo, b.fill, b.stroke);
        for (let i = 0; i < 4; i++) quad([lo[i], lo[(i + 1) % 4], hi[(i + 1) % 4], hi[i]], b.fill, b.stroke);
        quad(hi, b.fill, b.stroke);
      } });
    });
    addBoxes(items);

    // 登壇者: 部位ごとのカプセル (頭・首・胸・腹・腰・腕・太もも・膝・すね・足)
    const visList = computeGuestVisibility(cam), PAL = { head: '#e0b48f', neck: '#e0b48f', chest: '#1e40af', belly: '#1e3a8a', hip: '#1e293b', arm: '#2563eb', thigh: '#334155', knee: '#475569', shin: '#334155', foot: '#111827' };
    visList.forEach(v => v.parts.forEach(pt => {
      const A = P(pt.a[0], pt.a[1], pt.a[2]), B = P(pt.b[0], pt.b[1], pt.b[2]);
      if (!A || !B) return;
      const col = PAL[pt.grp] || '#1e40af';
      drawables.push({ dep: (A.dep + B.dep) / 2 - 1, draw() {
        g.lineCap = 'round'; g.lineJoin = 'round';
        g.strokeStyle = 'rgba(15,23,42,0.55)'; g.lineWidth = Math.max(1.5, pt.r * 2 * A.s + 1.5);
        g.beginPath(); g.moveTo(A.x, A.y); g.lineTo(B.x, B.y); g.stroke();
        g.strokeStyle = col; g.lineWidth = Math.max(1, pt.r * 2 * A.s - 1);
        g.beginPath(); g.moveTo(A.x, A.y); g.lineTo(B.x, B.y); g.stroke();
      } });
    }));

    // 客席: 椅子 (座面・背もたれ・脚) + 着席した観客 (胴・頭)
    const blocked = a.sim && a.sim.blockedSeats ? new Set(a.sim.blockedSeats.map(q => q.id)) : new Set();
    const ch = window.chair || { w: 500, d: 500, h: 420, backH: 400 }, headZ = window.totalHeadZ || 1270;
    (window.seats || []).forEach(sd => {
      const bz = inSt(sd.x, sd.y) ? st.h : 0, bad = blocked.has(sd.id);
      const body = bad ? '#fca5a5' : '#94a3b8', bodyLine = bad ? '#dc2626' : '#475569';
      const seatBox = [];
      const put = (lx, ly, w, d, z0, z1, fill, stroke) => { const c = rot(sd.x, sd.y, sd.angle, lx, ly); seatBox.push(Object.assign(boxCorners(c[0], c[1], w, d, sd.angle || 0, bz + z0, bz + z1), { fill, stroke })); };
      [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(q => put(q[0] * (ch.w / 2 - 25), q[1] * (ch.d / 2 - 25), 36, 36, 0, ch.h - 40, '#64748b', '#334155'));   // 脚
      put(0, 0, ch.w, ch.d, ch.h - 40, ch.h, '#cbd5e1', '#475569');                                   // 座面
      put(0, ch.d / 2 - 15, ch.w, 30, ch.h, ch.h + ch.backH, '#cbd5e1', '#475569');                    // 背もたれ (後ろ側)
      put(0, 40, Math.min(ch.w - 100, 380), 220, ch.h, headZ - 250, body, bodyLine);                   // 胴
      addBoxes(seatBox);
      const c = rot(sd.x, sd.y, sd.angle, 0, 40), hp = P(c[0], c[1], bz + headZ - 110);
      if (hp) drawables.push({ dep: hp.dep, draw() {
        g.fillStyle = bad ? '#ef4444' : '#64748b'; g.strokeStyle = bodyLine; g.lineWidth = 1;
        g.beginPath(); g.arc(hp.x, hp.y, 105 * hp.s, 0, Math.PI * 2); g.fill(); g.stroke();
      } });
    });
    drawables.sort((p, q) => q.dep - p.dep).forEach(d => d.draw());

    // 被っている部位に目印 (赤い×) と一覧
    const occ = summarizeOcclusion(visList), lines = [];
    visList.forEach((v, i) => {
      v.parts.forEach(pt => {
        if (pt.vis >= 1) return;
        const M = P((pt.a[0] + pt.b[0]) / 2, (pt.a[1] + pt.b[1]) / 2, (pt.a[2] + pt.b[2]) / 2);
        if (!M) return;
        g.strokeStyle = pt.vis < 0.4 ? '#dc2626' : '#f59e0b'; g.lineWidth = 2;
        const q = 5; g.beginPath(); g.moveTo(M.x - q, M.y - q); g.lineTo(M.x + q, M.y + q); g.moveTo(M.x + q, M.y - q); g.lineTo(M.x - q, M.y + q); g.stroke();
      });
      const o = occ[i];
      if (o.hidden.length || o.partial.length) lines.push(o.name + ': ' + (o.hidden.length ? '被り ' + o.hidden.join('・') : '') + (o.partial.length ? (o.hidden.length ? ' / ' : '') + '一部 ' + o.partial.join('・') : ''));
    });
    g.font = 'bold 12px sans-serif'; g.textAlign = 'left';
    const msgs = lines.length ? lines : ['登壇者の全身が見えています'];
    msgs.forEach((t, i) => { const y = H - 8 - (msgs.length - 1 - i) * 15; g.fillStyle = 'rgba(255,255,255,0.8)'; g.fillRect(4, y - 12, g.measureText(t).width + 8, 15); g.fillStyle = lines.length ? '#b91c1c' : '#15803d'; g.fillText(t, 8, y); });

    // 安全マージン: 余白を k 倍見込んだときの実質の枠
    if (window.displaySettings.showSafeMargin !== false) {
      const pct = window.displaySettings.safePct == null ? 20 : window.displaySettings.safePct;
      if (pct > 0) {
        const k = 1 + pct / 100, w2 = W / k, h2 = H / k;
        g.save(); g.setLineDash([8, 5]); g.strokeStyle = '#ea580c'; g.lineWidth = 2;
        g.strokeRect((W - w2) / 2, (H - h2) / 2, w2, h2);
        g.setLineDash([]); g.fillStyle = '#ea580c'; g.font = 'bold 13px sans-serif'; g.textAlign = 'left';
        g.fillText('安全マージン ' + pct + '%', (W - w2) / 2 + 6, (H - h2) / 2 + 16);
        g.restore();
      }
    }
    g.strokeStyle = 'rgba(15,23,42,0.35)'; g.lineWidth = 1;             // 中心十字
    g.beginPath(); g.moveTo(W / 2 - 10, H / 2); g.lineTo(W / 2 + 10, H / 2); g.moveTo(W / 2, H / 2 - 10); g.lineTo(W / 2, H / 2 + 10); g.stroke();
  }

  /** 書き出し用: 全カメラのファインダー画像 [{ name, canvas }] */
  function renderFinderImages(w) {
    const out = [];
    CB.getAll().forEach(cam => {
      const a = analyze(cam);
      if (!a) return;
      const cv = document.createElement('canvas');
      cv.width = w || 960; cv.height = Math.round((w || 960) * 9 / 16);
      renderFinder(cam, a, cv);
      const f = CA.focalFromFov(a.aim.fov, CB.getSensorW(cam));
      out.push({ name: cam.name, canvas: cv, info: 'H-FOV ' + a.aim.fov.toFixed(1) + '° / f ' + f.toFixed(1) + 'mm / レンズ全高 ' + Math.round(cam.lensH) + 'mm' });
    });
    return out;
  }

  /** 書き出し用: 各カメラの画角・焦点距離 */
  function getCameraReport() {
    return CB.getAll().map(cam => {
      const a = analyze(cam);
      if (!a) return null;
      const sw = CB.getSensorW(cam);
      return { name: cam.name, model: (CB.CAMERA_MODELS[cam.model] || {}).name || cam.model, hFov: a.aim.fov, vFov: a.aim.vFov, focal: CA.focalFromFov(a.aim.fov, sw), sensorW: sw, lensH: cam.lensH, baseH: (CB.getPlatformOf(cam) || { h: 0 }).h, dist: a.aim.dist, occlusion: summarizeOcclusion(computeGuestVisibility(cam)).filter(o => o.hidden.length || o.partial.length) };
    }).filter(Boolean);
  }

  // ---------------------------------------------------------------- ファインダー別ウィンドウ
  let finderWired = false;
  function syncFinderSelect() {
    const sel = document.getElementById('finderCam'); if (!sel) return;
    const all = CB.getAll(), cur = CB.getSelected();
    const key = all.map(c => c.id + c.name).join('|');
    if (sel.dataset.key !== key) { sel.innerHTML = all.map(c => '<option value="' + c.id + '">' + c.name + '</option>').join(''); sel.dataset.key = key; }
    if (cur) sel.value = cur.id;
  }
  function wireFinderWindow() {
    if (finderWired) return;
    const win = document.getElementById('finder-win'); if (!win) return;
    finderWired = true;
    const cv = document.getElementById('finderCanvas');
    const setSize = (w) => { win.style.width = w + 'px'; try { localStorage.setItem('finderW', String(w)); } catch (e) {} };
    let w0 = 320; try { w0 = parseInt(localStorage.getItem('finderW'), 10) || 320; } catch (e) {}
    setSize(w0);
    try { if (localStorage.getItem('finderMin') === '1') win.classList.add('min'); } catch (e) {}
    document.getElementById('finderCam').addEventListener('change', e => { CB.setSelectedId(e.target.value); updateUI(); redraw(); });
    document.getElementById('finderMin').addEventListener('click', () => {
      win.classList.toggle('min');
      try { localStorage.setItem('finderMin', win.classList.contains('min') ? '1' : '0'); } catch (e) {}
      document.getElementById('finderMin').textContent = win.classList.contains('min') ? '＋' : '－';
      redraw();
    });
    document.getElementById('finderSize').addEventListener('click', () => {
      const cur = parseInt(win.style.width, 10) || 320;
      setSize(cur >= 640 ? 320 : (cur >= 480 ? 640 : 480));
    });
    document.getElementById('finderMin').textContent = win.classList.contains('min') ? '＋' : '－';
    void cv;
  }

  // ---------------------------------------------------------------- UI
  function buildUI(panel) {
    wireFinderWindow();
    if (!panel) return;
    if (!panel) return;
    const modelOpts = Object.keys(CB.CAMERA_MODELS).map(k => '<option value="' + k + '">' + CB.CAMERA_MODELS[k].name + '</option>').join('');
    panel.innerHTML = `
      <div class="ui-group">
        <div class="ui-group-title"><span>🎥 カメラ機材 &amp; ショット</span><button class="btn-action sm" id="btnAddCam">＋ カメラ追加</button></div>
        <div class="ui-row full"><div class="input-box"><label>対象カメラ</label><select id="camSelect"></select></div></div>
        <div id="camSummary" class="readout"></div>
        <div class="ui-row full"><div class="input-box"><label>カメラ機種・レンズ仕様</label><select id="camModel">${modelOpts}</select></div></div>
        <div class="ui-row full">
          <div class="input-box">
            <label>撮影対象 (ショット)</label>
            <select id="camShotType">
              <option value="stage_ff">🎬 ステージ全景 (ロング)</option>
              <option value="guest_group">👥 登壇者全員 (集合)</option>
              <option value="guest_single">👤 登壇者 1人 (寄り)</option>
              <option value="manual_angle">🕹️ 手動照準・画角</option>
            </select>
          </div>
        </div>
        <div class="ui-row full hidden" id="camFramingBox"><div class="input-box"><label>構図 (どこまで映すか)</label>
          <select id="camFraming">
            <option value="FF">🧍 FF 全身 (頭〜足先)</option>
            <option value="KS">KS 膝上</option>
            <option value="WS">WS 腰上 (頭〜腰)</option>
            <option value="BS">BS 胸上</option>
            <option value="CU">CU 肩上</option>
          </select></div></div>
        <div class="ui-row full hidden" id="camTargetGuestBox"><div class="input-box"><label>ターゲット登壇者</label><select id="camTargetGuest"></select></div></div>
        <div class="ui-row full"><div class="input-box"><label>画角 (FOV: <b id="fovValDisplay">22.7</b>°)</label><input type="range" id="camFovSlider" min="0.5" max="120" step="0.1"></div></div>
        <div class="ui-row">
          <div class="input-box"><label>焦点距離 f (mm)</label><input type="number" id="camFocal" step="0.5" min="1"></div>
          <div class="input-box"><label>センサー幅 (mm)</label><input type="number" id="camSensorW" step="0.01" min="1"></div>
          <div class="input-box" id="camAutoMarginBox"><label>左右の余白 (mm)</label><input type="number" id="camAutoMargin" step="50" min="0" placeholder="既定"></div>
        </div>
        <div class="hint" id="camFocalHint"></div>
        <div class="hint">画角と距離は、カメラの<b>レンズ位置</b>を基準に計算します。焦点距離は「センサー幅 ÷ (2×tan(H-FOV÷2))」で換算します。自動ショットの左右余白は、空欄で既定値 (単独1150 / 集合1400mm) です。</div>
      </div>

      <div class="ui-group">
        <div class="ui-group-title"><span>📺 ファインダー (16:9)</span></div>
        <div class="hint">ファインダーは画面左下の別ウィンドウ (意見・デバッグBOXの上) に表示します。</div>
        <div class="ui-row">
          <label class="chk"><input type="checkbox" id="camSafe"> 安全マージンを表示</label>
          <div class="input-box"><label>余白 (%)</label><input type="number" id="camSafePct" min="0" max="60" step="5"></div>
        </div>
        <div class="hint">カメラの位置から見た映りです (ステージ・パネル・登壇者・司会台・機材・テーブル・椅子と着席した客席すべて)。破線の内側は、現場のカメラマンが余白を残して収める目安です。平面図の扇形にも同じ破線が出ます。</div>
      </div>

      <div class="ui-group hidden" id="camAngleBox">
        <div class="ui-group-title">首振り角度 (Pan / Tilt)</div>
        <div class="input-box"><label>パン (左右水平): <b id="camPanDisplay">0</b>°</label><input type="range" id="camPanSlider" min="-90" max="90" step="1"></div>
        <div class="input-box"><label>チルト (上下仰俯): <b id="camTiltDisplay">0</b>°</label><input type="range" id="camTiltSlider" min="-45" max="45" step="1"></div>
      </div>

      <div class="ui-group">
        <div class="ui-group-title">立面図 (画角内の表示)</div>
        <label class="chk"><input type="checkbox" id="camFovProj"> 完全に画角内のものだけ立面図に表示</label>
        <div id="camSliceInfo" class="hint"></div>
      </div>

      <div class="ui-group">
        <div class="ui-group-title"><span>カメラ位置</span><button class="btn-action sm btn-danger" id="btnDeleteCam">このカメラを削除</button></div>
        <div class="ui-row full"><div class="input-box"><label>載せるイントレ (台)</label><select id="camPlatform"></select></div></div>
        <div class="ui-row">
          <div class="input-box"><label>位置 X (mm)</label><input type="number" id="camX" step="100"></div>
          <div class="input-box"><label>位置 Y (mm)</label><input type="number" id="camY" step="100"></div>
          <div class="input-box"><label>レンズ高 (台の上から mm)</label><input type="number" id="camAbove" step="50"></div>
        </div>
        <div class="ui-row">
          <div class="input-box"><label>台の高さ (mm)</label><input type="number" id="camBaseH" disabled></div>
          <div class="input-box"><label>レンズ全高 = 台 + レンズ (床から)</label><input type="number" id="camH" step="50"></div>
        </div>
        <div class="hint">台に載せたカメラは、台の上だけで動かせます。<b>レンズ高は台の天板からの高さ</b>で、台の高さが自動で加算されます (例: レンズ1800 + 台400 = 全高2200)。台を低くしたり外したりすると、その分だけ全高も下がります。全高を直接入力しても、台の上からの高さに換算されます。</div>
      </div>

      <div class="ui-group">
        <div class="ui-group-title"><span>🏗️ イントレ台 (複数台のカメラを載せられます)</span><button class="btn-action sm" id="btnAddPlat">＋ 台を追加</button></div>
        <div class="ui-row full"><div class="input-box"><label>対象の台</label><select id="platSelect"></select></div></div>
        <div class="hint" id="platCamList"></div>
        <div class="ui-row full"><div class="input-box"><label>名称</label><input type="text" id="platName"></div></div>
        <div class="ui-row">
          <div class="input-box"><label>中心 X (mm)</label><input type="number" id="platX" step="100"></div>
          <div class="input-box"><label>中心 Y (mm)</label><input type="number" id="platY" step="100"></div>
        </div>
        <div class="ui-row">
          <div class="input-box"><label>台幅 W (mm)</label><input type="number" id="platW" step="100"></div>
          <div class="input-box"><label>台奥 D (mm)</label><input type="number" id="platD" step="100"></div>
          <div class="input-box"><label>台高 H (mm)</label><input type="number" id="platH" step="50"></div>
        </div>
        <div class="ui-row">
          <div class="input-box">
            <label>配置の基準</label>
            <select id="camAlignRef">
              <option value="lastRow">最後尾席の後ろ脚から</option>
              <option value="backWall">会場の後壁から</option>
              <option value="stageFront">ステージ前縁から</option>
            </select>
          </div>
          <div class="input-box"><label>基準からの距離 (mm)</label><input type="number" id="camDistFromLastRow" value="2000" step="100"></div>
          <button class="btn-action" id="btnAlignLastRow">この基準で配置</button>
        </div>
        <div class="hint">距離は、基準から台(台なしならカメラ)の一番近い辺までです。後壁からは台の後ろの辺までの距離になります。左右は上の「中心 X」で指定します。</div>
        <div class="ui-row" style="justify-content:flex-end"><button class="btn-action sm btn-danger" id="btnDelPlat">この台を削除 (載っているカメラは台なしに)</button></div>
      </div>`;
    bind();
    updateUI();
  }

  function bind() {
    const sel = () => CB.getSelected();

    $('btnAddCam').addEventListener('click', () => {
      CB.addCamera(window.room.w, window.stage.y, window.stage.d);
      updateUI(); redraw(); commit('カメラ追加');
    });
    $('btnDeleteCam').addEventListener('click', () => {
      if (!sel()) return;
      CB.deleteSelected();
      updateUI(); redraw(); commit('カメラ削除');
    });
    $('btnAlignLastRow').addEventListener('click', () => {
      const target = CB.getSelectedPlatform() || sel();            // 台があれば台 (載っているカメラも一緒に移動)
      if (!target) return;
      CB.alignFromRef(target, $('camAlignRef').value, num('camDistFromLastRow', 2000), { seats: window.seats, chairD: window.chair.d, room: window.room, stage: window.stage });
      updateUI(); redraw(); commit('台を基準から配置');
    });
    $('btnAddPlat').addEventListener('click', () => {
      CB.addPlatform(window.room.w, window.stage.y, window.stage.d);
      updateUI(); redraw(); commit('イントレ追加');
    });
    $('btnDelPlat').addEventListener('click', () => {
      const p = CB.getSelectedPlatform(); if (!p) return;
      CB.deletePlatform(p.id);
      updateUI(); redraw(); commit('イントレ削除');
    });
    $('platSelect').addEventListener('change', e => { CB.setSelectedPlatformId(e.target.value); updateUI(); redraw(); });
    $('camPlatform').addEventListener('change', e => {
      const c = sel(); if (!c) return;
      CB.assignCamera(c, e.target.value);
      if (c.platformId) CB.setSelectedPlatformId(c.platformId);
      updateUI(); redraw(); commit('カメラの台を変更');
    });
    $('camSelect').addEventListener('change', e => { CB.setSelectedId(e.target.value); updateUI(); redraw(); });

    $('camModel').addEventListener('change', e => {
      const c = sel(); if (!c) return;
      c.model = e.target.value;
      const def = CB.CAMERA_MODELS[c.model];
      if (def) c.fov = Math.max(def.minFov, Math.min(def.maxFov, c.fov || 22.7));
      updateUI(); redraw(); commit('カメラ機種');
    });
    $('camShotType').addEventListener('change', e => {
      const c = sel(); if (!c) return;
      c.shotType = e.target.value;
      updateUI(); redraw(); commit('ショットタイプ');
    });
    $('camFraming').addEventListener('change', e => {
      const c = sel(); if (!c) return;
      c.framing = e.target.value;
      updateUI(); redraw(); commit('構図');
    });
    $('camTargetGuest').addEventListener('change', e => {
      const c = sel(); if (!c) return;
      c.targetGuestId = e.target.value;
      updateUI(); redraw(); commit('ターゲット登壇者');
    });

    // スライダー: input でライブ反映、change で履歴確定
    [['camFovSlider', 'fov', 22.7], ['camPanSlider', 'pan', 0], ['camTiltSlider', 'tilt', 0]].forEach(([id, prop, def]) => {
      $(id).addEventListener('input', e => { const c = sel(); if (!c) return; c[prop] = parseFloat(e.target.value) || def; updateUI(true); redraw(); });
      $(id).addEventListener('change', () => commit('カメラ角度'));
    });

    // 焦点距離・センサー幅・自動ショットの余白
    const isManualShot = (c) => c.shotType === 'manual_angle' || c.shotType === 'manual';
    $('camFocal').addEventListener('change', () => {
      const c = sel(); if (!c || !isManualShot(c)) return;
      const def = CB.CAMERA_MODELS[c.model] || { minFov: 0.5, maxFov: 120 };
      const fov = CA.fovFromFocal(num('camFocal', 0), CB.getSensorW(c));
      if (fov > 0) c.fov = Math.max(def.minFov, Math.min(def.maxFov, fov));
      updateUI(); redraw(); commit('焦点距離');
    });
    $('camSensorW').addEventListener('change', () => {
      const c = sel(); if (!c) return;
      const v = num('camSensorW', 0), std = (CB.CAMERA_MODELS[c.model] || {}).sensorW;
      c.sensorW = (v > 0 && v !== std) ? v : null;
      updateUI(); redraw(); commit('センサー幅');
    });
    $('camAutoMargin').addEventListener('change', () => {
      const c = sel(); if (!c) return;
      const raw = $('camAutoMargin').value.trim();
      c.autoMargin = raw === '' ? null : Math.max(0, num('camAutoMargin', 0));
      updateUI(); redraw(); commit('自動ショットの余白');
    });
    $('camSafe').addEventListener('change', e => { window.displaySettings.showSafeMargin = e.target.checked; updateUI(true); redraw(); commit('安全マージン'); });
    $('camSafePct').addEventListener('change', e => { window.displaySettings.safePct = Math.max(0, Math.min(60, num('camSafePct', 20))); updateUI(true); redraw(); commit('安全マージン'); });

    // カメラの絶対位置・レンズ高 (台に載っていれば台の上のずれ・天板からの高さとして記録される)
    ['camX', 'camY'].forEach(id => $(id).addEventListener('change', () => {
      const c = sel(); if (!c) return;
      CB.moveCameraTo(c, num('camX', c.x), num('camY', c.y));
      updateUI(); redraw(); commit('カメラ位置');
    }));
    $('camAbove').addEventListener('change', () => {
      const c = sel(); if (!c) return;
      CB.setLensAbove(c, Math.max(0, num('camAbove', c.lensAbove)));
      updateUI(); redraw(); commit('レンズ高');
    });
    $('camH').addEventListener('change', () => {
      const c = sel(); if (!c) return;
      CB.setLensHeight(c, Math.max(0, num('camH', c.lensH)));
      updateUI(); redraw(); commit('レンズ高');
    });

    // イントレ台。台を変えると載っているカメラが追従する
    ['platName', 'platX', 'platY', 'platW', 'platD', 'platH'].forEach(id => $(id).addEventListener('change', () => {
      const p = CB.getSelectedPlatform(); if (!p) return;
      p.name = $('platName').value || p.name;
      p.x = num('platX', p.x); p.y = num('platY', p.y);
      p.w = Math.max(100, num('platW', p.w)); p.d = Math.max(100, num('platD', p.d)); p.h = Math.max(0, num('platH', p.h));
      CB.syncAll();
      updateUI(); redraw(); commit('イントレ変更');
    }));

    $('camFovProj').addEventListener('change', e => { showFovProjection = e.target.checked; updateUI(true); redraw(); commit('画角内表示'); });
  }

  function summaryText(cam, a) {
    const { aim, sim } = a;
    let t = CA.generateSummaryText(cam, aim, sim, window.seats.length);
    if (aim.status === 'tele_limit') t += '\n・⚠️ 望遠端に到達 (これ以上寄れません)';
    if (aim.status === 'wide_limit') t += '\n・⚠️ 広角端に到達 (被写体が画角に収まりません)';
    return t;
  }

  /** イントレ台の欄 (カメラが0台でも更新する) */
  function updatePlatformUI(light) {
    const plats = CB.getPlatforms(), cam = CB.getSelected(), p = CB.getSelectedPlatform();
    if (!light) {
      U.fillSelect('platSelect', plats.length ? plats.map(x => ({ value: x.id, label: x.name + ' (' + CB.camerasOn(x.id).length + '台)' })) : [{ value: '', label: '※ 台がありません' }], p ? p.id : '');
      U.fillSelect('camPlatform', [{ value: '', label: '台なし (床置き三脚)' }].concat(plats.map(x => ({ value: x.id, label: x.name }))), cam ? (cam.platformId || '') : '');
    }
    ['platSelect', 'platName', 'platX', 'platY', 'platW', 'platD', 'platH', 'btnAlignLastRow', 'btnDelPlat'].forEach(id => { $(id).disabled = !p; });
    $('camPlatform').disabled = !cam;
    if (!p) { ['platName', 'platX', 'platY', 'platW', 'platD', 'platH'].forEach(id => { $(id).value = ''; }); $('platCamList').textContent = ''; return; }
    $('platSelect').value = p.id;
    $('platName').value = p.name;
    $('platX').value = Math.round(p.x); $('platY').value = Math.round(p.y);
    $('platW').value = Math.round(p.w); $('platD').value = Math.round(p.d); $('platH').value = Math.round(p.h);
    const on = CB.camerasOn(p.id);
    $('platCamList').textContent = on.length ? '載っているカメラ: ' + on.map(c => c.name).join(' / ') : '載っているカメラはありません';
  }

  /** light=true: スライダー操作中。セレクトの再構築を省く */
  function updateUI(light) {
    if (!$('camSelect')) return;
    const cam = CB.getSelected();
    const all = CB.getAll();

    if (!light) {
      U.fillSelect('camSelect', all.map(c => ({ value: c.id, label: c.name })), cam ? cam.id : '');
      U.fillSelect('camTargetGuest', window.tabGuestsModule.list.map(g => ({ value: g.id, label: g.name || g.id })), cam ? cam.targetGuestId : '');
    }

    updatePlatformUI(light);
    const ids = ['camSelect', 'camModel', 'camShotType', 'camFraming', 'camTargetGuest', 'camFovSlider', 'camPanSlider', 'camTiltSlider', 'camX', 'camY', 'camAbove', 'camH', 'camPlatform', 'btnDeleteCam'];
    ids.forEach(id => { $(id).disabled = !cam; });
    $('camFovProj').checked = showFovProjection;

    const box = $('camSummary');
    if (!cam) { box.textContent = 'カメラがありません。「＋ 追加」で作成できます。'; box.className = 'readout'; $('camSliceInfo').innerText = ''; return; }

    const a = analyze(cam);                           // ここで cam.fov が自動ショットの値に更新される
    $('camSelect').value = cam.id;
    $('camModel').value = cam.model || 'eng_std';
    $('camShotType').value = cam.shotType || 'stage_ff';
    $('camX').value = Math.round(cam.x); $('camY').value = Math.round(cam.y); $('camH').value = Math.round(cam.lensH);
    { const bp = CB.getPlatformOf ? CB.getPlatformOf(cam) : null; $('camBaseH').value = bp ? Math.round(bp.h) : 0; $('camAbove').value = Math.round(typeof cam.lensAbove === 'number' ? cam.lensAbove : cam.lensH); }
    $('camPlatform').value = cam.platformId || '';

    const def = CB.CAMERA_MODELS[cam.model] || { minFov: 0.5, maxFov: 120 };
    const manual = cam.shotType === 'manual_angle' || cam.shotType === 'manual';
    const fs = $('camFovSlider');
    fs.min = def.minFov; fs.max = def.maxFov; fs.value = cam.fov;
    fs.disabled = !manual;
    fs.title = manual ? '' : 'このショットタイプでは画角は自動計算されます';
    $('fovValDisplay').innerText = (Math.round(cam.fov * 10) / 10).toFixed(1);
    const sw = CB.getSensorW(cam), fmm = CA.focalFromFov(cam.fov, sw);
    $('camFocal').value = fmm ? Math.round(fmm * 10) / 10 : '';
    $('camFocal').disabled = !manual;
    $('camSensorW').value = sw;
    $('camAutoMargin').value = typeof cam.autoMargin === 'number' ? cam.autoMargin : '';
    $('camAutoMargin').placeholder = cam.shotType === 'guest_single' ? '既定 1150' : '既定 1400';
    $('camAutoMarginBox').classList.toggle('hidden', cam.shotType !== 'guest_single' && cam.shotType !== 'guest_group');
    $('camFocalHint').innerText = 'H-FOV ' + cam.fov.toFixed(1) + '° ≒ f ' + (fmm ? fmm.toFixed(1) : '-') + 'mm (センサー幅 ' + sw + 'mm)' + (manual ? '' : ' ※この値は自動計算です');
    $('camSafe').checked = window.displaySettings.showSafeMargin !== false;
    $('camSafePct').value = window.displaySettings.safePct != null ? window.displaySettings.safePct : 20;
    renderFinder(cam, a); syncFinderSelect();

    const guestShot = cam.shotType === 'guest_single' || cam.shotType === 'guest_group';
    $('camFramingBox').classList.toggle('hidden', !guestShot);
    $('camFraming').value = cam.framing || 'FF';
    $('camTargetGuestBox').classList.toggle('hidden', cam.shotType !== 'guest_single');
    if (cam.shotType === 'guest_single') $('camTargetGuest').value = cam.targetGuestId || (window.tabGuestsModule.list[0] || {}).id || '';
    $('camAngleBox').classList.toggle('hidden', cam.shotType !== 'manual_angle');
    if (cam.shotType === 'manual_angle') {
      $('camPanSlider').value = cam.pan || 0; $('camTiltSlider').value = cam.tilt || 0;
      $('camPanDisplay').innerText = (cam.pan > 0 ? '+' : '') + (cam.pan || 0);
      $('camTiltDisplay').innerText = (cam.tilt > 0 ? '+' : '') + (cam.tilt || 0);
    }

    if (!a) { box.textContent = '⚠️ 計算できませんでした'; box.className = 'readout bad'; return; }
    const bad = a.sim.isBlocked || a.aim.status !== 'ok';
    box.textContent = summaryText(cam, a);
    box.className = 'readout ' + (bad ? 'bad' : 'ok');
    const inSeats = window.seats.filter(s => inFov(cam, a.aim, s.x, s.y)).length;
    const inGuests = window.tabGuestsModule.list.filter(g => inFov(cam, a.aim, g.x, g.y)).length;
    $('camSliceInfo').innerText = '画角内: 客席' + inSeats + '席・登壇者' + inGuests + '名';
  }

  // ---------------------------------------------------------------- カメラ本体の形 (ENG ショルダーカメラ風)
  /** 平面図: ローカル +x がレンズ方向。実寸(mm)で描くのでズームに追従する */
  function drawCameraTop(ctx, x, y, ang, sel) {
    ctx.save();
    ctx.translate(x, y); ctx.rotate(ang); ctx.scale(1.4, 1.4);
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 40;
    const body = sel ? '#7e22ce' : '#64748b', lens = sel ? '#a855f7' : '#94a3b8';
    // 本体
    ctx.fillStyle = body;
    ctx.beginPath(); ctx.rect(-330, -210, 560, 420); ctx.fill(); ctx.stroke();
    // レンズ鏡筒 + フード
    ctx.fillStyle = lens;
    ctx.beginPath(); ctx.rect(230, -140, 330, 280); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#0f172a';
    ctx.beginPath(); ctx.rect(560, -170, 120, 340); ctx.fill();
    // ビューファインダー
    ctx.fillStyle = '#334155';
    ctx.beginPath(); ctx.rect(-180, -330, 260, 120); ctx.fill();
    ctx.restore();
  }

  /** 立面図: 台座 → 雲台 → 本体。チルト角に合わせて本体を傾ける。dirY: +1=右向き / -1=左向き */
  function drawCameraSide(ctx, y, lensH, tiltRad, dirY, sel) {
    ctx.save();
    ctx.translate(y, -lensH);
    if (dirY < 0) ctx.scale(-1, 1);
    ctx.rotate(-tiltRad);                      // 上向き(正)で前が持ち上がる
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 30;
    ctx.fillStyle = sel ? '#7e22ce' : '#64748b';
    ctx.beginPath(); ctx.rect(-330, -210, 560, 420); ctx.fill(); ctx.stroke();
    ctx.fillStyle = sel ? '#a855f7' : '#94a3b8';
    ctx.beginPath(); ctx.rect(230, -140, 330, 280); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#0f172a';
    ctx.beginPath(); ctx.rect(560, -170, 120, 340); ctx.fill();
    ctx.fillStyle = '#334155';
    ctx.beginPath(); ctx.rect(-180, -330, 260, 120); ctx.fill();
    ctx.restore();
  }

  // ---------------------------------------------------------------- 描画
  function drawTop(ctx) {
    const T = window.Core.drawText, cams = CB.getAll();
    const selCam = CB.getSelected(), selId = (selCam || {}).id, showFov = window.displaySettings.showCamFov;

    // イントレ台 (カメラとは独立。先に描いて、カメラをその上に重ねる)
    const selPlatId = CB.getSelectedPlatformId();
    CB.getPlatforms().forEach(p => {
      const sel = p.id === selPlatId;
      ctx.save();
      ctx.fillStyle = sel ? 'rgba(236,72,153,0.25)' : 'rgba(203,213,225,0.4)';
      ctx.strokeStyle = sel ? '#ec4899' : '#64748b';
      ctx.lineWidth = sel ? 30 : 20;
      ctx.fillRect(p.x - p.w / 2, p.y - p.d / 2, p.w, p.d);
      ctx.strokeRect(p.x - p.w / 2, p.y - p.d / 2, p.w, p.d);
      ctx.restore();
      T(ctx, p.name + ' (H:' + Math.round(p.h) + ')', p.x + p.w / 2 + 150, p.y, { px: 10, align: 'left', color: sel ? '#be185d' : '#64748b' });
    });
    if (!cams.length) return;

    cams.forEach(cam => {
      const a = analyze(cam), sel = cam.id === selId;
      const pd = (CB.getPlatformOf(cam) || { d: 1000 }).d;

      ctx.save();

      if (a && showFov) {
        const { aim, sim } = a;
        const half = (aim.fov / 2) * Math.PI / 180, l = aim.hAngle - half, r = aim.hAngle + half;
        const dist = Math.hypot(aim.targetX - cam.x, aim.targetY - cam.y) + 3000;
        const warn = sim.isBlocked || aim.status !== 'ok';
        ctx.beginPath();
        ctx.moveTo(cam.x, cam.y);
        ctx.lineTo(cam.x + dist * Math.cos(l), cam.y + dist * Math.sin(l));
        ctx.arc(cam.x, cam.y, dist, l, r);
        ctx.closePath();
        ctx.fillStyle = warn ? 'rgba(220,38,38,0.12)' : (sel ? 'rgba(59,130,246,0.15)' : 'rgba(148,163,184,0.08)');
        ctx.fill();
        ctx.strokeStyle = warn ? '#dc2626' : (sel ? 'rgba(37,99,235,0.6)' : 'rgba(100,116,139,0.3)');
        ctx.lineWidth = sel ? 30 : 20;
        ctx.stroke();
        if (sel && window.displaySettings.showSafeMargin !== false && (window.displaySettings.safePct == null ? 20 : window.displaySettings.safePct) > 0) {
          const k = 1 + (window.displaySettings.safePct == null ? 20 : window.displaySettings.safePct) / 100;
          const hs = Math.atan(Math.tan(half) / k);                       // 余白を残したときの実質の画角 (幅を k 倍で見込む)
          ctx.save(); ctx.setLineDash([140, 90]); ctx.strokeStyle = 'rgba(234,88,12,0.8)'; ctx.lineWidth = 22;
          [aim.hAngle - hs, aim.hAngle + hs].forEach(an => { ctx.beginPath(); ctx.moveTo(cam.x, cam.y); ctx.lineTo(cam.x + dist * Math.cos(an), cam.y + dist * Math.sin(an)); ctx.stroke(); });
          ctx.restore();
        }
        ctx.beginPath();
        ctx.moveTo(cam.x, cam.y); ctx.lineTo(aim.targetX, aim.targetY);
        ctx.strokeStyle = sim.isBlocked ? '#dc2626' : '#22c55e';
        ctx.lineWidth = sel ? 35 : 20;
        ctx.stroke();
      }

      drawCameraTop(ctx, cam.x, cam.y, a ? a.aim.hAngle : -Math.PI / 2, sel);
      ctx.restore();
      T(ctx, cam.name, cam.x, cam.y + pd / 2 + 350, { px: 11, bold: true });
      if (a && sel) T(ctx, 'H-FOV ' + a.aim.fov.toFixed(1) + '° (f ' + CA.focalFromFov(a.aim.fov, CB.getSensorW(cam)).toFixed(1) + 'mm) / パン ' + a.aim.panDeg.toFixed(1) + '°', cam.x, cam.y + pd / 2 + 750, { px: 10, color: '#7c3aed' });
    });
  }

  /** 立面: イントレ台と載っているカメラ本体、選択カメラの垂直画角の上端/下端レイ・角度表示。横軸=Y */
  function drawSide(ctx) {
    const T = window.Core.drawText;
    const cam = CB.getSelected();
    const selPlatId = CB.getSelectedPlatformId();
    const DEG = 180 / Math.PI;

    // イントレ台 (独立したオブジェクト)
    CB.getPlatforms().forEach(p => {
      const sel = p.id === selPlatId;
      ctx.save();
      ctx.fillStyle = sel ? 'rgba(236,72,153,0.55)' : 'rgba(148,163,184,0.45)';
      ctx.strokeStyle = sel ? '#be185d' : '#64748b'; ctx.lineWidth = 20;
      if (p.h > 0) { ctx.fillRect(p.y - p.d / 2, -p.h, p.d, p.h); ctx.strokeRect(p.y - p.d / 2, -p.h, p.d, p.h); }
      else { ctx.beginPath(); ctx.moveTo(p.y - p.d / 2, 0); ctx.lineTo(p.y + p.d / 2, 0); ctx.stroke(); }
      ctx.restore();
      T(ctx, p.name + ' (H:' + Math.round(p.h) + ')', p.y, -p.h - 200, { px: 10, color: sel ? '#be185d' : '#64748b' });
    });

    // 選択中以外のカメラ: 三脚と本体だけ (画角線は描かない)
    CB.getAll().forEach(c => {
      if (cam && c.id === cam.id) return;
      const p = CB.getPlatformOf(c), base = p ? p.h : 0, ca = analyze(c);
      ctx.save();
      ctx.strokeStyle = '#94a3b8'; ctx.lineWidth = 25;
      ctx.beginPath(); ctx.moveTo(c.y, -base); ctx.lineTo(c.y, -c.lensH); ctx.stroke();
      ctx.restore();
      const tilt = ca ? Math.atan2(ca.aim.targetZ - c.lensH, Math.max(Math.hypot(ca.aim.targetX - c.x, ca.aim.targetY - c.y), 1)) : 0;
      drawCameraSide(ctx, c.y, c.lensH, tilt, ca && Math.sin(ca.aim.hAngle) >= 0 ? 1 : -1, false);
    });

    if (!cam) return;
    const a = analyze(cam);
    const lensH = cam.lensH || 1650;
    const camBase = (CB.getPlatformOf(cam) || { h: 0 }).h;

    ctx.save();
    ctx.strokeStyle = '#64748b'; ctx.lineWidth = 30;
    ctx.beginPath(); ctx.moveTo(cam.y, -camBase); ctx.lineTo(cam.y, -lensH); ctx.stroke();

    if (!a) { drawCameraSide(ctx, cam.y, lensH, 0, -1, true); ctx.restore(); return; }
    const { aim, sim } = a;
    const ground = Math.max(Math.hypot(aim.targetX - cam.x, aim.targetY - cam.y), 1);
    const thetaC = Math.atan2(aim.targetZ - lensH, ground), halfV = (aim.vFov / 2) * Math.PI / 180;
    const dirY = Math.sin(aim.hAngle) >= 0 ? 1 : -1;      // ステージ側(Yが減る向き)なら左向き
    drawCameraSide(ctx, cam.y, lensH, thetaC, dirY, true);

    if (window.displaySettings.showCamFov) {
      const L = 22000;
      const end = (th, len) => ({ x: cam.y + dirY * (len || L) * Math.cos(th), y: -(lensH + (len || L) * Math.sin(th)) });

      const hi = end(thetaC + halfV);
      ctx.beginPath(); ctx.moveTo(cam.y, -lensH); ctx.lineTo(hi.x, hi.y);
      ctx.strokeStyle = '#0284c7'; ctx.lineWidth = 20; ctx.setLineDash([80, 40]); ctx.stroke();

      const lo = end(thetaC - halfV);
      ctx.beginPath(); ctx.moveTo(cam.y, -lensH); ctx.lineTo(lo.x, lo.y);
      ctx.strokeStyle = sim.isBlocked ? '#dc2626' : '#2563eb';
      ctx.lineWidth = sim.isBlocked ? 40 : 30; ctx.setLineDash([]); ctx.stroke();

      // 中心線 (照準)
      const ce = end(thetaC);
      ctx.beginPath(); ctx.moveTo(cam.y, -lensH); ctx.lineTo(ce.x, ce.y);
      ctx.strokeStyle = 'rgba(34,197,94,0.7)'; ctx.lineWidth = 14; ctx.setLineDash([200, 100]); ctx.stroke();
      ctx.setLineDash([]);

      // 水平基準線 と チルト角の円弧
      const R = 2600;
      ctx.beginPath(); ctx.moveTo(cam.y, -lensH); ctx.lineTo(cam.y + dirY * (R + 900), -lensH);
      ctx.strokeStyle = '#94a3b8'; ctx.lineWidth = 10; ctx.setLineDash([60, 60]); ctx.stroke(); ctx.setLineDash([]);
      ctx.beginPath();
      // dirY=+1: 右向き→ 角度は −thetaC。左向きはπ側
      if (dirY > 0) ctx.arc(cam.y, -lensH, R, -thetaC, 0, thetaC < 0 ? true : false);
      else ctx.arc(cam.y, -lensH, R, Math.PI, Math.PI + thetaC, thetaC < 0);
      ctx.strokeStyle = '#16a34a'; ctx.lineWidth = 24; ctx.stroke();

      const dTilt = thetaC * DEG, dHi = (thetaC + halfV) * DEG, dLo = (thetaC - halfV) * DEG;
      const sgn = v => (v > 0 ? '+' : '') + v.toFixed(1) + '°';
      const mid = (th, len) => end(th, len);
      const pTilt = mid(thetaC / 2, R + 700);
      T(ctx, 'チルト ' + sgn(dTilt), pTilt.x, pTilt.y + (dTilt >= 0 ? 380 : -380), { px: 12, bold: true, color: '#15803d' });
      const pHi = mid(thetaC + halfV, 7000), pLo = mid(thetaC - halfV, 7000);
      T(ctx, '上端 ' + sgn(dHi), pHi.x, pHi.y - 350, { px: 11, bold: true, color: '#0369a1' });
      T(ctx, '下端 ' + sgn(dLo), pLo.x, pLo.y + 350, { px: 11, bold: true, color: sim.isBlocked ? '#dc2626' : '#1d4ed8' });
      T(ctx, 'V-FOV ' + aim.vFov.toFixed(1) + '° (H-FOV ' + aim.fov.toFixed(1) + '° / f ' + CA.focalFromFov(aim.fov, CB.getSensorW(cam)).toFixed(1) + 'mm)', cam.y, -lensH - 1100, { px: 12, bold: true, color: '#7c3aed' });

      // 構図: 映すべき範囲 (頭頂〜切る位置) のブラケット
      if (aim.frame) {
        const f = aim.frame, bx = aim.targetY;
        ctx.beginPath(); ctx.moveTo(bx, -f.subjectTop); ctx.lineTo(bx, -f.subjectBottom);
        ctx.strokeStyle = f.fits ? '#16a34a' : '#dc2626'; ctx.lineWidth = 30; ctx.stroke();
        [f.subjectTop, f.subjectBottom].forEach(z => {
          ctx.beginPath(); ctx.moveTo(bx - 150, -z); ctx.lineTo(bx + 150, -z); ctx.stroke();
        });
        T(ctx, f.label + (f.fits ? '' : ' ⚠切れ'), bx, -f.subjectTop - 300, { px: 11, bold: true, color: f.fits ? '#15803d' : '#dc2626' });
      } else {
        ctx.beginPath(); ctx.arc(aim.targetY, -aim.targetZ, 120, 0, Math.PI * 2);   // 照準点
        ctx.fillStyle = '#22c55e'; ctx.fill();
      }
    }
    ctx.restore();
  }

  // ---------------------------------------------------------------- 当たり判定 / ドラッグ
  function hitTest(wx, wy, view) {
    const cams = CB.getAll(), plats = CB.getPlatforms();
    if (view === 'side') {                       // 立面: 選択中カメラのレンズ → 台。奥行き(Y)方向に動かせる
      const c = CB.getSelected();
      if (c && Math.hypot(wx - c.y, wy - (c.lensH || 0)) < 400) return { type: 'camera', id: c.id, offX: wx - c.y, offY: 0 };
      for (let i = plats.length - 1; i >= 0; i--) {
        const p = plats[i];
        if (Math.abs(wx - p.y) <= p.d / 2 && wy >= -100 && wy <= (p.h || 0) + 100) return { type: 'platform', id: p.id, offX: wx - p.y, offY: 0 };
      }
      return null;
    }
    for (let i = cams.length - 1; i >= 0; i--) {         // 平面: カメラ本体を先に判定 → なければ台
      const c = cams[i];
      if (Math.hypot(wx - c.x, wy - c.y) < 450) return { type: 'camera', id: c.id, offX: wx - c.x, offY: wy - c.y };
    }
    for (let i = plats.length - 1; i >= 0; i--) {
      const p = plats[i];
      if (Math.abs(wx - p.x) <= p.w / 2 && Math.abs(wy - p.y) <= p.d / 2) return { type: 'platform', id: p.id, offX: wx - p.x, offY: wy - p.y };
    }
    return null;
  }

  function onGrab(item) {
    if (item.type === 'platform') CB.setSelectedPlatformId(item.id);
    else CB.setSelectedId(item.id);
    updateUI();
    window.Core.switchTab('camera');
    redraw();
  }

  function handleDrag(item, wx, wy, view) {
    if (item.type === 'platform') {                       // 台を動かす → 載っているカメラも一緒に動く
      const p = CB.getPlatformById(item.id);
      if (!p) return;
      if (view === 'top') CB.movePlatformTo(p, wx - item.offX, wy - item.offY);
      else CB.movePlatformTo(p, p.x, wx - item.offX);
    } else {                                              // カメラ: 台に載っていれば台の上だけで動く
      const c = CB.getById(item.id);
      if (!c) return;
      if (view === 'top') CB.moveCameraTo(c, wx - item.offX, wy - item.offY);
      else CB.moveCameraTo(c, c.x, wx - item.offX);
    }
    updateUI(true);
  }

  // ---------------------------------------------------------------- 保存 / 復元
  function exportData() {
    const d = CB.exportData();
    d.showFovProjection = showFovProjection;
    return d;
  }
  function importData(d) {
    if (!d) return;
    CB.importData(d);
    if (!Array.isArray(d) && typeof d.showFovProjection === 'boolean') showFovProjection = d.showFovProjection;
    updateUI();
  }

  window.tabCameraModule = {
    init: buildUI, drawTop, drawSide, hitTest, onGrab, handleDrag, exportData, importData,
    updateUI, analyze, getBlockedSeatIds, getFovSelection, getCameraReport, computeGuestVisibility, renderFinderImages,
    drawOverlay() { const c = CB.getSelected(); renderFinder(c, c ? analyze(c) : null); },
    refreshFinder() { const c = CB.getSelected(); syncFinderSelect(); renderFinder(c, c ? analyze(c) : null); },
    setFovProjection(v) { showFovProjection = !!v; updateUI(true); redraw(); },
    isFovProjection: () => showFovProjection
  };
  window.Core.register('camera', window.tabCameraModule, { order: 80 });

  // 他タブ (登壇者・客席・ステージなど) が確定した後に、サマリーと選択肢を最新化する
  window.Core.on('commit', () => updateUI());
})();
