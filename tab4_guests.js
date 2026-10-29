/**
 * ==============================================================================
 * tab4_guests.js — 【登壇者】
 *
 * 所有する共有データ: window.seatedTorsoH (座高mm)
 * 登壇者 g = { id, name, type:'high_chair'|'low_chair'|'standing', h, x, y }
 *   h = 座面高 (着座) / 身長 (立ち)
 * 他モジュール向け API:
 *   tabGuestsModule.list                … 登壇者配列
 *   tabGuestsModule.getBaseZ(g)         … 足元高 (ステージ上なら段差分)
 *   tabGuestsModule.getHeadTopZ(g)      … 頭頂の絶対高さ
 *   tabGuestsModule.getAimTargets()     … カメラ照準用 [{id,x,y,h}] (h = 足元基準の頭頂高)
 * ==============================================================================
 */
(function () {
  'use strict';

  const U = window.Core.util;
  const { $, clone, num } = U;
  const commit = (l) => window.Core.commit(l);
  const redraw = () => window.Core.requestRender();

  const TYPE_DEFAULT_H = { high_chair: 750, low_chair: 420, standing: 1600 };
  const TYPE_BADGE = { high_chair: '[H]', low_chair: '[L]', standing: '[立]' };

  window.seatedTorsoH = 850;

  let guests = [
    { id: 'G1', name: '登壇者 1', type: 'high_chair', h: 750, x: 6100, y: 2400 },
    { id: 'G2', name: '登壇者 2', type: 'high_chair', h: 750, x: 8900, y: 2400 }
  ];
  let selectedId = 'G1';

  const selected = () => guests.find(g => g.id === selectedId) || null;
  const baseZ = (g) => window.isInsideStage(g.x, g.y) ? (window.stage.h || 0) : 0;
  const headTopRel = (g) => g.type === 'standing' ? g.h : g.h + window.seatedTorsoH;   // 足元基準
  const col = (g) => g.id === selectedId ? '#2563eb' : '#0f172a';

  // ---------------------------------------------------------------- UI
  function buildUI(panel) {
    if (!panel) return;
    panel.innerHTML = `
      <div class="ui-group">
        <div class="ui-group-title">
          <span>👤 登壇者選択</span>
          <span class="btn-cluster">
            <button class="btn-action sm" id="btnAddGuest">＋ 追加</button>
            <button class="btn-action sm btn-danger" id="btnDelGuest">🗑️ 削除</button>
          </span>
        </div>
        <div class="ui-row full"><div class="input-box"><select id="guestSelect"></select></div></div>
      </div>

      <div class="ui-group">
        <div class="ui-group-title">登壇者パラメータ設定</div>
        <div class="ui-row">
          <div class="input-box"><label>表示名</label><input type="text" id="guestName"></div>
          <div class="input-box">
            <label>着座スタイル</label>
            <select id="guestType">
              <option value="high_chair">🪑 ハイチェア (座面H:750)</option>
              <option value="low_chair">💺 ローチェア (座面H:420)</option>
              <option value="standing">🧍 立ち姿 (身長H:1600)</option>
            </select>
          </div>
        </div>
        <div class="ui-row">
          <div class="input-box"><label>座面/身長 H (mm)</label><input type="number" id="guestH" step="50"></div>
          <div class="input-box"><label>配置 X (幅 mm)</label><input type="number" id="guestX" step="100"></div>
          <div class="input-box"><label>配置 Y (奥行 mm)</label><input type="number" id="guestY" step="100"></div>
        </div>
        <button class="btn-action btn-blue" id="btnGuestCenter">🎯 舞台中央へ配置</button>
      </div>

      <div class="ui-group">
        <div class="ui-group-title">共通設定</div>
        <div class="ui-row">
          <div class="input-box"><label>登壇者の座高 (腰〜頭頂 mm)</label><input type="number" id="guestTorso" step="10"></div>
        </div>
        <div class="hint">着座登壇者の頭頂高 = 座面H + 座高。カメラの照準高さに使われます。</div>
      </div>`;
    bind();
    syncUI();
  }

  function bind() {
    $('btnAddGuest').addEventListener('click', addGuest);
    $('btnDelGuest').addEventListener('click', removeSelected);
    $('guestSelect').addEventListener('change', e => { selectedId = e.target.value; syncUI(); redraw(); });

    // 名前はタイプ中にライブ反映、確定時に履歴
    $('guestName').addEventListener('input', e => {
      const g = selected(); if (!g) return;
      g.name = e.target.value;
      const opt = $('guestSelect').querySelector('option[value="' + g.id + '"]');
      if (opt) opt.textContent = g.name;
      redraw();
    });
    $('guestName').addEventListener('change', () => commit('登壇者名'));

    $('guestType').addEventListener('change', e => {
      const g = selected(); if (!g) return;
      g.type = e.target.value;
      g.h = TYPE_DEFAULT_H[g.type];
      syncUI(); redraw(); commit('着座スタイル');
    });
    ['guestH', 'guestX', 'guestY'].forEach(id => $(id).addEventListener('change', () => {
      const g = selected(); if (!g) return;
      g.h = Math.max(0, num('guestH', g.h));
      g.x = num('guestX', g.x);
      g.y = num('guestY', g.y);
      syncUI(); redraw(); commit('登壇者変更');
    }));
    $('btnGuestCenter').addEventListener('click', () => {
      const g = selected(), st = window.stage;
      if (!g) return;
      g.x = Math.round(st.x + st.w / 2);
      g.y = Math.round(st.y + st.d / 2);
      syncUI(); redraw(); commit('登壇者を中央へ');
    });
    $('guestTorso').addEventListener('change', () => {
      window.seatedTorsoH = Math.max(300, num('guestTorso', 850));
      syncUI(); redraw(); commit('座高');
    });
  }

  function syncUI() {
    if (!$('guestSelect')) return;
    const has = guests.length > 0;
    if (!selected() && has) selectedId = guests[0].id;
    if (!has) selectedId = null;

    U.fillSelect('guestSelect', has ? guests.map(g => ({ value: g.id, label: g.name })) : [{ value: '', label: '（登壇者なし / 0名）' }], selectedId || '');
    ['guestSelect', 'btnDelGuest', 'btnGuestCenter', 'guestName', 'guestType', 'guestH', 'guestX', 'guestY']
      .forEach(id => { $(id).disabled = !has; });
    $('guestTorso').value = window.seatedTorsoH;

    const g = selected();
    if (!g) { ['guestName', 'guestH', 'guestX', 'guestY'].forEach(id => { $(id).value = ''; }); return; }
    if (document.activeElement !== $('guestName')) $('guestName').value = g.name;
    $('guestType').value = g.type;
    $('guestH').value = g.h;
    $('guestX').value = Math.round(g.x);
    $('guestY').value = Math.round(g.y);
  }

  function addGuest() {
    const n = guests.length + 1, st = window.stage;
    const offset = (n % 2 === 0 ? 1 : -1) * Math.floor(n / 2) * 900;
    const g = {
      id: U.nextId('G', guests), name: '登壇者 ' + n, type: 'high_chair', h: 750,
      x: Math.round(st.x + st.w / 2 + offset), y: Math.round(st.y + st.d / 2)
    };
    guests.push(g);
    selectedId = g.id;
    syncUI(); redraw(); commit('登壇者追加');
  }

  function removeSelected() {
    if (!selected()) return;
    guests = guests.filter(g => g.id !== selectedId);
    selectedId = guests.length ? guests[0].id : null;
    syncUI(); redraw(); commit('登壇者削除');
  }

  // ---------------------------------------------------------------- 描画
  function drawTop(ctx) {
    const T = window.Core.drawText;
    guests.forEach(g => {
      const c = col(g), sel = g.id === selectedId;
      ctx.save();
      ctx.fillStyle = c; ctx.strokeStyle = c;
      ctx.beginPath(); ctx.arc(g.x, g.y, 200, 0, Math.PI * 2);        // 肩幅・胴体
      ctx.globalAlpha = 0.2; ctx.fill(); ctx.globalAlpha = 1;
      ctx.lineWidth = sel ? 35 : 20; ctx.stroke();
      ctx.beginPath(); ctx.arc(g.x + 45, g.y, 85, 0, Math.PI * 2); ctx.fill();   // 頭 (右向き)
      ctx.beginPath();                                                 // 鼻先
      ctx.moveTo(g.x + 130, g.y); ctx.lineTo(g.x + 220, g.y - 45); ctx.lineTo(g.x + 220, g.y + 45);
      ctx.closePath(); ctx.fill();
      ctx.restore();
      T(ctx, g.name + ' ' + (TYPE_BADGE[g.type] || ''), g.x, g.y - 330, { px: 11, bold: true, color: c });
    });
  }

  function drawChairHigh(ctx, x, y, h) {
    ctx.lineWidth = 18;
    ctx.beginPath();
    ctx.moveTo(x - 90, y); ctx.lineTo(x - 40, y - h);
    ctx.moveTo(x + 90, y); ctx.lineTo(x + 40, y - h);
    ctx.moveTo(x - 140, y - h); ctx.lineTo(x + 140, y - h);
    ctx.moveTo(x - 140, y - h); ctx.lineTo(x - 140, y - h - 260);
    ctx.moveTo(x - 60, y - h * 0.45); ctx.lineTo(x + 90, y - h * 0.45);
    ctx.stroke();
  }

  function drawChairLow(ctx, x, y, h) {
    ctx.lineWidth = 18;
    ctx.strokeRect(x - 160, y - h, 320, 40);
    ctx.beginPath();
    ctx.moveTo(x - 120, y - h); ctx.lineTo(x - 120, y);
    ctx.moveTo(x + 120, y - h); ctx.lineTo(x + 120, y);
    ctx.moveTo(x - 160, y - h); ctx.lineTo(x - 160, y - h - 360);
    ctx.stroke();
  }

  /** 右向き人物 (x=奥行きY, y=−床からの高さ)。h: 立ちなら身長 / 着座なら座高 */
  function drawPersonRight(ctx, x, y, h, seated, chairH) {
    ctx.lineWidth = 26;
    if (seated) {
      ctx.beginPath();
      ctx.moveTo(x - 40, y); ctx.lineTo(x - 40, y - h + 180);
      ctx.moveTo(x - 40, y - 50); ctx.lineTo(x + 150, y - 50);
      const drop = chairH > 500 ? chairH * 0.55 : chairH;
      ctx.lineTo(x + 150, y + drop); ctx.lineTo(x + 210, y + drop);
      ctx.stroke();
      ctx.beginPath(); ctx.arc(x + 20, y - h + 90, 85, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.moveTo(x + 95, y - h + 90); ctx.lineTo(x + 150, y - h + 90); ctx.lineTo(x + 110, y - h + 115); ctx.fill();
    } else {
      ctx.beginPath();
      ctx.moveTo(x, y); ctx.lineTo(x, y - h + 180);
      ctx.moveTo(x, y); ctx.lineTo(x + 80, y);
      ctx.stroke();
      ctx.beginPath(); ctx.lineWidth = 18; ctx.moveTo(x, y - h + 260); ctx.lineTo(x + 30, y - h + 540); ctx.stroke();
      ctx.beginPath(); ctx.arc(x, y - h + 90, 85, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.moveTo(x + 75, y - h + 90); ctx.lineTo(x + 130, y - h + 90); ctx.lineTo(x + 90, y - h + 115); ctx.fill();
    }
  }


  // ---------------------------------------------------------------- 身体モデル (部位ごとのカプセル)
  /**
   * 登壇者の身体を部位ごとに返す。座標は絶対 (x,y,z mm)、客席側(+Y)を向いている。
   * 各部位: { id, name, a:[x,y,z], b:[x,y,z], r }  ※ a==b なら球。
   */
  function getBodyParts(g) {
    const x = g.x, y = g.y, z0 = baseZ(g), S = window.seatedTorsoH;
    const standing = g.type === 'standing';
    const Hs = standing ? g.h : S / 0.52;                // 立ったときの身長
    const k = Hs / 1700;
    const P = [];
    const add = (id, name, a, b, r, grp) => P.push({ id, name, a, b: b || a, r: r * k, grp: grp || id });
    const hr = 88;
    if (standing) {
      const top = z0 + Hs, hz = (f) => z0 + Hs * f;
      add('head', '頭', [x, y + 15 * k, top - hr * k], null, hr, 'head');
      add('neck', '首', [x, y, top - 2 * hr * k + 10 * k], [x, y, hz(0.835)], 48, 'neck');
      add('chest', '胸', [x, y, hz(0.79)], [x, y, hz(0.65)], 140, 'chest');
      add('belly', '腹', [x, y, hz(0.62)], [x, y, hz(0.54)], 128, 'belly');
      add('hip', '腰', [x, y, hz(0.52)], [x, y, hz(0.49)], 135, 'hip');
      [-1, 1].forEach(sd => {
        const t = sd < 0 ? '左' : '右';
        add('uarm' + sd, t + '上腕', [x + sd * 185 * k, y, hz(0.80)], [x + sd * 210 * k, y, hz(0.62)], 46, 'arm');
        add('farm' + sd, t + '前腕', [x + sd * 210 * k, y, hz(0.62)], [x + sd * 220 * k, y + 30 * k, hz(0.46)], 40, 'arm');
        add('hand' + sd, t + '手', [x + sd * 222 * k, y + 35 * k, hz(0.44)], null, 38, 'arm');
        add('thigh' + sd, t + '太もも', [x + sd * 95 * k, y, hz(0.50)], [x + sd * 95 * k, y, hz(0.29)], 75, 'thigh');
        add('knee' + sd, t + '膝', [x + sd * 95 * k, y + 5 * k, hz(0.285)], null, 66, 'knee');
        add('shin' + sd, t + 'すね', [x + sd * 95 * k, y, hz(0.27)], [x + sd * 95 * k, y, hz(0.05)], 55, 'shin');
        add('foot' + sd, t + '足', [x + sd * 95 * k, y, hz(0.03)], [x + sd * 95 * k, y + 150 * k, hz(0.02)], 48, 'foot');
      });
    } else {
      const st = z0 + g.h, top = st + S, sz = (f) => st + S * f;
      add('head', '頭', [x, y + 15 * k, top - hr * k], null, hr, 'head');
      add('neck', '首', [x, y, top - 2 * hr * k + 10 * k], [x, y, sz(0.83)], 48, 'neck');
      add('chest', '胸', [x, y, sz(0.78)], [x, y, sz(0.52)], 140, 'chest');
      add('belly', '腹', [x, y, sz(0.46)], [x, y, sz(0.22)], 128, 'belly');
      add('hip', '腰', [x, y - 10 * k, st + 75 * k], [x, y + 20 * k, st + 75 * k], 135, 'hip');
      const thighL = 0.245 * Hs, shinL = 0.245 * Hs;
      [-1, 1].forEach(sd => {
        const t = sd < 0 ? '左' : '右', hx = x + sd * 95 * k, kz = st + 90 * k;
        add('uarm' + sd, t + '上腕', [x + sd * 185 * k, y, sz(0.78)], [x + sd * 200 * k, y + 20 * k, sz(0.36)], 46, 'arm');
        add('farm' + sd, t + '前腕', [x + sd * 200 * k, y + 20 * k, sz(0.36)], [x + sd * 130 * k, y + 250 * k, st + 170 * k], 40, 'arm');
        add('hand' + sd, t + '手', [x + sd * 120 * k, y + 275 * k, st + 165 * k], null, 38, 'arm');
        add('thigh' + sd, t + '太もも', [hx, y, st + 85 * k], [hx, y + thighL, kz], 75, 'thigh');
        add('knee' + sd, t + '膝', [hx, y + thighL, kz], null, 66, 'knee');
        add('shin' + sd, t + 'すね', [hx, y + thighL, kz - 10 * k], [hx, y + thighL + 50 * k, kz - shinL], 55, 'shin');
        add('foot' + sd, t + '足', [hx, y + thighL + 50 * k, kz - shinL - 15 * k], [hx, y + thighL + 200 * k, kz - shinL - 30 * k], 48, 'foot');
      });
    }
    return P;
  }

  function drawSide(ctx) {
    const T = window.Core.drawText;
    const fov = (window.tabCameraModule && window.tabCameraModule.getFovSelection) ? window.tabCameraModule.getFovSelection() : null;

    guests.forEach(g => {
      const sel = g.id === selectedId, bz = baseZ(g), px = g.y, py = -bz;
      ctx.save();
      ctx.globalAlpha = sel ? 1 : (fov && !fov.guestIds.has(g.id) ? 0.3 : 0.95);
      ctx.strokeStyle = ctx.fillStyle = col(g);
      ctx.lineJoin = ctx.lineCap = 'round';

      if (g.type !== 'standing') (g.type === 'high_chair' ? drawChairHigh : drawChairLow)(ctx, px, py, g.h);
      const parts = getBodyParts(g).sort((a, b) => a.a[0] - b.a[0]);     // 左側(奥)から手前へ
      const line = (pt, w, c) => {
        ctx.strokeStyle = ctx.fillStyle = c; ctx.lineWidth = Math.max(w, 2);
        ctx.beginPath(); ctx.moveTo(pt.a[1], -pt.a[2]); ctx.lineTo(pt.b[1], -pt.b[2]); ctx.stroke();
        if (pt.a === pt.b || (pt.a[1] === pt.b[1] && pt.a[2] === pt.b[2])) { ctx.beginPath(); ctx.arc(pt.a[1], -pt.a[2], w / 2, 0, Math.PI * 2); ctx.fill(); }
      };
      parts.forEach(pt => { line(pt, pt.r * 2 + 16, '#ffffff'); line(pt, pt.r * 2, col(g)); });
      const hd = parts.find(q => q.id === 'head');
      if (hd) { ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(hd.a[1] + hd.r * 0.55, -hd.a[2] + hd.r * 0.05, hd.r * 0.16, 0, Math.PI * 2); ctx.fill(); }   // 目 (向き)
      ctx.restore();
      T(ctx, g.name + ' (H:' + g.h + (bz > 0 ? ' 台+' + bz : '') + ')', px, py - headTopRel(g) - 250, { px: 11, bold: true, color: col(g) });
    });
  }

  // ---------------------------------------------------------------- 当たり判定 / ドラッグ
  function hitTest(wx, wy, view) {
    for (let i = guests.length - 1; i >= 0; i--) {
      const g = guests[i];
      if (view === 'top') {
        if (Math.hypot(g.x - wx, g.y - wy) <= 350) return { id: g.id, offX: wx - g.x, offY: wy - g.y };
      } else {
        const bz = baseZ(g);
        if (Math.abs(wx - g.y) <= 350 && wy >= bz - 100 && wy <= bz + headTopRel(g) + 200) return { id: g.id, offX: wx - g.y, offY: 0 };
      }
    }
    return null;
  }

  function onGrab(item) {
    selectedId = item.id;
    syncUI();
    window.Core.switchTab('guests');
    redraw();
  }

  function handleDrag(item, wx, wy, view) {
    const g = guests.find(v => v.id === item.id);
    if (!g) return;
    if (view === 'top') { g.x = Math.round(wx - item.offX); g.y = Math.round(wy - item.offY); }
    else g.y = Math.round(wx - item.offX);
    syncUI();
  }

  // ---------------------------------------------------------------- 保存 / 復元 / 他モジュール向け
  function exportData() { return { list: clone(guests), selectedId, seatedTorsoH: window.seatedTorsoH }; }

  function importData(d) {
    if (!d) return;
    const list = Array.isArray(d) ? d : (Array.isArray(d.list) ? d.list : null);
    if (list) guests = clone(list);
    if (typeof d.seatedTorsoH === 'number') window.seatedTorsoH = d.seatedTorsoH;
    selectedId = guests.some(g => g.id === d.selectedId) ? d.selectedId : (guests[0] ? guests[0].id : null);
    syncUI();
  }

  function getAimTargets() {
    return guests.map(g => ({ id: g.id, name: g.name, x: g.x, y: g.y, h: headTopRel(g), type: g.type, baseZ: baseZ(g), seatH: g.type === 'standing' ? 0 : g.h }));
  }

  window.tabGuestsModule = {
    init: buildUI, drawTop, drawSide, hitTest, onGrab, handleDrag, exportData, importData, syncUI,
    get list() { return guests; },
    get selectedId() { return selectedId; },
    getBaseZ: baseZ,
    getHeadTopZ: (g) => baseZ(g) + headTopRel(g),
    getAimTargets, getBodyParts
  };
  window.Core.register('guests', window.tabGuestsModule, { order: 60 });
})();
