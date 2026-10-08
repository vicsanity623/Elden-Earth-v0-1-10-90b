// ============================================================
// Elden Earth — Global Event Engine (Global Challenge)
// Server-authoritative community event UI
// ============================================================
const GlobalEvent = (() => {
  let snapshotUnsub = null;
  let countdownTimer = null;
  let lastEvent = null;
  let lastMe = null;
  let lastTop10 = [];
  let processing = false;

  const el = (id) => document.getElementById(id);
  const toast = (msg, ms = 3000) => {
    if (typeof window !== "undefined" && typeof window.showToast === "function") window.showToast(msg, ms);
    else console.log("[GlobalEvent]", msg);
  };

  function fmtEB(n) {
    const v = Number(n) || 0;
    if (v >= 1000000) return (v / 1000000).toFixed(2) + "M";
    if (v >= 10000) return (v / 1000).toFixed(1) + "K";
    if (Number.isInteger(v)) return String(v);
    return v.toFixed(2).replace(/\.00$/, "");
  }

  function fmtCountdown(ms) {
    if (ms <= 0) return "00D : 00H : 00M : 00s";
    const s = Math.floor(ms / 1000);
    const d = Math.floor(s / 86400);
    const h = Math.floor((s % 86400) / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    const p = (x) => String(x).padStart(2, "0");
    return `${p(d)}D : ${p(h)}H : ${p(m)}M : ${p(sec)}s`;
  }

  function isExpired(event) {
    if (!event) return false;
    if (event.completed) return true;
    return Number(event.deadline) > 0 && Date.now() > Number(event.deadline);
  }

  /**
   * The challenge is finished *for this viewer* — nothing left to show or claim.
   * Deliberately conservative: while `lastMe` is still unknown (getGlobalEvent
   * has not returned yet) we keep the button up rather than hide the only way
   * to reach an unclaimed prize.
   */
  function isSettled(ev, me) {
    if (!ev || !isExpired(ev)) return false;
    if (ev.payoutsProcessed !== true) return false;
    if (!me) return false;
    if (Number(me.amount) > 0 && !me.claimed) return false;
    return true;
  }

  // ---------------- Render ----------------

  function renderHud() {
    const ev = lastEvent;
    const chip = el("global-event-hud-chip");
    const bar = el("global-event-hud-bar");
    const btn = el("global-event-hud-btn");
    if (!ev || isSettled(ev, lastMe)) {
      if (btn) btn.classList.add("hidden");
      return;
    }
    if (btn) btn.classList.remove("hidden");

    const expired = isExpired(ev);
    const pct = Math.max(0, Math.min(100, Number(ev.pct) || 0));
    if (bar) bar.style.width = pct + "%";
    const label = el("global-event-hud-label");
    if (label) {
      label.textContent = expired
        ? "EVENT ENDED"
        : `${fmtEB(ev.totalEB)} / ${fmtEB(ev.goal)}`;
    }
    if (chip) {
      chip.textContent = expired ? "END" : `${Math.round(pct)}%`;
    }
  }

  function renderModal() {
    const ev = lastEvent;
    const me = lastMe;
    if (!ev) return;

    const expired = isExpired(ev);
    const pct = Math.max(0, Math.min(100, Number(ev.pct) || 0));

    const title = el("ge-title");
    if (title) title.textContent = ev.title || "Global Challenge";
    const sub = el("ge-sub");
    if (sub) sub.textContent = ev.subtitle || "Spin the Wheel — help the Realm hit the goal!";

    const totalEl = el("ge-total");
    if (totalEl) totalEl.textContent = fmtEB(ev.totalEB);
    const goalEl = el("ge-goal");
    if (goalEl) goalEl.textContent = fmtEB(ev.goal);
    const pctEl = el("ge-pct");
    if (pctEl) pctEl.textContent = pct < 1 && pct > 0 ? pct.toFixed(2) + "%" : pct.toFixed(1) + "%";
    const barEl = el("ge-progress-bar");
    if (barEl) barEl.style.width = pct + "%";

    const statusEl = el("ge-status");
    if (statusEl) {
      if (expired && pct >= 100) statusEl.textContent = "✅ GOAL REACHED — Rewards ready!";
      else if (expired) statusEl.textContent = "Event ended. Claim your share below.";
      else if (pct >= 100) statusEl.textContent = "🎉 Realm goal hit! Event will close at deadline.";
      else statusEl.textContent = "Keep spinning — every EB counts!";
    }

    const cdEl = el("ge-countdown");
    if (cdEl) {
      const remain = Math.max(0, Number(ev.deadline) - Date.now());
      cdEl.textContent = expired ? "ENDED" : fmtCountdown(remain);
    }

    // Pool note: reward pool ÷ participants
    const participantsEl = el("ge-participants");
    const totalPoolEl = el("ge-total-pool");
    const participants = Number(ev.participantCount) || 0;
    const totalPool = Number(ev.totalPrizePool) || 0;
    // Pool is 1:1 with the EB the realm actually raised — never fall back to a
    // hardcoded 20000 or a legit "0 raised yet" pool would display as 20k.
    const basePool = Number(ev.rewardPoolEB) || 0;
    if (participantsEl) participantsEl.textContent = String(participants);
    if (totalPoolEl) totalPoolEl.textContent = fmtEB(totalPool);
    const sharePoolEl = el("ge-share-pool");
    if (sharePoolEl) sharePoolEl.textContent = fmtEB(basePool);
    const poolNote = el("ge-pool-note");
    if (poolNote) {
      poolNote.innerHTML = `Prize pool = ${fmtEB(basePool)} EB ÷ <strong id="ge-participants">${participants}</strong> players = <strong id="ge-total-pool">${fmtEB(totalPool)}</strong> EB, split by contribution share.`;
    }

    const myAmtEl = el("ge-my-amount");
    if (myAmtEl) myAmtEl.textContent = fmtEB(me?.amount || 0);
    const myPrizeEl = el("ge-my-prize");
    if (myPrizeEl) myPrizeEl.textContent = fmtEB(me?.prize || 0);
    const myRankEl = el("ge-my-rank");
    if (myRankEl) {
      myRankEl.textContent = me?.rank ? `#${me.rank}` : (me?.amount > 0 ? "—" : "—");
    }

    const claimBtn = el("ge-claim-btn");
    const adminBtn = el("ge-admin-btn");
    if (claimBtn) {
      if (me?.canClaim) {
        claimBtn.classList.remove("hidden");
        claimBtn.disabled = false;
        claimBtn.textContent = `Claim ${fmtEB(me.prize)} EB`;
      } else {
        // Claimed, or nothing to claim — remove it instead of parking a
        // permanently disabled "✓ Reward Claimed" button at the bottom.
        claimBtn.classList.add("hidden");
      }
    }
    if (adminBtn) {
      const showAdmin = expired && !ev.payoutsProcessed;
      adminBtn.classList.toggle("hidden", !showAdmin);
    }

    // Top 10 / Hall of Fame
    const list = el("ge-top10");
    if (list) {
      list.innerHTML = "";
      const rows = Array.isArray(lastTop10) ? lastTop10 : [];
      if (!rows.length) {
        list.innerHTML = `<div class="ge-top-row empty"><span>No contributions yet — be first!</span></div>`;
      } else {
        rows.forEach((r) => {
          const row = document.createElement("div");
          const isMe = me && (r.uid === (me.uid || "") || r.uid === (Store.get()?.player?.id || ""));
          row.className = "ge-top-row" + (isMe ? " me" : "");
          const medal = r.rank === 1 ? "🥇" : r.rank === 2 ? "🥈" : r.rank === 3 ? "🥉" : `#${r.rank}`;
          row.innerHTML = `
            <span class="ge-rank">${medal}</span>
            <span class="ge-avatar">${renderAvatarHtml(r.avatar)}</span>
            <span class="ge-name">${escapeHtml(displayPlayerName(r))}</span>
            <span class="ge-amt">${fmtEB(r.amount)} EB</span>
          `;
          list.appendChild(row);
        });
      }
    }
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  /** Avatars are emoji OR "img:"+URL OR raw https URL (legacy). */
  function renderAvatarHtml(avatar) {
    const a = String(avatar || "").trim();
    if (!a) return `<span class="ge-avatar-emoji">🙂</span>`;
    let src = "";
    if (a.startsWith("img:")) src = a.slice(4);
    else if (/^https?:\/\//i.test(a)) src = a;
    if (src) {
      return `<img class="ge-avatar-img" src="${escapeHtml(src)}" alt="" loading="lazy" onerror="this.outerHTML='<span class=\\'ge-avatar-emoji\\'>🙂</span>'">`;
    }
    return `<span class="ge-avatar-emoji">${escapeHtml(a)}</span>`;
  }

  function displayPlayerName(row) {
    let name = String(row?.name || "").trim();
    // If name accidentally stored a URL, treat it as missing
    if (/^https?:\/\//i.test(name) || name.startsWith("img:")) name = "";
    if (!name || name === "Traveler") {
      // Prefer a readable label from avatar URL path, else fallback
      const av = String(row?.avatar || "");
      let src = av.startsWith("img:") ? av.slice(4) : av;
      if (/^https?:\/\//i.test(src)) {
        try {
          const u = new URL(src);
          const seg = u.pathname.split("/").filter(Boolean).pop() || "";
          if (seg && !seg.includes("firebase") && seg.length < 40) {
            name = decodeURIComponent(seg).replace(/\.[a-z0-9]+$/i, "");
          }
        } catch (e) {}
      }
    }
    return name || "Traveler";
  }

  function applySnapshot(data) {
    if (!data || !data.ok) return;
    const state = Store.get();
    const myUid = state?.player?.id || "";

    if (data.event) {
      lastEvent = { ...data.event };
    }
    if (data.me) {
      lastMe = {
        ...data.me,
        uid: myUid,
        name: displayPlayerName({ name: data.me.name, avatar: data.me.avatar }),
      };
    }
    if (Array.isArray(data.top10)) {
      lastTop10 = data.top10.map((r) => ({
        ...r,
        name: displayPlayerName(r),
      }));
    }

    renderHud();
    const modal = el("global-event-modal");
    if (modal && !modal.classList.contains("hidden")) {
      renderModal();
      // Everything is done for this viewer (claimed + payouts processed) —
      // there is nothing left in here but a Close button.
      if (isSettled(lastEvent, lastMe)) closeModal();
    }
  }

  // ---------------- Data ----------------

  function authReady() {
    try {
      return !!(typeof firebase !== "undefined" && firebase.auth && firebase.auth().currentUser);
    } catch (e) {
      return false;
    }
  }

  function functionsReady() {
    return typeof ServerAntiCheat !== "undefined" && ServerAntiCheat.isReady && ServerAntiCheat.isReady();
  }

  async function fetchEvent() {
    if (!authReady() || !functionsReady()) return null;
    try {
      const result = await ServerAntiCheat.getGlobalEvent();
      if (result && result.ok) {
        applySnapshot(result);
        console.log("[GlobalEvent] snapshot applied", {
          totalEB: result.event?.totalEB,
          myAmount: result.me?.amount,
          myRank: result.me?.rank,
          participants: result.event?.participantCount,
          top10: result.top10?.length,
        });
      } else if (result && result.reason === "unauthenticated") {
        console.warn("[GlobalEvent] Not signed in yet — will retry.");
      } else {
        console.warn("[GlobalEvent] fetch not ok:", result);
      }
      return result;
    } catch (e) {
      console.warn("[GlobalEvent] fetch failed:", e);
      return null;
    }
  }

  let _started = false;
  let _retryTimer = null;
  let _modalRefreshTimer = null;

  function startWhenReady(attempt = 0) {
    if (_retryTimer) {
      clearTimeout(_retryTimer);
      _retryTimer = null;
    }
    if (!authReady() || !functionsReady()) {
      if (attempt < 40) {
        _retryTimer = setTimeout(() => startWhenReady(attempt + 1), 750);
      }
      return;
    }
    if (_started) {
      fetchEvent();
      return;
    }
    _started = true;
    fetchEvent().then(() => {
      startListener();
      startCountdown();
    });
  }

  function startListener() {
    stopListener();
    const db = Store.getDb();
    const state = Store.get();
    if (!db || !state?.player?.id) return;
    try {
      snapshotUnsub = db.collection("events").doc("global_challenge")
        .onSnapshot((snap) => {
          if (!snap.exists) return;
          const d = snap.data() || {};
          const totalEB = Number(d.totalEB) || 0;
          const goal = Number(d.goal) || 20000;
          const expired = d.completed === true || (Number(d.deadline) > 0 && Date.now() > Number(d.deadline));
          lastEvent = {
            id: d.id || "global_challenge",
            title: d.title || "Global Challenge",
            subtitle: d.subtitle || "",
            goal,
            totalEB,
            pct: goal > 0 ? Math.min(100, (totalEB / goal) * 100) : 0,
            deadline: Number(d.deadline) || 0,
            startedAt: Number(d.startedAt) || 0,
            completed: d.completed === true || expired,
            payoutsProcessed: d.payoutsProcessed === true,
            // Prize pool mirrors what the realm raised — derived here from the
            // same snapshot doc so it stays live without an extra server write.
            rewardPoolEB: totalEB,
            participantCount: Number(d.participantCount) || lastEvent?.participantCount || 0,
            totalPrizePool: Number(d.totalPrizePool) || lastEvent?.totalPrizePool || 0,
          };
          renderHud();
          const modal = el("global-event-modal");
          if (modal && !modal.classList.contains("hidden")) {
            // Live totals from snapshot; pull me/top10 from server too
            renderModal();
            fetchEvent();
          }
        }, (err) => console.warn("[GlobalEvent] snapshot error:", err));
    } catch (e) {
      console.warn("[GlobalEvent] listener failed:", e);
    }
  }

  function stopListener() {
    if (typeof snapshotUnsub === "function") {
      try { snapshotUnsub(); } catch (e) {}
    }
    snapshotUnsub = null;
  }

  function startCountdown() {
    stopCountdown();
    countdownTimer = setInterval(() => {
      if (!lastEvent) return;
      const cdEl = el("ge-countdown");
      if (cdEl && !el("global-event-modal")?.classList.contains("hidden")) {
        const expired = isExpired(lastEvent);
        cdEl.textContent = expired ? "ENDED" : fmtCountdown(Math.max(0, lastEvent.deadline - Date.now()));
      }
    }, 1000);
  }

  function stopCountdown() {
    if (countdownTimer) clearInterval(countdownTimer);
    countdownTimer = null;
  }

  // ---------------- Modal / actions ----------------

  async function openModal() {
    el("global-event-modal")?.classList.remove("hidden");
    if (!authReady() || !functionsReady()) {
      toast("⚠️ Signing in… try again in a moment.");
      startWhenReady();
      return;
    }
    // Force a full server read so contribution / rank / Hall of Fame populate
    const result = await fetchEvent();
    if (result && result.ok) {
      applySnapshot(result);
    }
    renderModal();

    // Keep fresh while open
    if (_modalRefreshTimer) clearInterval(_modalRefreshTimer);
    _modalRefreshTimer = setInterval(() => {
      if (el("global-event-modal")?.classList.contains("hidden")) {
        clearInterval(_modalRefreshTimer);
        _modalRefreshTimer = null;
        return;
      }
      fetchEvent();
    }, 8000);
  }

  function closeModal() {
    el("global-event-modal")?.classList.add("hidden");
    if (_modalRefreshTimer) {
      clearInterval(_modalRefreshTimer);
      _modalRefreshTimer = null;
    }
  }

  async function claimReward() {
    if (processing) return;
    if (!authReady() || !functionsReady()) {
      toast("⚠️ Server connection required.");
      return;
    }
    processing = true;
    const btn = el("ge-claim-btn");
    if (btn) { btn.disabled = true; btn.textContent = "Claiming…"; }
    try {
      const result = await ServerAntiCheat.claimGlobalEventReward();
      if (!result?.ok) {
        const msgs = {
          event_not_complete: "⏳ Event is not complete yet.",
          already_claimed: "✓ You already claimed this reward.",
          no_contribution: "⚠️ You have no recorded contributions.",
          prize_too_small: "⚠️ Prize too small to claim.",
          rate_limited: "⏳ Slow down — try again shortly.",
        };
        toast(msgs[result?.reason] || `⚠️ Claim failed: ${result?.reason || "unknown"}`, 3500);
        await fetchEvent();
        renderModal();
        return;
      }
      const state = Store.get();
      if (Number.isFinite(Number(result.nextEb))) state.eb = Number(result.nextEb);
      Store.save(true);
      if (typeof updateTopbar === "function") updateTopbar();
      toast(`🎉 Claimed ${fmtEB(result.prize)} EB from the Global Challenge!`, 4000);
      await fetchEvent();
      renderModal();
    } catch (e) {
      console.warn("[GlobalEvent] claim error:", e);
      toast("⚠️ Claim failed — try again.", 3000);
    } finally {
      processing = false;
    }
  }

  async function adminProcess() {
    if (processing) return;
    processing = true;
    const btn = el("ge-admin-btn");
    if (btn) { btn.disabled = true; btn.textContent = "Processing…"; }
    try {
      const result = await ServerAntiCheat.processEventPayouts();
      if (!result?.ok) {
        toast(result?.reason === "not_admin"
          ? "🔒 Admin only."
          : `⚠️ ${result?.reason || "Process failed"}`, 3500);
      } else {
        toast(`✅ Distributed plots to Top ${result.winners || 10}!`, 4500);
      }
      await fetchEvent();
      renderModal();
    } catch (e) {
      toast("⚠️ Process failed.", 3000);
    } finally {
      processing = false;
      if (btn) { btn.disabled = false; btn.textContent = "Process Top 10 Plots"; }
    }
  }

  /** Called from main.js after a successful wheel spin. */
  function notifySpinContributed(amount) {
    if (!amount || amount <= 0) return;
    toast(`🌍 +${fmtEB(amount)} EB → Global Challenge!`, 2200);
    fetchEvent();
  }

  function bind() {
    el("global-event-hud-btn")?.addEventListener("click", () => openModal());
    el("ge-close-btn")?.addEventListener("click", () => closeModal());
    el("ge-claim-btn")?.addEventListener("click", () => claimReward());
    el("ge-admin-btn")?.addEventListener("click", () => adminProcess());
  }

  function init() {
    bind();
    startWhenReady(0);
    try {
      if (typeof firebase !== "undefined" && firebase.auth) {
        firebase.auth().onAuthStateChanged(() => {
          startWhenReady(0);
        });
      }
    } catch (e) {}
  }

  return {
    init,
    startWhenReady,
    openModal,
    notifySpinContributed,
    refresh: fetchEvent,
  };
})();
