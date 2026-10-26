/**
 * ==============================================================================
 * tab5_stage_items.js — 【舞台什器】机 / 椅子 / 展示台
 *
 * 所有する共有データ: window.stageItems[] , window.selectedStageItemId
 *   { id, name, category:'table'|'chair'|'display', shape:'rect'|'circle', chairType:'high'|'low',
 *     baseType:'auto'|'floor'|'stage', w, d, h, angle, x, y }
 * 設置基準面 baseType で立面図の接地高さを決める (auto = ステージ内ならステージ上)。
 * ==============================================================================
 */
(function () {
  'use strict';

  const U = window.Core.util;
  const { $, clone, num } = U;
  const commit = (l) => window.Core.commit(l);
  const redraw = () => window.Core.requestRender();

  const CAT_LABEL = { table: '机', chair: '椅子', display: '展示台' };
  const COLORS = {
    table:   { line: '#0284c7', lineSel: '#2563eb', fill: '#ffffff', fillSel: '#e0f2fe' },
    chair:   { line: '#ea580c', lineSel: '#dc2626', fill: '#ffffff', fillSel: '#fee2e2' },
    display: { line: '#9333ea', lineSel: '#7c3aed', fill: '#ffffff', fillSel: '#f3e8ff' }
  };

  window.stageItems = [];
  window.selectedStageItemId = null;

  const selected = () => window.stageItems.find(i => i.id === window.selectedStageItemId) || null;
  const isRound = (it) => it.category !== 'chair' && it.shape === 'circle';
  const depthOf = (it) => isRound(it) ? it.w : (it.d || 450);

  function baseZ(it) {
    const stH = (window.stage && window.stage.h) || 0;
    if (it.baseType === 'floor') return 0;
    if (it.baseType === 'stage') return stH;
    return window.isInsideStage(it.x, it.y) ? stH : 0;
  }

  // ---------------------------------------------------------------- UI
  function buildUI(panel) {
    if (!panel) return;
    panel.innerHTML = `
      <div class="ui-group">
        <div class="ui-group-title">
          <span>🛋️ 舞台什器 (机 / 椅子 / 展示台)</span>
          <span class="btn-cluster">
            <button class="btn-action sm" id="btnAddStageItem">＋ 追加</button>
            <button class="btn-action sm btn-danger" id="btnDelStageItem">削除</button>
          </span>
        </div>
        <div class="ui-row full"><div class="input-box"><label>選択什器</label><select id="stageItemSelect"></select></div></div>
        <div class="ui-row">
          <div class="input-box"><label>名称</label><input type="text" id="siName"></div>
          <div class="input-box">
            <label>種類</label>
            <select id="siCategory">
              <option value="table">テーブル</option><option value="chair">椅子</option><option value="display">展示台</option>
            </select>
          </div>
        </div>
        <div class="ui-row">
          <div class="input-box">
            <label id="siTypeLabel">形状</label>
            <select id="siShape"><option value="rect">四角形</option><option value="circle">円形 / 円柱</option></select>
            <select id="siChairType" class="hidden"><option value="high">ハイチェア</option><option value="low">ローチェア</option></select>
          </div>
          <div class="input-box"><label>角度 (°)</label><input type="number" id="siAngle" step="5"></div>
        </div>
        <div class="ui-row">
          <div class="input-box"><label id="siWLabel">幅 W (mm)</label><input type="number" id="siW" step="50"></div>
          <div class="input-box"><label id="siDLabel">奥行 D (mm)</label><input type="number" id="siD" step="50"></div>
          <div class="input-box"><label>高さ H (mm)</label><input type="number" id="siH" step="50"></div>
        </div>
        <div class="ui-row">
          <div class="input-box"><label>配置 X (mm)</label><input type="number" id="siX" step="100"></div>
          <div class="input-box"><label>配置 Y (mm)</label><input type="number" id="siY" step="100"></div>
          <div class="input-box">
            <label>設置基準面</label>
            <select id="siBaseType">
              <option value="auto">自動 (座標判定)</option>
              <option value="floor">🟩 床面 (FL±0)</option>
              <option value="stage">🏛️ ステージ上</option>
            </select>
          </div>
        </div>
      </div>`;
    bind();
    syncUI();
  }

  const FIELDS = ['siName', 'siCategory', 'siShape', 'siChairType', 'siBaseType', 'siW', 'siD', 'siH', 'siAngle', 'siX', 'siY'];

  function bind() {
    $('btnAddStageItem').addEventListener('click', () => {
      const st = window.stage, id = U.nextId('SI', window.stageItems);
      window.stageItems.push({
        id, name: '什器 ' + (window.stageItems.length + 1), category: 'table', shape: 'rect', chairType: 'high',
        baseType: 'auto', w: 900, d: 600, h: 700, angle: 0,
        x: Math.round(st.x + st.w / 2), y: Math.round(st.y + st.d / 2)
      });
      window.selectedStageItemId = id;
      syncUI(); redraw(); commit('什器追加');
    });
    $('btnDelStageItem').addEventListener('click', () => {
      if (!selected()) return;
      window.stageItems = window.stageItems.filter(i => i.id !== window.selectedStageItemId);
      window.selectedStageItemId = window.stageItems.length ? window.stageItems[0].id : null;
      syncUI(); redraw(); commit('什器削除');
    });
    $('stageItemSelect').addEventListener('change', e => { window.selectedStageItemId = e.target.value; syncUI(); redraw(); });

    FIELDS.forEach(id => $(id).addEventListener('change', () => {
      const it = selected();
      if (!it) return;
      it.name = $('siName').value || '什器';
      it.category = $('siCategory').value;
      it.shape = $('siShape').value;
      it.chairType = $('siChairType').value;
      it.baseType = $('siBaseType').value || 'auto';
      it.w = Math.max(50, num('siW', 450));
      it.d = isRound(it) ? it.w : Math.max(50, num('siD', 450));
      it.h = Math.max(10, num('siH', 700));
      it.angle = num('siAngle', 0);
      it.x = num('siX', it.x);
      it.y = num('siY', it.y);
      syncUI(); redraw(); commit('什器変更');
    }));
  }

  function syncUI() {
    if (!$('stageItemSelect')) return;
    const list = window.stageItems;
    if (!selected() && list.length) window.selectedStageItemId = list[0].id;
    if (!list.length) window.selectedStageItemId = null;

    U.fillSelect('stageItemSelect',
      list.length ? list.map(i => ({ value: i.id, label: '[' + (CAT_LABEL[i.category] || '什器') + '] ' + i.name })) : [{ value: '', label: '※ 什器がありません (0個)' }],
      window.selectedStageItemId || '');
    $('stageItemSelect').disabled = !list.length;

    const it = selected();
    FIELDS.forEach(id => { $(id).disabled = !it; });
    if (!it) { FIELDS.forEach(id => { if ($(id).tagName === 'INPUT') $(id).value = ''; }); return; }

    $('siName').value = it.name;
    $('siCategory').value = it.category;
    $('siShape').value = it.shape || 'rect';
    $('siChairType').value = it.chairType || 'high';
    $('siBaseType').value = it.baseType || 'auto';
    $('siW').value = it.w;
    $('siD').value = isRound(it) ? it.w : it.d;
    $('siH').value = it.h;
    $('siAngle').value = it.angle || 0;
    $('siX').value = Math.round(it.x);
    $('siY').value = Math.round(it.y);

    const chair = it.category === 'chair';
    $('siShape').classList.toggle('hidden', chair);
    $('siChairType').classList.toggle('hidden', !chair);
    $('siTypeLabel').textContent = chair ? 'タイプ' : '形状';
    $('siWLabel').textContent = isRound(it) ? '直径 (mm)' : '幅 W (mm)';
    $('siDLabel').textContent = isRound(it) ? '奥行 (固定)' : '奥行 D (mm)';
    $('siD').disabled = isRound(it);
  }

  // ---------------------------------------------------------------- 描画
  function drawTop(ctx) {
    const T = window.Core.drawText;
    window.stageItems.forEach(it => {
      const sel = it.id === window.selectedStageItemId, c = COLORS[it.category] || COLORS.table;
      const line = sel ? c.lineSel : c.line;
      ctx.save();
      ctx.translate(it.x, it.y);
      ctx.rotate((it.angle || 0) * Math.PI / 180);
      ctx.strokeStyle = line;
      ctx.fillStyle = sel ? c.fillSel : c.fill;
      ctx.lineWidth = sel ? 30 : 18;

      if (isRound(it)) {
        ctx.beginPath(); ctx.arc(0, 0, it.w / 2, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        if (it.category === 'display') { ctx.beginPath(); ctx.arc(0, 0, it.w / 2 - 30, 0, Math.PI * 2); ctx.stroke(); }
      } else {
        ctx.fillRect(-it.w / 2, -it.d / 2, it.w, it.d);
        ctx.strokeRect(-it.w / 2, -it.d / 2, it.w, it.d);
        if (it.category === 'chair') { ctx.fillStyle = line; ctx.fillRect(-it.w / 2, -it.d / 2, it.w, 60); }   // 背もたれ側
        if (it.category === 'display') ctx.strokeRect(-it.w / 2 + 30, -it.d / 2 + 30, it.w - 60, it.d - 60);
      }
      ctx.restore();
      T(ctx, it.name + (it.category === 'chair' ? (it.chairType === 'high' ? '(H)' : '(L)') : ''), it.x, it.y, { px: 10, bold: true, color: line });
    });
  }

  function drawSide(ctx) {
    const T = window.Core.drawText;
    window.stageItems.forEach(it => {
      const sel = it.id === window.selectedStageItemId, c = COLORS[it.category] || COLORS.table;
      const bz = baseZ(it), D = depthOf(it), H = it.h || 700, y0 = it.y - D / 2;
      ctx.save();
      ctx.lineWidth = sel ? 28 : 18;
      ctx.fillStyle = sel ? c.fillSel : c.fill;
      ctx.strokeStyle = sel ? c.lineSel : c.line;

      if (it.category === 'table') {
        ctx.fillRect(y0, -bz - H, D, 50); ctx.strokeRect(y0, -bz - H, D, 50);              // 天板
        ctx.beginPath();
        ctx.moveTo(y0 + 30, -bz - H + 50); ctx.lineTo(y0 + 30, -bz);
        ctx.moveTo(y0 + D - 30, -bz - H + 50); ctx.lineTo(y0 + D - 30, -bz);                // 脚
        ctx.stroke();
      } else if (it.category === 'chair') {
        ctx.fillRect(y0, -bz - H, D, 40); ctx.strokeRect(y0, -bz - H, D, 40);              // 座面
        ctx.beginPath();
        ctx.moveTo(y0 + 25, -bz - H + 40); ctx.lineTo(y0 + 25, -bz);
        ctx.moveTo(y0 + D - 25, -bz - H + 40); ctx.lineTo(y0 + D - 25, -bz);
        if (it.chairType === 'high') { ctx.moveTo(y0 + 25, -bz - 250); ctx.lineTo(y0 + D - 25, -bz - 250); }   // ステップ
        ctx.stroke();
        const backH = it.chairType === 'high' ? 220 : 320;
        ctx.fillRect(y0, -bz - H - backH, 25, backH); ctx.strokeRect(y0, -bz - H - backH, 25, backH);          // 背もたれ
      } else {
        ctx.fillRect(y0, -bz - H, D, H); ctx.strokeRect(y0, -bz - H, D, H);                // 展示台
      }
      ctx.restore();
      T(ctx, it.name + ' (H:' + H + ')', it.y, -bz - H - 120, { px: 10, bold: true, color: sel ? c.lineSel : c.line });
    });
  }

  // ---------------------------------------------------------------- 当たり判定 / ドラッグ
  function hitTest(wx, wy, view) {
    for (let i = window.stageItems.length - 1; i >= 0; i--) {
      const it = window.stageItems[i];
      if (view === 'top') {
        const dx = wx - it.x, dy = wy - it.y, a = -(it.angle || 0) * Math.PI / 180;
        const rx = dx * Math.cos(a) - dy * Math.sin(a), ry = dx * Math.sin(a) + dy * Math.cos(a);
        const hit = isRound(it) ? Math.hypot(rx, ry) <= it.w / 2 : (Math.abs(rx) <= it.w / 2 && Math.abs(ry) <= depthOf(it) / 2);
        if (hit) return { id: it.id, offX: it.x - wx, offY: it.y - wy };
      } else {
        const bz = baseZ(it), top = bz + it.h + (it.category === 'chair' ? 320 : 0);
        if (Math.abs(wx - it.y) <= depthOf(it) / 2 && wy >= bz && wy <= top) return { id: it.id, offX: it.y - wx, offY: 0 };
      }
    }
    return null;
  }

  function onGrab(item) { window.selectedStageItemId = item.id; syncUI(); redraw(); }

  function handleDrag(item, wx, wy, view) {
    const it = window.stageItems.find(v => v.id === item.id);
    if (!it) return;
    if (view === 'top') { it.x = Math.round(wx + item.offX); it.y = Math.round(wy + item.offY); }
    else it.y = Math.round(wx + item.offX);
    syncUI();
  }

  // ---------------------------------------------------------------- 保存 / 復元
  function exportData() { return { stageItems: clone(window.stageItems), selectedStageItemId: window.selectedStageItemId }; }

  function importData(d) {
    if (!d) return;
    const list = Array.isArray(d) ? d : d.stageItems;
    if (Array.isArray(list)) window.stageItems = clone(list);
    window.selectedStageItemId = window.stageItems.some(i => i.id === d.selectedStageItemId) ? d.selectedStageItemId : (window.stageItems[0] ? window.stageItems[0].id : null);
    syncUI();
  }

  window.tabStageItemsModule = { init: buildUI, drawTop, drawSide, hitTest, onGrab, handleDrag, exportData, importData, syncUI, getBaseZ: baseZ };
  window.Core.register('stage_items', window.tabStageItemsModule, { order: 30 });
})();
