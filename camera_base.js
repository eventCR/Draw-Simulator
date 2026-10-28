/**
 * ==============================================================================
 * camera_base.js — カメラ機材仕様 / 台数管理 / イントレ台(プラットフォーム)の独立管理
 *
 * 状態 (cameras, platforms, selectedId, selectedPlatformId) の唯一の持ち主。
 * tab7_camera.js は UI と描画を担当する。
 *
 * ■ カメラとイントレは別オブジェクト。1つの台に複数台のカメラを載せられる。
 *   platform { id, name, x, y (台の中心), w, d, h (台の天板の高さ) }
 *   camera   { id, name, model, shotType, fov, pan, tilt, framing, targetGuestId,
 *              platformId  載せている台の id (null/'' = 台なし・床置きの三脚),
 *              ox, oy      台の中心からのずれ (mm)    ※台ありのとき
 *              lensAbove   台の天板からレンズ中心までの高さ (mm) ※台ありのとき
 *              x, y, lensH 絶対位置 (計算・描画・計測はこの値を使う) }
 *   台ありのカメラの x, y, lensH は syncFromPlatform() が台から導出する。
 *   台を動かす/高さを変える → syncAll() で全カメラが追従する。
 *
 * ■ 保存形式: { list, platforms, selectedId, selectedPlatformId }
 *   旧形式 (カメラごとに platW/platD/platH を持つ) は読み込み時に台を自動生成して移行する。
 * ==============================================================================
 */
window.CameraBase = (function () {
  'use strict';

  const CAMERA_MODELS = {
    nx5r:     { name: 'Sony HXR-NX5R (光学20倍)', sensor: '1/2.8型 3CMOS', zoom: '光学20倍', minFov: 3.6, maxFov: 64.5 },
    eng_std:  { name: 'ENG 2/3型 標準22倍', sensor: '2/3型', zoom: '光学22倍', minFov: 2.8, maxFov: 58.0 },
    eng_ext:  { name: 'ENG 2/3型 (2x Ext)', sensor: '2/3型 (2x エクステンダー内蔵)', zoom: '光学44倍相当', minFov: 1.4, maxFov: 30.0 },
    box_tele: { name: '大型ボックス40倍 (超望遠)', sensor: '2/3型', zoom: '光学40倍', minFov: 0.8, maxFov: 40.0 },
    manual:   { name: 'マニュアル (広角〜望遠)', sensor: '汎用', zoom: 'マニュアル', minFov: 0.5, maxFov: 120.0 }
  };

  const SHOT_TYPES = {
    stage_ff: 'ステージ全景',
    guest_group: '登壇者集合',
    guest_single: '単一登壇者',
    manual_angle: '手動アングル'
  };

  const DEFAULT_LENS_ABOVE = 1300;     // 台の天板から三脚・カメラ上のレンズ中心までの標準高さ (mm)

  const clone = (v) => JSON.parse(JSON.stringify(v));

  /** 新規カメラの雛形。overrides で上書き */
  function makeCamera(id, name, overrides) {
    return Object.assign({
      id, name,
      model: 'nx5r',
      x: 7000, y: 19000, z: 0,
      lensH: 1700,
      platformId: '', ox: 0, oy: 0, lensAbove: DEFAULT_LENS_ABOVE,
      pan: 0, tilt: 0, fov: 40,
      shotType: 'stage_ff',
      framing: 'FF',
      targetGuestId: ''
    }, overrides || {});
  }

  function makePlatform(id, name, overrides) {
    return Object.assign({ id, name, x: 7000, y: 19000, w: 1000, d: 1000, h: 400 }, overrides || {});
  }

  // 既定: EQWEL 仕様のレイアウト (客席後方) に合わせた位置・機種。カメラ1台 + 台(高さ0 = 床置き)
  let platforms = [makePlatform('PL1', 'イントレ 1', { x: 8600, y: 11267, w: 1000, d: 1000, h: 0 })];
  let cameras = [makeCamera('CAM1', 'CAM 1', {
    model: 'eng_std', x: 8600, y: 11267, lensH: 1850, fov: 22.7, targetGuestId: 'G1',
    platformId: 'PL1', ox: 0, oy: 0, lensAbove: 1850
  })];
  let selectedId = 'CAM1';
  let selectedPlatformId = 'PL1';

  // ---------------------------------------------------------------- 取得
  function getAll() { return cameras; }
  function getById(id) { return cameras.find(c => c.id === id) || null; }
  function getSelected() { return getById(selectedId) || cameras[0] || null; }
  function getSelectedId() { return selectedId; }
  function setSelectedId(id) {
    selectedId = id;
    const c = getById(id);
    if (c && c.platformId && getPlatformById(c.platformId)) selectedPlatformId = c.platformId;   // 台の選択も追従
  }

  function getPlatforms() { return platforms; }
  function getPlatformById(id) { return platforms.find(p => p.id === id) || null; }
  function getPlatformOf(cam) { return cam && cam.platformId ? getPlatformById(cam.platformId) : null; }
  function getSelectedPlatform() { return getPlatformById(selectedPlatformId) || null; }
  function getSelectedPlatformId() { return selectedPlatformId; }
  function setSelectedPlatformId(id) { selectedPlatformId = getPlatformById(id) ? id : null; }
  function camerasOn(platformId) { return cameras.filter(c => c.platformId === platformId); }

  function nextId(list, prefix) {
    let n = list.length + 1;
    while (list.some(c => c.id === prefix + n)) n++;
    return { id: prefix + n, num: n };
  }

  // ---------------------------------------------------------------- 台 → カメラの位置を導出
  function syncFromPlatform(cam) {
    const p = getPlatformOf(cam);
    if (!p) return;
    cam.x = Math.round(p.x + (cam.ox || 0));
    cam.y = Math.round(p.y + (cam.oy || 0));
    cam.lensH = Math.round(p.h + (typeof cam.lensAbove === 'number' ? cam.lensAbove : DEFAULT_LENS_ABOVE));
  }
  function syncAll() { cameras.forEach(syncFromPlatform); }

  /** カメラを絶対位置 (x,y) へ動かす。台ありなら台の範囲内に収め、ずれ (ox,oy) として記録する */
  function moveCameraTo(cam, x, y) {
    const p = getPlatformOf(cam);
    if (!p) { cam.x = Math.round(x); cam.y = Math.round(y); return; }
    cam.ox = Math.max(-p.w / 2, Math.min(p.w / 2, x - p.x));
    cam.oy = Math.max(-p.d / 2, Math.min(p.d / 2, y - p.y));
    syncFromPlatform(cam);
  }

  /** カメラのレンズ高 (絶対) を設定する。台ありなら天板からの高さとして記録する */
  function setLensHeight(cam, z) {
    const p = getPlatformOf(cam);
    if (p) cam.lensAbove = Math.max(0, z - p.h);
    cam.lensH = Math.round(z);
    if (p) syncFromPlatform(cam);
  }

  /** 台を動かす (載っているカメラも追従) */
  function movePlatformTo(p, x, y) {
    p.x = Math.round(x); p.y = Math.round(y);
    syncAll();
  }

  /** 台の上のカメラを台の幅に沿って等間隔に並べる (複数台載せたときの重なり解消) */
  function distributeOnPlatform(platformId) {
    const p = getPlatformById(platformId);
    if (!p) return;
    const list = camerasOn(platformId), n = list.length;
    list.forEach((c, i) => {
      c.ox = n === 1 ? 0 : Math.round(((i + 0.5) / n - 0.5) * p.w * 0.8);
      c.oy = 0;
    });
    syncAll();
  }

  /** カメラを載せる台を切り替える (''=台なし)。レンズの絶対高さは変えない */
  function assignCamera(cam, platformId) {
    if (!cam) return;
    const p = getPlatformById(platformId);
    if (!p) {                                    // 台なし: 今の絶対位置のまま床置き三脚にする
      cam.platformId = '';
      return;
    }
    const lens = cam.lensH || (p.h + DEFAULT_LENS_ABOVE);
    cam.platformId = p.id;
    cam.lensAbove = lens - p.h >= 300 ? lens - p.h : DEFAULT_LENS_ABOVE;
    distributeOnPlatform(p.id);
  }

  // ---------------------------------------------------------------- 追加 / 削除
  function addPlatform(roomW, stageY, stageD) {
    const { id, num } = nextId(platforms, 'PL');
    const p = makePlatform(id, 'イントレ ' + num, {
      x: Math.round((roomW || 14000) / 2),
      y: Math.round((stageY || 1200) + (stageD || 3000) + 10000)
    });
    platforms.push(p);
    selectedPlatformId = p.id;
    return p;
  }

  /** カメラを追加。台を選択中ならその台に載せる (複数台)。台が無ければ新しい台も作る */
  function addCamera(roomW, stageY, stageD) {
    let plat = getSelectedPlatform();
    if (!plat) plat = addPlatform(roomW, stageY, stageD);
    const { id, num } = nextId(cameras, 'CAM');
    const cam = makeCamera(id, 'CAM ' + num, { platformId: plat.id, lensAbove: DEFAULT_LENS_ABOVE });
    cameras.push(cam);
    distributeOnPlatform(plat.id);
    selectedId = cam.id;
    selectedPlatformId = plat.id;
    return cam;
  }

  function deleteSelected() {
    cameras = cameras.filter(c => c.id !== selectedId);
    selectedId = cameras.length ? cameras[0].id : null;
    const c = getById(selectedId);
    if (c && c.platformId) selectedPlatformId = c.platformId;
    platforms.forEach(p => distributeOnPlatform(p.id));
  }

  /** 台を削除。載っていたカメラは今の位置・高さのまま「台なし」になる */
  function deletePlatform(id) {
    cameras.forEach(c => { if (c.platformId === id) c.platformId = ''; });
    platforms = platforms.filter(p => p.id !== id);
    if (selectedPlatformId === id) selectedPlatformId = platforms.length ? platforms[0].id : null;
  }

  /** 客席最後尾から dist(mm) 後方に台 (台なしのカメラなら本体) を置く */
  function alignFromLastRow(target, dist, seats, chairD) {
    if (!target) return;
    const d = parseFloat(dist) || 2000;
    const list = Array.isArray(seats) ? seats : [];
    const lastRowY = list.length ? Math.max.apply(null, list.map(s => s.y)) + (chairD || 480) / 2 : 15000;
    if (target.w !== undefined && target.d !== undefined) {          // 台
      target.y = Math.round(lastRowY + d + (target.d || 1000) / 2);
      syncAll();
    } else {                                                          // 台なしカメラ
      target.y = Math.round(lastRowY + d + 500);
    }
  }

  /**
   * 基準からの距離で Y を決める。距離は「基準 → 台(カメラ)の最も近い辺」まで。
   *   lastRow    : 最後尾席の後ろ脚 → 台の前辺 (ステージ側の辺)
   *   backWall   : 会場の後壁       → 台の後辺 (壁側の辺)
   *   stageFront : ステージ前縁     → 台の前辺
   * env: { seats, chairD, room, stage }
   */
  function alignFromRef(target, ref, dist, env) {
    if (!target) return;
    env = env || {};
    const d = parseFloat(dist); const dd = isFinite(d) ? d : 0;
    const isPlat = target.w !== undefined && target.d !== undefined;
    const half = isPlat ? (target.d || 1000) / 2 : 500;
    let y;
    if (ref === 'backWall') {
      const pts = (env.room && env.room.points) || [];
      const back = pts.length ? Math.max.apply(null, pts.map(p => p.y)) : ((env.room && env.room.d) || 20000);
      y = back - dd - half;
    } else if (ref === 'stageFront') {
      const st = env.stage || { y: 0, d: 0 };
      y = st.y + st.d + dd + half;
    } else {
      const list = Array.isArray(env.seats) ? env.seats : [];
      const lastRowY = list.length ? Math.max.apply(null, list.map(q => q.y)) + (env.chairD || 480) / 2 : 15000;
      y = lastRowY + dd + half;
    }
    target.y = Math.round(y);
    if (isPlat) syncAll();
  }

  // ---------------------------------------------------------------- 保存 / 復元
  function exportData() {
    return { list: clone(cameras), platforms: clone(platforms), selectedId, selectedPlatformId };
  }

  function importData(data) {
    const arr = Array.isArray(data) ? data : (data && Array.isArray(data.list) ? data.list : []);
    const rawPlats = (data && !Array.isArray(data) && Array.isArray(data.platforms)) ? clone(data.platforms) : null;

    platforms = (rawPlats || []).map((p, i) => makePlatform(p.id || 'PL' + (i + 1), p.name || 'イントレ ' + (i + 1), p));
    cameras = clone(arr).map((c, i) => makeCamera(c.id || 'CAM' + (i + 1), c.name || 'CAM ' + (i + 1), c));

    // 旧形式の移行: カメラごとの platW/platD/platH から台を作り、台ありのカメラにする
    cameras.forEach(c => {
      const legacy = (c.platW !== undefined || c.platD !== undefined || c.platH !== undefined) && !c.platformId && !rawPlats;
      if (legacy) {
        const { id, num } = nextId(platforms, 'PL');
        const ph = Number.isFinite(c.platH) ? c.platH : 0;
        platforms.push(makePlatform(id, 'イントレ ' + num, {
          x: c.x, y: c.y, w: Number.isFinite(c.platW) ? c.platW : 1000, d: Number.isFinite(c.platD) ? c.platD : 1000, h: ph
        }));
        c.platformId = id; c.ox = 0; c.oy = 0;
        c.lensAbove = Math.max(0, (c.lensH || 1700) - ph);
      }
      delete c.platW; delete c.platD; delete c.platH;
      if (c.platformId && !platforms.some(p => p.id === c.platformId)) c.platformId = '';   // 台が見つからない
    });
    syncAll();

    const want = (data && !Array.isArray(data)) ? data.selectedId : selectedId;
    selectedId = cameras.some(c => c.id === want) ? want : (cameras[0] ? cameras[0].id : null);
    const wantP = (data && !Array.isArray(data)) ? data.selectedPlatformId : null;
    const sc = getById(selectedId);
    selectedPlatformId = platforms.some(p => p.id === wantP) ? wantP
      : (sc && sc.platformId ? sc.platformId : (platforms[0] ? platforms[0].id : null));
  }

  return {
    CAMERA_MODELS, SHOT_TYPES, DEFAULT_LENS_ABOVE, makeCamera, makePlatform,
    getAll, getById, getSelected, getSelectedId, setSelectedId,
    getPlatforms, getPlatformById, getPlatformOf, getSelectedPlatform, getSelectedPlatformId, setSelectedPlatformId, camerasOn,
    syncFromPlatform, syncAll, moveCameraTo, setLensHeight, movePlatformTo, distributeOnPlatform, assignCamera,
    addCamera, addPlatform, deleteSelected, deletePlatform, alignFromLastRow, alignFromRef,
    exportData, importData
  };
})();
