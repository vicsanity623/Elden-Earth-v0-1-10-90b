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
  // Guards the countdown-completion re-fetch from firing once per render tick
  // while the request is still in flight.
  let regenRefetchPending = false;
  // ...and from firing once per tick when the server clock lags and still
  // reports the countdown as already elapsed.
  let lastRegenRefetchAt = 0;
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
.ar-entry-strip{
  display:flex; gap:6px; margin:10px auto 0; justify-content:center;
}
.ar-entry-cell{
  flex:1 1 0; max-width:120px; padding:7px 4px; text-align:center;
  background:rgba(255,255,255,.05); border:1px solid rgba(255,255,255,.1);
  border-radius:8px;
}
.ar-entry-num{
  display:block; color:#fff; font-size:15px; font-weight:900;
  font-variant-numeric:tabular-nums; line-height:1.2;
}
.ar-entry-lbl{
  display:block; color:#93a4c0; font-size:10px; text-transform:uppercase;
  letter-spacing:.4px; margin-top:2px;
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
.ar-note{
  margin:10px 2px 0; font-size:10.5px; color:#8fa6c4; line-height:1.55; text-align:center;
}
.ar-empty{ padding:22px 12px; text-align:center; color:#8aa0bd; font-size:12px; line-height:1.7; }

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
    }
    return d;
  }

  /* -------------------------------------------------------- lobby render */
  function renderLobby() {
    const box = el("ar-lobby-body");
    if (!box) return;
    const d = lastState || {};
    const season = d.season || {};
    const me = d.me || {};
    const rules = d.rules || {};
    const top = Array.isArray(d.top) ? d.top : [];

    const remain = Math.max(0, (Number(season.end) || Date.now()) - Date.now());
    const freeLeft = Number(me.freeLeft) || 0;
    const freeBankMax = Number(me.freeBankMax) || 5;
    const paidLeft = Number(me.paidLeft) || 0;
    const paidCost = Number(rules.paidCost) || 3;
    const ap = Number(me.ap) || 0;
    const maxDay = Number(rules.maxPerDay) || 15;
    const usedToday = Number(me.battlesToday) || 0;

    // Live regen countdown. The server reports freeNextInMs as a snapshot;
    // subtract the time elapsed since that snapshot arrived so the number
    // ticks down every second without re-fetching.
    const sentNextIn = (me.freeNextInMs === null || me.freeNextInMs === undefined)
      ? null : Number(me.freeNextInMs);
    const ageMs = lastStateAt ? Math.max(0, Date.now() - lastStateAt) : 0;
    let nextIn = sentNextIn === null ? null : Math.max(0, sentNextIn - ageMs);

    // When the locally-ticked countdown reaches zero a real entry has landed,
    // but the server still holds the old snapshot. Re-fetch so the Battle
    // button unlocks instead of sitting stale until the player taps it.
    //
    // Cooldown-guarded: if the server clock lags the client's, the response
    // can still read <= 0, and without this the guard would reset and fire
    // another fetch on every 1s tick — one request per second, forever.
    if (nextIn !== null && nextIn <= 0 && freeLeft < freeBankMax
        && !regenRefetchPending && Date.now() - lastRegenRefetchAt > 5000) {
      lastRegenRefetchAt = Date.now();
      regenRefetchPending = true;
      fetchState().then(() => { regenRefetchPending = false; });
    }

    const mmss = (ms) => {
      const s = Math.ceil(ms / 1000);
      return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
    };

    // Footer button state. Order matters: the daily cap outranks everything,
    // then a banked free entry, then an affordable paid bypass, then either
    // "wait for the timer" or "you are out" — never the old flat dead-end.
    let btnLabel, btnSub = "", btnDisabled = false;
    if (usedToday >= maxDay) {
      btnLabel = "Daily limit reached";
      btnSub = `${usedToday}/${maxDay} battles used — resets at midnight`;
      btnDisabled = true;
    } else if (freeLeft > 0) {
      btnLabel = `Battle (${freeLeft}/${freeBankMax})`;
      btnSub = `${usedToday}/${maxDay} today`;
    } else if (paidLeft > 0 && ap >= paidCost) {
      btnLabel = `Battle (${paidCost} AP)`;
      btnSub = `Paid left ${paidLeft} · ${usedToday}/${maxDay} today`;
    } else if (nextIn !== null && nextIn > 0) {
      // The fix for the old lockout: waiting, not out.
      btnLabel = `Free entry in ${mmss(nextIn)}`;
      btnSub = paidLeft > 0 ? `or ${paidCost} AP to skip the wait` : "Next free entry incoming";
      btnDisabled = true;
    } else if (paidLeft > 0) {
      btnLabel = "No attempts left";
      btnSub = `Need ${paidCost} AP — you have ${ap}`;
      btnDisabled = true;
    } else {
      btnLabel = "No attempts left";
      btnSub = "Come back tomorrow";
      btnDisabled = true;
    }

    const rows = top.map((r, i) => `
      <div class="ar-row">
        <div class="ar-medal m${i + 1}">${i + 1}</div>
        ${avatarHtml(r.avatar)}
        <div class="ar-name">
          <b>${escapeHtml(r.name)}</b>
          <span>${escapeHtml(r.title || "Citizen of the Realm")}</span>
        </div>
        <div class="ar-wins">${fmtNum(r.wins)} wins</div>
      </div>`).join("");

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
        <div class="ar-ribbon-title"><span class="t">🏆</span> Ranks</div>
      </div>
      <div class="ar-dots"></div>
      ${rows || '<div class="ar-empty">No ranked players yet this week.<br>Set a Defense Buddy and be the first!</div>'}

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

        <div class="ar-entry-strip">
          <div class="ar-entry-cell">
            <span class="ar-entry-num">${freeLeft}/${freeBankMax}</span>
            <span class="ar-entry-lbl">Free</span>
          </div>
          <div class="ar-entry-cell">
            <span class="ar-entry-num">${paidLeft}</span>
            <span class="ar-entry-lbl">Paid left</span>
          </div>
          <div class="ar-entry-cell">
            <span class="ar-entry-num">${usedToday}/${maxDay}</span>
            <span class="ar-entry-lbl">Battles today</span>
          </div>
        </div>
        ${nextIn !== null && nextIn > 0 ? `
          <div class="ar-regen-line">
            ⏳ Next free entry in <b>${mmss(nextIn)}</b> · fills to ${freeBankMax}
          </div>` : (freeLeft >= freeBankMax ? `
          <div class="ar-regen-line full">✅ Free entry bank is full</div>` : "")}
      </div>

      <div class="ar-season-line">
        Week of ${escapeHtml(season.label || "")} —
        <b>ENDS in ${fmtCountdown(remain)}</b>
      </div>

      ${me.defenderSet ? "" : `
        <div class="ar-note" style="color:#fca5a5">
          ⚠ You have no Defense Buddy set. Open the Buddy Bag, tap a buddy and
          choose “Set as Defense Buddy” before you can battle.
        </div>`}

      <div class="ar-actions">
        <button class="btn" id="ar-cancel-btn">Cancel</button>
        <button class="btn ar-battle-btn" id="ar-battle-btn" ${btnDisabled ? "disabled" : ""}>
          ${escapeHtml(btnLabel)}<small>${escapeHtml(btnSub)}</small>
        </button>
      </div>

      <div class="ar-note">
        Lifetime record: ${fmtNum(me.lifetimeWins)} wins · ${fmtNum(me.lifetimeLosses)} losses
        &nbsp;·&nbsp; You have <b style="color:#fff">${fmtNum(ap)} AP</b>
      </div>
    `;

    const info = el("ar-info-btn");
    if (info) info.addEventListener("click", openRewards);

    const cancel = el("ar-cancel-btn");
    if (cancel) cancel.addEventListener("click", closeLobby);
    const battle = el("ar-battle-btn");
    if (battle) battle.addEventListener("click", () => { if (!battle.disabled) startBattle(); });
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
      renderLobby();
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
      overlay.innerHTML = `
        <div class="ar-rewards-card">
          <button class="bd-close">✕</button>
          <div class="ar-rewards-head">
            <div class="ar-rewards-icon">🏆</div>
            <h3>Season Rewards</h3>
            <p>Delivered at the end of every week (Sunday 23:59 UTC) to the
               top 500 on the leaderboard.</p>
          </div>
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
      overlay.addEventListener("click", (e) => { if (e.target === overlay) closeRewards(); });
      document.body.appendChild(overlay);
      overlay.querySelector(".bd-close").addEventListener("click", closeRewards);
      overlay.querySelector("#ar-rewards-close").addEventListener("click", closeRewards);
    }
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

  /* ---------------------------------------------------------- battle */
  async function startBattle() {
    if (typeof showToast === "function") showToast("🔎 Finding an opponent…");
    const d = await call("arenaFindMatch", {});
    if (!d || !d.ok) {
      const why = {
        no_defender: "Set a Defense Buddy first.",
        daily_limit: "Daily battle limit reached.",
        no_attempts: "No attempts left today.",
        // Not an error — the timer is simply still running. Say so, with the
        // countdown, instead of blaming the player's connection.
        regen_wait: d && d.entry && d.entry.freeNextInMs
          ? `No entries yet — the next free one lands in ${Math.ceil(d.entry.freeNextInMs / 60000)} min.`
          : "No entries yet — your next free entry is on its way.",
        no_opponents: "No opponents available yet — set a Defense Buddy and check back.",
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
        spawn: { id: d.matchId, opponentName: opponent.name, opponentAvatar: opponent.avatar, opponentTitle: opponent.title },
        bag: [],
        onResult: (summary) => settle(summary, d.matchId, wildInst, ally),
      });
    }
    closeLobby();
  }

  async function settle(summary, matchId, wildInst, ally) {
    const won = summary && summary.outcome === "win";
    const turns = (summary && summary.turns) || 1;

    // The winning buddy grows, same as wild battles.
    try {
      if (won && typeof BuddyEngine !== "undefined") {
        const target = ally;
        const r = BuddyEngine.addXp(target, BuddyEngine.battleXpReward(wildInst, "win"));
        if (r.leveled > 0 && typeof showToast === "function") {
          showToast(`⭐ ${target.nickname} reached Lv.${target.level}!`);
        }
        if (typeof PlayerXP !== "undefined") PlayerXP.addXP(PlayerXP.XP.battleWin, "arena_win");
      } else if (typeof PlayerXP !== "undefined") {
        PlayerXP.addXP(PlayerXP.XP.battleLoss, "arena_loss");
      }
    } catch (e) {}

    const d = await call("arenaResolveBattle", { matchId, won, turns });
    if (d && d.ok) {
      // applyEntry takes the whole entry view wholesale rather than
      // cherry-picking fields — cherry-picking is what let the old
      // `dailyFree` survive as a silent 0 on the client for so long.
      applyEntry({
        ap: d.ap, wins: d.wins, losses: d.losses, score: d.score,
        freeLeft: d.freeLeft,
        freeBankMax: d.freeBankMax,
        freeNextInMs: d.freeNextInMs,
        paidLeft: d.paidLeft, battlesToday: d.battlesToday,
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
