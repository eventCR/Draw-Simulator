/**
 * ==============================================================================
 * tab6_seats.js — 【客席】グリッド配置・個別編集・角度調整
 *
 * 所有する共有データ:
 *   window.seats[]  { id, row, x, y, angle, slot?, gx?, gy? }
 *     slot = 配置上の場所 (列・ブロック・ブロック内位置)、gx/gy = 自動配置が決めた基準位置。
 *     x,y と gx,gy の差が「個別に動かした量」で、席幅・間隔を変えても保たれる。
 *   window.chair    { w, d, h, backH }
 *   window.audienceTorsoH  観客の座高 (腰〜頭頂)    ※登壇者の座高 window.seatedTorsoH (tab4) とは別
 *   window.totalHeadZ      着席時の頭頂高 = chair.h + audienceTorsoH  (カメラの頭被り判定に使用)
 *
 * カメラとの連携: 頭被りの席は tabCameraModule.getBlockedSeatIds() (Set) から取得する。
 * ==============================================================================
 */
(function () {
  'use strict';

  const U = window.Core.util;
  const { $, clone, num } = U;
  const commit = (l) => window.Core.commit(l);
  const redraw = () => window.Core.requestRender();

  window.seats = [];
  window.chair = { w: 500, d: 500, h: 420, backH: 400 };
  window.audienceTorsoH = 850;
  window.totalHeadZ = window.chair.h + window.audienceTorsoH;

  // ---- 客席グループ: 客席1・客席2…を別々の設定 (配置・間隔・テーブル) で持てる
  const DEFAULT_GRID = () => ({
    // すべて「脚の外側」から測る: rowGap=前列の後ろ脚→次列の前脚 / seatGapX=右脚→隣の左脚 / stageDist=ステージ前縁→最前列の前脚
    rows: 5, rowGap: 450, blockCols: '5,10,5', seatGapX: 20, aisleW: 1000, stageDist: 2250, legBased: true,
    offsetX: 0,              // 左右位置: 会場の中央からのずれ (mm。右が +)
    mode: 'normal',          // normal 標準 / stagger 千鳥(1列おきに半席ずらす) / skip 1席おき / checker 市松(1席おき+列ごとに交互)
    growFrom: 4,             // 何列目から増減させるか
    growBy: 0,               // その列から 1列ごとに何席ずつ増減するか (0=なし / 負=減らす)
    growTarget: 'outer'      // 増減させるブロック: outer 両端 / center 中央 / all 全ブロック
  });
  // テーブル: none なし / perSeat 席ごと / shared 長机 (perTable 席で1台。0=ブロック全体)。椅子の前 (ステージ側) に置く
  const DEFAULT_TABLE = () => ({ mode: 'none', w: 600, d: 450, gap: 100, h: 700, perTable: 3 });
  const makeGroup = (id, name, prefix) => ({ id, name, grid: DEFAULT_GRID(), table: DEFAULT_TABLE(), deleted: new Set(), prefix: prefix || '' });
  let groups = [makeGroup('SG1', '客席1', '')];     // 先頭グループの席IDは従来どおり (R1-S1…)
  let selectedGroupId = 'SG1';
  let grid = groups[0].grid;                          // 選択中グループの配置設定
  const curGroup = () => groups.find(g => g.id === selectedGroupId) || groups[0];
  const gidOf = (s) => (s && s.g) || groups[0].id;
  const groupOf = (s) => groups.find(g => g.id === gidOf(s)) || groups[0];
  function selectGroup(id) {
    const g = groups.find(x => x.id === id);
    if (!g) return;
    selectedGroupId = g.id; grid = g.grid;
  }
  // 組込みパターン (変更するのは配置方式・増減だけ。列数や席数などは今の値を保つ)
  const BUILTIN_PATTERNS = [
    { id: 'standard', name: '標準 (全列同じ席数)', grid: { mode: 'normal', growBy: 0 } },
    { id: 'stagger', name: '千鳥 (1列おきに半席ずらす)', grid: { mode: 'stagger', growBy: 0 } },
    { id: 'checker', name: '市松 (1席おき・列ごとに交互)', grid: { mode: 'checker', growBy: 0 } },
    { id: 'skip', name: '1席おき (間引き)', grid: { mode: 'skip', growBy: 0 } },
    { id: 'fan2', name: '4列目から2席ずつ増加 (両端)', grid: { mode: 'normal', growFrom: 4, growBy: 2, growTarget: 'outer' } },
    { id: 'fan2c', name: '4列目から2席ずつ増加 (中央)', grid: { mode: 'normal', growFrom: 4, growBy: 2, growTarget: 'center' } }
  ];
  let myPatterns = [];                  // [{ id, name, grid }] マイパターン (保存ファイルに含まれる)
  let tool = 'select';                  // select | move | delete | add
  const selectedIds = new Set();
  let marquee = null;                   // 範囲選択中 {x0,y0,x1,y1}

  const byId = (id) => window.seats.find(s => s.id === id) || null;
  const selectedSeats = () => window.seats.filter(s => selectedIds.has(s.id));

  function updateHeadZ() { window.totalHeadZ = window.chair.h + window.audienceTorsoH; }

  // ---------------------------------------------------------------- UI
  function buildUI(panel) {
    if (!panel) return;
    panel.innerHTML = `
      <div class="ui-group">
        <div class="ui-group-title"><span>🛠️ ツールモード</span></div>
        <div class="ui-row">
          <button class="btn-action active" data-seat-tool="select" style="flex:1">👆 選択・範囲枠</button>
          <button class="btn-action" data-seat-tool="move" style="flex:1">↔️ 個別ドラッグ</button>
          <button class="btn-action" data-seat-tool="delete" style="flex:1">❌ 1席削除</button>
          <button class="btn-action" data-seat-tool="add" style="flex:1">➕ 1席追加</button>
        </div>
        <div class="hint">選択: クリック / Shiftで追加。<b>押したまま動かすと囲って選べます</b> (席の上からでも、何もない所からでも可。トラックパッドは押し込んだまま動かす)</div>
        <div class="ui-row">
          <button class="btn-action sm" id="btnSelAll" style="flex:1">全選択</button>
          <button class="btn-action sm" id="btnSelNone" style="flex:1">選択解除</button>
        </div>
      </div>

      <div class="ui-group">
        <div class="ui-group-title">椅子寸法 &amp; 観客の頭頂高 (mm)</div>
        <div class="ui-row">
          <div class="input-box"><label>幅(W)</label><input type="number" id="chairW" step="10"></div>
          <div class="input-box"><label>奥行(D)</label><input type="number" id="chairD" step="10"></div>
          <div class="input-box"><label>座面高(H)</label><input type="number" id="chairH" step="10"></div>
          <div class="input-box"><label>背もたれ高</label><input type="number" id="chairBackH" step="10"></div>
        </div>
        <div class="ui-row">
          <div class="input-box"><label>観客の座高 (頭頂まで)</label><input type="number" id="audienceTorsoH" step="10"></div>
          <div class="input-box"><label>前席頭頂高 (Z合計)</label><input type="number" id="totalHeadZ" step="10"></div>
        </div>
      </div>

      <div class="ui-group">
        <div class="ui-group-title">
          <span>🪑 選択座席の角度調整・整列</span>
          <span id="selectedSeatLabel" class="hint">席未選択</span>
        </div>
        <div class="input-box">
          <label>回転角度 (選択中の全席の向きのみ) : <b id="seatAngleVal">0°</b></label>
          <input type="range" id="seatAngleSlider" min="-180" max="180" step="5" value="0">
        </div>
        <div class="ui-row">
          <button class="btn-action" id="btnAngleL" style="flex:1">左斜め (-30°)</button>
          <button class="btn-action" id="btnAngleR" style="flex:1">右斜め (+30°)</button>
        </div>
        <div class="ui-row">
          <button class="btn-action btn-green" id="btnAlignLine" style="flex:1">📏 選択席を1直線に整列</button>
          <button class="btn-action btn-blue" id="btnAimCenter" style="flex:1">🎯 ステージ中央に向ける</button>
        </div>
        <button class="btn-action btn-amber" id="btnSnapY">📌 選択席のY(奥行)を列の位置にスナップ</button>
      </div>

      <div class="ui-group">
        <div class="ui-group-title"><span>👥 客席グループ</span><span class="btn-cluster">
          <button class="btn-action sm" id="btnAddSeatGroup">＋ 客席を追加</button>
          <button class="btn-action sm btn-danger" id="btnDelSeatGroup">削除</button></span></div>
        <div class="ui-row">
          <div class="input-box"><label>編集する客席</label><select id="seatGroupSelect"></select></div>
          <div class="input-box"><label>名称</label><input type="text" id="seatGroupName"></div>
        </div>
        <div class="ui-row">
          <button class="btn-action btn-danger sm" id="btnClearGroupSeats" style="flex:1">🗑️ この客席の席を全削除</button>
          <button class="btn-action btn-danger sm" id="btnClearAllSeats" style="flex:1">🗑️ 全客席の席を全削除</button>
        </div>
        <div class="hint">全削除しても、客席の設定は残ります (「完全に再配置」で席を戻せます)。「元に戻す」でも戻せます。</div>
        <div class="hint">グループごとに、配置・間隔・テーブルを別々に設定できます (例: 客席1=シアター席、客席2=テーブル付きスクール席)。図面の席をクリックすると、その席のグループが編集対象になります。</div>
      </div>

      <div class="ui-group">
        <div class="ui-group-title"><span>グリッド整列 (選択中の客席)</span><span class="badge" id="seatCountBadge">0 席</span></div>
        <div class="ui-row">
          <div class="input-box"><label>行数(Y)</label><input type="number" id="gridRows" min="1"></div>
          <div class="input-box"><label title="前列の後ろ脚 → 次列の前脚">列間隔(Y)<br><small>後脚→次列の前脚</small></label><input type="number" id="gridRowGap" step="50"></div>
          <div class="input-box"><label>構成(X)</label><input type="text" id="gridBlockCols" placeholder="例: 5,10,5"></div>
        </div>
        <div class="ui-row">
          <div class="input-box"><label title="右脚 → 隣の席の左脚">席隙間(X)<br><small>右脚→左脚</small></label><input type="number" id="gridSeatGapX" step="10"></div>
          <div class="input-box"><label>通路幅</label><input type="number" id="gridAisleW" step="100"></div>
          <div class="input-box"><label title="ステージ前縁 → 最前列の前脚">ステージ離隔(Y)<br><small>前縁→最前列の前脚</small></label><input type="number" id="gridStageDist" step="100"></div>
        </div>
        <div class="ui-row">
          <div class="input-box"><label title="会場の中央からのずれ。右が +">左右位置(X)<br><small>中央からのずれ</small></label><input type="number" id="gridOffsetX" step="100"></div>
        </div>
        <div class="ui-row">
          <div class="input-box"><label>配置方式</label>
            <select id="gridMode">
              <option value="normal">標準</option>
              <option value="stagger">千鳥 (1列おきに半席ずらす)</option>
              <option value="checker">市松 (1席おき・列ごとに交互)</option>
              <option value="skip">1席おき (間引き)</option>
            </select></div>
        </div>
        <div class="ui-row">
          <div class="input-box"><label>増減を始める列</label><input type="number" id="gridGrowFrom" min="1"></div>
          <div class="input-box"><label>1列ごとの増減席数</label><input type="number" id="gridGrowBy" step="1"></div>
          <div class="input-box"><label>増減させる所</label>
            <select id="gridGrowTarget">
              <option value="outer">両端ブロック</option>
              <option value="center">中央ブロック</option>
              <option value="all">全ブロック</option>
            </select></div>
        </div>
        <div class="hint">席幅・席隙間・通路幅・列間隔・席数などを変えても、個別に動かした席・角度・削除した席は保たれます。すべてやり直したいときだけ下のボタンを押してください。</div>
        <div class="hint">※「1席おき」「市松」では、席隙間は残った席どうしの隙間です。構成(X)の数は席の位置の数で、実際の席数は約半分になります。</div>
        <div class="hint" id="gridRowSummary"></div>
        <button class="btn-action btn-accent" id="btnRebuildSeats">🔄 完全に再配置 (個別編集をすべてリセット)</button>
      </div>

      <div class="ui-group">
        <div class="ui-group-title"><span>🍽️ テーブル (選択中の客席)</span></div>
        <div class="ui-row">
          <div class="input-box"><label>テーブル</label>
            <select id="tblMode">
              <option value="none">なし</option>
              <option value="perSeat">席ごとに1台</option>
              <option value="shared">長机 (複数席で共有)</option>
            </select></div>
          <div class="input-box" id="tblPerTableBox"><label>1台あたりの席数<br><small>0=ブロック全体</small></label><input type="number" id="tblPerTable" min="0" step="1"></div>
        </div>
        <div class="ui-row">
          <div class="input-box" id="tblWBox"><label>テーブル幅(W)</label><input type="number" id="tblW" step="50"></div>
          <div class="input-box"><label>奥行(D)</label><input type="number" id="tblD" step="50"></div>
          <div class="input-box"><label>天板高(H)</label><input type="number" id="tblH" step="10"></div>
          <div class="input-box"><label title="椅子の前脚 → テーブルの手前の辺">椅子との距離<br><small>前脚→テーブル</small></label><input type="number" id="tblGap" step="10"></div>
        </div>
        <div class="hint">テーブルは椅子の前(ステージ側)に置きます。長机のときの幅は、席の並びに合わせて自動で決まります。</div>
        <div class="hint" id="tblWarn"></div>
      </div>

      <div class="ui-group">
        <div class="ui-group-title">🗂️ 配置パターン (切替・保存)</div>
        <div class="ui-row">
          <div class="input-box"><label>パターン</label><select id="seatPatternSelect"></select></div>
          <button class="btn-action" id="btnPatternApply">適用</button>
          <button class="btn-action btn-danger sm" id="btnPatternDelete">削除</button>
        </div>
        <div class="ui-row">
          <div class="input-box"><label>今の設定をマイパターンに保存</label><input type="text" id="seatPatternName" placeholder="例: 講演会 千鳥"></div>
          <button class="btn-action btn-green" id="btnPatternSave">💾 保存</button>
        </div>
        <div class="hint">組込みは配置方式と増減だけを切り替えます。マイパターンは列数・構成・間隔も含めて保存します。適用すると再配置されます。</div>
      </div>`;
    bind();
    syncUI();
  }

  function bind() {
    document.querySelectorAll('[data-seat-tool]').forEach(b => b.addEventListener('click', () => {
      tool = b.dataset.seatTool;
      document.querySelectorAll('[data-seat-tool]').forEach(x => x.classList.toggle('active', x === b));
    }));

    ['chairW', 'chairD', 'chairH', 'chairBackH'].forEach(id => $(id).addEventListener('change', () => {
      const c = window.chair;
      c.w = Math.max(100, num('chairW', 500)); c.d = Math.max(100, num('chairD', 500));
      c.h = Math.max(100, num('chairH', 420)); c.backH = Math.max(0, num('chairBackH', 400));
      updateHeadZ();
      if (id === 'chairW') relayoutSeats('席幅'); else { syncUI(); redraw(); commit('椅子寸法'); }     // 席幅は並びのピッチに効く
    }));
    $('audienceTorsoH').addEventListener('change', () => {
      window.audienceTorsoH = Math.max(300, num('audienceTorsoH', 850));
      updateHeadZ(); syncUI(); redraw(); commit('観客の座高');
    });
    $('totalHeadZ').addEventListener('change', () => {
      window.totalHeadZ = Math.max(500, num('totalHeadZ', 1270));
      window.audienceTorsoH = Math.max(300, window.totalHeadZ - window.chair.h);
      updateHeadZ(); syncUI(); redraw(); commit('前席頭頂高');
    });

    // グリッド入力: 変更 → 読み取り → 再配置
    const gridIds = { gridRows: 'rows', gridRowGap: 'rowGap', gridBlockCols: 'blockCols', gridSeatGapX: 'seatGapX', gridAisleW: 'aisleW', gridStageDist: 'stageDist' };
    Object.keys(gridIds).forEach(id => $(id).addEventListener('change', () => { readGrid(); relayoutSeats('客席設定'); }));
    $('gridOffsetX').addEventListener('change', () => { readGrid(); relayoutSeats('客席の左右位置'); });
    $('seatGroupSelect').addEventListener('change', e => { selectGroup(e.target.value); selectedIds.clear(); syncUI(); redraw(); });
    $('seatGroupName').addEventListener('change', e => { curGroup().name = e.target.value.trim() || curGroup().name; syncUI(); redraw(); commit('客席名'); });
    $('btnAddSeatGroup').addEventListener('click', addGroup);
    $('btnDelSeatGroup').addEventListener('click', deleteGroup);
    $('btnClearGroupSeats').addEventListener('click', () => clearSeats(false));
    $('btnClearAllSeats').addEventListener('click', () => clearSeats(true));
    ['tblMode', 'tblPerTable', 'tblW', 'tblD', 'tblH', 'tblGap'].forEach(id => $(id).addEventListener('change', () => {
      const t = curGroup().table;
      t.mode = $('tblMode').value; t.perTable = Math.max(0, Math.round(num('tblPerTable', 3)));
      t.w = Math.max(100, num('tblW', 600)); t.d = Math.max(100, num('tblD', 450));
      t.h = Math.max(100, num('tblH', 700)); t.gap = Math.max(0, num('tblGap', 100));
      syncUI(); redraw(); commit('テーブル設定');
    }));
    $('btnRebuildSeats').addEventListener('click', () => { readGrid(); rebuildSeats(); });
    ['gridMode', 'gridGrowFrom', 'gridGrowBy', 'gridGrowTarget'].forEach(id => $(id).addEventListener('change', () => { readGrid(); relayoutSeats('客席設定'); }));

    $('btnPatternApply').addEventListener('click', applyPattern);
    $('btnPatternSave').addEventListener('click', savePattern);
    $('btnPatternDelete').addEventListener('click', deletePattern);
    $('btnSelAll').addEventListener('click', () => { selectedIds.clear(); window.seats.forEach(s => selectedIds.add(s.id)); updateSelectionUI(); redraw(); });
    $('btnSelNone').addEventListener('click', () => { selectedIds.clear(); updateSelectionUI(); redraw(); });

    $('seatAngleSlider').addEventListener('input', e => applyAngle(parseFloat(e.target.value) || 0, false));
    $('seatAngleSlider').addEventListener('change', () => commit('座席角度'));
    $('btnAngleL').addEventListener('click', () => applyAngle(-30, true));
    $('btnAngleR').addEventListener('click', () => applyAngle(30, true));
    $('btnAimCenter').addEventListener('click', aimToStageCenter);
    $('btnAlignLine').addEventListener('click', alignLine);
    $('btnSnapY').addEventListener('click', snapToRows);
  }

  function readGrid() {
    grid.rows = Math.max(1, Math.round(num('gridRows', 5)));
    grid.rowGap = Math.max(0, num('gridRowGap', 450));
    grid.blockCols = $('gridBlockCols').value || '5,10,5';
    grid.seatGapX = Math.max(0, num('gridSeatGapX', 20));
    grid.aisleW = Math.max(0, num('gridAisleW', 1000));
    grid.stageDist = num('gridStageDist', 2250);
    grid.mode = $('gridMode').value || 'normal';
    grid.growFrom = Math.max(1, Math.round(num('gridGrowFrom', 4)));
    grid.growBy = Math.round(num('gridGrowBy', 0));
    grid.growTarget = $('gridGrowTarget').value || 'outer';
    grid.offsetX = num('gridOffsetX', 0);
  }

  function syncUI() {
    if (!$('chairW')) return;
    const c = window.chair;
    $('chairW').value = c.w; $('chairD').value = c.d; $('chairH').value = c.h; $('chairBackH').value = c.backH;
    $('audienceTorsoH').value = Math.round(window.audienceTorsoH);
    $('totalHeadZ').value = Math.round(window.totalHeadZ);
    $('gridRows').value = grid.rows; $('gridRowGap').value = grid.rowGap; $('gridBlockCols').value = grid.blockCols;
    $('gridSeatGapX').value = grid.seatGapX; $('gridAisleW').value = grid.aisleW; $('gridStageDist').value = grid.stageDist;
    $('gridMode').value = grid.mode; $('gridGrowFrom').value = grid.growFrom; $('gridGrowBy').value = grid.growBy; $('gridGrowTarget').value = grid.growTarget;
    $('gridOffsetX').value = grid.offsetX || 0;
    $('seatCountBadge').innerText = window.seats.filter(s => groupOf(s) === curGroup()).length + ' 席 / 全' + window.seats.length + ' 席';
    const sgSel = $('seatGroupSelect');
    sgSel.innerHTML = '';
    groups.forEach(g => {
      const o = document.createElement('option');
      o.value = g.id; o.textContent = g.name + ' (' + window.seats.filter(s => groupOf(s) === g).length + '席' + (g.table.mode !== 'none' ? '・テーブル' : '') + ')';
      sgSel.appendChild(o);
    });
    sgSel.value = selectedGroupId;
    $('seatGroupName').value = curGroup().name;
    $('btnDelSeatGroup').disabled = groups.length <= 1;
    const tb = curGroup().table;
    $('tblMode').value = tb.mode; $('tblPerTable').value = tb.perTable; $('tblW').value = tb.w; $('tblD').value = tb.d; $('tblH').value = tb.h; $('tblGap').value = tb.gap;
    $('tblPerTableBox').style.display = tb.mode === 'shared' ? '' : 'none';
    $('tblWBox').style.display = tb.mode === 'perSeat' ? '' : 'none';
    ['tblPerTable', 'tblW', 'tblD', 'tblH', 'tblGap'].forEach(id => { $(id).disabled = tb.mode === 'none'; });
    const need = tb.gap + tb.d, have = grid.rowGap;
    $('tblWarn').innerHTML = (tb.mode !== 'none' && need > have) ? '<span style="color:#dc2626">⚠ テーブルが前の列の椅子に重なります (椅子との距離+奥行 ' + need + ' > 列間隔 ' + have + ')。列間隔を広げてください。</span>' : '';
    syncPatternSelect();
    updateRowSummary();
    updateSelectionUI();
  }

  function updateSelectionUI() {
    const label = $('selectedSeatLabel');
    if (!label) return;
    // 存在しない席の選択は掃除
    [...selectedIds].forEach(id => { if (!byId(id)) selectedIds.delete(id); });
    const sel = selectedSeats();
    if (sel.length === 1) {
      label.innerText = '選択中: ' + sel[0].id;
      $('seatAngleSlider').value = sel[0].angle || 0;
      $('seatAngleVal').innerText = (sel[0].angle || 0) + '°';
    } else {
      label.innerText = sel.length > 1 ? '複数選択中 (' + sel.length + '席)' : '席未選択 (図面上で席をクリック)';
    }
  }

  // ---------------------------------------------------------------- 客席グループ
  function addGroup() {
    const n = Math.max(0, ...groups.map(g => parseInt(String(g.id).replace(/\D/g, ''), 10) || 0)) + 1;
    const grp = makeGroup('SG' + n, '客席' + (groups.length + 1), 'SG' + n + '-');
    // 既存の席の後ろに続けて置く (最後尾の後ろ脚 + 列間隔1つ分)
    const st = window.stage, d = window.chair.d;
    const backLeg = window.seats.length ? Math.max.apply(null, window.seats.map(s => s.y)) + d / 2 : st.y + st.d;
    grp.grid.rows = 3; grp.grid.blockCols = '4';
    grp.grid.stageDist = Math.max(0, Math.round(backLeg + 1000 - (st.y + st.d)));
    grp.table = Object.assign(DEFAULT_TABLE(), { mode: 'shared' });
    groups.push(grp);
    selectGroup(grp.id);
    selectedIds.clear();
    rebuildSeats();
  }

  /** 席を全部消す。削除した場所を覚えるので、席幅などを変えても勝手に復活しない */
  function clearSeats(all) {
    const targets = all ? groups : [curGroup()];
    targets.forEach(grp => {
      generateSeats(grp.grid, grp).forEach(g => grp.deleted.add(g.slot));
      window.seats.filter(s => groupOf(s) === grp && s.slot).forEach(s => grp.deleted.add(s.slot));
    });
    window.seats = window.seats.filter(s => !targets.includes(groupOf(s)));
    selectedIds.clear();
    syncUI(); redraw(); commit(all ? '全客席を削除' : '客席の席を全削除');
  }

  function deleteGroup() {
    if (groups.length <= 1) { window.debugBox && window.debugBox.warn('客席は最低1つ必要です'); return; }
    const grp = curGroup();
    window.seats = window.seats.filter(s => groupOf(s) !== grp);
    groups = groups.filter(g => g !== grp);
    selectGroup(groups[0].id);
    selectedIds.clear();
    syncUI(); redraw(); commit('客席グループ削除');
  }

  // ---------------------------------------------------------------- テーブル
  /** 全グループのテーブルを矩形のリストにする: { x, y, w, d, angle, h, seatIds[], gid } (x,y は中心) */
  function computeTables() {
    const out = [], cw = window.chair.w, cd = window.chair.d;
    groups.forEach(grp => {
      const t = grp.table;
      if (!t || t.mode === 'none') return;
      const mine = window.seats.filter(s => groupOf(s) === grp);
      const off = cd / 2 + t.gap + t.d / 2;                              // 席の中心から、テーブル中心まで (ステージ側 = 席の前)
      if (t.mode === 'perSeat') {
        mine.forEach(s => {
          const a = (s.angle || 0) * Math.PI / 180;
          out.push({ x: s.x + off * Math.sin(a), y: s.y - off * Math.cos(a), w: t.w, d: t.d, angle: s.angle || 0, h: t.h, seatIds: [s.id], gid: grp.id });
        });
      } else {
        const bins = new Map();
        mine.forEach(s => {
          const m = /^r(\d+)b(\d+)i(\d+)$/.exec(s.slot || '');
          if (!m) return;                                                // 個別に追加した席には付けない
          const k = m[1] + '|' + m[2];
          if (!bins.has(k)) bins.set(k, []);
          bins.get(k).push({ s, i: +m[3] });
        });
        bins.forEach(list => {
          list.sort((a, b) => a.i - b.i);
          const n = t.perTable > 0 ? t.perTable : list.length;
          for (let i = 0; i < list.length; i += n) {
            const ch = list.slice(i, i + n).map(v => v.s);
            const x0 = Math.min.apply(null, ch.map(s => s.x)) - cw / 2, x1 = Math.max.apply(null, ch.map(s => s.x)) + cw / 2;
            const y = ch.reduce((a, s) => a + s.y, 0) / ch.length;
            out.push({ x: (x0 + x1) / 2, y: y - off, w: x1 - x0, d: t.d, angle: 0, h: t.h, seatIds: ch.map(s => s.id), gid: grp.id });
          }
        });
      }
    });
    return out;
  }

  // ---------------------------------------------------------------- 配置パターン
  /** 増減する席を、対象ブロックへ順番に配る */
  function distribute(counts, delta, target) {
    const n = counts.length;
    let targets;
    if (target === 'all') targets = counts.map((_, i) => i);
    else if (target === 'center') targets = (n % 2 === 1) ? [(n - 1) / 2] : [n / 2 - 1, n / 2];
    else targets = n === 1 ? [0] : [0, n - 1];
    const step = delta > 0 ? 1 : -1;
    for (let i = 0; i < Math.abs(delta); i++) {
      const idx = targets[i % targets.length];
      if (step > 0) counts[idx]++; else if (counts[idx] > 0) counts[idx]--;
    }
  }

  /** 列の中心間距離 = 椅子の奥行(前脚→後ろ脚) + 列間隔(後ろ脚→次列の前脚) */
  function rowStep(g) { return window.chair.d + g.rowGap; }
  /** 最前列の中心Y = ステージ前縁 + 離隔(→前脚) + 椅子奥行の半分 */
  function firstRowY(g) { const st = window.stage; return st.y + st.d + g.stageDist + window.chair.d / 2; }
  /** 旧形式 (列ピッチ=中心間 / 離隔=最前列の中心まで) の設定を、脚基準の新形式へ変換 */
  function upgradeGrid(g) {
    if (!g || g.legBased) return g;
    const d = window.chair.d;
    if (g.rowPitch != null) g.rowGap = Math.max(0, g.rowPitch - d);
    delete g.rowPitch;
    if (g.stageDist != null) g.stageDist = Math.max(0, g.stageDist - d / 2);
    g.legBased = true;
    return g;
  }

  /** 設定から全席の位置を計算する (配置は変えない。再配置と列ごとの席数表示で共用) */
  function generateSeats(g, grp) {
    const r = window.room, st = window.stage, ch = window.chair;
    // 1席おき・市松は席を間引くので、「席隙間」は残った席どうしの見た目の隙間として扱う:
    // 残った席の中心距離 = 席幅 + 席隙間 → 位置(スロット)の間隔はその半分
    const thin = g.mode === 'skip' || g.mode === 'checker';
    const pitch = thin ? (ch.w + g.seatGapX) / 2 : ch.w + g.seatGapX;
    const aisleW = thin ? g.aisleW + Math.max(0, ch.w - pitch) : g.aisleW;      // 端の席がスロットからはみ出す分を通路に足す
    let blocks = String(g.blockCols).split(',').map(n => parseInt(n.trim(), 10) || 0).filter(n => n > 0);
    if (!blocks.length) blocks = [8];
    const startY = firstRowY(g), pre = grp ? grp.prefix : '', gid = grp ? grp.id : groups[0].id;
    const out = [];
    for (let row = 0; row < g.rows; row++) {
      const counts = blocks.slice();
      if (g.growBy && row + 1 >= g.growFrom) distribute(counts, g.growBy * (row + 1 - g.growFrom + 1), g.growTarget);
      const total = counts.reduce((a, n) => a + n * pitch, 0) + aisleW * (counts.length - 1);
      let curX = (r.w - total) / 2 + (g.offsetX || 0) + (g.mode === 'stagger' && row % 2 === 1 ? pitch / 2 : 0);
      let pos = 0, n = 1;
      counts.forEach((count, bi) => {
        for (let c = 0; c < count; c++, pos++) {
          const keep = g.mode === 'skip' ? pos % 2 === 0 : (g.mode === 'checker' ? (pos + row) % 2 === 0 : true);
          if (keep) { out.push({ id: pre + 'R' + (row + 1) + '-S' + n, g: gid, row: row + 1, slot: 'r' + (row + 1) + 'b' + bi + 'i' + c, x: Math.round(curX + pitch / 2), y: Math.round(startY + row * rowStep(g)), angle: 0 }); n++; }
          curX += pitch;
        }
        curX += aisleW;
      });
    }
    return out;
  }

  /** 完全に再配置: 個別編集 (移動・角度・削除・追加) をすべてリセットする */
  function rebuildSeats() {
    const grp = curGroup();
    window.seats = window.seats.filter(s => groupOf(s) !== grp).concat(generateSeats(grid, grp).map(g => Object.assign(g, { gx: g.x, gy: g.y })));
    grp.deleted = new Set();
    selectedIds.clear();
    syncUI(); redraw(); commit('客席の再配置');
  }

  /**
   * 席幅・隙間・通路幅・列ピッチ・席数などを変えて並べ直す。個別編集は保つ:
   *   動かした席 → 基準位置からのずれを維持 / 角度 → 維持 / 削除した席 → 削除のまま / 追加した席 → そのまま
   */
  function relayoutSeats(label) {
    const grp = curGroup(), mine = window.seats.filter(s => groupOf(s) === grp);
    const old = new Map();
    mine.forEach(s => { if (s.slot) old.set(s.slot, s); });
    const selSlots = new Set(), selCustom = new Set();
    selectedSeats().forEach(s => { if (groupOf(s) !== grp) return; if (s.slot) selSlots.add(s.slot); else selCustom.add(s.id); });

    const out = window.seats.filter(s => groupOf(s) !== grp);            // 他のグループの席はそのまま
    const keepSel = new Set([...selectedIds].filter(id => out.some(s => s.id === id)));
    generateSeats(grid, grp).forEach(g => {
      if (grp.deleted.has(g.slot)) return;
      const o = old.get(g.slot);
      const dx = o ? o.x - (typeof o.gx === 'number' ? o.gx : o.x) : 0;
      const dy = o ? o.y - (typeof o.gy === 'number' ? o.gy : o.y) : 0;
      out.push({ id: g.id, g: grp.id, row: g.row, slot: g.slot, gx: g.x, gy: g.y, x: g.x + dx, y: g.y + dy, angle: o ? (o.angle || 0) : 0 });
    });
    mine.filter(s => !s.slot).forEach(s => out.push(s));               // 個別に追加した席

    window.seats = out;
    selectedIds.clear();
    keepSel.forEach(id => selectedIds.add(id));
    out.forEach(s => { if (groupOf(s) === grp && (s.slot ? selSlots.has(s.slot) : selCustom.has(s.id))) selectedIds.add(s.id); });
    syncUI(); redraw(); commit(label || '客席の並べ直し');
  }

  /** 各列の席数と、会場幅からはみ出す席の警告 */
  function updateRowSummary() {
    const el = $('gridRowSummary');
    if (!el) return;
    const planned = generateSeats(grid, curGroup()), counts = [];
    planned.forEach(s => { counts[s.row - 1] = (counts[s.row - 1] || 0) + 1; });
    const hw = window.chair.w / 2;
    const over = planned.filter(s => s.x - hw < 0 || s.x + hw > window.room.w).length;
    el.innerHTML = '各列の席数: ' + counts.map((c, i) => (i + 1) + '列=' + (c || 0)).join(' / ') +
      (over ? '<br><span style="color:#dc2626">⚠ ' + over + ' 席が会場の幅からはみ出します (席数か通路幅を減らしてください)</span>' : '');
  }

  function allPatterns() {
    return BUILTIN_PATTERNS.map(p => Object.assign({ builtin: true }, p)).concat(myPatterns.map(p => Object.assign({ builtin: false }, p)));
  }

  function syncPatternSelect() {
    const sel = $('seatPatternSelect');
    if (!sel) return;
    const keep = sel.value;
    sel.innerHTML = '<optgroup label="組込み">' + BUILTIN_PATTERNS.map(p => '<option value="' + p.id + '">' + p.name + '</option>').join('') + '</optgroup>' +
      (myPatterns.length ? '<optgroup label="マイパターン">' + myPatterns.map(p => '<option value="' + p.id + '">' + p.name.replace(/</g, '&lt;') + '</option>').join('') + '</optgroup>' : '');
    if (allPatterns().some(p => p.id === keep)) sel.value = keep;
    $('btnPatternDelete').disabled = !myPatterns.some(p => p.id === sel.value);
    sel.onchange = () => { $('btnPatternDelete').disabled = !myPatterns.some(p => p.id === sel.value); };
  }

  function applyPattern() {
    const p = allPatterns().find(x => x.id === $('seatPatternSelect').value);
    if (!p) return;
    readGrid();
    Object.assign(grid, clone(p.grid));
    rebuildSeats();
  }

  function savePattern() {
    const name = ($('seatPatternName').value || '').trim();
    if (!name) { window.debugBox && window.debugBox.warn('パターン名を入力してください'); return; }
    readGrid();
    const exist = myPatterns.find(p => p.name === name);
    if (exist) exist.grid = clone(grid);
    else myPatterns.push({ id: U.nextId('P', myPatterns), name, grid: clone(grid) });
    $('seatPatternName').value = '';
    syncPatternSelect();
    const saved = myPatterns.find(p => p.name === name);
    if (saved) $('seatPatternSelect').value = saved.id;
    $('btnPatternDelete').disabled = false;
    commit('配置パターン保存');
  }

  function deletePattern() {
    const id = $('seatPatternSelect').value;
    if (!myPatterns.some(p => p.id === id)) return;
    myPatterns = myPatterns.filter(p => p.id !== id);
    syncPatternSelect();
    commit('配置パターン削除');
  }

  // ---------------------------------------------------------------- 座席操作
  function applyAngle(val, doCommit) {
    $('seatAngleVal').innerText = val + '°';
    $('seatAngleSlider').value = val;
    const sel = selectedSeats();
    if (!sel.length) return;
    sel.forEach(s => { s.angle = val; });
    redraw();
    if (doCommit) commit('座席角度');
  }

  function aimToStageCenter() {
    const sel = selectedSeats();
    if (!sel.length) return;
    const st = window.stage, tx = st.x + st.w / 2, ty = st.y + st.d / 2;
    sel.forEach(s => {
      let deg = Math.round(Math.atan2(ty - s.y, tx - s.x) * 180 / Math.PI + 90);
      while (deg > 180) deg -= 360;
      while (deg <= -180) deg += 360;
      s.angle = deg;
    });
    updateSelectionUI(); redraw(); commit('ステージ中央へ向ける');
  }

  function alignLine() {
    const sel = selectedSeats();
    if (sel.length < 2) { window.debugBox && window.debugBox.warn('整列するには2席以上を選択してください'); return; }
    const anchor = sel.reduce((m, s) => (s.x + s.y < m.x + m.y ? s : m), sel[0]);
    const sorted = sel.slice().sort((a, b) => Math.hypot(a.x - anchor.x, a.y - anchor.y) - Math.hypot(b.x - anchor.x, b.y - anchor.y));
    const pitch = window.chair.w + grid.seatGapX;
    const ang = parseFloat($('seatAngleSlider').value) || 0, rad = ang * Math.PI / 180;
    sorted.forEach((s, i) => {
      s.angle = ang;
      if (i > 0) { s.x = Math.round(anchor.x + i * pitch * Math.cos(rad)); s.y = Math.round(anchor.y + i * pitch * Math.sin(rad)); }
    });
    redraw(); commit('1直線に整列');
  }

  function snapToRows() {
    const sel = selectedSeats();
    if (!sel.length) { window.debugBox && window.debugBox.warn('スナップする席を選択してください'); return; }
    sel.forEach(s => {
      const gg = groupOf(s).grid, startY = firstRowY(gg), step = rowStep(gg);
      const idx = Math.round((s.y - startY) / step);
      s.y = startY + idx * step;
      s.row = idx + 1;
    });
    redraw(); commit('列にスナップ');
  }

  // ---------------------------------------------------------------- カメラ連携
  function blockedIds() {
    const cm = window.tabCameraModule;
    return (cm && typeof cm.getBlockedSeatIds === 'function') ? cm.getBlockedSeatIds() : new Set();
  }

  function getStats() {
    const total = window.seats.length, partial = blockedIds().size;
    return { total, clear: Math.max(0, total - partial), partial, blocked: partial };
  }

  // ---------------------------------------------------------------- 描画
  function drawTop(ctx) {
    if (!window.seats.length) return;
    const cw = window.chair.w, cd = window.chair.d;
    const status = !!window.displaySettings.showSeatStatus;
    const blocked = status ? blockedIds() : new Set();

    computeTables().forEach(tb => {                                    // テーブルは椅子の下に描く
      ctx.save();
      ctx.translate(tb.x, tb.y); ctx.rotate(tb.angle * Math.PI / 180);
      ctx.fillStyle = '#f3e8d4'; ctx.strokeStyle = '#a07c4a'; ctx.lineWidth = 10;
      ctx.fillRect(-tb.w / 2, -tb.d / 2, tb.w, tb.d); ctx.strokeRect(-tb.w / 2, -tb.d / 2, tb.w, tb.d);
      ctx.restore();
    });
    if (groups.length > 1) {                                           // グループ名 (複数あるときだけ)
      groups.forEach(grp => {
        const mine = window.seats.filter(s => groupOf(s) === grp);
        if (!mine.length) return;
        const x = Math.min.apply(null, mine.map(s => s.x)), y = Math.min.apply(null, mine.map(s => s.y));
        window.Core.drawText(ctx, grp.name, x, y - window.chair.d / 2 - (grp.table.mode !== 'none' ? grp.table.gap + grp.table.d : 0) - 250, { px: 11, bold: true, color: grp.id === selectedGroupId ? '#2563eb' : '#64748b' });
      });
    }

    window.seats.forEach(s => {
      const sel = selectedIds.has(s.id), bad = blocked.has(s.id);
      ctx.save();
      ctx.translate(s.x, s.y);
      ctx.rotate((s.angle || 0) * Math.PI / 180);
      if (sel) { ctx.fillStyle = 'rgba(37,99,235,0.18)'; ctx.strokeStyle = '#2563eb'; ctx.lineWidth = 12; }
      else if (bad) { ctx.fillStyle = 'rgba(220,38,38,0.15)'; ctx.strokeStyle = '#dc2626'; ctx.lineWidth = 8; }
      else if (status) { ctx.fillStyle = '#dcfce7'; ctx.strokeStyle = '#16a34a'; ctx.lineWidth = 8; }          // 視界OK = 緑
      else { ctx.fillStyle = '#f5ede0'; ctx.strokeStyle = '#a8896c'; ctx.lineWidth = 6; }                       // 判定OFF = 暖色
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(-cw / 2, -cd / 2, cw, cd, 60); else ctx.rect(-cw / 2, -cd / 2, cw, cd);
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = sel ? '#3b82f6' : (bad ? '#ef4444' : (status ? '#4ade80' : '#d6c3a8'));   // 背もたれ
      ctx.fillRect(-cw / 2, cd / 2 - 40, cw, 40);
      ctx.strokeRect(-cw / 2, cd / 2 - 40, cw, 40);
      ctx.restore();
    });

    if (marquee) {
      ctx.save();
      ctx.fillStyle = 'rgba(37,99,235,0.08)'; ctx.strokeStyle = '#2563eb'; ctx.lineWidth = 2 / window.Core.scale;
      ctx.setLineDash([8 / window.Core.scale, 6 / window.Core.scale]);
      const x = Math.min(marquee.x0, marquee.x1), y = Math.min(marquee.y0, marquee.y1);
      ctx.fillRect(x, y, Math.abs(marquee.x1 - marquee.x0), Math.abs(marquee.y1 - marquee.y0));
      ctx.strokeRect(x, y, Math.abs(marquee.x1 - marquee.x0), Math.abs(marquee.y1 - marquee.y0));
      ctx.restore();
    }
  }

  /** 立面図用: 同じ奥行き(Y)・同じ接地高の席は重なるため1つにまとめる (頭被りの席があれば赤を優先) */
  function sideSeats() {
    const blocked = window.displaySettings.showSeatStatus ? blockedIds() : new Set();
    const fov = (window.tabCameraModule && window.tabCameraModule.getFovSelection) ? window.tabCameraModule.getFovSelection() : null;
    const map = new Map();
    window.seats.forEach(s => {
      if (fov && !fov.seatIds.has(s.id) && !blocked.has(s.id) && !selectedIds.has(s.id)) return;
      const bz = window.isInsideStage(s.x, s.y) ? window.stage.h : 0;
      const key = Math.round(s.y) + '|' + bz;
      const cur = map.get(key) || { y: s.y, bz, bad: false, sel: false };
      cur.bad = cur.bad || blocked.has(s.id);
      cur.sel = cur.sel || selectedIds.has(s.id);
      map.set(key, cur);
    });
    return [...map.values()].sort((a, b) => a.y - b.y);
  }

  function drawSeatedPerson(ctx, y, seatTopZ, torso) {
    const headR = 110;
    ctx.beginPath(); ctx.arc(y, -(seatTopZ + torso - headR), headR, 0, Math.PI * 2); ctx.fill();   // 頭
    ctx.beginPath();                                                                                  // 胴
    ctx.moveTo(y - 80, -seatTopZ - torso + headR * 2); ctx.lineTo(y + 80, -seatTopZ - torso + headR * 2);
    ctx.lineTo(y + 110, -seatTopZ); ctx.lineTo(y - 110, -seatTopZ);
    ctx.fill();
    ctx.fillRect(y - 200, -seatTopZ - 40, 200, 60);                                                   // 大腿 (ステージ側へ)
  }

  function drawSide(ctx) {
    const list = sideSeats();
    if (!list.length) return;
    const cd = window.chair.d, ch = window.chair.h, cb = window.chair.backH, torso = window.audienceTorsoH;

    ctx.save();
    const fovT = (window.tabCameraModule && window.tabCameraModule.getFovSelection) ? window.tabCameraModule.getFovSelection() : null;
    const blockedT = window.displaySettings.showSeatStatus ? blockedIds() : new Set();
    const seenT = new Set();
    computeTables().forEach(tb => {                                    // テーブル: 天板と脚 (同じ奥行き・高さは1つにまとめる)
      if (fovT && !tb.seatIds.some(id => fovT.seatIds.has(id) || blockedT.has(id) || selectedIds.has(id))) return;
      const bz = window.isInsideStage(tb.x, tb.y) ? window.stage.h : 0;
      const key = Math.round(tb.y) + '|' + Math.round(tb.d) + '|' + tb.h + '|' + bz;
      if (seenT.has(key)) return;
      seenT.add(key);
      const y0 = tb.y - tb.d / 2, y1 = tb.y + tb.d / 2;
      ctx.strokeStyle = '#a07c4a'; ctx.fillStyle = '#f3e8d4'; ctx.lineWidth = 20;
      ctx.fillRect(y0, -bz - tb.h, tb.d, 40); ctx.strokeRect(y0, -bz - tb.h, tb.d, 40);
      ctx.beginPath(); ctx.moveTo(y0 + 40, -bz - tb.h + 40); ctx.lineTo(y0 + 40, -bz); ctx.moveTo(y1 - 40, -bz - tb.h + 40); ctx.lineTo(y1 - 40, -bz); ctx.stroke();
    });
    list.sort((a, b) => (a.bad - b.bad)).forEach(g => {            // 赤を最前面に
      const py = g.y, bz = g.bz;
      const col = g.bad ? '#dc2626' : (g.sel ? '#2563eb' : '#15803d');
      ctx.strokeStyle = col; ctx.lineWidth = g.bad ? 35 : 25;
      ctx.strokeRect(py - cd / 2, -bz - ch, cd, 30);                   // 座面
      ctx.beginPath();
      ctx.moveTo(py - cd / 2 + 40, -bz - ch); ctx.lineTo(py - cd / 2 + 40, -bz);
      ctx.moveTo(py + cd / 2 - 40, -bz - ch); ctx.lineTo(py + cd / 2 - 40, -bz);
      ctx.moveTo(py + cd / 2 - 40, -bz - ch); ctx.lineTo(py + cd / 2 - 40, -bz - ch - cb);   // 背もたれ
      ctx.stroke();
      ctx.fillStyle = g.bad ? '#dc2626' : (g.sel ? '#2563eb' : '#166534');
      drawSeatedPerson(ctx, py, bz + ch, torso);
    });

    // 前席頭頂高ガイド (破線)
    ctx.strokeStyle = 'rgba(220,38,38,0.4)'; ctx.lineWidth = 15; ctx.setLineDash([60, 60]);
    ctx.beginPath();
    list.sort((a, b) => a.y - b.y).forEach((g, i) => {
      const z = -(g.bz + ch + torso);
      if (i === 0) { ctx.moveTo(g.y - 500, z); ctx.lineTo(g.y, z); } else ctx.lineTo(g.y, z);
      if (i === list.length - 1) ctx.lineTo(g.y + 500, z);
    });
    ctx.stroke();
    ctx.restore();
  }

  // ---------------------------------------------------------------- 当たり判定 / ドラッグ (平面図のみ)
  function seatAt(wx, wy) {
    const r = window.chair.w / 1.5;
    for (let i = window.seats.length - 1; i >= 0; i--) {
      if (Math.hypot(window.seats[i].x - wx, window.seats[i].y - wy) < r) return window.seats[i];
    }
    return null;
  }

  function seatBounds() {
    if (!window.seats.length) return null;
    const xs = window.seats.map(s => s.x), ys = window.seats.map(s => s.y), m = window.chair.w;
    return { x0: Math.min.apply(null, xs) - m, x1: Math.max.apply(null, xs) + m, y0: Math.min.apply(null, ys) - m, y1: Math.max.apply(null, ys) + m };
  }

  function hitTest(wx, wy, view) {
    if (view !== 'top') return null;
    const hit = seatAt(wx, wy);
    if (tool === 'add') return hit ? { type: 'seat', id: hit.id } : { type: 'add', x: wx, y: wy };
    if (hit) return { type: 'seat', id: hit.id, lastX: wx, lastY: wy };
    return null;
  }

  /** 何も無い所から押したまま動かすと範囲選択 (客席タブを開いている間・選択/ドラッグ移動ツールのとき) */
  function hitFallback(wx, wy, view) {
    if (view !== 'top' || (tool !== 'select' && tool !== 'move')) return null;
    const panel = document.getElementById('panel-seats');
    if (!panel || !panel.classList.contains('active')) return null;
    return { type: 'marquee', x0: wx, y0: wy };
  }

  function beginMarquee(item, x0, y0, keepBase) {
    item.type = 'marquee';
    item.x0 = x0; item.y0 = y0;
    item.base = keepBase ? new Set(selectedIds) : new Set();
    marquee = { x0, y0, x1: x0, y1: y0 };
  }

  function onGrab(item) {
    if (item.type === 'add') {
      const id = U.nextId('Custom-', window.seats);
      window.seats.push({ id, g: curGroup().id, row: 0, x: Math.round(item.x), y: Math.round(item.y), angle: 0 });
      selectedIds.clear(); selectedIds.add(id);
      syncUI(); redraw(); commit('1席追加');
      return;
    }
    if (item.type === 'marquee') {
      if (!window.Core.modifiers.shift) selectedIds.clear();         // 何もない所をただクリック = 選択解除
      beginMarquee(item, item.x0, item.y0, true);
      updateSelectionUI(); redraw();
      return;
    }
    if (item.type === 'seat') {
      if (tool === 'delete') {
        const gone = byId(item.id);
        if (gone && gone.slot) groupOf(gone).deleted.add(gone.slot);
        window.seats = window.seats.filter(s => s.id !== item.id);
        selectedIds.delete(item.id);
        syncUI(); redraw(); commit('1席削除');
      } else if (tool === 'select') {
        if (window.Core.modifiers.shift) { selectedIds.has(item.id) ? selectedIds.delete(item.id) : selectedIds.add(item.id); }
        else { selectedIds.clear(); selectedIds.add(item.id); }
        const sg = byId(item.id);
        if (sg && groupOf(sg).id !== selectedGroupId) { selectGroup(groupOf(sg).id); syncUI(); }       // クリックした席のグループを編集対象にする
        updateSelectionUI(); redraw();
      } else if (tool === 'move' && !selectedIds.has(item.id)) {
        selectedIds.clear(); selectedIds.add(item.id);
        updateSelectionUI(); redraw();
      }
    }
  }

  function handleDrag(item, wx, wy) {
    // 選択ツールで席を押したまま動かした → その位置を起点に囲い選択へ切り替える
    if (item.type === 'seat' && tool === 'select' && !marquee) {
      if (Math.hypot(wx - item.lastX, wy - item.lastY) < 8 / window.Core.scale) return;
      beginMarquee(item, item.lastX, item.lastY, !!window.Core.modifiers.shift);
    }
    if (item.type === 'marquee' && marquee) {
      marquee.x1 = wx; marquee.y1 = wy;
      const x0 = Math.min(marquee.x0, wx), x1 = Math.max(marquee.x0, wx), y0 = Math.min(marquee.y0, wy), y1 = Math.max(marquee.y0, wy);
      selectedIds.clear();
      item.base.forEach(id => selectedIds.add(id));
      window.seats.forEach(s => { if (s.x >= x0 && s.x <= x1 && s.y >= y0 && s.y <= y1) selectedIds.add(s.id); });
      updateSelectionUI();
    } else if (item.type === 'seat' && tool === 'move' && byId(item.id)) {
      const dx = wx - item.lastX, dy = wy - item.lastY;
      selectedSeats().forEach(s => { s.x = Math.round(s.x + dx); s.y = Math.round(s.y + dy); });
      item.lastX = wx; item.lastY = wy;
    }
  }

  // マウスを離したら範囲枠を消す
  window.addEventListener('mouseup', () => { if (marquee) { marquee = null; redraw(); } });

  // ---------------------------------------------------------------- 保存 / 復元
  function exportData() {
    const g0 = groups[0];
    return {
      seats: clone(window.seats), chair: clone(window.chair), audienceTorsoH: window.audienceTorsoH,
      groups: groups.map(g => ({ id: g.id, name: g.name, prefix: g.prefix, grid: clone(g.grid), table: clone(g.table), deleted: [...g.deleted] })),
      selectedGroupId,
      grid: clone(g0.grid), deletedSlots: [...g0.deleted],            // 旧版との互換 (先頭グループ)
      patterns: clone(myPatterns)
    };
  }

  function importData(d) {
    if (!d) return;
    if (Array.isArray(d.seats)) window.seats = clone(d.seats);
    if (d.chair) window.chair = Object.assign({ w: 500, d: 500, h: 420, backH: 400 }, clone(d.chair));
    if (typeof d.audienceTorsoH === 'number') window.audienceTorsoH = d.audienceTorsoH;
    else if (typeof d.totalHeadZ === 'number') window.audienceTorsoH = Math.max(300, d.totalHeadZ - window.chair.h);   // 旧形式
    if (Array.isArray(d.patterns)) myPatterns = clone(d.patterns).map(p => { upgradeGrid(p.grid); return p; });
    if (Array.isArray(d.groups) && d.groups.length) {
      groups = d.groups.map((g, i) => {
        const grp = makeGroup(g.id || 'SG' + (i + 1), g.name || '客席' + (i + 1), g.prefix != null ? g.prefix : (i === 0 ? '' : (g.id || 'SG' + (i + 1)) + '-'));
        Object.assign(grp.grid, upgradeGrid(clone(g.grid || {})));
        Object.assign(grp.table, clone(g.table || {}));
        grp.deleted = new Set(Array.isArray(g.deleted) ? g.deleted : []);
        return grp;
      });
    } else {                                                          // 旧形式: 1グループ
      const grp = makeGroup('SG1', '客席1', '');
      if (d.grid) Object.assign(grp.grid, upgradeGrid(clone(d.grid)));
      grp.deleted = new Set(Array.isArray(d.deletedSlots) ? d.deletedSlots : []);
      groups = [grp];
    }
    selectGroup(groups.some(g => g.id === d.selectedGroupId) ? d.selectedGroupId : groups[0].id);
    adoptLegacySeats();
    updateHeadZ();
    selectedIds.clear();
    syncUI();
  }

  /** slot を持たない旧形式の席を、同じ id の自動配置の席に紐づける (以後の並べ直しで編集を保てる) */
  function adoptLegacySeats() {
    if (!window.seats.length || window.seats.some(s => s.slot)) return;
    const gen = new Map(generateSeats(groups[0].grid, groups[0]).map(g => [g.id, g]));
    window.seats.forEach(s => {
      const g = gen.get(s.id);
      if (g) { s.slot = g.slot; s.gx = g.x; s.gy = g.y; }
    });
  }

  window.tabSeatsModule = {
    init(panel) {
      buildUI(panel);
      if (!window.seats.length) rebuildSeats();       // 初回のみ初期配置 (履歴の初期状態に含まれる)
    },
    drawTop, drawSide, hitTest, hitFallback, onGrab, handleDrag, exportData, importData, syncUI,
    getStats, rebuildSeats,
    getGrid: () => clone(grid),
    getGroups: () => groups.map(g => ({ id: g.id, name: g.name, grid: clone(g.grid), table: clone(g.table), count: window.seats.filter(s => groupOf(s) === g).length })),
    getTables: computeTables,
    /** 外部 (AI生成など) からグリッド条件を渡して再配置する */
    configureGrid(cfg) {
      if (!cfg) return;
      selectGroup(groups[0].id);                                        // AI生成は先頭の客席に反映する
      if (cfg.rows) grid.rows = Math.max(1, Math.round(cfg.rows));
      if (cfg.rowGap != null) grid.rowGap = Math.max(0, cfg.rowGap);
      else if (cfg.rowPitch) grid.rowGap = Math.max(0, cfg.rowPitch - window.chair.d);     // 旧形式 (中心間ピッチ) の入力
      if (cfg.blockCols) grid.blockCols = String(cfg.blockCols);
      if (cfg.seatGapX != null) grid.seatGapX = cfg.seatGapX;
      if (cfg.aisleW) grid.aisleW = cfg.aisleW;
      if (cfg.stageDist) grid.stageDist = cfg.stageDist;
      ['mode', 'growFrom', 'growBy', 'growTarget'].forEach(k => { if (cfg[k] != null) grid[k] = cfg[k]; });
      rebuildSeats();
    },
    getSelectedIds: () => new Set(selectedIds)
  };
  window.Core.register('seats', window.tabSeatsModule, { order: 40 });
})();
