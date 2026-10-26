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
      lastLevel = leveledTo;
      toastLevelUp(leveledTo);
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
#${HUD_ID}{
  position:fixed; right:10px; bottom:calc(10px + env(safe-area-inset-bottom,0px));
  z-index:1540; width:168px; padding:7px 10px 8px;
  background:rgba(12,18,30,.82); border:1px solid rgba(120,160,220,.28);
  border-radius:12px; backdrop-filter:blur(10px); -webkit-backdrop-filter:blur(10px);
  pointer-events:auto; user-select:none; cursor:pointer;
  box-shadow:0 6px 20px rgba(0,0,0,.38); transition:opacity .25s, transform .25s;
  font-family:inherit;
}
#${HUD_ID}.px-hidden{opacity:0; transform:translateY(8px); pointer-events:none;}
#${HUD_ID} .px-top{display:flex; align-items:center; gap:6px; margin-bottom:5px;}
#${HUD_ID} .px-lvl{
  flex:0 0 auto; min-width:30px; height:30px; border-radius:9px;
  background:linear-gradient(140deg,#2b6cf0,#7c3aed); color:#fff;
  display:flex; align-items:center; justify-content:center;
  font-size:12px; font-weight:800; letter-spacing:.3px;
}
#${HUD_ID} .px-meta{flex:1 1 auto; min-width:0;}
#${HUD_ID} .px-title{
  font-size:10px; color:#9db8dd; letter-spacing:.6px; text-transform:uppercase;
  white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
}
#${HUD_ID} .px-xp{font-size:10px; color:#cfe0f5; font-variant-numeric:tabular-nums;}
#${HUD_ID} .px-bar{
  height:6px; border-radius:99px; background:rgba(255,255,255,.12); overflow:hidden;
}
#${HUD_ID} .px-fill{
  height:100%; width:0%; border-radius:99px;
  background:linear-gradient(90deg,#38bdf8,#818cf8,#c084fc);
  transition:width .45s cubic-bezier(.22,1,.36,1);
}
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

  function ensureHud() {
    let el = document.getElementById(HUD_ID);
    if (el) return el;
    el = document.createElement("div");
    el.id = HUD_ID;
    el.innerHTML = `
      <div class="px-top">
        <div class="px-lvl">1</div>
        <div class="px-meta">
          <div class="px-title">Wanderer</div>
          <div class="px-xp">0 / 0 XP</div>
        </div>
      </div>
      <div class="px-bar"><div class="px-fill"></div></div>
    `;
    el.addEventListener("click", () => {
      if (typeof BuddySystem !== "undefined" && BuddySystem.openTrainerModal) {
        BuddySystem.openTrainerModal();
      }
    });
    document.body.appendChild(el);
    return el;
  }

  function renderHUD() {
    injectStyle();
    const el = ensureHud();
    const p = progress();
    const lvlEl = el.querySelector(".px-lvl");
    const titleEl = el.querySelector(".px-title");
    const xpEl = el.querySelector(".px-xp");
    const fillEl = el.querySelector(".px-fill");
    if (lvlEl) lvlEl.textContent = String(p.level);
    if (titleEl) titleEl.textContent = p.title;
    if (xpEl) xpEl.textContent = p.maxed ? "MAX LEVEL" : `${p.xp.toLocaleString()} / ${p.need.toLocaleString()} XP`;
    if (fillEl) fillEl.style.width = (p.maxed ? 100 : p.pct) + "%";
  }

  function toastLevelUp(level) {
    try {
      const p = progress();
      const el = document.createElement("div");
      el.className = "px-levelup";
      el.innerHTML = `
        <div class="px-lu-kicker">Trainer Level Up</div>
        <div class="px-lu-level">Lv. ${level}</div>
        <div class="px-lu-title">${p.title}</div>
      `;
      document.body.appendChild(el);
      setTimeout(() => { try { el.remove(); } catch (e) {} }, 2800);
    } catch (e) {}
  }

  // Hide while a full-screen battle is up so it never fights the battle UI.
  function setHidden(hidden) {
    const el = document.getElementById(HUD_ID);
    if (el) el.classList.toggle("px-hidden", !!hidden);
  }

  /* -------------------------------------------------------------- Init */
  function init() {
    const px = ensureState();
    lastLevel = px ? px.level : 1;
    installHooks();
    renderHUD();
    try {
      document.addEventListener("visibilitychange", () => {
        if (!document.hidden) renderHUD();
      });
    } catch (e) {}
  }

  return { init, addXP, progress, getState, renderHUD, setHidden, XP };
})();
