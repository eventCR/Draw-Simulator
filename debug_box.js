/**
 * ==============================================================================
 * ENG Sightline & Stage Simulator Mark2 — 意見・デバッグBOX (debug_box.js)
 *  - ログ表示 (window.debugBox.log/info/warn/error/clear/diagnose)
 *  - ご意見送信 (GAS 連携 or メーラー起動)
 *  - ヘッダーのドラッグ移動
 *  イベントは index.html の data-dbg / data-dbg-tab 属性で接続する (inline onclick なし)
 * ==============================================================================
 */
(function () {
  'use strict';

  const CONFIG = {
    gasWebAppUrl: '',                                  // 設定すると GAS へ POST 送信
    maxLogCount: 80,
    adminEmail: 'noguchi.kairu@aur.co.jp'              // GAS 未設定時の宛先 (旧 index.html の data-mailto)
  };

  let collapsed = false;

  // ---------------------------------------------------------------- ログ
  function appendLog(message, level) {
    const box = document.getElementById('debug-box-content');
    if (!box) return;
    const d = new Date();
    const t = [d.getHours(), d.getMinutes(), d.getSeconds()].map(n => String(n).padStart(2, '0')).join(':');
    const item = document.createElement('div');
    item.className = 'debug-item ' + (level || 'info');
    item.textContent = '[' + t + '] ' + message;
    box.appendChild(item);
    while (box.children.length > CONFIG.maxLogCount) box.removeChild(box.firstChild);
    box.scrollTop = box.scrollHeight;
  }

  // ---------------------------------------------------------------- UI
  function toggleBox() {
    const body = document.getElementById('debug-box-body');
    const btn = document.getElementById('btn-debug-toggle');
    if (!body) return;
    collapsed = !collapsed;
    body.style.display = collapsed ? 'none' : 'flex';
    if (btn) btn.textContent = collapsed ? '＋' : '－';
  }

  function switchTab(key) {
    document.querySelectorAll('.debug-tab-btn').forEach(b => b.classList.toggle('active', b.dataset.dbgTab === key));
    const log = document.getElementById('panel-dbg-log');
    const mail = document.getElementById('panel-dbg-mail');
    if (log) log.classList.toggle('active', key === 'log');
    if (mail) mail.classList.toggle('active', key === 'mail');
    if (collapsed) toggleBox();
  }

  function setupDragging() {
    const box = document.getElementById('debug-box');
    const header = box && box.querySelector('.debug-box-header');
    if (!box || !header) return;
    let dragging = false, ox = 0, oy = 0;

    header.addEventListener('mousedown', e => {
      if (e.target.closest('.debug-box-actions')) return;
      const rect = box.getBoundingClientRect();
      // 初回ドラッグ時に body 直下の fixed へ移し、以降は left/top で制御
      if (box.parentElement !== document.body) document.body.appendChild(box);
      box.style.position = 'fixed';
      box.style.margin = '0';
      box.style.right = 'auto';
      box.style.bottom = 'auto';
      box.style.left = rect.left + 'px';
      box.style.top = rect.top + 'px';
      ox = e.clientX - rect.left;
      oy = e.clientY - rect.top;
      dragging = true;
      document.body.style.userSelect = 'none';
    });
    document.addEventListener('mousemove', e => {
      if (!dragging) return;
      const pad = 8;
      const maxL = window.innerWidth - box.offsetWidth - pad;
      const maxT = window.innerHeight - 40;
      box.style.left = Math.max(pad, Math.min(e.clientX - ox, maxL)) + 'px';
      box.style.top = Math.max(pad, Math.min(e.clientY - oy, maxT)) + 'px';
    });
    document.addEventListener('mouseup', () => {
      if (!dragging) return;
      dragging = false;
      document.body.style.userSelect = '';
    });
  }

  // ---------------------------------------------------------------- 意見送信
  async function sendFeedback() {
    const sender = (document.getElementById('feedback-sender') || {}).value || '';
    const contentEl = document.getElementById('feedback-content');
    const content = contentEl ? contentEl.value.trim() : '';
    const attach = document.getElementById('feedback-attach-state');
    const status = document.getElementById('feedback-status');
    const btn = document.getElementById('btn-dbg-send');

    const say = (msg, color) => { if (status) { status.style.color = color; status.textContent = msg; } };

    if (!content) { say('※ご意見・不具合内容を入力してください。', '#dc2626'); return; }

    const snapshot = (attach && attach.checked && window.Core) ? window.Core.getSystemSummary() : null;
    const payload = {
      sender: sender.trim() || '匿名担当者',
      content,
      timestamp: new Date().toLocaleString('ja-JP'),
      userAgent: navigator.userAgent,
      snapshot
    };

    if (btn) btn.disabled = true;

    if (CONFIG.gasWebAppUrl) {
      say('送信中...', '#0284c7');
      try {
        await fetch(CONFIG.gasWebAppUrl, {
          method: 'POST', mode: 'no-cors',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        say('✅ 送信完了しました。', '#16a34a');
        if (contentEl) contentEl.value = '';
        appendLog('フィードバックを送信しました', 'info');
      } catch (err) {
        say('送信に失敗しました。', '#dc2626');
        appendLog('送信失敗: ' + err.message, 'error');
      } finally {
        if (btn) btn.disabled = false;
      }
      return;
    }

    const summary = snapshot
      ? '\n\n【図面状態】\n' + [snapshot.roomInfo, snapshot.stats, snapshot.cameraDetails].filter(Boolean).join('\n')
      : '';
    const body = '【送信者】: ' + payload.sender + '\n【送信日時】: ' + payload.timestamp + '\n\n【内容】:\n' + payload.content + summary;
    try { if (navigator.clipboard) await navigator.clipboard.writeText(body); } catch (_) { /* noop */ }
    say('⚠️ 内容をコピーし、メーラーを起動します。', '#d97706');
    window.open('mailto:' + CONFIG.adminEmail +
      '?subject=' + encodeURIComponent('【図面シミュレーターMark2】意見・報告') +
      '&body=' + encodeURIComponent(body), '_blank');
    if (btn) btn.disabled = false;
    appendLog('メーラーを起動しました (GAS 未設定)', 'warn');
  }

  // ---------------------------------------------------------------- 公開 API
  const api = {
    log: m => appendLog(m, 'info'),
    info: m => appendLog(m, 'info'),
    warn: m => appendLog(m, 'warn'),
    error: m => appendLog(m, 'error'),
    clear() {
      const box = document.getElementById('debug-box-content');
      if (box) box.innerHTML = '';
      appendLog('ログを消去しました', 'info');
    },
    diagnose(d) {
      if (!d) return;
      if (typeof d === 'string') { appendLog('[診断] ' + d, 'info'); return; }
      appendLog('--- システム診断 ---', 'info');
      if (d.roomInfo) appendLog('会場: ' + d.roomInfo, 'info');
      if (d.stats) appendLog('統計: ' + d.stats, 'info');
      if (d.cameraDetails) appendLog('カメラ: ' + d.cameraDetails, 'info');
      (d.warnings || []).forEach(w => appendLog('⚠️ ' + w, 'warn'));
    },
    setGasUrl(url) { CONFIG.gasWebAppUrl = url || ''; },
    sendFeedback
  };
  window.debugBox = api;

  window.addEventListener('DOMContentLoaded', () => {
    setupDragging();
    document.addEventListener('click', e => {
      const t = e.target.closest('[data-dbg]');
      if (t) {
        const a = t.dataset.dbg;
        if (a === 'toggle') toggleBox();
        else if (a === 'clear') api.clear();
        else if (a === 'send') sendFeedback();
        return;
      }
      const tab = e.target.closest('[data-dbg-tab]');
      if (tab) switchTab(tab.dataset.dbgTab);
    });
    window.addEventListener('error', ev => appendLog('スクリプトエラー: ' + ev.message, 'error'));
    appendLog('ログ監視を開始しました', 'info');
  });
})();
