/**
 * drive_store.js — Google Drive (共有ドライブ対応) への保存・上書き・開く。
 * 権限は drive.file のみ (このアプリが作った / Picker で選んだファイルだけ)。サーバー不要。
 * 保存先は Core.fileStore (kind: 'drive', fileId) に覚え、上書き保存 (Ctrl+S) から使われる。
 */
(function () {
  'use strict';
  const SCOPE = 'https://www.googleapis.com/auth/drive.file';
  const API = 'https://www.googleapis.com/drive/v3/files';
  const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
  const cfg = () => window.DRIVE_CONFIG || {};
  const log = (m, lv) => window.Core && window.Core.log && window.Core.log(m, lv || 'info');
  const FS = () => window.Core.fileStore;

  const loaded = {};
  function loadScript(src) {
    if (!loaded[src]) loaded[src] = new Promise((res, rej) => {
      const s = document.createElement('script'); s.src = src; s.async = true;
      s.onload = res; s.onerror = () => rej(new Error('Googleのスクリプトを読み込めません (ネットワークを確認してください)'));
      document.head.appendChild(s);
    });
    return loaded[src];
  }

  function checkReady() {
    const c = cfg();
    if (!c.clientId || !c.apiKey || !c.appId) throw new Error('Google Drive連携は未設定です。drive_config.js に clientId / apiKey / appId を入れてください。');
    if (location.protocol !== 'https:' && location.hostname !== 'localhost') throw new Error('Google Drive連携は https:// のURL (GitHub Pagesなど) で開いたときだけ使えます。');
  }

  // ---- ログイン (アクセストークン。約1時間有効。切れたら小窓で再取得) ----
  let tokenClient = null, token = null, tokenExp = 0, pending = null;
  async function ensureToken(interactive) {
    if (token && Date.now() < tokenExp - 60000) return token;
    await loadScript('https://accounts.google.com/gsi/client');
    if (!tokenClient) {
      tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: cfg().clientId, scope: SCOPE,
        callback: r => { const p = pending; pending = null; if (!p) return; r.error ? p.rej(new Error('ログインできませんでした: ' + (r.error_description || r.error))) : p.res(r); },
        error_callback: e => { const p = pending; pending = null; if (p) p.rej(new Error('ログインが中断されました (' + (e && e.type || '') + ')')); }
      });
    }
    const r = await new Promise((res, rej) => { pending = { res, rej }; tokenClient.requestAccessToken({ prompt: token ? '' : (interactive === false ? '' : 'select_account') }); });
    token = r.access_token; tokenExp = Date.now() + (parseInt(r.expires_in, 10) || 3600) * 1000;
    return token;
  }

  async function gfetch(url, opt) {
    const t = await ensureToken();
    const r = await fetch(url, Object.assign({}, opt, { headers: Object.assign({ Authorization: 'Bearer ' + t }, (opt && opt.headers) || {}) }));
    if (!r.ok) {
      let msg = r.status + ''; try { const j = await r.json(); msg += ' ' + (j.error && j.error.message || ''); } catch (e) { /* noop */ }
      const err = new Error('Drive: ' + msg); err.status = r.status; throw err;
    }
    return r;
  }

  // ---- Picker (フォルダ / ファイルを選ぶ。共有ドライブも表示) ----
  async function pick(kind) {
    await ensureToken();
    await loadScript('https://apis.google.com/js/api.js');
    await new Promise(res => gapi.load('picker', res));
    return new Promise((resolve, reject) => {
      const view = new google.picker.DocsView(kind === 'folder' ? google.picker.ViewId.FOLDERS : google.picker.ViewId.DOCS).setIncludeFolders(true);
      if (kind === 'folder') view.setSelectFolderEnabled(true); else view.setMimeTypes('application/json');
      const b = new google.picker.PickerBuilder()
        .setAppId(cfg().appId).setDeveloperKey(cfg().apiKey).setOAuthToken(token).setLocale('ja')
        .setTitle(kind === 'folder' ? '保存するフォルダを選んでください (共有ドライブ可)' : '開くファイル (.json) を選んでください')
        .enableFeature(google.picker.Feature.SUPPORT_DRIVES)
        .addView(view)
        .setCallback(d => {
          if (d.action === google.picker.Action.PICKED) resolve(d.docs[0]);
          else if (d.action === google.picker.Action.CANCEL) resolve(null);
        });
      try { b.build().setVisible(true); } catch (e) { reject(e); }
    });
  }

  async function meta(id) {
    const r = await gfetch(API + '/' + id + '?supportsAllDrives=true&fields=id,name,modifiedTime,lastModifyingUser(displayName)');
    return r.json();
  }

  function multipart(metaObj, text) {
    const bd = 'dsm' + Math.random().toString(36).slice(2);
    return { type: 'multipart/related; boundary=' + bd,
      body: '--' + bd + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' + JSON.stringify(metaObj) + '\r\n--' + bd + '\r\nContent-Type: application/json\r\n\r\n' + text + '\r\n--' + bd + '--' };
  }

  // ---- 公開操作 ----
  async function saveAs() {
    try {
      checkReady();
      const folder = await pick('folder');
      if (!folder) return;
      const cur = FS().get();
      let name = prompt('Driveに保存するファイル名 (.json)', cur.name || 'Venue_Layout_Mark2.json');
      if (!name) return;
      if (!/\.json$/i.test(name)) name += '.json';
      const mp = multipart({ name, parents: [folder.id], mimeType: 'application/json' }, FS().projectJson());
      const r = await gfetch(UPLOAD + '?uploadType=multipart&supportsAllDrives=true&fields=id,name,modifiedTime', { method: 'POST', headers: { 'Content-Type': mp.type }, body: mp.body });
      const f = await r.json();
      FS().set({ kind: 'drive', handle: null, fileId: f.id, name: f.name, stamp: f.modifiedTime });
      FS().markSaved();
      log('Driveに保存しました: ' + f.name, 'info');
    } catch (e) { fail(e); }
  }

  async function overwrite() {
    const st = FS().get();
    if (st.kind !== 'drive' || !st.fileId) return saveAs();
    try {
      checkReady();
      const m = await meta(st.fileId);
      if (st.stamp && m.modifiedTime !== st.stamp) {
        const who = m.lastModifyingUser && m.lastModifyingUser.displayName ? '(' + m.lastModifyingUser.displayName + ' さん)' : '';
        if (!confirm('「' + st.name + '」は、開いたあとに別の人 ' + who + ' が更新しています。\n\nOK: このまま上書きする\nキャンセル: 保存しない (「☁ Driveに名前をつけて保存」で別名にできます)')) { log('上書きをやめました', 'warn'); return; }
      }
      const r = await gfetch(UPLOAD + '/' + st.fileId + '?uploadType=media&supportsAllDrives=true&fields=id,name,modifiedTime', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: FS().projectJson() });
      const f = await r.json();
      FS().set({ stamp: f.modifiedTime });
      FS().markSaved();
      log('Driveに上書き保存しました: ' + st.name, 'info');
    } catch (e) { fail(e); }
  }

  async function open() {
    try {
      checkReady();
      if (FS().isDirty() && !confirm('保存していない変更があります。破棄して開きますか?')) return;
      const doc = await pick('file');
      if (!doc) return;
      const m = await meta(doc.id);
      const r = await gfetch(API + '/' + doc.id + '?alt=media&supportsAllDrives=true');
      FS().loadText(await r.text(), { kind: 'drive', fileId: doc.id, name: m.name, stamp: m.modifiedTime });
      log('Driveから開きました: ' + m.name, 'info');
    } catch (e) { fail(e); }
  }

  function fail(e) {
    log(e.message, 'error');
    let hint = '';
    if (e.status === 401) hint = '\n(ログインの期限切れかもしれません。もう一度お試しください)';
    if (e.status === 403 || e.status === 404) hint = '\n(共有ドライブの「投稿者」以上の権限があるか、Pickerで選んだファイルかを確認してください)';
    alert('Google Driveの操作に失敗しました。\n' + e.message + hint);
  }

  window.DriveStore = { saveAs, overwrite, open, isConfigured: () => !!(cfg().clientId && cfg().apiKey && cfg().appId) };
})();
