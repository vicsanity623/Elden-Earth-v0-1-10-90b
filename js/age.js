// ============================================================
// Elden Earth — Age Gate
//
// Collects date of birth once, server-side, and exposes redemption
// eligibility. The server is authoritative: setDateOfBirth writes
// saves_private/{uid}.dateOfBirth a single time and refuses to overwrite it,
// and submitWithdrawalRequest re-checks 18+ independently of anything here.
//
// saves_private is owner-only in firestore.rules because `saves` is world
// readable (the leaderboard and profile modal need it) and a date of birth must
// not be. See FINANCIALPLAN.md §5.
//
// Self-asserted DOB is the accepted norm for a $5/month rewards program
// (FINANCIALPLAN.md §5). If the per-player cap ever rises, identity
// verification replaces this module — the call site in submitWithdrawalRequest
// is where it plugs in.
// ============================================================
const AgeGate = (() => {
  const PLAY_MIN_YEARS = 13;
  const REDEEM_MIN_YEARS = 18;

  let dobMs = 0;       // 0 = not yet recorded
  let resolved = false; // true once we have read it or the player has answered
  let submitting = false;

  const el = (id) => document.getElementById(id);

  const toast = (msg, ms = 4000) => {
    if (typeof window !== "undefined" && typeof window.showToast === "function") window.showToast(msg, ms);
    else console.log("[AgeGate]", msg);
  };

  function readFromState() {
    try {
      const v = Number(Store.get()?.dateOfBirth) || 0;
      if (v > 0) {
        dobMs = v;
        resolved = true;
      }
    } catch (e) { /* Store not ready yet */ }
    return dobMs;
  }

  function ageYears(now = Date.now()) {
    if (!dobMs) return null;
    const d = new Date(dobMs);
    const t = new Date(now);
    let age = t.getUTCFullYear() - d.getUTCFullYear();
    const m = t.getUTCMonth() - d.getUTCMonth();
    if (m < 0 || (m === 0 && t.getUTCDate() < d.getUTCDate())) age--;
    return age;
  }

  function isVerified() {
    return dobMs > 0;
  }

  /** May this player see and use the redeem UI? Server re-checks regardless. */
  function isRedemptionEligible() {
    const a = ageYears();
    return a != null && a >= REDEEM_MIN_YEARS;
  }

  function needsPrompt() {
    return !isVerified();
  }

  function openPrompt() {
    const modal = el("age-verify-modal");
    if (!modal) return;
    const err = el("age-verify-error");
    if (err) err.textContent = "";
    modal.classList.remove("hidden");
    // Keyboard/AT users land on the input straight away.
    setTimeout(() => el("age-dob-input")?.focus(), 50);
  }

  function closePrompt() {
    el("age-verify-modal")?.classList.add("hidden");
  }

  async function submit() {
    if (submitting) return;
    const input = el("age-dob-input");
    const errEl = el("age-verify-error");
    const setErr = (m) => { if (errEl) errEl.textContent = m; };

    const raw = input ? input.value : "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
      setErr("Please enter your date of birth.");
      return;
    }
    const dob = Date.parse(raw + "T00:00:00Z");
    if (!Number.isFinite(dob) || dob > Date.now()) {
      setErr("That date doesn't look right.");
      return;
    }

    submitting = true;
    try {
      const fn = firebase.functions().httpsCallable("setDateOfBirth");
      const res = (await fn({ dobMs: dob })).data;

      if (!res?.ok) {
        setErr(res?.reason === "invalid_dob" ? "Please enter a valid date of birth." : "Something went wrong. Try again.");
        return;
      }

      dobMs = Number(res.dateOfBirth) || dob;
      resolved = true;

      // Mirror into local state so the UI reflects it immediately. dateOfBirth
      // is not in SAFE_SAVE_FIELDS, so this never reaches the cloud — the
      // callable above is the only writer.
      try {
        const state = Store.get();
        if (state) {
          state.dateOfBirth = dobMs;
          Store.save && Store.save(false);
        }
      } catch (e) { /* non-fatal */ }

      if (res.playable === false) {
        closePrompt();
        toast("You must be 13 or older to play Elden Earth.", 6000);
        try {
          if (typeof firebase !== "undefined" && firebase.auth) await firebase.auth().signOut();
        } catch (e) { /* ignore */ }
        return;
      }

      closePrompt();
      toast(`Age confirmed. ${res.redeemable ? "Rewards redemption is available." : "Rewards redemption unlocks at 18."}`, 5000);

      // The redeem UI may already be on screen behind the modal.
      if (typeof Cashout !== "undefined" && Cashout.updateUI) Cashout.updateUI();
    } catch (e) {
      console.warn("[AgeGate] setDateOfBirth failed:", e);
      setErr("Couldn't verify right now. Check your connection and try again.");
    } finally {
      submitting = false;
    }
  }

  function bind() {
    el("age-verify-confirm")?.addEventListener("click", submit);
    el("age-dob-input")?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") submit();
    });
  }

  function init() {
    bind();
    readFromState();

    // Prompt only when signed in and the save is already readable. The gate is
    // advisory here — submitWithdrawalRequest is what actually enforces 18+.
    if (needsPrompt()) {
      setTimeout(() => {
        try {
          const signedIn = typeof firebase !== "undefined" && firebase.auth && firebase.auth().currentUser;
          if (signedIn && needsPrompt()) openPrompt();
        } catch (e) { /* ignore */ }
      }, 1200);
    }
  }

  return {
    init,
    openPrompt,
    needsPrompt,
    isVerified,
    isRedemptionEligible,
    ageYears,
    PLAY_MIN_YEARS,
    REDEEM_MIN_YEARS,
  };
})();

window.AgeGate = AgeGate;
console.log("[EldenEarth] Age gate module loaded");
