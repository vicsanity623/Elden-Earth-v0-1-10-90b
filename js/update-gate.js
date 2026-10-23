// ============================================================
// Elden Earth — Forced Update Gate (Android only)
//
// Reads app_config/force_update (public read) and, when the installed
// Play build is older than the required versionCode, locks the game
// behind a full-screen "Update required" wall that deep-links to the
// Play Store.
//
// Why this exists: Play bans self-updating APKs, so the app can never
// install its own updates. Testers with auto-updates off (or Play
// lagging behind) would otherwise keep playing an outdated build.
//
// FAIL-OPEN by design: if the config is missing, unreadable, the
// version is unknown, or anything throws, the gate NEVER blocks —
// a broken check must not lock players out of the game.
//
// Config doc (Firestore: app_config/force_update):
//   { enabled: true, minVersionCode: 72, message: "optional custom line" }
// Bump minVersionCode to force everyone below it to update.
// ============================================================
const UpdateGate = (() => {
  const CHECK_TIMEOUT_MS = 12000;   // wait for native bridge + config
  const RECHECK_MS = 60000;         // periodic re-check while the game is open
  const STORE_URL = "market://details?id=com.eldenearth.game";
  const STORE_URL_WEB = "https://play.google.com/store/apps/details?id=com.eldenearth.game";

  let active = false;
  let checkedOnce = false;

  function isNative() {
    return !!(window.AndroidBridge || (window.EldenEarthNative && window.EldenEarthNative.isNativeApp));
  }

  function versionCode() {
    try {
      if (window.NativeBridge && typeof NativeBridge.getBuildVersionCode === "function") {
        return Number(NativeBridge.getBuildVersionCode()) || 0;
      }
    } catch (e) { /* fall through */ }
    return 0;
  }

  function injectStyles() {
    if (document.getElementById("update-gate-styles")) return;
    const style = document.createElement("style");
    style.id = "update-gate-styles";
    style.textContent = `
      .update-gate {
        position: fixed; inset: 0; z-index: 2147483647;
        background: #0a0a0a; color: #f4f0e8;
        display: flex; align-items: center; justify-content: center;
        padding: 24px; text-align: center;
      }
      .update-gate-panel { max-width: 420px; width: 100%; }
      .update-gate-icon { font-size: 52px; margin-bottom: 14px; }
      .update-gate-title {
        font-family: 'Cinzel', serif; font-size: 26px; font-weight: 800;
        color: #fff; margin: 0 0 14px; letter-spacing: 1px;
      }
      .update-gate-text { color: #b8b8c4; font-size: 15px; line-height: 1.65; margin: 0 0 22px; }
      .update-gate-btn {
        display: inline-block; padding: 15px 34px; border-radius: 50px;
        background: #e2211c; color: #fff; font-weight: 700; font-size: 16px;
        border: none; cursor: pointer;
      }
      .update-gate-btn:active { opacity: .85; }
      .update-gate-sub { margin-top: 18px; font-size: 12.5px; color: #6b6b78; }
    `;
    document.head.appendChild(style);
  }

  function openStore() {
    try {
      if (window.NativeBridge && typeof NativeBridge.openExternal === "function") {
        NativeBridge.openExternal(STORE_URL);
      } else {
        window.open(STORE_URL_WEB, "_blank");
      }
    } catch (e) {
      window.open(STORE_URL_WEB, "_blank");
    }
  }

  function activate(message) {
    if (active) return;
    active = true;
    injectStyles();
    // Hard gate: no dismiss. The game is not playable until the app updates.
    document.body.innerHTML = "";
    document.body.style.cssText = "margin:0;padding:0;overflow:hidden;background:#0a0a0a;";
    for (let i = 1; i < 99999; i++) { clearInterval(i); clearTimeout(i); }

    const gate = document.createElement("div");
    gate.className = "update-gate";
    gate.innerHTML = `
      <div class="update-gate-panel">
        <div class="update-gate-icon">⬆️</div>
        <h1 class="update-gate-title">Update Required</h1>
        <p class="update-gate-text">${message || "A new version of Elden Earth is ready. Update to the latest version to keep playing."}</p>
        <button class="update-gate-btn" id="update-gate-btn">Update Now</button>
        <div class="update-gate-sub">Already updated? Restart the game after the update finishes.</div>
      </div>
    `;
    document.body.appendChild(gate);
    const btn = document.getElementById("update-gate-btn");
    if (btn) btn.addEventListener("click", openStore);
    console.log("[UpdateGate] update required — game locked");
  }

  async function check() {
    if (active) return;
    // Only the Android app is version-gated. The website/PWA updates itself.
    if (!isNative()) return;

    const local = versionCode();
    if (!local) return; // native bridge not ready yet — never block blind

    try {
      const firestore = (typeof Store !== "undefined" && Store.getDb && Store.getDb())
        || (typeof firebase !== "undefined" && firebase.firestore ? firebase.firestore() : null);
      if (!firestore) return;
      const snap = await firestore.collection("app_config").doc("force_update").get();
      if (!snap.exists) return;
      const cfg = snap.data() || {};
      if (cfg.enabled !== true) return;
      const minCode = Number(cfg.minVersionCode) || 0;
      if (minCode > local) {
        activate(typeof cfg.message === "string" && cfg.message.trim() ? cfg.message.trim() : "");
      }
    } catch (e) {
      // Fail open — a network or config error must never lock the game.
      console.warn("[UpdateGate] check failed, allowing play:", e && e.message);
    }
  }

  function attach() {
    if (!isNative()) return;
    // The native version number lands after the bridge injects — retry briefly.
    let tries = 0;
    const tick = () => {
      tries++;
      if (versionCode() || tries > 40) {
        check();
      } else {
        setTimeout(tick, 250);
      }
    };
    tick();
    // Re-check occasionally so a long session still learns about a forced update.
    setInterval(check, RECHECK_MS);
  }

  return { attach, check, isActive: () => active };
})();

window.UpdateGate = UpdateGate;
if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => UpdateGate.attach());
  } else {
    UpdateGate.attach();
  }
}
