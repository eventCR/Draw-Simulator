/**
 * ==============================================================================
 * tab6_seats.js — 【客席】グリッド配置・個別編集・角度調整
 *
 * 所有する共有データ:
 *   window.seats[]  { id, row, x, y, angle }
 *   window.chair    { w, d, h, backH }
 *   window.audienceTorsoH  観客の座高 (腰〜頭頂)    ※登壇者の座高 window.seatedTorsoH (tab4) とは別
 *   window.totalHeadZ      着席時の頭頂高 = chair.h + audienceTorsoH  (カメラの頭被り判定に使用)
 *
 * カメラとの連携: 頭被りの席は tabCameraModule.getBlockedSeatIds() (Set) から取得する。
 * ==============================================================================
 */
(function () {
  'use strict';

  const U = window.Core.util;
  const { $, clone, num } = U;
  const commit = (l) => window.Core.commit(l);
  const redraw = () => window.Core.requestRender();

  window.seats = [];
  window.chair = { w: 500, d: 500, h: 420, backH: 400 };
  window.audienceTorsoH = 850;
  window.totalHeadZ = window.chair.h + window.audienceTorsoH;

  const grid = { rows: 5, rowPitch: 950, blockCols: '5,10,5', seatGapX: 20, aisleW: 1000, stageDist: 2500 };
  let tool = 'select';                  // select | move | delete | add
  const selectedIds = new Set();
  let marquee = null;                   // 範囲選択中 {x0,y0,x1,y1}

  const byId = (id) => window.seats.find(s => s.id === id) || null;
  const selectedSeats = () => window.seats.filter(s => selectedIds.has(s.id));

  function updateHeadZ() { window.totalHeadZ = window.chair.h + window.audienceTorsoH; }

  // ---------------------------------------------------------------- UI
  function buildUI(panel) {
    if (!panel) return;
    panel.innerHTML = `
      <div class="ui-group">
        <div class="ui-group-title"><span>🛠️ ツールモード</span></div>
        <div class="ui-row">
          <button class="btn-action active" data-seat-tool="select" style="flex:1">👆 選択・範囲枠</button>
          <button class="btn-action" data-seat-tool="move" style="flex:1">↔️ 個別ドラッグ</button>
          <button class="btn-action" data-seat-tool="delete" style="flex:1">❌ 1席削除</button>
          <button class="btn-action" data-seat-tool="add" style="flex:1">➕ 1席追加</button>
        </div>
        <div class="hint">選択: クリック / Shiftで追加 / 空き地をドラッグで範囲選択</div>
      </div>

      <div class="ui-group">
        <div class="ui-group-title">椅子寸法 &amp; 観客の頭頂高 (mm)</div>
        <div class="ui-row">
          <div class="input-box"><label>幅(W)</label><input type="number" id="chairW" step="10"></div>
          <div class="input-box"><label>奥行(D)</label><input type="number" id="chairD" step="10"></div>
          <div class="input-box"><label>座面高(H)</label><input type="number" id="chairH" step="10"></div>
          <div class="input-box"><label>背もたれ高</label><input type="number" id="chairBackH" step="10"></div>
        </div>
        <div class="ui-row">
          <div class="input-box"><label>観客の座高 (頭頂まで)</label><input type="number" id="audienceTorsoH" step="10"></div>
          <div class="input-box"><label>前席頭頂高 (Z合計)</label><input type="number" id="totalHeadZ" step="10"></div>
        </div>
      </div>

      <div class="ui-group">
        <div class="ui-group-title">
          <span>🪑 選択座席の角度調整・整列</span>
          <span id="selectedSeatLabel" class="hint">席未選択</span>
        </div>
        <div class="input-box">
          <label>回転角度 (選択中の全席の向きのみ) : <b id="seatAngleVal">0°</b></label>
          <input type="range" id="seatAngleSlider" min="-180" max="180" step="5" value="0">
        </div>
        <div class="ui-row">
          <button class="btn-action" id="btnAngleL" style="flex:1">左斜め (-30°)</button>
          <button class="btn-action" id="btnAngleR" style="flex:1">右斜め (+30°)</button>
        </div>
        <div class="ui-row">
          <button class="btn-action btn-green" id="btnAlignLine" style="flex:1">📏 選択席を1直線に整列</button>
          <button class="btn-action btn-blue" id="btnAimCenter" style="flex:1">🎯 ステージ中央に向ける</button>
        </div>
        <button class="btn-action btn-amber" id="btnSnapY">📌 選択席のY(奥行)を列ピッチにスナップ</button>
      </div>

      <div class="ui-group">
        <div class="ui-group-title"><span>グリッド整列</span><span class="badge" id="seatCountBadge">0 席</span></div>
        <div class="ui-row">
          <div class="input-box"><label>行数(Y)</label><input type="number" id="gridRows" min="1"></div>
          <div class="input-box"><label>列ピッチ(Y)</label><input type="number" id="gridRowPitch" step="50"></div>
          <div class="input-box"><label>構成(X)</label><input type="text" id="gridBlockCols" placeholder="例: 5,10,5"></div>
        </div>
        <div class="ui-row">
          <div class="input-box"><label>席隙間(X)</label><input type="number" id="gridSeatGapX" step="10"></div>
          <div class="input-box"><label>通路幅</label><input type="number" id="gridAisleW" step="100"></div>
          <div class="input-box"><label>ステージ離隔(Y)</label><input type="number" id="gridStageDist" step="100"></div>
        </div>
        <button class="btn-action btn-accent" id="btnRebuildSeats">🔄 再配置 (個別編集はリセット)</button>
      </div>`;
    bind();
    syncUI();
  }

  function bind() {
    document.querySelectorAll('[data-seat-tool]').forEach(b => b.addEventListener('click', () => {
      tool = b.dataset.seatTool;
      document.querySelectorAll('[data-seat-tool]').forEach(x => x.classList.toggle('active', x === b));
    }));

    ['chairW', 'chairD', 'chairH', 'chairBackH'].forEach(id => $(id).addEventListener('change', () => {
      const c = window.chair;
      c.w = Math.max(100, num('chairW', 500)); c.d = Math.max(100, num('chairD', 500));
      c.h = Math.max(100, num('chairH', 420)); c.backH = Math.max(0, num('chairBackH', 400));
      updateHeadZ(); syncUI(); redraw(); commit('椅子寸法');
    }));
    $('audienceTorsoH').addEventListener('change', () => {
      window.audienceTorsoH = Math.max(300, num('audienceTorsoH', 850));
      updateHeadZ(); syncUI(); redraw(); commit('観客の座高');
    });
    $('totalHeadZ').addEventListener('change', () => {
      window.totalHeadZ = Math.max(500, num('totalHeadZ', 1270));
      window.audienceTorsoH = Math.max(300, window.totalHeadZ - window.chair.h);
      updateHeadZ(); syncUI(); redraw(); commit('前席頭頂高');
    });

    // グリッド入力: 変更 → 読み取り → 再配置
    const gridIds = { gridRows: 'rows', gridRowPitch: 'rowPitch', gridBlockCols: 'blockCols', gridSeatGapX: 'seatGapX', gridAisleW: 'aisleW', gridStageDist: 'stageDist' };
    Object.keys(gridIds).forEach(id => $(id).addEventListener('change', () => { readGrid(); rebuildSeats(); }));
    $('btnRebuildSeats').addEventListener('click', () => { readGrid(); rebuildSeats(); });

    $('seatAngleSlider').addEventListener('input', e => applyAngle(parseFloat(e.target.value) || 0, false));
    $('seatAngleSlider').addEventListener('change', () => commit('座席角度'));
    $('btnAngleL').addEventListener('click', () => applyAngle(-30, true));
    $('btnAngleR').addEventListener('click', () => applyAngle(30, true));
    $('btnAimCenter').addEventListener('click', aimToStageCenter);
    $('btnAlignLine').addEventListener('click', alignLine);
    $('btnSnapY').addEventListener('click', snapToRows);
  }

  function readGrid() {
    grid.rows = Math.max(1, Math.round(num('gridRows', 5)));
    grid.rowPitch = Math.max(100, num('gridRowPitch', 950));
    grid.blockCols = $('gridBlockCols').value || '5,10,5';
    grid.seatGapX = Math.max(0, num('gridSeatGapX', 20));
    grid.aisleW = Math.max(0, num('gridAisleW', 1000));
    grid.stageDist = num('gridStageDist', 2500);
  }

  function syncUI() {
    if (!$('chairW')) return;
    const c = window.chair;
    $('chairW').value = c.w; $('chairD').value = c.d; $('chairH').value = c.h; $('chairBackH').value = c.backH;
    $('audienceTorsoH').value = Math.round(window.audienceTorsoH);
    $('totalHeadZ').value = Math.round(window.totalHeadZ);
    $('gridRows').value = grid.rows; $('gridRowPitch').value = grid.rowPitch; $('gridBlockCols').value = grid.blockCols;
    $('gridSeatGapX').value = grid.seatGapX; $('gridAisleW').value = grid.aisleW; $('gridStageDist').value = grid.stageDist;
    $('seatCountBadge').innerText = window.seats.length + ' 席';
    updateSelectionUI();
  }

  function updateSelectionUI() {
    const label = $('selectedSeatLabel');
    if (!label) return;
    // 存在しない席の選択は掃除
    [...selectedIds].forEach(id => { if (!byId(id)) selectedIds.delete(id); });
    const sel = selectedSeats();
    if (sel.length === 1) {
      label.innerText = '選択中: ' + sel[0].id;
      $('seatAngleSlider').value = sel[0].angle || 0;
      $('seatAngleVal').innerText = (sel[0].angle || 0) + '°';
    } else {
      label.innerText = sel.length > 1 ? '複数選択中 (' + sel.length + '席)' : '席未選択 (図面上で席をクリック)';
    }
  }

  // ---------------------------------------------------------------- 座席操作
  function rebuildSeats() {
    const r = window.room, st = window.stage, ch = window.chair;
    const pitch = ch.w + grid.seatGapX;
    let blocks = String(grid.blockCols).split(',').map(n => parseInt(n.trim(), 10) || 0).filter(n => n > 0);
    if (!blocks.length) blocks = [8];

    let total = 0;
    blocks.forEach((n, i) => { total += n * pitch; if (i < blocks.length - 1) total += grid.aisleW; });
    const startX = (r.w - total) / 2;
    const startY = st.y + st.d + grid.stageDist;

    const out = [];
    for (let row = 0; row < grid.rows; row++) {
      let curX = startX, n = 1;
      blocks.forEach(count => {
        for (let c = 0; c < count; c++) {
          out.push({ id: 'R' + (row + 1) + '-S' + n, row: row + 1, x: Math.round(curX + pitch / 2), y: Math.round(startY + row * grid.rowPitch), angle: 0 });
          curX += pitch; n++;
        }
        curX += grid.aisleW;
      });
    }
    window.seats = out;
    selectedIds.clear();
    syncUI(); redraw(); commit('客席の再配置');
  }

  function applyAngle(val, doCommit) {
    $('seatAngleVal').innerText = val + '°';
    $('seatAngleSlider').value = val;
    const sel = selectedSeats();
    if (!sel.length) return;
    sel.forEach(s => { s.angle = val; });
    redraw();
    if (doCommit) commit('座席角度');
  }

  function aimToStageCenter() {
    const sel = selectedSeats();
    if (!sel.length) return;
    const st = window.stage, tx = st.x + st.w / 2, ty = st.y + st.d / 2;
    sel.forEach(s => {
      let deg = Math.round(Math.atan2(ty - s.y, tx - s.x) * 180 / Math.PI + 90);
      while (deg > 180) deg -= 360;
      while (deg <= -180) deg += 360;
      s.angle = deg;
    });
    updateSelectionUI(); redraw(); commit('ステージ中央へ向ける');
  }

  function alignLine() {
    const sel = selectedSeats();
    if (sel.length < 2) { window.debugBox && window.debugBox.warn('整列するには2席以上を選択してください'); return; }
    const anchor = sel.reduce((m, s) => (s.x + s.y < m.x + m.y ? s : m), sel[0]);
    const sorted = sel.slice().sort((a, b) => Math.hypot(a.x - anchor.x, a.y - anchor.y) - Math.hypot(b.x - anchor.x, b.y - anchor.y));
    const pitch = window.chair.w + grid.seatGapX;
    const ang = parseFloat($('seatAngleSlider').value) || 0, rad = ang * Math.PI / 180;
    sorted.forEach((s, i) => {
      s.angle = ang;
      if (i > 0) { s.x = Math.round(anchor.x + i * pitch * Math.cos(rad)); s.y = Math.round(anchor.y + i * pitch * Math.sin(rad)); }
    });
    redraw(); commit('1直線に整列');
  }

  function snapToRows() {
    const sel = selectedSeats();
    if (!sel.length) { window.debugBox && window.debugBox.warn('スナップする席を選択してください'); return; }
    const st = window.stage, startY = st.y + st.d + grid.stageDist;
    sel.forEach(s => {
      const idx = Math.round((s.y - startY) / grid.rowPitch);
      s.y = startY + idx * grid.rowPitch;
      s.row = idx + 1;
    });
    redraw(); commit('列にスナップ');
  }

  // ---------------------------------------------------------------- カメラ連携
  function blockedIds() {
    const cm = window.tabCameraModule;
    return (cm && typeof cm.getBlockedSeatIds === 'function') ? cm.getBlockedSeatIds() : new Set();
  }

  function getStats() {
    const total = window.seats.length, partial = blockedIds().size;
    return { total, clear: Math.max(0, total - partial), partial, blocked: partial };
  }

  // ---------------------------------------------------------------- 描画
  function drawTop(ctx) {
    if (!window.seats.length) return;
    const cw = window.chair.w, cd = window.chair.d;
    const blocked = window.displaySettings.showSeatStatus ? blockedIds() : new Set();

    window.seats.forEach(s => {
      const sel = selectedIds.has(s.id), bad = blocked.has(s.id);
      ctx.save();
      ctx.translate(s.x, s.y);
      ctx.rotate((s.angle || 0) * Math.PI / 180);
      if (sel) { ctx.fillStyle = 'rgba(37,99,235,0.18)'; ctx.strokeStyle = '#2563eb'; ctx.lineWidth = 12; }
      else if (bad) { ctx.fillStyle = 'rgba(220,38,38,0.15)'; ctx.strokeStyle = '#dc2626'; ctx.lineWidth = 8; }
      else { ctx.fillStyle = '#f8fafc'; ctx.strokeStyle = '#94a3b8'; ctx.lineWidth = 6; }
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(-cw / 2, -cd / 2, cw, cd, 60); else ctx.rect(-cw / 2, -cd / 2, cw, cd);
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = sel ? '#3b82f6' : (bad ? '#ef4444' : '#cbd5e1');   // 背もたれ
      ctx.fillRect(-cw / 2, cd / 2 - 40, cw, 40);
      ctx.strokeRect(-cw / 2, cd / 2 - 40, cw, 40);
      ctx.restore();
    });

    if (marquee) {
      ctx.save();
      ctx.fillStyle = 'rgba(37,99,235,0.08)'; ctx.strokeStyle = '#2563eb'; ctx.lineWidth = 2 / window.Core.scale;
      ctx.setLineDash([8 / window.Core.scale, 6 / window.Core.scale]);
      const x = Math.min(marquee.x0, marquee.x1), y = Math.min(marquee.y0, marquee.y1);
      ctx.fillRect(x, y, Math.abs(marquee.x1 - marquee.x0), Math.abs(marquee.y1 - marquee.y0));
      ctx.strokeRect(x, y, Math.abs(marquee.x1 - marquee.x0), Math.abs(marquee.y1 - marquee.y0));
      ctx.restore();
    }
  }

  /** 立面図用: 同じ奥行き(Y)・同じ接地高の席は重なるため1つにまとめる (頭被りの席があれば赤を優先) */
  function sideSeats() {
    const blocked = window.displaySettings.showSeatStatus ? blockedIds() : new Set();
    const fov = (window.tabCameraModule && window.tabCameraModule.getFovSelection) ? window.tabCameraModule.getFovSelection() : null;
    const map = new Map();
    window.seats.forEach(s => {
      if (fov && !fov.seatIds.has(s.id) && !blocked.has(s.id) && !selectedIds.has(s.id)) return;
      const bz = window.isInsideStage(s.x, s.y) ? window.stage.h : 0;
      const key = Math.round(s.y) + '|' + bz;
      const cur = map.get(key) || { y: s.y, bz, bad: false, sel: false };
      cur.bad = cur.bad || blocked.has(s.id);
      cur.sel = cur.sel || selectedIds.has(s.id);
      map.set(key, cur);
    });
    return [...map.values()].sort((a, b) => a.y - b.y);
  }

  function drawSeatedPerson(ctx, y, seatTopZ, torso) {
    const headR = 110;
    ctx.beginPath(); ctx.arc(y, -(seatTopZ + torso - headR), headR, 0, Math.PI * 2); ctx.fill();   // 頭
    ctx.beginPath();                                                                                  // 胴
    ctx.moveTo(y - 80, -seatTopZ - torso + headR * 2); ctx.lineTo(y + 80, -seatTopZ - torso + headR * 2);
    ctx.lineTo(y + 110, -seatTopZ); ctx.lineTo(y - 110, -seatTopZ);
    ctx.fill();
    ctx.fillRect(y - 200, -seatTopZ - 40, 200, 60);                                                   // 大腿 (ステージ側へ)
  }

  function drawSide(ctx) {
    const list = sideSeats();
    if (!list.length) return;
    const cd = window.chair.d, ch = window.chair.h, cb = window.chair.backH, torso = window.audienceTorsoH;

    ctx.save();
    list.sort((a, b) => (a.bad - b.bad)).forEach(g => {            // 赤を最前面に
      const py = g.y, bz = g.bz;
      const col = g.bad ? '#dc2626' : (g.sel ? '#2563eb' : '#475569');
      ctx.strokeStyle = col; ctx.lineWidth = g.bad ? 35 : 25;
      ctx.strokeRect(py - cd / 2, -bz - ch, cd, 30);                   // 座面
      ctx.beginPath();
      ctx.moveTo(py - cd / 2 + 40, -bz - ch); ctx.lineTo(py - cd / 2 + 40, -bz);
      ctx.moveTo(py + cd / 2 - 40, -bz - ch); ctx.lineTo(py + cd / 2 - 40, -bz);
      ctx.moveTo(py + cd / 2 - 40, -bz - ch); ctx.lineTo(py + cd / 2 - 40, -bz - ch - cb);   // 背もたれ
      ctx.stroke();
      ctx.fillStyle = g.bad ? '#dc2626' : (g.sel ? '#2563eb' : '#334155');
      drawSeatedPerson(ctx, py, bz + ch, torso);
    });

    // 前席頭頂高ガイド (破線)
    ctx.strokeStyle = 'rgba(220,38,38,0.4)'; ctx.lineWidth = 15; ctx.setLineDash([60, 60]);
    ctx.beginPath();
    list.sort((a, b) => a.y - b.y).forEach((g, i) => {
      const z = -(g.bz + ch + torso);
      if (i === 0) { ctx.moveTo(g.y - 500, z); ctx.lineTo(g.y, z); } else ctx.lineTo(g.y, z);
      if (i === list.length - 1) ctx.lineTo(g.y + 500, z);
    });
    ctx.stroke();
    ctx.restore();
  }

  // ---------------------------------------------------------------- 当たり判定 / ドラッグ (平面図のみ)
  function seatAt(wx, wy) {
    const r = window.chair.w / 1.5;
    for (let i = window.seats.length - 1; i >= 0; i--) {
      if (Math.hypot(window.seats[i].x - wx, window.seats[i].y - wy) < r) return window.seats[i];
    }
    return null;
  }

  function seatBounds() {
    if (!window.seats.length) return null;
    const xs = window.seats.map(s => s.x), ys = window.seats.map(s => s.y), m = window.chair.w;
    return { x0: Math.min.apply(null, xs) - m, x1: Math.max.apply(null, xs) + m, y0: Math.min.apply(null, ys) - m, y1: Math.max.apply(null, ys) + m };
  }

  function hitTest(wx, wy, view) {
    if (view !== 'top') return null;
    const hit = seatAt(wx, wy);
    if (tool === 'add') return hit ? { type: 'seat', id: hit.id } : { type: 'add', x: wx, y: wy };
    if (hit) return { type: 'seat', id: hit.id, lastX: wx, lastY: wy };
    if (tool === 'select') {                       // 席エリア内の空き地 = 範囲選択の開始
      const b = seatBounds();
      if (b && wx >= b.x0 && wx <= b.x1 && wy >= b.y0 && wy <= b.y1) return { type: 'marquee', x0: wx, y0: wy };
    }
    return null;
  }

  function onGrab(item) {
    if (item.type === 'add') {
      const id = U.nextId('Custom-', window.seats);
      window.seats.push({ id, row: 0, x: Math.round(item.x), y: Math.round(item.y), angle: 0 });
      selectedIds.clear(); selectedIds.add(id);
      syncUI(); redraw(); commit('1席追加');
      return;
    }
    if (item.type === 'marquee') {
      if (!window.Core.modifiers.shift) selectedIds.clear();
      item.base = new Set(selectedIds);
      marquee = { x0: item.x0, y0: item.y0, x1: item.x0, y1: item.y0 };
      updateSelectionUI(); redraw();
      return;
    }
    if (item.type === 'seat') {
      if (tool === 'delete') {
        window.seats = window.seats.filter(s => s.id !== item.id);
        selectedIds.delete(item.id);
        syncUI(); redraw(); commit('1席削除');
      } else if (tool === 'select') {
        if (window.Core.modifiers.shift) { selectedIds.has(item.id) ? selectedIds.delete(item.id) : selectedIds.add(item.id); }
        else { selectedIds.clear(); selectedIds.add(item.id); }
        updateSelectionUI(); redraw();
      } else if (tool === 'move' && !selectedIds.has(item.id)) {
        selectedIds.clear(); selectedIds.add(item.id);
        updateSelectionUI(); redraw();
      }
    }
  }

  function handleDrag(item, wx, wy) {
    if (item.type === 'marquee' && marquee) {
      marquee.x1 = wx; marquee.y1 = wy;
      const x0 = Math.min(marquee.x0, wx), x1 = Math.max(marquee.x0, wx), y0 = Math.min(marquee.y0, wy), y1 = Math.max(marquee.y0, wy);
      selectedIds.clear();
      item.base.forEach(id => selectedIds.add(id));
      window.seats.forEach(s => { if (s.x >= x0 && s.x <= x1 && s.y >= y0 && s.y <= y1) selectedIds.add(s.id); });
      updateSelectionUI();
    } else if (item.type === 'seat' && tool === 'move' && byId(item.id)) {
      const dx = wx - item.lastX, dy = wy - item.lastY;
      selectedSeats().forEach(s => { s.x = Math.round(s.x + dx); s.y = Math.round(s.y + dy); });
      item.lastX = wx; item.lastY = wy;
    }
  }

  // マウスを離したら範囲枠を消す
  window.addEventListener('mouseup', () => { if (marquee) { marquee = null; redraw(); } });

  // ---------------------------------------------------------------- 保存 / 復元
  function exportData() {
    return { seats: clone(window.seats), chair: clone(window.chair), audienceTorsoH: window.audienceTorsoH, grid: clone(grid) };
  }

  function importData(d) {
    if (!d) return;
    if (Array.isArray(d.seats)) window.seats = clone(d.seats);
    if (d.chair) window.chair = Object.assign({ w: 500, d: 500, h: 420, backH: 400 }, clone(d.chair));
    if (typeof d.audienceTorsoH === 'number') window.audienceTorsoH = d.audienceTorsoH;
    else if (typeof d.totalHeadZ === 'number') window.audienceTorsoH = Math.max(300, d.totalHeadZ - window.chair.h);   // 旧形式
    if (d.grid) Object.assign(grid, clone(d.grid));
    updateHeadZ();
    selectedIds.clear();
    syncUI();
  }

  window.tabSeatsModule = {
    init(panel) {
      buildUI(panel);
      if (!window.seats.length) rebuildSeats();       // 初回のみ初期配置 (履歴の初期状態に含まれる)
    },
    drawTop, drawSide, hitTest, onGrab, handleDrag, exportData, importData, syncUI,
    getStats, rebuildSeats,
    /** 外部 (AI生成など) からグリッド条件を渡して再配置する */
    configureGrid(cfg) {
      if (!cfg) return;
      if (cfg.rows) grid.rows = Math.max(1, Math.round(cfg.rows));
      if (cfg.rowPitch) grid.rowPitch = cfg.rowPitch;
      if (cfg.blockCols) grid.blockCols = String(cfg.blockCols);
      if (cfg.seatGapX != null) grid.seatGapX = cfg.seatGapX;
      if (cfg.aisleW) grid.aisleW = cfg.aisleW;
      if (cfg.stageDist) grid.stageDist = cfg.stageDist;
      rebuildSeats();
    },
    getSelectedIds: () => new Set(selectedIds)
  };
  window.Core.register('seats', window.tabSeatsModule, { order: 40 });
})();
