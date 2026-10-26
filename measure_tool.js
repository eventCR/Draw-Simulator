/**
 * measure_tool.js — 計測ツール (Mark2)
 *   ① 2点間計測 (寸法線・複数残る)  ② ドラッグ測定 (離すと消える)  ③ 置く定規 (目盛り付き)
 *
 * 座標系: 面座標 (u, v) [mm]   平面図: u=X, v=Y   立面図: u=Y(奥行き), v=Z(高さ・上向き正)
 *
 * Mark2 での変更:
 *  - Core のレジストリに登録し、最前面の描画は drawOverlay(ctx, view, scale) で行う
 *  - 保存ファイルには含めるが、Undo 履歴には含めない (計測は図面データではないため)
 *  - 吸着対象は各モジュールの公開データ (CameraBase / tabGuestsModule / seats) を参照
 *  - 立面図の登壇者の高さは tabGuestsModule.getBaseZ / getHeadTopZ を使用
 *  - ツールバーボタンの切替は core_engine の data-action="measure" (MeasureTool.toggle) 経由
 */
window.MeasureTool = (function () {
  'use strict';

  const SNAP_PX = 12;        // オブジェクト吸着の半径 (画面px)
  const GRID_PX = 8;         // グリッド吸着の半径 (画面px)
  const HIT_PX = 10;         // 定規・寸法線の当たり判定 (画面px)
  const BAND_PX = 26;        // 定規の太さ (画面px)
  const DEFAULT_RULER_MM = 5000;

  let active = false;
  let tool = 'p2p';          // 'p2p' | 'drag' | 'ruler'
  let visible = true;
  let measures = [];         // {id, mode, a:{u,v}, b:{u,v}}
  let rulers = [];
  let order = [];            // 作成順 {t:'m'|'r', id}
  let pending = null;        // 2点間: {mode, a}
  let dragLive = null;       // ドラッグ測定: {mode, a, b}
  let rdrag = null;          // 定規ドラッグ
  let selRuler = null;
  let hover = null;          // {u, v, kind, mode}
  let lastReadout = '';
  let canvas = null;
  let panel = null;
  let seq = 0;
  let gridSnap = false;      // グリッド吸着 (既定OFF: 1m単位に勝手に丸められて寸法が合わなくなるため)

  const uid = () => 'ms' + Date.now().toString(36) + (seq++);
  const curMode = () => (window.viewMode === 'side' ? 'side' : 'top');
  const curScale = () => window.viewScale || 0.035;
  const redraw = () => window.Core.requestRender();

  // ───────── 座標変換・表示 ─────────
  function toPlane(e) {
    const r = canvas.getBoundingClientRect();
    const mx = e.clientX - r.left;
    const my = e.clientY - r.top;
    const s = curScale();
    const u = (mx - window.panX) / s;
    const v = curMode() === 'top'
      ? (my - window.panY) / s
      : -((my - window.panY) / s - (window.sideFloorOffsetY || 8000));
    return { u, v };
  }

  // 寸法は mm まで正確に表示する (オブジェクトの寸法と見比べられるように丸めない)
  function fmt(mm) { return Math.round(mm).toLocaleString('en-US') + 'mm'; }
  // 定規の目盛り用の短い表記
  function fmtTick(mm) {
    const a = Math.abs(mm);
    return a >= 1000 ? (Math.round(mm / 10) / 100) + 'm' : Math.round(mm) + 'mm';
  }

  function describe(m, a, b) {
    const du = Math.abs(b.u - a.u), dv = Math.abs(b.v - a.v);
    const len = Math.hypot(du, dv);
    return m === 'top'
      ? `${fmt(len)} (ΔX ${fmt(du)} / ΔY ${fmt(dv)})`
      : `${fmt(len)} (奥行 ${fmt(du)} / 高さ ${fmt(dv)})`;
  }

  // ───────── 吸着 ─────────
  function snapPoints(m) {
    const pts = [];
    const top = m === 'top';
    const add = (u, v, k) => { if (Number.isFinite(u) && Number.isFinite(v)) pts.push({ u, v, kind: k }); };
    const st = window.stage, room = window.room;
    const headZ = window.totalHeadZ || 1270;

    if (room) {
      if (top) {
        if (Array.isArray(room.points) && room.points.length) room.points.forEach(p => add(p.x, p.y, 'room'));
        else [[0, 0], [room.w, 0], [0, room.d], [room.w, room.d]].forEach(p => add(p[0], p[1], 'room'));
      }
      else [0, room.d].forEach(y => { add(y, 0, 'room'); if (room.h) add(y, room.h, 'room'); });
    }
    if (st) {
      if (top) {
        [[st.x, st.y], [st.x + st.w, st.y], [st.x, st.y + st.d], [st.x + st.w, st.y + st.d]].forEach(p => add(p[0], p[1], 'stage'));
      } else {
        [st.y, st.y + st.d].forEach(y => { add(y, 0, 'stage'); add(y, st.h || 0, 'stage'); });
      }
    }
    (window.CameraBase && window.CameraBase.getAll ? window.CameraBase.getAll() : []).forEach(c => {
      const pw = Number.isFinite(c.platW) ? c.platW : 1000, pd = Number.isFinite(c.platD) ? c.platD : 1000;
      if (top) {
        add(c.x, c.y, 'camera');
        [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(k => add(c.x + k[0] * pw / 2, c.y + k[1] * pd / 2, 'camera'));
      } else {
        add(c.y, c.lensH, 'camera');                 // レンズ
        add(c.y, c.platH || 0, 'camera');            // 台の上面
        add(c.y, 0, 'camera');                       // 床
      }
    });
    const gm = window.tabGuestsModule;
    const guests = gm && Array.isArray(gm.list) ? gm.list : [];
    guests.forEach(g => {
      if (top) { add(g.x, g.y, 'guest'); return; }
      add(g.y, gm.getBaseZ ? gm.getBaseZ(g) : 0, 'guest');                           // 足元/床
      if (gm.getHeadTopZ) add(g.y, gm.getHeadTopZ(g), 'guest');                      // 頭頂
    });
    if (Array.isArray(window.seats)) {
      const ch = window.chair || { w: 500, d: 500, h: 420 };
      window.seats.forEach(s => {
        if (top) { add(s.x, s.y, 'seat'); addRect(s.x, s.y, ch.w, ch.d, s.angle, 'seat'); }
        else { addRectSide(s.x, s.y, ch.w, ch.d, s.angle, 0, ch.h, 'seat'); add(s.y, headZ, 'seat'); }
      });
    }
    // 舞台・会場の各オブジェクト: 角と中心 (回転を考慮)
    const stageH = (st && st.h) || 0;
    const onStage = (x, y) => (typeof window.isInsideStage === 'function') ? window.isInsideStage(x, y) : false;
    (window.podiums || []).forEach(o => { if (o.enabled !== false) obj(o.x, o.y, o.w, o.d, o.angle, o.h, onStage(o.x, o.y) ? stageH : 0, 'podium'); });
    (window.stageItems || []).forEach(o => {
      const base = o.baseType === 'floor' ? 0 : (o.baseType === 'stage' ? stageH : (onStage(o.x, o.y) ? stageH : 0));
      obj(o.x, o.y, o.w, o.shape === 'circle' ? o.w : o.d, o.angle, o.h, base, 'item', o.shape === 'circle');
    });
    (window.equipments || []).forEach(o => obj(o.x, o.y, o.w, o.d, o.angle, o.h, onStage(o.x, o.y) ? stageH : 0, 'equip'));
    (window.monitors || []).forEach(o => {
      obj(o.x, o.y, o.baseW || o.w, o.baseD || o.d || 400, o.panAngle, 0, o.placeOn === 'stage' ? stageH : 0, 'monitor');
    });
    const fm = window.tabFacilityModule;
    (window.panels || []).forEach(p => {
      if (p.enabled === false) return;
      const pos = fm && fm.getPanelPos ? fm.getPanelPos(p) : { x: p.x, y: p.y };
      if (!pos) return;
      obj(pos.x + p.w / 2, pos.y + p.d / 2, p.w, p.d, 0, p.h, p.posType === 'behind_stage' && !p.customPos ? 0 : stageH, 'panel');
    });
    return pts;

    // ---- 以下、スナップ点の追加ヘルパー (関数宣言なので上から参照できる) ----
    function corners(cx, cy, w, d, ang) {
      const r = (ang || 0) * Math.PI / 180, c = Math.cos(r), sn = Math.sin(r), hw = w / 2, hd = d / 2;
      return [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]].map(q => ({ x: cx + q[0] * c - q[1] * sn, y: cy + q[0] * sn + q[1] * c }));
    }
    function addRect(cx, cy, w, d, ang, k) { corners(cx, cy, w, d, ang).forEach(q => add(q.x, q.y, k)); }
    function addRectSide(cx, cy, w, d, ang, z0, h, k) {
      const ys = corners(cx, cy, w, d, ang).map(q => q.y), y0 = Math.min.apply(null, ys), y1 = Math.max.apply(null, ys);
      [y0, y1].forEach(y => { add(y, z0, k); if (h) add(y, z0 + h, k); });
    }
    function obj(cx, cy, w, d, ang, h, z0, k, circle) {
      if (!Number.isFinite(cx) || !Number.isFinite(cy) || !(w > 0)) return;
      d = d > 0 ? d : w;
      if (top) {
        add(cx, cy, k);
        if (circle) [[w / 2, 0], [-w / 2, 0], [0, w / 2], [0, -w / 2]].forEach(q => add(cx + q[0], cy + q[1], k));
        else addRect(cx, cy, w, d, ang, k);
      } else {
        addRectSide(cx, cy, w, d, circle ? 0 : ang, z0, h, k);
      }
    }
  }

  function snap(p, altKey) {
    if (altKey) return { u: p.u, v: p.v, kind: 'free' };
    const m = curMode(), s = curScale();
    let best = null, bd = SNAP_PX / s;
    snapPoints(m).forEach(q => {
      const d = Math.hypot(q.u - p.u, q.v - p.v);
      if (d < bd) { bd = d; best = q; }
    });
    if (best) return { u: best.u, v: best.v, kind: 'object' };
    if (!gridSnap) return { u: p.u, v: p.v, kind: 'free' };
    const gu = 1000, gv = (m === 'top') ? 1000 : 100;
    const su = Math.round(p.u / gu) * gu, sv = Math.round(p.v / gv) * gv;
    if (Math.abs(su - p.u) * s <= GRID_PX && Math.abs(sv - p.v) * s <= GRID_PX) return { u: su, v: sv, kind: 'grid' };
    return { u: p.u, v: p.v, kind: 'free' };
  }

  // Shift: a→p の角度を15°刻みに揃える (水平・垂直を含む)
  function constrain(a, p) {
    const du = p.u - a.u, dv = p.v - a.v, L = Math.hypot(du, dv);
    if (L < 1e-6) return { u: p.u, v: p.v, kind: 'free' };
    const step = Math.PI / 12;
    const ang = Math.round(Math.atan2(dv, du) / step) * step;
    return { u: a.u + L * Math.cos(ang), v: a.v + L * Math.sin(ang), kind: 'free' };
  }

  function segDist(p, a, b) {
    const dx = b.u - a.u, dy = b.v - a.v, l2 = dx * dx + dy * dy;
    let t = l2 > 0 ? ((p.u - a.u) * dx + (p.v - a.v) * dy) / l2 : 0;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(p.u - (a.u + t * dx), p.v - (a.v + t * dy));
  }

  // ───────── 定規の当たり判定・ドラッグ ─────────
  function hitRuler(p, m) {
    const tol = HIT_PX / curScale();
    for (let i = rulers.length - 1; i >= 0; i--) {
      const r = rulers[i];
      if (r.mode !== m) continue;
      if (Math.hypot(p.u - r.a.u, p.v - r.a.v) <= tol) return { r, part: 'a' };
      if (Math.hypot(p.u - r.b.u, p.v - r.b.v) <= tol) return { r, part: 'b' };
      if (segDist(p, r.a, r.b) <= (BAND_PX / 2) / curScale()) return { r, part: 'body' };
    }
    return null;
  }

  function startRulerDrag(raw, e, m) {
    const h = hitRuler(raw, m);
    if (h) {
      selRuler = h.r.id;
      rdrag = { type: h.part, r: h.r, start: raw, orig: { a: { ...h.r.a }, b: { ...h.r.b } }, created: false };
    } else {
      const a = snap(raw, e.altKey);
      const r = { id: uid(), mode: m, a: { u: a.u, v: a.v }, b: { u: a.u, v: a.v } };
      rulers.push(r); order.push({ t: 'r', id: r.id });
      selRuler = r.id;
      rdrag = { type: 'b', r, start: raw, orig: { a: { ...r.a }, b: { ...r.b } }, created: true };
    }
  }

  function moveRulerDrag(raw, e) {
    const d = rdrag, r = d.r;
    if (d.type === 'body') {
      const du = raw.u - d.start.u, dv = raw.v - d.start.v;
      const tgt = snap({ u: d.orig.a.u + du, v: d.orig.a.v + dv }, e.altKey);   // 始点を吸着させて全体を平行移動
      const sh = { u: tgt.u - d.orig.a.u, v: tgt.v - d.orig.a.v };
      r.a = { u: d.orig.a.u + sh.u, v: d.orig.a.v + sh.v };
      r.b = { u: d.orig.b.u + sh.u, v: d.orig.b.v + sh.v };
    } else {
      const fixed = (d.type === 'a') ? r.b : r.a;
      const p = e.shiftKey ? constrain(fixed, raw) : snap(raw, e.altKey);
      if (d.type === 'a') r.a = { u: p.u, v: p.v }; else r.b = { u: p.u, v: p.v };
    }
  }

  function endRulerDrag() {
    const d = rdrag; rdrag = null;
    if (!d) return;
    const L = Math.hypot(d.r.b.u - d.r.a.u, d.r.b.v - d.r.a.v);
    if (L * curScale() < 6) {
      if (d.created) d.r.b = { u: d.r.a.u + DEFAULT_RULER_MM, v: d.r.a.v };   // クリックだけ → 標準長の定規
      else { d.r.a = d.orig.a; d.r.b = d.orig.b; }                            // 縮めすぎ → 元に戻す
    }
  }

  function cancelRulerDrag() {
    const d = rdrag; rdrag = null;
    if (!d) return;
    if (d.created) { rulers = rulers.filter(x => x !== d.r); selRuler = null; }
    else { d.r.a = d.orig.a; d.r.b = d.orig.b; }
  }

  // ───────── イベント ─────────
  function onDown(e) {
    if (!active || e.button !== 0 || e.target !== canvas) return;
    e.preventDefault();
    const m = curMode(), raw = toPlane(e);
    if (tool === 'p2p') {
      const pt = snap(raw, e.altKey);
      if (!pending || pending.mode !== m) {
        pending = { mode: m, a: pt };
        hover = { u: pt.u, v: pt.v, kind: pt.kind, mode: m };
      } else {
        const b = e.shiftKey ? constrain(pending.a, raw) : pt;
        if (Math.hypot(b.u - pending.a.u, b.v - pending.a.v) > 1) {
          const d = { id: uid(), mode: m, a: { u: pending.a.u, v: pending.a.v }, b: { u: b.u, v: b.v } };
          measures.push(d); order.push({ t: 'm', id: d.id });
          lastReadout = describe(m, d.a, d.b);
        }
        pending = null;
      }
    } else if (tool === 'drag') {
      const a = snap(raw, e.altKey);
      dragLive = { mode: m, a, b: a };
    } else if (tool === 'ruler') {
      startRulerDrag(raw, e, m);
    }
    updatePanel(); redraw();
  }

  function onMove(e) {
    if (!active) return;
    const dragging = dragLive || rdrag;
    if (!dragging && e.target !== canvas) return;
    const m = curMode(), raw = toPlane(e);
    let pt = snap(raw, e.altKey);
    if (tool === 'p2p' && pending && pending.mode === m && e.shiftKey) pt = constrain(pending.a, raw);
    hover = { u: pt.u, v: pt.v, kind: pt.kind, mode: m };
    if (dragLive && dragLive.mode === m) dragLive.b = e.shiftKey ? constrain(dragLive.a, raw) : snap(raw, e.altKey);
    if (rdrag) moveRulerDrag(raw, e);
    redraw();
  }

  function onUp() {
    if (!active) return;
    if (dragLive) {
      const d = dragLive; dragLive = null;
      if (Math.hypot(d.b.u - d.a.u, d.b.v - d.a.v) > 1) lastReadout = describe(d.mode, d.a, d.b);
      updatePanel(); redraw();
    }
    if (rdrag) { endRulerDrag(); updatePanel(); redraw(); }
  }

  function onContext(e) {
    if (!active || e.target !== canvas) return;
    e.preventDefault();
    if (pending || dragLive || rdrag) { pending = null; dragLive = null; cancelRulerDrag(); updatePanel(); redraw(); return; }
    const m = curMode(), p = toPlane(e), tol = HIT_PX / curScale();
    const hr = hitRuler(p, m);
    if (hr) {
      rulers = rulers.filter(x => x !== hr.r);
      if (selRuler === hr.r.id) selRuler = null;
    } else {
      let best = null, bd = tol;
      measures.forEach(d => { if (d.mode === m) { const dd = segDist(p, d.a, d.b); if (dd <= bd) { bd = dd; best = d; } } });
      if (best) measures = measures.filter(x => x !== best);
    }
    redraw();
  }

  function onKey(e) {
    if (!active) return;
    const tag = (e.target && e.target.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (e.key === 'Escape') {
      if (pending || dragLive || rdrag) { pending = null; dragLive = null; cancelRulerDrag(); }
      else setActive(false);
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && selRuler) {
      rulers = rulers.filter(r => r.id !== selRuler); selRuler = null;
    }
    updatePanel(); redraw();
  }

  // ───────── パネル ─────────
  function buildPanel() {
    panel = document.createElement('div');
    panel.id = 'measure-panel';
    panel.innerHTML = `
      <div class="mp-row">
        <strong>📏 計測</strong>
        <button class="mp-btn" data-tool="p2p">2点間</button>
        <button class="mp-btn" data-tool="drag">ドラッグ測定</button>
        <button class="mp-btn" data-tool="ruler">定規</button>
        <span>|</span>
        <button class="mp-btn" data-act="undo">↩ 直前を消す</button>
        <button class="mp-btn" data-act="clear">全消去</button>
        <label><input type="checkbox" id="mp-visible" checked> 表示</label>
        <label><input type="checkbox" id="mp-grid"> グリッド吸着(1m)</label>
        <button class="mp-btn" data-act="close">✕ 終了</button>
      </div>
      <div class="mp-hint" id="mp-hint"></div>
      <div class="mp-readout" id="mp-readout"></div>`;
    (document.getElementById('main-container') || document.body).appendChild(panel);

    panel.querySelectorAll('[data-tool]').forEach(b => b.addEventListener('click', () => setTool(b.dataset.tool)));
    panel.querySelectorAll('[data-act]').forEach(b => b.addEventListener('click', () => {
      if (b.dataset.act === 'undo') undoLast();
      else if (b.dataset.act === 'clear') clearCurrent();
      else setActive(false);
    }));
    const cb = panel.querySelector('#mp-visible');
    if (cb) cb.addEventListener('change', e => { visible = !!e.target.checked; redraw(); });
    const gb = panel.querySelector('#mp-grid');
    if (gb) gb.addEventListener('change', e => { gridSnap = !!e.target.checked; });
  }

  function updatePanel() {
    if (!panel) return;
    panel.querySelectorAll('[data-tool]').forEach(b => b.classList.toggle('on', b.dataset.tool === tool));
    const hints = {
      p2p: pending
        ? '2点目をクリック (Shift: 15°刻み / Alt: 吸着なし / 右クリック: キャンセル)'
        : '1点目をクリック。カメラ・登壇者・席・各オブジェクトの角と中心・ステージ角に吸着します (右クリック: 寸法線を削除)',
      drag: 'ドラッグしている間だけ、長さと角度を表示します (Shift: 15°刻み / Alt: 吸着なし)',
      ruler: '空いた所をクリック/ドラッグで定規を置く。端点で長さ・角度、本体で移動、右クリックまたはDeleteで削除'
    };
    const h = document.getElementById('mp-hint');
    if (h) h.innerText = hints[tool] || '';
    const r = document.getElementById('mp-readout');
    if (r) r.innerText = lastReadout ? ('直前の計測: ' + lastReadout) : '';
  }

  function setTool(t) {
    tool = t; pending = null; dragLive = null; cancelRulerDrag();
    updatePanel(); redraw();
  }

  function setActive(on) {
    active = !!on;
    pending = null; dragLive = null; rdrag = null; hover = null;
    if (canvas) canvas.style.cursor = active ? 'crosshair' : '';
    if (panel) panel.style.display = active ? 'flex' : 'none';
    const btn = document.getElementById('btn-measure');
    if (btn) btn.classList.toggle('active', active);
    updatePanel(); redraw();
  }

  function undoLast() {
    const m = curMode();
    for (let i = order.length - 1; i >= 0; i--) {
      const o = order[i];
      const list = o.t === 'm' ? measures : rulers;
      const item = list.find(x => x.id === o.id);
      order.splice(i, 1);
      if (item && item.mode === m) {
        if (o.t === 'm') measures = measures.filter(x => x !== item); else rulers = rulers.filter(x => x !== item);
        if (selRuler === item.id) selRuler = null;
        break;
      }
    }
    redraw();
  }

  function clearCurrent() {
    const m = curMode();
    if (!measures.some(x => x.mode === m) && !rulers.some(x => x.mode === m)) return;
    if (typeof confirm === 'function' && !confirm('この表示(' + (m === 'top' ? '平面図' : '立面図') + ')の計測と定規をすべて消しますか？')) return;
    measures = measures.filter(x => x.mode !== m);
    rulers = rulers.filter(x => x.mode !== m);
    selRuler = null;
    redraw();
  }

  // ───────── 描画 (面座標 → キャンバス座標。立面図は y = -v) ─────────
  function drawDim(ctx, a, b, s, Y, opt) {
    const px = n => n / s;
    const A = { x: a.u, y: Y(a.v) }, B = { x: b.u, y: Y(b.v) };
    const du = Math.abs(b.u - a.u), dv = Math.abs(b.v - a.v), len = Math.hypot(du, dv);
    ctx.save();
    ctx.strokeStyle = opt.color; ctx.fillStyle = opt.color; ctx.lineWidth = px(2);
    if (opt.dashed) ctx.setLineDash([px(6), px(4)]);
    ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.lineTo(B.x, B.y); ctx.stroke();
    ctx.setLineDash([]);
    [A, B].forEach(P => { ctx.beginPath(); ctx.arc(P.x, P.y, px(4), 0, Math.PI * 2); ctx.fill(); });

    const l1 = fmt(len) + (opt.showAngle ? `  ∠${(Math.atan2(dv, du) * 180 / Math.PI).toFixed(1)}°` : '');
    const l2 = opt.mode === 'top' ? `ΔX ${fmt(du)} / ΔY ${fmt(dv)}` : `奥行 ${fmt(du)} / 高さ ${fmt(dv)}`;
    const fs1 = px(12), fs2 = px(11), lh = px(15);
    ctx.font = `bold ${fs1}px sans-serif`; const w1 = ctx.measureText(l1).width;
    ctx.font = `${fs2}px sans-serif`; const w2 = ctx.measureText(l2).width;
    const w = Math.max(w1, w2) + px(12), h = lh * 2 + px(6);

    const dx = B.x - A.x, dy = B.y - A.y, L = Math.hypot(dx, dy);
    let nx = L > 0 ? -dy / L : 0, ny = L > 0 ? dx / L : -1;
    if (ny > 0) { nx = -nx; ny = -ny; }                      // ラベルは線の「上側」へ
    const mx = (A.x + B.x) / 2, my = (A.y + B.y) / 2;
    const cx = mx + nx * (px(14) + h / 2), cy = my + ny * (px(14) + h / 2);
    ctx.fillStyle = 'rgba(255,255,255,0.93)'; ctx.strokeStyle = opt.color; ctx.lineWidth = px(1);
    ctx.fillRect(cx - w / 2, cy - h / 2, w, h); ctx.strokeRect(cx - w / 2, cy - h / 2, w, h);
    ctx.fillStyle = '#0f172a'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = `bold ${fs1}px sans-serif`; ctx.fillText(l1, cx, cy - lh / 2);
    ctx.font = `${fs2}px sans-serif`; ctx.fillText(l2, cx, cy + lh / 2);
    ctx.restore();
  }

  function drawRuler(ctx, r, s, Y) {
    const px = n => n / s;
    const A = { x: r.a.u, y: Y(r.a.v) }, B = { x: r.b.u, y: Y(r.b.v) };
    const L = Math.hypot(B.x - A.x, B.y - A.y);
    if (L < 1e-6) return;
    const th = Math.atan2(B.y - A.y, B.x - A.x);
    const flip = Math.cos(th) < 0;                           // 文字が逆さまにならないように
    const editable = active && tool === 'ruler';
    const sel = editable && r.id === selRuler;
    const h = px(BAND_PX);

    ctx.save();
    ctx.translate(A.x, A.y); ctx.rotate(th);
    ctx.fillStyle = 'rgba(254, 249, 195, 0.93)';
    ctx.strokeStyle = sel ? '#2563eb' : '#a16207'; ctx.lineWidth = px(sel ? 2 : 1.2);
    ctx.fillRect(0, -h / 2, L, h); ctx.strokeRect(0, -h / 2, L, h);

    // 目盛り: 細かい目盛りは8px以上、数字付きの目盛りは60px以上の間隔
    const cand = [10, 50, 100, 250, 500, 1000, 2000, 5000, 10000, 20000];
    const minor = cand.find(c => c * s >= 8) || 20000;
    const major = cand.find(c => c % minor === 0 && c * s >= 60) || minor * 10;
    const n = Math.floor(L / minor);
    ctx.strokeStyle = '#78350f';
    ctx.lineWidth = px(1);
    ctx.beginPath();
    for (let i = 0; i <= n; i++) {
      const x = i * minor;
      if (x % major === 0) continue;
      ctx.moveTo(x, -h / 2); ctx.lineTo(x, -h / 2 + px(6));
    }
    ctx.stroke();
    ctx.lineWidth = px(1.6);
    ctx.beginPath();
    for (let i = 0; i <= n; i++) {
      const x = i * minor;
      if (x % major !== 0) continue;
      ctx.moveTo(x, -h / 2); ctx.lineTo(x, -h / 2 + px(12));
    }
    ctx.stroke();
    ctx.fillStyle = '#451a03'; ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
    ctx.font = `${px(10)}px sans-serif`;
    for (let i = 0; i <= n; i++) {
      const x = i * minor;
      if (x % major !== 0 || x > L - px(14)) continue;
      ctx.save(); ctx.translate(x, px(6)); if (flip) ctx.rotate(Math.PI);
      ctx.fillText(fmtTick(x), 0, 0);
      ctx.restore();
    }

    // 全長 (先端の外側)
    const du = Math.abs(r.b.u - r.a.u), dv = Math.abs(r.b.v - r.a.v);
    const total = `${fmt(Math.hypot(du, dv))}  ∠${(Math.atan2(dv, du) * 180 / Math.PI).toFixed(1)}°`;
    ctx.font = `bold ${px(12)}px sans-serif`; ctx.fillStyle = '#0f172a';
    ctx.save(); ctx.translate(L + px(10), 0);
    if (flip) { ctx.rotate(Math.PI); ctx.textAlign = 'right'; } else ctx.textAlign = 'left';
    ctx.fillText(total, 0, 0);
    ctx.restore();

    // 端点ハンドル (定規ツール選択中のみ)
    if (editable) {
      [0, L].forEach(x => {
        ctx.beginPath(); ctx.arc(x, 0, px(6), 0, Math.PI * 2);
        ctx.fillStyle = '#ffffff'; ctx.fill();
        ctx.strokeStyle = sel ? '#2563eb' : '#a16207'; ctx.lineWidth = px(2); ctx.stroke();
      });
    }
    ctx.restore();
  }

  function drawSnapMark(ctx, hv, s, Y) {
    const px = n => n / s;
    const P = { x: hv.u, y: Y(hv.v) };
    ctx.save();
    if (hv.kind === 'object') {
      ctx.strokeStyle = '#ea580c'; ctx.lineWidth = px(2);
      ctx.strokeRect(P.x - px(6), P.y - px(6), px(12), px(12));
    } else if (hv.kind === 'grid') {
      ctx.strokeStyle = '#475569'; ctx.lineWidth = px(1.5);
      ctx.beginPath(); ctx.moveTo(P.x - px(7), P.y); ctx.lineTo(P.x + px(7), P.y);
      ctx.moveTo(P.x, P.y - px(7)); ctx.lineTo(P.x, P.y + px(7)); ctx.stroke();
    } else {
      ctx.strokeStyle = '#64748b'; ctx.lineWidth = px(1.5);
      ctx.beginPath(); ctx.arc(P.x, P.y, px(3), 0, Math.PI * 2); ctx.stroke();
    }
    ctx.restore();
  }

  // Core の render() が最前面で呼ぶ (ctx は図面座標系・スケール済み)
  function drawOverlay(ctx, viewMode, scale) {
    if (!visible) return;
    const m = (viewMode === 'side') ? 'side' : 'top';
    const s = scale || curScale();
    const Y = v => (m === 'top' ? v : -v);
    ctx.save();
    ctx.setLineDash([]);
    measures.forEach(d => { if (d.mode === m) drawDim(ctx, d.a, d.b, s, Y, { color: '#ea580c', mode: m }); });
    rulers.forEach(r => { if (r.mode === m) drawRuler(ctx, r, s, Y); });
    if (active) {
      if (pending && pending.mode === m) {
        const b = (hover && hover.mode === m) ? hover : pending.a;
        drawDim(ctx, pending.a, b, s, Y, { color: '#2563eb', dashed: true, mode: m, showAngle: true });
      }
      if (dragLive && dragLive.mode === m) drawDim(ctx, dragLive.a, dragLive.b, s, Y, { color: '#7c3aed', dashed: true, mode: m, showAngle: true });
      if (hover && hover.mode === m) drawSnapMark(ctx, hover, s, Y);
    }
    ctx.restore();
  }

  // ───────── 初期化 (Core から DOM 構築後に呼ばれる) ─────────
  function init() {
    canvas = document.getElementById('simCanvas');
    if (!canvas) return;
    buildPanel();
    canvas.addEventListener('mousedown', onDown);
    canvas.addEventListener('contextmenu', onContext);
    canvas.addEventListener('mouseleave', () => { if (active && !dragLive && !rdrag) { hover = null; redraw(); } });
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('keydown', onKey);
    // 平面/立面の切替では途中状態を捨てる
    window.Core.on('view', () => { pending = null; dragLive = null; rdrag = null; hover = null; updatePanel(); });
    updatePanel();
  }

  const api = {
    init,
    isActive: () => active,
    toggle: () => setActive(!active),
    setActive, setTool,
    drawOverlay,
    undoLast, clearCurrent,
    setVisible: v => { visible = !!v; redraw(); },
    // 保存ファイルには含めるが、Undo 履歴には含めない
    exportData: (opts) => (opts && opts.forHistory) ? undefined : JSON.parse(JSON.stringify({ measures, rulers })),
    importData: (d) => {
      if (!d) return;
      measures = Array.isArray(d.measures) ? JSON.parse(JSON.stringify(d.measures)) : [];
      rulers = Array.isArray(d.rulers) ? JSON.parse(JSON.stringify(d.rulers)) : [];
      order = []; selRuler = null; redraw();
    }
  };
  window.Core.register('measure', api, { order: 1000 });
  return api;
})();
