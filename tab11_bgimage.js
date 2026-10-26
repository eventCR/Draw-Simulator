/**
 * ==============================================================================
 * tab11_bgimage.js — 【図面挿入】下絵 (背景図面)
 *
 * ・平面図の最前面に半透明で重ねる (drawOverlay)。旧版は呼び出し口が無く一度も描画されなかった。
 * ・ドラッグ移動モードが OFF の間はクリックを素通しし、下の席・機材を操作できる。
 * ・画像は保存ファイルには埋め込むが、Undo 履歴には ID だけを積む (履歴のメモリ肥大を避けるため)。
 * ==============================================================================
 */
(function () {
  'use strict';

  const U = window.Core.util;
  const { $ } = U;
  const commit = (l) => window.Core.commit(l);
  const redraw = () => window.Core.requestRender();

  const DEFAULT_PROPS = { visible: true, opacity: 0.4, x: 0, y: 0, baseW: 10000, baseD: 10000, scalePct: 100, angle: 0, dragMode: false };
  let props = Object.assign({}, DEFAULT_PROPS);

  // 読み込み済み画像: id → { img, src }  (Undo で過去の画像へ戻れるよう保持)
  const images = new Map();
  let imageSeq = 0;
  let currentImageId = null;
  const currentImg = () => (currentImageId && images.get(currentImageId)) ? images.get(currentImageId).img : null;

  function registerImage(src, cb) {
    const img = new Image();
    img.onload = () => {
      const id = 'img' + (++imageSeq);
      images.set(id, { img, src });
      cb(id, img);
    };
    img.onerror = () => window.debugBox && window.debugBox.error('下絵画像を読み込めませんでした');
    img.src = src;
  }

  // ---------------------------------------------------------------- UI
  function buildUI(panel) {
    if (!panel) return;
    panel.innerHTML = `
      <div class="ui-group">
        <div class="ui-group-title"><span>図面ファイル</span><button class="btn-action sm" id="bgClear">✕ 削除</button></div>
        <div class="ui-row">
          <input type="file" id="bgImageInput" accept="image/*">
          <label class="chk"><input type="checkbox" id="bgVisible"> 表示</label>
        </div>
      </div>
      <div class="ui-group">
        <div class="ui-group-title">透明度 <b id="bgOpacityVal">40%</b></div>
        <input type="range" id="bgOpacity" min="0.05" max="1" step="0.05">
      </div>
      <div class="ui-group">
        <div class="ui-group-title"><span>拡大・縮小 (比率固定)</span><b id="bgScaleVal">100%</b></div>
        <input type="range" id="bgScaleSlider" min="10" max="1000" step="1">
        <div class="ui-row">
          <button class="btn-action sm" id="bgScaleM" style="flex:1">-5%</button>
          <button class="btn-action sm" id="bgScaleP" style="flex:1">+5%</button>
          <button class="btn-action sm" id="bgScale100" style="flex:1">100%</button>
          <button class="btn-action sm" id="bgFit" style="flex:1">全体化</button>
        </div>
      </div>
      <div class="ui-group">
        <div class="ui-group-title"><span>回転角度</span><b id="bgAngleVal">0°</b></div>
        <input type="range" id="bgAngleSlider" min="-180" max="180" step="1">
        <div class="ui-row">
          <button class="btn-action sm" id="bgAngleM90" style="flex:1">-90°</button>
          <button class="btn-action sm" id="bgAngleP90" style="flex:1">+90°</button>
          <button class="btn-action sm" id="bgAngleM1" style="flex:1">-1°</button>
          <button class="btn-action sm" id="bgAngleP1" style="flex:1">+1°</button>
        </div>
      </div>
      <div class="ui-group">
        <div class="ui-group-title">図面の位置合わせ (ドラッグ)</div>
        <button class="btn-action" id="btnBgDrag">🖐️ 図面ドラッグ移動モード: OFF</button>
        <div class="hint">ONにすると図面をマウスで動かせます。OFFの間は図面を素通しして、下の席や機材を操作できます。</div>
      </div>`;
    bind();
    syncUI();
  }

  function bind() {
    $('bgImageInput').addEventListener('change', e => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = ev => registerImage(ev.target.result, (id, img) => {
        currentImageId = id;
        props.baseW = window.room.w;
        props.baseD = Math.round(window.room.w * (img.naturalHeight / img.naturalWidth));
        Object.assign(props, { scalePct: 100, angle: 0, x: 0, y: 0 });
        syncUI(); redraw(); commit('下絵を読み込み');
      });
      reader.readAsDataURL(file);
    });
    $('bgClear').addEventListener('click', () => {
      currentImageId = null;
      $('bgImageInput').value = '';
      syncUI(); redraw(); commit('下絵を削除');
    });
    $('bgVisible').addEventListener('change', e => { props.visible = e.target.checked; redraw(); commit('下絵の表示'); });

    $('bgOpacity').addEventListener('input', e => { props.opacity = parseFloat(e.target.value) || 0.4; syncUI(); redraw(); });
    $('bgOpacity').addEventListener('change', () => commit('下絵の透明度'));

    const setScale = (v, done) => { props.scalePct = Math.max(10, Math.min(1000, parseFloat(v) || 100)); syncUI(); redraw(); if (done) commit('下絵の拡大率'); };
    $('bgScaleSlider').addEventListener('input', e => setScale(e.target.value, false));
    $('bgScaleSlider').addEventListener('change', () => commit('下絵の拡大率'));
    $('bgScaleM').addEventListener('click', () => setScale(props.scalePct - 5, true));
    $('bgScaleP').addEventListener('click', () => setScale(props.scalePct + 5, true));
    $('bgScale100').addEventListener('click', () => setScale(100, true));
    $('bgFit').addEventListener('click', () => {
      if (!currentImg()) return;
      Object.assign(props, { x: 0, y: 0, scalePct: 100, angle: 0 });
      syncUI(); redraw(); commit('下絵を全体化');
    });

    const setAngle = (v, done) => {
      let a = parseFloat(v) || 0;
      while (a > 180) a -= 360;
      while (a < -180) a += 360;
      props.angle = a; syncUI(); redraw(); if (done) commit('下絵の回転');
    };
    $('bgAngleSlider').addEventListener('input', e => setAngle(e.target.value, false));
    $('bgAngleSlider').addEventListener('change', () => commit('下絵の回転'));
    [['bgAngleM90', -90], ['bgAngleP90', 90], ['bgAngleM1', -1], ['bgAngleP1', 1]].forEach(([id, d]) =>
      $(id).addEventListener('click', () => setAngle(props.angle + d, true)));

    $('btnBgDrag').addEventListener('click', () => { props.dragMode = !props.dragMode; syncUI(); redraw(); });
  }

  function syncUI() {
    if (!$('bgVisible')) return;
    $('bgVisible').checked = props.visible;
    $('bgOpacity').value = props.opacity;
    $('bgOpacityVal').innerText = Math.round(props.opacity * 100) + '%';
    $('bgScaleSlider').value = props.scalePct;
    $('bgScaleVal').innerText = Math.round(props.scalePct) + '%';
    $('bgAngleSlider').value = props.angle;
    $('bgAngleVal').innerText = Math.round(props.angle) + '°';
    const b = $('btnBgDrag');
    b.innerText = '🖐️ 図面ドラッグ移動モード: ' + (props.dragMode ? 'ON' : 'OFF');
    b.classList.toggle('active', props.dragMode);
    window.tabBgimageModule.hitFirst = props.dragMode;           // ドラッグ中は他の物より優先して掴む
  }

  // ---------------------------------------------------------------- 描画 / ドラッグ
  const size = () => ({ w: props.baseW * props.scalePct / 100, d: props.baseD * props.scalePct / 100 });

  /** 平面図の最前面に重ねる */
  function drawOverlay(ctx, view) {
    const img = currentImg();
    if (view !== 'top' || !img || !props.visible) return;
    const s = size();
    ctx.save();
    ctx.globalAlpha = props.opacity;
    ctx.translate(props.x + s.w / 2, props.y + s.d / 2);
    if (props.angle) ctx.rotate(props.angle * Math.PI / 180);
    ctx.drawImage(img, -s.w / 2, -s.d / 2, s.w, s.d);
    if (props.dragMode) {
      ctx.globalAlpha = 1;
      ctx.strokeStyle = '#2563eb'; ctx.lineWidth = 35; ctx.setLineDash([120, 60]);
      ctx.strokeRect(-s.w / 2, -s.d / 2, s.w, s.d);
    }
    ctx.restore();
  }

  function hitTest(wx, wy, view) {
    if (view !== 'top' || !props.dragMode || !currentImg() || !props.visible) return null;
    const s = size(), cx = props.x + s.w / 2, cy = props.y + s.d / 2, r = -props.angle * Math.PI / 180;
    const lx = Math.cos(r) * (wx - cx) - Math.sin(r) * (wy - cy);
    const ly = Math.sin(r) * (wx - cx) + Math.cos(r) * (wy - cy);
    return (Math.abs(lx) <= s.w / 2 && Math.abs(ly) <= s.d / 2) ? { offX: wx - props.x, offY: wy - props.y } : null;
  }

  function handleDrag(item, wx, wy) {
    props.x = Math.round(wx - item.offX);
    props.y = Math.round(wy - item.offY);
  }

  // ---------------------------------------------------------------- 保存 / 復元
  function exportData(opts) {
    const d = { bgProps: Object.assign({}, props) };
    if (!currentImageId) return d;
    if (opts && opts.forHistory) d.imageId = currentImageId;          // 履歴には ID のみ
    else d.imageSrc = images.get(currentImageId).src;                 // 保存ファイルには画像本体
    return d;
  }

  function importData(d) {
    if (!d) return;
    props = Object.assign({}, DEFAULT_PROPS, d.bgProps || {});
    if (d.imageId && images.has(d.imageId)) {
      currentImageId = d.imageId;
    } else if (d.imageSrc) {
      const existing = [...images.entries()].find(([, v]) => v.src === d.imageSrc);
      if (existing) currentImageId = existing[0];
      else registerImage(d.imageSrc, (id) => { currentImageId = id; redraw(); });
    } else {
      currentImageId = null;
    }
    syncUI();
  }

  window.tabBgimageModule = { init: buildUI, drawOverlay, hitTest, handleDrag, exportData, importData, syncUI, hitFirst: false };
  window.tabBgImageModule = window.tabBgimageModule;       // 旧綴りの別名
  window.Core.register('bgimage', window.tabBgimageModule, { order: 5 });
})();
