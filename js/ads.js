// ============================================================
// Elden Earth — Ads facade
// One entry point for rewarded video so game code never knows which
// provider ran:
//   Android app : AdMob rewarded (Google DEMO test units while in testing —
//                 see android/app/src/admob/res/values/admob.xml).
//   Browser/PWA : AdSense H5 Games "Ad Placement API" (adBreak type
//                 'reward') — currently in data-adbreak-test mode, which
//                 serves FAKE ads (the web twin of AdMob's demo units).
//
// ⚠️ SECURITY: resolving true means "an ad completed", NOT "give the
// player the reward". Rewards must be granted server-side (claimAdReward)
// — never trust this promise alone. See IMPLEMENTATIONADMOB.md §4.
//
// ⚠️ POLICY: rewards must have no real-world/monetary value. EB/RC are
// in-game only and are fine; Reward Points (RP) must NEVER flow from an ad.
// ============================================================
const Ads = (() => {
  function isNativeAds() {
    return !!(window.NativeBridge
      && NativeBridge.isNativeApp
      && typeof NativeBridge.showRewardedAd === 'function');
  }

  // adBreak() only exists in browsers — index.html gates the AdSense loader
  // behind EEAdPolicy.adsAllowed, which is false inside the Android app.
  function isWebAds() {
    return !!(window.EEAdPolicy && window.EEAdPolicy.adsAllowed
      && typeof window.adBreak === 'function');
  }

  // True when a rewarded provider actually exists in this runtime. Game code
  // uses this to hide "Watch Ad" buttons rather than promise an ad that can
  // never play (both providers fail soft to earned=false).
  function isRewardedAvailable() {
    return isNativeAds() || isWebAds();
  }

  // NativeBridge.showRewardedAd() owns the whole native callback contract (it
  // registers window.__eeRewarded[id] + window.onNativeRewardedAd itself) and
  // returns the promise. Do NOT pre-register a second id here — that left the
  // native completion resolving a different promise than the one awaited, so
  // the "Watch Ad" buttons hung disabled forever on Android.
  function showNativeRewarded() {
    try {
      return Promise.resolve(NativeBridge.showRewardedAd()).then(
        (earned) => earned === true,
        () => false
      );
    } catch (e) {
      return Promise.resolve(false);
    }
  }

  // Browser/PWA rewarded via the Ad Placement API. Sequence (Google docs):
  // adBreak() -> beforeReward(showAdFn) when an ad is ready -> showAdFn()
  // (must run inside the player's tap, which it does — this whole call chain
  // starts from the "Watch Ad…" button) -> adViewed on completion or
  // adDismissed on early exit -> afterAd -> adBreakDone (always).
  function showWebRewarded(placement) {
    return new Promise((resolve) => {
      if (!isWebAds()) { resolve(false); return; }
      let done = false;
      const finish = (ok) => {
        if (done) return;
        done = true;
        try { delete window.__eeWebReward; } catch (e) {}
        resolve(ok);
      };
      try {
        window.__eeWebReward = finish; // kept for debugging/inspection
        window.adBreak({
          type: 'reward',
          name: String(placement || 'reward').slice(0, 40),
          beforeReward: (showAdFn) => {
            try { showAdFn(); } catch (e) { finish(false); }
          },
          adViewed: () => finish(true),
          adDismissed: () => finish(false),
          afterAd: () => finish(false),
          adBreakDone: (info) => {
            // Always fires last — including when NO ad was available (in that
            // case no other callback runs at all), so this is the safety net.
            if (!done) {
              console.log('[Ads] web adBreak done:', info && info.breakStatus);
              finish(false);
            }
          },
        });
        // Absolute backstop so a silent API can never wedge the button.
        setTimeout(() => finish(false), 90000);
      } catch (e) {
        console.warn('[Ads] web rewarded failed:', e);
        finish(false);
      }
    });
  }

  async function showRewarded(placement) {
    try {
      let earned = false;
      if (isNativeAds()) {
        earned = await showNativeRewarded();
      } else if (isWebAds()) {
        earned = await showWebRewarded(placement);
      }
      console.log(`[Ads] rewarded '${placement}' finished, earned=${earned}`);
      return earned === true;
    } catch (e) {
      console.warn('[Ads] rewarded failed:', e);
      return false;
    }
  }

  return { showRewarded, isRewardedAvailable };
})();

window.Ads = Ads;
