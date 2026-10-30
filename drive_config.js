/**
 * Google Drive 連携の設定。Google Cloud Console で作った値を入れてください。
 *   clientId : OAuth 2.0 クライアント ID (ウェブ アプリケーション)。承認済み JavaScript 生成元にこのサイトの URL を登録
 *   apiKey   : API キー (Picker 用。HTTP リファラーでこのサイトに制限するのがおすすめ)
 *   appId    : プロジェクト番号 (数字)。Picker でファイルへのアクセスを得るために必要
 * 空のままでも、他の機能はすべて通常どおり動きます (Drive ボタンを押すと案内が出ます)。
 * これらは公開されても問題ない値です (秘密鍵ではありません)。
 */
window.DRIVE_CONFIG = {
  clientId: '107532243052-ckekvo2a5unve97g4op5s3p4bf16t5m6.apps.googleusercontent.com',
  apiKey: 'AIzaSyBKTozg2D3Frzl_APrZhzv-a_CjhbhY3B8',
  appId: '107532243052',
  // 専用フォルダ: 共有ドライブ内に作った「Draw-Simulator」フォルダのID (フォルダを開いたURLの folders/ の後ろの文字列)。
  // 設定すると、保存はここだけ・開くもここの中だけになります。空なら、保存のたびにフォルダを選びます。
  folderId: '1nzvokDAKxgp-ZZ-86FwDv27vdQRFUwqv',
  folderName: 'Draw-Simulator'
};
