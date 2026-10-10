// ============================================================
// Elden Earth — Achievements & Badges
//
// Lifetime milestones with progress tracking. Every tier is claimable exactly
// once; claiming awards EB + a small amount of Reward Points and unlocks a
// badge.
//
// BADGES ARE GENERATED, NOT DRAWN. Each one is composed from its category
// (colour + glyph) and its tier (bronze / silver / gold rim), so 100 badges
// need no image assets and still look distinct in the grid.
//
// ACHIEVEMENT_TRACKS must stay identical to functions/index.js — the server
// holds the authoritative table and pays from it. Progress is read from
// state.achievementStats (saves_private.stats, server-owned) for tracked stats
// and computed live for the `derived` ones.
// ============================================================
const Achievements = (() => {
  const CATEGORIES = {
    dedication: { label: "Dedication",  color: "#4fd6c4", glyph: "◆" },
    land:       { label: "Land",        color: "#64748b", glyph: "▲" },
    economy:    { label: "Economy",     color: "#ffd700", glyph: "●" },
    explore:    { label: "Exploration", color: "#2ee59d", glyph: "◈" },
    social:     { label: "Social",      color: "#ff6b4a", glyph: "✦" },
    combat:     { label: "Combat",      color: "#b537f2", glyph: "★" },
    mastery:    { label: "Mastery",     color: "#ffb703", glyph: "❖" },
  };

  const TIER_RIMS = ["#cd7f32", "#c0c0c0", "#ffd700"]; // bronze / silver / gold

  const TRACKS = [
    { id: "login_streak",   cat: "dedication", stat: "streakBest",   title: "Log in {n} days in a row",            tiers: [{t:30,eb:200,rp:10},{t:60,eb:200,rp:10},{t:90,eb:200,rp:10}] },
    { id: "days_played",    cat: "dedication", stat: "daysPlayed",   title: "Play on {n} separate days",           tiers: [{t:7,eb:25,rp:2},{t:30,eb:100,rp:5},{t:90,eb:400,rp:10}] },
    { id: "quests_done",    cat: "dedication", stat: "questsCompleted", title: "Complete {n} daily quests",       tiers: [{t:10,eb:25,rp:2},{t:100,eb:100,rp:5},{t:500,eb:400,rp:10}] },
    { id: "boosts_used",    cat: "dedication", stat: "boostsActivated", title: "Activate {n} boosts",            tiers: [{t:5,eb:25,rp:2},{t:25,eb:100,rp:5},{t:100,eb:400,rp:10}] },
    { id: "wheel_spins",    cat: "dedication", stat: "wheelSpins",   title: "Spin the Diamond Wheel {n} times",    tiers: [{t:10,eb:25,rp:2},{t:100,eb:100,rp:5},{t:500,eb:400,rp:10}] },

    { id: "plots_purchased", cat: "land",     stat: "plotsPurchased", title: "Purchase {n} plots",                tiers: [{t:1,eb:25,rp:2},{t:25,eb:100,rp:5},{t:100,eb:400,rp:10}] },
    { id: "plots_owned",     cat: "land",     stat: "plotsOwned", derived: true, title: "Own {n} plots at once",  tiers: [{t:10,eb:25,rp:2},{t:100,eb:100,rp:5},{t:500,eb:400,rp:10}] },
    { id: "plots_ascended",  cat: "land",     stat: "plotsAscended", title: "Ascend {n} plots at the Forge",     tiers: [{t:1,eb:5,rp:5},{t:10,eb:10,rp:5},{t:100,eb:100,rp:5}] },
    { id: "legendary_owned", cat: "land",     stat: "legendaryOwned", derived: true, title: "Own {n} Legendary plots", tiers: [{t:1,eb:50,rp:2},{t:5,eb:150,rp:5},{t:25,eb:500,rp:10}] },
    { id: "lucky_owned",     cat: "land",     stat: "luckyOwned", derived: true, title: "Own {n} Lucky plots",     tiers: [{t:1,eb:50,rp:2},{t:5,eb:150,rp:5},{t:25,eb:500,rp:10}] },
    { id: "trades_done",     cat: "land",     stat: "tradesCompleted", title: "Complete {n} trades",             tiers: [{t:1,eb:25,rp:2},{t:10,eb:100,rp:5},{t:50,eb:400,rp:10}] },

    { id: "rent_earned",     cat: "economy",  stat: "lifetimeRent", derived: true, title: "Accrue {n} in lifetime rent", tiers: [{t:1,eb:25,rp:2},{t:50,eb:100,rp:5},{t:500,eb:400,rp:10}] },
    { id: "dividends",       cat: "economy",  stat: "totalDividends", derived: true, title: "Collect {n} in royalties", tiers: [{t:10,eb:25,rp:2},{t:250,eb:100,rp:5},{t:2500,eb:400,rp:10}] },
    { id: "cash_converted",  cat: "economy",  stat: "cashConverted", title: "Convert Cash to EB {n} times",      tiers: [{t:1,eb:25,rp:2},{t:10,eb:100,rp:5},{t:50,eb:400,rp:10}] },
    { id: "extractor_up",    cat: "economy",  stat: "extractorLevel", derived: true, title: "Upgrade the Extractor to level {n}", tiers: [{t:5,eb:50,rp:2},{t:25,eb:150,rp:5},{t:50,eb:500,rp:10}] },
    { id: "extractor_builds", cat: "economy", stat: "extractorUpgrades", title: "Install {n} Extractor upgrades", tiers: [{t:1,eb:25,rp:2},{t:10,eb:100,rp:5},{t:40,eb:400,rp:10}] },

    { id: "areas_surveyed",  cat: "explore",  stat: "areasSurveyed", title: "Survey {n} new areas",              tiers: [{t:5,eb:25,rp:2},{t:25,eb:100,rp:5},{t:100,eb:400,rp:10}] },
    { id: "stops_spun",      cat: "explore",  stat: "eldenStopsSpun", title: "Spin {n} Elden Stops",             tiers: [{t:5,eb:25,rp:2},{t:50,eb:100,rp:5},{t:250,eb:400,rp:10}] },
    { id: "beacons_planted", cat: "explore",  stat: "beaconsPlanted", title: "Plant {n} Elden Stop beacons",     tiers: [{t:1,eb:50,rp:2},{t:5,eb:150,rp:5},{t:25,eb:500,rp:10}] },
    { id: "gems_collected",  cat: "explore",  stat: "diamondsCollected", title: "Collect {n} diamonds",          tiers: [{t:10,eb:25,rp:2},{t:100,eb:100,rp:5},{t:1000,eb:400,rp:10}] },
    { id: "berries_found",   cat: "explore",  stat: "berriesFound",  title: "Find {n} berries",                  tiers: [{t:5,eb:25,rp:2},{t:25,eb:100,rp:5},{t:100,eb:400,rp:10}] },

    { id: "gifts_sent",      cat: "social",   stat: "giftsSent",     title: "Send {n} gifts to friends",         tiers: [{t:5,eb:5,rp:5},{t:50,eb:10,rp:5},{t:500,eb:100,rp:5}] },
    { id: "gifts_received",  cat: "social",   stat: "giftsReceived", title: "Receive {n} gifts",                 tiers: [{t:5,eb:25,rp:2},{t:50,eb:100,rp:5},{t:500,eb:400,rp:10}] },
    { id: "referrals_made",  cat: "social",   stat: "referralsMade", title: "Refer {n} new players",             tiers: [{t:1,eb:100,rp:5},{t:5,eb:250,rp:5},{t:25,eb:750,rp:10}] },
    { id: "friends_made",    cat: "social",   stat: "friendsMade", derived: true, title: "Make {n} friends",      tiers: [{t:1,eb:25,rp:2},{t:5,eb:100,rp:5},{t:25,eb:400,rp:10}] },
    { id: "chat_messages",   cat: "social",   stat: "chatMessages",  title: "Send {n} chat messages",            tiers: [{t:10,eb:25,rp:2},{t:100,eb:100,rp:5},{t:1000,eb:400,rp:10}] },

    { id: "citadels_taken",  cat: "combat",   stat: "citadelsTaken", title: "Capture {n} citadels",              tiers: [{t:1,eb:50,rp:2},{t:10,eb:150,rp:5},{t:50,eb:500,rp:10}] },
    { id: "defenders_recalled", cat: "combat", stat: "defendersRecalled", title: "Recall {n} citadel defenders", tiers: [{t:1,eb:25,rp:2},{t:10,eb:100,rp:5},{t:50,eb:400,rp:10}] },
    { id: "citadels_upgraded", cat: "combat", stat: "citadelsUpgraded", title: "Upgrade {n} citadels",          tiers: [{t:1,eb:50,rp:2},{t:5,eb:150,rp:5},{t:25,eb:500,rp:10}] },
    { id: "sieges_held",     cat: "combat",   stat: "citadelsDefended", title: "Defend {n} citadels",           tiers: [{t:1,eb:50,rp:2},{t:5,eb:150,rp:5},{t:25,eb:500,rp:10}] },
    { id: "spoils_banked",   cat: "combat",   stat: "spoilsBanked",  title: "Bank citadel spoils {n} times",     tiers: [{t:5,eb:25,rp:2},{t:25,eb:100,rp:5},{t:100,eb:400,rp:10}] },

    { id: "pet_fed",         cat: "mastery",  stat: "berriesFed",    title: "Feed Buddy {n} berries",            tiers: [{t:5,eb:25,rp:2},{t:50,eb:100,rp:5},{t:500,eb:400,rp:10}] },
    { id: "badges_earned",   cat: "mastery",  stat: "badgesEarned", derived: true, title: "Earn {n} badges",       tiers: [{t:10,eb:50,rp:2},{t:25,eb:150,rp:5},{t:50,eb:500,rp:10}] },
  ];

  // 33 tracks x 3 tiers = 99, plus one standalone "first step" = 100.
  const ALL = [];
  TRACKS.forEach((tr) => {
    tr.tiers.forEach((tier, i) => {
      ALL.push({
        key: `${tr.id}_t${i + 1}`,
        trackId: tr.id,
        cat: tr.cat,
        tier: i + 1,
        stat: tr.stat,
        derived: tr.derived === true,
        target: tier.t,
        title: tr.title.replace("{n}", String(tier.t)),
        eb: tier.eb,
        rp: tier.rp,
      });
    });
  });
  ALL.unshift({
    key: "first_step_t1", trackId: "first_step", cat: "mastery", tier: 1,
    stat: "daysPlayed", derived: false, target: 1,
    title: "Take your first step into the Realm", eb: 10, rp: 2,
  });

  const BY_KEY = new Map(ALL.map((a) => [a.key, a]));

  const el = (id) => document.getElementById(id);
  const toast = (msg, ms = 4000) => {
    if (typeof window !== "undefined" && typeof window.showToast === "function") window.showToast(msg, ms);
    else console.log("[Achievements]", msg);
  };

  // ---------- progress ----------

  function claims() {
    try { return Store.get()?.achievementsClaimed || {}; } catch (e) { return {}; }
  }

  function stats() {
    try { return Store.get()?.achievementStats || {}; } catch (e) { return {}; }
  }

  function statValue(def) {
    const state = (() => { try { return Store.get(); } catch (e) { return null; } })();
    if (!state) return 0;
    const s = stats();
    if (!def.derived) return Number(s[def.stat]) || 0;

    switch (def.stat) {
      case "plotsOwned":     return Object.keys(state.plots || {}).length;
      case "legendaryOwned":
      case "luckyOwned": {
        const want = def.stat === "legendaryOwned" ? "legendary" : "lucky";
        return Object.values(state.plots || {}).filter((p) => p && String(p.rarity) === want).length;
      }
      case "lifetimeRent":   return Number(state.lifetimeRent) || 0;
      case "totalDividends": return Number(state.totalDividends) || 0;
      case "extractorLevel": return Number(state.extractor && state.extractor.level) || 0;
      case "friendsMade":    return Number(state.friendsCount) || 0;
      case "badgesEarned":   return Object.keys(claims()).length;
      default: return 0;
    }
  }

  function isClaimed(key) { return Boolean(claims()[key]); }

  function claimable() {
    return ALL.filter((a) => !isClaimed(a.key) && statValue(a) >= a.target);
  }

  // ---------- badge art ----------

  function badgeMarkup(def, opts = {}) {
    const cat = CATEGORIES[def.cat] || CATEGORIES.mastery;
    const rim = TIER_RIMS[(def.tier - 1) % TIER_RIMS.length];
    const earned = opts.earned !== false;
    return `
      <div class="ach-badge ${earned ? "earned" : "locked"}" data-ach-key="${def.key}"
           style="--ach-color:${cat.color};--ach-rim:${rim}">
        <span class="ach-badge-glyph">${cat.glyph}</span>
        <span class="ach-badge-tier">${def.tier}</span>
      </div>`;
  }

  // ---------- achievements tab ----------

  function renderTab(container) {
    if (!container) return;
    const c = claims();
    const ready = claimable();

    const summary = `
      <div class="ach-summary">
        <span><strong>${Object.keys(c).length}</strong> / ${ALL.length} unlocked</span>
        <span class="ach-summary-hint">Badges you earn appear in your profile</span>
      </div>`;

    // Group by category so the list reads as sections rather than a wall.
    const byCat = {};
    ALL.forEach((a) => { (byCat[a.cat] = byCat[a.cat] || []).push(a); });

    const sections = Object.keys(byCat).map((catKey) => {
      const cat = CATEGORIES[catKey];
      const rows = byCat[catKey].map((a) => {
        const done = isClaimed(a.key);
        const prog = Math.min(statValue(a), a.target);
        const complete = prog >= a.target;
        const pct = Math.round((prog / a.target) * 100);
        const action = done
          ? `<div class="quest-check done" title="Unlocked">✓</div>`
          : complete
            ? `<button class="cal-claim-btn ach-claim-btn" data-ach-key="${a.key}">Claim</button>`
            : `<div class="quest-check">○</div>`;
        return `
          <div class="ach-row ${complete && !done ? "ready-claim" : ""} ${done ? "ach-done" : ""}">
            ${badgeMarkup(a, { earned: done || complete })}
            <div class="ach-body">
              <div class="ach-title">${a.title}</div>
              <div class="ach-reward">+${a.eb} EB${a.rp ? ` <span class="quest-rp">+${a.rp}RP</span>` : ""}</div>
              ${done ? "" : `
                <div class="quest-progress">
                  <div class="quest-progress-track"><div class="quest-progress-fill" style="width:${pct}%"></div></div>
                  <span class="quest-progress-label">${prog}/${a.target}</span>
                </div>`}
            </div>
            <div class="quest-action-slot">${action}</div>
          </div>`;
      }).join("");

      return `
        <div class="ach-cat">
          <div class="ach-cat-head" style="--ach-color:${cat.color}">
            <span class="ach-cat-glyph">${cat.glyph}</span>${cat.label}
          </div>
          ${rows}
        </div>`;
    }).join("");

    container.innerHTML = summary + sections;

    container.querySelectorAll(".ach-claim-btn").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        claim(btn.getAttribute("data-ach-key"));
      });
    });

    if (ready.length) {
      const head = container.querySelector(".ach-summary");
      if (head) {
        const n = document.createElement("span");
        n.className = "quest-rp";
        n.textContent = `${ready.length} ready to claim`;
        head.appendChild(n);
      }
    }
  }

  async function claim(key) {
    const def = BY_KEY.get(key);
    if (!def || isClaimed(key)) return;
    if (typeof ServerAntiCheat === "undefined" || !ServerAntiCheat.isReady()) {
      toast("⚠️ Server connection required.", 3500);
      return;
    }
    try {
      const fn = firebase.functions().httpsCallable("claimAchievement");
      const res = (await fn({ key })).data;
      if (!res?.ok) {
        if (res?.reason === "already_claimed") {
          // Someone/something else claimed it — refresh so the row settles.
          renderAll();
        } else if (res?.reason === "not_complete") {
          toast(`🔒 ${res.progress}/${res.target} — not complete yet.`, 3000);
        }
        return;
      }

      const state = Store.get();
      if (state) {
        state.achievementsClaimed = Object.assign({}, state.achievementsClaimed || {}, {
          [key]: { claimedAt: Date.now(), tier: def.tier, target: def.target },
        });
        state.eb = Math.max(0, Number(res.nextEb) || Number(state.eb) || 0);
        state.rewardPoints = Math.max(0, Number(res.nextRewardPoints) || Number(state.rewardPoints) || 0);
        Store.save && Store.save(false);
      }

      toast(`🏅 Achievement unlocked! ${def.title} · +${def.eb} EB${def.rp ? ` · +${def.rp}RP` : ""}`, 5000);
      renderAll();
    } catch (e) {
      console.warn("[Achievements] claim failed:", e);
      toast("⚠️ Could not claim that achievement.", 3500);
    }
  }

  // ---------- badges in the player profile ----------

  function renderBadges(container, isOtherPlayer) {
    if (!container) return;
    // Never show anyone else's badges — the collection is private and their
    // unlocks are not fetched either.
    if (isOtherPlayer) {
      container.innerHTML = "";
      container.classList.add("hidden");
      return;
    }
    container.classList.remove("hidden");

    const c = claims();
    const earned = ALL.filter((a) => isClaimed(a.key));
    const shown = earned.slice(-12).reverse(); // newest twelve

    container.innerHTML = `
      <div class="info-section-title">BADGES:</div>
      <div class="badge-strip">
        ${shown.length
          ? shown.map((a) => badgeMarkup(a, { earned: true })).join("")
          : `<div class="badge-empty">No badges yet — check the Achievements tab.</div>`}
      </div>
      <button class="badge-open-btn" id="badge-open-grid">
        ${earned.length ? `View all ${earned.length} badges` : `View all ${ALL.length} badges`}
      </button>`;

    el("badge-open-grid")?.addEventListener("click", openGrid);
  }

  // ---------- badge grid modal ----------

  function openGrid() {
    const modal = el("badge-grid-modal");
    if (!modal) return;
    renderGrid();
    modal.classList.remove("hidden");
  }

  function renderGrid(detailKey) {
    const grid = el("badge-grid-list");
    if (!grid) return;
    const c = claims();

    grid.innerHTML = ALL.map((a) => badgeMarkup(a, { earned: isClaimed(a.key) })).join("");

    grid.querySelectorAll(".ach-badge").forEach((node) => {
      node.addEventListener("click", () => {
        renderDetail(node.getAttribute("data-ach-key"));
      });
    });

    renderDetail(detailKey || ALL[0].key);
  }

  function renderDetail(key) {
    const box = el("badge-grid-detail");
    if (!box) return;
    const def = BY_KEY.get(key);
    if (!def) { box.innerHTML = ""; return; }
    const c = claims();
    const rec = c[def.key];
    const earned = Boolean(rec);
    const prog = Math.min(statValue(def), def.target);
    const cat = CATEGORIES[def.cat] || CATEGORIES.mastery;

    box.innerHTML = `
      <div class="badge-detail-top">
        ${badgeMarkup(def, { earned: earned || prog >= def.target })}
        <div>
          <div class="badge-detail-title">${def.title}</div>
          <div class="badge-detail-cat" style="color:${cat.color}">${cat.glyph} ${cat.label} · Tier ${def.tier}</div>
        </div>
      </div>
      <div class="badge-detail-req">
        <span class="badge-detail-label">Requirement</span>
        <span>${def.title}</span>
      </div>
      <div class="badge-detail-req">
        <span class="badge-detail-label">Progress</span>
        <span>${earned ? "Complete" : `${prog} / ${def.target}`}</span>
      </div>
      <div class="badge-detail-req">
        <span class="badge-detail-label">Reward</span>
        <span>+${def.eb} EB${def.rp ? ` · +${def.rp} RP` : ""}</span>
      </div>
      <div class="badge-detail-req">
        <span class="badge-detail-label">Unlocked</span>
        <span>${earned
          ? new Date(Number(rec.claimedAt) || 0).toLocaleString()
          : "Not yet unlocked"}</span>
      </div>`;
  }

  /**
   * Report a client-only action for achievement progress. The server never sees
   * these happen (gifts, feeding Buddy, surveys and chat are all direct
   * Firestore writes), so this is a best-effort report — the server clamps and
   * rate-limits it, and the RP caps bound the damage. Everything else is bumped
   * server-side and cannot be reported through here at all.
   */
  function record(kind, n) {
    if (typeof firebase === "undefined" || !firebase.functions) return;
    try {
      const fn = firebase.functions().httpsCallable("recordActivity");
      fn({ kind, n: n || 1 }).catch(() => {});
    } catch (e) { /* never let progress reporting break gameplay */ }
  }

  function renderAll() {
    const list = el("calendar-achievements-list");
    if (list) renderTab(list);
    const badges = el("info-badges-section");
    if (badges) {
      const modal = el("player-info-modal");
      const showingOther = modal ? Boolean(modal.dataset.otherPlayer === "true") : false;
      renderBadges(badges, showingOther);
    }
  }

  function init() {
    renderAll();
  }

  return { init, renderTab, renderBadges, renderGrid, openGrid, renderAll, record, ALL, CATEGORIES, BY_KEY };
})();

window.Achievements = Achievements;
console.log("[EldenEarth] Achievements module loaded —", Achievements.ALL.length, "milestones");
