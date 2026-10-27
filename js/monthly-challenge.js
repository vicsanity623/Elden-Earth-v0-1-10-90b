/* ==========================================================================
   Elden Earth — Plot Rush (monthly challenge)
   A second community event that runs alongside the weekly Global Challenge.

   Rounds open on the 1st and the 15th (00:00 UTC) and run for 7 days. Every
   plot a player buys is one point for them and one step toward the community
   goal of 1,000 plots. Top 500 share the pool; the podium gets extra rewards.

   Lives in `events/plot_challenge` — a completely separate document from
   `events/global_challenge`, so the two can be live at the same time.

   Reuses the existing `ge-*` modal styling so the two events look related.
   ========================================================================== */
const PlotChallenge = (() => {
  "use strict";

  const el = (id) => document.getElementById(id);
  const toast = (msg, ms = 3000) => {
    try { if (typeof showToast === "function") { showToast(msg, ms); return; } } catch (e) {}
    console.log("[PlotChallenge]", msg);
  };

  let lastEvent = null;
  let lastMe = null;
  let lastTop = [];
  let unsub = null;
  let modalTimer = null;

  /* --------------------------------------------------------- formatting */
  function fmtNum(n) {
    const v = Number(n) || 0;
    return v >= 1000 ? v.toLocaleString() : String(v);
  }
  function fmtCountdown(ms) {
    if (ms <= 0) return "ENDED";
    const s = Math.floor(ms / 1000);
    const d = Math.floor(s / 86400);
    const h = Math.floor((s % 86400) / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    return `${d}D : ${String(h).padStart(2, "0")}H : ${String(m).padStart(2, "0")}M : ${String(sec).padStart(2, "0")}S`;
  }
  function fmtDaysAway(ms) {
    if (ms <= 0) return "now";
    const d = Math.floor(ms / 86400000);
    const h = Math.floor((ms % 86400000) / 3600000);
    if (d >= 1) return `${d}d ${h}h`;
    const m = Math.floor(ms / 60000);
    return m >= 60 ? `${h}h` : `${m}m`;
  }
  function isExpired(ev) {
    if (!ev) return true;
    return ev.completed === true || (Number(ev.deadline) > 0 && Date.now() > Number(ev.deadline));
  }

  /* --------------------------------------------- schedule (mirrors server) */
  const DURATION_MS = 7 * 24 * 60 * 60 * 1000;
  const ROUND_DAYS = [1, 15];
  function pad2(n) { return String(n).padStart(2, "0"); }

  /** The round covering `now`, or the next upcoming one when in the gap. */
  function currentRound(nowMs) {
    const now = Number(nowMs) || Date.now();
    const d = new Date(now);
    const y = d.getUTCFullYear();
    const m = d.getUTCMonth();
    const candidates = [];
    ROUND_DAYS.forEach((day) => {
      candidates.push(Date.UTC(y, m, day));
      candidates.push(Date.UTC(y, m - 1, day));
    });
    let best = null;
    candidates.forEach((start) => {
      const end = start + DURATION_MS;
      if (now >= start && now < end && (!best || start > best.start)) best = { start, end };
    });
    if (best) {
      return { ...best, key: roundKey(best.start), live: true };
    }
    const upcoming = [];
    ROUND_DAYS.forEach((day) => {
      const a = Date.UTC(y, m, day);
      if (a > now) upcoming.push(a);
      const b = Date.UTC(y, m + 1, day);
      if (b > now) upcoming.push(b);
    });
    upcoming.sort((x, z) => x - z);
    const next = upcoming[0] || (Date.UTC(y, m + 1, 1) + DURATION_MS);
    return { start: next, end: next + DURATION_MS, key: roundKey(next), live: false };
  }
  function roundKey(ms) {
    const d = new Date(ms);
    return `p${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
  }

  /* ------------------------------------------------------------- render */
  function rewardsHtml() {
    return `
      <div class="ge-rewards-box">
        <strong>🏆 TOP 500 PLOT REWARDS</strong>
        <div class="ge-reward-line"><span>🥇 Rank 1</span><span>10 RP · 1,000 EB · 250 💎 · 1 Epic Lucky plot</span></div>
        <div class="ge-reward-line"><span>🥈 Rank 2</span><span>5 RP · 500 EB · 100 💎 · 1 Epic plot</span></div>
        <div class="ge-reward-line"><span>🥉 Rank 3</span><span>2 RP · 100 EB · 50 💎</span></div>
        <div class="ge-reward-line"><span class="muted">✓ Top 500</span><span class="muted">Share of the 100,000 EB pool</span></div>
      </div>`;
  }

  function renderModal() {
    const ev = lastEvent || {};
    const me = lastMe || {};
    const goal = Number(ev.goal) || 1000;
    const total = Number(ev.totalPlots) || 0;
    const pct = goal > 0 ? Math.min(100, (total / goal) * 100) : 0;
    const expired = isExpired(ev);

    const set = (id, txt) => { const n = el(id); if (n) n.textContent = txt; };
    set("mc-title", ev.title || "Plot Rush");
    set("mc-sub", ev.subtitle || "Buy plots — help the Realm claim 1,000!");
    set("mc-total", fmtNum(total));
    set("mc-goal", fmtNum(goal));
    set("mc-pct", pct.toFixed(1) + "%");
    const bar = el("mc-progress-bar");
    if (bar) bar.style.width = pct + "%";

    const status = el("mc-status");
    if (status) {
      if (expired && pct >= 100) status.textContent = "🎉 Realm goal hit! Rewards ready.";
      else if (expired) status.textContent = "⏳ Round ended — claim your rewards below.";
      else if (pct >= 100) status.textContent = "🎉 Realm goal hit! Event will close at deadline.";
      else status.textContent = "Keep buying plots — every purchase counts!";
    }

    set("mc-countdown", expired ? "ENDED" : fmtCountdown(Number(ev.deadline) - Date.now()));
    set("mc-my-points", fmtNum(me.points || 0));
    set("mc-my-rank", me.rank ? "#" + me.rank : "—");
    set("mc-my-share", fmtNum(me.prize || ev.share || 0) + " EB");

    const rewards = el("mc-rewards");
    if (rewards && !rewards.dataset.rendered) {
      rewards.innerHTML = rewardsHtml();
      rewards.dataset.rendered = "1";
    }

    const claim = el("mc-claim-btn");
    if (claim) {
      if (expired && me.canClaim) {
        claim.classList.remove("hidden");
        claim.disabled = false;
        claim.textContent = "Claim Rewards";
      } else {
        claim.classList.add("hidden");
      }
    }

    const list = el("mc-top");
    if (list) {
      if (!lastTop.length) {
        list.innerHTML = `<div class="ge-top-row empty">No contributors yet — buy the first plot!</div>`;
      } else {
        list.innerHTML = lastTop.map((r) => `
          <div class="ge-top-row${r.uid === (me.uid || "") ? " me" : ""}">
            <span class="ge-rank">${r.rank <= 3 ? ["🥇","🥈","🥉"][r.rank - 1] : "#" + r.rank}</span>
            <span class="ge-avatar">${avatarHtml(r.avatar)}</span>
            <span class="ge-name">${escapeHtml(r.name || "Traveler")}</span>
            <span class="ge-amt">${fmtNum(r.points)} pts</span>
          </div>`).join("");
      }
    }
  }

  function escapeHtml(str) {
    return String(str == null ? "" : str)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function avatarHtml(avatar) {
    const a = String(avatar || "🙂");
    if (a.startsWith("img:")) {
      return `<img class="ge-avatar-img" src="${escapeHtml(a.slice(4))}" alt="" referrerpolicy="no-referrer">`;
    }
    return `<span class="ge-avatar-emoji">${escapeHtml(a)}</span>`;
  }

  /* -------------------------------------------------------------- fetch */
  async function fetchEvent() {
    try {
      if (typeof firebase === "undefined" || !firebase.functions) return null;
      const fn = firebase.functions().httpsCallable("getPlotChallenge");
      const res = await fn({});
      const d = (res && res.data) || {};
      if (!d.ok) return d;
      lastEvent = d.event || null;
      lastMe = d.me || null;
      lastTop = Array.isArray(d.top) ? d.top : [];
      const modal = el("plot-challenge-modal");
      if (modal && !modal.classList.contains("hidden")) renderModal();
      return d;
    } catch (e) {
      console.warn("[PlotChallenge] fetch failed:", e && e.message);
      return null;
    }
  }

  /* ------------------------------------------------------- modal open */
  function openModal() {
    const m = el("plot-challenge-modal");
    if (m) m.classList.remove("hidden");
    renderModal();
    fetchEvent();
    if (modalTimer) clearInterval(modalTimer);
    modalTimer = setInterval(() => {
      const mm = el("plot-challenge-modal");
      if (!mm || mm.classList.contains("hidden")) {
        clearInterval(modalTimer); modalTimer = null; return;
      }
      fetchEvent();
      renderModal();
    }, 8000);
  }
  function closeModal() {
    const m = el("plot-challenge-modal");
    if (m) m.classList.add("hidden");
    if (modalTimer) { clearInterval(modalTimer); modalTimer = null; }
  }

  async function claim() {
    try {
      const fn = firebase.functions().httpsCallable("claimPlotChallengeReward");
      const res = await fn({});
      const d = (res && res.data) || {};
      if (d.ok) {
        const bits = [];
        if (d.rp) bits.push(`⭐ ${d.rp} RP`);
        if (d.eb) bits.push(`🪙 ${d.eb} EB`);
        if (d.ebShare) bits.push(`🪙 ${fmtNum(d.ebShare)} EB`);
        if (d.diamonds) bits.push(`💎 ${d.diamonds}`);
        if (d.plots && d.plots.length) bits.push(`🏗️ ${d.plots.length} plot${d.plots.length > 1 ? "s" : ""}`);
        toast("🎉 Claimed! " + bits.join(" · "));
        fetchEvent();
      } else {
        toast(d.reason === "already_claimed" ? "Already claimed" : "Nothing to claim yet");
      }
    } catch (e) {
      toast("⚠️ Could not claim — try again");
    }
  }

  /* ----------------------------------------------------- events-hub row */
  /**
   * The row shown in the Events hub. Returns HTML, or null when the caller
   * should fall back to its own rendering. Live rounds pin to "Live now";
   * gaps land in "Upcoming" with a countdown, which is exactly the
   * "days until live" surface we want.
   */
  function hubRow() {
    const r = currentRound();
    const ev = lastEvent;
    const goal = Number(ev && ev.goal) || 1000;
    const total = Number(ev && ev.totalPlots) || 0;
    const pct = goal > 0 ? Math.min(100, (total / goal) * 100) : 0;

    if (r.live && ev && !isExpired(ev)) {
      return `
        <button class="events-hub-row is-live" data-hub-action="monthly">
          <span class="events-hub-row-icon">🏗️</span>
          <span class="events-hub-row-body">
            <span class="events-hub-row-title">Plot Rush</span>
            <span class="events-hub-row-sub">${fmtNum(total)} / ${fmtNum(goal)} plots claimed</span>
            <span class="events-hub-row-bar"><i style="width:${pct}%"></i></span>
          </span>
          <span class="events-hub-row-go">›</span>
        </button>`;
    }
    if (r.live && ev && isExpired(ev)) {
      return `
        <button class="events-hub-row" data-hub-action="monthly">
          <span class="events-hub-row-icon">🏗️</span>
          <span class="events-hub-row-body">
            <span class="events-hub-row-title">Plot Rush</span>
            <span class="events-hub-row-sub">Round ended — view results &amp; rewards</span>
          </span>
          <span class="events-hub-row-go">›</span>
        </button>`;
    }
    // Between rounds — count down to the next open.
    return `
      <button class="events-hub-row is-disabled" data-hub-action="monthly">
        <span class="events-hub-row-icon">🏗️</span>
        <span class="events-hub-row-body">
          <span class="events-hub-row-title">Plot Rush</span>
          <span class="events-hub-row-sub">Starts in ${fmtDaysAway(r.start - Date.now())}</span>
        </span>
        <span class="events-hub-row-go-disabled">›</span>
      </button>`;
  }

  /** True when the round is live, so the hub can pin it to the top list. */
  function isLive() {
    const r = currentRound();
    return r.live && !!lastEvent && !isExpired(lastEvent);
  }

  /* ---------------------------------------------------------------- init */
  function bind() {
    el("mc-close-btn")?.addEventListener("click", closeModal);
    el("mc-claim-btn")?.addEventListener("click", claim);
  }

  function startListener() {
    if (unsub) return;
    try {
      const db = (typeof Store !== "undefined" && Store.getDb) ? Store.getDb() : null;
      if (!db) return;
      unsub = db.collection("events").doc("plot_challenge").onSnapshot((snap) => {
        if (!snap.exists) return;
        const d = snap.data() || {};
        const goal = Number(d.goal) || 1000;
        const totalPlots = Number(d.totalPlots) || 0;
        const expired = d.completed === true ||
          (Number(d.deadline) > 0 && Date.now() > Number(d.deadline));
        lastEvent = {
          id: "plot_challenge",
          title: d.title || "Plot Rush",
          subtitle: d.subtitle || "",
          goal,
          totalPlots,
          pct: goal > 0 ? Math.min(100, (totalPlots / goal) * 100) : 0,
          deadline: Number(d.deadline) || 0,
          startedAt: Number(d.startedAt) || 0,
          roundKey: d.roundKey || "",
          completed: expired,
          payoutsProcessed: d.payoutsProcessed === true,
        };
        const modal = el("plot-challenge-modal");
        if (modal && !modal.classList.contains("hidden")) renderModal();
        // Let the hub know a live event's numbers moved.
        try {
          window.dispatchEvent(new CustomEvent("plotChallengeUpdated"));
        } catch (e) {}
      }, (err) => console.warn("[PlotChallenge] snapshot error:", err));
    } catch (e) {
      console.warn("[PlotChallenge] listener failed:", e);
    }
  }

  function init() {
    bind();
    try {
      startListener();
      if (typeof firebase !== "undefined" && firebase.auth) {
        firebase.auth().onAuthStateChanged(() => { startListener(); fetchEvent(); });
      }
    } catch (e) {}
    fetchEvent();
  }

  return {
    init,
    openModal,
    closeModal,
    fetchEvent,
    hubRow,
    isLive,
    getState: () => ({ event: lastEvent, me: lastMe, expired: isExpired(lastEvent) }),
  };
})();
