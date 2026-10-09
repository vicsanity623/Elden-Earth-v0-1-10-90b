// ============================================================
// Elden Earth — Native App Bridge
// Detects Android app vs browser, exposes native features
// ============================================================
const NativeBridge = (() => {
  const isNativeApp = !!(window.EldenEarthNative && window.EldenEarthNative.isNativeApp);
  const isAndroid = isNativeApp && window.EldenEarthNative.platform === 'android';
  const isIOS = isNativeApp && window.EldenEarthNative.platform === 'ios';

  function getBuildVersion() {
    return isNativeApp ? window.EldenEarthNative.buildVersion : null;
  }

  function getBuildVersionCode() {
    return isNativeApp ? window.EldenEarthNative.buildVersionCode : 0;
  }

  function isUpdateAvailable() {
    return isNativeApp && window.EldenEarthNative.updateAvailable;
  }

  function requestUpdate() {
    if (isNativeApp) window.EldenEarthNative.requestUpdate();
  }

  function vibrate(ms) {
    if (isNativeApp) {
      window.EldenEarthNative.vibrate(ms || 50);
    } else if (navigator.vibrate) {
      navigator.vibrate(ms || 50);
    }
  }

  function getDeviceId() {
    if (isNativeApp) return window.EldenEarthNative.getDeviceId();
    return localStorage.getItem('eldenEarth.deviceId') || (() => {
      const id = 'web_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      localStorage.setItem('eldenEarth.deviceId', id);
      return id;
    })();
  }

  function isOnline() {
    return navigator.onLine;
  }

  function openExternal(url) {
    if (isNativeApp) {
      window.EldenEarthNative.openExternal(url);
    } else {
      window.open(url, '_blank');
    }
  }

  function getVersionInfo() {
    if (!isNativeApp) return null;
    return {
      version: window.EldenEarthNative.buildVersion,
      versionCode: window.EldenEarthNative.buildVersionCode,
      platform: window.EldenEarthNative.platform,
      updateAvailable: window.EldenEarthNative.updateAvailable,
      updateVersion: window.EldenEarthNative.updateVersion
    };
  }

  // Local OS notifications. Browsers have no equivalent (Web Push is not
  // available inside Android WebView), so these are no-ops outside the app and
  // js/multiplier.js simply never gets its boost-expiry nudge there.
  function scheduleBoostEnd(expiryMs, multiplier) {
    if (!isNativeApp || typeof window.EldenEarthNative.scheduleBoostEnd !== 'function') return;
    window.EldenEarthNative.scheduleBoostEnd(expiryMs, multiplier || 20);
  }

  function cancelBoostEnd() {
    if (!isNativeApp || typeof window.EldenEarthNative.cancelBoostEnd !== 'function') return;
    window.EldenEarthNative.cancelBoostEnd();
  }

  return {
    isNativeApp,
    isAndroid,
    isIOS,
    getBuildVersion,
    getBuildVersionCode,
    isUpdateAvailable,
    requestUpdate,
    vibrate,
    getDeviceId,
    isOnline,
    openExternal,
    getVersionInfo,
    scheduleBoostEnd,
    cancelBoostEnd
  };
})();

// Make it globally accessible
window.NativeBridge = NativeBridge;

// Auto-detect and log
if (NativeBridge.isNativeApp) {
  console.log(`[EldenEarth] Running in native Android app — build ${NativeBridge.getBuildVersion()}`);
  if (NativeBridge.isUpdateAvailable()) {
    console.log(`[EldenEarth] Update available — version ${NativeBridge.getVersionInfo().updateVersion}`);
  }
} else {
  console.log('[EldenEarth] Running in browser (PWA mode)');
}
