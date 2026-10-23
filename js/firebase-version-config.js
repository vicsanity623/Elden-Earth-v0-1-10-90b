// ============================================================
// Elden Earth — Firebase App Version Config
// Set this document in Firestore: app_config/latest_version
//
// Firestore Schema:
// app_config/latest_version {
//   versionCode: number (e.g., 2 for v0.1.11.02)
//   versionName: string (e.g., "0.1.11.02")
//   downloadUrl: string (direct APK download URL)
//   required: boolean (force update if true)
//   changelog: string (shown in update prompt)
//   releasedAt: timestamp
// }
//
// To trigger an update:
// 1. Build new APK with incremented versionCode/versionName
// 2. Upload APK to Firebase Storage or any hosting
// 3. Update the app_config/latest_version document with new values
// 4. Next boot, app checks this document and prompts user
// ============================================================

// Firebase Cloud Function to auto-set version on APK upload (optional)
// Deploy with: firebase deploy --only functions
/*
exports.onApkUpload = functions.storage.object().onFinalize(async (object) => {
  const filePath = object.name;
  if (!filePath.startsWith('apk/')) return;

  const fileName = filePath.split('/').pop();
  const versionMatch = fileName.match(/v([\d.]+)\.apk/);
  if (!versionMatch) return;

  const versionName = versionMatch[1];
  const versionParts = versionName.split('.').map(Number);
  const versionCode = versionParts[0] * 10000 + versionParts[1] * 100 + versionParts[2];

  const bucket = object.bucket;
  const file = bucket.file(filePath);
  const [url] = await file.getSignedUrl({ action: 'read', expires: '2099-01-01' });

  await db.collection('app_config').doc('latest_version').set({
    versionCode,
    versionName,
    downloadUrl: url,
    required: false,
    releasedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  console.log(`[Update] Version ${versionName} (code ${versionCode}) registered`);
});
*/
