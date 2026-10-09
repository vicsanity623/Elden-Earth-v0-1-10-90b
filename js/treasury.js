// ============================================================
// Elden Earth — Treasury Gate (cashout solvency)
//
// One source of truth for "are cashouts open, and how close are we?". The
// cashout screen and the weekly pool modal both read through here so the two
// can never show different numbers.
//
// The gate is decided SERVER-SIDE (getTreasuryStatus / submitWithdrawalRequest).
// Everything here is display only — disabling a button in the browser is not a
// lock, and the server re-checks both the gate and the monthly payout budget.
// ============================================================
const Treasury = (() => {
  const CACHE_MS = 60000;
  let cached = null;
  let fetchedAt = 0;
  let inFlight = null;

  /**
   * Treasury state, cached for a minute so opening two modals back to back
   * doesn't hit the callable twice. Pass `force` to bypass the cache.
   */
  async function getStatus(force) {
    if (!force && cached && (Date.now() - fetchedAt) < CACHE_MS) return cached;
    if (inFlight) return inFlight;

    inFlight = (async () => {
      try {
        if (typeof firebase === "undefined" || !firebase.functions) return cached;
        const fn = firebase.functions().httpsCallable("getTreasuryStatus");
        const res = (await fn()).data;
        if (res && res.ok) {
          cached = res;
          fetchedAt = Date.now();
        }
      } catch (e) {
        // Tolerated: this is decoration. The real lock lives on the server, and
        // a cold start before the function is deployed should not break the UI.
        console.warn("[Treasury] status fetch failed:", e);
      } finally {
        inFlight = null;
      }
      return cached;
    })();
    return inFlight;
  }

  function fmtUsd(v) {
    return "$" + (Number(v) || 0).toFixed(2);
  }

  /**
   * Fill a .treasury-bar element with the progress bar and its caption.
   * Safe to call with a null status — it simply leaves the element empty.
   */
  function renderBar(container, status) {
    if (!container) return;
    if (!status) {
      container.innerHTML = "";
      container.classList.add("hidden");
      return;
    }
    container.classList.remove("hidden");

    const unlocked = !!status.unlocked;
    const fresh = status.fresh !== false;
    const pct = unlocked ? 100 : Math.round((Number(status.progress) || 0) * 100);
    container.classList.toggle("is-unlocked", unlocked);

    // A stale revenue figure locks the gate server-side, so say so plainly
    // instead of showing a progress bar that is not measuring anything.
    const caption = !fresh
      ? "The Realm's revenue figures are being updated — cashouts stay locked until they're current."
      : unlocked
        ? `Open this month · ${fmtUsd(status.monthPaidUsd)} of ${fmtUsd(status.monthlyPayoutBudgetUsd)} payout budget used`
        : `${fmtUsd(status.revenue)} / ${fmtUsd(status.threshold)} monthly ad revenue needed to unlock cashouts`;

    const label = !fresh ? "Cashouts Locked" : (unlocked ? "Cashouts Open" : "Cashouts Locked");
    const pctLabel = !fresh ? "Updating" : (unlocked ? "Goal met" : pct + "%");
    const width = !fresh ? 0 : pct;

    container.innerHTML = `
      <div class="treasury-bar-head">
        <span class="treasury-bar-label">${label}</span>
        <span class="treasury-bar-pct">${pctLabel}</span>
      </div>
      <div class="treasury-bar-track">
        <div class="treasury-bar-fill" style="width:${width}%"></div>
      </div>
      <div class="treasury-bar-caption">${caption}</div>
    `;
  }

  return { getStatus, renderBar, fmtUsd };
})();

window.Treasury = Treasury;
console.log("[EldenEarth] Treasury gate module loaded");
