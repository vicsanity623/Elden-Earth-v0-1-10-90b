// ============================================================
// Elden Earth — Human verification gate (Cloudflare Turnstile)
//
// Blocks the Google sign-in button behind a Cloudflare "verify you
// are human" widget so scripted bot signups stop at the sign-in
// screen. Config lives in Firestore: app_config/human_gate
//   { enabled: true, sitekey: "YOUR_TURNSTILE_SITEKEY" }
// The SECRET key never ships to clients — it lives in functions/.env
// as TURNSTILE_SECRET and is checked server-side by the
// verifyTurnstile callable.
//
// FAIL-OPEN by design:
//   * no config / no sitekey / gate disabled  -> no gate, normal sign-in
//   * Turnstile script fails to load in 30s  -> gate lifts itself
//   * verification service unreachable       -> gate lifts
// A broken gate must NEVER lock real players out of the game.
// ============================================================
const HumanGate = (() => {
  const WIDGET_TIMEOUT_MS = 30000;
  const SITEKEY_DOC = "human_gate";

  let gateOn = false;
  let verified = false;
  let container = null;

  function toast(msg) {
    try {
      if (typeof window.showToast === "function") window.showToast(msg, 3500);
    } catch (e) { /* nothing to do */ }
  }

  function loadTurnstile() {
    return new Promise((resolve, reject) => {
      if (window.turnstile) return resolve();
      const s = document.createElement("script");
      s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error("turnstile failed to load"));
      document.head.appendChild(s);
    });
  }

  function renderWidget(sitekey) {
    if (!window.turnstile || !container) return;
    try {
      window.turnstile.render(container, {
        sitekey,
        theme: "dark",
        callback: onVerified,
        "expired-callback": () => { verified = false; },
        "error-callback": () => liftGate("widget error"),
      });
    } catch (e) {
      liftGate("render error");
    }
  }

  async function onVerified(token) {
    try {
      // Server-side check with the secret key — a client-side tick alone
      // proves nothing to a determined bot.
      const fn = (typeof firebase !== "undefined" && firebase.functions)
        ? firebase.functions().httpsCallable("verifyTurnstile")
        : null;
      if (!fn) { verified = true; placeContainer(); return; }
      const res = await fn({ token });
      if (res && res.data && res.data.ok) {
        verified = true;
        toast("✅ Verified — you can sign in.");
        placeContainer();
      } else {
        verified = false;
        toast("⚠️ Verification failed — try again.");
      }
    } catch (e) {
      // Fail open: never let a network hiccup block a real player.
      verified = true;
      placeContainer();
    }
  }

  function liftGate(reason) {
    console.warn("[HumanGate] gate lifted:", reason);
    gateOn = false;
    verified = true;
    placeContainer();
  }

  // Keep the widget pinned directly above the sign-in button whenever the
  // auth screen (re)renders.
  function placeContainer() {
    if (!container) return;
    const btn = document.getElementById("native-google-signin")
      || document.querySelector("#g_id_signin_slot button");
    if (btn && btn.parentElement && container.parentElement !== btn.parentElement) {
      btn.parentElement.insertBefore(container, btn);
      container.style.display = verified ? "none" : "block";
    }
  }

  function attachObstructions() {
    // Intercept every sign-in tap while the gate is up. Capture phase so it
    // wins regardless of the handlers auth.js binds later.
    document.addEventListener("click", (e) => {
      if (!gateOn || verified) return;
      const btn = e.target && e.target.closest
        ? e.target.closest("#native-google-signin, #g_id_signin_slot button, .g_id_signin button, [data-provider=google]")
        : null;
      if (!btn) return;
      e.preventDefault();
      e.stopPropagation();
      toast("🛡️ Please verify you are human first.");
      placeContainer();
    }, true);

    const mo = new MutationObserver(() => placeContainer());
    mo.observe(document.body, { childList: true, subtree: true });
    placeContainer();
  }

  async function attach() {
    try {
      const firestore = (typeof Store !== "undefined" && Store.getDb && Store.getDb())
        || (typeof firebase !== "undefined" && firebase.firestore ? firebase.firestore() : null);
      if (!firestore) return; // fail open
      const snap = await firestore.collection("app_config").doc(SITEKEY_DOC).get();
      const cfg = snap.exists ? snap.data() || {} : {};
      const sitekey = String(cfg.sitekey || "").trim();
      if (cfg.enabled !== true || !sitekey || sitekey === "YOUR_TURNSTILE_SITEKEY") return;

      gateOn = true;
      container = document.createElement("div");
      container.id = "human-gate-widget";
      container.style.cssText = "margin:10px auto;max-width:300px;";
      placeContainer();

      // If the widget never appears (script blocked, offline), lift the gate
      // rather than locking a real player out forever.
      setTimeout(() => { if (gateOn && !verified) liftGate("widget did not load"); }, WIDGET_TIMEOUT_MS);

      await loadTurnstile();
      renderWidget(sitekey);
      attachObstructions();
    } catch (e) {
      liftGate("config error: " + (e && e.message));
    }
  }

  return { attach, isVerified: () => verified || !gateOn };
})();

window.HumanGate = HumanGate;
if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => HumanGate.attach());
  } else {
    HumanGate.attach();
  }
}
