// ============================================================
// Elden Earth — Multiplier Module
// Handles all 20X/50X boost multiplier logic and +2EB boost
// ============================================================
const Multiplier = (() => {
  const el = (id) => document.getElementById(id);
  // --- Constants ---
  const BOOST_DURATION_MS = 3600 * 1000;          // 1 Hour per activation
  const BOOST_MAX_BANK_MS = 6 * 3600 * 1000;     // Max 6 Hours banked
  const BOOST_COOLDOWN_MS = 30 * 60 * 1000;      // 30 Minutes for +2EB (was 20 — rebalanced)
  const BOOST_AD_MAX_TOTAL_MS = 10 * 3600 * 1000; // Ad-extended ceiling (6h bank + 4x1h)
  const BOOST_AD_PER_DAY = 4;                     // matches server AD_REWARD_DEFS.boost_hour
  // 50X event schedule now lives in CONFIG (single source of truth, matches
  // the eventAnchor baked into functions/index.js activateBoost).

  // --- DOM Elements Cache ---
  let multBtn = null;
  let activateBoostBtn = null;
  let boostBtn = null;
  // The countdown badge exists twice on purpose: the full readout inside the
  // Player Info header, and a compact twin on the map's Boost rail. Both are
  // tagged [data-boost-timer] and kept in sync together.
  let timerBadges = [];
  // Wallet block inside the Player Info header — carries the boost glow now
  // that the map's balance bar is gone.
  let heroCard = null;
  let boostHideTimer = null;
  let boostScheduleTimer = null;

  // --- Core Functions ---

  /**
   * Check if the global 50X event is currently active
   * @returns {boolean}
   */
  function is50XActive() {
    return CONFIG.is50XActive();
  }

  /**
   * Get the boost tier factor based on number of plots owned
   * Uses CONFIG.BOOST_TIERS anti-whale curve to scale down multiplier.
   * @param {number} plotCount - Total number of plots owned
   * @returns {number} Tier factor (1.0 = full multiplier, lower = scaled down)
   */
  function getTierFactor(plotCount) {
    const tiers = CONFIG.BOOST_TIERS;
    for (let i = tiers.length - 1; i >= 0; i--) {
      if (plotCount >= tiers[i].minPlots) return tiers[i].tierFactor;
    }
    return 1.0;
  }

  /**
   * Get the currently active base multiplier value (50 during the event, else 20)
   * REBALANCE 2026-10-08: base dropped 30X -> 20X.
   * @returns {number}
   */
  function getActiveMultiplier() {
    return is50XActive() ? 50 : 20;
  }

  /**
   * Get the effective multiplier after applying boost tier collapse
   * @param {object} state - Game state object
   * @returns {number} Effective multiplier (base * tierFactor)
   */
  function getEffectiveMultiplier(state) {
    const base = Number(state.boostMultiplier) === 50 ? 50 : 20;
    const plotCount = state.plots ? Object.keys(state.plots).length : 0;
    const tierFactor = getTierFactor(plotCount);
    return Math.round(base * tierFactor);
  }

  /**
   * Apply boost multiplier to a rate if boost is active, with tier collapse
   * @param {number} rate - Base rate to multiply
   * @param {object} state - Game state object
   * @param {boolean} isOtherPlayer - If viewing another player's stats
   * @returns {number} Rate with multiplier applied if applicable
   */
  function applyMultiplier(rate, state, isOtherPlayer = false) {
    if (isOtherPlayer) return rate;
    if (state.boostExpiry && Date.now() < state.boostExpiry) {
      // REBALANCE 2026-10-08: 30X is no longer a valid value. Legacy saves can
      // still carry boostMultiplier: 30, so normalise anything that is not the
      // 50X event down to 20 — otherwise old boosts keep paying at the old rate.
      const base = Number(state.boostMultiplier) === 50 ? 50 : 20;
      const plotCount = state.plots ? Object.keys(state.plots).length : 0;
      const tierFactor = getTierFactor(plotCount);
      return rate * base * tierFactor;
    }
    return rate;
  }

  /**
   * Activate boost for 1 hour, stacking up to 6 hours max.
   * Costs BOOST_ACTIVATION_COST_EB (2 EB) — the server debits it inside the
   * transaction, so we mirror the debit locally rather than trusting a client
   * side check.
   * @param {object} state - Game state object
   * @returns {Promise<{ok:boolean, mult?:number, costEb?:number, reason?:string}>}
   */
  async function activateBoost(state) {
    if (typeof ServerAntiCheat === "undefined" || !ServerAntiCheat.isReady()) {
      return { ok: false, reason: "offline" };
    }
    const result = await ServerAntiCheat.activateBoost();
    if (!result.activated) return { ok: false, reason: result.reason || "server_error" };
    state.boostExpiry = result.boostExpiry;
    state.boostMultiplier = result.boostMultiplier;
    const cost = Number(result.costEb) || 0;
    if (cost > 0) state.eb = Math.max(0, (Number(state.eb) || 0) - cost);
    Store.save(true);
    return { ok: true, mult: result.boostMultiplier, costEb: cost };
  }

  /**
   * Schedule the +2EB boost button appearance
   */
  function scheduleBoost() {
    if (!boostBtn) return;
    clearTimeout(boostScheduleTimer);

    const state = Store.get();
    const now = Date.now();
    const lastClaim = state?.lastBoostClaim || 0;
    const elapsed = now - lastClaim;

    // Calculate remaining wait time (prevents multi-tab and refresh exploits)
    const waitTime = Math.max(0, BOOST_COOLDOWN_MS - elapsed);

    boostScheduleTimer = setTimeout(() => {
      if (!boostBtn) return;
      boostBtn.classList.remove("hidden");

      // Stays visible for 45 seconds so human players have plenty of time to tap
      boostHideTimer = setTimeout(() => {
        boostBtn.classList.add("hidden");
        scheduleBoost();
      }, 45000);
    }, waitTime);
  }

  /**
   * Handle +2EB boost claim
   * @returns {object} { success: boolean, message: string }
   */
  async function claimBoost() {
    const state = Store.get();
    const now = Date.now();
    const lastClaim = state?.lastBoostClaim || 0;

    // Session lock check
    if (typeof Store !== "undefined" && !Store.isSessionActive()) {
      return { success: false, message: "🔒 Account active on another tab. Close the other tab first." };
    }

    // Anti-cheat: Embargo check
    if (typeof AntiCheat !== "undefined") {
      const check = AntiCheat.isActionAllowed("earn");
      if (!check.allowed) {
        return { success: false, message: check.reason };
      }
    }

    clearTimeout(boostHideTimer);
    boostBtn?.classList.add("hidden");

    if (typeof ServerAntiCheat === "undefined" || !ServerAntiCheat.isReady()) {
      return { success: false, message: "⚠️ Server connection required." };
    }

    // Get button position for particle effect
    const rect = boostBtn?.getBoundingClientRect();
    const originX = rect ? rect.left + rect.width / 2 : 0;
    const originY = rect ? rect.top + rect.height / 2 : 0;

    // --- OPTIMISTIC UI: the +2 EB lands on screen the instant you tap. The
    // server confirms in the background and its number is authoritative; a
    // rejection rolls the balance back and says so.
    const prevEb = Number(state.eb) || 0;
    state.eb = prevEb + 2;
    state.lastBoostClaim = now;
    Store.save(true);

    ServerAntiCheat.claimBoost().then((serverResult) => {
      const fresh = Store.get();
      if (!serverResult || !serverResult.claimed) {
        fresh.eb = prevEb;
        Store.save(true);
        if (typeof updateTopbar === "function") updateTopbar();
        showToast(serverResult && serverResult.reason === "cooldown"
          ? "⏳ Cooldown active — boost available every 30 minutes."
          : "⚠️ Boost could not be verified.", 3500);
        return;
      }
      fresh.lastBoostClaim = serverResult.lastBoostClaim;
      fresh.eb = serverResult.nextEb;
      Store.save(true);
      if (typeof updateTopbar === "function") updateTopbar();
    }).catch(() => {
      const fresh = Store.get();
      fresh.eb = prevEb;
      Store.save(true);
      if (typeof updateTopbar === "function") updateTopbar();
      showToast("⚠️ Boost could not be verified.", 3500);
    });

    // Schedule next 20-minute cycle
    scheduleBoost();

    return {
      success: true,
      message: "⚡ Claimed +2.00 EB Boost! (Next in 20m)",
      originX,
      originY
    };
  }

  // --- Screen Shake Controller ---

  /**
   * Set screen shake preference
   * @param {boolean} disabled - Disable shake effect
   */
  function setShakePreference(disabled) {
    const state = Store.get();
    state.disableShake = disabled;
    document.body.classList.toggle("no-shake", disabled);

    // Synchronize all checkboxes across all modals
    document.querySelectorAll("#toggle-shake-fx, #toggle-shake-fx-pool, .toggle-switch-input").forEach((box) => {
      box.checked = !disabled;
    });

    Store.save(true);
    const toastFn = window.showToast || alert;
    toastFn(disabled ? "🛡️ 50X Screen Shake disabled (Calm Mode)" : "🔥 50X Screen Shake enabled!", 2500);
  }

  /**
   * Initialize screen shake state on boot
   */
  function initShakeState() {
    const initialDisabled = Boolean(Store.get()?.disableShake);
    document.body.classList.toggle("no-shake", initialDisabled);
    document.querySelectorAll("#toggle-shake-fx, #toggle-shake-fx-pool, .toggle-switch-input").forEach((box) => {
      box.checked = !initialDisabled;
    });
  }

  // --- UI Update Functions ---

  // --- Android local notification for boost expiry ---
  // The client already knows the exact expiry (state.boostExpiry), so the OS
  // notification is scheduled locally rather than waiting on a server sweep.
  // WorkManager holds it across reboots and app updates natively.
  //
  // updateUI() ticks once a second, so we only talk to the native bridge when
  // the expiry actually moves — and re-announce on every launch, which is what
  // reschedules the notification after a reboot.
  let notifiedBoostExpiry = -1;
  function syncBoostNotification(state) {
    if (typeof NativeBridge === "undefined" || !NativeBridge.isAndroid) return;
    const expiry = Number(state?.boostExpiry) || 0;
    if (expiry === notifiedBoostExpiry) return;
    notifiedBoostExpiry = expiry;
    if (expiry > Date.now()) {
      const mult = Number(state.boostMultiplier) === 50 ? 50 : 20;
      NativeBridge.scheduleBoostEnd(expiry, mult);
    } else {
      NativeBridge.cancelBoostEnd();
    }
  }

  /**
   * Update all multiplier-related UI elements
   * @param {object} state - Game state object
   */
  function updateUI(state) {
    const now = Date.now();
    const is50XEvent = is50XActive();
    const isBoosted = state.boostExpiry && state.boostExpiry > now;

    // Swap the multiplier button image between 20x.png and 50x.png
    // Always show the BASE multiplier on the side hub (20X or 50X), not the
    // tier-collapsed effective value — whales see the real number in the top bar.
    const multImg = el("mult-img");
    if (multImg) {
      multImg.src = is50XEvent ? "assets/50x.png" : "assets/20x.png";
      multImg.alt = is50XEvent ? "50X Boost" : "20X Boost";
    }
    // Keep hidden mult-label in sync for accessibility / fallback
    const multLabel = el("mult-label");
    if (multLabel) {
      multLabel.textContent = is50XEvent ? "50X" : "20X";
    }

    if (multBtn) {
      if (is50XEvent) multBtn.classList.add("event-50x");
      else multBtn.classList.remove("event-50x");

      // The entry button must be visible while EITHER action is useful:
      //  - activate (2 EB / +1h) while the bank is below its 6h cap, or
      //  - ad extenders (+1h each, 10h ceiling) while banked >= 6h.
      // The old rule (hidden above ~5h) made the 6h bank unreachable and the
      // ad buttons unopenable — the modal hid exactly when ads became useful.
      // It now stays until the 10h ad ceiling (or ads exhausted), so all four
      // ad hours are claimable.
      const remainingForBtn = isBoosted ? (state.boostExpiry - now) : 0;
      const canBankMore = remainingForBtn < BOOST_MAX_BANK_MS;
      const usedAdHours = Number(state.player && state.player.adRewardCounts && state.player.adRewardCounts.boost_hour) || 0;
      const adsLeft = Math.max(0, BOOST_AD_PER_DAY - usedAdHours);
      const canAdExtend = remainingForBtn > BOOST_MAX_BANK_MS - BOOST_DURATION_MS
        && remainingForBtn < BOOST_AD_MAX_TOTAL_MS
        && adsLeft > 0
        && typeof Ads !== "undefined" && Ads.isRewardedAvailable();
      multBtn.classList.toggle("hidden", !(canBankMore || canAdExtend));
    }

    renderAdExtend(state);

    if (isBoosted) {
      const remainingMs = state.boostExpiry - now;
      // AUTOMATIC UPGRADE: If event is active, force active multiplier to 50X!
      const baseMult = is50XEvent ? 50 : (Number(state.boostMultiplier) === 50 ? 50 : 20);
      const plotCount = state.plots ? Object.keys(state.plots).length : 0;
      const tierFactor = getTierFactor(plotCount);
      const effectiveMult = Math.round(baseMult * tierFactor);

      heroCard?.classList.add("boosted");

      const hrs = Math.floor(remainingMs / 3600000);
      const mins = Math.floor((remainingMs % 3600000) / 60000);
      const secs = Math.floor((remainingMs % 60000) / 1000);
      const timerStr = `${String(hrs).padStart(2, "0")}:${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
      const icon = baseMult === 50 ? "🔥" : "⚡";
      const tierLabel = tierFactor < 1.0 ? ` (${Math.round(20 * tierFactor)}X)` : '';

      // Shaking & Vibrate Effect when 50X is active!
      if (baseMult === 50) heroCard?.classList.add("super-50x");
      else heroCard?.classList.remove("super-50x");

      // Full badge carries the icon + multiplier label; the map's compact twin
      // shows just the clock so it fits inside the 44px rail card.
      timerBadges.forEach((b) => {
        b.classList.remove("hidden");
        b.classList.toggle("super-50x", baseMult === 50);
        if (b.dataset.boostTimer === "mini") {
          const cd = b.querySelector(".boost-countdown");
          if (cd) cd.textContent = timerStr;
        } else {
          b.innerHTML = `${icon} ${effectiveMult}X BOOST${tierLabel} <span class="boost-countdown">${timerStr}</span>`;
        }
      });
    } else {
      heroCard?.classList.remove("boosted", "super-50x");
      timerBadges.forEach((b) => {
        b.classList.add("hidden");
        b.classList.remove("super-50x");
      });
    }

    syncBoostNotification(state);
  }

  /**
   * Get 50X event countdown data for pool modal
   * @returns {object} { isLive: boolean, remSec: number, label: string }
   */
  function get50XCountdownData() {
    const now = Date.now();
    const totalCycle = CONFIG.EVENT_50X_DURATION_MS + CONFIG.EVENT_50X_COOLDOWN_MS;
    let elapsed = (now - CONFIG.EVENT_50X_ANCHOR_MS) % totalCycle;
    if (elapsed < 0) elapsed += totalCycle;

    const isLive = elapsed < CONFIG.EVENT_50X_DURATION_MS;
    const remMs = isLive ? (CONFIG.EVENT_50X_DURATION_MS - elapsed) : (totalCycle - elapsed);
    const remSec = Math.max(0, Math.floor(remMs / 1000));

    const d = Math.floor(remSec / 86400);
    const h = Math.floor((remSec % 86400) / 3600);
    const m = Math.floor((remSec % 3600) / 60);
    const s = remSec % 60;

    const timerStr = `${String(d).padStart(2, "0")}D : ${String(h).padStart(2, "0")}H : ${String(m).padStart(2, "0")}M : ${String(s).padStart(2, "0")}s`;
    const label = isLive ? "🔥 50X Event Active! Ends In:" : "🔥 Next 50X Super Boost In:";

    return { isLive, remSec, timerStr, label };
  }

  // --- Event Listeners Setup ---

  /**
   * Wire up multiplier button and activate boost button
   */
  /**
   * Boost modal button state machine:
   *   - bank below "full" (a 2 EB activation still adds a whole hour):
   *     ACTIVATE BOOST is shown.
   *   - bank full (within 1h of the 6h cap, i.e. activation is a bad deal):
   *     the activate button is REPLACED by one "Watch Ad +1h" button. It can
   *     be tapped again and again (+1h each) until...
   *   - ...the 10h ad ceiling (or today's ads run out): BOTH buttons gone,
   *     just Cancel and a status line.
   * The activate button must never appear while the bank is full — pressing
   * it used to clamp an ad-extended 10h bank back DOWN to 6h (for 2 EB).
   */
  function renderAdExtend(state) {
    const actBtn = el("activate-boost-btn");
    const adBtn = el("boost-ad-btn");
    const note = el("boost-ad-note");
    const now = Date.now();
    const remaining = state && state.boostExpiry ? Math.max(0, state.boostExpiry - now) : 0;
    const adsReady = typeof Ads !== "undefined" && Ads.isRewardedAvailable();
    const used = Number(state && state.player && state.player.adRewardCounts && state.player.adRewardCounts.boost_hour) || 0;
    const adsLeft = Math.max(0, BOOST_AD_PER_DAY - used);
    const bankFull = remaining > BOOST_MAX_BANK_MS - BOOST_DURATION_MS;
    const atCeiling = remaining >= BOOST_AD_MAX_TOTAL_MS;
    const showAd = adsReady && bankFull && !atCeiling && adsLeft > 0;

    if (actBtn) actBtn.classList.toggle("hidden", bankFull);
    if (adBtn) {
      adBtn.classList.toggle("hidden", !showAd);
      if (!showAd) adBtn.disabled = false;
    }
    document.querySelectorAll(".boost-act-only").forEach((n) => n.classList.toggle("hidden", bankFull));

    if (note) {
      if (atCeiling) {
        note.textContent = "⚡ Boost bank is at max (10h).";
      } else if (bankFull && !adsReady) {
        note.textContent = "No ad provider here — the boost caps at 6h.";
      } else if (bankFull && adsLeft <= 0) {
        note.textContent = "No ad boosts left today — resets at midnight UTC.";
      } else if (showAd) {
        const moreH = Math.floor((BOOST_AD_MAX_TOTAL_MS - remaining) / 3600000);
        note.textContent = `⚡ Bank full — +1h per ad · ${adsLeft} left today · up to ${moreH}h more`;
      } else {
        note.textContent = "";
      }
    }
  }

  async function watchAdForBoostHour() {
    if (typeof Ads === "undefined" || !Ads.isRewardedAvailable()) return;
    const adBtn = el("boost-ad-btn");
    if (adBtn) adBtn.disabled = true;
    try {
      const earned = await Ads.showRewarded("boost_hour");
      if (!earned) {
        showToast("Ad not completed — no boost hour granted.", 3500);
        return;
      }
      const claim = await ServerAntiCheat.claimAdReward("boost_hour");
      if (!claim || !claim.ok) {
        const why = claim && claim.reason;
        showToast(
          why === "bank_not_maxed" ? "⚡ Bank at least 5h of boost first (2 EB per hour) — then ads extend past the 6h cap."
          : why === "boost_maxed" ? "⚡ Boost is already at the 10h ad max."
          : why === "daily_cap" ? "🎬 No ad boost hours left today."
          : "⚠️ Boost hour could not be granted.", 4200);
        return;
      }
      const st = Store.get();
      if (claim.boostExpiry) st.boostExpiry = Number(claim.boostExpiry);
      if (claim.adRewardCounts && st.player) st.player.adRewardCounts = claim.adRewardCounts;
      Store.save(true);
      updateTopbar();
      updateUI(st);
      showToast("⚡ +1 Hour banked!", 3200);
    } catch (e) {
      console.warn("[Multiplier] ad boost hour failed:", e);
    } finally {
      if (adBtn) adBtn.disabled = false;
      renderAdExtend(Store.get());
    }
  }

  function wireButtons() {
    multBtn = el("multiplier-btn");
    activateBoostBtn = el("activate-boost-btn");

    if (multBtn) {
      multBtn.addEventListener("click", () => {
        const is50X = is50XActive();
        const baseMult = is50X ? 50 : 20;
        const state = Store.get();
        const plotCount = state.plots ? Object.keys(state.plots).length : 0;
        const tierFactor = getTierFactor(plotCount);
        const effectiveMult = Math.round(baseMult * tierFactor);
        // Modal shows the REAL effective multiplier (with whale tier collapse)
        el("booster-modal-title").textContent = is50X ? "🔥 Activate 50X Super Boost" : "Activate 20X Boost";
        el("modal-mult-rate").textContent = `${effectiveMult}X Income`;
        // Near the 6h cap a 2 EB activation banks less than a full hour — say
        // what it actually gives instead of a hardcoded "+1 Hour".
        const rem = state.boostExpiry ? Math.max(0, state.boostExpiry - Date.now()) : 0;
        const gain = Math.min(BOOST_MAX_BANK_MS, rem + BOOST_DURATION_MS) - rem;
        const durEl = el("modal-mult-duration");
        if (durEl) {
          const gM = Math.max(1, Math.round(gain / 60000));
          durEl.textContent = gain >= 3600000
            ? `+${Math.floor(gain / 3600000)} Hour`
            : `+${gM} min`;
        }
        document.getElementById("booster-modal")?.classList.remove("hidden");
      });
    }

    if (activateBoostBtn) {
      activateBoostBtn.addEventListener("click", () => {
        const state = Store.get();
        activateBoost(state).then((res) => {
          if (!res || !res.ok) {
            const why = res && res.reason;
            showToast(
              why === "insufficient_eb"
                ? "⚠️ Not enough EB — activating a boost costs 2 EB."
                : why === "offline"
                  ? "⚠️ Server connection required to activate a boost."
                  : "⚠️ Boost could not be verified by the server.", 4000);
            return;
          }
        const activeMult = res.mult;
        document.getElementById("booster-modal")?.classList.add("hidden");
        updateTopbar();
        updateUI(state);
        const icon = activeMult === 50 ? "🔥" : "⚡";
        const plotCount = state.plots ? Object.keys(state.plots).length : 0;
        const tierFactor = getTierFactor(plotCount);
        const effectiveMult = Math.round(activeMult * tierFactor);
        const costNote = res.costEb ? ` · −${res.costEb} EB` : "";
        showToast(`${icon} ${effectiveMult}X Multiplier Activated! (+1 Hr${costNote})`);
        });
      });
    }
  }

  /**
   * Wire up the +2EB boost button
   */
  function wireBoostButton() {
    boostBtn = el("boost-btn");

    if (boostBtn) {
      boostBtn.addEventListener("click", (e) => {
        claimBoost().then((result) => {

        if (!result.success) {
          showToast(result.message, 4000);
          return;
        }

        updateTopbar();
        showToast(result.message);

        // Launch flying EB particle sparks into the HUD!
        if (typeof launchFlyingEBStream === "function" && result.originX) {
          launchFlyingEBStream(result.originX, result.originY, 2);
        }
        });
      });

      // Start initial cooldown check
      scheduleBoost();
    }
  }

  /**
   * Wire up screen shake toggle
   */
  function wireShakeToggle() {
    // Delegated click listener (Guaranteed to catch clicks in Weekly Pool modal!)
    document.addEventListener("change", (e) => {
      if (e.target && (e.target.id === "toggle-shake-fx" || e.target.id === "toggle-shake-fx-pool" || e.target.classList.contains("toggle-switch-input"))) {
        setShakePreference(!e.target.checked);
      }
    });
  }

  // --- Initialization ---

  /**
   * Initialize the Multiplier module
   */
  function init() {
    heroCard = el("profile-wallet");
    timerBadges = Array.from(document.querySelectorAll("[data-boost-timer]"));
    multBtn = el("multiplier-btn");

    initShakeState();
    wireButtons();
    el("boost-ad-btn")?.addEventListener("click", () => watchAdForBoostHour());
    wireBoostButton();
    wireShakeToggle();
    updateUI(Store.get());
  }

  // Public API
  return {
    init,
    is50XActive,
    getActiveMultiplier,
    getEffectiveMultiplier,
    getTierFactor,
    applyMultiplier,
    activateBoost,
    scheduleBoost,
    claimBoost,
    setShakePreference,
    updateUI,
    get50XCountdownData,
    BOOST_COOLDOWN_MS
  };
})();
