/**
 * ==============================================================================
 * tab12_ai_gen.js — 【AI自動生成】 Gemini でレイアウトを生成して各タブへ流し込む
 *
 * 方式は従来どおり (APIキーは内部保持・UI入力なし / モデル多段フォールバック / JSONのみ応答)。
 * 変更点: 各タブへの反映を Core.batch + 各モジュールの正しい importData 形式に統一し、
 *         生成全体を Undo 1回で元に戻せるようにした。
 * ==============================================================================
 */
(function () {
  'use strict';

  // APIキー (UI には出さず内部保持。従来方針を維持)
  const INTERNAL_API_KEY = 'AQ.Ab8RN6KJGpu-NbTRKYTpVfW8mSQIsy5L0SOpyuhNb9uSr9ukZg';

  const U = window.Core.util;
  const { $ } = U;

  let imageBase64 = null;
  let imageMime = null;

  // ---------------------------------------------------------------- UI
  function buildUI(panel) {
    if (!panel) return;
    panel.innerHTML = `
      <div class="ui-group">
        <div class="ui-group-title"><span>🖼️ 白図・平面図画像 (任意)</span><button class="btn-action sm" id="aiBtnClearImg">✕ 画像クリア</button></div>
        <div class="input-box"><label>会場白図 / 建築図面 (PNG/JPG)</label><input type="file" id="aiFloorPlanFile" accept="image/*"></div>
        <div id="aiImagePreviewContainer" class="hidden" style="text-align:center; border:1px dashed #cbd5e1; border-radius:4px; padding:4px; background:#fff;">
          <img id="aiImagePreview" alt="プレビュー" style="max-height:100px; max-width:100%; object-fit:contain;">
          <div id="aiImageMeta" class="hint"></div>
        </div>
      </div>
      <div class="ui-group">
        <div class="ui-group-title">💬 レイアウト要望・設計プロンプト</div>
        <div class="input-box">
          <textarea id="aiPromptInput" rows="6" style="resize:vertical; line-height:1.4;" placeholder="例: 間口18m、奥行28mの展示場。ステージ幅10m、登壇者3名と司会台。客席160席を3ブロック（通路1200mm）。客席後ろに前頭被りしないENGメインカメラ2台と返しモニター2台を配置。"></textarea>
        </div>
        <button class="btn-action btn-accent" id="btnRunAiGen" style="padding:9px;">⚡ AIでレイアウト自動生成</button>
        <div id="aiStatusBox" class="readout hidden"></div>
      </div>`;

    $('aiFloorPlanFile').addEventListener('change', onImage);
    $('aiBtnClearImg').addEventListener('click', () => {
      imageBase64 = imageMime = null;
      $('aiFloorPlanFile').value = '';
      $('aiImagePreviewContainer').classList.add('hidden');
      setStatus('添付画像をクリアしました');
    });
    $('btnRunAiGen').addEventListener('click', run);
  }

  function onImage(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    imageMime = file.type || 'image/png';
    const reader = new FileReader();
    reader.onload = ev => {
      imageBase64 = String(ev.target.result).split(',')[1];
      $('aiImagePreview').src = ev.target.result;
      $('aiImagePreviewContainer').classList.remove('hidden');
      $('aiImageMeta').innerText = file.name + ' (' + Math.round(file.size / 1024) + ' KB)';
      setStatus('白図画像を読み込みました。要望と合わせてAIへ送信されます。');
    };
    reader.readAsDataURL(file);
  }

  function setStatus(msg, kind) {
    const box = $('aiStatusBox');
    if (!box) return;
    box.classList.remove('hidden', 'ok', 'bad');
    if (kind) box.classList.add(kind);
    box.textContent = msg;
  }

  // ---------------------------------------------------------------- プロンプト
  function buildSystemPrompt() {
    return `あなたはイベント設営・舞台美術・ENGカメラ中継の熟練チーフプランナーです。
ユーザーの指示、または添付された白図画像を解析し、正確で整合性の取れた空間レイアウトJSONを生成してください。

【厳格な物理・空間ルール】
1. 単位はすべてミリメートル(mm)、角度は度(deg)です。座標原点(0,0)は部屋の左上(奥・下手端)です。
2. 会場(room):
   - w(間口幅): 8000〜40000mm、d(奥行): 10000〜60000mm、h(天井高): 3500〜8000mm。
3. ステージ(stage):
   - 幅(w)は会場幅の50%〜70%を確保すること。
   - 奥行(d)は2000〜5000mm、高さ(h)は400〜1000mm。
   - x座標は会場中央に対称配置（x = (room.w - stage.w) / 2）。奥壁からy=800〜1500mm離隔。
4. 司会台(podium):
   - 幅900mm、奥行600mm、高さ1100mm。ステージ上の上手または下手の見切れのない位置に配置。
5. 客席(seats / seatLayout):
   - 席幅480〜500mm、列間隔(rowGap)=前列の後ろ脚から次列の前脚までの距離で400〜500mm。
   - 消防法に準拠し、中央主通路幅(aisleW)は1200mm以上を確保すること。
   - ステージ前縁から最前列の前脚までは2000〜3000mm離隔(stageDist)。
6. カメラ(cameras):
   - 客席最後列から1000〜2000mm後方に配置。
   - 客席の観客頭頂高（Z=1270mm）による前頭被りを防止するため、カメラ台座(イントレ platH)の高さを適切に算出（200〜800mm）して配置すること。
   - lensH(レンズ高)は通常 1550〜1750mm。機種は "nx5r", "eng_std", "eng_ext" のいずれか。
7. 返しモニター(monitors):
   - ステージ前端の中央または左右に、登壇者に向けて床置き(placeOn: "floor", tilt: 25)で配置。

【出力要件】
余計な解説、挨拶、前置き、Markdownコードブロック（\`\`\`json等）は一切含めず、純粋なJSONオブジェクトのみを出力してください。

{
  "room": { "w": 16000, "d": 24000, "h": 5000 },
  "stage": { "x": 3000, "y": 1000, "w": 10000, "d": 2500, "h": 600 },
  "podium": { "enabled": true, "w": 900, "d": 600, "h": 1100, "angle": 15, "x": 3500, "y": 2000, "hasHost": true },
  "panels": [
    { "name": "バックパネル 1", "w": 6000, "d": 100, "h": 2400, "x": 5000, "y": 1000, "enabled": true }
  ],
  "seatConfig": {
    "rows": 12,
    "rowGap": 450,
    "blockCols": "4,6,4",
    "aisleW": 1200,
    "stageDist": 2500
  },
  "guests": [
    { "name": "登壇者 1", "type": "high_chair", "h": 750, "x": 8000, "y": 2200 }
  ],
  "cameras": [
    { "name": "CAM 1 (正面メイン)", "model": "nx5r", "lensH": 1700, "fov": 38, "shotType": "stage_ff", "platW": 1000, "platD": 1000, "platH": 400, "x": 8000, "y": 18000, "pan": 0, "tilt": 0 }
  ],
  "monitors": [
    { "name": "返しモニター 1 (50\\")", "size": "50", "x": 8000, "y": 3600, "placeOn": "floor", "panAngle": 0, "tilt": 25, "w": 1110, "h": 625, "baseW": 680, "baseD": 550, "fov": 90 }
  ]
}`;
  }

  // ---------------------------------------------------------------- API 呼び出し (多段フォールバック)
  async function run() {
    const btn = $('btnRunAiGen');
    const userPrompt = $('aiPromptInput').value.trim();
    if (!userPrompt && !imageBase64) {
      setStatus('❌ 要望プロンプトを入力するか、白図画像をアップロードしてください。', 'bad');
      return;
    }

    btn.disabled = true;
    btn.innerText = '⏳ AI推論エンジン準備中...';
    try {
      setStatus('🔑 利用可能なAIモデルのリストを確認中...');
      const listRes = await fetch('https://generativelanguage.googleapis.com/v1beta/models?key=' + INTERNAL_API_KEY);
      let usable = [];
      if (listRes.ok) {
        const j = await listRes.json();
        usable = (j.models || []).filter(m =>
          Array.isArray(m.supportedGenerationMethods) && m.supportedGenerationMethods.includes('generateContent') && !m.name.includes('2.5') && !/gemma|embed|aqa|imagen|image|tts|audio|live|vision|learnlm/i.test(m.name));
      }

      const priority = ['gemini-3.8-flash', 'gemini-1.5-flash', 'gemini-1.5-flash-latest', 'gemini-1.5-pro', 'gemini-1.5-pro-latest'];
      const candidates = [];
      priority.forEach(p => {
        const f = usable.find(m => m.name.includes(p));
        if (f && !candidates.includes(f.name)) candidates.push(f.name);
      });
      usable.forEach(m => { if (!candidates.includes(m.name)) candidates.push(m.name); });
      if (!candidates.length) candidates.push('models/gemini-3.8-flash', 'models/gemini-1.5-flash', 'models/gemini-1.5-pro');

      const sysText = buildSystemPrompt();
      const parts = [];
      if (imageBase64) {
        parts.push({ inline_data: { mime_type: imageMime || 'image/png', data: imageBase64 } });
        parts.push({ text: '添付された会場平面図の障害物・柱・形状を正確に読み取り、それに適応したレイアウトを設計してください。' });
      }
      if (userPrompt) parts.push({ text: '【ユーザーの個別要望・会場条件】\n' + userPrompt });
      parts.push({ text: '上記の条件に従い、指定のJSONオブジェクトのみを出力してください。指示文や説明を繰り返してはいけません。' });

      /** 1モデルに1回問い合わせる。指示文は systemInstruction で渡し、非対応モデルでは本文に入れ直す */
      async function ask(path, useSys) {
        const body = {
          contents: [{ role: 'user', parts: useSys ? parts : [{ text: sysText }].concat(parts) }],
          generationConfig: { responseMimeType: 'application/json', temperature: 0.2 }
        };
        if (useSys) body.systemInstruction = { parts: [{ text: sysText }] };
        const res = await fetch('https://generativelanguage.googleapis.com/v1beta/' + path + ':generateContent?key=' + INTERNAL_API_KEY, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
        });
        if (!res.ok) {
          let detail = 'HTTP ' + res.status + ' ' + res.statusText;
          try { const ej = await res.json(); if (ej.error && ej.error.message) detail = ej.error.message; } catch (_) { /* noop */ }
          const e = new Error(detail); e.status = res.status; throw e;
        }
        const data = await res.json();
        const ps = data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts;
        const text = ps ? ps.map(x => x.text || '').join('') : '';
        if (!text) throw new Error('空の応答');
        return text;
      }

      // 応答が「JSONとして読めて、会場(room)かステージ(stage)を含む」ものだけを採用する。
      // 指示文のオウム返しや壊れたJSONは、そのモデルを再試行 → だめなら次のモデルへ
      let layoutRaw = null, usedModel = '', lastError = '';
      outer:
      for (let i = 0; i < candidates.length; i++) {
        const path = candidates[i], short = path.replace('models/', '');
        let useSys = true;
        for (let attempt = 1; attempt <= 2; attempt++) {
          setStatus('⚡ AI空間設計を実行中... (モデル ' + (i + 1) + '/' + candidates.length + ': ' + short + (attempt > 1 ? ' / 再試行' : '') + ')');
          btn.innerText = '⏳ 設計中 (' + short + ')...';
          try {
            let text;
            try { text = await ask(path, useSys); }
            catch (err) {
              if (useSys && err.status === 400) { useSys = false; text = await ask(path, false); }   // systemInstruction 非対応モデル
              else throw err;
            }
            const obj = cleanAndParseJson(text);
            if (!obj || typeof obj !== 'object' || (!obj.room && !obj.stage)) throw new Error('レイアウトのJSONではない応答');
            layoutRaw = obj; usedModel = short; break outer;
          } catch (err) {
            lastError = short + ': ' + String(err.message).split('\n')[0];
            if (err.status && err.status !== 429 && err.status < 500) break;       // 認証・対応外などは同じモデルを繰り返さない
          }
        }
      }
      if (!layoutRaw) throw new Error('全候補モデルで有効なレイアウトを得られませんでした。\n最新エラー: ' + lastError);

      const layout = clampLayoutToBounds(layoutRaw);
      applyLayout(layout);
      setStatus('✅ AIレイアウトを生成し、全タブへ反映しました (使用モデル: ' + usedModel + ')。「戻す」で元に戻せます。', 'ok');
      window.debugBox && window.debugBox.info('AI生成完了: ' + usedModel);
    } catch (err) {
      console.error('[tab12_ai_gen]', err);
      setStatus('❌ 生成失敗: ' + err.message, 'bad');
    } finally {
      btn.disabled = false;
      btn.innerText = '⚡ AIでレイアウト自動生成';
    }
  }

  // ---------------------------------------------------------------- 応答の整形
  function cleanAndParseJson(str) {
    if (typeof str !== 'string') throw new Error('パース対象が文字列ではありません');
    const s = str.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    try { return JSON.parse(s); } catch (_) { /* 前後に文章が付いた場合は下で { } を探す */ }
    // 文中の { ... } を括弧の対応で切り出し、JSONとして読めたもののうち最大のものを採用する
    let best = null;
    for (let i = 0; i < s.length; i++) {
      if (s[i] !== '{') continue;
      let depth = 0, inStr = false, esc = false;
      for (let j = i; j < s.length; j++) {
        const c = s[j];
        if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
        if (c === '"') inStr = true;
        else if (c === '{') depth++;
        else if (c === '}' && --depth === 0) {
          try { const o = JSON.parse(s.substring(i, j + 1)); if (!best || (j + 1 - i) > best.len) best = { o, len: j + 1 - i }; } catch (_) { /* 次へ */ }
          break;
        }
      }
    }
    if (best) return best.o;
    throw new Error('JSON構文エラー: AI応答のパースに失敗しました\n生データ:\n' + str.substring(0, 150) + '...');
  }

  /** 会場の範囲内に座標・寸法を収める */
  function clampLayoutToBounds(layout) {
    if (!layout || typeof layout !== 'object') throw new Error('AI応答がオブジェクトではありません');
    const R = (layout.room || {});
    const rW = Math.max(5000, Number(R.w) || window.room.w || 16000);
    const rD = Math.max(5000, Number(R.d) || window.room.d || 24000);
    const rH = Math.max(2500, Number(R.h) || window.room.h || 5000);
    layout.room = { w: rW, d: rD, h: rH, shapeType: 'rect', points: [{ x: 0, y: 0 }, { x: rW, y: 0 }, { x: rW, y: rD }, { x: 0, y: rD }] };

    const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

    if (layout.stage) {
      const sw = clamp(Number(layout.stage.w) || 8000, 2000, rW);
      const sd = clamp(Number(layout.stage.d) || 2400, 1500, rD * 0.4);
      const sh = clamp(Number(layout.stage.h) || 600, 200, 1500);
      layout.stage = {
        w: sw, d: sd, h: sh,
        x: clamp(Number(layout.stage.x) || (rW - sw) / 2, 0, rW - sw),
        y: clamp(Number(layout.stage.y) || 1000, 0, rD - sd)
      };
    }
    if (layout.podium) {
      const pw = Number(layout.podium.w) || 900, pd = Number(layout.podium.d) || 600;
      layout.podium.x = clamp(Number(layout.podium.x) || 1000, 0, rW - pw);
      layout.podium.y = clamp(Number(layout.podium.y) || 1500, 0, rD - pd);
    }
    if (Array.isArray(layout.guests)) {
      layout.guests.forEach((g, i) => {
        g.id = g.id || 'G' + (i + 1);
        g.x = clamp(Number(g.x) || rW / 2, 200, rW - 200);
        g.y = clamp(Number(g.y) || 2000, 200, rD - 200);
        g.h = clamp(Number(g.h) || 750, 400, 1800);
      });
    }
    if (Array.isArray(layout.cameras)) {
      layout.cameras.forEach((c, i) => {
        c.id = c.id || 'CAM' + (i + 1);
        const pw = Number(c.platW) || 1000, pd = Number(c.platD) || 1000;
        c.x = clamp(Number(c.x) || rW / 2, pw / 2, rW - pw / 2);
        c.y = clamp(Number(c.y) || rD * 0.8, pd / 2, rD - pd / 2);
        c.platH = clamp(Number(c.platH) || 400, 0, 2000);
        c.lensH = clamp(Number(c.lensH) || 1700, 1200, 2500);
      });
    }
    if (Array.isArray(layout.monitors)) {
      layout.monitors.forEach((m, i) => {
        m.id = m.id || 'M' + (i + 1);
        m.x = clamp(Number(m.x) || rW / 2, 500, rW - 500);
        m.y = clamp(Number(m.y) || 3500, 500, rD - 500);
      });
    }
    return layout;
  }

  // ---------------------------------------------------------------- 各モジュールへ反映
  function applyLayout(d) {
    const modules = {};

    // AI 応答 → 各モジュールの importData が受け取る形式へ変換
    if (d.room) modules.room = { room: d.room };

    if (d.stage || Array.isArray(d.panels)) {
      modules.facility = {};
      if (d.stage) modules.facility.stage = d.stage;
      if (Array.isArray(d.panels)) {
        modules.facility.panels = d.panels.map((p, i) => ({
          id: 'BP' + (i + 1), name: p.name || 'バックパネル ' + (i + 1), enabled: p.enabled !== false,
          w: p.w || 6000, d: p.d || 100, h: p.h || 2400, posType: 'on_stage', customPos: true,
          x: p.x != null ? p.x : (d.stage ? d.stage.x : 0), y: p.y != null ? p.y : (d.stage ? d.stage.y : 0)
        }));
      }
    }
    if (d.podium) {
      modules.podium = {
        podiums: [Object.assign({ id: 'POD_MC_1', type: 'mc', name: '司会台', enabled: true, w: 900, d: 600, h: 1100, angle: 15, hasHost: true }, d.podium)]
      };
    }
    if (Array.isArray(d.guests)) {
      modules.guests = {
        list: d.guests.map((g, i) => ({ id: g.id, name: g.name || '登壇者 ' + (i + 1), type: g.type || 'high_chair', h: g.h, x: g.x, y: g.y }))
      };
    }
    if (Array.isArray(d.cameras)) modules.camera = { list: d.cameras, selectedId: d.cameras[0] && d.cameras[0].id };
    if (Array.isArray(d.monitors)) modules.monitor = { monitors: d.monitors, selectedId: d.monitors[0] && d.monitors[0].id };

    // 全タブへの反映を履歴 1 件にまとめる (Undo 1回で生成前に戻る)
    window.Core.batch('AI自動生成', () => {
      window.Core.importProject({ app: window.Core.APP_ID, modules });
      // 客席は会場・ステージ確定後に再配置する (グリッド条件は tab6 の API に渡す)
      if (d.seatConfig && window.tabSeatsModule) window.tabSeatsModule.configureGrid(d.seatConfig);
    });
  }

  // ---------------------------------------------------------------- 保存 / 復元
  function exportData() {
    const el = $('aiPromptInput');
    return { lastPrompt: el ? el.value : '' };
  }
  function importData(s) {
    const el = $('aiPromptInput');
    if (el && s && typeof s.lastPrompt === 'string') el.value = s.lastPrompt;
  }

  window.tabAiGenModule = { init: buildUI, runAiGeneration: run, exportData, importData, cleanAndParseJson, clampLayoutToBounds };
  window.Core.register('ai_gen', window.tabAiGenModule, { order: 900 });
})();
