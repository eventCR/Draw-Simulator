/**
 * ==============================================================================
 * ENG Sightline & Stage Simulator Mark2 — コアエンジン (core_engine.js)  [再構築版]
 *
 * ■ 設計方針 (構造の整理)
 *   1. すべての機能モジュールは Core.register() で登録する (読み込み順に依存しない)。
 *   2. 保存 / Undo / Redo / 読み込みは「各モジュールの exportData / importData」を
 *      唯一の窓口にした単一のスナップショット機構で処理する。
 *   3. 状態を変更したら必ず Core.commit(ラベル) を呼ぶ (window.saveHistory は別名)。
 *   4. モジュール間のデータ受け渡しは、共有グローバル (window.room / stage / seats …) と
 *      イベント (Core.on / Core.emit) の 2 経路に限定する。
 *
 * ■ モジュール規約  Core.register(key, mod, { order })
 *   mod.init(panelEl)                    … 起動時 1 回。#panel-<key> に UI を注入
 *   mod.drawBackground(ctx, view)        … (任意) グリッド直後・全モジュールより下
 *   mod.drawTop(ctx)                     … 平面図 (座標: x=X, y=Y [mm])
 *   mod.drawSide(ctx)                    … 立面図 (横軸=部屋のY[奥行き], 縦=−Z。床が y=0)
 *   mod.drawOverlay(ctx, view, scale)    … (任意) 最前面 (計測ツール)
 *   mod.hitTest(wx, wy, view) → item|null
 *        平面図: wx=X, wy=Y   /   立面図: wx=部屋のY(奥行き), wy=Z (上が正)
 *   mod.onGrab(item, view)               … (任意) 掴んだ瞬間 (選択切替など。hitTest は副作用なし)
 *   mod.handleDrag(item, wx, wy, view)   … 同じ座標系
 *   mod.exportData(opts) → JSON 安全な値   (opts.forHistory=true は Undo 用の軽量版。巨大データは省く)
 *   mod.importData(data)
 *   mod.hitFirst = true                  … (任意) 当たり判定を最優先にする
 *
 * ■ 描画順 (order 昇順 / 当たり判定は逆順 = 手前から)
 *   bgimage 5 → room 10 → facility 20 → stage_items 30 → seats 40 → podium 50
 *   → equipment 55 → guests 60 → monitor 70 → camera 80 → measure 1000
 * ==============================================================================
 */
(function () {
  'use strict';

  // ============================================================================
  // 1. 定数・共有状態
  // ============================================================================
  const BASE_SCALE_TOP = 0.035;
  const BASE_SCALE_SIDE = 0.08;
  const SIDE_FLOOR_OFFSET_Y = 8000;   // 立面図: 床の基準位置 (mm)
  const MARGIN = 200;                 // キャンバス余白 (px)
  const APP_ID = 'ENG-Sightline-Stage-Simulator-Mark2';
  const FORMAT_VERSION = 2;
  const HISTORY_MAX = 100;

  window.viewMode = 'top';            // 'top' | 'side'
  window.sideScrollY = 0;             // 立面スクロール量 (mm, 奥行き方向)
  window.panX = MARGIN;
  window.panY = MARGIN;
  window.sideFloorOffsetY = SIDE_FLOOR_OFFSET_Y;   // 計測ツールが参照
  window.viewScale = BASE_SCALE_TOP;               // 計測ツールが参照

  // 各タブが上書きする所有データの初期値 (オーナー: room=tab1 / stage=tab2)
  window.room = window.room || { w: 14000, d: 26000 };
  window.stage = window.stage || { x: 2000, y: 1200, w: 10000, d: 3000, h: 800 };

  // 表示設定 (オーナー: tab8_display.js)。全モジュールがここを参照する
  window.displaySettings = Object.assign({
    showGrid: true,
    showSeatStatus: true,    // 客席の視界判定色
    showCamFov: true,        // カメラ視野角 (旧 showFov と統一)
    showMonitorFov: false,
    showMonitorAngles: true,
    showMonitorDims: false,
    // 立面図に表示するか (バックパネル・スクリーン・ステージ・舞台什器・登壇者・客席は常に表示)
    sidePodium: true,        // 司会台・演台
    sideLight: true,         // 照明
    sideSpeaker: true,       // スピーカー
    sideOpe: true,           // オペ卓・制作物
    sideMonitor: true        // 返しモニター
  }, window.displaySettings || {});

  let canvas = null, ctx = null;
  let zoomLevel = 1.0;
  let scale = BASE_SCALE_TOP;
  let renderPending = false;
  let frame = 0;                      // 描画ごとに +1 (モジュールのキャッシュ無効化用)
  const modifiers = { shift: false, ctrl: false };   // 直近の mousedown 時の修飾キー
  let booted = false;

  // ============================================================================
  // 2. イベントバス / モジュールレジストリ
  // ============================================================================
  const listeners = {};
  function on(evt, fn) { (listeners[evt] = listeners[evt] || []).push(fn); }
  function emit(evt, payload) {
    (listeners[evt] || []).slice().forEach(fn => {
      try { fn(payload); } catch (e) { logError('event:' + evt, e); }
    });
  }

  const registry = [];   // { key, mod, order }

  function register(key, mod, opts) {
    if (!key || !mod) return;
    const order = (opts && typeof opts.order === 'number') ? opts.order : 100;
    const existing = registry.find(r => r.key === key);
    if (existing) { existing.mod = mod; existing.order = order; }
    else registry.push({ key, mod, order });
    registry.sort((a, b) => a.order - b.order);
    // 起動後に登録された場合は即初期化
    if (booted) initModule({ key, mod });
  }

  function getModule(key) {
    const r = registry.find(x => x.key === key);
    return r ? r.mod : null;
  }

  function initModule(r) {
    if (typeof r.mod.init !== 'function' || r.initialized) return;
    r.initialized = true;
    try { r.mod.init(document.getElementById('panel-' + r.key)); }
    catch (e) { logError('init:' + r.key, e); }
  }

  // ---- ログ (debug_box が無くても落ちない) ----
  function log(msg, level) {
    const d = window.debugBox;
    if (!d) return;
    const fn = d[level] || d.log;
    try { fn.call(d, msg); } catch (_) { /* noop */ }
  }
  const reportedErrors = new Set();
  function logError(where, err) {
    console.error('[' + where + ']', err);
    const key = where + ':' + (err && err.message);
    if (reportedErrors.has(key)) return;     // 毎フレームの連投を防ぐ
    reportedErrors.add(key);
    log('エラー (' + where + '): ' + (err && err.message ? err.message : err), 'error');
  }

  // ============================================================================
  // 3. 描画要求・共通判定
  // ============================================================================
  function requestRender() {
    if (renderPending) return;
    renderPending = true;
    requestAnimationFrame(() => {
      try { render(); }
      catch (e) { logError('render', e); }
      finally { renderPending = false; }
    });
  }

  function isInsideStage(x, y) {
    const s = window.stage;
    if (!s) return false;
    return x >= s.x && x <= s.x + s.w && y >= s.y && y <= s.y + s.d;
  }

  // ============================================================================
  // 4. プロジェクト入出力 (保存 / 読み込み / Undo の共通土台)
  // ============================================================================
  function exportProject(opts) {
    const modules = {};
    registry.forEach(r => {
      if (typeof r.mod.exportData !== 'function') return;
      try { modules[r.key] = r.mod.exportData(opts || {}); }
      catch (e) { logError('export:' + r.key, e); }
    });
    const out = {
      app: APP_ID,
      version: FORMAT_VERSION,
      displaySettings: Object.assign({}, window.displaySettings),
      modules
    };
    if (!(opts && opts.forHistory)) out.savedAt = new Date().toISOString();
    return out;
  }

  function importProject(obj) {
    if (!obj || typeof obj !== 'object' || !obj.modules) {
      throw new Error('このアプリの保存ファイルではありません (modules がありません)');
    }
    const wasRestoring = history.restoring;
    history.restoring = true;
    try {
      if (obj.displaySettings && typeof obj.displaySettings === 'object') {
        Object.assign(window.displaySettings, obj.displaySettings);
      }
      registry.forEach(r => {
        if (typeof r.mod.importData !== 'function') return;
        if (obj.modules[r.key] === undefined) return;
        try { r.mod.importData(obj.modules[r.key]); }
        catch (e) { logError('import:' + r.key, e); }
      });
    } finally {
      history.restoring = wasRestoring;
    }
    syncViewChrome();
    updateCanvasSize();
    updateSideScrollRange();
    applySideScroll();
    emit('restore', obj);
    requestRender();
  }

  // ============================================================================
  // 5. 履歴 (Undo / Redo)
  // ============================================================================
  const history = { stack: [], index: -1, restoring: false, suspend: 0 };

  function snapshot() { return JSON.stringify(exportProject({ forHistory: true })); }

  function updateHistoryButtons() {
    const u = document.getElementById('btnUndo');
    const r = document.getElementById('btnRedo');
    if (u) u.disabled = history.index <= 0;
    if (r) r.disabled = history.index >= history.stack.length - 1;
  }

  /** 状態変更を確定して履歴に積む。変化が無ければ何もしない */
  function commit(label) {
    if (history.restoring || history.suspend > 0 || !booted) return;
    const s = snapshot();
    if (history.index >= 0 && history.stack[history.index].s === s) { requestRender(); return; }
    history.stack.length = history.index + 1;            // Redo 枝を捨てる
    history.stack.push({ s, label: label || '' });
    if (history.stack.length > HISTORY_MAX) history.stack.shift();
    history.index = history.stack.length - 1;
    updateHistoryButtons();
    emit('commit', label);
    requestRender();
  }

  /** 複数モジュールにまたがる操作 (AI生成など) を、履歴1件にまとめて確定する */
  function batch(label, fn) {
    history.suspend++;
    try { fn(); }
    finally { history.suspend--; }
    commit(label);
  }

  function restoreAt(i) {
    const entry = history.stack[i];
    if (!entry) return;
    history.index = i;
    try { importProject(JSON.parse(entry.s)); }
    catch (e) { logError('history', e); }
    updateHistoryButtons();
  }

  function undo() {
    if (history.index <= 0) return;
    restoreAt(history.index - 1);
    log('元に戻しました', 'info');
  }
  function redo() {
    if (history.index >= history.stack.length - 1) return;
    restoreAt(history.index + 1);
    log('やり直しました', 'info');
  }

  // ============================================================================
  // 6. ファイル保存 / 読み込み / 画像出力
  // ============================================================================
  function download(blob, filename) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  function sanitizeFileName(name, ext) {
    let n = String(name || '').trim().replace(/[\\/:*?"<>|]/g, '_') || 'Venue_Layout_Mark2';
    if (!n.toLowerCase().endsWith(ext)) n += ext;
    return n;
  }

  function openSaveModal() {
    const m = document.getElementById('saveModal');
    if (!m) return;
    m.classList.add('open');
    const inp = document.getElementById('modalFileName');
    if (inp) { inp.focus(); inp.select(); }
  }
  function closeSaveModal() {
    const m = document.getElementById('saveModal');
    if (m) m.classList.remove('open');
  }
  function confirmSave() {
    const inp = document.getElementById('modalFileName');
    const name = sanitizeFileName(inp ? inp.value : '', '.json');
    const json = JSON.stringify(exportProject(), null, 2);
    download(new Blob([json], { type: 'application/json' }), name);
    closeSaveModal();
    log('保存しました: ' + name, 'info');
  }

  function openFilePicker() {
    const f = document.getElementById('importFile');
    if (f) f.click();
  }
  function handleImportFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        importProject(JSON.parse(reader.result));
        commit('ファイルを開く');
        log('読み込みました: ' + file.name, 'info');
      } catch (e) {
        log('読み込み失敗: ' + e.message, 'error');
        alert('ファイルを読み込めませんでした。\n' + e.message);
      }
    };
    reader.onerror = () => log('ファイルを読めませんでした', 'error');
    reader.readAsText(file);
  }

  /**
   * 書き出し用: 表示倍率を一時的に上げ (立面は奥行き全体を表示) て同期描画し、fn(canvas, info) の結果を返す。
   * 終わったら元の表示に戻す。
   */
  function withExportView(minWidthPx, fn) {
    const oz = zoomLevel, os = window.sideScrollY, opx = window.panX, opy = window.panY;
    try {
      window.exporting = true;
      zoomLevel = 1; window.sideScrollY = 0; window.panY = MARGIN;
      updateCanvasSize();
      const k = Math.max(1, Math.min(3, (minWidthPx || 0) / canvas.width));
      zoomLevel = k;
      updateCanvasSize();
      window.panX = MARGIN; window.panY = MARGIN;
      render();
      return fn(canvas, { scale, panX: window.panX, panY: window.panY, view: window.viewMode, floorY: SIDE_FLOOR_OFFSET_Y });
    } finally {
      window.exporting = false;
      zoomLevel = oz; window.sideScrollY = os; window.panX = opx; window.panY = opy;
      updateCanvasSize(); updateSideScrollRange(); applySideScroll();
    }
  }

  function exportPng() {
    if (window.ExportSheet) { window.ExportSheet.exportPng(); return; }
    if (!canvas) return;
    canvas.toBlob(blob => {
      if (!blob) { log('画像出力に失敗しました', 'error'); return; }
      const mode = window.viewMode === 'top' ? 'plan' : 'elevation';
      download(blob, 'Venue_' + mode + '.png');
      log('画像を出力しました', 'info');
    }, 'image/png');
  }

  // ============================================================================
  // 7. ビュー (ズーム / 表示切替 / 立面スクロール)
  // ============================================================================
  function updateCanvasSize() {
    if (!canvas) return;
    scale = (window.viewMode === 'top' ? BASE_SCALE_TOP : BASE_SCALE_SIDE) * zoomLevel;
    window.viewScale = scale;
    const r = window.room;
    if (window.viewMode === 'top') {
      canvas.width = Math.round(r.w * scale + MARGIN * 2);
      canvas.height = Math.round(r.d * scale + MARGIN * 2);
    } else {
      // 立面図は表示領域の幅に収め、横の移動はスライダー (立面スクロール) で行う。
      // 長い会場でも最初からステージ側が見え、中央の空白に飛ばされない
      const full = Math.round(r.d * scale + MARGIN * 2);
      const cont = document.getElementById('main-container');
      canvas.width = (window.exporting || !cont) ? full : Math.max(600, Math.min(full, cont.clientWidth));
      canvas.height = Math.max(900, Math.round((SIDE_FLOOR_OFFSET_Y + 4000) * scale + MARGIN * 2));
    }
    const badge = document.getElementById('zoomBadge');
    if (badge) badge.innerText = Math.round(zoomLevel * 100) + '%';
    updateTopScrollBar();
  }

  /** 平面図: 会場が表示領域より横に広いときだけ、横スクロールのバーを出す */
  function updateTopScrollBar() {
    const box = document.getElementById('top-scrollbar-container'), range = document.getElementById('top-scroll-range');
    const cont = document.getElementById('main-container');
    if (!box || !range || !cont || !canvas) return;
    const max = Math.max(0, canvas.width - cont.clientWidth);
    range.max = max;
    range.value = cont.scrollLeft;
    box.style.display = (window.viewMode === 'top' && max > 0) ? 'flex' : 'none';
  }

  function applySideScroll() {
    window.panX = (window.viewMode === 'side') ? MARGIN - window.sideScrollY * scale : MARGIN;
    const range = document.getElementById('side-scroll-range');
    if (range) range.value = window.sideScrollY;
    const disp = document.getElementById('sideScrollValDisplay');
    if (disp) disp.innerText = (window.sideScrollY / 1000).toFixed(1) + 'm';
    requestRender();
  }

  function updateSideScrollRange() {
    const range = document.getElementById('side-scroll-range');
    if (!range) return;
    const container = document.getElementById('main-container');
    const viewW = container ? container.clientWidth : 1200;
    const visibleMm = Math.max(0, (viewW - MARGIN * 2) / scale);
    const max = Math.max(0, Math.ceil((window.room.d - visibleMm) / 100) * 100);
    range.max = max;
    window.sideScrollY = Math.max(0, Math.min(window.sideScrollY, max));
  }

  function setSideScroll(v) {
    const range = document.getElementById('side-scroll-range');
    const max = range ? (parseFloat(range.max) || 0) : 0;
    window.sideScrollY = Math.max(0, Math.min(parseFloat(v) || 0, max));
    applySideScroll();
  }

  function adjustZoom(factor) {
    zoomLevel = Math.max(0.2, Math.min(3.0, zoomLevel * factor));
    updateCanvasSize();
    updateSideScrollRange();
    applySideScroll();
  }

  function resetView() {
    zoomLevel = 1.0;
    window.panY = MARGIN;
    window.sideScrollY = 0;
    updateCanvasSize();
    updateSideScrollRange();
    applySideScroll();
    centerCanvas();
  }

  function centerCanvas() {
    const c = document.getElementById('main-container');
    if (c && canvas) {
      c.scrollLeft = Math.max(0, (canvas.width - c.clientWidth) / 2);
      c.scrollTop = 0;
    }
  }

  function syncViewChrome() {
    const mode = window.viewMode;
    const bt = document.getElementById('btn-top');
    const bs = document.getElementById('btn-side');
    if (bt) bt.classList.toggle('active', mode === 'top');
    if (bs) bs.classList.toggle('active', mode === 'side');
    const sb = document.getElementById('side-scrollbar-container');
    if (sb) sb.style.display = (mode === 'side') ? 'flex' : 'none';
    updateTopScrollBar();
    const badge = document.getElementById('viewModeBadge');
    if (badge) badge.innerText = (mode === 'top') ? '🗺️ 平面図' : '📐 立面図';
    const fov = document.getElementById('btn-fov');
    if (fov) fov.classList.toggle('active', !!window.displaySettings.showCamFov);
  }

  function setViewMode(mode) {
    window.viewMode = (mode === 'side') ? 'side' : 'top';
    syncViewChrome();
    resetView();
    emit('view', window.viewMode);
  }

  function toggleFov() {
    window.displaySettings.showCamFov = !window.displaySettings.showCamFov;
    syncViewChrome();
    emit('display', window.displaySettings);
    requestRender();
  }

  // ============================================================================
  // 8. パレット (タブ切替 / 開閉 / ドラッグ移動)
  // ============================================================================
  function switchTab(key) {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === key));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('active', p.id === 'panel-' + key));
    emit('tab', key);
  }

  function togglePalette() {
    const p = document.getElementById('floating-ui');
    if (p) p.classList.toggle('hidden');
  }

  function collapsePalette() {
    const p = document.getElementById('floating-ui');
    const b = document.getElementById('palette-collapse');
    if (!p) return;
    p.classList.toggle('collapsed');
    if (b) b.innerText = p.classList.contains('collapsed') ? '▲' : '▼';
  }

  function setupPalette() {
    const palette = document.getElementById('floating-ui');
    const header = document.getElementById('floating-header');
    if (!palette || !header) return;

    let dragging = false, moved = false, sx = 0, sy = 0, px = 0, py = 0;

    header.addEventListener('mousedown', e => {
      if (e.target.closest('button') || ['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName)) return;
      dragging = true; moved = false;
      sx = e.clientX; sy = e.clientY;
      const rect = palette.getBoundingClientRect();
      px = rect.left; py = rect.top;
      palette.style.right = 'auto';
      palette.style.left = px + 'px';
      palette.style.top = py + 'px';
      document.body.style.userSelect = 'none';
    });
    window.addEventListener('mousemove', e => {
      if (!dragging) return;
      const dx = e.clientX - sx, dy = e.clientY - sy;
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) moved = true;
      const maxX = Math.max(0, window.innerWidth - palette.offsetWidth);
      const maxY = Math.max(0, window.innerHeight - 40);
      palette.style.left = Math.max(0, Math.min(px + dx, maxX)) + 'px';
      palette.style.top = Math.max(0, Math.min(py + dy, maxY)) + 'px';
    });
    const stop = () => {
      if (!dragging) return;
      dragging = false;
      document.body.style.userSelect = '';
      moved = false;
    };
    window.addEventListener('mouseup', stop);
    window.addEventListener('blur', stop);
    header.addEventListener('dblclick', e => {
      if (e.target.closest('button')) return;
      collapsePalette();
    });
  }

  // ============================================================================
  // 9. キャンバス操作 (オブジェクトのドラッグ)
  // ============================================================================
  let dragTarget = null;
  let dragMoved = false;

  /** マウス位置 → 各モジュールが受け取るワールド座標 (立面図は wy=Z 上が正) */
  function toWorld(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const mx = clientX - rect.left;
    const my = clientY - rect.top;
    const wx = (mx - window.panX) / scale;
    const wy = (window.viewMode === 'top')
      ? (my - window.panY) / scale
      : -((my - window.panY) / scale - SIDE_FLOOR_OFFSET_Y);
    return { wx, wy, view: window.viewMode };
  }

  function hitTestAll(wx, wy, view) {
    // 手前(描画順の後ろ)から判定。mod.hitFirst が true のモジュール (下絵ドラッグ中など) は最優先
    const order = registry.slice().reverse();
    order.sort((a, b) => (b.mod.hitFirst === true) - (a.mod.hitFirst === true));
    for (const r of order) {
      if (typeof r.mod.hitTest !== 'function') continue;
      let hit = null;
      try { hit = r.mod.hitTest(wx, wy, view); }
      catch (e) { logError('hitTest:' + r.key, e); }
      if (hit) return { module: r.mod, key: r.key, item: hit };
    }
    return null;
  }

  /** どのオブジェクトにも当たらなかった時に、モジュールが空き地のドラッグを引き受けるための口 (mod.hitFallback) */
  function fallbackHit(wx, wy, view) {
    const order = registry.slice().reverse();
    for (const r of order) {
      if (typeof r.mod.hitFallback !== 'function') continue;
      let hit = null;
      try { hit = r.mod.hitFallback(wx, wy, view); }
      catch (e) { logError('hitFallback:' + r.key, e); }
      if (hit) return { module: r.mod, key: r.key, item: hit };
    }
    return null;
  }

  function setupCanvasEvents() {
    if (!canvas) return;

    canvas.addEventListener('mousedown', e => {
      if (e.button !== 0) return;
      if (window.MeasureTool && window.MeasureTool.isActive && window.MeasureTool.isActive()) return;
      modifiers.shift = e.shiftKey; modifiers.ctrl = e.ctrlKey || e.metaKey;
      const w = toWorld(e.clientX, e.clientY);
      let hit = hitTestAll(w.wx, w.wy, w.view);
      if (!hit) hit = fallbackHit(w.wx, w.wy, w.view);      // 何も無い所のドラッグ (範囲選択など)
      if (hit && typeof hit.module.handleDrag === 'function') {
        dragTarget = hit;
        dragMoved = false;
        if (typeof hit.module.onGrab === 'function') {
          try { hit.module.onGrab(hit.item, w.view); } catch (err) { logError('onGrab:' + hit.key, err); }
        }
      }
    });

    window.addEventListener('mousemove', e => {
      if (!canvas) return;
      if (dragTarget) {
        const w = toWorld(e.clientX, e.clientY);
        try { dragTarget.module.handleDrag(dragTarget.item, w.wx, w.wy, w.view); dragMoved = true; }
        catch (err) { logError('handleDrag:' + dragTarget.key, err); }
        requestRender();
        return;
      }
      // ホバー表示 (キャンバス上のみ)
      if (e.target === canvas && !(window.MeasureTool && window.MeasureTool.isActive && window.MeasureTool.isActive())) {
        const w = toWorld(e.clientX, e.clientY);
        canvas.style.cursor = hitTestAll(w.wx, w.wy, w.view) ? 'grab' : 'default';
      }
    });

    window.addEventListener('mouseup', () => {
      if (dragTarget && dragMoved) commit('ドラッグ移動');
      dragTarget = null;
      dragMoved = false;
    });
  }

  // ============================================================================
  // 10. 描画パイプライン
  // ============================================================================
  function safeCall(r, fnName, args) {
    const fn = r.mod[fnName];
    if (typeof fn !== 'function') return;
    try { fn.apply(r.mod, args); }
    catch (e) { logError(fnName + ':' + r.key, e); }
  }

  function render() {
    if (!canvas || !ctx) return;
    frame++;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.translate(window.panX, window.panY);
    ctx.scale(scale, scale);

    if (window.viewMode === 'top') {
      if (window.displaySettings.showGrid) drawGrid(window.room.w, window.room.d);
      registry.forEach(r => safeCall(r, 'drawBackground', [ctx, 'top']));
      registry.forEach(r => safeCall(r, 'drawTop', [ctx]));
    } else {
      ctx.translate(0, SIDE_FLOOR_OFFSET_Y);   // 以降 y=0 が床。高さ Z は −Z で描く
      ctx.strokeStyle = '#94a3b8';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(window.room.d, 0);
      ctx.stroke();
      registry.forEach(r => safeCall(r, 'drawBackground', [ctx, 'side']));
      registry.forEach(r => safeCall(r, 'drawSide', [ctx]));
    }

    registry.forEach(r => safeCall(r, 'drawOverlay', [ctx, window.viewMode, scale]));
    ctx.restore();

    updateStats();
  }

  function drawGrid(w, d) {
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 1 / scale;
    ctx.beginPath();
    for (let x = 0; x <= w; x += 1000) { ctx.moveTo(x, 0); ctx.lineTo(x, d); }
    for (let y = 0; y <= d; y += 1000) { ctx.moveTo(0, y); ctx.lineTo(w, y); }
    ctx.stroke();
    ctx.strokeStyle = '#cbd5e1';
    ctx.lineWidth = 2 / scale;
    ctx.beginPath();
    for (let x = 0; x <= w; x += 5000) { ctx.moveTo(x, 0); ctx.lineTo(x, d); }
    for (let y = 0; y <= d; y += 5000) { ctx.moveTo(0, y); ctx.lineTo(w, y); }
    ctx.stroke();
  }

  // ---- HUD サマリー (客席数・視界判定は tab6 の getStats() を参照) ----
  function updateStats() {
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.innerText = v; };
    set('statRoom', window.room.w + '×' + window.room.d + 'mm');
    set('statStage', 'W:' + window.stage.w + '×D:' + window.stage.d);
    let st = { total: Array.isArray(window.seats) ? window.seats.length : 0, clear: 0, partial: 0 };
    const sm = getModule('seats');
    if (sm && typeof sm.getStats === 'function') {
      try { st = Object.assign(st, sm.getStats()); } catch (e) { logError('getStats', e); }
    }
    set('statSeats', st.total + ' 席');
    set('statClear', st.clear + ' 席');
    set('statPartial', st.partial + ' 席');
  }

  // ============================================================================
  // 11. 共通描画ヘルパー (全モジュール共用。文字・線は画面上のpx基準)
  // ============================================================================
  /** 文字。px は画面上のサイズ (ズームに依存しない) */
  function drawText(c, text, x, y, o) {
    o = o || {};
    const px = o.px || 11;
    c.save();
    c.font = (o.bold ? 'bold ' : '') + (px / scale) + 'px sans-serif';
    c.textAlign = o.align || 'center';
    c.textBaseline = o.baseline || 'middle';
    if (o.stroke !== null) {
      c.lineWidth = 3 / scale;
      c.strokeStyle = o.stroke || '#ffffff';
      c.lineJoin = 'round';
      c.strokeText(text, x, y);
    }
    c.fillStyle = o.color || '#0f172a';
    c.fillText(text, x, y);
    c.restore();
  }

  /** 寸法線。offset は線の法線方向のずらし量 (mm) */
  function drawDimLine(c, x1, y1, x2, y2, label, o) {
    o = o || {};
    const dx = x2 - x1, dy = y2 - y1;
    const len = Math.hypot(dx, dy);
    if (len < 1) return;
    const nx = -dy / len, ny = dx / len;
    const off = o.offset || 0;
    const ax = x1 + nx * off, ay = y1 + ny * off;
    const bx = x2 + nx * off, by = y2 + ny * off;
    const tick = 6 / scale;
    c.save();
    c.strokeStyle = o.color || '#475569';
    c.lineWidth = 1.2 / scale;
    c.beginPath();
    c.moveTo(x1, y1); c.lineTo(ax + nx * Math.sign(off || 1) * tick, ay + ny * Math.sign(off || 1) * tick);
    c.moveTo(x2, y2); c.lineTo(bx + nx * Math.sign(off || 1) * tick, by + ny * Math.sign(off || 1) * tick);
    c.moveTo(ax, ay); c.lineTo(bx, by);
    c.stroke();
    c.restore();
    drawText(c, label != null ? label : Math.round(len) + 'mm', (ax + bx) / 2, (ay + by) / 2, { px: o.px || 10, color: o.color || '#475569' });
  }

  /**
   * 立面図の立ち姿シルエット (横軸=Y, 縦=−Z)。
   * cy: 人物中心のY, baseZ: 足元の高さ, height: 頭頂までの高さ(足元基準)
   * o: { color, alpha }   ※着座の人物は各タブ (tab4 / tab6) が専用の描画を持つ
   */
  function drawPersonSide(c, cy, baseZ, height, o) {
    o = o || {};
    const h = height, headR = h * 0.065, bw = h * 0.17;
    const hipZ = h * 0.52, shZ = h * 0.84;
    c.save();
    c.globalAlpha = o.alpha == null ? 1 : o.alpha;
    c.fillStyle = o.color || '#475569';
    c.beginPath(); c.arc(cy, -(baseZ + h - headR), headR, 0, Math.PI * 2); c.fill();   // 頭
    c.fillRect(cy - bw / 2, -(baseZ + shZ), bw, shZ - hipZ);                           // 胴
    c.fillRect(cy - bw * 0.35, -(baseZ + hipZ), bw * 0.7, hipZ);                       // 脚 (足元 baseZ から腰まで上向き)
    c.restore();
  }

  // ---- 小さな共通ユーティリティ (各タブで重複させない) ----
  const util = {
    $: (id) => document.getElementById(id),
    clone: (v) => JSON.parse(JSON.stringify(v)),
    /** 入力欄の数値。空欄・不正値のときだけ既定値 (0 は有効値として扱う) */
    num(idOrEl, def) {
      const el = typeof idOrEl === 'string' ? document.getElementById(idOrEl) : idOrEl;
      const v = el ? parseFloat(el.value) : NaN;
      return isFinite(v) ? v : def;
    },
    /** 'PREFIX' + (既存の最大番号+1) で重複しない ID を返す */
    nextId(prefix, list) {
      let max = 0;
      (list || []).forEach(o => {
        const m = String(o.id).match(/(\d+)$/);
        if (m && String(o.id).startsWith(prefix)) max = Math.max(max, parseInt(m[1], 10));
      });
      return prefix + (max + 1);
    },
    /** <select> の選択肢を作り直す。items: [{value,label}] */
    fillSelect(sel, items, selected) {
      if (typeof sel === 'string') sel = document.getElementById(sel);
      if (!sel) return;
      sel.innerHTML = '';
      items.forEach(it => {
        const o = document.createElement('option');
        o.value = it.value; o.textContent = it.label;
        sel.appendChild(o);
      });
      if (selected !== undefined && selected !== null) sel.value = selected;
    },
    /** 要素群の変更イベント: 'input' はライブ反映、'change' は確定 (commit) */
    onEdit(ids, live, done) {
      ids.forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        if (live) el.addEventListener('input', live);
        if (done) el.addEventListener('change', done);
      });
    }
  };

  // ============================================================================
  // 12. 診断情報 (意見BOX 添付用)
  // ============================================================================
  function getSystemSummary() {
    const out = { roomInfo: '', stats: '', cameraDetails: '', warnings: [] };
    try {
      out.roomInfo = '会場 ' + window.room.w + '×' + window.room.d + 'mm / ステージ W' + window.stage.w + '×D' + window.stage.d + '×H' + window.stage.h;
      const sm = getModule('seats');
      const st = (sm && typeof sm.getStats === 'function') ? sm.getStats() : { total: (window.seats || []).length, clear: 0, partial: 0 };
      out.stats = '客席 ' + st.total + ' / 良好 ' + st.clear + ' / 干渉 ' + st.partial;
      if (window.CameraBase && typeof window.CameraBase.getAll === 'function') {
        out.cameraDetails = window.CameraBase.getAll().map(c =>
          c.id + '(' + (c.model || '') + ') x' + Math.round(c.x) + ' y' + Math.round(c.y) + ' lens' + Math.round(c.lensH)
        ).join(' | ');
      }
      if (st.partial > 0) out.warnings.push('視野干渉の客席が ' + st.partial + ' 席あります');
    } catch (e) { out.warnings.push('診断取得エラー: ' + e.message); }
    return out;
  }

  // ============================================================================
  // 13. UI アクション (data-action 委譲) とキーボード
  // ============================================================================
  const actions = {
    undo, redo,
    save: openSaveModal,
    closeSave: closeSaveModal,
    confirmSave,
    open: openFilePicker,
    exportPng,
    exportPdf: () => window.ExportSheet ? window.ExportSheet.exportPdf() : log('書き出しモジュールが読み込まれていません', 'warn'),
    measure: () => {
      const mt = window.MeasureTool;
      if (!mt || typeof mt.toggle !== 'function') { log('計測ツールが読み込まれていません', 'warn'); return; }
      mt.toggle();
      const b = document.getElementById('btn-measure');
      if (b && typeof mt.isActive === 'function') b.classList.toggle('active', mt.isActive());
    },
    palette: togglePalette,
    collapsePalette,
    topStep: (arg) => { const c = document.getElementById('main-container'); if (c) c.scrollLeft += (parseFloat(arg) || 0) * scale; },
    sideStep: (arg) => setSideScroll((window.sideScrollY || 0) + (parseFloat(arg) || 0)),
    viewTop: () => setViewMode('top'),
    viewSide: () => setViewMode('side'),
    zoomIn: () => adjustZoom(1.2),
    zoomOut: () => adjustZoom(1 / 1.2),
    zoom100: resetView,
    center: centerCanvas,
    toggleFov
  };

  function setupUi() {
    document.addEventListener('click', e => {
      const tab = e.target.closest('.tab-btn[data-tab]');
      if (tab) { switchTab(tab.dataset.tab); return; }
      const el = e.target.closest('[data-action]');
      if (!el || el.disabled) return;
      const fn = actions[el.dataset.action];
      if (fn) fn(el.dataset.arg);
    });

    const range = document.getElementById('side-scroll-range');
    if (range) range.addEventListener('input', () => setSideScroll(range.value));
    const trange = document.getElementById('top-scroll-range'), cont = document.getElementById('main-container');
    if (trange && cont) {
      trange.addEventListener('input', () => { cont.scrollLeft = parseFloat(trange.value) || 0; });
      cont.addEventListener('scroll', () => { trange.value = cont.scrollLeft; });
      // 立面図: 横スクロール (Shift+ホイール / トラックパッドの横スワイプ) でスライダーと同じ移動
      cont.addEventListener('wheel', e => {
        if (window.viewMode !== 'side') return;
        const dx = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : (e.shiftKey ? e.deltaY : 0);
        if (!dx) return;
        e.preventDefault();
        setSideScroll((window.sideScrollY || 0) + dx / scale);
      }, { passive: false });
    }

    const file = document.getElementById('importFile');
    if (file) file.addEventListener('change', () => {
      handleImportFile(file.files && file.files[0]);
      file.value = '';
    });

    const modal = document.getElementById('saveModal');
    if (modal) modal.addEventListener('mousedown', e => { if (e.target === modal) closeSaveModal(); });
    const nameInp = document.getElementById('modalFileName');
    if (nameInp) nameInp.addEventListener('keydown', e => { if (e.key === 'Enter') confirmSave(); });

    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        closeSaveModal();
        return;
      }
      const t = e.target;
      const typing = t && (t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' ||
        (t.tagName === 'INPUT' && !['checkbox', 'radio', 'range', 'button'].includes(t.type)));
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      const k = e.key.toLowerCase();
      if (k === 's') { e.preventDefault(); openSaveModal(); return; }
      if (typing) return;                       // 入力欄は標準の取り消しに任せる
      if (k === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
      else if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); redo(); }
    });

    window.addEventListener('resize', () => { updateCanvasSize(); updateSideScrollRange(); applySideScroll(); });
  }

  // ============================================================================
  // 14. 公開 API
  // ============================================================================
  window.Core = {
    APP_ID, FORMAT_VERSION,
    BASE_SCALE_TOP, BASE_SCALE_SIDE, SIDE_FLOOR_OFFSET_Y,
    register, getModule, on, emit,
    commit, batch, undo, redo,
    exportProject, importProject, withExportView, download,
    requestRender, isInsideStage,
    toWorld, switchTab, setViewMode,
    drawText, drawDimLine, drawPersonSide, util,
    getSystemSummary, updateStats, log,
    modifiers,
    get frame() { return frame; },
    get scale() { return scale; },
    get isRestoring() { return history.restoring; }
  };

  // 旧名称の互換エイリアス (外部から呼ばれても落ちないように)
  window.requestRender = requestRender;
  window.saveHistory = commit;
  window.isInsideStage = isInsideStage;
  window.core = window.Core;
  window.getSystemSummary = getSystemSummary;

  // ============================================================================
  // 15. 起動
  // ============================================================================
  window.addEventListener('DOMContentLoaded', () => {
    canvas = document.getElementById('simCanvas');
    if (canvas) ctx = canvas.getContext('2d');

    setupPalette();
    setupCanvasEvents();
    setupUi();

    // 全モジュールの UI 初期化 (登録順ではなく order 順)
    registry.slice().forEach(initModule);
    booted = true;

    syncViewChrome();
    resetView();
    history.stack = [{ s: snapshot(), label: '初期状態' }];
    history.index = 0;
    updateHistoryButtons();
    emit('boot');
    requestRender();
    log('システム起動: ' + registry.length + ' モジュールを登録', 'info');
  });
})();
