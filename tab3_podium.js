/**
 * ==============================================================================
 * tab3_podium.js — 【司会台 / 演台】
 *
 * 所有する共有データ: window.podiums[]
 *   { id, type:'mc'|'lecture', name, enabled, w, d, h, angle, x, y, hasHost }
 * 色: 司会台=緑 / 演台=橙 / 選択中=青。立面図は 横軸=Y・縦軸=−Z、ステージ上なら段差分だけ持ち上げる。
 * ==============================================================================
 */
(function () {
  'use strict';

  const U = window.Core.util;
  const { $, clone, num } = U;
  const commit = (l) => window.Core.commit(l);
  const redraw = () => window.Core.requestRender();

  const COLOR = { mc: '#16a34a', lecture: '#ea580c', sel: '#2563eb' };

  window.podiums = [
    { id: 'POD_MC_1', type: 'mc', name: '司会台', enabled: true, w: 900, d: 600, h: 1100, angle: 15, x: 12211, y: 3222, hasHost: true }
  ];
  let selectedId = 'POD_MC_1';

  const selected = () => window.podiums.find(p => p.id === selectedId) || null;
  const colorOf = (p) => p.id === selectedId ? COLOR.sel : (p.type === 'lecture' ? COLOR.lecture : COLOR.mc);
  const baseZOf = (p) => window.isInsideStage(p.x, p.y) ? window.stage.h : 0;
  const label = (p) => (p.type === 'lecture' ? '📙 [演台] ' : '🎤 [司会] ') + p.name + (p.enabled ? '' : ' (無効)');

  // ---------------------------------------------------------------- UI
  function buildUI(panel) {
    if (!panel) return;
    panel.innerHTML = `
      <div class="ui-group">
        <div class="ui-group-title">
          <span>🎤 司会台 / 演台 管理</span>
          <span class="btn-cluster">
            <button class="btn-action sm btn-green" id="btnAddMc">＋ 司会台</button>
            <button class="btn-action sm btn-amber" id="btnAddLec">＋ 演台</button>
          </span>
        </div>
        <div class="ui-row full"><div class="input-box"><label>対象を選択</label><select id="podiumSelect"></select></div></div>
        <div id="podiumControls">
          <div class="ui-row">
            <div class="input-box" style="flex:2"><label>名称 (表示名)</label><input type="text" id="podiumName"></div>
            <div class="input-box"><label>&nbsp;</label><label class="chk"><input type="checkbox" id="podiumEnabled"> 有効</label></div>
          </div>
          <div class="ui-row">
            <div class="input-box"><label>幅 (W) mm</label><input type="number" id="podiumW" step="50"></div>
            <div class="input-box"><label>奥行 (D) mm</label><input type="number" id="podiumD" step="50"></div>
            <div class="input-box"><label>高さ (H) mm</label><input type="number" id="podiumH" step="50"></div>
          </div>
          <div class="ui-row">
            <div class="input-box"><label>角度 (°)</label><input type="number" id="podiumAngle" step="5"></div>
            <div class="input-box"><label>位置 X mm</label><input type="number" id="podiumX" step="100"></div>
            <div class="input-box"><label>位置 Y mm</label><input type="number" id="podiumY" step="100"></div>
          </div>
          <div class="ui-row" style="justify-content:space-between; margin-top:6px;">
            <label class="chk"><input type="checkbox" id="podiumHost"> <span id="podiumHostLabel">司会者 (パーソン) を配置する</span></label>
            <button class="btn-action sm btn-danger" id="btnDelPodium">削除</button>
          </div>
        </div>
      </div>`;
    bind();
    syncUI();
  }

  function bind() {
    $('btnAddMc').addEventListener('click', () => addPodium('mc'));
    $('btnAddLec').addEventListener('click', () => addPodium('lecture'));
    $('btnDelPodium').addEventListener('click', deletePodium);
    $('podiumSelect').addEventListener('change', e => { selectedId = e.target.value; syncUI(); redraw(); });

    const read = () => {
      const p = selected();
      if (!p) return false;
      p.name = $('podiumName').value;
      p.enabled = $('podiumEnabled').checked;
      p.w = Math.max(100, num('podiumW', 900));
      p.d = Math.max(100, num('podiumD', 600));
      p.h = Math.max(100, num('podiumH', 1100));
      p.angle = num('podiumAngle', 0);
      p.x = num('podiumX', p.x);
      p.y = num('podiumY', p.y);
      p.hasHost = $('podiumHost').checked;
      return true;
    };
    ['podiumName', 'podiumEnabled', 'podiumW', 'podiumD', 'podiumH', 'podiumAngle', 'podiumX', 'podiumY', 'podiumHost']
      .forEach(id => $(id).addEventListener('change', () => { if (read()) { syncUI(); redraw(); commit('司会台変更'); } }));
  }

  function syncUI() {
    if (!$('podiumSelect')) return;
    if (!selected() && window.podiums.length) selectedId = window.podiums[0].id;
    U.fillSelect('podiumSelect', window.podiums.map(p => ({ value: p.id, label: label(p) })), selectedId);

    const p = selected();
    $('podiumControls').classList.toggle('hidden', !p);
    if (!p) return;
    $('podiumName').value = p.name || '';
    $('podiumEnabled').checked = !!p.enabled;
    $('podiumW').value = p.w; $('podiumD').value = p.d; $('podiumH').value = p.h;
    $('podiumAngle').value = p.angle;
    $('podiumX').value = Math.round(p.x); $('podiumY').value = Math.round(p.y);
    $('podiumHost').checked = !!p.hasHost;
    $('podiumHostLabel').innerText = p.type === 'lecture' ? '登壇者 (パーソン) を配置する' : '司会者 (パーソン) を配置する';
  }

  function addPodium(type) {
    const lec = type === 'lecture', st = window.stage;
    const prefix = lec ? 'POD_LEC_' : 'POD_MC_';
    const count = window.podiums.filter(p => p.type === type).length + 1;
    const id = U.nextId(prefix, window.podiums);
    window.podiums.push({
      id, type, name: (lec ? '演台 ' : '司会台 ') + count, enabled: true,
      w: lec ? 1000 : 900, d: lec ? 650 : 600, h: 1100, angle: lec ? -10 : 15,
      x: lec ? st.x + st.w - 1500 : st.x + 1000, y: st.y + st.d - 600, hasHost: true
    });
    selectedId = id;
    syncUI(); redraw(); commit('司会台追加');
  }

  function deletePodium() {
    if (window.podiums.length <= 1) {
      window.debugBox && window.debugBox.warn('最低1台必要です。非表示にするには「有効」を外してください');
      return;
    }
    window.podiums = window.podiums.filter(p => p.id !== selectedId);
    selectedId = window.podiums[0].id;
    syncUI(); redraw(); commit('司会台削除');
  }

  // ---------------------------------------------------------------- 描画
  function drawTop(ctx) {
    const T = window.Core.drawText;
    window.podiums.forEach(p => {
      if (!p.enabled) return;
      const col = colorOf(p), sel = p.id === selectedId;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate((p.angle || 0) * Math.PI / 180);
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.fillRect(-p.w / 2, -p.d / 2, p.w, p.d);
      ctx.strokeStyle = col;
      ctx.lineWidth = sel ? 55 : 35;
      ctx.strokeRect(-p.w / 2, -p.d / 2, p.w, p.d);
      if (p.hasHost) {                       // 人物 (頭の円)
        ctx.beginPath();
        ctx.arc(0, -p.d / 2 - 200, 180, 0, Math.PI * 2);
        ctx.lineWidth = 30;
        ctx.stroke();
      }
      ctx.restore();
      T(ctx, p.name, p.x, p.y, { px: 10, bold: true, color: col });
      if (p.hasHost) {
        const a = (p.angle || 0) * Math.PI / 180;
        const hx = p.x + Math.sin(-a) * (p.d / 2 + 200) * -1, hy = p.y - Math.cos(a) * (p.d / 2 + 200);
        T(ctx, p.type === 'lecture' ? '登壇' : '司会', hx, hy - 330, { px: 9, bold: true, color: col });
      }
    });
  }

  function drawSide(ctx) {
    const T = window.Core.drawText;
    // 「画角内だけ立面図に表示」がONのときは、カメラの画角外の司会台・演台を描かない
    const cm = window.tabCameraModule;
    const fov = (cm && cm.getFovSelection) ? cm.getFovSelection() : null;
    window.podiums.forEach(p => {
      if (!p.enabled) return;
      if (fov && fov.podiumIds && !fov.podiumIds.has(p.id)) return;
      const col = colorOf(p), bz = baseZOf(p);
      if (p.hasHost) {                       // 司会者は演台の後ろ (ステージ奥側) に立つ。先に描いて演台を手前に重ねる
        window.Core.drawPersonSide(ctx, p.y - p.d / 2 - 100, bz, 1600, { color: col, alpha: 0.85 });
      }
      ctx.save();
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.fillRect(p.y - p.d / 2, -bz - p.h, p.d, p.h);
      ctx.strokeStyle = col;
      ctx.lineWidth = 30;
      ctx.strokeRect(p.y - p.d / 2, -bz - p.h, p.d, p.h);
      ctx.restore();
      T(ctx, p.name, p.y, -bz - p.h - 150, { px: 10, bold: true, color: col });
    });
  }

  // ---------------------------------------------------------------- 当たり判定 / ドラッグ
  function hitTest(wx, wy, view) {
    for (const p of window.podiums) {
      if (!p.enabled) continue;
      if (view === 'top') {
        if (Math.hypot(p.x - wx, p.y - wy) < Math.max(p.w, p.d) / 2 + 150) return { id: p.id };
      } else {                                // 立面: wx=Y(奥行き), wy=Z
        const bz = baseZOf(p);
        if (Math.abs(wx - p.y) <= p.d / 2 + 100 && wy >= bz - 100 && wy <= bz + p.h + 100) return { id: p.id };
      }
    }
    return null;
  }

  function onGrab(item) { selectedId = item.id; syncUI(); redraw(); }

  function handleDrag(item, wx, wy, view) {
    const p = window.podiums.find(v => v.id === item.id);
    if (!p) return;
    if (view === 'top') { p.x = Math.round(wx); p.y = Math.round(wy); }
    else p.y = Math.round(wx);                // 立面では奥行き(Y)方向のみ動かす
    $('podiumX').value = p.x; $('podiumY').value = p.y;
  }

  // ---------------------------------------------------------------- 保存 / 復元
  function exportData() { return { podiums: clone(window.podiums), selectedPodiumId: selectedId }; }

  function importData(d) {
    if (!d) return;
    const list = Array.isArray(d) ? d : d.podiums;
    if (Array.isArray(list) && list.length) window.podiums = clone(list);
    selectedId = window.podiums.some(p => p.id === d.selectedPodiumId) ? d.selectedPodiumId : window.podiums[0].id;
    syncUI();
  }

  window.tabPodiumModule = { init: buildUI, drawTop, drawSide, hitTest, onGrab, handleDrag, exportData, importData, syncUI,
    /** 立面の高さ範囲 [下, 上] mm (司会者の立ち姿を含む) */
    getZRange: (p) => { const bz = baseZOf(p); return [bz, bz + Math.max(p.h || 0, p.hasHost ? 1600 : 0)]; } };
  window.Core.register('podium', window.tabPodiumModule, { order: 50 });
})();
