/**
 * ==============================================================================
 * export_sheet.js — 図面の書き出し (PNG / PDF) と寸法の自動記載
 *
 * 平面図: 会場・ステージ・バックパネル・カメラ台の W/D(H) と、客席1箇所分の
 *         席幅・席隙間・列間隔・通路幅・ステージ離隔 (すべて脚基準) を図面に記載
 * 立面図: 床の下にオブジェクト間の距離 (D) を記載 + 高さ (H) を記載
 * 余白  : 上に題名、下に寸法表
 *
 * 外部ライブラリなし。PDF は JPEG 画像 1 枚のページを自前で組み立てる。
 * ==============================================================================
 */
(function () {
  'use strict';

  const FONT = '"Hiragino Sans","Noto Sans JP","Yu Gothic","Meiryo",sans-serif';
  const RED = '#dc2626', ORANGE = '#ea580c', INK = '#0f172a';
  const mm = (v) => Math.round(v).toLocaleString('en-US').replace(/,/g, '');

  // ------------------------------------------------------------------ 描画ヘルパー
  function makePen(g, fs) {
    const placed = [];
    const pen = {
      fs,
      text(t, x, y, o) {
        o = o || {};
        g.font = (o.bold === false ? '' : 'bold ') + (o.size || fs) + 'px ' + FONT;
        g.textAlign = o.align || 'center'; g.textBaseline = 'middle';
        const w = g.measureText(t).width, h = (o.size || fs) * 1.3;
        const lx = o.align === 'left' ? x : o.align === 'right' ? x - w : x - w / 2;
        if (o.bg !== false) { g.fillStyle = 'rgba(255,255,255,0.88)'; g.fillRect(lx - 3, y - h / 2, w + 6, h); }
        g.fillStyle = o.color || INK;
        g.fillText(t, x, y);
      },
      /** 重ならない位置を探して注記を置く (下→上へずらす) */
      label(t, x, y, o) {
        o = o || {};
        g.font = 'bold ' + (o.size || fs) + 'px ' + FONT;
        const w = g.measureText(t).width + 8, h = (o.size || fs) * 1.35;
        let yy = y;
        for (let i = 0; i < 40; i++) {
          const r = { x: x - w / 2, y: yy - h / 2, w, h };
          if (!placed.some(p => r.x < p.x + p.w && r.x + r.w > p.x && r.y < p.y + p.h && r.y + r.h > p.y)) { placed.push(r); break; }
          yy += h * (o.dir || 1);
        }
        pen.text(t, x, yy, o);
      },
      /** 寸法線: (x1,y1)-(x2,y2) をpx座標で。両端に目盛り、中央に文字 */
      dim(x1, y1, x2, y2, label, o) {
        o = o || {};
        const col = o.color || ORANGE, tick = o.tick || fs * 0.45;
        g.save();
        g.strokeStyle = col; g.lineWidth = Math.max(1.5, fs / 9);
        g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke();
        const a = Math.atan2(y2 - y1, x2 - x1), nx = -Math.sin(a) * tick, ny = Math.cos(a) * tick;
        g.beginPath();
        g.moveTo(x1 - nx, y1 - ny); g.lineTo(x1 + nx, y1 + ny);
        g.moveTo(x2 - nx, y2 - ny); g.lineTo(x2 + nx, y2 + ny);
        g.stroke();
        g.restore();
        if (label) {
          const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
          const vertical = Math.abs(y2 - y1) > Math.abs(x2 - x1);
          const dx = o.textDx != null ? o.textDx : (vertical ? fs * 0.8 : 0);
          const dy = o.textDy != null ? o.textDy : (vertical ? 0 : fs * 1.0);
          pen.label(label, mx + (vertical ? 0 : dx), my + (vertical ? 0 : dy), { color: col, size: o.size, align: 'center', dir: o.dir });
          if (vertical && dx) { /* 縦線の文字は label() で重なり回避済み。横ずらしは呼び出し側で */ }
        }
      }
    };
    return pen;
  }

  // ------------------------------------------------------------------ データ収集
  function collect() {
    const room = window.room, stage = window.stage;
    const panels = (window.panels || []).filter(p => p.enabled !== false);
    const CB = window.CameraBase;
    const platforms = CB ? CB.getPlatforms() : [], cameras = CB ? CB.getAll() : [];
    const seats = window.seats || [];
    return { room, stage, panels, platforms, cameras, seats, chair: window.chair, monitors: window.monitors || [] };
  }

  function seatRows(seats, chair) {
    const rows = new Map();
    seats.forEach(s => {
      const k = Math.round(s.y / 10);
      if (!rows.has(k)) rows.set(k, []);
      rows.get(k).push(s);
    });
    return Array.from(rows.entries()).sort((a, b) => a[0] - b[0]).map(e => e[1].sort((a, b) => a.x - b.x));
  }

  // ------------------------------------------------------------------ 平面図の注記
  function annotateTop(g, pen, T, D) {
    const X = (x) => T.ox + T.panX + x * T.s, Y = (y) => T.oy + T.panY + y * T.s;
    const { room, stage, panels, platforms, seats, chair } = D;
    const fs = pen.fs;

    // 会場 W / D
    pen.dim(X(0), Y(0) - fs * 2.4, X(room.w), Y(0) - fs * 2.4, '会場 W' + mm(room.w), { color: INK, textDy: -fs * 0.2 });
    pen.dim(X(0) - fs * 2.4, Y(0), X(0) - fs * 2.4, Y(room.d), null, { color: INK });
    pen.text('会場 D' + mm(room.d), X(0) - fs * 2.4 - fs * 0.2, Y(room.d / 2), { color: INK, align: 'right' });

    // ステージ
    pen.dim(X(stage.x), Y(stage.y) - fs * 1.1, X(stage.x + stage.w), Y(stage.y) - fs * 1.1, 'ステージ W' + mm(stage.w), { color: INK, textDy: -fs * 0.2, dir: -1 });
    pen.dim(X(stage.x) - fs * 1.1, Y(stage.y), X(stage.x) - fs * 1.1, Y(stage.y + stage.d), null, { color: INK });
    pen.label('ステージ D' + mm(stage.d) + ' (H' + mm(stage.h) + ')', X(stage.x + stage.w / 2), Y(stage.y + stage.d) - fs * 1.2, { color: INK });

    // バックパネル
    panels.forEach(p => {
      pen.label((p.name || 'バックパネル') + ' W' + mm(p.w) + '×D' + mm(p.d) + ' (H' + mm(p.h) + ')', X(p.x + p.w / 2), Y(p.y) + fs * 1.4, { color: '#475569', size: fs * 0.9 });
    });

    // カメラ台
    platforms.forEach(p => {
      g.save(); g.strokeStyle = INK; g.lineWidth = Math.max(1.5, fs / 9); g.setLineDash([fs * 0.5, fs * 0.3]);
      g.strokeRect(X(p.x - p.w / 2), Y(p.y - p.d / 2), p.w * T.s, p.d * T.s); g.restore();
      pen.label((p.name || 'カメラ台') + ' W' + mm(p.w) + '×D' + mm(p.d) + ' (H' + mm(p.h || 0) + ')', X(p.x), Y(p.y + p.d / 2) + fs * 1.4, { color: INK });
    });

    // 客席: 1箇所分の寸法 (脚基準)
    const rows = seatRows(seats.filter(s => !s.angle), chair);
    if (rows.length) {
      const r1 = rows[0], cw = chair.w, cd = chair.d;
      // 隣り合う2席 (最初の近接ペア) / 通路
      let pair = -1, aisle = -1;
      for (let i = 1; i < r1.length; i++) {
        const gap = r1[i].x - r1[i - 1].x - cw;
        if (pair < 0 && gap >= -1 && gap < cw) pair = i;
        if (aisle < 0 && gap >= cw) aisle = i;
      }
      const A = pair > 0 ? r1[pair - 1] : r1[0], B = pair > 0 ? r1[pair] : null;
      const yTop = A.y - cd / 2;
      // 席 W×D
      pen.dim(X(A.x - cw / 2), Y(yTop) - fs * 0.9, X(A.x + cw / 2), Y(yTop) - fs * 0.9, null, { color: RED, tick: fs * 0.3 });
      pen.label('席 W' + mm(cw) + '×D' + mm(cd), X(A.x), Y(yTop) - fs * 2.0, { color: RED, size: fs * 0.9 });
      // 席隙間 (右脚→隣の左脚)
      if (B) {
        const gx1 = A.x + cw / 2, gx2 = B.x - cw / 2, yy = Y(A.y + cd / 2) + fs * 0.9;
        pen.dim(X(gx1), yy, X(gx2), yy, null, { color: RED, tick: fs * 0.3 });
        pen.label('席隙間 ' + mm(gx2 - gx1), (X(gx1) + X(gx2)) / 2, yy + fs * 1.1, { color: RED, size: fs * 0.9 });
      }
      // 列間隔 (後ろ脚→次列の前脚)
      if (rows.length > 1) {
        const n = rows[1].find(s => Math.abs(s.x - A.x) < 10) || rows[1][0];
        const y1 = A.y + cd / 2, y2 = n.y - cd / 2, xx = X(A.x - cw / 2) - fs * 0.8;
        pen.dim(xx, Y(y1), xx, Y(y2), null, { color: RED, tick: fs * 0.3 });
        pen.label('列間隔 ' + mm(y2 - y1), xx - fs * 0.5, (Y(y1) + Y(y2)) / 2, { color: RED, size: fs * 0.9 });
      }
      // ステージ離隔 (前縁→最前列の前脚)
      const sy = stage.y + stage.d, fy = A.y - cd / 2, xs = X(A.x + cw / 2) + fs * 0.8;
      if (fy > sy) {
        pen.dim(xs, Y(sy), xs, Y(fy), null, { color: RED, tick: fs * 0.3 });
        pen.label('ステージ離隔 ' + mm(fy - sy), xs + fs * 0.5, (Y(sy) + Y(fy)) / 2, { color: RED, size: fs * 0.9 });
      }
      // 通路幅
      if (aisle > 0) {
        const ax1 = r1[aisle - 1].x + cw / 2, ax2 = r1[aisle].x - cw / 2, ya = Y(r1[0].y) ;
        pen.dim(X(ax1), ya, X(ax2), ya, null, { color: RED, tick: fs * 0.3 });
        pen.label('通路 ' + mm(ax2 - ax1), (X(ax1) + X(ax2)) / 2, ya - fs * 1.1, { color: RED, size: fs * 0.9 });
      }
    }
  }

  // ------------------------------------------------------------------ 立面図の注記
  function annotateSide(g, pen, T, D) {
    const X = (y) => T.ox + T.panX + y * T.s, Y = (z) => T.oy + T.panY + (T.floorY - z) * T.s;
    const { room, stage, panels, platforms, cameras, seats, chair, monitors } = D;
    const fs = pen.fs;

    // 床面上のオブジェクトを奥行き(Y)の区間にして、間の距離 D を床の下に記載
    const iv = [];
    iv.push({ a: stage.y, b: stage.y + stage.d });
    monitors.forEach(m => {
      if (m.placeOn === 'stage') return;
      iv.push({ a: m.y - 300, b: m.y + 300 });
    });
    seatRows(seats, chair).forEach(r => iv.push({ a: r[0].y - chair.d / 2, b: r[0].y + chair.d / 2 }));
    platforms.forEach(p => iv.push({ a: p.y - p.d / 2, b: p.y + p.d / 2 }));
    ((window.tabSeatsModule && window.tabSeatsModule.getTables && window.tabSeatsModule.getTables()) || []).forEach(t => iv.push({ a: t.y - t.d / 2, b: t.y + t.d / 2 }));   // テーブル
    iv.sort((p, q) => p.a - q.a);
    const merged = [];
    iv.forEach(v => {
      const last = merged[merged.length - 1];
      if (last && v.a <= last.b) last.b = Math.max(last.b, v.b); else merged.push({ a: v.a, b: v.b });
    });
    const yDim = Y(0) + fs * 1.8;
    for (let i = 1; i < merged.length; i++) {
      const gap = merged[i].a - merged[i - 1].b;
      if (gap < 1) continue;
      pen.dim(X(merged[i - 1].b), yDim, X(merged[i].a), yDim, 'D' + mm(gap), { textDy: fs * 1.2, size: fs });
    }

    // ステージ
    pen.dim(X(stage.y + stage.d) + fs * 0.8, Y(0), X(stage.y + stage.d) + fs * 0.8, Y(stage.h), null, { color: INK, tick: fs * 0.3 });
    pen.label('ステージ D' + mm(stage.d) + '×H' + mm(stage.h), X(stage.y + stage.d / 2), Y(0) + fs * 4.4, { color: INK, size: fs * 0.9 });
    // バックパネル
    panels.forEach(p => {
      const base = (window.isInsideStage && window.isInsideStage(p.x + p.w / 2, p.y)) ? stage.h : 0;
      pen.label((p.name || 'バックパネル') + ' H' + mm(p.h) + '×D' + mm(p.d), X(p.y + p.d / 2), Y(base + p.h) - fs * 1.2, { color: '#475569', size: fs * 0.9, dir: -1 });
    });
    // カメラ台 / レンズ高
    platforms.forEach(p => {
      pen.label((p.name || 'カメラ台') + ' D' + mm(p.d) + '×H' + mm(p.h || 0), X(p.y), Y(0) + fs * 4.4, { color: INK, size: fs * 0.9 });
    });
    cameras.forEach(c => {
      const x = X(c.y) + fs * 2.4;
      pen.dim(x, Y(0), x, Y(c.lensH), 'H' + mm(c.lensH), { color: ORANGE, tick: fs * 0.3, textDx: fs * 1.6 });
    });
    // 天井高
    if (room.h) pen.label('天井高 H' + mm(room.h), X(0) + fs * 4, Y(room.h) + fs * 1.2, { color: INK, size: fs * 0.9 });
  }

  // ------------------------------------------------------------------ 寸法表 (余白)
  function tableLines(D, view) {
    const { room, stage, panels, platforms, chair, seats } = D;
    const top = view === 'top';
    const size = (w, d, h) => top ? 'W' + mm(w) + ' × D' + mm(d) + ' × H' + mm(h) : 'D' + mm(d) + ' × H' + mm(h);
    const L = [];
    L.push(['会場', top ? 'W' + mm(room.w) + ' × D' + mm(room.d) + ' × 天井高 H' + mm(room.h || 0) : 'D' + mm(room.d) + ' × 天井高 H' + mm(room.h || 0)]);
    L.push(['ステージ', size(stage.w, stage.d, stage.h)]);
    panels.forEach(p => L.push([p.name || 'バックパネル', size(p.w, p.d, p.h)]));
    platforms.forEach(p => L.push([p.name || 'カメラ台', size(p.w, p.d, p.h || 0)]));
    const reps = (window.tabCameraModule && window.tabCameraModule.getCameraReport && window.tabCameraModule.getCameraReport()) || [];
    reps.forEach(r => { L.push([r.name, 'H-FOV ' + r.hFov.toFixed(1) + '° / V-FOV ' + r.vFov.toFixed(1) + '° / f ' + r.focal.toFixed(1) + 'mm (センサー幅 ' + r.sensorW + 'mm) / レンズ全高 H' + mm(r.lensH) + (r.baseH ? ' (台 ' + mm(r.baseH) + ' + レンズ ' + mm(r.lensH - r.baseH) + ')' : '') +
      ' / 被写体まで ' + (r.dist / 1000).toFixed(1) + 'm (距離はレンズ位置から)']);
      (r.occlusion || []).forEach(o => L.push([r.name + ' 被り', o.name + ': ' + (o.hidden.length ? '被り ' + o.hidden.join('・') : '') + (o.partial.length ? (o.hidden.length ? ' / ' : '') + '一部 ' + o.partial.join('・') : '')]));
    });
    const ds = window.displaySettings || {};
    if (reps.length && ds.showSafeMargin !== false && ds.safePct > 0) L.push(['安全マージン', ds.safePct + '% (図面の橙色の破線 = 余白を残して収める目安の画角)']);
    const groups = (window.tabSeatsModule && window.tabSeatsModule.getGroups && window.tabSeatsModule.getGroups()) || [];
    if (seats.length && groups.length) {
      groups.forEach(gr => {
        if (!gr.count) return;
        const g = gr.grid, t = gr.table;
        L.push([groups.length > 1 ? gr.name : '椅子 / 客席', '席 W' + mm(chair.w) + ' × D' + mm(chair.d) + ' / ' + gr.count + ' 席' +
          ' / 列間隔 ' + mm(g.rowGap) + ' (後脚→次列の前脚) / 席隙間 ' + mm(g.seatGapX) + ' (右脚→左脚)' +
          (t && t.mode !== 'none' ? ' / テーブル ' + (t.mode === 'perSeat' ? 'W' + mm(t.w) + '×' : '') + 'D' + mm(t.d) + '×H' + mm(t.h) + ' (椅子との距離 ' + mm(t.gap) + ')' : '')]);
      });
    }
    return L;
  }

  // ------------------------------------------------------------------ 組み立て
  function buildSheet(minWidth) {
    return window.Core.withExportView(minWidth || 2400, (src, info) => {
      const view = info.view, D = collect();
      const W = src.width;
      // 立面図は天井〜床の下の寸法線までに切り詰める (上の空白を省く)
      let cropY = 0, H = src.height;
      if (view === 'side') {
        const fsz = Math.max(16, Math.round(W / 95));
        cropY = Math.max(0, Math.round(info.panY + (info.floorY - (D.room.h || 5000)) * info.scale - fsz * 3));
        H = Math.min(src.height, Math.round(info.panY + info.floorY * info.scale + fsz * 10)) - cropY;
      }
      const fs = Math.max(16, Math.round(W / 95));
      const sheetW = Math.max(W, fs * 70);
      const ox = Math.round((sheetW - W) / 2);
      const rows = tableLines(D, view);
      const meta = window.exportMeta || {}, metaOn = !!meta.enabled;
      const headH = Math.round(fs * (metaOn ? 5.4 : 3.6)), lineH = Math.round(fs * 1.7);
      const STAMPS = { owl: 'アウル株式会社', owlcraft: 'アウルクラフト株式会社' };
      const stampText = STAMPS[meta.stamp] || '';
      const ds0 = window.displaySettings || {};
      const fins = (ds0.exportFinder !== false && window.tabCameraModule && window.tabCameraModule.renderFinderImages) ? window.tabCameraModule.renderFinderImages(960) : [];
      let finTile = 0, finCols = 0, finH = 0;
      if (fins.length) {
        finCols = Math.min(fins.length, 3);
        finTile = Math.floor((sheetW - fs * 2 - fs * (finCols - 1)) / finCols);
        finTile = Math.min(finTile, Math.round(sheetW * (fins.length === 1 ? 0.5 : 0.32)));
        const rowsN = Math.ceil(fins.length / finCols);
        finH = Math.round(fs * 2.4 + rowsN * (finTile * 9 / 16 + fs * 2.6));
      }
      const tableH = Math.max(Math.round(fs * 1.6 + rows.length * lineH + fs * 1.2), stampText ? Math.round(fs * 5.2) : 0);
      const out = document.createElement('canvas');
      out.width = sheetW; out.height = headH + H + finH + tableH;
      const g = out.getContext('2d');
      g.fillStyle = '#ffffff'; g.fillRect(0, 0, out.width, out.height);
      // 題名
      g.fillStyle = INK; g.textBaseline = 'middle'; g.textAlign = 'left';
      g.font = 'bold ' + Math.round(fs * 1.7) + 'px ' + FONT;
      const title = view === 'top' ? '会場レイアウト (平面図)' : '会場レイアウト (立面図)';
      const d = new Date();
      const today = d.getFullYear() + '/' + (d.getMonth() + 1) + '/' + d.getDate();
      if (!metaOn) {
        g.fillText(title, fs, headH / 2);
        g.font = fs + 'px ' + FONT; g.fillStyle = '#64748b'; g.textAlign = 'right';
        g.fillText('Draw-Simulator MarkⅡ  ' + today + '   単位: mm', sheetW - fs, headH / 2);
      } else {
        g.fillText(title, fs, headH * 0.32);
        const items = [['案件', meta.project], ['クライアント', meta.client], ['会場', meta.venue], ['日付', meta.date || today], ['作成者', meta.author], ['バージョン', meta.version]].filter(it => it[1]);
        g.font = fs + 'px ' + FONT; g.textAlign = 'left'; g.fillStyle = '#334155';
        let x = fs;
        items.forEach(it => {
          const lab = it[0] + ': ', val = it[1];
          g.font = 'bold ' + fs + 'px ' + FONT; g.fillStyle = '#64748b'; g.fillText(lab, x, headH * 0.74);
          x += g.measureText(lab).width;
          g.font = fs + 'px ' + FONT; g.fillStyle = INK; g.fillText(val, x, headH * 0.74);
          x += g.measureText(val).width + fs * 2;
        });
        g.font = fs * 0.85 + 'px ' + FONT; g.fillStyle = '#94a3b8'; g.textAlign = 'right';
        g.fillText('単位: mm', sheetW - fs, headH * 0.32);
      }
      // 図面本体
      g.drawImage(src, 0, cropY, W, H, ox, headH, W, H);
      // 注記
      const pen = makePen(g, fs);
      const T = { ox, oy: headH - cropY, panX: info.panX, panY: info.panY, s: info.scale, floorY: info.floorY };
      g.save();
      g.beginPath(); g.rect(ox, headH, W, H); g.clip();
      try { (view === 'top' ? annotateTop : annotateSide)(g, pen, T, D); }
      catch (e) { window.Core.log('寸法の記載でエラー: ' + e.message, 'error'); }
      g.restore();
      // ファインダー (カメラ位置から見た映り)
      if (fins.length) {
        const fy0 = headH + H + fs * 0.4;
        g.strokeStyle = '#cbd5e1'; g.lineWidth = 2; g.beginPath(); g.moveTo(fs, fy0); g.lineTo(sheetW - fs, fy0); g.stroke();
        g.textBaseline = 'middle'; g.textAlign = 'left'; g.font = 'bold ' + fs + 'px ' + FONT; g.fillStyle = INK;
        g.fillText('ファインダー (カメラ位置から見た映り / 破線 = 安全マージン)', fs, fy0 + fs * 1.1);
        const tileH = finTile * 9 / 16;
        fins.forEach((f, i) => {
          const col = i % finCols, row = Math.floor(i / finCols);
          const fx = fs + col * (finTile + fs), fy = fy0 + fs * 2.4 + row * (tileH + fs * 2.6);
          g.drawImage(f.canvas, fx, fy, finTile, tileH);
          g.strokeStyle = '#475569'; g.lineWidth = Math.max(2, fs / 10); g.strokeRect(fx, fy, finTile, tileH);
          g.font = 'bold ' + Math.round(fs * 0.9) + 'px ' + FONT; g.fillStyle = INK; g.textAlign = 'left';
          g.fillText(f.name + '   ' + f.info, fx, fy + tileH + fs * 1.0);
        });
      }
      // 寸法表
      const ty = headH + H + finH + fs * 0.4;
      g.strokeStyle = '#cbd5e1'; g.lineWidth = 2; g.beginPath(); g.moveTo(fs, ty); g.lineTo(sheetW - fs, ty); g.stroke();
      g.textBaseline = 'middle';
      rows.forEach((r, i) => {
        const yy = ty + fs * 1.1 + i * lineH;
        g.textAlign = 'left'; g.font = 'bold ' + fs + 'px ' + FONT; g.fillStyle = INK; g.fillText(r[0], fs, yy);
        g.font = fs + 'px ' + FONT; g.fillStyle = '#334155'; g.fillText(r[1], fs + fs * 11, yy);
      });
      if (stampText) {   // 右下の刻印: 枠つきの社名
        const sf = Math.round(fs * 1.5);
        g.font = 'bold ' + sf + 'px ' + FONT;
        const tw = g.measureText(stampText).width, bw = tw + sf * 1.6, bh = sf * 2.1;
        const bx = sheetW - fs - bw, by = out.height - fs * 0.8 - bh;
        g.save();
        g.strokeStyle = '#334155'; g.lineWidth = Math.max(2, fs / 8);
        g.beginPath(); g.roundRect(bx, by, bw, bh, sf * 0.25); g.stroke();
        g.fillStyle = '#334155'; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText(stampText, bx + bw / 2, by + bh / 2 + sf * 0.05);
        g.restore();
      }
      return { canvas: out, view };
    });
  }

  // ------------------------------------------------------------------ PNG / PDF
  /** ファイル名: クライアント名_日付(YYYYMMDD)_バージョン_平面図|立面図。案件情報がオフ/未入力なら従来名 */
  function fileName(view, ext) {
    const m = window.exportMeta || {}, kind = view === 'top' ? '平面図' : '立面図';
    if (!m.enabled || !m.client) return 'Venue_' + (view === 'top' ? 'plan' : 'elevation') + '.' + ext;
    const d = new Date(), pad = (n) => String(n).padStart(2, '0');
    const nums = (m.date || '').split(/\D+/).filter(Boolean);
    const date = (nums.length === 3 ? nums[0] + pad(+nums[1]) + pad(+nums[2]) : nums.join('')) || (d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()));
    const parts = [m.client, date, m.version, kind].filter(Boolean).map(v => String(v).trim().replace(/[\\/:*?"<>|\s]+/g, '_'));
    return parts.join('_') + '.' + ext;
  }

  function exportPng() {
    const r = buildSheet(2400);
    r.canvas.toBlob(blob => {
      if (!blob) { window.Core.log('画像出力に失敗しました', 'error'); return; }
      window.Core.download(blob, fileName(r.view, 'png'));
      window.Core.log('画像を出力しました (寸法つき)', 'info');
    }, 'image/png');
  }

  /** JPEG 1枚だけのPDFを組み立てる (A4・図面の縦横に合わせて向きを決定) */
  function makePdf(jpegBytes, imgW, imgH) {
    const land = imgW >= imgH;
    const PW = land ? 842 : 595, PH = land ? 595 : 842, M = 18;
    const k = Math.min((PW - M * 2) / imgW, (PH - M * 2) / imgH);
    const w = imgW * k, h = imgH * k, x = (PW - w) / 2, y = (PH - h) / 2;
    const enc = new TextEncoder();
    const parts = [], offs = [];
    let len = 0;
    const push = (u8) => { parts.push(u8); len += u8.length; };
    const str = (s) => push(enc.encode(s));
    const obj = (n, body) => { offs[n] = len; str(n + ' 0 obj\n'); body(); str('\nendobj\n'); };
    str('%PDF-1.4\n');
    obj(1, () => str('<< /Type /Catalog /Pages 2 0 R >>'));
    obj(2, () => str('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'));
    obj(3, () => str('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + PW + ' ' + PH + '] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>'));
    obj(4, () => {
      str('<< /Type /XObject /Subtype /Image /Width ' + imgW + ' /Height ' + imgH + ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + jpegBytes.length + ' >>\nstream\n');
      push(jpegBytes); str('\nendstream');
    });
    const content = 'q ' + w.toFixed(2) + ' 0 0 ' + h.toFixed(2) + ' ' + x.toFixed(2) + ' ' + y.toFixed(2) + ' cm /Im0 Do Q';
    obj(5, () => str('<< /Length ' + content.length + ' >>\nstream\n' + content + '\nendstream'));
    const xref = len;
    str('xref\n0 6\n0000000000 65535 f \n');
    for (let i = 1; i <= 5; i++) str(String(offs[i]).padStart(10, '0') + ' 00000 n \n');
    str('trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF');
    const buf = new Uint8Array(len); let p = 0;
    parts.forEach(u => { buf.set(u, p); p += u.length; });
    return buf;
  }

  function exportPdf() {
    const r = buildSheet(3000);
    const url = r.canvas.toDataURL('image/jpeg', 0.95);
    const bin = atob(url.split(',')[1]);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const pdf = makePdf(bytes, r.canvas.width, r.canvas.height);
    window.Core.download(new Blob([pdf], { type: 'application/pdf' }), fileName(r.view, 'pdf'));
    window.Core.log('PDFを出力しました (寸法つき)', 'info');
  }

  window.ExportSheet = { exportPng, exportPdf, buildSheet };
})();
