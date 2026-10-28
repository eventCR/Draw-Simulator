/**
 * ==============================================================================
 * tab1_room.js — 【会場】外形(四角/多角形)・天井高・扉
 *
 * 所有する共有データ: window.room {w,d,h,shapeType,points[]}, window.doors[], window.selectedDoorId
 * 既定値は EQWEL 仕様 (間口15000 / 奥行23500 / 天井5000)。保存データがあればそちらが優先される。
 * ==============================================================================
 */
(function () {
  'use strict';

  const DEFAULT_W = 15000, DEFAULT_D = 23500, DEFAULT_H = 5000;

  const rectPoints = (w, d) => [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: d }, { x: 0, y: d }];
  const clone = (v) => JSON.parse(JSON.stringify(v));
  const $ = (id) => document.getElementById(id);
  const commit = (label) => window.Core.commit(label);
  const redraw = () => window.Core.requestRender();

  // ---------------------------------------------------------------- 状態
  window.room = {
    w: DEFAULT_W, d: DEFAULT_D, h: DEFAULT_H,
    shapeType: 'rect',
    points: rectPoints(DEFAULT_W, DEFAULT_D)
  };
  window.doors = [
    { id: 'D1', name: '正面主搬入口', type: 'double', width: 1800, edgeIndex: 2, offsetRatio: 0.5, status: 'open' },
    { id: 'D2', name: '上手袖扉', type: 'single_left', width: 900, edgeIndex: 1, offsetRatio: 0.15, status: 'open' }
  ];
  window.selectedDoorId = 'D1';

  // ---------------------------------------------------------------- UI
  function buildUI(panel) {
    if (!panel) return;
    panel.innerHTML = `
      <div class="ui-group">
        <div class="ui-group-title">
          <span>🏛 会場外形 &amp; 天井高</span>
          <select id="roomShapeType">
            <option value="rect">四角形 (基本)</option>
            <option value="polygon">多角形 (カスタム)</option>
          </select>
        </div>
        <div class="ui-row" id="roomBasicDimsRow">
          <div class="input-box"><label>間口幅 (W mm)</label><input type="number" id="roomW" step="500"></div>
          <div class="input-box"><label>奥行 (D mm)</label><input type="number" id="roomD" step="500"></div>
          <div class="input-box"><label>天井高 (H mm)</label><input type="number" id="roomH" step="100"></div>
        </div>
        <div id="polygonConfigGroup" class="hidden">
          <div class="ui-row">
            <div class="input-box">
              <label>多角形プリセット</label>
              <select id="polyEdgeCount">
                <option value="3">3角形</option><option value="4" selected>4角形</option>
                <option value="5">5角形</option><option value="6">6角形</option>
                <option value="8">8角形</option><option value="L">L字型 (6角形)</option>
              </select>
            </div>
            <div class="input-box"><label>天井高 (H mm)</label><input type="number" id="roomHPoly" step="100"></div>
          </div>
          <div class="ui-row" style="justify-content:flex-end; margin-top:6px;">
            <button class="btn-action sm" id="btnAddVertex">＋ 頂点追加</button>
            <button class="btn-action sm" id="btnResetRect">四角リセット</button>
          </div>
          <div class="hint" style="margin-top:4px;">💡 図面上の青丸をドラッグして会場の角を変形できます。</div>
        </div>
      </div>

      <div class="ui-group">
        <div class="ui-group-title">
          <span>🚪 扉・搬入口 (壁面スナップ)</span>
          <span class="btn-cluster">
            <button class="btn-action sm" id="btnAddDoor">＋ 扉追加</button>
            <button class="btn-action sm btn-danger" id="btnDeleteDoor">削除</button>
          </span>
        </div>
        <div class="ui-row full"><div class="input-box"><label>選択中の扉</label><select id="doorSelect"></select></div></div>
        <div class="ui-row">
          <div class="input-box"><label>扉名称</label><input type="text" id="doorName"></div>
          <div class="input-box">
            <label>扉の種別</label>
            <select id="doorType">
              <option value="single_left">片開き (左開き)</option>
              <option value="single_right">片開き (右開き)</option>
              <option value="double">2枚 (両開き)</option>
              <option value="closed">閉鎖 (開閉不可)</option>
            </select>
          </div>
        </div>
        <div class="ui-row">
          <div class="input-box">
            <label>開き方向</label>
            <select id="doorSwing">
              <option value="in">内開き (会場の内側へ)</option>
              <option value="out">外開き (会場の外側へ)</option>
            </select>
          </div>
        </div>
        <div class="ui-row">
          <div class="input-box"><label>開口幅 (W mm)</label><input type="number" id="doorWidth" step="100"></div>
          <div class="input-box"><label>設置する壁 (辺)</label><select id="doorWallSelect"></select></div>
        </div>
        <div class="ui-row full">
          <div class="input-box">
            <label>壁上の位置: <b id="doorRatioDisplay">50%</b></label>
            <input type="range" id="doorWallRatio" min="5" max="95" step="1" value="50">
          </div>
        </div>
      </div>`;
    bindEvents();
    syncUI();
  }

  function bindEvents() {
    $('roomShapeType').addEventListener('change', e => {
      window.room.shapeType = e.target.value;
      if (window.room.shapeType === 'polygon' && window.room.points.length < 3) applyPreset('4');
      normalize(); syncUI(); redraw(); commit('会場形状');
    });

    const onDim = () => {
      const r = window.room;
      r.w = Math.max(1000, parseFloat($('roomW').value) || DEFAULT_W);
      r.d = Math.max(1000, parseFloat($('roomD').value) || DEFAULT_D);
      r.h = Math.max(1000, parseFloat($('roomH').value) || DEFAULT_H);
      if (r.shapeType === 'rect') r.points = rectPoints(r.w, r.d);
      normalize(); syncUI(); redraw(); commit('会場寸法');
    };
    ['roomW', 'roomD', 'roomH'].forEach(id => $(id).addEventListener('change', onDim));

    $('roomHPoly').addEventListener('change', e => {
      window.room.h = Math.max(1000, parseFloat(e.target.value) || DEFAULT_H);
      syncUI(); redraw(); commit('天井高');
    });
    $('polyEdgeCount').addEventListener('change', e => { applyPreset(e.target.value); commit('多角形プリセット'); });
    $('btnAddVertex').addEventListener('click', () => { addVertex(); commit('頂点追加'); });
    $('btnResetRect').addEventListener('click', () => {
      Object.assign(window.room, { shapeType: 'rect', w: DEFAULT_W, d: DEFAULT_D, points: rectPoints(DEFAULT_W, DEFAULT_D) });
      normalize(); syncUI(); redraw(); commit('四角リセット');
    });

    $('btnAddDoor').addEventListener('click', addDoor);
    $('btnDeleteDoor').addEventListener('click', deleteDoor);
    $('doorSelect').addEventListener('change', e => { window.selectedDoorId = e.target.value; syncDoorUI(); redraw(); });

    const readDoor = () => {
      const d = selectedDoor();
      if (!d) return null;
      d.name = $('doorName').value.trim() || '扉';
      d.type = $('doorType').value;
      d.swing = $('doorSwing').value === 'out' ? 'out' : 'in';
      d.width = Math.max(300, parseFloat($('doorWidth').value) || 1000);
      d.edgeIndex = parseInt($('doorWallSelect').value, 10) || 0;
      d.offsetRatio = (parseFloat($('doorWallRatio').value) || 50) / 100;
      $('doorRatioDisplay').innerText = Math.round(d.offsetRatio * 100) + '%';
      return d;
    };
    ['doorName', 'doorWallRatio'].forEach(id => $(id).addEventListener('input', () => { if (readDoor()) { refreshDoorSelect(); redraw(); } }));
    ['doorName', 'doorType', 'doorSwing', 'doorWidth', 'doorWallSelect', 'doorWallRatio'].forEach(id =>
      $(id).addEventListener('change', () => { if (readDoor()) { refreshDoorSelect(); redraw(); commit('扉の変更'); } }));
  }

  // ---------------------------------------------------------------- 幾何
  function selectedDoor() { return window.doors.find(d => d.id === window.selectedDoorId) || null; }

  /** 外形の原点を (0,0) に揃え、w/d を再計算し、扉の辺番号を範囲内に収める */
  function normalize() {
    const r = window.room, pts = r.points;
    if (!pts || !pts.length) return;
    const minX = Math.min.apply(null, pts.map(p => p.x)), maxX = Math.max.apply(null, pts.map(p => p.x));
    const minY = Math.min.apply(null, pts.map(p => p.y)), maxY = Math.max.apply(null, pts.map(p => p.y));
    pts.forEach(p => { p.x -= minX; p.y -= minY; });
    r.w = Math.max(1000, maxX - minX);
    r.d = Math.max(1000, maxY - minY);
    window.doors.forEach(d => { if (d.edgeIndex > pts.length - 1) d.edgeIndex = pts.length - 1; });
  }

  function applyPreset(preset) {
    const r = window.room;
    if (preset === 'L') {
      r.points = [
        { x: 0, y: 0 }, { x: r.w, y: 0 },
        { x: r.w, y: Math.round(r.d * 0.55) },
        { x: Math.round(r.w * 0.45), y: Math.round(r.d * 0.55) },
        { x: Math.round(r.w * 0.45), y: r.d }, { x: 0, y: r.d }
      ];
    } else {
      const n = parseInt(preset, 10) || 4;
      const cx = r.w / 2, cy = r.d / 2, rx = r.w * 0.45, ry = r.d * 0.45;
      r.points = [];
      for (let i = 0; i < n; i++) {
        const a = (2 * Math.PI / n) * i - Math.PI / 2;
        r.points.push({ x: Math.round(cx + rx * Math.cos(a)), y: Math.round(cy + ry * Math.sin(a)) });
      }
    }
    normalize(); syncUI(); redraw();
  }

  function addVertex() {
    const pts = window.room.points;
    if (pts.length < 3) return;
    const a = pts[pts.length - 1], b = pts[0];
    pts.push({ x: Math.round((a.x + b.x) / 2), y: Math.round((a.y + b.y) / 2) });
    normalize(); syncUI(); redraw();
  }

  function doorTransform(door) {
    const pts = window.room.points, n = pts.length;
    const ei = (door.edgeIndex >= 0 && door.edgeIndex < n) ? door.edgeIndex : 0;
    const p1 = pts[ei], p2 = pts[(ei + 1) % n];
    const t = Math.max(0.05, Math.min(0.95, door.offsetRatio || 0.5));
    return {
      x: p1.x + (p2.x - p1.x) * t,
      y: p1.y + (p2.y - p1.y) * t,
      angle: Math.atan2(p2.y - p1.y, p2.x - p1.x)
    };
  }

  function snapDoor(door, wx, wy) {
    const pts = window.room.points, n = pts.length;
    let best = Infinity, bi = 0, bt = 0.5;
    for (let i = 0; i < n; i++) {
      const p1 = pts[i], p2 = pts[(i + 1) % n];
      const dx = p2.x - p1.x, dy = p2.y - p1.y, l2 = dx * dx + dy * dy;
      if (!l2) continue;
      const t = Math.max(0.05, Math.min(0.95, ((wx - p1.x) * dx + (wy - p1.y) * dy) / l2));
      const dist = Math.hypot(wx - (p1.x + t * dx), wy - (p1.y + t * dy));
      if (dist < best) { best = dist; bi = i; bt = t; }
    }
    door.edgeIndex = bi;
    door.offsetRatio = bt;
  }

  /** 辺の左手側(+y 側)が会場の内側なら 1、外側なら -1 (多角形の頂点の回り方で決まる) */
  function inwardSign() {
    const pts = window.room.points;
    let a = 0;
    for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; a += p.x * q.y - q.x * p.y; }
    return a >= 0 ? 1 : -1;
  }

  function addDoor() {
    const id = 'D' + (Math.max(0, ...window.doors.map(d => parseInt(String(d.id).replace(/\D/g, ''), 10) || 0)) + 1);
    window.doors.push({ id, name: '扉 ' + (window.doors.length + 1), type: 'single_left', swing: 'in', width: 1200, edgeIndex: 0, offsetRatio: 0.5, status: 'open' });
    window.selectedDoorId = id;
    syncUI(); redraw(); commit('扉追加');
  }

  function deleteDoor() {
    if (!selectedDoor()) { window.debugBox && window.debugBox.warn('削除する扉がありません'); return; }
    window.doors = window.doors.filter(d => d.id !== window.selectedDoorId);      // 0枚でもよい
    window.selectedDoorId = window.doors.length ? window.doors[0].id : '';
    syncUI(); redraw(); commit('扉削除');
  }

  // ---------------------------------------------------------------- UI 同期
  function refreshDoorSelect() {
    const sel = $('doorSelect');
    if (!sel) return;
    sel.innerHTML = '';
    window.doors.forEach(d => {
      const o = document.createElement('option');
      o.value = d.id; o.textContent = d.name + ' (' + d.width + 'mm)';
      sel.appendChild(o);
    });
    sel.value = window.selectedDoorId;
  }

  function syncDoorUI() {
    const d = selectedDoor();
    if (!$('doorName')) return;
    ['doorName', 'doorType', 'doorSwing', 'doorWidth', 'doorWallSelect', 'doorWallRatio', 'btnDeleteDoor'].forEach(id => { $(id).disabled = !d; });
    if (!d) { $('doorName').value = ''; $('doorRatioDisplay').innerText = '-'; return; }      // 扉が0枚のとき
    $('doorName').value = d.name;
    $('doorSwing').value = d.swing === 'out' ? 'out' : 'in';
    $('doorType').value = d.type;
    $('doorWidth').value = d.width;
    $('doorWallSelect').value = d.edgeIndex;
    const pct = Math.round((d.offsetRatio || 0.5) * 100);
    $('doorWallRatio').value = pct;
    $('doorRatioDisplay').innerText = pct + '%';
    if ($('doorSelect')) $('doorSelect').value = d.id;
  }

  function syncUI() {
    if (!$('roomShapeType')) return;
    const r = window.room, poly = r.shapeType === 'polygon';
    $('roomShapeType').value = r.shapeType;
    $('roomBasicDimsRow').classList.toggle('hidden', poly);
    $('polygonConfigGroup').classList.toggle('hidden', !poly);
    $('roomW').value = Math.round(r.w);
    $('roomD').value = Math.round(r.d);
    $('roomH').value = Math.round(r.h);
    $('roomHPoly').value = Math.round(r.h);

    const ws = $('doorWallSelect');
    ws.innerHTML = '';
    r.points.forEach((_, i) => {
      const o = document.createElement('option');
      o.value = i; o.textContent = '壁(辺) ' + (i + 1);
      ws.appendChild(o);
    });
    refreshDoorSelect();
    syncDoorUI();
  }

  // ---------------------------------------------------------------- 描画
  function drawTop(ctx) {
    const r = window.room, pts = r.points;
    if (!pts || pts.length < 3) return;
    const T = window.Core.drawText;

    ctx.save();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 60;
    ctx.lineJoin = 'miter';
    ctx.stroke();

    if (r.shapeType === 'polygon') {
      pts.forEach((p, i) => {
        ctx.fillStyle = '#0284c7';
        ctx.beginPath(); ctx.arc(p.x, p.y, 180, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 30; ctx.stroke();
        T(ctx, String(i + 1), p.x, p.y, { px: 11, bold: true, color: '#ffffff', stroke: null });
      });
    }

    // 外寸の寸法線
    window.Core.drawDimLine(ctx, 0, 0, r.w, 0, '会場間口 W: ' + (r.w / 1000).toFixed(2) + 'm', { offset: -350 });
    window.Core.drawDimLine(ctx, 0, r.d, 0, 0, '会場奥行 D: ' + (r.d / 1000).toFixed(2) + 'm', { offset: -350 });

    // 扉
    window.doors.forEach(d => {
      const tf = doorTransform(d), sel = d.id === window.selectedDoorId, w = d.width;
      ctx.save();
      ctx.translate(tf.x, tf.y);
      ctx.rotate(tf.angle);
      ctx.scale(1, inwardSign() * (d.swing === 'out' ? -1 : 1));      // 開き弧の向き: 内開き=会場の内側 / 外開き=外側
      ctx.lineWidth = sel ? 45 : 30;
      if (d.type === 'closed') {
        ctx.strokeStyle = '#ef4444'; ctx.fillStyle = '#fee2e2';
        ctx.fillRect(-w / 2, -40, w, 80); ctx.strokeRect(-w / 2, -40, w, 80);
        ctx.beginPath(); ctx.moveTo(-w / 2, -40); ctx.lineTo(w / 2, 40); ctx.moveTo(-w / 2, 40); ctx.lineTo(w / 2, -40); ctx.stroke();
      } else if (d.type === 'double') {
        ctx.strokeStyle = sel ? '#2563eb' : '#0284c7';
        ctx.strokeRect(-w / 2, -25, w, 50);
        ctx.beginPath(); ctx.arc(-w / 2, 0, w / 2, 0, Math.PI / 2, false); ctx.stroke();
        ctx.beginPath(); ctx.arc(w / 2, 0, w / 2, Math.PI, Math.PI / 2, true); ctx.stroke();
      } else {
        ctx.strokeStyle = sel ? '#2563eb' : '#0284c7';
        ctx.strokeRect(-w / 2, -25, w, 50);
        ctx.beginPath();
        if (d.type === 'single_left') ctx.arc(-w / 2, 0, w, 0, Math.PI / 2, false);
        else ctx.arc(w / 2, 0, w, Math.PI, Math.PI / 2, true);
        ctx.stroke();
      }
      ctx.restore();
      T(ctx, d.name, tf.x, tf.y + 260, { px: 10, bold: true, color: sel ? '#1d4ed8' : '#0f172a' });
    });
    ctx.restore();
  }

  function drawSide(ctx) {
    const r = window.room, H = r.h || DEFAULT_H, D = r.d;
    ctx.save();
    ctx.strokeStyle = '#0f172a'; ctx.lineWidth = 25;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(D, 0); ctx.stroke();

    ctx.strokeStyle = '#64748b'; ctx.lineWidth = 18; ctx.setLineDash([60, 30]);
    ctx.beginPath(); ctx.moveTo(0, -H); ctx.lineTo(D, -H); ctx.stroke();
    ctx.setLineDash([]);

    ctx.strokeStyle = '#0f172a'; ctx.lineWidth = 30;
    ctx.beginPath();
    ctx.moveTo(0, 0); ctx.lineTo(0, -H);
    ctx.moveTo(D, 0); ctx.lineTo(D, -H);
    ctx.stroke();

    window.Core.drawDimLine(ctx, -350, 0, -350, -H, '天井高 ' + (H / 1000).toFixed(2) + 'm', { color: '#0284c7', offset: 0 });
    ctx.restore();
  }

  // ---------------------------------------------------------------- 当たり判定 (平面図のみ)
  function hitTest(wx, wy, view) {
    if (view !== 'top') return null;
    const r = window.room;
    if (r.shapeType === 'polygon') {
      for (let i = 0; i < r.points.length; i++) {
        if (Math.hypot(r.points[i].x - wx, r.points[i].y - wy) < 400) return { type: 'vertex', index: i };
      }
    }
    for (const d of window.doors) {
      const tf = doorTransform(d);
      if (Math.hypot(tf.x - wx, tf.y - wy) < 600) return { type: 'door', id: d.id };
    }
    return null;
  }

  function onGrab(item) {
    if (item.type === 'door' && window.selectedDoorId !== item.id) {
      window.selectedDoorId = item.id;
      syncDoorUI();
      redraw();
    }
  }

  function handleDrag(item, wx, wy) {
    if (item.type === 'vertex') {
      const p = window.room.points[item.index];
      if (!p) return;
      p.x = Math.round(wx); p.y = Math.round(wy);
      normalize();
    } else if (item.type === 'door') {
      const d = window.doors.find(v => v.id === item.id);
      if (d) { snapDoor(d, wx, wy); syncDoorUI(); }
    }
  }

  // ---------------------------------------------------------------- 保存 / 復元
  function exportData() {
    return { room: clone(window.room), doors: clone(window.doors), selectedDoorId: window.selectedDoorId };
  }

  function importData(data) {
    if (!data) return;
    if (data.room) {
      const src = clone(data.room);
      const w = src.w || DEFAULT_W, d = src.d || DEFAULT_D;
      window.room = {
        w, d,
        h: src.h || src.ceilingH || DEFAULT_H,
        shapeType: src.shapeType === 'polygon' ? 'polygon' : 'rect',
        points: (Array.isArray(src.points) && src.points.length >= 3) ? src.points : rectPoints(w, d)
      };
    }
    if (Array.isArray(data.doors)) window.doors = clone(data.doors);        // 0枚も有効
    window.selectedDoorId = window.doors.some(d => d.id === data.selectedDoorId) ? data.selectedDoorId : (window.doors[0] ? window.doors[0].id : '');
    normalize();
    syncUI();
  }

  window.tabRoomModule = { init: buildUI, drawTop, drawSide, hitTest, onGrab, handleDrag, exportData, importData, syncUI };
  window.Core.register('room', window.tabRoomModule, { order: 10 });
})();
