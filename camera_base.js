/**
 * ==============================================================================
 * camera_base.js — カメラ機材仕様 / 台数管理 / 台座(イントレ)配置データ
 *
 * 状態 (cameras, selectedId) の唯一の持ち主。tab7_camera.js は UI と描画を担当し、
 * 保存形式 {list, selectedId} はここで一元管理する。
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

  /** 新規カメラの雛形。overrides で上書き */
  function makeCamera(id, name, overrides) {
    return Object.assign({
      id, name,
      model: 'nx5r',
      x: 7000, y: 19000, z: 0,
      lensH: 1700,
      platW: 1000, platD: 1000, platH: 400,
      pan: 0, tilt: 0, fov: 40,
      shotType: 'stage_ff',
      framing: 'FF',
      targetGuestId: ''
    }, overrides || {});
  }

  // 既定カメラ: EQWEL 仕様のレイアウト (客席後方) に合わせた位置・機種
  let cameras = [makeCamera('CAM1', 'CAM 1', {
    model: 'eng_std', x: 8600, y: 11267, lensH: 1850, platH: 0, fov: 22.7, targetGuestId: 'G1'
  })];
  let selectedId = 'CAM1';

  const clone = (v) => JSON.parse(JSON.stringify(v));

  function getAll() { return cameras; }
  function getById(id) { return cameras.find(c => c.id === id) || null; }
  function getSelected() { return getById(selectedId) || cameras[0] || null; }
  function getSelectedId() { return selectedId; }
  function setSelectedId(id) { selectedId = id; }

  /** 既存IDと重ならない次の ID (CAM2, CAM3 …) */
  function nextId() {
    let n = cameras.length + 1;
    while (cameras.some(c => c.id === 'CAM' + n)) n++;
    return { id: 'CAM' + n, num: n };
  }

  /** 新規追加して選択状態にする */
  function addCamera(roomW, stageY, stageD) {
    const { id, num } = nextId();
    const cam = makeCamera(id, 'CAM ' + num, {
      x: Math.round((roomW || 14000) / 2),
      y: Math.round((stageY || 1200) + (stageD || 3000) + 10000),
      lensH: 1650
    });
    cameras.push(cam);
    selectedId = cam.id;
    return cam;
  }

  function deleteSelected() {
    cameras = cameras.filter(c => c.id !== selectedId);
    selectedId = cameras.length ? cameras[0].id : null;
  }

  /** 客席最後尾から dist(mm) 後方にカメラ台座を置く */
  function alignFromLastRow(cam, dist, seats, chairD) {
    if (!cam) return;
    const d = parseFloat(dist) || 2000;
    const list = Array.isArray(seats) ? seats : [];
    const lastRowY = list.length ? Math.max.apply(null, list.map(s => s.y)) + (chairD || 480) / 2 : 15000;
    cam.y = Math.round(lastRowY + d + (cam.platD || 1000) / 2);
  }

  /** 保存形式: { list, selectedId } (配列のみの旧形式も受け付ける) */
  function exportData() { return { list: clone(cameras), selectedId }; }

  function importData(data) {
    const arr = Array.isArray(data) ? data : (data && Array.isArray(data.list) ? data.list : []);
    cameras = clone(arr).map((c, i) => makeCamera(c.id || 'CAM' + (i + 1), c.name || 'CAM ' + (i + 1), c));
    const want = (data && !Array.isArray(data)) ? data.selectedId : selectedId;
    selectedId = cameras.some(c => c.id === want) ? want : (cameras[0] ? cameras[0].id : null);
  }

  return {
    CAMERA_MODELS, SHOT_TYPES, makeCamera,
    getAll, getById, getSelected, getSelectedId, setSelectedId,
    addCamera, deleteSelected, alignFromLastRow,
    exportData, importData
  };
})();
