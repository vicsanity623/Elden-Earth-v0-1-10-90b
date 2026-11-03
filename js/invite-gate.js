// ============================================================
// Elden Earth — Invite gate (invite-only front door)
//
// Shows the invite-code card on the sign-in screen and intercepts sign-in
// taps until a code has been verified. Config lives in Firestore:
//   app_config/invites { required: true }
//
// IMPORTANT: this is UX, NOT the security boundary. Bots never touch this
// UI — they call the Auth REST API directly. The real lock is the
// beforeCreate blocking function (blockFarmSignups), which refuses to create
// an account without a valid, unused, unexpired invite code bound to the
// signup identity. Everything here exists to guide real humans through that
// door and to tell them where to get a code.
//
// FAIL-VISIBLE (2026-11-02 fix): the card is shown by default and only taken
// down when config explicitly says `required: false` (or the player already
// redeemed/skipped). The first version tried to read Firebase config before
// firebase.initializeApp() had run in this app's boot order — the thrown
// "No Firebase App '[DEFAULT]'" killed the whole gate silently and new
// players were dumped at a sign-in button whose server rejection they could
// not act on. Waiting for Firebase init + defaulting to visible means a
// config hiccup can never hide the door again.
// ============================================================
const InviteGate = (() => {
  const CONFIG_DOC = "invites";      // app_config/invites { required: true }
  const PASS_KEY = "ee_invite_ok";   // localStorage: code verified on this device
  const SKIP_KEY = "ee_invite_skip"; // localStorage: returning player chose "sign in"

  let gateOn = false;
  let passed = false;
  let wired = false;

  function el(id) { return document.getElementById(id); }

  function toast(msg, ms) {
    try { if (typeof showToast === "function") { showToast(msg, ms || 4000); return; } } catch (e) {}
    console.log("[InviteGate]", msg);
  }

  function card() { return el("invite-gate"); }
  function hideCard() { const c = card(); if (c) c.classList.add("hidden"); }
  function showCard() { const c = card(); if (c) c.classList.remove("hidden"); }

  // Firebase initializes AFTER DOMContentLoaded in this app (auth.js owns
  // initializeApp). Anything touching firebase.* before that throws
  // "No Firebase App '[DEFAULT]'" — poll until it exists.
  function firebaseReady() {
    try {
      return typeof firebase !== "undefined" && Array.isArray(firebase.apps) && firebase.apps.length > 0;
    } catch (e) { return false; }
  }

  function whenFirebaseReady(timeoutMs) {
    return new Promise((resolve) => {
      const started = Date.now();
      (function poll() {
        if (firebaseReady()) return resolve(true);
        if (Date.now() - started > (timeoutMs || 10000)) return resolve(false);
        setTimeout(poll, 250);
      })();
    });
  }

  const REASON_MSG = {
    invalid: "❌ That code doesn't exist — check for typos.",
    used: "❌ That code was already used. Ask for a fresh one in Discord.",
    expired: "⌛ That code expired (codes self-destruct after 2 hours). Ask for a fresh one in Discord.",
    wrong_email: "⚠️ That code was issued for a different email — use the email the code was given for.",
    rate_limited: "⚠️ Too many attempts — try again in a minute.",
    missing: "Enter both the invite code and your email.",
    error: "⚠️ Could not reach the server — try again.",
  };

  async function verify() {
    const codeEl = el("invite-code-input");
    const emailEl = el("invite-email-input");
    const btn = el("invite-verify-btn");
    const code = String(codeEl && codeEl.value || "").trim();
    const identifier = String(emailEl && emailEl.value || "").trim().toLowerCase();
    if (!code || !identifier) { toast(REASON_MSG.missing); return; }

    try {
      if (btn) { btn.disabled = true; btn.textContent = "Checking…"; }
      const fn = (typeof firebase !== "undefined" && firebase.functions)
        ? firebase.functions().httpsCallable("redeemInvite")
        : null;
      if (!fn) throw new Error("functions unavailable");
      const res = await fn({ code, identifier });
      const d = (res && res.data) || {};
      if (d.ok) {
        passed = true;
        try { localStorage.setItem(PASS_KEY, "1"); } catch (e) {}
        hideCard();
        toast("✅ Invite accepted — now sign in with " + identifier);
      } else {
        toast(REASON_MSG[d.reason] || REASON_MSG.invalid);
      }
    } catch (e) {
      toast(REASON_MSG.error);
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = "Redeem invite code"; }
    }
  }

  function skip() {
    passed = true;
    try { localStorage.setItem(SKIP_KEY, "1"); } catch (e) {}
    hideCard();
    toast("Sign in with your existing account.");
  }

  function wireButtons() {
    if (wired) return;
    wired = true;
    el("invite-verify-btn")?.addEventListener("click", verify);
    el("invite-skip-link")?.addEventListener("click", (e) => { e.preventDefault(); skip(); });
    [el("invite-code-input"), el("invite-email-input")].forEach((input) => {
      input?.addEventListener("keydown", (e) => { if (e.key === "Enter") verify(); });
    });
  }

  // Intercept sign-in taps while the gate is up — same capture-phase approach
  // as HumanGate so it wins regardless of what auth.js binds later.
  function attachObstructions() {
    document.addEventListener("click", (e) => {
      if (!gateOn || passed) return;
      const btn = e.target && e.target.closest
        ? e.target.closest("#native-google-signin, #g_id_signin_slot button, .g_id_signin button, [data-provider=google]")
        : null;
      if (!btn) return;
      e.preventDefault();
      e.stopPropagation();
      toast("🔒 Elden Earth is invite-only — redeem your invite code first.");
      showCard();
    }, true);
  }

  async function attach() {
    // Never-nag cases first (no Firebase needed).
    try {
      const stored = localStorage.getItem(PASS_KEY) || localStorage.getItem(SKIP_KEY);
      if (stored) { passed = true; return; }
    } catch (e) {}

    const ready = await whenFirebaseReady(10000);

    // Signed-in returning player? Keep quiet.
    try {
      if (ready && firebase.auth && firebase.auth().currentUser) { passed = true; return; }
    } catch (e) {}

    // FAIL-VISIBLE: put the door up FIRST, then ask config whether to keep it.
    // A missing/unreadable config keeps the card (the server-side gate is the
    // real lock; the skip link keeps returning players moving).
    gateOn = true;
    showCard();
    wireButtons();
    attachObstructions();

    if (!ready) {
      console.warn("[InviteGate] Firebase never became ready — showing the door anyway.");
      return;
    }
    try {
      const snap = await firebase.firestore().collection("app_config").doc(CONFIG_DOC).get();
      const cfg = snap.exists ? snap.data() || {} : {};
      if (cfg.required === false) {
        gateOn = false;
        hideCard();
      }
    } catch (e) {
      console.warn("[InviteGate] config read failed — keeping the door visible:", e && e.message);
    }
  }

  return {
    attach,
    isPassed: () => passed || !gateOn,
    // Called by auth.js when the server rejects a signup: make sure the door
    // (and its explanation) is on screen at that exact moment.
    show: () => { gateOn = true; showCard(); wireButtons(); },
  };
})();

window.InviteGate = InviteGate;
if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => InviteGate.attach());
  } else {
    InviteGate.attach();
  }
}
