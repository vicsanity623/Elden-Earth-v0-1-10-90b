// ============================================================
// Elden Earth — Withdrawal Request System (Server-Authoritative)
// ============================================================
const Cashout = (() => {
  let isOpen = false;
  let withdrawAmount = 5.00;
  let minWithdraw = 5.00;
  let maxWithdraw = 1000.00;
  let step = 1.00;
  let paypalEmail = "";
  let isSubmitting = false;

  // Caps live in CONFIG.WITHDRAWAL so the UI can never drift from
  // functions/index.js WITHDRAWAL_MONTHLY_LIMIT_USD.
  const WITHDRAWAL_CFG = (typeof CONFIG !== "undefined" && CONFIG.WITHDRAWAL) ? CONFIG.WITHDRAWAL : {};
  const MONTHLY_LIMIT_USD = Number(WITHDRAWAL_CFG.monthlyLimitUsd) || 5.00;
  const MIN_ACCOUNT_AGE_DAYS = Number(WITHDRAWAL_CFG.minAccountAgeDays) || 90;

  const toast = (msg, ms = 3000) => {
    if (typeof window !== "undefined" && typeof window.showToast === "function") window.showToast(msg, ms);
    else console.log("[Cashout]", msg);
  };

  const el = (id) => document.getElementById(id);

  function fmtCash(v) {
    return "$" + (Number(v) || 0).toFixed(2);
  }

  function getCashBalance() {
    const state = Store.get();
    return Number(state?.cash) || 0;
  }

  function getAccountAgeDays() {
    const state = Store.get();
    const created = state?.createdAt || Date.now();
    return Math.floor((Date.now() - created) / (1000 * 60 * 60 * 24));
  }

  function hasPendingWithdrawal() {
    const state = Store.get();
    return state?.withdrawPending === true;
  }

  // --- Treasury gate (server-authoritative) ---
  // Display only. submitWithdrawalRequest re-checks the gate and the monthly
  // payout budget server-side, so a player who re-enables this button in dev
  // tools still gets refused.
  let treasuryStatus = null;

  async function refreshTreasury() {
    if (typeof Treasury === "undefined") return null;
    treasuryStatus = await Treasury.getStatus();
    Treasury.renderBar(el("cashout-treasury-bar"), treasuryStatus);
    return treasuryStatus;
  }

  function updateUI() {
    const cash = getCashBalance();
    const age = getAccountAgeDays();
    const pending = hasPendingWithdrawal();
    const weeklyData = Store.get()?.withdrawalWeekly || { paid: 0, lastPaidAt: 0 };

    const openBtn = el("cashout-open-withdraw-btn");
    const form = el("cashout-withdraw-form");
    const amountEl = el("cashout-withdraw-amount");
    const availableEl = el("cashout-available");
    const hintEl = el("cashout-withdraw-hint");
    const submitBtn = el("cashout-submit-withdrawal");
    const openBtn2 = el("cashout-open-withdraw-btn");
    const withdrawAmountEl = el("cashout-withdraw-amount");
    const emailInput = el("cashout-paypal-email");
    const decreaseBtn = el("cashout-withdraw-decrease");
    const increaseBtn = el("cashout-withdraw-increase");
    const weeklyLimitEl = el("cashout-weekly-limit");
    const cooldownEl = el("cashout-cooldown");

    // Determine eligibility
    const ageOk = getAccountAgeDays() >= MIN_ACCOUNT_AGE_DAYS;
    const balanceOk = cash >= minWithdraw;
    const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(paypalEmail);
    const amountOk = withdrawAmount >= minWithdraw && withdrawAmount <= Math.min(cash, maxWithdraw);
    const noPending = !pending;
    // Treasury gate: null/unknown is treated as locked. Fail closed — the
    // server refuses anyway, and an optimistic button just leads to a rejection.
    const treasuryOk = !treasuryStatus || !!treasuryStatus.unlocked;
    const monthBudgetOk = !treasuryStatus
      || !(Number(treasuryStatus.monthlyPayoutBudgetUsd) > 0)
      || withdrawAmount <= (Number(treasuryStatus.budgetRemainingUsd) || 0);
    const yearBudgetOk = !treasuryStatus
      || !(Number(treasuryStatus.yearlyPayoutBudgetUsd) > 0)
      || withdrawAmount <= (Number(treasuryStatus.yearBudgetRemainingUsd) || 0);
    const budgetOk = monthBudgetOk && yearBudgetOk;
    // Age gate. js/age.js is advisory — submitWithdrawalRequest re-checks 18+
    // server-side, so this only avoids sending a request that would bounce.
    const ageGateOk = (typeof AgeGate === "undefined") ? true : AgeGate.isRedemptionEligible();
    const allOk = ageOk && balanceOk && emailOk && amountOk && noPending && treasuryOk && budgetOk && ageGateOk;

    // Monthly cap & cooldown info. The server is authoritative — it sums paid
    // redemptions over a rolling 30 days. The local mirror is only written after
    // a redemption, so it is not shown as an "available" balance; that used to
    // claim the full $5 was free even when the month was already spent.
    const lastPaidAt = weeklyData?.lastPaidAt || 0;
    const cooldownMs = 48 * 60 * 60 * 1000;
    const cooldownActive = lastPaidAt && (Date.now() - lastPaidAt) < 48 * 60 * 60 * 1000;
    const cooldownHoursLeft = cooldownActive ? Math.ceil((cooldownMs - (Date.now() - lastPaidAt)) / (60 * 60 * 1000)) : 0;

    // Show/hide form
    if (cash >= minWithdraw && !pending && treasuryOk && budgetOk && ageGateOk) {
      if (openBtn2) {
        openBtn2.style.display = "block";
        openBtn2.disabled = false;
        openBtn2.textContent = "Request Withdrawal";
        openBtn2.classList.remove("hidden");
      }
    } else {
      if (openBtn2) {
        openBtn2.style.display = "block";
        openBtn2.disabled = true;
        if (!ageGateOk) {
          openBtn2.textContent = (typeof AgeGate !== "undefined" && !AgeGate.isVerified())
            ? "Confirm Your Age to Redeem"
            : "Redeeming Unlocks at 18";
        } else if (!treasuryOk) {
          openBtn2.textContent = "Cashouts Locked — Treasury Goal";
        } else if (!budgetOk) {
          openBtn2.textContent = !monthBudgetOk ? "Monthly Program Budget Spent" : "Yearly Program Budget Spent";
        } else if (pending) {
          openBtn2.textContent = "Request Pending Review";
        } else if (cash < minWithdraw) {
          openBtn2.textContent = `Need $${minWithdraw.toFixed(2)} to withdraw`;
        } else {
          openBtn2.textContent = "Withdrawal unavailable";
        }
        openBtn2.classList.remove("hidden");
      }
    }

    // Show form when open button clicked
    if (form) {
      form.style.display = "block";
    }

    // Update hint text
    if (hintEl) {
      if (!ageGateOk) {
        hintEl.innerHTML = (typeof AgeGate !== "undefined" && !AgeGate.isVerified())
          ? `🎂 <strong>Confirm your date of birth</strong> to unlock rewards redemption. Redeeming is available from age 18.`
          : `🎂 <strong>Rewards redemption unlocks at 18.</strong> Thanks for playing!`;
      } else if (!treasuryOk) {
        hintEl.innerHTML = `🏛️ <strong>Redemptions are locked</strong> until the Realm's ad revenue covers the program budget. Track the goal on this screen and in the Weekly Treasury.`;
      } else if (!budgetOk) {
        hintEl.innerHTML = !monthBudgetOk
          ? `🏛️ <strong>This month's program budget is spent.</strong> Redemptions reopen next month.`
          : `🏛️ <strong>This year's program budget is spent.</strong> Redemptions reopen next year.`;
      } else if (pending) {
        hintEl.innerHTML = `⏳ <strong>Request pending review.</strong> You cannot submit another until this is processed.`;
      } else if (!ageOk) {
        hintEl.innerHTML = `🔒 <strong>Account must be ${MIN_ACCOUNT_AGE_DAYS}+ days old.</strong> Current: ${getAccountAgeDays()} days.`;
      } else if (!balanceOk) {
        hintEl.innerHTML = `💰 <strong>Need $${minWithdraw.toFixed(2)}+</strong> to withdraw.`;
      } else {
        hintEl.innerHTML = `Available: <strong>${fmtCash(cash)}</strong> · Minimum $${minWithdraw.toFixed(2)}`;
      }
    }

    // Monthly cap & cooldown readouts. The server holds the real rolling total;
    // this states the policy rather than inventing an "available" figure.
    if (weeklyLimitEl) {
      weeklyLimitEl.textContent = `Monthly limit: $${MONTHLY_LIMIT_USD.toFixed(2)} per player`;
    }
    if (cooldownEl) {
      cooldownEl.textContent = cooldownActive
        ? `⏳ Payout cooldown active — ${cooldownHoursLeft}h remaining.`
        : "No payout cooldown.";
    }

    // Enable/disable submit button
    if (submitBtn) {
      submitBtn.disabled = !allOk || isSubmitting;
      if (isSubmitting) submitBtn.textContent = "Submitting...";
      else submitBtn.textContent = "Submit Withdrawal Request";
    }

    // Update amount controls
    if (withdrawAmountEl) withdrawAmountEl.textContent = withdrawAmount.toFixed(2);
    if (decreaseBtn) decreaseBtn.disabled = withdrawAmount <= minWithdraw;
    if (increaseBtn) increaseBtn.disabled = withdrawAmount >= Math.min(cash, maxWithdraw);
  }

  function openWithdrawForm() {
    const form = el("cashout-withdraw-form");
    const openBtn = el("cashout-open-withdraw-btn");
    if (form) form.style.display = "block";
    if (openBtn) openBtn.style.display = "none";
    updateUI();
  }

  function closeWithdrawForm() {
    const form = el("cashout-withdraw-form");
    const openBtn = el("cashout-open-withdraw-btn");
    if (form) form.style.display = "none";
    if (openBtn) openBtn.style.display = "block";
  }

  function changeAmount(delta) {
    const cash = getCashBalance();
    const newAmount = Math.max(minWithdraw, Math.min(maxWithdraw, cash, withdrawAmount + delta));
    if (newAmount !== withdrawAmount) {
      withdrawAmount = Math.round(newAmount * 100) / 100;
      updateUI();
    }
  }

  function setEmail(value) {
    paypalEmail = value.trim();
    updateUI();
  }

  async function submitRequest() {
    if (isSubmitting) return;
    const cash = getCashBalance();
    if (withdrawAmount < minWithdraw || withdrawAmount > cash) {
      toast("Invalid amount.", 3000);
      return;
    }
    if (getAccountAgeDays() < 30) {
      toast(`Account must be ${MIN_ACCOUNT_AGE_DAYS}+ days old.`, 4000);
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(paypalEmail)) {
      toast("Enter a valid PayPal email.", 3000);
      return;
    }
    if (hasPendingWithdrawal()) {
      toast("You already have a pending request.", 3000);
      return;
    }
    if (treasuryStatus && !treasuryStatus.unlocked) {
      toast("🏛️ Cashouts are locked until the Realm's revenue goal is met.", 4000);
      return;
    }
    if (typeof ServerAntiCheat === "undefined" || !ServerAntiCheat.isReady()) {
      toast("⚠️ Server connection required.", 3500);
      return;
    }

    isSubmitting = true;
    updateUI();

    try {
      const result = await ServerAntiCheat.submitWithdrawalRequest({
        amount: withdrawAmount,
        paypalEmail: paypalEmail
      });

      if (!result?.ok) {
        const msgs = {
          not_enough_cash: "Insufficient rewards balance.",
          account_too_young: `Account must be ${MIN_ACCOUNT_AGE_DAYS}+ days old.`,
          already_pending: "You already have a pending request.",
          invalid_email: "Invalid PayPal email.",
          rate_limited: "Too many requests. Try again later.",
          monthly_limit_exceeded: `Monthly limit reached (${fmtCash(result.monthlyPaid)} of ${fmtCash(result.limit)}). Try next month.`,
          cooldown_active: `Cooldown active: ${result.hoursLeft}h until next redemption.`,
          phone_verification_required: "📱 Verify your phone number before redeeming rewards.",
          region_unverified: "🌍 We couldn't confirm your location. Open the game with location enabled and try again.",
          region_restricted: "Redemptions are not available in your region.",
          user_not_found: "Account not found. Please sign in again.",
          treasury_locked: `🏛️ Redemptions are locked — the Realm has earned ${fmtCash(result.revenue)} of the ${fmtCash(result.threshold)} revenue goal.`,
          monthly_budget_exhausted: `🏛️ This month's program budget is spent (${fmtCash(result.monthPaid)} of ${fmtCash(result.budget)}). Try next month.`,
          yearly_budget_exhausted: `🏛️ This year's program budget is spent (${fmtCash(result.yearPaid)} of ${fmtCash(result.yearBudget)}). Try next year.`,
          age_verification_required: "🎂 Confirm your date of birth before redeeming rewards.",
          age_not_eligible: "🎂 Rewards redemption is available from age 18.",
        };
        toast(msgs[result?.reason] || `Failed: ${result?.reason || "unknown"}`, 4000);
        return;
      }

      // Server deducted cash — mirror locally immediately (prevents max-merge refund)
      const state = Store.get();
      state.cash = Math.max(0, Number(result.nextCash) || 0);
      state.withdrawPending = true;
      Store.save(true);
      if (typeof updateTopbar === "function") updateTopbar();

      toast(`📝 Withdrawal request submitted! $${withdrawAmount.toFixed(2)} locked.`, 5000);
      closeWithdrawForm();
      updateUI();
    } catch (e) {
      console.warn("[Cashout] submit error:", e);
      toast("⚠️ Submission failed — try again.", 3000);
    } finally {
      isSubmitting = false;
      updateUI();
    }
  }

  function bind() {
    el("cashout-open-withdraw-btn")?.addEventListener("click", openWithdrawForm);
    el("cashout-withdraw-decrease")?.addEventListener("click", () => changeAmount(-1));
    el("cashout-withdraw-increase")?.addEventListener("click", () => changeAmount(1));
    el("cashout-paypal-email")?.addEventListener("input", (e) => setEmail(e.target.value));
    el("cashout-submit-withdrawal")?.addEventListener("click", submitRequest);
    el("cashout-withdraw-amount")?.addEventListener("input", (e) => {
      const val = parseFloat(e.target.value);
      if (!isNaN(val) && val >= 5) withdrawAmount = Math.min(val, getCashBalance());
      updateUI();
    });
  }

  function init() {
    bind();
    // Initial UI state
    updateUI();
    // The treasury gate is server state, so fetch it once up front — otherwise
    // the lock is wrong on the very first render.
    refreshTreasury().then(() => updateUI());
  }

  // Expose for main.js to call on cash balance changes
  return {
    init,
    updateUI,
    refreshTreasury,
    refreshAfterSync() {
      updateUI();
      refreshTreasury().then(() => updateUI());
    }
  };
})();