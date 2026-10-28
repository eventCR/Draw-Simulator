/**
 * ==============================================================================
 * tab7_camera.js — 【カメラ】操作UI・平面/立面の描画・視界(頭被り)判定の公開
 *
 * 依存: camera_base.js (状態), camera_angle.js (計算)
 * 他モジュール向け API:
 *   tabCameraModule.getBlockedSeatIds() → Set<seatId>   選択カメラで頭被りになる客席 (tab6 が赤表示に使用)
 *   tabCameraModule.getFovSelection()   → {seatIds, guestIds, podiumIds, equipIds, itemIds, monitorIds, panelIds, screenIds} | null
 *                                       完全に画角内の客席・登壇者・司会台・機材・舞台什器・モニター・パネル・スクリーン (立面図の絞り込み)
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
      const sim = CA.simulateHeightClearance(cam, aim, window.seats, window.totalHeadZ, undefined, window.chair);
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

  /**
   * 「完全に」画角内か。足跡の中心・四隅・各辺の中点のすべてが水平画角の内側にあること。
   * zr=[下,上] (mm) を渡すと、その高さの範囲も垂直画角の内側に収まっていること (現在は使っていない)。
   */
  function rectFullyInFov(cam, aim, cx, cy, w, d, angleDeg, zr) {
    const r = (angleDeg || 0) * Math.PI / 180, c = Math.cos(r), s = Math.sin(r), hw = (w || 0) / 2, hd = (d || 0) / 2;
    const pts = [[0, 0], [-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd], [0, -hd], [0, hd], [-hw, 0], [hw, 0]];
    const lens = cam.lensH || 0;
    const ground = Math.max(Math.hypot(aim.targetX - cam.x, aim.targetY - cam.y), 1);
    const thetaC = Math.atan2(aim.targetZ - lens, ground), halfV = (aim.vFov / 2) * Math.PI / 180;
    return pts.every(q => {
      const px = cx + q[0] * c - q[1] * s, py = cy + q[0] * s + q[1] * c;
      if (!inFov(cam, aim, px, py)) return false;
      if (!zr) return true;
      let diff = Math.atan2(py - cam.y, px - cam.x) - aim.hAngle;
      while (diff > Math.PI) diff -= 2 * Math.PI;
      while (diff < -Math.PI) diff += 2 * Math.PI;
      const depth = Math.max(Math.hypot(px - cam.x, py - cam.y) * Math.cos(diff), 1);       // 光軸方向の水平距離
      return zr.every(z => { const ang = Math.atan2(z - lens, depth); return ang >= thetaC - halfV - 1e-6 && ang <= thetaC + halfV + 1e-6; });
    });
  }

  function getFovSelection() {
    if (!showFovProjection) return null;
    const cam = CB.getSelected();
    const a = analyze(cam);
    if (!a) return null;
    const A = a.aim, ch = window.chair || { w: 500, d: 500 };
    const Z = (mod, fn, o) => { const m = window[mod]; return (m && m[fn]) ? m[fn](o) : null; };
    const fm = window.tabFacilityModule;
    return {
      // 客席・登壇者は高さは問わず、足跡の全体が水平画角に入っているものだけ (登壇者の足元を意図的に切る構図があるため)
      seatIds: new Set(window.seats.filter(s => rectFullyInFov(cam, A, s.x, s.y, ch.w, ch.d, s.angle, null)).map(s => s.id)),
      guestIds: new Set(window.tabGuestsModule.list.filter(g => rectFullyInFov(cam, A, g.x, g.y, 500, 500, 0, null)).map(g => g.id)),
      // それ以外の物も、平面図の扇形 (水平画角) の中に足跡の全体が入っていれば表示する (高さは問わない)
      podiumIds: new Set((window.podiums || []).filter(p => rectFullyInFov(cam, A, p.x, p.y, p.w, p.d, p.angle, null)).map(p => p.id)),
      equipIds: new Set((window.equipments || []).filter(e => rectFullyInFov(cam, A, e.x, e.y, e.w, e.d, e.angle, null)).map(e => e.id)),
      itemIds: new Set((window.stageItems || []).filter(e => rectFullyInFov(cam, A, e.x, e.y, e.w, e.shape === 'circle' ? e.w : e.d, e.angle, null)).map(e => e.id)),
      monitorIds: new Set((window.monitors || []).filter(m => rectFullyInFov(cam, A, m.x, m.y, Math.max(m.w || 0, m.baseW || 0), m.baseD || 400, m.panAngle, null)).map(m => m.id)),
      panelIds: new Set((window.panels || []).filter(p => {
        const pos = fm && fm.getPanelPos ? fm.getPanelPos(p) : { x: p.x, y: p.y };
        return rectFullyInFov(cam, A, pos.x + p.w / 2, pos.y + p.d / 2, p.w, p.d, 0, null);
      }).map(p => p.id)),
      screenIds: new Set((window.screens || []).filter(s => rectFullyInFov(cam, A, s.x, s.y, s.w, 100, s.angle, null)).map(s => s.id))
    };
  }

  // ---------------------------------------------------------------- UI
  function buildUI(panel) {
    if (!panel) return;
    const modelOpts = Object.keys(CB.CAMERA_MODELS).map(k => '<option value="' + k + '">' + CB.CAMERA_MODELS[k].name + '</option>').join('');
    panel.innerHTML = `
      <div class="ui-group">
        <div class="ui-group-title"><span>🎥 カメラ機材 &amp; ショット</span><button class="btn-action sm" id="btnAddCam">＋ カメラ追加</button></div>
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
        <label class="chk"><input type="checkbox" id="camFovProj"> 完全に画角内のものだけ立面図に表示</label>
        <div id="camSliceInfo" class="hint"></div>
      </div>

      <div class="ui-group">
        <div class="ui-group-title"><span>カメラ位置</span><button class="btn-action sm btn-danger" id="btnDeleteCam">このカメラを削除</button></div>
        <div class="ui-row full"><div class="input-box"><label>載せるイントレ (台)</label><select id="camPlatform"></select></div></div>
        <div class="ui-row">
          <div class="input-box"><label>位置 X (mm)</label><input type="number" id="camX" step="100"></div>
          <div class="input-box"><label>位置 Y (mm)</label><input type="number" id="camY" step="100"></div>
          <div class="input-box"><label>レンズ全高 (Z mm)</label><input type="number" id="camH" step="50"></div>
        </div>
        <div class="hint">台に載せたカメラは、台の上だけで動かせます。台を動かすと、載っているカメラ全部が一緒に動きます。台を変えても、レンズの高さは保たれます。</div>
      </div>

      <div class="ui-group">
        <div class="ui-group-title"><span>🏗️ イントレ台 (複数台のカメラを載せられます)</span><button class="btn-action sm" id="btnAddPlat">＋ 台を追加</button></div>
        <div class="ui-row full"><div class="input-box"><label>対象の台</label><select id="platSelect"></select></div></div>
        <div class="hint" id="platCamList"></div>
        <div class="ui-row full"><div class="input-box"><label>名称</label><input type="text" id="platName"></div></div>
        <div class="ui-row">
          <div class="input-box"><label>中心 X (mm)</label><input type="number" id="platX" step="100"></div>
          <div class="input-box"><label>中心 Y (mm)</label><input type="number" id="platY" step="100"></div>
        </div>
        <div class="ui-row">
          <div class="input-box"><label>台幅 W (mm)</label><input type="number" id="platW" step="100"></div>
          <div class="input-box"><label>台奥 D (mm)</label><input type="number" id="platD" step="100"></div>
          <div class="input-box"><label>台高 H (mm)</label><input type="number" id="platH" step="50"></div>
        </div>
        <div class="ui-row">
          <div class="input-box">
            <label>配置の基準</label>
            <select id="camAlignRef">
              <option value="lastRow">最後尾席の後ろ脚から</option>
              <option value="backWall">会場の後壁から</option>
              <option value="stageFront">ステージ前縁から</option>
            </select>
          </div>
          <div class="input-box"><label>基準からの距離 (mm)</label><input type="number" id="camDistFromLastRow" value="2000" step="100"></div>
          <button class="btn-action" id="btnAlignLastRow">この基準で配置</button>
        </div>
        <div class="hint">距離は、基準から台(台なしならカメラ)の一番近い辺までです。後壁からは台の後ろの辺までの距離になります。左右は上の「中心 X」で指定します。</div>
        <div class="ui-row" style="justify-content:flex-end"><button class="btn-action sm btn-danger" id="btnDelPlat">この台を削除 (載っているカメラは台なしに)</button></div>
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
      const target = CB.getSelectedPlatform() || sel();            // 台があれば台 (載っているカメラも一緒に移動)
      if (!target) return;
      CB.alignFromRef(target, $('camAlignRef').value, num('camDistFromLastRow', 2000), { seats: window.seats, chairD: window.chair.d, room: window.room, stage: window.stage });
      updateUI(); redraw(); commit('台を基準から配置');
    });
    $('btnAddPlat').addEventListener('click', () => {
      CB.addPlatform(window.room.w, window.stage.y, window.stage.d);
      updateUI(); redraw(); commit('イントレ追加');
    });
    $('btnDelPlat').addEventListener('click', () => {
      const p = CB.getSelectedPlatform(); if (!p) return;
      CB.deletePlatform(p.id);
      updateUI(); redraw(); commit('イントレ削除');
    });
    $('platSelect').addEventListener('change', e => { CB.setSelectedPlatformId(e.target.value); updateUI(); redraw(); });
    $('camPlatform').addEventListener('change', e => {
      const c = sel(); if (!c) return;
      CB.assignCamera(c, e.target.value);
      if (c.platformId) CB.setSelectedPlatformId(c.platformId);
      updateUI(); redraw(); commit('カメラの台を変更');
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

    // カメラの絶対位置・レンズ高 (台に載っていれば台の上のずれ・天板からの高さとして記録される)
    ['camX', 'camY'].forEach(id => $(id).addEventListener('change', () => {
      const c = sel(); if (!c) return;
      CB.moveCameraTo(c, num('camX', c.x), num('camY', c.y));
      updateUI(); redraw(); commit('カメラ位置');
    }));
    $('camH').addEventListener('change', () => {
      const c = sel(); if (!c) return;
      CB.setLensHeight(c, Math.max(0, num('camH', c.lensH)));
      updateUI(); redraw(); commit('レンズ高');
    });

    // イントレ台。台を変えると載っているカメラが追従する
    ['platName', 'platX', 'platY', 'platW', 'platD', 'platH'].forEach(id => $(id).addEventListener('change', () => {
      const p = CB.getSelectedPlatform(); if (!p) return;
      p.name = $('platName').value || p.name;
      p.x = num('platX', p.x); p.y = num('platY', p.y);
      p.w = Math.max(100, num('platW', p.w)); p.d = Math.max(100, num('platD', p.d)); p.h = Math.max(0, num('platH', p.h));
      CB.syncAll();
      updateUI(); redraw(); commit('イントレ変更');
    }));

    $('camFovProj').addEventListener('change', e => { showFovProjection = e.target.checked; updateUI(true); redraw(); commit('画角内表示'); });
  }

  function summaryText(cam, a) {
    const { aim, sim } = a;
    let t = CA.generateSummaryText(cam, aim, sim, window.seats.length);
    if (aim.status === 'tele_limit') t += '\n・⚠️ 望遠端に到達 (これ以上寄れません)';
    if (aim.status === 'wide_limit') t += '\n・⚠️ 広角端に到達 (被写体が画角に収まりません)';
    return t;
  }

  /** イントレ台の欄 (カメラが0台でも更新する) */
  function updatePlatformUI(light) {
    const plats = CB.getPlatforms(), cam = CB.getSelected(), p = CB.getSelectedPlatform();
    if (!light) {
      U.fillSelect('platSelect', plats.length ? plats.map(x => ({ value: x.id, label: x.name + ' (' + CB.camerasOn(x.id).length + '台)' })) : [{ value: '', label: '※ 台がありません' }], p ? p.id : '');
      U.fillSelect('camPlatform', [{ value: '', label: '台なし (床置き三脚)' }].concat(plats.map(x => ({ value: x.id, label: x.name }))), cam ? (cam.platformId || '') : '');
    }
    ['platSelect', 'platName', 'platX', 'platY', 'platW', 'platD', 'platH', 'btnAlignLastRow', 'btnDelPlat'].forEach(id => { $(id).disabled = !p; });
    $('camPlatform').disabled = !cam;
    if (!p) { ['platName', 'platX', 'platY', 'platW', 'platD', 'platH'].forEach(id => { $(id).value = ''; }); $('platCamList').textContent = ''; return; }
    $('platSelect').value = p.id;
    $('platName').value = p.name;
    $('platX').value = Math.round(p.x); $('platY').value = Math.round(p.y);
    $('platW').value = Math.round(p.w); $('platD').value = Math.round(p.d); $('platH').value = Math.round(p.h);
    const on = CB.camerasOn(p.id);
    $('platCamList').textContent = on.length ? '載っているカメラ: ' + on.map(c => c.name).join(' / ') : '載っているカメラはありません';
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

    updatePlatformUI(light);
    const ids = ['camSelect', 'camModel', 'camShotType', 'camFraming', 'camTargetGuest', 'camFovSlider', 'camPanSlider', 'camTiltSlider', 'camX', 'camY', 'camH', 'camPlatform', 'btnDeleteCam'];
    ids.forEach(id => { $(id).disabled = !cam; });
    $('camFovProj').checked = showFovProjection;

    const box = $('camSummary');
    if (!cam) { box.textContent = 'カメラがありません。「＋ 追加」で作成できます。'; box.className = 'readout'; $('camSliceInfo').innerText = ''; return; }

    const a = analyze(cam);                           // ここで cam.fov が自動ショットの値に更新される
    $('camSelect').value = cam.id;
    $('camModel').value = cam.model || 'eng_std';
    $('camShotType').value = cam.shotType || 'stage_ff';
    $('camX').value = Math.round(cam.x); $('camY').value = Math.round(cam.y); $('camH').value = Math.round(cam.lensH);
    $('camPlatform').value = cam.platformId || '';

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
    const selCam = CB.getSelected(), selId = (selCam || {}).id, showFov = window.displaySettings.showCamFov;

    // イントレ台 (カメラとは独立。先に描いて、カメラをその上に重ねる)
    const selPlatId = CB.getSelectedPlatformId();
    CB.getPlatforms().forEach(p => {
      const sel = p.id === selPlatId;
      ctx.save();
      ctx.fillStyle = sel ? 'rgba(236,72,153,0.25)' : 'rgba(203,213,225,0.4)';
      ctx.strokeStyle = sel ? '#ec4899' : '#64748b';
      ctx.lineWidth = sel ? 30 : 20;
      ctx.fillRect(p.x - p.w / 2, p.y - p.d / 2, p.w, p.d);
      ctx.strokeRect(p.x - p.w / 2, p.y - p.d / 2, p.w, p.d);
      ctx.restore();
      T(ctx, p.name + ' (H:' + Math.round(p.h) + ')', p.x + p.w / 2 + 150, p.y, { px: 10, align: 'left', color: sel ? '#be185d' : '#64748b' });
    });
    if (!cams.length) return;

    cams.forEach(cam => {
      const a = analyze(cam), sel = cam.id === selId;
      const pd = (CB.getPlatformOf(cam) || { d: 1000 }).d;

      ctx.save();

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

  /** 立面: イントレ台と載っているカメラ本体、選択カメラの垂直画角の上端/下端レイ・角度表示。横軸=Y */
  function drawSide(ctx) {
    const T = window.Core.drawText;
    const cam = CB.getSelected();
    const selPlatId = CB.getSelectedPlatformId();
    const DEG = 180 / Math.PI;

    // イントレ台 (独立したオブジェクト)
    CB.getPlatforms().forEach(p => {
      const sel = p.id === selPlatId;
      ctx.save();
      ctx.fillStyle = sel ? 'rgba(236,72,153,0.55)' : 'rgba(148,163,184,0.45)';
      ctx.strokeStyle = sel ? '#be185d' : '#64748b'; ctx.lineWidth = 20;
      if (p.h > 0) { ctx.fillRect(p.y - p.d / 2, -p.h, p.d, p.h); ctx.strokeRect(p.y - p.d / 2, -p.h, p.d, p.h); }
      else { ctx.beginPath(); ctx.moveTo(p.y - p.d / 2, 0); ctx.lineTo(p.y + p.d / 2, 0); ctx.stroke(); }
      ctx.restore();
      T(ctx, p.name + ' (H:' + Math.round(p.h) + ')', p.y, -p.h - 200, { px: 10, color: sel ? '#be185d' : '#64748b' });
    });

    // 選択中以外のカメラ: 三脚と本体だけ (画角線は描かない)
    CB.getAll().forEach(c => {
      if (cam && c.id === cam.id) return;
      const p = CB.getPlatformOf(c), base = p ? p.h : 0, ca = analyze(c);
      ctx.save();
      ctx.strokeStyle = '#94a3b8'; ctx.lineWidth = 25;
      ctx.beginPath(); ctx.moveTo(c.y, -base); ctx.lineTo(c.y, -c.lensH); ctx.stroke();
      ctx.restore();
      const tilt = ca ? Math.atan2(ca.aim.targetZ - c.lensH, Math.max(Math.hypot(ca.aim.targetX - c.x, ca.aim.targetY - c.y), 1)) : 0;
      drawCameraSide(ctx, c.y, c.lensH, tilt, ca && Math.sin(ca.aim.hAngle) >= 0 ? 1 : -1, false);
    });

    if (!cam) return;
    const a = analyze(cam);
    const lensH = cam.lensH || 1650;
    const camBase = (CB.getPlatformOf(cam) || { h: 0 }).h;

    ctx.save();
    ctx.strokeStyle = '#64748b'; ctx.lineWidth = 30;
    ctx.beginPath(); ctx.moveTo(cam.y, -camBase); ctx.lineTo(cam.y, -lensH); ctx.stroke();

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
    const cams = CB.getAll(), plats = CB.getPlatforms();
    if (view === 'side') {                       // 立面: 選択中カメラのレンズ → 台。奥行き(Y)方向に動かせる
      const c = CB.getSelected();
      if (c && Math.hypot(wx - c.y, wy - (c.lensH || 0)) < 400) return { type: 'camera', id: c.id, offX: wx - c.y, offY: 0 };
      for (let i = plats.length - 1; i >= 0; i--) {
        const p = plats[i];
        if (Math.abs(wx - p.y) <= p.d / 2 && wy >= -100 && wy <= (p.h || 0) + 100) return { type: 'platform', id: p.id, offX: wx - p.y, offY: 0 };
      }
      return null;
    }
    for (let i = cams.length - 1; i >= 0; i--) {         // 平面: カメラ本体を先に判定 → なければ台
      const c = cams[i];
      if (Math.hypot(wx - c.x, wy - c.y) < 450) return { type: 'camera', id: c.id, offX: wx - c.x, offY: wy - c.y };
    }
    for (let i = plats.length - 1; i >= 0; i--) {
      const p = plats[i];
      if (Math.abs(wx - p.x) <= p.w / 2 && Math.abs(wy - p.y) <= p.d / 2) return { type: 'platform', id: p.id, offX: wx - p.x, offY: wy - p.y };
    }
    return null;
  }

  function onGrab(item) {
    if (item.type === 'platform') CB.setSelectedPlatformId(item.id);
    else CB.setSelectedId(item.id);
    updateUI();
    window.Core.switchTab('camera');
    redraw();
  }

  function handleDrag(item, wx, wy, view) {
    if (item.type === 'platform') {                       // 台を動かす → 載っているカメラも一緒に動く
      const p = CB.getPlatformById(item.id);
      if (!p) return;
      if (view === 'top') CB.movePlatformTo(p, wx - item.offX, wy - item.offY);
      else CB.movePlatformTo(p, p.x, wx - item.offX);
    } else {                                              // カメラ: 台に載っていれば台の上だけで動く
      const c = CB.getById(item.id);
      if (!c) return;
      if (view === 'top') CB.moveCameraTo(c, wx - item.offX, wy - item.offY);
      else CB.moveCameraTo(c, c.x, wx - item.offX);
    }
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
