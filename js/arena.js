/* ==========================================================================
   Elden Earth — PvP Arena (client)
   Lobby, matchmaking and the weekly leaderboard. The fight itself reuses the
   wild-buddy battle screen in "pvp" mode (see js/buddy-battle.js), which is
   the same turn-based engine with the tame/feast ending swapped for a
   victory/defeat screen.

   Everything is self-mounting: the lobby markup + CSS are injected from here
   so game.html only needs the one button in the MORE sheet.
   ========================================================================== */
const Arena = (() => {
  "use strict";

  const el = (id) => document.getElementById(id);
  const MODAL_ID = "arena-lobby-modal";
  const STYLE_ID = "arena-style";

  let lastState = null;
  // Wall-clock time at which `lastState` arrived. The regen countdown is
  // derived from this locally so it ticks once a second without a round trip
  // per tick.
  let lastStateAt = 0;
  // (The old regen-completion re-fetch guards lived here — tickLive now lands
  // free entries locally, so there is no per-tick network refresh left to
  // guard. See tickLive.)
  let countdownTimer = null;

  /* ---------------------------------------------------------- formatting */
  const fmtNum = (n) => (Number(n) || 0).toLocaleString();
  function fmtCountdown(ms) {
    if (ms <= 0) return "ENDED";
    const s = Math.floor(ms / 1000);
    const d = Math.floor(s / 86400);
    const h = Math.floor((s % 86400) / 3600);
    const m = Math.floor((s % 3600) / 60);
    return `${d}D : ${String(h).padStart(2, "0")}H : ${String(m).padStart(2, "0")}M`;
  }
  function escapeHtml(str) {
    return String(str == null ? "" : str)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function avatarHtml(avatar) {
    const a = String(avatar || "🙂");
    if (a.startsWith("img:")) {
      return `<img class="ar-avatar-img" src="${escapeHtml(a.slice(4))}" alt="" referrerpolicy="no-referrer">`;
    }
    return `<span class="ar-avatar-emoji">${escapeHtml(a)}</span>`;
  }

  /* ---------------------------------------------------------------- CSS */
  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const css = `
#arena-lobby-modal .modal-card{
  background:linear-gradient(170deg,#2b1220 0%,#161c30 46%,#12172a 100%);
}
.ar-banner{
  margin:-18px -16px 0; padding:20px 16px 26px;
  background:linear-gradient(150deg,#c1121f,#8b0e17 62%,#6d0a12);
  text-align:center; position:relative; overflow:hidden;
}
.ar-banner h2{
  margin:0; font-size:31px; font-weight:900; letter-spacing:.5px; color:#fff;
  text-shadow:0 3px 12px rgba(0,0,0,.4);
}
.ar-banner .ar-sub{ margin:3px 0 0; font-size:15px; color:#ffd7db; font-weight:700; }
.ar-banner .ar-tag{
  margin:9px auto 0; max-width:330px; font-size:11.5px; color:#ffe4e7;
  line-height:1.5; letter-spacing:.2px;
}
.ar-ribbon{
  margin:14px 0 4px; text-align:center;
}
.ar-ribbon .ar-ribbon-title{
  display:inline-flex; align-items:center; gap:8px;
  font-family:"Cinzel","Times New Roman",serif; font-size:22px; font-weight:900;
  color:#fff; letter-spacing:.6px;
}
.ar-ribbon .ar-ribbon-title .t { font-size:24px; }
.ar-dots{
  height:4px; margin:8px 0 12px;
  background:repeating-linear-gradient(90deg,#c1121f 0 6px,transparent 6px 12px);
  border-radius:99px;
}
.ar-row{
  display:flex; align-items:center; gap:10px;
  padding:10px 11px; border-radius:12px; margin-bottom:8px;
  background:rgba(255,255,255,.055); border:1px solid rgba(255,255,255,.09);
}
.ar-medal{
  flex:0 0 auto; width:28px; height:28px; border-radius:50%;
  display:flex; align-items:center; justify-content:center;
  font-size:13px; font-weight:900; color:#3b2a10;
}
.ar-medal.m1{ background:linear-gradient(150deg,#fde047,#eab308); }
.ar-medal.m2{ background:linear-gradient(150deg,#e5e7eb,#9ca3af); }
.ar-medal.m3{ background:linear-gradient(150deg,#fdba74,#c2410c); }
.ar-ranknum{
  flex:0 0 auto; width:28px; height:28px; border-radius:50%;
  display:flex; align-items:center; justify-content:center;
  font-size:11px; font-weight:900; color:#cbd5e1;
  background:rgba(255,255,255,.1);
}
.ar-avatar-img{ width:34px; height:34px; border-radius:50%; object-fit:cover; border:2px solid rgba(255,255,255,.35); }
.ar-avatar-emoji{
  width:34px; height:34px; border-radius:50%; font-size:18px;
  display:flex; align-items:center; justify-content:center;
  background:rgba(255,255,255,.12); border:2px solid rgba(255,255,255,.25);
}
.ar-name{ flex:1 1 auto; min-width:0; }
.ar-name b{ display:block; font-size:12.5px; color:#fff; letter-spacing:.3px; }
.ar-name span{
  display:block; font-size:9.5px; color:#a9bede; margin-top:2px;
  white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
}
.ar-wins{
  flex:0 0 auto; padding:7px 13px; border-radius:8px 3px 3px 8px;
  background:linear-gradient(135deg,#c1121f,#8b0e17);
  color:#fff; font-size:13px; font-weight:900; letter-spacing:.3px;
}
.ar-stats{
  margin:14px 0 6px; padding:13px 12px; border-radius:14px; text-align:center;
  background:rgba(255,255,255,.05); border:1px solid rgba(255,255,255,.1);
}
.ar-stats-line{
  display:flex; align-items:center; justify-content:center; gap:10px; margin-bottom:8px;
}
.ar-pill{
  padding:8px 15px; border-radius:9px 3px 3px 9px;
  background:linear-gradient(135deg,#c1121f,#8b0e17);
  color:#fff; font-size:14px; font-weight:900; letter-spacing:.3px;
}
.ar-pill.alt{ border-radius:3px 9px 9px 3px; }
.ar-diamond{
  width:14px; height:14px; background:#c1121f; transform:rotate(45deg);
  border-radius:3px;
}
.ar-season-line{
  margin:12px 0 4px; text-align:center; font-size:12px; color:#cdd8ea;
  letter-spacing:.2px;
}
.ar-season-line b{ color:#fff; font-variant-numeric:tabular-nums; }
.ar-energy{
  margin:10px auto 0; padding:10px 12px; border-radius:12px;
  background:rgba(255,255,255,.05); border:1px solid rgba(255,255,255,.1);
}
.ar-energy-head{
  display:flex; justify-content:space-between; align-items:center; margin-bottom:7px;
}
.ar-energy-title{
  color:#93a4c0; font-size:10.5px; text-transform:uppercase;
  letter-spacing:.8px; font-weight:900;
}
.ar-energy-num{
  color:#fff; font-size:15px; font-weight:900;
  font-variant-numeric:tabular-nums; line-height:1.2;
}
.ar-energy-bar{
  height:12px; border-radius:8px; overflow:hidden;
  background:rgba(255,255,255,.1);
}
.ar-energy-bar i{
  display:block; height:100%; border-radius:8px;
  background:linear-gradient(90deg,#fbbf24,#f59e0b);
  transition:width .3s ease;
}
.ar-regen-line{
  margin:8px 0 0; text-align:center; font-size:12px; color:#fcd34d;
  letter-spacing:.2px;
}
.ar-regen-line b{ color:#fff; font-variant-numeric:tabular-nums; }
.ar-regen-line.full{ color:#86efac; }
.ar-actions{ display:flex; gap:10px; margin-top:14px; }
.ar-actions .btn{ flex:1 1 0; padding:15px 10px; font-size:15px; }
.ar-battle-btn{
  background:linear-gradient(135deg,#c1121f,#8b0e17) !important; color:#fff !important;
  border:none !important; box-shadow:0 12px 30px rgba(193,18,31,.4);
}
.ar-battle-btn small{ display:block; font-size:10px; font-weight:700; opacity:.85; margin-top:2px; }
.ar-battle-btn:disabled{ opacity:.5; box-shadow:none; }
.ar-ad-row{ margin-top:10px; }
.ar-ad-btn{
  width:100%; padding:11px 10px !important; font-size:13px !important; font-weight:800;
  background:rgba(255,255,255,.08) !important; color:#fcd34d !important;
  border:1px solid rgba(252,211,77,.45) !important;
}
.ar-ad-btn:disabled{ opacity:.55; }
.ar-ad-btn b{ font-variant-numeric:tabular-nums; }
.ar-note{
  margin:10px 2px 0; font-size:10.5px; color:#8fa6c4; line-height:1.55; text-align:center;
}
.ar-empty{ padding:22px 12px; text-align:center; color:#8aa0bd; font-size:12px; line-height:1.7; }

/* ---- 🏁 full leaderboard + end-of-week results (2026-11-03 polish) ---- */
.ar-ranks-scroll{ max-height:340px; overflow-y:auto; overscroll-behavior:contain; }
.ar-medal.mx{ background:rgba(255,255,255,.10); color:#cfe0ff; }
.ar-row-stats{ flex:0 0 auto; text-align:right; }
.ar-score{ font-size:12.5px; font-weight:900; color:#fde68a; }
.ar-wl{ font-size:10px; color:#a9bede; margin-top:2px; white-space:nowrap; }
.ar-claim-banner{
  margin:8px 0 2px; padding:9px 12px; border-radius:11px; cursor:pointer;
  background:rgba(253,224,71,.12); border:1px solid rgba(253,224,71,.45);
  color:#fde68a; font-size:11.5px; text-align:center;
}
.ar-result-box{
  margin:0 0 14px; padding:13px; border-radius:13px; text-align:center;
  background:linear-gradient(150deg, rgba(253,224,71,.14), rgba(239,68,68,.12));
  border:1px solid rgba(253,224,71,.4);
}
.ar-result-title{ font-size:13px; font-weight:900; color:#fff; }
.ar-result-pos{ font-size:17px; font-weight:900; color:#fde68a; margin:7px 0 2px; }
.ar-result-line{ font-size:11px; color:#a9bede; }
.ar-result-rewards{ font-size:11.5px; color:#fff; margin:8px 0 10px; line-height:1.7; }
.ar-result-claimed{ font-size:12px; color:#4ade80; font-weight:800; }

/* ---- ⓘ Rewards tooltip ---- */
.ar-info-btn{
  position:absolute; left:12px; top:12px;
  display:flex; flex-direction:column; align-items:center; gap:2px;
  padding:0; border:none; background:transparent; cursor:pointer;
  color:#fff; font-family:inherit;
}
.ar-info-btn:active{ transform:scale(.94); }
.ar-info-icon{
  width:26px; height:26px; border-radius:50%;
  border:2px solid rgba(255,255,255,.9);
  display:flex; align-items:center; justify-content:center;
  font-size:15px; font-weight:900; font-family:Georgia,serif;
}
.ar-info-label{
  font-size:11px; font-weight:800; letter-spacing:.3px;
  text-shadow:0 1px 4px rgba(0,0,0,.5);
}
.ar-rewards-card{
  width:100%; max-width:400px; max-height:88vh; overflow-y:auto;
  padding:20px 18px calc(20px + env(safe-area-inset-bottom,0px));
  border-radius:18px; position:relative;
  background:linear-gradient(165deg,rgba(30,38,66,.99),rgba(18,22,40,.99));
  border:1px solid rgba(150,180,240,.26);
  box-shadow:0 24px 70px rgba(0,0,0,.6);
  animation:bbPop .3s cubic-bezier(.22,1,.36,1);
}
.ar-rewards-head{ text-align:center; margin-bottom:14px; padding-right:14px; }
.ar-rewards-icon{ font-size:38px; line-height:1; margin-bottom:6px; }
.ar-rewards-head h3{ margin:0 0 6px; font-size:20px; font-weight:900; color:#fff; }
.ar-rewards-head p{ margin:0; font-size:11.5px; color:#a9bede; line-height:1.6; }
.ar-rewards-list{ display:flex; flex-direction:column; gap:8px; }
.ar-rewards-row{
  display:flex; align-items:center; gap:11px; padding:11px 12px;
  border-radius:13px; background:rgba(255,255,255,.055);
  border:1px solid rgba(255,255,255,.1);
}
.ar-rewards-body{ flex:1 1 auto; min-width:0; }
.ar-rewards-place{ font-size:13px; font-weight:900; color:#fff; letter-spacing:.2px; }
.ar-rewards-items{ font-size:10.5px; color:#a9bede; margin-top:3px; line-height:1.55; }
.ar-rewards-note{
  margin:12px 2px 14px; font-size:10.5px; color:#8fa6c4; line-height:1.6; text-align:center;
}
`;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = css;
    document.head.appendChild(style);
  }

  /* ------------------------------------------------------------- server */
  async function call(name, payload) {
    try {
      if (typeof firebase === "undefined" || !firebase.functions) return null;
      const fn = firebase.functions().httpsCallable(name);
      const res = await fn(payload || {});
      return (res && res.data) || null;
    } catch (e) {
      console.warn("[Arena]", name, "failed:", e && e.message);
      return null;
    }
  }

  /**
   * Fold a server-sent entry view into the cached lobby state and re-render.
   *
   * Every function that returns entry numbers goes through here, so the three
   * call sites (getState, findMatch, resolveBattle) can never drift into
   * showing different values for the same player.
   */
  function applyEntry(entry) {
    lastState = lastState || {};
    lastState.me = Object.assign({}, lastState.me, entry);
    lastStateAt = Date.now();   // countdown restarts from this response
    renderLobby();
  }

  async function fetchState() {
    const d = await call("arenaGetState", {});
    if (d && d.ok) {
      lastState = d;
      // Stamp receipt so the regen countdown can tick locally between
      // fetches. The server sends a snapshot, not a live timer, so without
      // this the countdown would sit frozen until the next round trip.
      lastStateAt = Date.now();
      renderLobby();
      // Arm the 30-minute refresh cycle + the week-end final-standings refresh.
      scheduleGlobalRefresh();
      // 🏁 End-of-week results land as a staged payout — surface them the
      // moment they exist (once per lobby session; the banner + the Rewards
      // button cover re-opening).
      maybeAutoOpenResults(d);
    }
    return d;
  }

  // mmss/format helper shared by renderLobby and the 1s live tick.
  function mmss(ms) {
    const s = Math.ceil(ms / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  }

  /**
   * 🏁 SECOND-TICK WITHOUT RE-RENDERING (2026-11-03 polish). The lobby used
   * to be rebuilt every second just to move the countdowns — which threw the
   * player's scroll back to the top of the 500-row ranks list. Only the
   * countdown SPANS move here; the lobby itself is rebuilt solely by
   * fetchState and the player's own actions.
   */
  function tickLive() {
    const m = el(MODAL_ID);
    if (!m || m.classList.contains("hidden")) {
      if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }
      return;
    }
    const d = lastState || {};
    const me = d.me || {};
    const rules = d.rules || {};
    const season = d.season || {};
    const remain = Math.max(0, (Number(season.end) || Date.now()) - Date.now());

    const cd = el("ar-countdown");
    if (cd) cd.textContent = fmtCountdown(remain);

    // Live ⚡ regen countdown (server snapshot + local drift).
    const sentNextIn = (me.nextRegenMs === null || me.nextRegenMs === undefined)
      ? null : Number(me.nextRegenMs);
    const ageMs = lastStateAt ? Math.max(0, Date.now() - lastStateAt) : 0;
    const nextIn = sentNextIn === null ? null : Math.max(0, sentNextIn - ageMs);
    const energy = Number(me.energy) || 0;
    const energyMax = Number(me.energyMax) || Number(rules.energyMax) || 100;

    if (nextIn !== null && nextIn > 0 && energy < energyMax) {
      const t = mmss(nextIn);
      const regenEl = el("ar-regen");
      if (regenEl) regenEl.textContent = t;
      const btnTimerEl = el("ar-btn-timer");
      if (btnTimerEl) btnTimerEl.textContent = t;
    } else if (nextIn !== null && nextIn <= 0 && energy < energyMax) {
      // The regen countdown reached zero: a real +1 ⚡ has landed. Adopt it
      // LOCALLY (the server granted it at that moment — this is just the view)
      // and re-render once so the Battle button unlocks. No network refresh:
      // the lobby follows the 30-minute cadence below.
      me.energy = Math.min(energyMax, energy + 1);
      me.nextRegenMs = me.energy >= energyMax ? null : (Number(rules.regenMs) || 120000);
      lastStateAt = Date.now();
      renderLobby();
      return;
    }

    // 🎬 Rewarded-ad refill cooldown ("NEXT AD in mm:ss").
    const sentAdIn = (me.adRefillInMs === null || me.adRefillInMs === undefined)
      ? 0 : Number(me.adRefillInMs);
    const adIn = Math.max(0, sentAdIn - ageMs);
    const adTimerEl = el("ar-ad-timer");
    if (adTimerEl) adTimerEl.textContent = mmss(adIn);
    if (sentAdIn > 0 && adIn <= 0) {
      me.adRefillInMs = 0;
      renderLobby(); // re-enable the Watch Ad button
    }
  }

  // 🏁 REFRESH CADENCE: global refreshes happen on open, every 30 minutes,
  // once 30s before the week ends (to land the final ranking positions before
  // the snapshot freezes the board), and right after the player's own actions.
  // Nothing else touches the network — and nothing rebuilds the lobby.
  const GLOBAL_REFRESH_MS = 30 * 60 * 1000;
  let globalTimer = null;
  let weekEndTimer = null;

  function scheduleGlobalRefresh() {
    if (globalTimer) clearTimeout(globalTimer);
    if (weekEndTimer) clearTimeout(weekEndTimer);
    globalTimer = setTimeout(async () => {
      await fetchState();
      scheduleGlobalRefresh();
    }, GLOBAL_REFRESH_MS);
    // Final-standings refresh 30s before the week ends.
    const end = Number((lastState && lastState.season && lastState.season.end) || 0);
    if (end > Date.now()) {
      weekEndTimer = setTimeout(() => { fetchState(); }, Math.max(2000, end - Date.now() - 30000));
    }
  }

  // 🏁 One auto-open per lobby session: a returning player is greeted with
  // their results exactly once, not on every refetch.
  let resultsShown = false;

  function maybeAutoOpenResults(d) {
    try {
      const p = d && d.payout;
      if (!p || p.claimed || resultsShown) return;
      resultsShown = true;
      openRewards();
    } catch (e) {}
  }

  /**
   * 🏁 CLAIM LAST WEEK'S REWARDS. Server-verified and PAID ONLY ONCE
   * (arenaClaimReward burns the payout doc inside a transaction). On success
   * the lobby refreshes into the new week and the player is nudged to join by
   * setting a Defense Buddy.
   */
  async function claimPayout() {
    const p = (lastState && lastState.payout) || null;
    if (!p || p.claimed) return;
    const btn = el("ar-claim-btn");
    if (btn) { btn.disabled = true; btn.textContent = "Claiming…"; }
    const d = await call("arenaClaimReward", { weekKey: p.weekKey });
    if (!d || !d.ok) {
      if (btn) { btn.disabled = false; btn.textContent = "🎁 Claim Rewards"; }
      const why = {
        no_payout: "No payout found for that week",
        already_claimed: "These rewards were already claimed",
      }[d && d.reason] || "Claim failed — try again";
      (window.showToast || alert)("⚠️ " + why);
      return;
    }
    const bits = [];
    if (d.diamonds) bits.push(`+${d.diamonds} 💎`);
    if (d.rp) bits.push(`+${d.rp} RP`);
    if (d.seeds) bits.push(`+${d.seeds} seeds`);
    if (d.plots && d.plots.length) bits.push(`${d.plots.length}× plot`);
    (window.showToast || alert)(`🏁 Rewards claimed — ${bits.join(" · ") || "delivered"}!`, 5000);
    closeRewards();
    // 🏁 Refresh into the new week: standings + entries re-read from the
    // server so the player can immediately join the fresh season.
    await fetchState();
    const me2 = (lastState && lastState.me) || {};
    if (!me2.defenderSet) {
      (window.showToast || alert)("🛡️ New week is live — set a Defense Buddy in the Buddy Bag to join!", 5000);
    }
  }

  /* -------------------------------------------------------- lobby render */
  function renderLobby() {
    const box = el("ar-lobby-body");
    if (!box) return;
    // 🏁 Preserve the player's scroll in the 500-row ranks list across
    // re-renders. (Before this, the 1-second ticker rebuilt the whole lobby
    // and threw the scroll back to the top — you could never read past #5.)
    const prevScroll = box.querySelector(".ar-ranks-scroll");
    const keepScroll = prevScroll ? prevScroll.scrollTop : 0;
    const d = lastState || {};
    const season = d.season || {};
    const me = d.me || {};
    const rules = d.rules || {};
    const top = Array.isArray(d.top) ? d.top : [];
    const payout = d.payout || null; // 🏁 end-of-week results (claimable when staged)

    const remain = Math.max(0, (Number(season.end) || Date.now()) - Date.now());
    const energy = Number(me.energy) || 0;
    const energyMax = Number(me.energyMax) || Number(rules.energyMax) || 100;
    const battleCost = Number(me.battleCost) || Number(rules.battleCost) || 2;
    const adRefill = Number(me.adRefillEnergy) || Number(rules.adRefillEnergy) || 20;
    const ap = Number(me.ap) || 0;
    const usedToday = Number(me.battlesToday) || 0;

    // Live ⚡ regen countdown. The server reports nextRegenMs as a snapshot;
    // subtract the time elapsed since that snapshot arrived so the number
    // ticks down every second without re-fetching.
    const sentNextIn = (me.nextRegenMs === null || me.nextRegenMs === undefined)
      ? null : Number(me.nextRegenMs);
    const ageMs = lastStateAt ? Math.max(0, Date.now() - lastStateAt) : 0;
    let nextIn = sentNextIn === null ? null : Math.max(0, sentNextIn - ageMs);
    // 🎬 Rewarded-ad refill cooldown — same snapshot-drift trick.
    const sentAdIn = (me.adRefillInMs === null || me.adRefillInMs === undefined)
      ? 0 : Number(me.adRefillInMs);
    let adIn = Math.max(0, sentAdIn - ageMs);

    // (The old code re-fetched the whole state the moment the locally-ticked
    // regen countdown reached zero — a network refresh + full re-render every
    // 2 minutes that also threw the ranks scroll around. tickLive() now lands
    // that +1 ⚡ LOCALLY; real refreshes follow the 30-minute cadence.)

    // (mmss lives at module scope now — shared with the 1s live tick.)

    // Footer button state. ⚡ Energy is the ONLY gate now — battle when the
    // pool can afford it, otherwise show the countdown (and the ad refill)
    // instead of a dead end. No daily limit exists anymore.
    let btnLabel, btnSub = "", btnDisabled = false, btnTimer = "";
    if (energy >= battleCost) {
      btnLabel = `⚔️ Battle (Costs ${battleCost} ⚡)`;
      btnSub = usedToday > 0
        ? `${usedToday} battle${usedToday === 1 ? "" : "s"} today`
        : "Climb the ranks!";
    } else if (nextIn !== null && nextIn > 0) {
      // Waiting, not out. The countdown lives in its own span so the 1s tick
      // can update it WITHOUT re-rendering.
      btnLabel = `⚡ Need ${battleCost} Energy`;
      btnTimer = mmss(nextIn);
      btnSub = `Next +1 ⚡ — or watch an ad for +${adRefill} ⚡`;
      btnDisabled = true;
    } else {
      btnLabel = `⚡ Need ${battleCost} Energy`;
      btnSub = "Energy is regenerating";
      btnDisabled = true;
    }

    // 🏁 FULL LEADERBOARD (2026-11-03 polish): every ranked player (up to 500),
    // with season points + W-L + win ratio — not just the top 3 and wins.
    const fmtRatio = (w, l) => {
      const tot = (Number(w) || 0) + (Number(l) || 0);
      return tot > 0 ? Math.round(((Number(w) || 0) / tot) * 100) + "%" : "—";
    };
    const rows = top.map((r, i) => {
      const rank = i + 1;
      const w = Number(r.wins) || 0;
      const l = Number(r.losses) || 0;
      return `
      <div class="ar-row">
        <div class="ar-medal ${rank <= 3 ? "m" + rank : "mx"}">${rank}</div>
        ${avatarHtml(r.avatar)}
        <div class="ar-name">
          <b>${escapeHtml(r.name)}</b>
          <span>${escapeHtml(r.title || "Citizen of the Realm")}</span>
        </div>
        <div class="ar-row-stats">
          <div class="ar-score">${fmtNum(r.score)} pts</div>
          <div class="ar-wl">${w}W-${l}L · ${fmtRatio(w, l)}</div>
        </div>
      </div>`;
    }).join("");

    box.innerHTML = `
      <div class="ar-banner">
        <button class="ar-info-btn" id="ar-info-btn" aria-label="Season rewards">
          <span class="ar-info-icon">i</span>
          <span class="ar-info-label">Rewards</span>
        </button>
        <h2>PvP Arena</h2>
        <div class="ar-sub">Mon–Sun</div>
        <div class="ar-tag">Battle other players. Climb Ranks. Win Rewards!</div>
      </div>

      <div class="ar-ribbon">
        <div class="ar-ribbon-title"><span class="t">🏆</span> Ranks <span style="font-size:10px;opacity:.7">· top 500</span></div>
      </div>
      <div class="ar-dots"></div>
      ${rows ? `<div class="ar-ranks-scroll">${rows}</div>` : '<div class="ar-empty">No ranked players yet this week.<br>Set a Defense Buddy and be the first!</div>'}

      <div class="ar-ribbon">
        <div class="ar-ribbon-title">Your Weekly Stats</div>
      </div>
      <div class="ar-stats">
        <div class="ar-stats-line">
          <div class="ar-pill">${fmtNum(me.wins)} Wins</div>
          <div class="ar-diamond"></div>
          <div class="ar-pill alt">${fmtNum(me.losses)} Losses</div>
        </div>
        <div class="ar-pill alt" style="display:inline-block">Rank : ${me.rank ? me.rank : "—"}</div>
        <div class="ar-pill" style="display:inline-block">⭐ ${fmtNum(me.score)} pts</div>
        <div class="ar-pill alt" style="display:inline-block">W/L ${fmtRatio(me.wins, me.losses)}</div>

        <div class="ar-energy">
          <div class="ar-energy-head">
            <span class="ar-energy-title">⚡ Energy</span>
            <span class="ar-energy-num">${energy} / ${energyMax}</span>
          </div>
          <div class="ar-energy-bar"><i style="width:${Math.max(0, Math.min(100, Math.round((energy / energyMax) * 100)))}%"></i></div>
          ${nextIn !== null && nextIn > 0 && energy < energyMax ? `
          <div class="ar-regen-line">
            ⏱ Next +1 ⚡ in <b id="ar-regen">${mmss(nextIn)}</b>
          </div>` : `
          <div class="ar-regen-line full">⚡ Energy Full</div>`}
        </div>
      </div>

      ${payout && !payout.claimed ? `
        <div class="ar-claim-banner" id="ar-claim-banner">
          🏁 Last week's results are ready — <b>View &amp; Claim your rewards</b>
        </div>` : ""}

      <div class="ar-season-line">
        Week of ${escapeHtml(season.label || "")} —
        <b>ENDS in <span id="ar-countdown">${fmtCountdown(remain)}</span></b>
      </div>

      ${me.defenderSet ? "" : `
        <div class="ar-note" style="color:#fca5a5">
          ⚠ You have no Defense Buddy set. Open the Buddy Bag, tap a buddy and
          choose “Set as Defense Buddy” before you can battle.
        </div>`}

      <div class="ar-ad-row">
        ${adIn > 0 ? `
        <button class="btn ar-ad-btn" id="ar-ad-btn" disabled>
          🎬 Next ad in <b id="ar-ad-timer">${mmss(adIn)}</b>
        </button>` : `
        <button class="btn ar-ad-btn" id="ar-ad-btn">
          🎬 Watch Ad (+${adRefill} ⚡ Energy)
        </button>`}
      </div>

      <div class="ar-actions">
        <button class="btn" id="ar-cancel-btn">Cancel</button>
        <button class="btn ar-battle-btn" id="ar-battle-btn" ${btnDisabled ? "disabled" : ""}>
          ${escapeHtml(btnLabel)}${btnTimer ? ` <span id="ar-btn-timer">${btnTimer}</span>` : ""}<small>${escapeHtml(btnSub)}</small>
        </button>
      </div>

      <div class="ar-note">
        Lifetime record: ${fmtNum(me.lifetimeWins)} wins · ${fmtNum(me.lifetimeLosses)} losses
        &nbsp;·&nbsp; You have <b style="color:#fff">${fmtNum(ap)} AP</b>
      </div>
    `;

    // Restore the ranks-list scroll (see the note at the top of renderLobby).
    const sc = box.querySelector(".ar-ranks-scroll");
    if (sc && keepScroll) sc.scrollTop = keepScroll;

    const info = el("ar-info-btn");
    if (info) info.addEventListener("click", openRewards);
    const banner = el("ar-claim-banner");
    if (banner) banner.addEventListener("click", openRewards);

    const cancel = el("ar-cancel-btn");
    if (cancel) cancel.addEventListener("click", closeLobby);
    const battle = el("ar-battle-btn");
    if (battle) battle.addEventListener("click", () => { if (!battle.disabled) startBattle(); });
    const adBtn = el("ar-ad-btn");
    if (adBtn) adBtn.addEventListener("click", () => { if (!adBtn.disabled) watchAdRefill(); });
  }

  /* --------------------------------------------------------------- open */
  function openLobby() {
    injectStyle();
    let modal = el(MODAL_ID);
    if (!modal) {
      modal = document.createElement("div");
      modal.id = MODAL_ID;
      modal.className = "modal hidden bd-modal";
      modal.innerHTML = `
        <div class="bd-card">
          <button class="bd-close">✕</button>
          <div id="ar-lobby-body"></div>
          <div class="ee-ad-slot" aria-label="Advertisement"></div>
        </div>`;
      modal.addEventListener("click", (e) => { if (e.target === modal) closeLobby(); });
      document.body.appendChild(modal);
      modal.querySelector(".bd-close").addEventListener("click", closeLobby);
    }
    modal.classList.remove("hidden");
    renderLobby();
    fetchState();

    if (countdownTimer) clearInterval(countdownTimer);
    countdownTimer = setInterval(() => {
      const m = el(MODAL_ID);
      if (!m || m.classList.contains("hidden")) {
        clearInterval(countdownTimer); countdownTimer = null; return;
      }
      // 🏁 Targeted ticks only — the 500-row ranks list is NEVER rebuilt on
      // the second-tick (that is what reset the player's scroll to the top).
      tickLive();
    }, 1000);
  }

  /* ------------------------------------------------- rewards tooltip */
  // Season-end payout breakdown. Mirrors ARENA_REWARDS in functions/arena.js —
  // the two must stay in sync or players are shown one thing and paid another.
  function rewardsRows() {
    return [
      { medal: "m1", place: "Rank 1",
        items: ["1\u00D7 Lucky Legendary Plot", "10 RP", "5\u00D7 Elden Stop Seeds", "500 \uD83D\uDD25"] },
      { medal: "m2", place: "Rank 2",
        items: ["1\u00D7 Lucky Epic Plot", "8 RP", "3\u00D7 Elden Stop Seeds", "250 \uD83D\uDD25"] },
      { medal: "m3", place: "Rank 3",
        items: ["1\u00D7 Lucky Rare Plot", "5 RP", "1\u00D7 Elden Stop Seed", "75 \uD83D\uDD25"] },
      { medal: "", place: "Ranks 4+",
        items: ["Scaling diamonds by rank tier", "Min 20 \uD83D\uDD25 \u00B7 Max 70 \uD83D\uDD25"] },
    ];
  }

  function openRewards() {
    let overlay = el("ar-rewards-modal");
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.id = "ar-rewards-modal";
      overlay.className = "modal hidden";
      overlay.addEventListener("click", (e) => { if (e.target === overlay) closeRewards(); });
      document.body.appendChild(overlay);
    }

    // 🏁 END-OF-WEEK RESULTS: position, rewards and the server-verified
    // one-time claim. Rebuilt on every open so the claim state is never stale.
    const p = (lastState && lastState.payout) || null;
    const rewardBits = p ? [
      p.rp ? `${p.rp} RP` : "",
      p.diamonds ? `${p.diamonds} 💎` : "",
      p.seeds ? `${p.seeds} seeds` : "",
      ...(Array.isArray(p.plots) ? p.plots.map((g) =>
        `1× ${g.lucky ? "Lucky " : ""}${String(g.rarity || "rare").toUpperCase()} Plot`) : []),
    ].filter(Boolean) : [];
    const resultBlock = p ? `
      <div class="ar-result-box">
        <div class="ar-result-title">🏁 Week ${escapeHtml(p.weekLabel || p.weekKey || "")} — Final Results</div>
        <div class="ar-result-pos">Your position: <b>#${p.rank || "?"}</b></div>
        <div class="ar-result-line">⭐ ${fmtNum(p.score)} pts &middot; ${fmtNum(p.wins)}W-${fmtNum(p.losses)}L</div>
        <div class="ar-result-rewards">${rewardBits.join(" &middot; ") || "Participation"}</div>
        ${p.claimed
          ? `<div class="ar-result-claimed">✅ Claimed — enjoy the new week!</div>`
          : `<button class="bb-btn bb-primary" id="ar-claim-btn">🎁 Claim Rewards</button>`}
      </div>` : "";

    overlay.innerHTML = `
      <div class="ar-rewards-card">
        <button class="bd-close">✕</button>
        <div class="ar-rewards-head">
          <div class="ar-rewards-icon">🏆</div>
          <h3>${p && !p.claimed ? "Your Season Results" : "Season Rewards"}</h3>
          <p>Delivered at the end of every week (Sunday 23:59 UTC) to the
             top 500 on the leaderboard.</p>
        </div>
        ${resultBlock}
        <div class="ar-rewards-list">
          ${rewardsRows().map(r => `
              <div class="ar-rewards-row">
                <div class="ar-medal ${r.medal}">${r.medal ? r.place.split(" ")[1] : "4+"}</div>
                <div class="ar-rewards-body">
                  <div class="ar-rewards-place">${r.place}</div>
                  <div class="ar-rewards-items">${r.items.join(" &middot; ")}</div>
                </div>
              </div>`).join("")}
        </div>
        <div class="ar-rewards-note">
          Rewards are claimed from the popup after the season settles.
          Everyone who battled at least once is eligible.
        </div>
        <button class="bb-btn bb-primary" id="ar-rewards-close">Got it</button>
      </div>`;
    overlay.querySelector(".bd-close").addEventListener("click", closeRewards);
    overlay.querySelector("#ar-rewards-close").addEventListener("click", closeRewards);
    const claimBtn = overlay.querySelector("#ar-claim-btn");
    if (claimBtn) claimBtn.addEventListener("click", claimPayout);
    overlay.classList.remove("hidden");
  }

  function closeRewards() {
    const overlay = el("ar-rewards-modal");
    if (overlay) overlay.classList.add("hidden");
  }

  function closeLobby() {
    const m = el(MODAL_ID);
    if (m) m.classList.add("hidden");
    if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }
    if (globalTimer) { clearTimeout(globalTimer); globalTimer = null; }
    if (weekEndTimer) { clearTimeout(weekEndTimer); weekEndTimer = null; }
  }

  /* ------------------------------------------------------- defender */
  async function setDefender(buddyId) {
    const d = await call("arenaSetDefender", { buddyId });
    if (d && d.ok) {
      if (typeof showToast === "function") {
        showToast("🛡️ Defense Buddy set! Other players can now battle it.");
      }
      return true;
    }
    if (typeof showToast === "function") {
      showToast("⚠️ Could not set Defense Buddy — try again.");
    }
    return false;
  }

  /* ------------------------------------------------⚡ ad energy refill */
  // 🎬 The ad callback grants NOTHING by itself: claimAdReward('arena_energy')
  // mints the credit server-side and arenaAdRefillEnergy spends it for +20 ⚡
  // (5-min spacing between refills). A rejected refill never consumes the
  // credit — it stays banked for the next attempt.
  async function watchAdRefill() {
    const btn = el("ar-ad-btn");
    if (btn) { btn.disabled = true; btn.textContent = "Loading ad…"; }
    const earned = (typeof Ads !== "undefined" && Ads.showRewarded)
      ? await Ads.showRewarded("arena_energy") : false;
    if (!earned) {
      renderLobby();
      (window.showToast || alert)("Ad not completed — energy unchanged.");
      return;
    }
    let claim = await ServerAntiCheat.claimAdReward("arena_energy");
    // The server spaces ad claims 20s apart — fast (demo/test) ads can finish
    // sooner than that; wait out the window and retry once.
    if (claim && claim.ok === false && claim.reason === "too_soon" && claim.retryAfterMs > 0) {
      await new Promise((r) => setTimeout(r, Math.min(30000, claim.retryAfterMs) + 750));
      claim = await ServerAntiCheat.claimAdReward("arena_energy");
    }
    if (!claim || !claim.ok) {
      renderLobby();
      (window.showToast || alert)(claim && claim.reason === "daily_cap"
        ? "🎬 No ad refills left today — energy regenerates on its own."
        : "⚠️ Could not verify the ad — try again.", 4000);
      return;
    }
    const d = await call("arenaAdRefillEnergy", {});
    if (d && d.ok) {
      applyEntry(d);
      (window.showToast || alert)(`⚡ +${d.granted || 20} Arena Energy restored!`, 4000);
    } else {
      renderLobby();
      const why = {
        ad_cooldown: "🎬 Next ad refill is still cooling down.",
        no_credit: "⚠️ Credit missing — watch the ad again.",
        energy_full: "⚡ Energy is already full.",
      }[(d && d.reason)] || "⚠️ Could not restore energy — try again.";
      (window.showToast || alert)(why, 4000);
    }
  }

  /* ---------------------------------------------------------- battle */
  async function startBattle() {
    if (typeof showToast === "function") showToast("🔎 Finding an opponent…");
    const d = await call("arenaFindMatch", {});
    if (!d || !d.ok) {
      const why = {
        no_defender: "Set a Defense Buddy first.",
        // Not a lockout — the pool is simply empty. Point at the countdown
        // and the ad refill instead of blaming the player.
        need_energy: d && d.entry && d.entry.nextRegenMs
          ? `⚡ Not enough Energy — next +1 ⚡ in ${Math.ceil(d.entry.nextRegenMs / 60000)} min, or watch an ad to refill.`
          : "⚡ Not enough Energy — wait for regen or watch an ad to refill.",
        no_opponents: "No opponents available yet — set a Defense Buddy and check back.",
        // Every available opponent has already been fought 3 times today. This
        // is the fairness cap doing its job, so say so plainly rather than
        // making it sound like a fault.
        opponents_capped: "You've faced every opponent 3 times today — come back tomorrow for fresh matchups.",
      }[d && d.reason] || "Could not find a match — try again.";
      // Keep the lobby's own numbers in step whenever the server tells us.
      if (d && d.entry) applyEntry(d.entry);
      if (typeof showToast === "function") showToast("⚠️ " + why);
      return;
    }

    const opponent = d.opponent || {};
    const snap = opponent.defender || {};
    const wildInst = BuddyEngine.makeInstance(snap.speciesId || "wispurr", snap.level || 5, {
      uid: "arena_" + d.matchId,
      nickname: snap.nickname || "Defender",
      ivs: snap.ivs,
      natureId: snap.natureId,
      hue: snap.hue,
      colorHsl: snap.colorHsl,
      colorway: snap.colorway,
      moves: snap.moves,
      customization: snap.customization,
    });
    // The snapshot carries its own stats — use them verbatim so a defender is
    // exactly as strong as when its owner set it.
    if (snap.stats) wildInst.stats = snap.stats;

    const ally = (typeof BuddySystem !== "undefined" && BuddySystem.activeBuddy)
      ? BuddySystem.activeBuddy() : null;
    if (!ally) {
      if (typeof showToast === "function") showToast("⚠️ You need a buddy before entering the Arena.");
      return;
    }

    if (typeof BuddySystem !== "undefined" && BuddySystem.activeBuddy) {
      // Show the arena lobby's opponent banner alongside the fight.
    }

    if (typeof BuddyBattle !== "undefined") {
      BuddyBattle.startEncounter({
        mode: "pvp",
        ally,
        wild: wildInst,
        // A sparring fight has no real opponent behind it — say so on the
        // banner instead of presenting the player's own avatar as an enemy.
        spawn: d.sparring
          ? { id: d.matchId, opponentName: "Sparring Dummy", opponentAvatar: "🥋", opponentTitle: "Practice — no rank at stake" }
          : { id: d.matchId, opponentName: opponent.name, opponentAvatar: opponent.avatar, opponentTitle: opponent.title },
        bag: [],
        onResult: (summary) => settle(summary, d.matchId, wildInst, ally),
      });
    }
    closeLobby();
  }

  async function settle(summary, matchId, wildInst, ally) {
    const won = summary && summary.outcome === "win";
    const turns = (summary && summary.turns) || 1;

    // Both outcomes train the buddy.
    //
    // The losing buddy used to get NOTHING — no AP it could feel, no XP, no
    // chance to grow. That made an arena loss a pure dead-end, which is the
    // opposite of the intent: the whole point of paying 1 AP to lose is that
    // the player still comes away progressing. A loss now earns quarter-rate
    // buddy XP (the same discount wild losses have always used), so a buddy
    // can still level up from arena losses.
    try {
      if (typeof BuddyEngine !== "undefined" && ally) {
        const outcome = won ? "win" : "loss";
        const xp = BuddyEngine.battleXpReward(wildInst, outcome);
        // Award on the LIVE bag entry (re-resolved by uid inside
        // BuddySystem.awardBattleXp) and persist. Mutating `ally` directly
        // wrote the XP onto a detached copy — sync responses rebuild
        // state.buddy mid-fight — so the award vanished ("15 arena wins,
        // buddy earned 0 XP") even though the victory modal showed it.
        let xpInfo = null;
        if (typeof BuddySystem !== "undefined" && BuddySystem.awardBattleXp) {
          xpInfo = BuddySystem.awardBattleXp(ally.uid, xp);
        } else {
          BuddyEngine.addXp(ally, xp);
        }
        // 🏆 End-of-battle XP results — the battle screen stays up behind the
        // panel and the ally's XP bar fills with the XP just earned.
        try {
          if (xpInfo && xpInfo.xpAward > 0 &&
              typeof BuddyBattle !== "undefined" && BuddyBattle.showXpResults) {
            BuddyBattle.showXpResults(Object.assign({}, xpInfo, { outcome: won ? "win" : "loss" }));
          }
        } catch (e) {}
        if (typeof PlayerXP !== "undefined") {
          PlayerXP.addXP(
            won ? PlayerXP.XP.battleWin : PlayerXP.XP.battleLoss,
            won ? "arena_win" : "arena_loss"
          );
        }
      }
    } catch (e) {}

    const d = await call("arenaResolveBattle", { matchId, won, turns });
    if (d && d.ok) {
      // applyEntry takes the whole entry view wholesale rather than
      // cherry-picking fields — cherry-picking is what let the old
      // `dailyFree` survive as a silent 0 on the client for so long.
      applyEntry({
        ap: d.ap, wins: d.wins, losses: d.losses, score: d.score,
        energy: d.energy,
        energyMax: d.energyMax,
        battleCost: d.battleCost,
        nextRegenMs: d.nextRegenMs,
        adRefillEnergy: d.adRefillEnergy,
        adRefillInMs: d.adRefillInMs,
        battlesToday: d.battlesToday,
      });
      if (typeof showToast === "function") {
        const apLine = `+${d.apAwarded} AP`;
        showToast(won
          ? `🏆 Victory! ${apLine} · Rank points +10`
          : `💀 Defeat. ${apLine} · Rank points -5`);
      }
    } else if (typeof showToast === "function") {
      showToast("⚠️ Result could not be saved — try again.");
    }
    openLobby();
  }

  /* --------------------------------------------------------------- init */
  function init() {
    injectStyle();
    fetchState();
    try {
      if (typeof firebase !== "undefined" && firebase.auth) {
        firebase.auth().onAuthStateChanged(() => fetchState());
      }
    } catch (e) {}
  }

  return {
    init,
    openLobby,
    closeLobby,
    setDefender,
    startBattle,
    getState: () => lastState,
  };
})();
