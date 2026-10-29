/**
 * ==============================================================================
 * camera_angle.js — カメラ角度・光学画角・頭被り判定・必要レンズ高の逆算
 *
 * 外部依存ゼロの純粋な幾何/光学エンジン (window や DOM を一切参照しない)。
 * 必要なデータ (客席・登壇者・ステージ・頭頂高) はすべて引数で受け取る。
 *
 * 座標系: x=X, y=Y (平面図), 高さ=Z [mm]。
 *   pan 0° = 平面図で上 (−Y) 向き。hAngle = atan2(dy, dx), pan = hAngle + 90°
 * ==============================================================================
 */
window.CameraAngle = (function () {
  'use strict';

  const DEG = 180 / Math.PI;
  const RAD = Math.PI / 180;
  const DEFAULT_HEAD_Z = 1270;

  function asArray(v) {
    if (Array.isArray(v)) return v;
    if (v && typeof v === 'object') {
      if (Array.isArray(v.list)) return v.list;
      if (Array.isArray(v.seats)) return v.seats;
    }
    return [];
  }

  function inStage(x, y, st) {
    return !!st && x >= st.x && x <= st.x + st.w && y >= st.y && y <= st.y + st.d;
  }


  // 構図 (ショットサイズ): 頭頂から「どこまで映すか」
  const FRAMING = {
    FF: { label: '全身 (FF)' },
    KS: { label: '膝上 (KS)' },
    WS: { label: '腰上 (WS)' },
    BS: { label: '胸上 (BS)' },
    CU: { label: '肩上 (CU)' }
  };
  const STAND_CUT = { FF: 0, KS: 0.28, WS: 0.52, BS: 0.72, CU: 0.84 };   // 立ち姿: 身長に対する切る位置
  const SEAT_CUT  = { KS: 0, WS: 0.25, BS: 0.5, CU: 0.7 };               // 着席: 座面から頭頂までに対する位置

  /** 登壇者1名について映すべき高さ範囲 {top, bottom} (絶対Z mm)。FF は足元(床/ステージ面)まで */
  function framingRange(g, framing, st) {
    const base = (typeof g.baseZ === 'number') ? g.baseZ : (inStage(g.x, g.y, st) ? (st.h || 0) : 0);
    const top = base + (g.h || 1500);
    let bottom = base;
    if (framing !== 'FF') {
      const seated = g.type && g.type !== 'standing' && typeof g.seatH === 'number';
      if (seated) bottom = base + g.seatH + SEAT_CUT[framing] * Math.max(top - base - g.seatH, 0);
      else bottom = base + STAND_CUT[framing] * (top - base);
    }
    return { top, bottom };
  }

  /** 水平画角 → 16:9 の垂直画角 (度) */
  function getVerticalFov(hFovDeg) {
    if (!hFovDeg || hFovDeg <= 0) return 0;
    return 2 * Math.atan(Math.tan(hFovDeg * RAD / 2) * (9 / 16)) * DEG;
  }

  /** 幅 reqWidth を距離 dist で画面いっぱいに収める水平画角 (度) */
  function fovForWidth(reqWidth, dist) {
    return Math.max(0.5, 2 * Math.atan((reqWidth / 2) / Math.max(dist, 1)) * DEG);
  }

  /**
   * ショットタイプから照準点・画角・パン/チルトを算出する。
   * 自動ショットでは cam.fov に結果を書き戻す (UI の画角表示と一致させるため)。
   * @param {Object} cam           カメラ {x,y,lensH,model,shotType,targetGuestId,fov,pan,tilt}
   * @param {Object} stage         {x,y,w,d,h}
   * @param {Array}  guests        登壇者 [{id,x,y,h}]
   * @param {Object} models        CameraBase.CAMERA_MODELS
   */
  function calculateAimAndFov(cam, stage, guests, models) {
    const c = cam || {};
    const st = stage || { x: 0, y: 0, w: 10000, d: 3000, h: 800 };
    const gs = asArray(guests);
    const defs = models || {};
    let modelDef = defs[c.model] || defs.nx5r || { minFov: 2.0, maxFov: 60.0 };
    if (modelDef.fWide && modelDef.fTele) {            // 実レンズの焦点距離の範囲から、このカメラの画角の限界を出す
      const sw = c.sensorW > 0 ? c.sensorW : modelDef.sensorW;
      modelDef = Object.assign({}, modelDef, { minFov: fovFromFocal(modelDef.fTele, sw), maxFov: fovFromFocal(modelDef.fWide, sw) });
    }

    let tx = st.x + st.w / 2;
    let ty = st.y + st.d;
    let tz = st.h + 1200;
    let fov = c.fov || 40;
    let status = 'ok';
    let isTeleLimit = false;
    let reqWidth = 0;
    let frame = null;
    let dist = Math.hypot(tx - c.x, ty - c.y);

    if (c.shotType === 'stage_ff') {
      reqWidth = st.w;
      fov = fovForWidth(reqWidth, dist) + 4.0;
      tz = st.h + 2200;
      if (fov > modelDef.maxFov) status = 'wide_limit';

    } else if (c.shotType === 'guest_group' || c.shotType === 'guest_single') {
      let tg = gs;
      if (c.shotType === 'guest_single') {
        const g = gs.find(v => v.id === c.targetGuestId) || gs[0];
        tg = g ? [g] : [];
      }
      if (tg.length > 0) {
        const xs = tg.map(g => g.x), ys = tg.map(g => g.y);
        const minX = Math.min.apply(null, xs), maxX = Math.max.apply(null, xs);
        tx = (minX + maxX) / 2;
        ty = ys.reduce((a, v) => a + v, 0) / ys.length;
        // 左右の余白: 現場のカメラマンは身振り手振りの分を残すので、ぎりぎりには寄せない (既定 単独1150 / 集合1400mm)
        const autoMargin = (typeof c.autoMargin === 'number' && c.autoMargin >= 0) ? c.autoMargin : (c.shotType === 'guest_single' ? 1150 : 1400);
        reqWidth = (maxX - minX) + autoMargin;

        // 構図 (FF 全身 / KS 膝上 / WS 腰上 / BS 胸上 / CU 肩上) から、映すべき高さの範囲を決める
        const fr = FRAMING[c.framing] ? c.framing : 'FF';
        const ranges = tg.map(g => framingRange(g, fr, st));
        const subjTop = Math.max.apply(null, ranges.map(r => r.top));
        const subjBot = Math.min.apply(null, ranges.map(r => r.bottom));
        const ext = Math.max(subjTop - subjBot, 200);
        const zt = subjTop + Math.max(100, ext * 0.06);     // 頭上の余白
        const zb = subjBot - ext * 0.03;                    // 足元の余白
        tz = (zt + zb) / 2;                                 // 範囲の中央を狙う → チルトが決まる

        const ground0 = Math.hypot(tx - c.x, ty - c.y);
        const slant = Math.hypot(ground0, tz - (c.lensH || 0));
        dist = ground0;
        const vNeed = 2 * Math.atan(((zt - zb) / 2) / Math.max(slant, 1)) * DEG;           // 縦で必要な画角
        const hFromV = 2 * Math.atan(Math.tan(vNeed * RAD / 2) * (16 / 9)) * DEG;          // それを横画角に換算
        const ideal = Math.max(hFromV, fovForWidth(reqWidth, slant));
        if (ideal < modelDef.minFov) { fov = modelDef.minFov; isTeleLimit = true; status = 'tele_limit'; }
        else if (ideal > modelDef.maxFov) { fov = modelDef.maxFov; status = 'wide_limit'; }
        else fov = ideal;

        const halfV = getVerticalFov(fov) * RAD / 2;
        const covTop = tz + slant * Math.tan(halfV), covBot = tz - slant * Math.tan(halfV);
        frame = {
          framing: fr, label: FRAMING[fr].label,
          subjectTop: subjTop, subjectBottom: subjBot,
          coverTop: covTop, coverBottom: covBot,
          fits: covTop >= subjTop - 1 && covBot <= subjBot + 1
        };
      }
    }

    const manual = (c.shotType === 'manual' || c.shotType === 'manual_angle');
    if (!manual) {
      fov = Math.min(modelDef.maxFov, Math.max(modelDef.minFov, fov));
      c.fov = fov;
    }

    let hAngle = Math.atan2(ty - c.y, tx - c.x);
    let panDeg = hAngle * DEG + 90;
    const groundDist = Math.hypot(tx - c.x, ty - c.y);
    let tiltDeg = Math.atan2(tz - (c.lensH || 0), Math.max(groundDist, 1)) * DEG;

    if (c.shotType === 'manual_angle') {
      panDeg = c.pan || 0;
      tiltDeg = c.tilt || 0;
      hAngle = (panDeg - 90) * RAD;
      const look = 10000;
      tx = c.x + look * Math.cos(hAngle);
      ty = c.y + look * Math.sin(hAngle);
      tz = (c.lensH || 0) + look * Math.tan(tiltDeg * RAD);
      fov = c.fov;
    }

    return {
      angle: hAngle, hAngle, panDeg, tiltDeg,
      fov, vFov: getVerticalFov(fov),
      targetX: tx, targetY: ty, targetZ: tz,
      isTeleLimit, status, modelDef, reqWidth, dist, frame
    };
  }

  /**
   * 水平画角内かつカメラとターゲットの間にある座席を列挙する共通処理。
   * 各要素: { seat, distProj }
   */
  function seatsInCone(cam, aim, seatList, size) {
    const out = [];
    const dx = aim.targetX - cam.x, dy = aim.targetY - cam.y;
    const groundDist = Math.hypot(dx, dy);
    if (groundDist < 1e-4) return { groundDist, list: out };
    const aimAngle = Math.atan2(dy, dx);
    const halfFov = aim.fov * RAD / 2;
    const angDiff = (px, py) => {
      let d = Math.atan2(py - cam.y, px - cam.x) - aimAngle;
      while (d > Math.PI) d -= 2 * Math.PI;
      while (d < -Math.PI) d += 2 * Math.PI;
      return d;
    };
    const hw = size && size.w ? size.w / 2 : 0, hd = size && size.d ? size.d / 2 : 0;

    seatList.forEach(s => {
      if (!s) return;
      const diff = angDiff(s.x, s.y);
      // 席の中心が画角内、または席の端 (四隅・各辺の中点) が少しでも画角に掛かっていれば対象にする
      let inside = Math.abs(diff) <= halfFov;
      if (!inside && (hw || hd)) {
        const r = (s.angle || 0) * RAD, c = Math.cos(r), sn = Math.sin(r);
        inside = [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd], [0, -hd], [0, hd], [-hw, 0], [hw, 0]].some(q =>
          Math.abs(angDiff(s.x + q[0] * c - q[1] * sn, s.y + q[0] * sn + q[1] * c)) <= halfFov);
      }
      if (!inside) return;
      const distProj = Math.hypot(s.x - cam.x, s.y - cam.y) * Math.cos(diff);
      if (distProj > 0 && distProj < groundDist) out.push({ seat: s, distProj });
    });
    return { groundDist, list: out };
  }

  /**
   * 頭被り判定: 垂直画角の下端レイが着席時の頭頂より低い座席 = 見切れ
   * @returns {Array} 遮蔽している座席
   */
  function checkHeadBlock(cam, aim, seats, headZ, seatSize) {
    const seatList = asArray(seats);
    if (!cam || !aim || seatList.length === 0) return [];
    const hz = (typeof headZ === 'number' && !isNaN(headZ)) ? headZ : DEFAULT_HEAD_Z;
    const camZ = cam.lensH || 1600;
    const tgtZ = typeof aim.targetZ === 'number' ? aim.targetZ : 1200;

    const { groundDist, list } = seatsInCone(cam, aim, seatList, seatSize);
    const halfV = getVerticalFov(aim.fov) * RAD / 2;
    const thetaLower = Math.atan2(tgtZ - camZ, groundDist) - halfV;

    return list
      .filter(e => camZ + e.distProj * Math.tan(thetaLower) < hz)
      .map(e => e.seat);
  }

  /**
   * 頭被り判定 + 全座席をクリアするために必要なレンズ高の逆算
   * @param {number} [margin=50] 視線と頭頂の離隔 (mm)
   * @param {{w:number,d:number}} [seatSize] 席の寸法。渡すと、席の端が少しでも画角に掛かる席も判定する
   */
  function simulateHeightClearance(cam, aim, seats, headZ, margin, seatSize) {
    const seatList = asArray(seats);
    const hz = (typeof headZ === 'number' && !isNaN(headZ)) ? headZ : DEFAULT_HEAD_Z;
    const mg = (typeof margin === 'number') ? margin : 50;
    const c = cam || {};
    const camZ = c.lensH || 1600;
    const tgtZ = (aim && typeof aim.targetZ === 'number') ? aim.targetZ : 1200;

    let maxReq = camZ;
    let worstSeat = null;
    const blocked = [];

    if (aim && seatList.length > 0) {
      const { groundDist, list } = seatsInCone(c, aim, seatList, seatSize);
      const halfV = getVerticalFov(aim.fov) * RAD / 2;
      const tanHalfV = Math.tan(halfV);
      const thetaLower = Math.atan2(tgtZ - camZ, groundDist) - halfV;
      const targetH = hz + mg;

      list.forEach(({ seat, distProj }) => {
        if (camZ + distProj * Math.tan(thetaLower) < hz) blocked.push(seat);

        // 下端レイが targetH 以上になるレンズ高 reqCamZ を二次方程式で逆算
        //   reqCamZ + distProj * tan(atan2(tgtZ - reqCamZ, groundDist) - halfV) = targetH
        const C = tgtZ - targetH;
        const a = groundDist * tanHalfV;
        const b = (groundDist - distProj) - C * tanHalfV;
        const cc = -(C - distProj * tanHalfV);
        const disc = b * b - 4 * a * cc;
        let req;
        if (a > 1e-6 && disc >= 0) {
          req = tgtZ - groundDist * ((-b + Math.sqrt(disc)) / (2 * a));
        } else {
          const t = distProj / groundDist;
          req = ((targetH + distProj * tanHalfV) - t * tgtZ) / Math.max(1 - t, 0.001);
        }
        if (req > maxReq) { maxReq = req; worstSeat = seat; }
      });
    }

    return {
      isBlocked: blocked.length > 0,
      blockedSeats: blocked,
      blockedCount: blocked.length,
      currentLensH: camZ,
      requiredLensH: Math.ceil(maxReq),
      neededHeightDelta: Math.max(0, Math.ceil(maxReq - camZ)),
      headZ: hz,
      worstSeat
    };
  }

  /** サマリーテキスト。seatCount は呼び出し側が渡す */
  function generateSummaryText(cam, aim, clearance, seatCount) {
    if (!cam || !aim) return 'カメラ情報がありません';
    const shot = {
      stage_ff: 'ステージ全景', guest_group: '登壇者集合',
      guest_single: '単一登壇者', manual_angle: '手動アングル'
    }[cam.shotType] || cam.shotType || '標準';
    const f = (v) => (typeof v === 'number' && isFinite(v)) ? v.toFixed(1) + '°' : '-';

    let s = '【' + (cam.name || cam.id || 'カメラ') + '】\n';
    s += '・ショットタイプ: ' + shot + '\n';
    s += '・画角: H-FOV ' + f(aim.fov) + ' / V-FOV(16:9) ' + f(aim.vFov) + '\n';
    s += '・アングル: パン ' + f(aim.panDeg) + ' / チルト ' + f(aim.tiltDeg) + '\n';
    if (aim.frame) {
      const fr = aim.frame, r = v => Math.round(v);
      s += '・構図: ' + fr.label + ' (頭頂 ' + r(fr.subjectTop) + ' 〜 ' + r(fr.subjectBottom) + ' mm) ' +
           (fr.fits ? '✅収まります' : '⚠️収まりません (映る範囲 ' + r(fr.coverBottom) + ' 〜 ' + r(fr.coverTop) + ' mm)') + '\n';
    }
    if (typeof seatCount === 'number') s += '・客席数: ' + seatCount + ' 席\n';
    if (clearance) {
      if (clearance.isBlocked) {
        s += '・視野干渉: ' + clearance.blockedCount + ' 席 (⚠️頭被りあり)\n';
        s += '・対策: イントレ台/レンズ高さをあと +' + clearance.neededHeightDelta + ' mm 上げてください';
      } else {
        s += '・視野干渉: 0 席 (✅クリア)';
      }
    }
    return s;
  }

  /** 水平画角 (度) → 焦点距離 (mm)。sensorW=センサー幅 (mm) */
  function focalFromFov(hFovDeg, sensorW) {
    if (!hFovDeg || hFovDeg <= 0 || !sensorW) return 0;
    return sensorW / (2 * Math.tan(hFovDeg * RAD / 2));
  }
  /** 焦点距離 (mm) → 水平画角 (度) */
  function fovFromFocal(f, sensorW) {
    if (!f || f <= 0 || !sensorW) return 0;
    return 2 * Math.atan(sensorW / (2 * f)) * DEG;
  }

  return { FRAMING, focalFromFov, fovFromFocal, framingRange, getVerticalFov, calculateAimAndFov, checkHeadBlock, simulateHeightClearance, generateSummaryText };
})();
