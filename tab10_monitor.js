/**
 * ==============================================================================
 * tab10_monitor.js — 【モニター】返しモニター / 演出モニター
 *
 * 所有する共有データ: window.monitors[]
 *   { id, name, size, target:'guest'|'audience', stand:'low'|'normal'|'high', placeOn:'floor'|'stage',
 *     panAngle, tilt, w, h, baseW, baseD, fov, x, y }
 * 向きの規約: 登壇者向け(guest)は −Y (ステージ側) を向く。客席向け(audience)は +Y を向く。
 * 表示設定 (tab8): displaySettings.showMonitorFov / showMonitorAngles / showMonitorDims
 * ==============================================================================
 */
(function () {
  'use strict';

  const U = window.Core.util;
  const { $, clone, num } = U;
  const commit = (l) => window.Core.commit(l);
  const redraw = () => window.Core.requestRender();

  // 画面サイズ別寸法 (W × H × 台座W × 台座D × ロー基準の中心高 × 既定チルト)
  const SIZE_MAP = {
    '24': { w: 530, h: 300, baseW: 450, baseD: 400, centerH: 320, tilt: 25 },
    '32': { w: 710, h: 400, baseW: 550, baseD: 450, centerH: 380, tilt: 25 },
    '43': { w: 970, h: 560, baseW: 650, baseD: 500, centerH: 420, tilt: 25 },
    '50': { w: 1110, h: 625, baseW: 680, baseD: 550, centerH: 450, tilt: 25 },
    '55': { w: 1220, h: 690, baseW: 720, baseD: 550, centerH: 480, tilt: 25 },
    '65': { w: 1440, h: 810, baseW: 800, baseD: 600, centerH: 520, tilt: 25 },
    '75': { w: 1660, h: 935, baseW: 900, baseD: 650, centerH: 560, tilt: 25 },
    '86': { w: 1930, h: 1090, baseW: 1000, baseD: 700, centerH: 600, tilt: 25 },
    '100': { w: 2210, h: 1250, baseW: 1100, baseD: 750, centerH: 650, tilt: 25 }
  };
  const STAND = {
    low: { name: 'ロースタンド', heightOffset: 0, tilt: 25 },
    normal: { name: 'スタンド自立', heightOffset: 800, tilt: 0 },
    high: { name: 'ハイスタンド', heightOffset: 1400, tilt: 0 }
  };

  const mk = (id, size, pan, x, y) => Object.assign({
    id, size, target: 'guest', stand: 'low', placeOn: 'floor', panAngle: pan, tilt: 25, fov: 90, x, y
  }, dims(size));
  function dims(size) { const s = SIZE_MAP[size] || SIZE_MAP['50']; return { w: s.w, h: s.h, baseW: s.baseW, baseD: s.baseD }; }

  const DEFAULTS = () => [
    mk('M1', '24', 0, 7531, 4949),
    mk('M2', '50', -15, 8427, 4892),
    mk('M3', '50', 15, 6620, 4864)
  ];

  window.monitors = DEFAULTS();
  let selectedId = 'M1';

  const selected = () => window.monitors.find(m => m.id === selectedId) || null;
  const kind = (m) => m.target === 'guest' ? '返しモニター' : '演出モニター';
  const label = (m) => kind(m) + ' ' + (window.monitors.indexOf(m) + 1) + ' (' + m.size + '")';
  const onStage = (m) => m.placeOn === 'stage' && window.isInsideStage(m.x, m.y);
  const baseZ = (m) => onStage(m) ? window.stage.h : 0;
  /** 画面が向く Y 方向: guest=−1 (ステージ側) / audience=+1 */
  const facing = (m) => m.target === 'audience' ? 1 : -1;
  const centerH = (m) => (SIZE_MAP[m.size] || SIZE_MAP['50']).centerH + (STAND[m.stand] || STAND.low).heightOffset;

  // ---------------------------------------------------------------- UI
  function buildUI(panel) {
    if (!panel) return;
    const sizeOpts = Object.keys(SIZE_MAP).map(k => '<option value="' + k + '">' + k + 'インチ (W' + SIZE_MAP[k].w + '×H' + SIZE_MAP[k].h + ')</option>').join('');
    panel.innerHTML = `
      <div class="ui-group">
        <div class="ui-group-title"><span>📺 モニター・映像管理</span><button class="btn-action sm btn-accent" id="monAddBtn">＋ 追加</button></div>
        <div class="ui-row full"><div class="input-box"><label>選択機器</label><select id="monSelect"></select></div></div>
        <div id="monControls">
          <div class="ui-row">
            <div class="input-box"><label>用途・向き</label>
              <select id="monTarget"><option value="guest">登壇者向け (返しモニター)</option><option value="audience">客席向け (演出モニター)</option></select></div>
            <div class="input-box"><label>スタンド種別</label>
              <select id="monStand"><option value="low">ロースタンド (キャスター台座)</option><option value="normal">スタンド自立 (モニター本体)</option><option value="high">ハイスタンド</option></select></div>
          </div>
          <div class="ui-row">
            <div class="input-box"><label>画面サイズ</label><select id="monSize">${sizeOpts}</select></div>
            <div class="input-box"><label>首振り角度 (°)</label><input type="number" id="monPan" step="5"></div>
            <div class="input-box"><label>チルト (°)</label><input type="number" id="monTilt" step="5"></div>
          </div>
          <div class="ui-row">
            <div class="input-box" style="flex:2"><label>設置場所</label>
              <select id="monPlace"><option value="floor">フロア（床置き）</option><option value="stage">ステージ天板上</option></select></div>
            <div class="input-box"><label>位置 X (mm)</label><input type="number" id="monX" step="50"></div>
            <div class="input-box"><label>位置 Y (mm)</label><input type="number" id="monY" step="50"></div>
          </div>
          <div class="ui-row" style="justify-content:space-between; margin-top:6px;">
            <button class="btn-action sm" id="monResetBtn">初期配置に戻す</button>
            <button class="btn-action sm btn-danger" id="monDelBtn">削除</button>
          </div>
        </div>
      </div>
      <div class="ui-group">
        <div class="ui-group-title">👁️ 視認シミュレーション (視野角90°)</div>
        <div id="monSimResult" class="log-box"></div>
      </div>`;
    bind();
    syncUI();
  }

  function bind() {
    $('monAddBtn').addEventListener('click', () => {
      const st = window.stage, n = window.monitors.length + 1;
      const m = mk(U.nextId('M', window.monitors), '50', 0, st.x + st.w / 2 + (n % 2 === 0 ? 1500 : -1500), st.y + st.d + 600);
      window.monitors.push(m);
      selectedId = m.id;
      syncUI(); redraw(); commit('モニター追加');
    });
    $('monResetBtn').addEventListener('click', () => {
      window.monitors = DEFAULTS(); selectedId = 'M1';
      syncUI(); redraw(); commit('モニター初期配置');
    });
    $('monDelBtn').addEventListener('click', () => {
      if (!selected()) return;
      window.monitors = window.monitors.filter(m => m.id !== selectedId);
      selectedId = window.monitors.length ? window.monitors[0].id : null;
      syncUI(); redraw(); commit('モニター削除');
    });
    $('monSelect').addEventListener('change', e => { selectedId = e.target.value; syncUI(); redraw(); });

    ['monTarget', 'monStand', 'monSize', 'monPan', 'monTilt', 'monPlace', 'monX', 'monY'].forEach(id =>
      $(id).addEventListener('change', () => {
        const m = selected();
        if (!m) return;
        const standChanged = $('monStand').value !== m.stand;
        m.target = $('monTarget').value;
        m.stand = $('monStand').value;
        m.size = $('monSize').value;
        m.panAngle = num('monPan', 0);
        m.tilt = standChanged ? (STAND[m.stand] || STAND.low).tilt : num('monTilt', m.tilt);
        m.placeOn = $('monPlace').value;
        m.x = num('monX', m.x);
        m.y = num('monY', m.y);
        Object.assign(m, dims(m.size));
        m.name = label(m);
        syncUI(); redraw(); commit('モニター変更');
      }));
  }

  function syncUI() {
    if (!$('monSelect')) return;
    const list = window.monitors;
    if (!selected() && list.length) selectedId = list[0].id;
    if (!list.length) selectedId = null;
    list.forEach(m => { m.name = label(m); });

    U.fillSelect('monSelect', list.map(m => ({ value: m.id, label: m.name + ' ' + (m.target === 'guest' ? '返し' : '客席向') })), selectedId || '');
    const m = selected();
    $('monControls').classList.toggle('hidden', !m);
    if (m) {
      $('monTarget').value = m.target; $('monStand').value = m.stand || 'low'; $('monSize').value = m.size || '50';
      $('monPan').value = Math.round(m.panAngle || 0); $('monTilt').value = Math.round(m.tilt || 0);
      $('monPlace').value = m.placeOn || 'floor';
      $('monX').value = Math.round(m.x); $('monY').value = Math.round(m.y);
    }
    updateSimulation();
  }

  // ---------------------------------------------------------------- 視認シミュレーション
  function angleDiff(a, b) {
    let d = Math.abs(a - b);
    while (d > 180) d = Math.abs(d - 360);
    return d;
  }

  function updateSimulation() {
    const box = $('monSimResult');
    if (!box) return;
    if (!window.monitors.length) { box.textContent = 'モニターが配置されていません。'; return; }

    const out = [];
    window.monitors.forEach(m => {
      const aim = (m.target === 'audience' ? 90 : -90) + (m.panAngle || 0);
      const angTo = (p) => Math.atan2(p.y - m.y, p.x - m.x) * 180 / Math.PI;
      let html = '<div style="margin-bottom:8px; padding-bottom:6px; border-bottom:1px dashed #cbd5e1;">' +
        '<strong style="color:#2563eb;">' + escapeHtml(m.name) + ' [' + m.size + '" / ' + (m.target === 'guest' ? '返し' : '演出') + ']</strong><br>';

      if (m.target === 'guest') {
        const gs = window.tabGuestsModule.list;
        if (!gs.length) html += '<span style="color:#64748b;">登壇者が配置されていません</span>';
        gs.forEach(g => {
          const d = angleDiff(angTo(g), aim), ok = d <= 45;
          html += ' ' + (ok ? '🟢' : '🔴') + ' ' + escapeHtml(g.name || '登壇者') + ': 角度ズレ ' + Math.round(d) + '° ' + (ok ? '(視野内)' : '(見えません)') + '<br>';
        });
      } else if (!window.seats.length) {
        html += '<span style="color:#64748b;">客席が配置されていません</span>';
      } else {
        const rows = {};
        window.seats.forEach(s => { (rows[s.row || 1] = rows[s.row || 1] || []).push(s); });
        Object.keys(rows).sort((a, b) => a - b).forEach(r => {
          const rs = rows[r].sort((a, b) => a.x - b.x);
          const l = angleDiff(angTo(rs[0]), aim) <= 45, rr = angleDiff(angTo(rs[rs.length - 1]), aim) <= 45;
          html += ' 列' + r + ': ' + (l && rr ? '🟢 全幅で視認可能' : (!l && !rr ? '🔴 視野外 (見えない)' : '🟡 片側見切れ (左:' + (l ? '○' : '×') + ' 右:' + (rr ? '○' : '×') + ')')) + '<br>';
        });
      }
      out.push(html + '</div>');
    });
    box.innerHTML = out.join('');
  }

  function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

  // ---------------------------------------------------------------- 描画
  function drawTop(ctx) {
    const T = window.Core.drawText, ds = window.displaySettings;
    const stageFrontY = window.stage.y + window.stage.d;
    let firstRowY = stageFrontY + 2500;
    if (window.seats.length) firstRowY = Math.min.apply(null, window.seats.map(s => s.y)) - window.chair.d / 2;

    window.monitors.forEach(m => {
      const sel = m.id === selectedId, mW = m.w, bW = m.baseW, bD = m.baseD, low = m.stand === 'low';
      const aimRad = ((m.target === 'audience' ? 90 : -90) + (m.panAngle || 0)) * Math.PI / 180;

      if (ds.showMonitorFov) {                              // 視野角コーン (90°)
        const fov = Math.PI / 2, dist = 5500;
        ctx.save();
        ctx.translate(m.x, m.y);
        ctx.fillStyle = sel ? 'rgba(2,132,199,0.12)' : 'rgba(2,132,199,0.05)';
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, dist, aimRad - fov / 2, aimRad + fov / 2); ctx.closePath(); ctx.fill();
        ctx.strokeStyle = sel ? '#0284c7' : '#94a3b8'; ctx.lineWidth = 20;
        ctx.beginPath();
        ctx.moveTo(0, 0); ctx.lineTo(dist * Math.cos(aimRad - fov / 2), dist * Math.sin(aimRad - fov / 2));
        ctx.moveTo(0, 0); ctx.lineTo(dist * Math.cos(aimRad + fov / 2), dist * Math.sin(aimRad + fov / 2));
        ctx.stroke();
        ctx.restore();
      }

      ctx.save();
      ctx.translate(m.x, m.y);
      ctx.rotate((m.panAngle || 0) * Math.PI / 180);
      const f = facing(m);                                   // 画面側 (ローカル −y / +y)
      if (low) {
        const stg = onStage(m);
        ctx.fillStyle = sel ? '#e0f2fe' : (stg ? '#eff6ff' : '#f8fafc');
        ctx.fillRect(-bW / 2, -bD / 2, bW, bD);
        ctx.strokeStyle = sel ? '#2563eb' : (stg ? '#0284c7' : '#64748b'); ctx.lineWidth = sel ? 35 : 20;
        ctx.strokeRect(-bW / 2, -bD / 2, bW, bD);
        ctx.fillStyle = '#475569';
        [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sy]) => {      // キャスター
          ctx.beginPath(); ctx.arc(sx * (bW / 2 - 40), sy * (bD / 2 - 40), 30, 0, Math.PI * 2); ctx.fill();
        });
        const py = f < 0 ? -bD / 2 - 40 : bD / 2 - 20;                    // 画面パネル
        ctx.fillStyle = '#0284c7'; ctx.fillRect(-mW / 2, py, mW, 60);
        ctx.strokeStyle = '#0369a1'; ctx.lineWidth = 25; ctx.strokeRect(-mW / 2, py, mW, 60);
      } else {
        ctx.fillStyle = sel ? '#e0f2fe' : '#0f172a'; ctx.fillRect(-mW / 2, -30, mW, 60);
        ctx.strokeStyle = sel ? '#2563eb' : '#0284c7'; ctx.lineWidth = sel ? 30 : 20; ctx.strokeRect(-mW / 2, -30, mW, 60);
        ctx.fillStyle = '#38bdf8'; ctx.fillRect(-mW / 2 + 15, f < 0 ? -30 : 10, mW - 30, 20);
        ctx.fillStyle = '#475569'; ctx.fillRect(-mW / 6, -50, mW / 3, 100);
      }
      ctx.restore();

      const angle = ds.showMonitorAngles ? '(' + (m.panAngle >= 0 ? '+' : '') + m.panAngle + '°)' : '';
      T(ctx, m.size + '" ' + (m.target === 'guest' ? '返し' : '演出') + angle + (onStage(m) ? '[舞台]' : '[床]'),
        m.x, m.y + (low ? bD / 2 + 260 : 260), { px: 10, bold: true });

      if (ds.showMonitorDims) {
        const dx = m.x + mW / 2 + 350;
        window.Core.drawDimLine(ctx, dx, stageFrontY, dx, m.y, '舞台端: ' + (Math.abs(m.y - stageFrontY) / 1000).toFixed(2) + 'm', { offset: 0 });
        window.Core.drawDimLine(ctx, dx, m.y, dx, firstRowY, '客席: ' + (Math.abs(firstRowY - m.y) / 1000).toFixed(2) + 'm', { offset: 0 });
      }
    });
  }

  function drawSide(ctx) {
    const T = window.Core.drawText;
    window.monitors.forEach((m, idx) => {
      const sel = m.id === selectedId, bz = baseZ(m), bD = m.baseD, mH = m.h, f = facing(m), low = m.stand === 'low';
      const ch = centerH(m);
      const tilt = (m.tilt || 0) * Math.PI / 180;
      const stroke = sel ? '#2563eb' : '#0284c7';

      ctx.save();
      ctx.strokeStyle = stroke; ctx.fillStyle = stroke; ctx.lineWidth = 25;

      let px = m.y;                                          // 画面スラブの中心 (奥行きY)
      if (low) {
        const rear = m.y - f * (bD / 2 - 120);              // ポールは台座の後方寄り
        px = rear;
        ctx.beginPath(); ctx.arc(m.y - bD / 2 + 60, -bz - 30, 30, 0, Math.PI * 2); ctx.fill();   // キャスター
        ctx.beginPath(); ctx.arc(m.y + bD / 2 - 60, -bz - 30, 30, 0, Math.PI * 2); ctx.fill();
        ctx.strokeRect(m.y - bD / 2, -bz - 80, bD, 40);                                          // 台座
        ctx.beginPath(); ctx.moveTo(rear, -bz - 80); ctx.lineTo(rear, -bz - ch); ctx.stroke();    // ポール
      }

      ctx.translate(px, -bz - ch);
      ctx.rotate(-f * tilt);                                 // 上向きに起こす (画面側が上を向く)
      ctx.fillStyle = '#0f172a'; ctx.fillRect(-20, -mH / 2, 40, mH);
      ctx.fillStyle = sel ? '#38bdf8' : '#e0f2fe';
      ctx.fillRect(f < 0 ? -20 : 8, -mH / 2, 12, mH);        // 画面面
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 12; ctx.strokeRect(-20, -mH / 2, 40, mH);
      if (!low) { ctx.fillStyle = '#475569'; ctx.fillRect(-100, mH / 2, 200, 25); }               // 自立スタンドの足
      ctx.restore();

      T(ctx, m.size + '" ' + (m.target === 'guest' ? '返し' : '演出'), m.y, -bz - ch - mH / 2 - (idx % 2 === 0 ? 200 : 420), { px: 10, bold: true });
    });
  }

  // ---------------------------------------------------------------- 当たり判定 / ドラッグ
  function hitTest(wx, wy, view) {
    for (let i = window.monitors.length - 1; i >= 0; i--) {
      const m = window.monitors[i];
      if (view === 'top') {
        if (Math.hypot(m.x - wx, m.y - wy) < m.w / 2 + 150) return { id: m.id };
      } else if (Math.hypot(m.y - wx, baseZ(m) + centerH(m) - wy) < 500) return { id: m.id };
    }
    return null;
  }

  function onGrab(item) {
    selectedId = item.id;
    syncUI();
    window.Core.switchTab('monitor');
    redraw();
  }

  function handleDrag(item, wx, wy, view) {
    const m = window.monitors.find(v => v.id === item.id);
    if (!m) return;
    if (view === 'top') { m.x = Math.round(wx); m.y = Math.round(wy); }
    else m.y = Math.round(wx);
    if (selectedId === m.id) { $('monX').value = m.x; $('monY').value = m.y; }
    updateSimulation();
  }

  // ---------------------------------------------------------------- 保存 / 復元
  function exportData() { return { monitors: clone(window.monitors), selectedId }; }

  function importData(d) {
    if (!d) return;
    const list = Array.isArray(d) ? d : d.monitors;
    if (Array.isArray(list)) window.monitors = clone(list).map(m => Object.assign({ tilt: 25, fov: 90, placeOn: 'floor', stand: 'low', target: 'guest' }, dims(m.size), m));
    selectedId = window.monitors.some(m => m.id === d.selectedId) ? d.selectedId : (window.monitors[0] ? window.monitors[0].id : null);
    syncUI();
  }

  window.tabMonitorModule = { init: buildUI, drawTop, drawSide, hitTest, onGrab, handleDrag, exportData, importData, syncUI, updateSimulation };
  window.Core.register('monitor', window.tabMonitorModule, { order: 70 });
  window.Core.on('commit', updateSimulation);          // 登壇者・客席の変更後に視認ログを更新
})();
