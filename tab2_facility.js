/**
 * ==============================================================================
 * tab2_facility.js — 【会場設備】ステージ / バックパネル / スクリーン
 *
 * 所有する共有データ: window.stage {x,y,w,d,h}, window.isStageLocked,
 *                     window.panels[], window.selectedPanelId,
 *                     window.screens[], window.selectedScreenId
 * 立面図は常に全オブジェクトを描く (旧版の sliceX による非表示はなくした)。
 * ==============================================================================
 */
(function () {
  'use strict';

  const U = window.Core.util;
  const { $, clone, num } = U;
  const commit = (l) => window.Core.commit(l);
  const redraw = () => window.Core.requestRender();

  const SCREEN_PRESETS = {
    '100': [2214, 1245], '120': [2656, 1494], '150': [3320, 1870],
    '200': [4428, 2490], '250': [5535, 3113]
  };

  // ---------------------------------------------------------------- 状態
  window.stage = { x: 3900, y: 1200, w: 7200, d: 2400, h: 200 };
  window.isStageLocked = true;
  window.panels = [
    { id: 'BP1', name: 'メインパネル', enabled: true, w: 7200, d: 240, h: 2650, posType: 'on_stage', customPos: false, x: 3900, y: 1200 }
  ];
  window.selectedPanelId = 'BP1';
  window.screens = [];
  window.selectedScreenId = '';

  const selPanel = () => window.panels.find(p => p.id === window.selectedPanelId) || null;
  const selScreen = () => window.screens.find(s => s.id === window.selectedScreenId) || null;

  // ---------------------------------------------------------------- UI
  function buildUI(panel) {
    if (!panel) return;
    panel.innerHTML = `
      <div class="ui-group">
        <div class="ui-group-title">
          <span>🎭 ステージ寸法 &amp; 配置</span>
          <label class="chk"><input type="checkbox" id="stageLockCheck"> 🔒 位置ロック</label>
        </div>
        <div class="ui-row">
          <div class="input-box"><label>幅 (W mm)</label><input type="number" id="stageW" step="500"></div>
          <div class="input-box"><label>奥行 (D mm)</label><input type="number" id="stageD" step="200"></div>
          <div class="input-box"><label>高さ (H mm)</label><input type="number" id="stageH" step="50"></div>
        </div>
        <div class="ui-row">
          <div class="input-box"><label>配置X (mm)</label><input type="number" id="stageX" step="100"></div>
          <div class="input-box"><label>配置Y (奥から)</label><input type="number" id="stageY" step="100"></div>
        </div>
        <button class="btn-action btn-blue" id="btnCenterStage">🎯 ステージをX軸中央に配置</button>
      </div>

      <div class="ui-group">
        <div class="ui-group-title">
          <span>🖼️ バックパネル (複数・移動可)</span>
          <span class="btn-cluster">
            <button class="btn-action sm" id="btnAddPanel">＋ 追加</button>
            <button class="btn-action sm btn-danger" id="btnDelPanel">削除</button>
          </span>
        </div>
        <div class="ui-row full"><div class="input-box"><label>選択中パネル</label><select id="panelSelect"></select></div></div>
        <div class="ui-row">
          <div class="input-box"><label>名称</label><input type="text" id="panelName"></div>
          <div class="input-box"><label>配置モード</label><label class="chk"><input type="checkbox" id="panelCustomPos"> 📍 自由配置</label></div>
        </div>
        <div class="ui-row">
          <div class="input-box"><label>幅 (W)</label><input type="number" id="panelW" step="200"></div>
          <div class="input-box"><label>高さ (H)</label><input type="number" id="panelH" step="100"></div>
          <div class="input-box"><label>厚み (D)</label><input type="number" id="panelD" step="50"></div>
          <div class="input-box"><label>表示</label><label class="chk"><input type="checkbox" id="panelEnabled"> 表示する</label></div>
        </div>
        <div class="ui-row" id="panelAutoPosBox">
          <div class="input-box">
            <label>ステージ基準位置</label>
            <select id="panelPosType">
              <option value="on_stage">天板奥 (ステージ上奥端)</option>
              <option value="behind_stage">床置き (ステージ背後床面)</option>
            </select>
          </div>
        </div>
        <div class="ui-row hidden" id="panelCustomCoordBox">
          <div class="input-box"><label>配置 X</label><input type="number" id="panelX" step="100"></div>
          <div class="input-box"><label>配置 Y</label><input type="number" id="panelY" step="100"></div>
        </div>
      </div>

      <div class="ui-group">
        <div class="ui-group-title">
          <span>📽️ スクリーン (ドラッグ移動可)</span>
          <span class="btn-cluster">
            <button class="btn-action sm" id="btnAddScreen">＋ 追加</button>
            <button class="btn-action sm btn-danger" id="btnDelScreen">削除</button>
          </span>
        </div>
        <div class="ui-row full"><div class="input-box"><label>選択中スクリーン</label><select id="screenSelect"></select></div></div>
        <div id="screenEditBox" class="ui-group" style="padding:0; border:none; background:none;">
          <div class="ui-row">
            <div class="input-box">
              <label>インチ (16:9)</label>
              <select id="screenPreset">
                <option value="custom">手動 / カスタム</option>
                <option value="100">100インチ (W2214×H1245)</option>
                <option value="120">120インチ (W2656×H1494)</option>
                <option value="150">150インチ (W3320×H1868)</option>
                <option value="200">200インチ (W4428×H2490)</option>
                <option value="250">250インチ (W5535×H3113)</option>
              </select>
            </div>
            <div class="input-box"><label>下端床高 (Z mm)</label><input type="number" id="screenBottomZ" step="100"></div>
          </div>
          <div class="ui-row">
            <div class="input-box"><label>名称</label><input type="text" id="screenName"></div>
            <div class="input-box"><label>幅 (W)</label><input type="number" id="screenW" step="100"></div>
            <div class="input-box"><label>高さ (H)</label><input type="number" id="screenH" step="100"></div>
          </div>
          <div class="ui-row">
            <div class="input-box"><label>配置 X</label><input type="number" id="screenX" step="100"></div>
            <div class="input-box"><label>配置 Y</label><input type="number" id="screenY" step="100"></div>
            <div class="input-box"><label>振り角 (°)</label><input type="number" id="screenAngle" step="5"></div>
          </div>
        </div>
      </div>`;
    bindEvents();
    syncUI();
  }

  function bindEvents() {
    // ---- ステージ
    const readStage = () => {
      const s = window.stage;
      s.w = Math.max(500, num('stageW', 7200));
      s.d = Math.max(500, num('stageD', 2400));
      s.h = Math.max(0, num('stageH', 200));
      s.x = num('stageX', s.x);
      s.y = num('stageY', s.y);
    };
    ['stageW', 'stageD', 'stageH', 'stageX', 'stageY'].forEach(id =>
      $(id).addEventListener('change', () => { readStage(); syncUI(); redraw(); commit('ステージ変更'); }));

    $('stageLockCheck').addEventListener('change', e => {
      window.isStageLocked = e.target.checked;
      syncUI(); redraw(); commit('ステージロック');
    });
    $('btnCenterStage').addEventListener('click', () => {
      window.stage.x = Math.round((window.room.w - window.stage.w) / 2);
      syncUI(); redraw(); commit('ステージ中央配置');
    });

    // ---- バックパネル
    $('btnAddPanel').addEventListener('click', () => {
      const id = U.nextId('BP', window.panels);
      window.panels.push({
        id, name: 'バックパネル ' + (window.panels.length + 1), enabled: true,
        w: 7200, d: 240, h: 2650, posType: 'on_stage', customPos: true,
        x: Math.round(window.stage.x + window.stage.w / 2 - 3600), y: window.stage.y + 100
      });
      window.selectedPanelId = id;
      syncUI(); redraw(); commit('パネル追加');
    });
    $('btnDelPanel').addEventListener('click', () => {
      if (!selPanel()) return;
      window.panels = window.panels.filter(p => p.id !== window.selectedPanelId);
      window.selectedPanelId = window.panels.length ? window.panels[0].id : '';
      syncUI(); redraw(); commit('パネル削除');
    });
    $('panelSelect').addEventListener('change', e => { window.selectedPanelId = e.target.value; syncPanelUI(); redraw(); });

    const readPanel = () => {
      const p = selPanel();
      if (!p) return false;
      const wasCustom = p.customPos;
      p.name = $('panelName').value || 'パネル';
      p.enabled = $('panelEnabled').checked;
      p.customPos = $('panelCustomPos').checked;
      p.w = Math.max(100, num('panelW', 7200));
      p.h = Math.max(100, num('panelH', 2650));
      p.d = Math.max(10, num('panelD', 240));
      p.posType = $('panelPosType').value;
      if (p.customPos && !wasCustom) {            // 自由配置へ切替: 現在の見た目の位置を引き継ぐ
        const pos = panelPos(Object.assign({}, p, { customPos: false }));
        p.x = Math.round(pos.x); p.y = Math.round(pos.y);
      } else if (p.customPos) {
        p.x = num('panelX', p.x);
        p.y = num('panelY', p.y);
      }
      return true;
    };
    ['panelName', 'panelEnabled', 'panelCustomPos', 'panelW', 'panelH', 'panelD', 'panelPosType', 'panelX', 'panelY']
      .forEach(id => $(id).addEventListener('change', () => { if (readPanel()) { syncUI(); redraw(); commit('パネル変更'); } }));

    // ---- スクリーン
    $('btnAddScreen').addEventListener('click', () => {
      const id = U.nextId('SCR', window.screens);
      const n = window.screens.length + 1;
      window.screens.push({
        id, name: 'スクリーン ' + n, w: 3320, h: 1870, bottomZ: 1200,
        x: window.stage.x + 1000 + n * 100, y: window.stage.y + 1500, angle: 0
      });
      window.selectedScreenId = id;
      syncUI(); redraw(); commit('スクリーン追加');
    });
    $('btnDelScreen').addEventListener('click', () => {
      if (!selScreen()) return;
      window.screens = window.screens.filter(s => s.id !== window.selectedScreenId);
      window.selectedScreenId = window.screens.length ? window.screens[0].id : '';
      syncUI(); redraw(); commit('スクリーン削除');
    });
    $('screenSelect').addEventListener('change', e => { window.selectedScreenId = e.target.value; syncScreenUI(); redraw(); });

    $('screenPreset').addEventListener('change', e => {
      const s = selScreen(), pr = SCREEN_PRESETS[e.target.value];
      if (!s || !pr) return;
      s.w = pr[0]; s.h = pr[1];
      syncUI(); redraw(); commit('スクリーンサイズ');
    });

    ['screenName', 'screenW', 'screenH', 'screenBottomZ', 'screenX', 'screenY', 'screenAngle'].forEach(id =>
      $(id).addEventListener('change', () => {
        const s = selScreen();
        if (!s) return;
        s.name = $('screenName').value || 'スクリーン';
        s.w = Math.max(100, num('screenW', 3000));
        s.h = Math.max(100, num('screenH', 1800));
        s.bottomZ = num('screenBottomZ', 1200);
        s.x = num('screenX', s.x);
        s.y = num('screenY', s.y);
        s.angle = num('screenAngle', 0);
        syncUI(); redraw(); commit('スクリーン変更');
      }));
  }

  // ---------------------------------------------------------------- UI 同期
  function syncPanelUI() {
    U.fillSelect('panelSelect', window.panels.map(p => ({ value: p.id, label: p.name + ' (W:' + p.w + ')' })), window.selectedPanelId);
    const p = selPanel();
    const dis = !p;
    ['panelName', 'panelEnabled', 'panelCustomPos', 'panelW', 'panelH', 'panelD', 'panelPosType', 'panelX', 'panelY']
      .forEach(id => { $(id).disabled = dis; });
    if (!p) return;
    $('panelName').value = p.name;
    $('panelEnabled').checked = p.enabled;
    $('panelCustomPos').checked = !!p.customPos;
    $('panelW').value = p.w; $('panelH').value = p.h; $('panelD').value = p.d;
    $('panelPosType').value = p.posType || 'on_stage';
    $('panelX').value = Math.round(p.x); $('panelY').value = Math.round(p.y);
    $('panelAutoPosBox').classList.toggle('hidden', !!p.customPos);
    $('panelCustomCoordBox').classList.toggle('hidden', !p.customPos);
  }

  function syncScreenUI() {
    U.fillSelect('screenSelect', window.screens.map(s => ({ value: s.id, label: s.name + ' (W:' + s.w + ')' })), window.selectedScreenId);
    const s = selScreen();
    $('screenEditBox').style.opacity = s ? '1' : '0.4';
    ['screenPreset', 'screenName', 'screenW', 'screenH', 'screenBottomZ', 'screenX', 'screenY', 'screenAngle']
      .forEach(id => { $(id).disabled = !s; });
    if (!s) return;
    $('screenName').value = s.name;
    $('screenW').value = s.w; $('screenH').value = s.h;
    $('screenBottomZ').value = s.bottomZ;
    $('screenX').value = Math.round(s.x); $('screenY').value = Math.round(s.y);
    $('screenAngle').value = s.angle;
    const match = Object.keys(SCREEN_PRESETS).find(k => SCREEN_PRESETS[k][0] === s.w && SCREEN_PRESETS[k][1] === s.h);
    $('screenPreset').value = match || 'custom';
  }

  function syncUI() {
    if (!$('stageW')) return;
    const s = window.stage;
    $('stageW').value = s.w; $('stageD').value = s.d; $('stageH').value = s.h;
    $('stageX').value = Math.round(s.x); $('stageY').value = Math.round(s.y);
    $('stageLockCheck').checked = !!window.isStageLocked;
    $('stageX').disabled = $('stageY').disabled = !!window.isStageLocked;
    syncPanelUI();
    syncScreenUI();
  }

  // ---------------------------------------------------------------- 幾何
  function panelPos(p) {
    if (p.customPos) return { x: p.x, y: p.y };
    const st = window.stage;
    return {
      x: st.x + (st.w - p.w) / 2,
      y: p.posType === 'behind_stage' ? st.y - p.d - 20 : st.y
    };
  }

  // ---------------------------------------------------------------- 描画
  function drawTop(ctx) {
    const T = window.Core.drawText, st = window.stage;

    ctx.save();
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(st.x, st.y, st.w, st.d);
    if (window.isStageLocked) { ctx.strokeStyle = '#0f172a'; ctx.lineWidth = 30; }
    else { ctx.strokeStyle = '#2563eb'; ctx.lineWidth = 40; ctx.setLineDash([100, 50]); }
    ctx.strokeRect(st.x, st.y, st.w, st.d);
    ctx.restore();
    T(ctx, 'STAGE', st.x + st.w / 2, st.y + st.d / 2, { px: 34, bold: true, color: '#cbd5e1', stroke: null });

    window.panels.forEach(p => {
      if (!p.enabled) return;
      const sel = p.id === window.selectedPanelId, pos = panelPos(p);
      ctx.save();
      ctx.fillStyle = sel ? '#bfdbfe' : '#e2e8f0';
      ctx.strokeStyle = sel ? '#2563eb' : '#475569';
      ctx.lineWidth = sel ? 45 : 30;
      ctx.fillRect(pos.x, pos.y, p.w, p.d);
      ctx.strokeRect(pos.x, pos.y, p.w, p.d);
      ctx.restore();
      T(ctx, p.name, pos.x + p.w / 2, pos.y + p.d / 2, { px: 10, bold: true });
    });

    window.screens.forEach(s => {
      const sel = s.id === window.selectedScreenId;
      ctx.save();
      ctx.translate(s.x, s.y);
      ctx.rotate((s.angle * Math.PI) / 180);
      ctx.strokeStyle = sel ? '#2563eb' : '#0284c7';
      ctx.lineWidth = sel ? 60 : 40;
      ctx.fillStyle = sel ? '#e0f2fe' : '#f8fafc';
      ctx.fillRect(-s.w / 2, -50, s.w, 100);
      ctx.strokeRect(-s.w / 2, -50, s.w, 100);
      ctx.restore();
      // ラベルは回転させず、スクリーンの手前側 (−Y) に表示
      T(ctx, s.name, s.x, s.y - 260, { px: 11, bold: true, color: '#0284c7' });
    });
  }

  function drawSide(ctx) {
    const T = window.Core.drawText, st = window.stage, ceiling = (window.room && window.room.h) || 5000;

    ctx.save();
    ctx.fillStyle = '#ffffff'; ctx.strokeStyle = '#0f172a'; ctx.lineWidth = 30;
    ctx.fillRect(st.y, 0, st.d, -st.h);
    ctx.strokeRect(st.y, 0, st.d, -st.h);
    ctx.restore();
    T(ctx, 'STAGE (H:' + st.h + ')', st.y + st.d / 2, -st.h / 2, { px: 10, bold: true, color: '#475569' });

    const fov = (window.tabCameraModule && window.tabCameraModule.getFovSelection) ? window.tabCameraModule.getFovSelection() : null;
    window.panels.forEach(p => {
      if (!p.enabled) return;
      if (fov && !fov.panelIds.has(p.id) && p.id !== window.selectedPanelId) return;
      const pos = panelPos(p), baseZ = p.posType === 'behind_stage' && !p.customPos ? 0 : st.h;
      ctx.save();
      ctx.fillStyle = '#e2e8f0'; ctx.strokeStyle = '#475569'; ctx.lineWidth = 20;
      ctx.fillRect(pos.y, -baseZ, p.d, -p.h);
      ctx.strokeRect(pos.y, -baseZ, p.d, -p.h);
      ctx.restore();
      T(ctx, p.name + ' (H:' + p.h + ')', pos.y + p.d / 2, -baseZ - p.h / 2, { px: 10, color: '#1e293b' });
    });

    window.screens.forEach(s => {
      if (fov && !fov.screenIds.has(s.id) && s.id !== window.selectedScreenId) return;
      const top = s.bottomZ + s.h;
      ctx.save();
      if (ceiling > top) {                       // 吊りワイヤー
        ctx.strokeStyle = '#94a3b8'; ctx.lineWidth = 6;
        ctx.beginPath(); ctx.moveTo(s.y, -top); ctx.lineTo(s.y, -ceiling); ctx.stroke();
      }
      ctx.fillStyle = '#e0f2fe'; ctx.strokeStyle = '#0284c7'; ctx.lineWidth = 30;
      ctx.fillRect(s.y - 50, -s.bottomZ, 100, -s.h);
      ctx.strokeRect(s.y - 50, -s.bottomZ, 100, -s.h);
      ctx.restore();
      T(ctx, s.name + ' (Z:' + s.bottomZ + ')', s.y, -top - 160, { px: 10, bold: true, color: '#0284c7' });
    });
  }

  // ---------------------------------------------------------------- 当たり判定 (平面図のみ・副作用なし)
  function hitTest(wx, wy, view) {
    if (view !== 'top') return null;
    for (const s of window.screens) {
      if (Math.hypot(s.x - wx, s.y - wy) < s.w / 2) return { type: 'screen', id: s.id, offX: s.x - wx, offY: s.y - wy };
    }
    for (const p of window.panels) {
      if (!p.enabled) continue;
      const pos = panelPos(p);
      if (wx >= pos.x && wx <= pos.x + p.w && wy >= pos.y - 150 && wy <= pos.y + p.d + 150) {
        return { type: 'panel', id: p.id, offX: pos.x - wx, offY: pos.y - wy };
      }
    }
    if (!window.isStageLocked) {
      const st = window.stage;
      if (wx >= st.x && wx <= st.x + st.w && wy >= st.y && wy <= st.y + st.d) {
        return { type: 'stage', offX: st.x - wx, offY: st.y - wy };
      }
    }
    return null;
  }

  function onGrab(item) {
    if (item.type === 'screen') { window.selectedScreenId = item.id; syncScreenUI(); }
    else if (item.type === 'panel') { window.selectedPanelId = item.id; syncPanelUI(); }
    redraw();
  }

  function handleDrag(item, wx, wy) {
    const x = Math.round(wx + item.offX), y = Math.round(wy + item.offY);
    if (item.type === 'screen') {
      const s = window.screens.find(v => v.id === item.id);
      if (s) { s.x = x; s.y = y; syncScreenUI(); }
    } else if (item.type === 'panel') {
      const p = window.panels.find(v => v.id === item.id);
      if (p) { p.customPos = true; p.x = x; p.y = y; syncPanelUI(); }
    } else if (item.type === 'stage') {
      window.stage.x = x; window.stage.y = y;
      $('stageX').value = x; $('stageY').value = y;
    }
  }

  // ---------------------------------------------------------------- 保存 / 復元
  function exportData() {
    return {
      stage: clone(window.stage), isStageLocked: window.isStageLocked,
      panels: clone(window.panels), selectedPanelId: window.selectedPanelId,
      screens: clone(window.screens), selectedScreenId: window.selectedScreenId
    };
  }

  function importData(d) {
    if (!d) return;
    if (d.stage) window.stage = Object.assign({ x: 3900, y: 1200, w: 7200, d: 2400, h: 200 }, clone(d.stage));
    if (d.isStageLocked !== undefined) window.isStageLocked = !!d.isStageLocked;
    if (Array.isArray(d.panels)) window.panels = clone(d.panels);
    if (Array.isArray(d.screens)) window.screens = clone(d.screens);
    window.selectedPanelId = window.panels.some(p => p.id === d.selectedPanelId) ? d.selectedPanelId : (window.panels[0] ? window.panels[0].id : '');
    window.selectedScreenId = window.screens.some(s => s.id === d.selectedScreenId) ? d.selectedScreenId : (window.screens[0] ? window.screens[0].id : '');
    syncUI();
  }

  window.tabFacilityModule = { init: buildUI, drawTop, drawSide, hitTest, onGrab, handleDrag, exportData, importData, syncUI, getPanelPos: panelPos,
    getPanelZRange: (p) => { const bz = p.posType === 'behind_stage' && !p.customPos ? 0 : window.stage.h; return [bz, bz + p.h]; } };
  window.Core.register('facility', window.tabFacilityModule, { order: 20 });
})();
