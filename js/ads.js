// ============================================================
// Elden Earth — Ads facade
// One entry point for rewarded video so game code never knows
// which provider ran. Today: AdMob rewarded on Android (the
// "nogads" Play build reports earned=false immediately). The
// web rewarded provider is not wired yet — browsers resolve
// false, so nothing is ever granted there.
//
// ⚠️ SECURITY: resolving true means "an ad completed", NOT "give
// the player the reward". Rewards must be granted server-side
// against AdMob server-side verification (SSV) — see
// IMPLEMENTATIONADMOB.md §4. Never trust this promise alone.
// ============================================================
const Ads = (() => {
  async function showRewarded(placement) {
    try {
      if (window.NativeBridge && typeof NativeBridge.showRewardedAd === 'function') {
        const earned = await NativeBridge.showRewardedAd();
        console.log(`[Ads] rewarded '${placement}' finished, earned=${earned}`);
        return earned === true;
      }
      return false;
    } catch (e) {
      console.warn('[Ads] rewarded failed:', e);
      return false;
    }
  }

  return { showRewarded };
})();

window.Ads = Ads;
