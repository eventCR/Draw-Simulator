/**
 * ==============================================================================
 * tab7_camera.js — 【カメラ】操作UI・平面/立面の描画・視界(頭被り)判定の公開
 *
 * 依存: camera_base.js (状態), camera_angle.js (計算)
 * 他モジュール向け API:
 *   tabCameraModule.getBlockedSeatIds() → Set<seatId>   選択カメラで頭被りになる客席 (tab6 が赤表示に使用)
 *   tabCameraModule.getFovSelection()   → {seatIds, guestIds, podiumIds} | null   画角内の客席・登壇者・司会台/演台 (立面図の絞り込み)
 *   tabCameraModule.analyze(cam)        → {aim, sim}    照準・画角 / 頭被りシミュレーション
 * ==============================================================================
 */
(function () {
  'use strict';

  const U = window.Core.util;
  const { $, num } = U;
  const commit = (l) => window.Core.commit(l);
  const redraw = () => window.Core.requestRender();
  const CB = window.CameraBase;
  const CA = window.CameraAngle;

  let showFovProjection = true;          // 画角内の客席・登壇者だけを立面図に表示

  // ---------------------------------------------------------------- 計算の窓口
  function guestTargets() {
    return window.tabGuestsModule ? window.tabGuestsModule.getAimTargets() : [];
  }

  /** 照準・画角と頭被りシミュレーション。※自動ショットでは cam.fov を計算値で更新する仕様 */
  function analyze(cam) {
    if (!cam) return null;
    try {
      const aim = CA.calculateAimAndFov(cam, window.stage, guestTargets(), CB.CAMERA_MODELS);
      const sim = CA.simulateHeightClearance(cam, aim, window.seats, window.totalHeadZ);
      return { aim, sim };
    } catch (e) {
      window.debugBox && window.debugBox.error('カメラ計算エラー: ' + e.message);
      return null;
    }
  }

  function getBlockedSeatIds() {
    const a = analyze(CB.getSelected());
    return new Set(a ? a.sim.blockedSeats.map(s => s.id) : []);
  }

  function inFov(cam, aim, px, py) {
    const half = (aim.fov / 2) * Math.PI / 180;
    let d = Math.atan2(py - cam.y, px - cam.x) - aim.hAngle;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    return Math.abs(d) <= half && Math.hypot(px - cam.x, py - cam.y) * Math.cos(d) > 0;
  }

  function getFovSelection() {
    if (!showFovProjection) return null;
    const cam = CB.getSelected();
    const a = analyze(cam);
    if (!a) return null;
    return {
      seatIds: new Set(window.seats.filter(s => inFov(cam, a.aim, s.x, s.y)).map(s => s.id)),
      guestIds: new Set(window.tabGuestsModule.list.filter(g => inFov(cam, a.aim, g.x, g.y)).map(g => g.id)),
      podiumIds: new Set((window.podiums || []).filter(p => inFov(cam, a.aim, p.x, p.y)).map(p => p.id))
    };
  }

  // ---------------------------------------------------------------- UI
  function buildUI(panel) {
    if (!panel) return;
    const modelOpts = Object.keys(CB.CAMERA_MODELS).map(k => '<option value="' + k + '">' + CB.CAMERA_MODELS[k].name + '</option>').join('');
    panel.innerHTML = `
      <div class="ui-group">
        <div class="ui-group-title"><span>🎥 カメラ機材 &amp; ショット</span><button class="btn-action sm" id="btnAddCam">＋ 追加</button></div>
        <div class="ui-row full"><div class="input-box"><label>対象カメラ</label><select id="camSelect"></select></div></div>
        <div id="camSummary" class="readout"></div>
        <div class="ui-row full"><div class="input-box"><label>カメラ機種・レンズ仕様</label><select id="camModel">${modelOpts}</select></div></div>
        <div class="ui-row full">
          <div class="input-box">
            <label>撮影対象 (ショット)</label>
            <select id="camShotType">
              <option value="stage_ff">🎬 ステージ全景 (ロング)</option>
              <option value="guest_group">👥 登壇者全員 (集合)</option>
              <option value="guest_single">👤 登壇者 1人 (寄り)</option>
              <option value="manual_angle">🕹️ 手動照準・画角</option>
            </select>
          </div>
        </div>
        <div class="ui-row full hidden" id="camFramingBox"><div class="input-box"><label>構図 (どこまで映すか)</label>
          <select id="camFraming">
            <option value="FF">🧍 FF 全身 (頭〜足先)</option>
            <option value="KS">KS 膝上</option>
            <option value="WS">WS 腰上 (頭〜腰)</option>
            <option value="BS">BS 胸上</option>
            <option value="CU">CU 肩上</option>
          </select></div></div>
        <div class="ui-row full hidden" id="camTargetGuestBox"><div class="input-box"><label>ターゲット登壇者</label><select id="camTargetGuest"></select></div></div>
        <div class="ui-row full"><div class="input-box"><label>画角 (FOV: <b id="fovValDisplay">22.7</b>°)</label><input type="range" id="camFovSlider" min="0.5" max="120" step="0.1"></div></div>
      </div>

      <div class="ui-group hidden" id="camAngleBox">
        <div class="ui-group-title">首振り角度 (Pan / Tilt)</div>
        <div class="input-box"><label>パン (左右水平): <b id="camPanDisplay">0</b>°</label><input type="range" id="camPanSlider" min="-90" max="90" step="1"></div>
        <div class="input-box"><label>チルト (上下仰俯): <b id="camTiltDisplay">0</b>°</label><input type="range" id="camTiltSlider" min="-45" max="45" step="1"></div>
      </div>

      <div class="ui-group">
        <div class="ui-group-title">立面図 (画角内の表示)</div>
        <label class="chk"><input type="checkbox" id="camFovProj"> 画角内の客席・登壇者だけ立面図に表示</label>
        <div id="camSliceInfo" class="hint"></div>
      </div>

      <div class="ui-group">
        <div class="ui-group-title">カメラ位置 &amp; イントレ台</div>
        <div class="ui-row">
          <div class="input-box"><label>位置 X (mm)</label><input type="number" id="camX" step="100"></div>
          <div class="input-box"><label>位置 Y (mm)</label><input type="number" id="camY" step="100"></div>
        </div>
        <div class="ui-row">
          <div class="input-box"><label>レンズ全高 (Z mm)</label><input type="number" id="camH" step="50"></div>
          <div class="input-box"><label>台高 (H mm)</label><input type="number" id="platH" step="50"></div>
        </div>
        <div class="ui-row">
          <div class="input-box"><label>台幅 W (mm)</label><input type="number" id="platW" step="100"></div>
          <div class="input-box"><label>台奥 D (mm)</label><input type="number" id="platD" step="100"></div>
        </div>
        <div class="ui-row">
          <div class="input-box"><label>最後尾席からの距離 (mm)</label><input type="number" id="camDistFromLastRow" value="2000" step="100"></div>
          <button class="btn-action" id="btnAlignLastRow">最後尾から配置</button>
        </div>
        <div class="ui-row" style="justify-content:flex-end"><button class="btn-action sm btn-danger" id="btnDeleteCam">このカメラを削除</button></div>
      </div>`;
    bind();
    updateUI();
  }

  function bind() {
    const sel = () => CB.getSelected();

    $('btnAddCam').addEventListener('click', () => {
      CB.addCamera(window.room.w, window.stage.y, window.stage.d);
      updateUI(); redraw(); commit('カメラ追加');
    });
    $('btnDeleteCam').addEventListener('click', () => {
      if (!sel()) return;
      CB.deleteSelected();
      updateUI(); redraw(); commit('カメラ削除');
    });
    $('btnAlignLastRow').addEventListener('click', () => {
      if (!sel()) return;
      CB.alignFromLastRow(sel(), num('camDistFromLastRow', 2000), window.seats, window.chair.d);
      updateUI(); redraw(); commit('カメラを最後尾から配置');
    });
    $('camSelect').addEventListener('change', e => { CB.setSelectedId(e.target.value); updateUI(); redraw(); });

    $('camModel').addEventListener('change', e => {
      const c = sel(); if (!c) return;
      c.model = e.target.value;
      const def = CB.CAMERA_MODELS[c.model];
      if (def) c.fov = Math.max(def.minFov, Math.min(def.maxFov, c.fov || 22.7));
      updateUI(); redraw(); commit('カメラ機種');
    });
    $('camShotType').addEventListener('change', e => {
      const c = sel(); if (!c) return;
      c.shotType = e.target.value;
      updateUI(); redraw(); commit('ショットタイプ');
    });
    $('camFraming').addEventListener('change', e => {
      const c = sel(); if (!c) return;
      c.framing = e.target.value;
      updateUI(); redraw(); commit('構図');
    });
    $('camTargetGuest').addEventListener('change', e => {
      const c = sel(); if (!c) return;
      c.targetGuestId = e.target.value;
      updateUI(); redraw(); commit('ターゲット登壇者');
    });

    // スライダー: input でライブ反映、change で履歴確定
    [['camFovSlider', 'fov', 22.7], ['camPanSlider', 'pan', 0], ['camTiltSlider', 'tilt', 0]].forEach(([id, prop, def]) => {
      $(id).addEventListener('input', e => { const c = sel(); if (!c) return; c[prop] = parseFloat(e.target.value) || def; updateUI(true); redraw(); });
      $(id).addEventListener('change', () => commit('カメラ角度'));
    });

    [['camX', 'x'], ['camY', 'y'], ['camH', 'lensH'], ['platW', 'platW'], ['platD', 'platD']].forEach(([id, prop]) =>
      $(id).addEventListener('change', e => {
        const c = sel(); if (!c) return;
        const v = parseFloat(e.target.value);
        if (isFinite(v)) c[prop] = v;
        updateUI(); redraw(); commit('カメラ設定');
      }));

    $('platH').addEventListener('change', e => {            // 台高を変えたらレンズ高も同じだけ動かす
      const c = sel(); if (!c) return;
      const nv = Math.max(0, num('platH', 0)), diff = nv - (c.platH || 0);
      c.platH = nv; c.lensH = (c.lensH || 1850) + diff;
      updateUI(); redraw(); commit('台高');
    });

    $('camFovProj').addEventListener('change', e => { showFovProjection = e.target.checked; updateUI(true); redraw(); commit('画角内表示'); });
  }

  function summaryText(cam, a) {
    const { aim, sim } = a;
    let t = CA.generateSummaryText(cam, aim, sim, window.seats.length);
    if (aim.status === 'tele_limit') t += '\n・⚠️ 望遠端に到達 (これ以上寄れません)';
    if (aim.status === 'wide_limit') t += '\n・⚠️ 広角端に到達 (被写体が画角に収まりません)';
    return t;
  }

  /** light=true: スライダー操作中。セレクトの再構築を省く */
  function updateUI(light) {
    if (!$('camSelect')) return;
    const cam = CB.getSelected();
    const all = CB.getAll();

    if (!light) {
      U.fillSelect('camSelect', all.map(c => ({ value: c.id, label: c.name })), cam ? cam.id : '');
      U.fillSelect('camTargetGuest', window.tabGuestsModule.list.map(g => ({ value: g.id, label: g.name || g.id })), cam ? cam.targetGuestId : '');
    }

    const ids = ['camSelect', 'camModel', 'camShotType', 'camFraming', 'camTargetGuest', 'camFovSlider', 'camPanSlider', 'camTiltSlider', 'camX', 'camY', 'camH', 'platH', 'platW', 'platD', 'btnAlignLastRow', 'btnDeleteCam'];
    ids.forEach(id => { $(id).disabled = !cam; });
    $('camFovProj').checked = showFovProjection;

    const box = $('camSummary');
    if (!cam) { box.textContent = 'カメラがありません。「＋ 追加」で作成できます。'; box.className = 'readout'; $('camSliceInfo').innerText = ''; return; }

    const a = analyze(cam);                           // ここで cam.fov が自動ショットの値に更新される
    $('camSelect').value = cam.id;
    $('camModel').value = cam.model || 'eng_std';
    $('camShotType').value = cam.shotType || 'stage_ff';
    $('camX').value = Math.round(cam.x); $('camY').value = Math.round(cam.y); $('camH').value = Math.round(cam.lensH);
    $('platW').value = Math.round(cam.platW); $('platD').value = Math.round(cam.platD); $('platH').value = Math.round(cam.platH);

    const def = CB.CAMERA_MODELS[cam.model] || { minFov: 0.5, maxFov: 120 };
    const manual = cam.shotType === 'manual_angle' || cam.shotType === 'manual';
    const fs = $('camFovSlider');
    fs.min = def.minFov; fs.max = def.maxFov; fs.value = cam.fov;
    fs.disabled = !manual;
    fs.title = manual ? '' : 'このショットタイプでは画角は自動計算されます';
    $('fovValDisplay').innerText = (Math.round(cam.fov * 10) / 10).toFixed(1);

    const guestShot = cam.shotType === 'guest_single' || cam.shotType === 'guest_group';
    $('camFramingBox').classList.toggle('hidden', !guestShot);
    $('camFraming').value = cam.framing || 'FF';
    $('camTargetGuestBox').classList.toggle('hidden', cam.shotType !== 'guest_single');
    if (cam.shotType === 'guest_single') $('camTargetGuest').value = cam.targetGuestId || (window.tabGuestsModule.list[0] || {}).id || '';
    $('camAngleBox').classList.toggle('hidden', cam.shotType !== 'manual_angle');
    if (cam.shotType === 'manual_angle') {
      $('camPanSlider').value = cam.pan || 0; $('camTiltSlider').value = cam.tilt || 0;
      $('camPanDisplay').innerText = (cam.pan > 0 ? '+' : '') + (cam.pan || 0);
      $('camTiltDisplay').innerText = (cam.tilt > 0 ? '+' : '') + (cam.tilt || 0);
    }

    if (!a) { box.textContent = '⚠️ 計算できませんでした'; box.className = 'readout bad'; return; }
    const bad = a.sim.isBlocked || a.aim.status !== 'ok';
    box.textContent = summaryText(cam, a);
    box.className = 'readout ' + (bad ? 'bad' : 'ok');
    const inSeats = window.seats.filter(s => inFov(cam, a.aim, s.x, s.y)).length;
    const inGuests = window.tabGuestsModule.list.filter(g => inFov(cam, a.aim, g.x, g.y)).length;
    $('camSliceInfo').innerText = '画角内: 客席' + inSeats + '席・登壇者' + inGuests + '名';
  }

  // ---------------------------------------------------------------- カメラ本体の形 (ENG ショルダーカメラ風)
  /** 平面図: ローカル +x がレンズ方向。実寸(mm)で描くのでズームに追従する */
  function drawCameraTop(ctx, x, y, ang, sel) {
    ctx.save();
    ctx.translate(x, y); ctx.rotate(ang); ctx.scale(1.4, 1.4);
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 40;
    const body = sel ? '#7e22ce' : '#64748b', lens = sel ? '#a855f7' : '#94a3b8';
    // 本体
    ctx.fillStyle = body;
    ctx.beginPath(); ctx.rect(-330, -210, 560, 420); ctx.fill(); ctx.stroke();
    // レンズ鏡筒 + フード
    ctx.fillStyle = lens;
    ctx.beginPath(); ctx.rect(230, -140, 330, 280); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#0f172a';
    ctx.beginPath(); ctx.rect(560, -170, 120, 340); ctx.fill();
    // ビューファインダー
    ctx.fillStyle = '#334155';
    ctx.beginPath(); ctx.rect(-180, -330, 260, 120); ctx.fill();
    ctx.restore();
  }

  /** 立面図: 台座 → 雲台 → 本体。チルト角に合わせて本体を傾ける。dirY: +1=右向き / -1=左向き */
  function drawCameraSide(ctx, y, lensH, tiltRad, dirY, sel) {
    ctx.save();
    ctx.translate(y, -lensH);
    if (dirY < 0) ctx.scale(-1, 1);
    ctx.rotate(-tiltRad);                      // 上向き(正)で前が持ち上がる
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 30;
    ctx.fillStyle = sel ? '#7e22ce' : '#64748b';
    ctx.beginPath(); ctx.rect(-330, -210, 560, 420); ctx.fill(); ctx.stroke();
    ctx.fillStyle = sel ? '#a855f7' : '#94a3b8';
    ctx.beginPath(); ctx.rect(230, -140, 330, 280); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#0f172a';
    ctx.beginPath(); ctx.rect(560, -170, 120, 340); ctx.fill();
    ctx.fillStyle = '#334155';
    ctx.beginPath(); ctx.rect(-180, -330, 260, 120); ctx.fill();
    ctx.restore();
  }

  // ---------------------------------------------------------------- 描画
  function drawTop(ctx) {
    const T = window.Core.drawText, cams = CB.getAll();
    if (!cams.length) return;
    const selId = (CB.getSelected() || {}).id, showFov = window.displaySettings.showCamFov;

    cams.forEach(cam => {
      const a = analyze(cam), sel = cam.id === selId;
      const pw = cam.platW || 1000, pd = cam.platD || 1000;

      ctx.save();
      ctx.fillStyle = sel ? 'rgba(236,72,153,0.25)' : 'rgba(203,213,225,0.4)';
      ctx.strokeStyle = sel ? '#ec4899' : '#64748b';
      ctx.lineWidth = sel ? 30 : 20;
      ctx.fillRect(cam.x - pw / 2, cam.y - pd / 2, pw, pd);
      ctx.strokeRect(cam.x - pw / 2, cam.y - pd / 2, pw, pd);

      if (a && showFov) {
        const { aim, sim } = a;
        const half = (aim.fov / 2) * Math.PI / 180, l = aim.hAngle - half, r = aim.hAngle + half;
        const dist = Math.hypot(aim.targetX - cam.x, aim.targetY - cam.y) + 3000;
        const warn = sim.isBlocked || aim.status !== 'ok';
        ctx.beginPath();
        ctx.moveTo(cam.x, cam.y);
        ctx.lineTo(cam.x + dist * Math.cos(l), cam.y + dist * Math.sin(l));
        ctx.arc(cam.x, cam.y, dist, l, r);
        ctx.closePath();
        ctx.fillStyle = warn ? 'rgba(220,38,38,0.12)' : (sel ? 'rgba(59,130,246,0.15)' : 'rgba(148,163,184,0.08)');
        ctx.fill();
        ctx.strokeStyle = warn ? '#dc2626' : (sel ? 'rgba(37,99,235,0.6)' : 'rgba(100,116,139,0.3)');
        ctx.lineWidth = sel ? 30 : 20;
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(cam.x, cam.y); ctx.lineTo(aim.targetX, aim.targetY);
        ctx.strokeStyle = sim.isBlocked ? '#dc2626' : '#22c55e';
        ctx.lineWidth = sel ? 35 : 20;
        ctx.stroke();
      }

      drawCameraTop(ctx, cam.x, cam.y, a ? a.aim.hAngle : -Math.PI / 2, sel);
      ctx.restore();
      T(ctx, cam.name, cam.x, cam.y + pd / 2 + 350, { px: 11, bold: true });
      if (a && sel) T(ctx, 'H-FOV ' + a.aim.fov.toFixed(1) + '° / パン ' + a.aim.panDeg.toFixed(1) + '°', cam.x, cam.y + pd / 2 + 750, { px: 10, color: '#7c3aed' });
    });
  }

  /** 立面: 選択カメラの台・本体と垂直画角の上端/下端レイ・角度表示。横軸=Y */
  function drawSide(ctx) {
    const cam = CB.getSelected();
    if (!cam) return;
    const a = analyze(cam);
    const T = window.Core.drawText;
    const platH = cam.platH || 0, platD = cam.platD || 1000, lensH = cam.lensH || 1650;
    const DEG = 180 / Math.PI;

    ctx.save();
    ctx.fillStyle = '#ec4899';
    ctx.fillRect(cam.y - platD / 2, -platH, platD, platH);
    ctx.strokeStyle = '#64748b'; ctx.lineWidth = 30;
    ctx.beginPath(); ctx.moveTo(cam.y, -platH); ctx.lineTo(cam.y, -lensH); ctx.stroke();

    if (!a) { drawCameraSide(ctx, cam.y, lensH, 0, -1, true); ctx.restore(); return; }
    const { aim, sim } = a;
    const ground = Math.max(Math.hypot(aim.targetX - cam.x, aim.targetY - cam.y), 1);
    const thetaC = Math.atan2(aim.targetZ - lensH, ground), halfV = (aim.vFov / 2) * Math.PI / 180;
    const dirY = Math.sin(aim.hAngle) >= 0 ? 1 : -1;      // ステージ側(Yが減る向き)なら左向き
    drawCameraSide(ctx, cam.y, lensH, thetaC, dirY, true);

    if (window.displaySettings.showCamFov) {
      const L = 22000;
      const end = (th, len) => ({ x: cam.y + dirY * (len || L) * Math.cos(th), y: -(lensH + (len || L) * Math.sin(th)) });

      const hi = end(thetaC + halfV);
      ctx.beginPath(); ctx.moveTo(cam.y, -lensH); ctx.lineTo(hi.x, hi.y);
      ctx.strokeStyle = '#0284c7'; ctx.lineWidth = 20; ctx.setLineDash([80, 40]); ctx.stroke();

      const lo = end(thetaC - halfV);
      ctx.beginPath(); ctx.moveTo(cam.y, -lensH); ctx.lineTo(lo.x, lo.y);
      ctx.strokeStyle = sim.isBlocked ? '#dc2626' : '#2563eb';
      ctx.lineWidth = sim.isBlocked ? 40 : 30; ctx.setLineDash([]); ctx.stroke();

      // 中心線 (照準)
      const ce = end(thetaC);
      ctx.beginPath(); ctx.moveTo(cam.y, -lensH); ctx.lineTo(ce.x, ce.y);
      ctx.strokeStyle = 'rgba(34,197,94,0.7)'; ctx.lineWidth = 14; ctx.setLineDash([200, 100]); ctx.stroke();
      ctx.setLineDash([]);

      // 水平基準線 と チルト角の円弧
      const R = 2600;
      ctx.beginPath(); ctx.moveTo(cam.y, -lensH); ctx.lineTo(cam.y + dirY * (R + 900), -lensH);
      ctx.strokeStyle = '#94a3b8'; ctx.lineWidth = 10; ctx.setLineDash([60, 60]); ctx.stroke(); ctx.setLineDash([]);
      ctx.beginPath();
      // dirY=+1: 右向き→ 角度は −thetaC。左向きはπ側
      if (dirY > 0) ctx.arc(cam.y, -lensH, R, -thetaC, 0, thetaC < 0 ? true : false);
      else ctx.arc(cam.y, -lensH, R, Math.PI, Math.PI + thetaC, thetaC < 0);
      ctx.strokeStyle = '#16a34a'; ctx.lineWidth = 24; ctx.stroke();

      const dTilt = thetaC * DEG, dHi = (thetaC + halfV) * DEG, dLo = (thetaC - halfV) * DEG;
      const sgn = v => (v > 0 ? '+' : '') + v.toFixed(1) + '°';
      const mid = (th, len) => end(th, len);
      const pTilt = mid(thetaC / 2, R + 700);
      T(ctx, 'チルト ' + sgn(dTilt), pTilt.x, pTilt.y + (dTilt >= 0 ? 380 : -380), { px: 12, bold: true, color: '#15803d' });
      const pHi = mid(thetaC + halfV, 7000), pLo = mid(thetaC - halfV, 7000);
      T(ctx, '上端 ' + sgn(dHi), pHi.x, pHi.y - 350, { px: 11, bold: true, color: '#0369a1' });
      T(ctx, '下端 ' + sgn(dLo), pLo.x, pLo.y + 350, { px: 11, bold: true, color: sim.isBlocked ? '#dc2626' : '#1d4ed8' });
      T(ctx, 'V-FOV ' + aim.vFov.toFixed(1) + '° (H-FOV ' + aim.fov.toFixed(1) + '°)', cam.y, -lensH - 1100, { px: 12, bold: true, color: '#7c3aed' });

      // 構図: 映すべき範囲 (頭頂〜切る位置) のブラケット
      if (aim.frame) {
        const f = aim.frame, bx = aim.targetY;
        ctx.beginPath(); ctx.moveTo(bx, -f.subjectTop); ctx.lineTo(bx, -f.subjectBottom);
        ctx.strokeStyle = f.fits ? '#16a34a' : '#dc2626'; ctx.lineWidth = 30; ctx.stroke();
        [f.subjectTop, f.subjectBottom].forEach(z => {
          ctx.beginPath(); ctx.moveTo(bx - 150, -z); ctx.lineTo(bx + 150, -z); ctx.stroke();
        });
        T(ctx, f.label + (f.fits ? '' : ' ⚠切れ'), bx, -f.subjectTop - 300, { px: 11, bold: true, color: f.fits ? '#15803d' : '#dc2626' });
      } else {
        ctx.beginPath(); ctx.arc(aim.targetY, -aim.targetZ, 120, 0, Math.PI * 2);   // 照準点
        ctx.fillStyle = '#22c55e'; ctx.fill();
      }
    }
    ctx.restore();
  }

  // ---------------------------------------------------------------- 当たり判定 / ドラッグ
  function hitTest(wx, wy, view) {
    const cams = CB.getAll();
    if (view === 'side') {                       // 立面: 選択中カメラのレンズ位置のみ。奥行き(Y)方向に動かせる
      const c = CB.getSelected();
      if (c && Math.hypot(wx - c.y, wy - (c.lensH || 0)) < 400) return { id: c.id, offX: wx - c.y, offY: 0 };
      return null;
    }
    for (let i = cams.length - 1; i >= 0; i--) {
      const c = cams[i], pw = c.platW || 1000, pd = c.platD || 1000;
      const onHead = Math.hypot(wx - c.x, wy - c.y) < 350;
      const onPlat = Math.abs(wx - c.x) <= pw / 2 && Math.abs(wy - c.y) <= pd / 2;
      if (onHead || onPlat) return { id: c.id, offX: wx - c.x, offY: wy - c.y };
    }
    return null;
  }

  function onGrab(item) {
    CB.setSelectedId(item.id);
    updateUI();
    window.Core.switchTab('camera');
    redraw();
  }

  function handleDrag(item, wx, wy, view) {
    const c = CB.getById(item.id);
    if (!c) return;
    if (view === 'top') { c.x = Math.round(wx - item.offX); c.y = Math.round(wy - item.offY); }
    else c.y = Math.round(wx - item.offX);
    updateUI(true);
  }

  // ---------------------------------------------------------------- 保存 / 復元
  function exportData() {
    const d = CB.exportData();
    d.showFovProjection = showFovProjection;
    return d;
  }
  function importData(d) {
    if (!d) return;
    CB.importData(d);
    if (!Array.isArray(d) && typeof d.showFovProjection === 'boolean') showFovProjection = d.showFovProjection;
    updateUI();
  }

  window.tabCameraModule = {
    init: buildUI, drawTop, drawSide, hitTest, onGrab, handleDrag, exportData, importData,
    updateUI, analyze, getBlockedSeatIds, getFovSelection,
    setFovProjection(v) { showFovProjection = !!v; updateUI(true); redraw(); },
    isFovProjection: () => showFovProjection
  };
  window.Core.register('camera', window.tabCameraModule, { order: 80 });

  // 他タブ (登壇者・客席・ステージなど) が確定した後に、サマリーと選択肢を最新化する
  window.Core.on('commit', () => updateUI());
})();
