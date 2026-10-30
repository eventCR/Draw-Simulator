/**
 * Google Drive 連携の設定。Google Cloud Console で作った値を入れてください。
 *   clientId : OAuth 2.0 クライアント ID (ウェブ アプリケーション)。承認済み JavaScript 生成元にこのサイトの URL を登録
 *   apiKey   : API キー (Picker 用。HTTP リファラーでこのサイトに制限するのがおすすめ)
 *   appId    : プロジェクト番号 (数字)。Picker でファイルへのアクセスを得るために必要
 * 空のままでも、他の機能はすべて通常どおり動きます (Drive ボタンを押すと案内が出ます)。
 * これらは公開されても問題ない値です (秘密鍵ではありません)。
 */
window.DRIVE_CONFIG = { clientId: '', apiKey: '', appId: '' };
