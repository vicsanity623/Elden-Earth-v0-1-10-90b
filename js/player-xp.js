/* ==========================================================================
   Elden Earth — Player XP & Level
   Tracked player progression independent of any single buddy: small XP
   grants for player actions and larger grants for buddy battle wins, with a
   visible level + XP bar HUD.

   State lives in `state.playerXP` (see the SAFE_SAVE_FIELDS wiring in
   functions/index.js) so it persists with the rest of the save.
   ========================================================================== */
const PlayerXP = (() => {
  "use strict";

  const HUD_ID = "player-xp-hud";
  const STYLE_ID = "player-xp-style";
  const INMODAL_ID = "player-xp-inmodal";
  const TARGET_PANEL = '#player-info-modal [data-pi-panel="profile"]';

  // Small grants for routine actions, bigger for combat outcomes.
  const XP = {
    battleWin: 40,
    battleLoss: 8,
    tame: 60,
    feast: 30,
    encounter: 5,
    spawnSeen: 3,
    buddyLevelUp: 25,
    dailyQuest: 15,
    achievement: 20,
    petFeed: 2,
    spin: 4,
    buy: 6,
    login: 10,
  };

  let lastLevel = 1;
  let hooksInstalled = false;
  
  const iconCoin = `<img src="assets/eb-coin.png" style="width: 1.1em; height: 1.1em; vertical-align: -0.15em; display: inline-block;" />`;
  const iconDiamond = `<img src="assets/diamond-spawn.png" style="width: 1.1em; height: 1.1em; vertical-align: -0.15em; display: inline-block;" />`;

  /* ------------------------------------------------------------- State */
  function ensureState() {
    const state = (typeof Store !== "undefined" && Store.get) ? Store.get() : null;
    if (!state) return null;
    if (!state.playerXP || typeof state.playerXP !== "object") {
      state.playerXP = { xp: 0, level: 1, totalXp: 0, lastGrantAt: 0 };
    }
    if (typeof state.playerXP.xp !== "number") state.playerXP.xp = 0;
    if (typeof state.playerXP.level !== "number") state.playerXP.level = 1;
    if (typeof state.playerXP.totalXp !== "number") state.playerXP.totalXp = state.playerXP.xp;
    return state.playerXP;
  }

  function getState() {
    const s = ensureState();
    return s || { xp: 0, level: 1, totalXp: 0, lastGrantAt: 0 };
  }

  /* --------------------------------------------------------------- XP */
  /**
   * Grant player XP. Returns { leveledTo, gained, reason } — level-ups are
   * toasted once, never spammed.
   */
  function addXP(amount, reason) {
    const px = ensureState();
    if (!px || !amount || amount <= 0) return { leveledTo: null, gained: 0, reason };

    const gained = Math.max(1, Math.floor(amount));
    px.xp += gained;
    px.totalXp += gained;
    px.lastGrantAt = Date.now();

    let leveledTo = null;
    const max = BuddyData.PLAYER_MAX_LEVEL;

    while (px.level < max) {
      const need = BuddyData.playerXpToNext(px.level);
      if (px.xp < need) break;
      px.xp -= need;
      px.level += 1;
      leveledTo = px.level;
    }

    if (px.level >= max) px.xp = 0;

    if (leveledTo) {
      const fromLevel = lastLevel;
      lastLevel = leveledTo;
      toastLevelUp(leveledTo, fromLevel);
    }

    renderHUD();
    persist();
    return { leveledTo, gained, reason };
  }

  function progress() {
    const px = getState();
    const need = BuddyData.playerXpToNext(px.level);
    return {
      level: px.level,
      xp: px.xp,
      need,
      pct: Math.min(100, Math.round((px.xp / Math.max(1, need)) * 100)),
      totalXp: px.totalXp,
      title: BuddyData.playerTitle(px.level),
      maxed: px.level >= BuddyData.PLAYER_MAX_LEVEL,
    };
  }

  let persistTimer = null;
  function persist() {
    if (typeof Store === "undefined" || !Store.save) return;
    clearTimeout(persistTimer);
    persistTimer = setTimeout(() => {
      try { Store.save(false); } catch (e) { /* non-fatal */ }
    }, 400);
  }

  /* --------------------------------------------------------- Action hooks */
  // Wraps existing globals so player actions grant XP WITHOUT touching any
  // existing code block. Everything degrades to a no-op if the target is
  // missing or already wrapped.
  function installHooks() {
    if (hooksInstalled) return;
    hooksInstalled = true;

    // Daily quest completions.
    try {
      const original = window.completeDailyQuest;
      if (typeof original === "function" && !original.__xpWrapped) {
        const wrapped = function (...args) {
          const r = original.apply(this, args);
          try { addXP(XP.dailyQuest, "daily_quest"); } catch (e) {}
          return r;
        };
        wrapped.__xpWrapped = true;
        window.completeDailyQuest = wrapped;
      }
    } catch (e) {}

    // Achievement stat recording (throttled so a burst doesn't shower XP).
    try {
      if (typeof Achievements !== "undefined" && Achievements.record) {
        const orig = Achievements.record;
        if (typeof orig === "function" && !orig.__xpWrapped) {
          let lastAch = 0;
          const wrapped = function (...args) {
            const r = orig.apply(this, args);
            const now = Date.now();
            if (now - lastAch > 8000) {
              lastAch = now;
              try { addXP(XP.achievement, "achievement"); } catch (e) {}
            }
            return r;
          };
          wrapped.__xpWrapped = true;
          Achievements.record = wrapped;
        }
      }
    } catch (e) {}

    // Companion pet feeding.
    try {
      if (typeof CompanionPet !== "undefined" && CompanionPet.feedBerry) {
        const orig = CompanionPet.feedBerry;
        if (typeof orig === "function" && !orig.__xpWrapped) {
          const wrapped = function (...args) {
            const r = orig.apply(this, args);
            try { addXP(XP.petFeed, "pet_feed"); } catch (e) {}
            return r;
          };
          wrapped.__xpWrapped = true;
          CompanionPet.feedBerry = wrapped;
        }
      }
    } catch (e) {}

    // Elden Stop spins.
    try {
      if (typeof EldenStops !== "undefined" && EldenStops.openStopSession) {
        const orig = EldenStops.openStopSession;
        if (typeof orig === "function" && !orig.__xpWrapped) {
          const wrapped = function (...args) {
            const r = orig.apply(this, args);
            try { addXP(XP.spin, "elden_stop"); } catch (e) {}
            return r;
          };
          wrapped.__xpWrapped = true;
          EldenStops.openStopSession = wrapped;
        }
      }
    } catch (e) {}
  }

  /* ------------------------------------------------------------- UI */
  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const css = `
/* Trainer block lives inside the Player Info modal (Profile tab), not on the
   map HUD — it opens the Trainer panel from there. */
#${INMODAL_ID}{
  margin:12px 0 4px; padding:12px 13px; border-radius:15px;
  background:linear-gradient(140deg, rgba(43,108,240,.16), rgba(124,58,237,.16));
  border:1px solid rgba(139,92,246,.34);
}
#${INMODAL_ID} .pxim-row{display:flex; align-items:center; gap:11px;}
#${INMODAL_ID} .pxim-lvl{
  flex:0 0 auto; width:44px; height:44px; border-radius:13px;
  background:linear-gradient(140deg,#2b6cf0,#7c3aed); color:#fff;
  display:flex; align-items:center; justify-content:center;
  font-size:17px; font-weight:900; letter-spacing:.2px;
}
#${INMODAL_ID} .pxim-meta{flex:1 1 auto; min-width:0;}
#${INMODAL_ID} .pxim-title{
  font-size:10px; color:#b8a9f0; letter-spacing:1.1px; text-transform:uppercase;
  font-weight:800; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
}
#${INMODAL_ID} .pxim-bar{
  height:7px; border-radius:99px; background:rgba(255,255,255,.13);
  overflow:hidden; margin:5px 0 4px;
}
#${INMODAL_ID} .pxim-fill{
  height:100%; width:0%; border-radius:99px;
  background:linear-gradient(90deg,#38bdf8,#818cf8,#c084fc);
  transition:width .45s cubic-bezier(.22,1,.36,1);
}
#${INMODAL_ID} .pxim-xp{
  font-size:10.5px; color:#c3d2ea; font-variant-numeric:tabular-nums;
}
#${INMODAL_ID} .pxim-btn{
  flex:0 0 auto; padding:9px 13px; border-radius:11px; cursor:pointer;
  font-family:inherit; font-size:11px; font-weight:800; letter-spacing:.3px;
  border:1px solid rgba(150,180,240,.24); background:rgba(32,42,70,.92); color:#eaf1ff;
}
#${INMODAL_ID} .pxim-btn:active{transform:scale(.96);}
.px-levelup{
  position:fixed; left:50%; top:22%; transform:translate(-50%,-50%) scale(.9);
  z-index:4000; padding:18px 26px; border-radius:16px; text-align:center;
  background:linear-gradient(150deg,rgba(30,41,82,.97),rgba(88,28,135,.97));
  border:1px solid rgba(196,181,253,.55); color:#fff;
  box-shadow:0 18px 55px rgba(0,0,0,.55); opacity:0; pointer-events:none;
  animation:pxLevelUp 2.6s ease forwards;
}
.px-levelup .px-lu-kicker{
  font-size:11px; letter-spacing:3px; text-transform:uppercase; color:#c4b5fd;
}
.px-levelup .px-lu-level{font-size:38px; font-weight:900; line-height:1.1; margin:2px 0;}
.px-levelup .px-lu-title{font-size:13px; color:#e9d5ff;}
.px-levelup .px-lu-rewards{
  display:flex; flex-wrap:wrap; gap:6px; justify-content:center; margin-top:10px;
}
.px-levelup .px-lu-rewards span{
  font-size:11px; font-weight:800; padding:4px 9px; border-radius:99px;
  background:rgba(255,255,255,.14); border:1px solid rgba(255,255,255,.2); color:#fff;
}
@keyframes pxLevelUp{
  0%{opacity:0; transform:translate(-50%,-50%) scale(.86);}
  12%{opacity:1; transform:translate(-50%,-50%) scale(1);}
  78%{opacity:1; transform:translate(-50%,-50%) scale(1);}
  100%{opacity:0; transform:translate(-50%,-58%) scale(1.04);}
}
`;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = css;
    document.head.appendChild(style);
  }

  // Mounts inside the Player Info modal's Profile tab (see TARGET_PANEL).
  // Falls back to creating a detached node if the modal markup isn't present
  // yet — renderHUD() will move it into place on a later call.
  function ensureHud() {
    let el = document.getElementById(INMODAL_ID);
    if (!el) {
      el = document.createElement("div");
      el.id = INMODAL_ID;
      el.innerHTML = `
        <div class="pxim-row">
          <div class="pxim-lvl">1</div>
          <div class="pxim-meta">
            <div class="pxim-title">Wanderer · Trainer Level 1</div>
            <div class="pxim-bar"><div class="pxim-fill"></div></div>
            <div class="pxim-xp">0 / 0 XP</div>
          </div>
          <button class="pxim-btn" type="button">🏆 Trainer</button>
        </div>
      `;
      el.querySelector(".pxim-btn").addEventListener("click", (e) => {
        e.stopPropagation();
        if (typeof BuddySystem !== "undefined" && BuddySystem.openTrainerModal) {
          BuddySystem.openTrainerModal();
        }
      });
    }

    // Place it directly under the profile header card inside the modal.
    const panel = document.querySelector(TARGET_PANEL);
    if (panel && el.parentNode !== panel) {
      const header = panel.querySelector(".profile-header-card");
      if (header && header.parentNode === panel) {
        header.insertAdjacentElement("afterend", el);
      } else {
        panel.insertBefore(el, panel.firstChild);
      }
    } else if (!panel && !el.parentNode) {
      // Modal not in the DOM yet — keep it attached to body but hidden; the
      // observer in init() relocates it once the modal appears.
      el.style.display = "none";
      document.body.appendChild(el);
    }
    return el;
  }

  function renderHUD() {
    injectStyle();
    const el = ensureHud();
    if (el && el.style.display === "none" && document.querySelector(TARGET_PANEL)) {
      el.style.display = "";
    }
    const p = progress();
    const lvlEl = el.querySelector(".pxim-lvl");
    const titleEl = el.querySelector(".pxim-title");
    const xpEl = el.querySelector(".pxim-xp");
    const fillEl = el.querySelector(".pxim-fill");
    if (lvlEl) lvlEl.textContent = String(p.level);
    if (titleEl) titleEl.textContent = `${p.title} · Trainer Level ${p.level}`;
    if (xpEl) xpEl.textContent = p.maxed ? "MAX LEVEL" : `${p.xp.toLocaleString()} / ${p.need.toLocaleString()} XP`;
    if (fillEl) fillEl.style.width = (p.maxed ? 100 : p.pct) + "%";
  }

  /**
   * Claim the level-up payouts from the server, then show what landed.
   * EB / diamonds / RP are server-owned so the grant has to be requested —
   * the response is mirrored back into the local save for an instant UI.
   */
  function claimLevelRewards(fromLevel, toLevel) {
    const reward = (typeof BuddyData !== "undefined" && BuddyData.trainerLevelRewards)
      ? BuddyData.trainerLevelRewards(fromLevel, toLevel)
      : { berries: 0, eb: 0, diamonds: 0, rp: 0 };

    let settled = false;
    const finish = (serverReward) => {
      if (settled) return;
      settled = true;
      const r = serverReward || reward;
      // Optimistic mirror — the next syncSafeState response overwrites these
      // with the authoritative server values anyway.
      try {
        const state = (typeof Store !== "undefined" && Store.get) ? Store.get() : null;
        if (state) {
          if (r.berries) state.berries = (state.berries || 0) + r.berries;
          if (r.eb) state.eb = (state.eb || 0) + r.eb;
          if (r.diamonds) state.diamonds = (state.diamonds || 0) + r.diamonds;
          try { if (typeof Store !== "undefined" && Store.save) Store.save(true); } catch (e) {}
          try { if (typeof updateTopbar === "function") updateTopbar(); } catch (e) {}
        }
      } catch (e) {}
      try { if (typeof BuddySystem !== "undefined" && BuddySystem.renderHudBadge) BuddySystem.renderHudBadge(); } catch (e) {}
      return r;
    };

    // Fire the server claim; fall back to the local table if it is unreachable
    // so the reward still reads correctly in the UI.
    try {
      if (typeof firebase !== "undefined" && firebase.functions) {
        const fn = firebase.functions().httpsCallable("buddyClaimLevelRewards");
        fn({ level: toLevel })
          .then((res) => {
            const d = (res && res.data) || {};
            if (d.ok) finish({ berries: d.berries || 0, eb: d.eb || 0, diamonds: d.diamonds || 0, rp: d.rp || 0 });
            else finish(reward);
          })
          .catch(() => finish(reward));
      } else {
        finish(reward);
      }
    } catch (e) {
      finish(reward);
    }

    return reward;
  }

  function rewardChips(r) {
    const bits = [];
    if (r.berries) bits.push(`🍓 ${r.berries}`);
    if (r.eb) bits.push(`${iconCoin} ${r.eb} EB`);
    if (r.diamonds) bits.push(`${iconDiamond} ${r.diamonds}`);
    if (r.rp) bits.push(`⭐ ${r.rp} RP`);
    return bits;
  }

  function toastLevelUp(level, fromLevel) {
    try {
      const p = progress();
      const r = claimLevelRewards(fromLevel || level - 1, level);
      const chips = rewardChips(r);
      const el = document.createElement("div");
      el.className = "px-levelup";
      el.innerHTML = `
        <div class="px-lu-kicker">Trainer Level Up</div>
        <div class="px-lu-level">Lv. ${level}</div>
        <div class="px-lu-title">${p.title}</div>
        ${chips.length ? `<div class="px-lu-rewards">${chips.map(c => `<span>${c}</span>`).join("")}</div>` : ""}
      `;
      document.body.appendChild(el);
      setTimeout(() => { try { el.remove(); } catch (e) {} }, 3200);
    } catch (e) {}
  }

  // Kept for API compatibility with the battle screen — the block is now
  // inside the modal so there is nothing on the map to hide.
  function setHidden(hidden) {
    const el = document.getElementById(INMODAL_ID);
    if (el) el.style.opacity = hidden ? "0.35" : "";
  }

  /* -------------------------------------------------------------- Init */
  function init() {
    const px = ensureState();
    lastLevel = px ? px.level : 1;
    installHooks();
    renderHUD();

    // The Player Info modal markup is static HTML, but the Profile tab content
    // is refreshed by main.js — re-place + refresh our block whenever the
    // modal opens so it never gets orphaned or go stale.
    try {
      const modal = document.getElementById("player-info-modal");
      if (modal && typeof MutationObserver !== "undefined") {
        const observer = new MutationObserver(() => {
          const isOpen = !modal.classList.contains("hidden");
          if (isOpen) renderHUD();
        });
        observer.observe(modal, { attributes: true, attributeFilter: ["class"] });
      }
    } catch (e) {}

    try {
      document.addEventListener("visibilitychange", () => {
        if (!document.hidden) renderHUD();
      });
    } catch (e) {}
  }

  return { init, addXP, progress, getState, renderHUD, setHidden, claimLevelRewards, XP };
})();
