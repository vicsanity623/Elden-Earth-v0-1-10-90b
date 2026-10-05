// ============================================================
// Elden Earth — Plot Trade UI
// Local (≤500m, both online, free) / Remote (25 EB, ≤48h relay).
// Commit-reveal: choices stay sealed until both sides have picked.
// ============================================================
const Trade = (() => {
  let current = null;      // { friendshipId, friendName, type }
  let trade = null;        // redacted trade view from the server
  let selectedInstance = null;
  let pollTimer = null;

  function db() { return Store.getDb(); }
  function state() { return Store.get(); }

  function toast(msg, dur) {
    if (typeof window.showToast === "function") window.showToast(msg, dur);
    else console.log("[Trade]", msg);
  }

  function el(id) { return document.getElementById(id); }

  function ready() {
    return typeof ServerAntiCheat !== "undefined" && ServerAntiCheat.isReady();
  }

  function rarityLabel(key) {
    return ({ common: "Common", rare: "Rare", epic: "Epic", legendary: "Legendary" })[key] || key;
  }

  function rarityClass(key) { return `trade-rarity-${key}`; }

  // ---------- OPEN / CLOSE ----------
  async function open(opts) {
    current = {
      friendshipId: opts.friendshipId,
      friendName: opts.friendName || "Friend",
      type: opts.type === "local" ? "local" : "remote",
    };
    selectedInstance = null;
    trade = null;

    const modal = el("trade-modal");
    if (!modal) return;
    modal.classList.remove("hidden");
    modal.style.zIndex = "2147483647";

    const title = el("trade-title");
    if (title) title.textContent = current.type === "local" ? "📍 Local Trade" : "🌐 Remote Trade";
    const fname = el("trade-friend-name");
    if (fname) fname.textContent = current.friendName;

    const fine = el("trade-fine");
    if (fine) {
      fine.textContent = current.type === "local"
        ? "Both of you must be online within 500m. Free — no relay fee."
        : `25 EB relay fee. Your friend has up to 48h to commit their plot.`;
    }

    setStatus("creating", "Opening trade…");
    renderBag();
    renderSlots();
    updateConfirmButton();

    if (!ready()) {
      setStatus("error", "Server offline — try again later.");
      return;
    }

    const res = await ServerAntiCheat.createTrade({ friendshipId: current.friendshipId, type: current.type });
    if (!res || !res.ok) {
      let msg = failText(res && res.reason);
      const left = res && Number(res.daysLeft);
      if (res && res.reason === "account_too_new" && left) {
        msg = `Trading unlocks in ${left} day${left === 1 ? "" : "s"} — accounts must be 14 days old.`;
      } else if (res && res.reason === "friend_account_too_new" && left) {
        msg = `Your friend's account is too new — trading unlocks in ${left} day${left === 1 ? "" : "s"}.`;
      }
      setStatus("error", msg);
      return;
    }
    trade = res.trade;
    // A resumed trade may have been opened with the OTHER type — adopt it so
    // the header, fee text and bag reflect what will actually settle.
    if (res.resumed && trade.type && trade.type !== current.type) {
      current.type = trade.type === "local" ? "local" : "remote";
      if (title) title.textContent = current.type === "local" ? "📍 Local Trade" : "🌐 Remote Trade";
      if (fine) {
        fine.textContent = current.type === "local"
          ? "Both of you must be online within 500m. Free — no relay fee."
          : "25 EB relay fee. Your friend has up to 48h to commit their plot.";
      }
    }
    setStatus(trade.status, statusText(trade.status));
    renderBag();
    renderSlots();
    updateConfirmButton();
    if (res.resumed) toast("↻ Resumed your open trade.", 2500);
    startPolling();
  }

  function close() {
    stopPolling();
    el("trade-modal")?.classList.add("hidden");
    el("trade-swap-overlay")?.classList.add("hidden");
    current = null; trade = null; selectedInstance = null;
  }

  function failText(reason) {
    switch (reason) {
      case "friend_not_nearby": return "Your friend isn't nearby (need both online within 500m).";
      case "too_far": return "You're too far apart — get within 500m.";
      case "daily_trade_limit": return "Daily trade limit reached (20/day).";
      case "friend_trade_limit": return "Only 3 trades per friend per day.";
      case "insufficient_eb": return "Not enough EB for the 25 EB relay fee.";
      case "not_a_friend": return "That friendship could not be found.";
      case "friendship_not_found": return "That friendship could not be found.";
      case "account_too_new": return "New accounts unlock trading after 14 days.";
      case "friend_account_too_new": return "Your friend's account is under 14 days old — trading unlocks soon.";
      case "plot_busy": return "That plot is already in another trade.";
      case "plot_in_trade": return "That plot is committed to an open trade.";
      case "not_in_bag": return "That plot is no longer in your bag.";
      case "trade_not_open": return "This trade is no longer open.";
      case "trade_expired": return "This trade expired.";
      case "plot_no_longer_in_bag": return "A committed plot left the bag — trade voided.";
      case "not_revealed": return "Both sides must commit before confirming.";
      case "server_error": return "Server error — please try again.";
      case "rate_limited": return "Too many attempts — wait a moment and try again.";
      default: return "Could not start the trade.";
    }
  }

  function statusText(s) {
    return ({
      selecting: "Selecting…",
      revealed: "Both committed — confirm!",
      confirming: "Waiting for friend…",
      completed: "Complete",
      cancelled: "Cancelled",
      expired: "Expired",
    })[s] || "…";
  }

  function setStatus(s, text) {
    const chip = el("trade-status-chip");
    if (chip) {
      chip.textContent = text || statusText(s);
      chip.className = "trade-status-chip trade-status-" + (s || "error");
    }
    const fine = el("trade-fine");
    if (fine && s === "error") fine.textContent = text || "";
    const prog = el("trade-progress");
    if (prog) prog.textContent = "";
  }

  // ---------- POLLING ----------
  function startPolling() {
    stopPolling();
    pollTimer = setInterval(() => {
      // The generic modal close (X button / backdrop tap) hides the modal
      // directly, so stop ourselves as soon as it's gone from view.
      const modal = el("trade-modal");
      if (!modal || modal.classList.contains("hidden")) { close(); return; }
      refresh();
    }, 3000);
  }
  function stopPolling() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  }

  async function refresh() {
    if (!trade || !trade.tradeId || !ready()) return;
    const res = await ServerAntiCheat.getTrade({ tradeId: trade.tradeId });
    if (!res || !res.ok) return;
    const prev = trade;
    trade = res.trade;
    if (trade.status === "completed" && prev.status !== "completed") {
      stopPolling();
      applyCompletedTrade();
      renderSlots();
      playSwap();
      return;
    }
    setStatus(trade.status, statusText(trade.status));
    renderSlots();
    updateConfirmButton();
    renderBag();
  }

  // ---------- BAG (stacked rarity grid) ----------
  // The plot already committed to this trade stays in the cloud bag but is
  // frozen by trade_locks — hide it from the pickable count so it never
  // looks like a spare copy you could offer twice.
  function committedInstanceId() {
    return (trade && trade.mine && trade.mine.committed) ? trade.mine.instanceId : null;
  }

  function bagGroups() {
    const s = state();
    const items = s?.plotBagItems || {};
    const lucky = s?.luckyBagItems || {};
    const locked = committedInstanceId();
    const groups = {};
    for (const id in items) {
      if (locked && id === locked) continue;
      const r = String(items[id] || "common").split("_")[0];
      const isL = lucky[id] === true;
      const key = isL ? `${r}~lucky` : r;
      if (!groups[key]) groups[key] = { rarity: r, lucky: isL, count: 0, sampleId: id };
      groups[key].count++;
      if (!groups[key].sampleId) groups[key].sampleId = id;
    }
    const order = { common: 0, rare: 1, epic: 2, legendary: 3 };
    return Object.values(groups).sort((a, b) => (order[a.rarity] ?? 9) - (order[b.rarity] ?? 9) || (b.lucky ? 1 : 0) - (a.lucky ? 1 : 0));
  }

  function renderBag() {
    const grid = el("trade-bag-grid");
    if (!grid) return;
    const groups = bagGroups();
    if (!groups.length) {
      grid.innerHTML = committedInstanceId()
        ? `<div class="trade-bag-empty">🔒 Your choice is sealed — waiting for your friend.</div>`
        : `<div class="trade-bag-empty">No plots in your bag — pick up plots from the map first.</div>`;
      return;
    }
    grid.innerHTML = groups.map(g => {
      const sel = selectedInstance && state()?.plotBagItems?.[selectedInstance];
      const anySel = Boolean(sel);
      const active = anySel && String(state().plotBagItems[selectedInstance]).split("_")[0] === g.rarity && (state().luckyBagItems?.[selectedInstance] === true) === g.lucky;
      return `
        <button class="trade-bag-btn ${rarityClass(g.rarity)} ${g.lucky ? "bag-btn-lucky" : ""} ${active ? "is-selected" : ""}"
          data-rarity="${g.rarity}" data-lucky="${g.lucky ? "1" : "0"}" title="${rarityLabel(g.rarity)}${g.lucky ? " (Lucky)" : ""}">
          <span class="trade-bag-count">x${g.count}</span>
          <span class="trade-bag-name">${g.lucky ? "🍀 " : ""}${rarityLabel(g.rarity)}</span>
        </button>`;
    }).join("");

    grid.querySelectorAll(".trade-bag-btn").forEach(btn => {
      btn.addEventListener("click", () => pickFromGroup(btn.dataset.rarity, btn.dataset.lucky === "1"));
    });
  }

  // Pick the first instance in this rarity+lucky group (exact-match, so a
  // Lucky Common never gets confused with a normal Common).
  function pickFromGroup(rarity, isLucky) {
    const s = state();
    const items = s?.plotBagItems || {};
    const lucky = s?.luckyBagItems || {};
    const locked = committedInstanceId();
    if (locked) return;
    for (const id in items) {
      if (String(items[id]).split("_")[0] !== rarity) continue;
      if ((lucky[id] === true) !== isLucky) continue;
      selectedInstance = id;
      break;
    }
    renderBag();
    renderSlots();
    updateConfirmButton();
  }

  // ---------- SLOTS ----------
  function slotHtml(side, data) {
    if (!data) return `<span class="trade-slot-empty">${side === "me" ? "Tap a plot below" : "Waiting for them…"}</span>`;
    const r = data.rarity || "common";
    const lucky = data.lucky === true;
    const ready = data.committed ? "✓" : "";
    return `<div class="trade-slot-inner ${rarityClass(r)} ${lucky ? "slot-lucky" : ""}">
      <span class="trade-slot-rarity">${lucky ? "🍀 " : ""}${rarityLabel(r)}</span>
      <span class="trade-slot-flag">${ready || "…"}</span>
    </div>`;
  }

  function renderSlots() {
    const me = el("trade-slot-me");
    const them = el("trade-slot-them");
    if (me) {
      let mine = trade && trade.mine;
      if (!mine && selectedInstance) {
        const s = state();
        mine = { rarity: String(s.plotBagItems[selectedInstance] || "common").split("_")[0], lucky: s.luckyBagItems?.[selectedInstance] === true, committed: false };
      }
      me.innerHTML = slotHtml("me", mine);
    }
    if (them) them.innerHTML = slotHtml("them", trade ? trade.theirs : null);
  }

  function updateConfirmButton() {
    const btn = el("trade-confirm-btn");
    if (!btn) return;
    if (!trade) { btn.disabled = true; btn.textContent = "🔒 Commit Plot"; return; }

    if (trade.status === "selecting") {
      const committed = trade.mine && trade.mine.committed;
      btn.disabled = committed || !selectedInstance;
      btn.textContent = committed ? "✓ Committed — waiting" : "🔒 Commit Plot";
    } else if (trade.status === "revealed" || trade.status === "confirming") {
      const confirmed = trade.selfConfirmed;
      btn.disabled = confirmed || !trade.theirs;
      btn.textContent = confirmed ? "✓ Confirmed — waiting" : "✅ Confirm Trade";
    } else if (trade.status === "completed") {
      btn.disabled = true;
      btn.textContent = "✓ Complete";
    } else {
      btn.disabled = true;
      btn.textContent = "—";
    }
  }

  // ---------- ACTIONS ----------
  async function onConfirm() {
    if (!trade || !ready()) return;
    const btn = el("trade-confirm-btn");
    if (btn) btn.disabled = true;

    if (trade.status === "selecting") {
      if (!selectedInstance) { toast("⚠️ Pick a plot first.", 2500); if (btn) btn.disabled = false; return; }
      const res = await ServerAntiCheat.selectTradePlot({ tradeId: trade.tradeId, instanceId: selectedInstance });
      if (!res || !res.ok) {
        toast("⚠️ " + failText(res && res.reason), 3000);
        if (btn) btn.disabled = false;
        return;
      }
      trade = res.trade;
      selectedInstance = null;
      setStatus(trade.status, statusText(trade.status));
      renderBag(); renderSlots(); updateConfirmButton();
      if (trade.status === "revealed") toast("🤝 Both committed — confirm to trade!", 3000);
      else toast("🔒 Choice sealed — waiting for your friend.", 3000);
      return;
    }

    if (trade.status === "revealed" || trade.status === "confirming") {
      const res = await ServerAntiCheat.confirmTrade({ tradeId: trade.tradeId });
      if (!res || !res.ok) {
        toast("⚠️ " + failText(res && res.reason), 3000);
        if (btn) btn.disabled = false;
        return;
      }
      trade = res.trade;
      setStatus(trade.status, statusText(trade.status));
      renderSlots(); updateConfirmButton();
      if (res.executed) {
        stopPolling();
        applyCompletedTrade();
        playSwap();
      } else {
        toast("✅ Confirmed — waiting for your friend.", 3000);
      }
      return;
    }
  }

  async function onCancel() {
    if (!trade || !ready()) return;
    const res = await ServerAntiCheat.cancelTrade({ tradeId: trade.tradeId });
    if (res && res.ok) {
      toast("Trade cancelled.", 2500);
      close();
    } else {
      toast("⚠️ Could not cancel.", 2500);
    }
  }

  // Server already moved the instanceIds between bags. Mirror that into local
  // state so the bag grid and land counts are correct without waiting for the
  // next cloud sync (which could briefly show a plot we no longer own).
  function applyCompletedTrade() {
    if (!trade || !trade.result) return;
    const s = state();
    if (!s) return;
    const items = { ...(s.plotBagItems || {}) };
    const lucky = { ...(s.luckyBagItems || {}) };
    // What I gave leaves my bag; what I received enters it with the re-rolled
    // rarity/lucky the server settled on. The other side's plot is NOT mine.
    const givenId = trade.mine?.instanceId;
    const got = trade.result.mine || {};

    if (givenId) { delete items[givenId]; delete lucky[givenId]; }
    if (got.instanceId) delete lucky[got.instanceId];
    if (got.instanceId) items[got.instanceId] = got.rarity || "common";
    if (got.instanceId && got.lucky) lucky[got.instanceId] = true;

    s.plotBagItems = items;
    s.luckyBagItems = lucky;
    try {
      if (typeof Store !== "undefined" && Store.save) Store.save(true);
    } catch (e) { console.warn("[Trade] local bag save failed:", e); }
    renderBag();
  }

  // ---------- SWAP ANIMATION ----------
  function playSwap() {
    const ov = el("trade-swap-overlay");
    if (!ov || !trade || !trade.result) { if (ov) ov.classList.add("hidden"); return; }

    const mine = trade.result.mine || {};
    const theirs = trade.result.theirs || {};
    const set = (id, data) => {
      const node = el(id);
      if (node) {
        node.textContent = `${rarityLabel(data.rarity)} plot`;
        node.className = `trade-swap-rarity ${rarityClass(data.rarity)}`;
      }
    };
    set("swap-rarity-me", mine);
    set("swap-rarity-them", theirs);
    const lm = el("swap-lucky-me");
    const lt = el("swap-lucky-them");
    if (lm) lm.textContent = mine.lucky ? "🍀 LUCKY!" : "";
    if (lt) lt.textContent = theirs.lucky ? "🍀 LUCKY!" : "";
    const title = el("swap-title");
    if (title) title.textContent = (mine.lucky || theirs.lucky) ? "🍀 LUCKY TRADE!" : "TRADE COMPLETE!";

    ov.classList.remove("hidden");
    ov.style.zIndex = "2147483647";
    setTimeout(() => {
      ov.classList.add("hidden");
      close();
      const s = state();
      if (s && typeof Store !== "undefined" && Store.save) Store.save(true);
    }, 2600);
  }

  // ---------- PUBLIC API ----------
  return {
    open,
    close,
    onConfirm,
    onCancel,
    get current() { return current; },
    get trade() { return trade; },
  };
})();

// Bind modal buttons once the DOM is ready.
if (typeof document !== "undefined") {
  const bindTradeButtons = () => {
    const confirmBtn = document.getElementById("trade-confirm-btn");
    const cancelBtn = document.getElementById("trade-cancel-btn");
    if (confirmBtn) confirmBtn.addEventListener("click", () => Trade.onConfirm());
    if (cancelBtn) cancelBtn.addEventListener("click", () => Trade.onCancel());
  };
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bindTradeButtons);
  } else {
    bindTradeButtons();
  }
}
