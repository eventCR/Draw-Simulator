/**
 * ==============================================================================
 * tab9_equipment.js — 【機材・備品】オペ卓 / 制作物 / 照明スタンド
 *
 * 所有する共有データ: window.equipments[] , window.selectedEquipId
 *   { id, type:'ope'|'custom'|'light', name, x, y, angle, w, d, h, hasChairs?, shape? }
 * 旧版では描画・クリック判定がコアに接続されておらず表示されなかったが、
 * 今回は Core.register で正式に接続している。
 * ==============================================================================
 */
(function () {
  'use strict';

  const U = window.Core.util;
  const { $, clone, num } = U;
  const commit = (l) => window.Core.commit(l);
  const redraw = () => window.Core.requestRender();

  const TYPE_LABEL = { ope: 'オペ卓', custom: '制作物', light: '照明' };

  window.equipments = [];
  window.selectedEquipId = null;

  const selected = () => window.equipments.find(e => e.id === window.selectedEquipId) || null;
  const baseZ = (eq) => window.isInsideStage(eq.x, eq.y) ? window.stage.h : 0;

  /** 回転後の外接範囲 (半幅) */
  function spans(eq) {
    const r = (eq.angle || 0) * Math.PI / 180, hw = eq.w / 2, hd = eq.d / 2;
    return {
      x: Math.abs(hw * Math.cos(r)) + Math.abs(hd * Math.sin(r)),
      y: Math.abs(hw * Math.sin(r)) + Math.abs(hd * Math.cos(r))
    };
  }

  // ---------------------------------------------------------------- UI
  function buildUI(panel) {
    if (!panel) return;
    panel.innerHTML = `
      <div class="ui-group">
        <div class="ui-group-title">
          <span>🛠 機材・備品 (オペ卓/制作物/照明)</span>
          <span class="btn-cluster">
            <button class="btn-action sm" id="btnAddOpe">＋ オペ卓</button>
            <button class="btn-action sm" id="btnAddCustom">＋ 制作物</button>
            <button class="btn-action sm" id="btnAddLight">＋ 照明</button>
            <button class="btn-action sm btn-danger" id="btnDelEquip">削除</button>
          </span>
        </div>
        <div class="ui-row full"><div class="input-box"><label>選択中の機材</label><select id="equipSelect"></select></div></div>
        <div class="ui-row">
          <div class="input-box"><label>名称</label><input type="text" id="equipName"></div>
          <div class="input-box"><label>種類</label><input type="text" id="equipTypeDisplay" disabled></div>
        </div>
        <div class="ui-row">
          <div class="input-box"><label>配置 X (mm)</label><input type="number" id="equipX" step="100"></div>
          <div class="input-box"><label>配置 Y (mm)</label><input type="number" id="equipY" step="100"></div>
          <div class="input-box"><label>角度 (°)</label><input type="number" id="equipAngle" step="5"></div>
        </div>
        <div class="ui-row">
          <div class="input-box"><label>幅 W (mm)</label><input type="number" id="equipW" step="100"></div>
          <div class="input-box"><label>奥行 D (mm)</label><input type="number" id="equipD" step="100"></div>
          <div class="input-box"><label>高さ H (mm)</label><input type="number" id="equipH" step="100"></div>
        </div>
        <div class="ui-row full hidden" id="equipOpeBox"><label class="chk"><input type="checkbox" id="equipHasChairs"> 🪑 椅子を付ける (W900につき1席自動配置)</label></div>
        <div class="ui-row full hidden" id="equipCustomBox">
          <div class="input-box"><label>形状</label>
            <select id="equipShape"><option value="rect">四角形</option><option value="circle">丸 (円形・楕円)</option><option value="triangle">三角形</option></select>
          </div>
        </div>
        <div class="hint hidden" id="equipLightBox">※照明スタンド型。W・Dは三脚のフットプリント (推奨800角)、Hはスタンド高さ。画角の描画は行いません。</div>
      </div>`;
    bind();
    syncUI();
  }

  const FIELDS = ['equipName', 'equipX', 'equipY', 'equipAngle', 'equipW', 'equipD', 'equipH', 'equipShape', 'equipHasChairs'];

  function bind() {
    $('btnAddOpe').addEventListener('click', () => addEquip('ope'));
    $('btnAddCustom').addEventListener('click', () => addEquip('custom'));
    $('btnAddLight').addEventListener('click', () => addEquip('light'));
    $('btnDelEquip').addEventListener('click', () => {
      if (!selected()) return;
      window.equipments = window.equipments.filter(e => e.id !== window.selectedEquipId);
      window.selectedEquipId = window.equipments.length ? window.equipments[0].id : null;
      syncUI(); redraw(); commit('機材削除');
    });
    $('equipSelect').addEventListener('change', e => { window.selectedEquipId = e.target.value; syncUI(); redraw(); });

    FIELDS.forEach(id => $(id).addEventListener('change', () => {
      const eq = selected();
      if (!eq) return;
      eq.name = $('equipName').value || '無名';
      eq.x = num('equipX', eq.x);
      eq.y = num('equipY', eq.y);
      eq.angle = num('equipAngle', 0);
      eq.w = Math.max(50, num('equipW', 100));
      eq.d = Math.max(50, num('equipD', 100));
      eq.h = Math.max(50, num('equipH', 100));
      if (eq.type === 'ope') eq.hasChairs = $('equipHasChairs').checked;
      if (eq.type === 'custom') eq.shape = $('equipShape').value;
      syncUI(); redraw(); commit('機材変更');
    }));
  }

  function addEquip(type) {
    const n = window.equipments.length + 1, id = U.nextId('EQ', window.equipments);
    const st = window.stage;
    const eq = { id, type, x: Math.round(window.room.w / 2), y: Math.round(st.y + st.d + 1500), angle: 0 };
    if (type === 'ope') Object.assign(eq, { name: 'オペ卓 ' + n, w: 1800, d: 600, h: 700, hasChairs: true });
    else if (type === 'custom') Object.assign(eq, { name: '展示台 ' + n, w: 900, d: 900, h: 1000, shape: 'rect' });
    else Object.assign(eq, { name: '照明（スタンド） ' + n, w: 800, d: 800, h: 2000 });
    window.equipments.push(eq);
    window.selectedEquipId = id;
    syncUI(); redraw(); commit('機材追加');
  }

  function syncUI() {
    if (!$('equipSelect')) return;
    const list = window.equipments;
    if (!selected() && list.length) window.selectedEquipId = list[0].id;
    if (!list.length) window.selectedEquipId = null;

    U.fillSelect('equipSelect',
      list.length ? list.map(e => ({ value: e.id, label: e.name + ' (' + TYPE_LABEL[e.type] + ')' })) : [{ value: '', label: '※ 機材がありません (0個)' }],
      window.selectedEquipId || '');
    const eq = selected();
    ['equipSelect', 'btnDelEquip'].concat(FIELDS).forEach(id => { $(id).disabled = !eq && id !== 'btnDelEquip' ? true : (id === 'btnDelEquip' ? !eq : false); });
    $('equipSelect').disabled = !eq;

    $('equipOpeBox').classList.toggle('hidden', !eq || eq.type !== 'ope');
    $('equipCustomBox').classList.toggle('hidden', !eq || eq.type !== 'custom');
    $('equipLightBox').classList.toggle('hidden', !eq || eq.type !== 'light');
    if (!eq) {
      FIELDS.forEach(id => { if ($(id).tagName === 'INPUT' && $(id).type !== 'checkbox') $(id).value = ''; });
      $('equipTypeDisplay').value = '機材なし';
      return;
    }
    $('equipName').value = eq.name;
    $('equipTypeDisplay').value = TYPE_LABEL[eq.type];
    $('equipX').value = Math.round(eq.x); $('equipY').value = Math.round(eq.y); $('equipAngle').value = eq.angle || 0;
    $('equipW').value = eq.w; $('equipD').value = eq.d; $('equipH').value = eq.h;
    if (eq.type === 'ope') $('equipHasChairs').checked = !!eq.hasChairs;
    if (eq.type === 'custom') $('equipShape').value = eq.shape || 'rect';
  }

  // ---------------------------------------------------------------- 描画
  function drawTop(ctx) {
    const T = window.Core.drawText;
    window.equipments.forEach(eq => {
      const sel = eq.id === window.selectedEquipId;
      ctx.save();
      ctx.translate(eq.x, eq.y);
      ctx.rotate((eq.angle || 0) * Math.PI / 180);
      ctx.strokeStyle = sel ? '#2563eb' : '#475569';
      ctx.lineWidth = sel ? 30 : 20;

      if (eq.type === 'ope') {
        ctx.fillStyle = sel ? '#bfdbfe' : '#f1f5f9';
        ctx.fillRect(-eq.w / 2, -eq.d / 2, eq.w, eq.d);
        ctx.strokeRect(-eq.w / 2, -eq.d / 2, eq.w, eq.d);
        if (eq.hasChairs) {
          const n = Math.max(1, Math.floor(eq.w / 900)), cw = 400, cd = 400;
          ctx.fillStyle = '#cbd5e1';
          for (let i = 0; i < n; i++) {
            const cx = -eq.w / 2 + eq.w / (n * 2) + i * (eq.w / n) - cw / 2, cy = eq.d / 2 + 100;
            ctx.fillRect(cx, cy, cw, cd); ctx.strokeRect(cx, cy, cw, cd);
          }
        }
      } else if (eq.type === 'custom') {
        ctx.fillStyle = sel ? '#fef08a' : '#fef9c3';
        if (eq.shape === 'circle') {
          ctx.beginPath(); ctx.ellipse(0, 0, eq.w / 2, eq.d / 2, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        } else if (eq.shape === 'triangle') {
          ctx.beginPath(); ctx.moveTo(0, -eq.d / 2); ctx.lineTo(eq.w / 2, eq.d / 2); ctx.lineTo(-eq.w / 2, eq.d / 2); ctx.closePath(); ctx.fill(); ctx.stroke();
        } else {
          ctx.fillRect(-eq.w / 2, -eq.d / 2, eq.w, eq.d); ctx.strokeRect(-eq.w / 2, -eq.d / 2, eq.w, eq.d);
        }
      } else {                                       // 照明: 三脚 + ヘッド
        const r = Math.min(eq.w, eq.d) / 2;
        ctx.beginPath();
        for (let i = 0; i < 3; i++) { const a = (i * 120 + 90) * Math.PI / 180; ctx.moveTo(0, 0); ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
        ctx.stroke();
        ctx.fillStyle = sel ? '#fde047' : '#ffffff';
        ctx.fillRect(-150, -50, 300, 100); ctx.strokeRect(-150, -50, 300, 100);
      }
      ctx.restore();
      T(ctx, eq.name, eq.x, eq.y, { px: 10, bold: true });
    });
  }

  function drawSide(ctx) {
    const T = window.Core.drawText;
    window.equipments.forEach(eq => {
      const sel = eq.id === window.selectedEquipId, bz = baseZ(eq), sp = spans(eq);
      ctx.save();
      ctx.strokeStyle = sel ? '#2563eb' : '#475569';
      ctx.lineWidth = 20;
      if (eq.type === 'light') {
        ctx.beginPath(); ctx.moveTo(eq.y, -bz); ctx.lineTo(eq.y, -bz - eq.h + 50); ctx.lineWidth = 15; ctx.stroke();
        ctx.fillStyle = sel ? '#fde047' : '#ffffff';
        ctx.fillRect(eq.y - 100, -bz - eq.h, 200, 100); ctx.strokeRect(eq.y - 100, -bz - eq.h, 200, 100);
      } else {
        ctx.fillStyle = eq.type === 'ope' ? (sel ? '#bfdbfe' : '#f1f5f9') : (sel ? '#fef08a' : '#fef9c3');
        ctx.fillRect(eq.y - sp.y, -bz - eq.h, sp.y * 2, eq.h);
        ctx.strokeRect(eq.y - sp.y, -bz - eq.h, sp.y * 2, eq.h);
        if (eq.type === 'ope' && eq.hasChairs) {
          const cy = eq.y + sp.y + 250;
          ctx.fillStyle = '#cbd5e1';
          ctx.fillRect(cy - 200, -bz - 450, 400, 450); ctx.strokeRect(cy - 200, -bz - 450, 400, 450);
        }
      }
      ctx.restore();
      T(ctx, eq.name + ' (H:' + eq.h + ')', eq.y, -bz - eq.h - 120, { px: 10, bold: true });
    });
  }

  // ---------------------------------------------------------------- 当たり判定 / ドラッグ
  function hitTest(wx, wy, view) {
    for (let i = window.equipments.length - 1; i >= 0; i--) {
      const eq = window.equipments[i];
      if (view === 'top') {
        const dx = wx - eq.x, dy = wy - eq.y, a = -(eq.angle || 0) * Math.PI / 180;
        const rx = dx * Math.cos(a) - dy * Math.sin(a), ry = dx * Math.sin(a) + dy * Math.cos(a);
        if (Math.abs(rx) <= eq.w / 2 && Math.abs(ry) <= eq.d / 2) return { id: eq.id, offX: eq.x - wx, offY: eq.y - wy };
      } else {
        const bz = baseZ(eq), sy = eq.type === 'light' ? 200 : spans(eq).y;
        if (Math.abs(wx - eq.y) <= sy && wy >= bz && wy <= bz + eq.h) return { id: eq.id, offX: eq.y - wx, offY: 0 };
      }
    }
    return null;
  }

  function onGrab(item) { window.selectedEquipId = item.id; syncUI(); redraw(); }

  function handleDrag(item, wx, wy, view) {
    const eq = window.equipments.find(e => e.id === item.id);
    if (!eq) return;
    if (view === 'top') { eq.x = Math.round(wx + item.offX); eq.y = Math.round(wy + item.offY); }
    else eq.y = Math.round(wx + item.offX);
    syncUI();
  }

  // ---------------------------------------------------------------- 保存 / 復元
  function exportData() { return { equipments: clone(window.equipments), selectedEquipId: window.selectedEquipId }; }

  function importData(d) {
    if (!d) return;
    const list = Array.isArray(d) ? d : d.equipments;
    if (Array.isArray(list)) window.equipments = clone(list);
    window.selectedEquipId = window.equipments.some(e => e.id === d.selectedEquipId) ? d.selectedEquipId : (window.equipments[0] ? window.equipments[0].id : null);
    syncUI();
  }

  window.tabEquipmentModule = { init: buildUI, drawTop, drawSide, hitTest, onGrab, handleDrag, exportData, importData, syncUI };
  window.Core.register('equipment', window.tabEquipmentModule, { order: 55 });
})();
