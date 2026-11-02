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
// Returning players never need a code (codes gate ACCOUNT CREATION only) —
// the "Already have an account?" link skips the card for them.
// ============================================================
const InviteGate = (() => {
  const CONFIG_DOC = "invites";      // app_config/invites { required: true }
  const PASS_KEY = "ee_invite_ok";   // localStorage: code verified on this device
  const SKIP_KEY = "ee_invite_skip"; // localStorage: returning player chose "sign in"

  let gateOn = false;
  let passed = false;

  function el(id) { return document.getElementById(id); }

  function toast(msg, ms) {
    try { if (typeof showToast === "function") { showToast(msg, ms || 4000); return; } } catch (e) {}
    console.log("[InviteGate]", msg);
  }

  function card() { return el("invite-gate"); }

  function hideCard() {
    const c = card();
    if (c) c.classList.add("hidden");
  }

  function showCard() {
    const c = card();
    if (c) c.classList.remove("hidden");
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
      // Fail toward usability: network trouble must not brick the screen.
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
    try {
      // Returning player already signed in, or this device already redeemed
      // a code / chose "I already play" — never nag again.
      if (typeof firebase !== "undefined" && firebase.auth && firebase.auth().currentUser) {
        passed = true;
        return;
      }
      let stored = null;
      try { stored = localStorage.getItem(PASS_KEY) || localStorage.getItem(SKIP_KEY); } catch (e) {}
      if (stored) { passed = true; return; }

      const firestore = (typeof Store !== "undefined" && Store.getDb && Store.getDb())
        || (typeof firebase !== "undefined" && firebase.firestore ? firebase.firestore() : null);
      if (!firestore) return; // no config readable -> server still enforces
      const snap = await firestore.collection("app_config").doc(CONFIG_DOC).get();
      const cfg = snap.exists ? snap.data() || {} : {};
      if (cfg.required === false) return; // doors open — nothing to gate

      gateOn = true;
      showCard();
      attachObstructions();

      el("invite-verify-btn")?.addEventListener("click", verify);
      el("invite-skip-link")?.addEventListener("click", (e) => { e.preventDefault(); skip(); });
      [el("invite-code-input"), el("invite-email-input")].forEach((input) => {
        input?.addEventListener("keydown", (e) => { if (e.key === "Enter") verify(); });
      });
    } catch (e) {
      // Config error: leave the card visible but never hard-lock the screen —
      // the server-side gate is what actually protects the game.
      console.warn("[InviteGate] attach failed:", e && e.message);
    }
  }

  return { attach, isPassed: () => passed || !gateOn };
})();

window.InviteGate = InviteGate;
if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => InviteGate.attach());
  } else {
    InviteGate.attach();
  }
}
