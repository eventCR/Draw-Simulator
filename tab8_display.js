/**
 * ==============================================================================
 * tab8_display.js — 【表示設定】 図面の表示/非表示スイッチ
 *
 * 設定の実体は Core が持つ window.displaySettings。このタブはその編集画面。
 * 保存ファイルには Core が displaySettings を直接含めるため、exportData は持たない。
 * ==============================================================================
 */
(function () {
  'use strict';

  const U = window.Core.util;
  const { $ } = U;

  const ITEMS = [
    ['showGrid', 'グリッド (1m)', '平面図の方眼を表示'],
    ['showSeatStatus', '客席の視界判定色', 'カメラから見えない席を色分け'],
    ['showCamFov', 'カメラ視野角', 'ツールバーの「視野角」ボタンと連動'],
    ['showMonitorFov', 'モニターの視野 (可視範囲)', '返しモニターの見える範囲を扇形で表示'],
    ['showMonitorAngles', 'モニターの角度表示', 'パン角・チルト角の数値'],
    ['showMonitorDims', 'モニターの寸法表示', '幅・高さの寸法線']
  ];

  // 書き出し (PNG/PDF) の見出しに入れる案件情報。社内共有などで不要なときは enabled をオフにする
  const META_FIELDS = [['project', '案件'], ['client', 'クライアント名'], ['venue', '会場'], ['date', '日付 (空欄=書き出し日)'], ['author', '作成者'], ['version', 'バージョン']];
  window.exportMeta = { enabled: true, project: '', client: '', venue: '', date: '', author: '', version: '' };

  function buildUI(panel) {
    if (!panel) return;
    panel.innerHTML = `
      <div class="ui-group">
        <div class="ui-group-title">👁️ 表示する項目</div>
        ${ITEMS.map(([k, label, hint]) => `
          <label class="chk" style="display:flex; gap:6px; align-items:flex-start; padding:3px 0;">
            <input type="checkbox" data-ds="${k}">
            <span>${label}<span class="hint" style="display:block;">${hint}</span></span>
          </label>`).join('')}
      </div>
      <div class="ui-group">
        <div class="ui-group-title">📄 書き出しの案件情報</div>
        <label class="chk" style="display:flex; gap:6px; align-items:flex-start; padding:3px 0;">
          <input type="checkbox" id="metaEnabled">
          <span>書き出しに記載する<span class="hint" style="display:block;">オフにすると見出しは題名のみ (社内共有用)</span></span>
        </label>
        ${META_FIELDS.map(([k, label]) => `
          <div class="input-box"><label>${label}</label><input type="text" data-meta="${k}"></div>`).join('')}
      </div>`;
    panel.querySelector('#metaEnabled').addEventListener('change', e => {
      window.exportMeta.enabled = e.target.checked; sync(); window.Core.commit('書き出し情報');
    });
    panel.querySelectorAll('[data-meta]').forEach(inp => {
      inp.addEventListener('change', () => { window.exportMeta[inp.dataset.meta] = inp.value.trim(); window.Core.commit('書き出し情報'); });
    });
    panel.querySelectorAll('[data-ds]').forEach(cb => {
      cb.addEventListener('change', () => {
        window.displaySettings[cb.dataset.ds] = cb.checked;
        window.Core.emit('display', window.displaySettings);
        syncFovButton();
        window.Core.requestRender();
        window.Core.commit('表示設定');
      });
    });
    sync();
  }

  function sync() {
    document.querySelectorAll('#panel-display [data-ds]').forEach(cb => {
      cb.checked = !!window.displaySettings[cb.dataset.ds];
    });
    const m = window.exportMeta, en = document.getElementById('metaEnabled');
    if (en) en.checked = !!m.enabled;
    document.querySelectorAll('#panel-display [data-meta]').forEach(inp => {
      inp.value = m[inp.dataset.meta] || '';
      inp.disabled = !m.enabled;
    });
    syncFovButton();
  }

  function exportData() { return JSON.parse(JSON.stringify(window.exportMeta)); }
  function importData(d) {
    window.exportMeta = Object.assign({ enabled: true, project: '', client: '', venue: '', date: '', author: '', version: '' }, d || {});
    sync();
  }

  function syncFovButton() {
    const b = $('btn-fov');
    if (b) b.classList.toggle('active', !!window.displaySettings.showCamFov);
  }

  // Undo/Redo・ファイル読込後、およびツールバーからの切替後に画面を合わせる
  window.Core.on('commit', sync);
  window.Core.on('display', sync);
  window.Core.on('restore', sync);

  window.tabDisplayModule = { init: buildUI, sync, exportData, importData };
  window.Core.register('display', window.tabDisplayModule, { order: 8 });
})();
