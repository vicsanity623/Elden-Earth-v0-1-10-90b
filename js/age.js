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
  const PLAY_MIN_YEARS = 18;
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
    // Local persistence: once this device has a confirmed answer, NEVER ask
    // again — even if the cloud sync has not landed yet on the next launch.
    // The server copy stays authoritative for redemption eligibility.
    try {
      const flag = Number(localStorage.getItem("ee_age_verified")) || 0;
      if (flag > 0 && dobMs === 0) { dobMs = flag; resolved = true; }
    } catch (e) { /* private mode */ }
    return dobMs;
  }

  function persistLocal(dob) {
    try { localStorage.setItem("ee_age_verified", String(Math.floor(dob))); } catch (e) {}
  }

  /**
   * Ask the server whether a DOB is already on record. This is the missing
   * half: `Store.dateOfBirth` is only filled by the cloud sync, and the old
   * init() only waited 1.2s — so on a slow connection it prompted every
   * launch even though the server already had the answer.
   */
  async function checkStatus() {
    if (resolved) return true;
    if (typeof ServerAntiCheat !== "undefined" && ServerAntiCheat.isReady && ServerAntiCheat.isReady()) {
      try {
        const res = await ServerAntiCheat.getAgeStatus();
        if (res && res.verified && Number(res.dateOfBirth) > 0) {
          dobMs = Number(res.dateOfBirth);
          resolved = true;
          persistLocal(dobMs);
          try {
            const s = Store.get();
            if (s) { s.dateOfBirth = dobMs; Store.save && Store.save(false); }
          } catch (e) {}
          return true;
        }
      } catch (e) { console.warn("[AgeGate] status check failed:", e); }
    }
    return readFromState() > 0;
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
    const dob = parseDob(raw);
    if (dob == null) {
      setErr("Please enter your date of birth as MM/DD/YYYY.");
      return;
    }
    if (dob > Date.now()) {
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
      persistLocal(dobMs);

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
        toast("You must be 18 or older to play Elden Earth.", 6000);
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

  // ---- MM/DD/YYYY text entry -------------------------------------------
  // <input type="date"> opens a calendar wheel on iOS Safari, which is
  // unusable when it lands under another panel — players could not see the
  // picker and had to arrow through years. Free-text typing is faster and
  // works everywhere; the field formats as you go.
  function wireDateInput() {
    const input = el("age-dob-input");
    if (!input) return;
    input.setAttribute("inputmode", "numeric");
    input.setAttribute("autocomplete", "bday");
    input.setAttribute("placeholder", "MM/DD/YYYY");
    input.setAttribute("maxlength", "10");

    input.addEventListener("input", () => {
      // Auto-insert the slashes so the player just types digits.
      let v = input.value.replace(/\D/g, "").slice(0, 8);
      if (v.length > 4) v = `${v.slice(0, 2)}/${v.slice(2, 4)}/${v.slice(4)}`;
      else if (v.length > 2) v = `${v.slice(0, 2)}/${v.slice(2)}`;
      input.value = v;
    });
  }

  /** Parse "MM/DD/YYYY" (also accepts "M/D/YYYY") into a UTC timestamp. */
  function parseDob(raw) {
    const m = String(raw || "").trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (!m) return null;
    const mo = Number(m[1]), day = Number(m[2]), yr = Number(m[3]);
    if (mo < 1 || mo > 12) return null;
    if (day < 1 || day > 31) return null;
    const t = Date.UTC(yr, mo - 1, day);
    if (!Number.isFinite(t)) return null;
    // Reject impossible dates (31 Feb rolls over silently in Date.UTC).
    const d = new Date(t);
    if (d.getUTCMonth() !== mo - 1 || d.getUTCDate() !== day) return null;
    return t;
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
    // Wire up the MM/DD/YYYY text entry (see index.html).
    wireDateInput();

    // Never prompt more than once per account. Wait for BOTH the local flag
    // and a server check before deciding — the old 1.2s timeout raced the cloud
    // sync and re-asked on every launch.
    setTimeout(async () => {
      try {
        const signedIn = typeof firebase !== "undefined" && firebase.auth && firebase.auth().currentUser;
        if (!signedIn) return;
        await checkStatus();
        if (needsPrompt()) openPrompt();
      } catch (e) { /* ignore */ }
    }, 2500);
  }

  return {
    init,
    openPrompt,
    checkStatus,
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
