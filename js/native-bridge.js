// ============================================================
// Elden Earth — Native App Bridge
// Detects Android app vs browser, exposes native features
// ============================================================
const NativeBridge = (() => {
  // window.AndroidBridge exists from the first script (injected before page
  // load); window.EldenEarthNative is only injected on page-finish, so check
  // both or the module misdetects the app as a browser ("PWA mode").
  const isNativeApp = !!(window.AndroidBridge || (window.EldenEarthNative && window.EldenEarthNative.isNativeApp));
  const isAndroid = isNativeApp && (!!window.AndroidBridge || window.EldenEarthNative.platform === 'android');
  const isIOS = !!(window.EldenEarthNative && window.EldenEarthNative.platform === 'ios');

  function getBuildVersion() {
    return isNativeApp ? window.EldenEarthNative.buildVersion : null;
  }

  function getBuildVersionCode() {
    return isNativeApp ? window.EldenEarthNative.buildVersionCode : 0;
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
      platform: window.EldenEarthNative.platform
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

  // Rewarded video (AdMob on Android). Resolves true only when the ad was
  // completed — the caller must still have the reward granted server-side
  // (AdMob SSV); never grant anything from this promise alone.
  function showRewardedAd() {
    return new Promise((resolve) => {
      if (!isNativeApp
          || !window.EldenEarthNative
          || typeof window.EldenEarthNative.showRewardedAd !== 'function') {
        resolve(false);
        return;
      }
      const id = 'rw_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      window.__eeRewarded = window.__eeRewarded || {};
      window.__eeRewarded[id] = resolve;
      try {
        window.EldenEarthNative.showRewardedAd(id);
      } catch (e) {
        delete window.__eeRewarded[id];
        resolve(false);
      }
    });
  }

  // Called by the injected native bridge when the ad finishes.
  window.onNativeRewardedAd = function (id, earned) {
    const pending = window.__eeRewarded && window.__eeRewarded[id];
    if (pending) {
      delete window.__eeRewarded[id];
      pending(!!earned);
    }
  };

  return {
    isNativeApp,
    isAndroid,
    isIOS,
    getBuildVersion,
    getBuildVersionCode,
    vibrate,
    getDeviceId,
    isOnline,
    openExternal,
    getVersionInfo,
    scheduleBoostEnd,
    cancelBoostEnd,
    showRewardedAd
  };
})();

// Make it globally accessible
window.NativeBridge = NativeBridge;

// Auto-detect and log
if (NativeBridge.isNativeApp) {
  console.log(`[EldenEarth] Running in native Android app — build ${NativeBridge.getBuildVersion()}`);
} else {
  console.log('[EldenEarth] Running in browser (PWA mode)');
}
