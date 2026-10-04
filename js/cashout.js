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

  function updateUI() {
    const cash = getCashBalance();
    const age = getAccountAgeDays();
    const pending = hasPendingWithdrawal();

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

    // Determine eligibility
    const ageOk = getAccountAgeDays() >= 30;
    const balanceOk = cash >= minWithdraw;
    const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(paypalEmail);
    const amountOk = withdrawAmount >= minWithdraw && withdrawAmount <= Math.min(cash, maxWithdraw);
    const noPending = !pending;
    const allOk = ageOk && balanceOk && emailOk && amountOk && noPending;

    // Show/hide form
    if (cash >= minWithdraw && !pending) {
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
        if (pending) {
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
      if (pending) {
        hintEl.innerHTML = `⏳ <strong>Request pending review.</strong> You cannot submit another until this is processed.`;
      } else if (!ageOk) {
        hintEl.innerHTML = `🔒 <strong>Account must be 30+ days old.</strong> Current: ${getAccountAgeDays()} days.`;
      } else if (!balanceOk) {
        hintEl.innerHTML = `💰 <strong>Need $${minWithdraw.toFixed(2)}+</strong> to withdraw.`;
      } else {
        hintEl.innerHTML = `Available: <strong>${fmtCash(cash)}</strong> · Minimum $${minWithdraw.toFixed(2)}`;
      }
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
      toast("Account must be 30+ days old.", 4000);
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
          not_enough_cash: "Insufficient cash balance.",
          account_too_young: "Account must be 30+ days old.",
          already_pending: "You already have a pending request.",
          invalid_email: "Invalid PayPal email.",
          rate_limited: "Too many requests. Try again later.",
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
  }

  // Expose for main.js to call on cash balance changes
  return {
    init,
    updateUI,
    refreshAfterSync() { updateUI(); }
  };
})();