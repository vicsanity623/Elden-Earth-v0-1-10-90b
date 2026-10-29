/* ==========================================================================
   Elden Earth — Buddy System
   The Pokemon-GO-style overworld layer for Gen-0 buddies:
     - the Buddy Bag (collection, active buddy, stats, progressive cosmetics)
     - wild buddy spawns driven by real walking distance
     - strict anti-cheat on spawn accrual (no ceiling-fan / no drive-by farming)
     - classic battle entry -> BuddyBattle
     - Feast vs Tame outcome handling
     - Trainer level (PlayerXP) integration

   Everything self-mounts: styles, modals and the HUD button are injected from
   here so no existing markup has to change.
   ========================================================================== */
const BuddySystem = (() => {
  "use strict";

  /* ------------------------------------------------------------ config */
  const METERS_PER_SPAWN = 152.4;      // 500 feet
  const MAX_DAILY_SPAWNS = 10;
  const MAX_ACTIVE_SPAWNS = 3;
  const SPAWN_TTL_MS = 8 * 60 * 1000;  // wild spawns despawn after 8 minutes
  const SPAWN_RENDER_RADIUS_M = 1400;

  // Anti-cheat: how "real" walking must look before it counts.
  const MIN_STEP_M = 8;                // ignore GPS jitter below this
  const MAX_STEP_M = 260;              // never credit a single hop above this
  const MIN_SPEED_MPS = 0.35;          // slower = standing still / drifting
  const MAX_SPEED_MPS = 12;            // faster = vehicle / teleport
  const REVISIT_RADIUS_M = 25;         // new ground only — kills fan loops
  const REVISIT_GRACE_MS = 45 * 1000;  // ignore points this recent when checking
  const REVISIT_HISTORY = 60;
  const CREDIT_WINDOW_MS = 60 * 1000;

  // ------------------------------------------------- Travel record reset --
  // "New ground only" is what stops a ceiling fan or a loop round the block,
  // but on its own it soft-locks anyone who walks the SAME route every day —
  // the trip home never counts, and the same safe path never counts again.
  //
  // Two resets fix that without opening the farm up:
  //
  //   TRIP_IDLE_MS     After this long without any credited movement the
  //                    player has clearly stopped and started a new outing,
  //                    so the "already walked" record is cleared. Walk to the
  //                    store, browse for 10 minutes, walk home -> BOTH legs
  //                    count. A fan or a walking loop never idles like this,
  //                    so neither can chain laps.
  //
  //   TRAVEL_RESET_MS  Hard backstop: the record is wiped on a timer no
  //                    matter what, so a determined loop-walker gets at most
  //                    one full pass per window instead of infinite passes.
  //
  // Both are bounded anyway by MAX_DAILY_SPAWNS.
  const TRIP_IDLE_MS = 8 * 60 * 1000;       // new outing after 8 min of stillness
  const TRAVEL_RESET_MS = 2 * 60 * 60 * 1000; // hard record reset every 2 hours
  const CREDIT_WINDOW_CAP_M = 250;     // hard cap on credited meters / minute
  const MAX_ACCURACY_M = 60;

  // ---------------------------------------------------------- Healing ----
  // Without this a buddy that loses a fight is saved at ~1 HP and every later
  // battle starts nearly dead. Three recovery paths keep it playable.
  const HEAL_BERRY_PCT = 0.30;         // 1 berry restores 30% of max HP
  const REGEN_PCT_PER_MIN = 0.05;      // passive: 5% of max HP per minute
  const POST_BATTLE_FLOOR_PCT = 0.30;  // never leave a fight below 30% HP
  const REGEN_TICK_MS = 15 * 1000;

  const STYLE_ID = "buddy-system-style";
  const HUD_ID = "buddy-hud-btn";
  const INMODAL_ID = "buddy-inmodal";
  const TARGET_PANEL = '#player-info-modal [data-pi-panel="profile"]';
  const BAG_ID = "buddy-bag-modal";
  const DETAIL_ID = "buddy-detail-modal";
  const ENCOUNTER_ID = "buddy-encounter-modal";
  const TRAINER_ID = "buddy-trainer-modal";
  const CUSTOMIZE_ID = "buddy-customize-modal";

  let mapInstance = null;
  let markers = {};        // spawnId -> mapboxgl.Marker
  let playerPos = null;    // { lat, lon }
  let detailPreview = null;
  let encounterPreview = null;
  let customizePreview = null;

  /* ============================================================= STATE */
  function ensureState() {
    const state = (typeof Store !== "undefined" && Store.get) ? Store.get() : null;
    if (!state) return null;

    if (!state.buddy || typeof state.buddy !== "object") {
      state.buddy = {
        bag: [],
        activeUid: null,
        spawns: [],
        distCredit: 0,
        spawnsToday: 0,
        spawnDate: null,
        lastPoint: null,
        recentPoints: [],
        creditWindowStart: 0,
        creditWindowMeters: 0,
        totalSpawns: 0,
        totalBattles: 0,
        totalWins: 0,
        totalTamed: 0,
        totalFeasted: 0,
        starterChosen: false,
        lastRegenAt: 0,
      };
    }

    const b = state.buddy;
    if (!Array.isArray(b.bag)) b.bag = [];
    if (!Array.isArray(b.spawns)) b.spawns = [];
    if (!Array.isArray(b.recentPoints)) b.recentPoints = [];
    if (typeof b.lastCreditAt !== "number") b.lastCreditAt = 0;
    if (typeof b.lastMovementAt !== "number") b.lastMovementAt = 0;
    if (typeof b.recordResetAt !== "number") b.recordResetAt = 0;
    if (typeof b.distCredit !== "number") b.distCredit = 0;
    if (typeof b.spawnsToday !== "number") b.spawnsToday = 0;
    if (typeof b.totalSpawns !== "number") b.totalSpawns = 0;
    if (typeof b.totalBattles !== "number") b.totalBattles = 0;
    if (typeof b.totalWins !== "number") b.totalWins = 0;
    if (typeof b.totalTamed !== "number") b.totalTamed = 0;
    if (typeof b.totalFeasted !== "number") b.totalFeasted = 0;

    // UTC day rollover for the daily spawn cap.
    const today = new Date().toISOString().slice(0, 10);
    if (b.spawnDate !== today) {
      b.spawnDate = today;
      b.spawnsToday = 0;
      b.creditWindowStart = 0;
      b.creditWindowMeters = 0;
      // New day = fresh travel record.
      b.recentPoints = [];
      b.recordResetAt = 0;
    }

    // Drop expired spawns on load.
    const now = Date.now();
    const before = b.spawns.length;
    b.spawns = b.spawns.filter(s => s && s.expiresAt > now);
    if (b.spawns.length !== before) {
      // markers are rebuilt on init anyway
    }

    return b;
  }

  function buddyState() {
    return ensureState() || {
      bag: [], activeUid: null, spawns: [], distCredit: 0, spawnsToday: 0,
      spawnDate: null, lastPoint: null, recentPoints: [],
      creditWindowStart: 0, creditWindowMeters: 0,
      totalSpawns: 0, totalBattles: 0, totalWins: 0, totalTamed: 0, totalFeasted: 0,
      starterChosen: false,
    };
  }

  let saveTimer = null;
  function persist() {
    if (typeof Store === "undefined" || !Store.save) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try { Store.save(false); } catch (e) {}
    }, 350);
  }

  /* ============================================================= GEO */
  function haversine(lat1, lon1, lat2, lon2) {
    const R = 6378137;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  /* ============================================== ANTI-CHEAT DISTANCE */
  /**
   * Feed every GPS fix in here. Returns { credited, reason } where `credited`
   * is the meters added toward the next wild spawn.
   *
   * Defences against phone-on-a-ceiling-fan / treadmill / fake-GPS farms:
   *   1. accuracy gate — mushy fixes never credit distance
   *   2. minimum step  — sub-8m wobble is drift, not walking
   *   3. speed window  — 0.35..12 m/s is human ground travel
   *   4. NEW GROUND    — a fix only counts if it is 25m clear of the last 25
   *                      credited points, so any loop (fan, treadmill, car
   *                      circling a block) stops crediting almost immediately
   *   5. per-minute cap — no burst can outrun 250 m/min of credit
   */
  function trackPosition(lat, lon, accuracy, timestamp) {
    const b = buddyState();
    const now = timestamp || Date.now();
    const out = { credited: 0, reason: "ok" };

    if (typeof accuracy === "number" && accuracy > MAX_ACCURACY_M) {
      out.reason = "low_accuracy";
      return out;
    }

    if (!b.lastPoint) {
      b.lastPoint = { lat, lon, t: now };
      persist();
      return out;
    }

    // ---- GAP RESYNC ------------------------------------------------------
    // A long pause (app backgrounded, phone in a pocket, standing at a shop)
    // leaves `lastPoint` stale. The next fix then has a huge dt, so its
    // implied speed reads as ~0.03 m/s and EVERY fix is rejected as too_slow —
    // which is exactly how a player walked to the store and back and earned
    // nothing. This must run BEFORE the speed gates or it never runs at all.
    const GAP_RESYNC_MS = 2 * 60 * 1000;
    if ((now - b.lastPoint.t) > GAP_RESYNC_MS) {
      b.lastPoint = { lat, lon, t: now };
    }

    // ---- TRAVEL RECORD RESETS -------------------------------------------
    // Expire the "already walked" record so a player who legitimately walks
    // the same route is not permanently locked out of earning spawns. Also
    // must run before the motion gates.
    //
    // 1. NEW OUTING: the player must have genuinely STOPPED — not merely
    //    stopped earning. Both "no credited distance" and "no real movement"
    //    have to be stale, otherwise someone walking a loop continuously would
    //    earn a reset every TRIP_IDLE_MS without ever pausing. Walking to the
    //    store, browsing for 8 minutes, and walking home counts BOTH legs;
    //    pacing the same block without stopping does not.
    // MAX, not MIN: the reset needs BOTH to be stale. With MIN a player who
    // keeps moving but stops earning would reset mid-walk and get free passes.
    const lastActiveAt = Math.max(b.lastCreditAt || 0, b.lastMovementAt || 0);
    if (lastActiveAt && (now - lastActiveAt) > TRIP_IDLE_MS) {
      if (b.recentPoints.length) b.recentPoints = [];
    }
    // 2. HARD WINDOW: wipe on a timer regardless. A loop-walker who never
    //    idles still only gets one pass per TRAVEL_RESET_MS.
    if (!b.recordResetAt) b.recordResetAt = now;
    if ((now - b.recordResetAt) > TRAVEL_RESET_MS) {
      b.recentPoints = [];
      b.recordResetAt = now;
    }

    const last = b.lastPoint;
    const dist = haversine(last.lat, last.lon, lat, lon);
    const dt = Math.max(0.5, (now - last.t) / 1000);

    if (dist < MIN_STEP_M) {
      out.reason = "jitter";
      return out;
    }
    if (dist > MAX_STEP_M) {
      // A huge jump is a teleport or a bad fix — resync the anchor, no credit.
      b.lastPoint = { lat, lon, t: now };
      out.reason = "teleport";
      persist();
      return out;
    }

    // This fix shows genuine travel (the step survived jitter + teleport
    // gates), so remember it for the "did the player actually stop?" test.
    b.lastMovementAt = now;

    const speed = dist / dt;
    if (speed < MIN_SPEED_MPS) {
      out.reason = "too_slow";
      return out;
    }
    if (speed > MAX_SPEED_MPS) {
      b.lastPoint = { lat, lon, t: now };
      out.reason = "too_fast";
      persist();
      return out;
    }

    // NEW GROUND check — the ceiling-fan killer.
    //
    // A fix only counts if it is REVISIT_RADIUS_M clear of every credited
    // point older than REVISIT_GRACE_MS. The grace window matters: while
    // walking straight you are always close to where you were a few seconds
    // ago, so only older history may condemn a point. A ceiling fan, a
    // treadmill or a car circling the block never leaves its own footprint,
    // so points from 45s+ ago are still right next to the current fix and
    // the credit stops dead after the first lap.
    const graceCutoff = now - REVISIT_GRACE_MS;
    for (let i = b.recentPoints.length - 1; i >= 0; i--) {
      const p = b.recentPoints[i];
      if (p.t > graceCutoff) continue;
      if (haversine(p.lat, p.lon, lat, lon) < REVISIT_RADIUS_M) {
        b.lastPoint = { lat, lon, t: now };
        out.reason = "revisit";
        persist();
        return out;
      }
    }

    // Per-minute credit cap.
    if (now - b.creditWindowStart > CREDIT_WINDOW_MS) {
      b.creditWindowStart = now;
      b.creditWindowMeters = 0;
    }
    const remaining = CREDIT_WINDOW_CAP_M - b.creditWindowMeters;
    if (remaining <= 0) {
      b.lastPoint = { lat, lon, t: now };
      out.reason = "window_cap";
      persist();
      return out;
    }

    const credited = Math.min(dist, remaining);
    b.creditWindowMeters += credited;
    b.distCredit += credited;
    b.lastCreditAt = now;
    out.credited = credited;

    // Record this as settled ground.
    b.recentPoints.push({ lat, lon, t: now });
    if (b.recentPoints.length > REVISIT_HISTORY) {
      b.recentPoints.splice(0, b.recentPoints.length - REVISIT_HISTORY);
    }
    b.lastPoint = { lat, lon, t: now };

    persist();

    // Enough ground covered and the daily cap not hit -> request a spawn.
    if (b.distCredit >= METERS_PER_SPAWN && b.spawnsToday < MAX_DAILY_SPAWNS) {
      b.distCredit -= METERS_PER_SPAWN;
      persist();
      setTimeout(() => requestWildSpawn(), 60);
    }

    return out;
  }

  /* ======================================================= WILD SPAWNS */
  // Wild level tracks the player's PROGRESSION: the stronger of their trainer
  // level and their best buddy, so wild fights stay competitive as they grow.
  function wildRefLevel() {
    const b = buddyState();
    const topBuddy = b.bag.reduce((m, x) => Math.max(m, x.level || 1), 1);
    const trainer = (typeof PlayerXP !== "undefined" && PlayerXP.getState)
      ? (PlayerXP.getState().level || 1) : 1;
    return Math.max(topBuddy, trainer);
  }

  function localRollSpawn() {
    const b = buddyState();
    const topLevel = wildRefLevel();
    const speciesId = BuddyData.rollSpecies();
    const sp = BuddyData.getSpecies(speciesId);
    const rarity = sp ? sp.rarity : "common";
    const level = BuddyEngine.rollWildLevel(topLevel, rarity);
    const inst = BuddyEngine.makeInstance(speciesId, level, { source: "wild" });
    return {
      id: BuddyEngine.newId("spawn"),
      speciesId,
      level: inst.level,
      ivs: inst.ivs,
      natureId: inst.natureId,
      hue: inst.hue,
      colorway: inst.colorway,
      rarity,
      source: "local",
    };
  }

  async function requestWildSpawn() {
    const b = buddyState();
    if (b.spawns.length >= MAX_ACTIVE_SPAWNS) return;
    if (b.spawnsToday >= MAX_DAILY_SPAWNS) return;
    if (!playerPos) return;

    let spawn = null;

    // Prefer the server roll (authoritative stats + daily cap enforcement).
    try {
      if (typeof firebase !== "undefined" && firebase.functions) {
        const fn = firebase.functions().httpsCallable("buddyClaimSpawn");
        const res = await fn({
          lat: playerPos.lat,
          lon: playerPos.lon,
          clientTs: Date.now(),
        });
        if (res.data && res.data.ok && res.data.spawn) {
          spawn = res.data.spawn;
          spawn.source = "server";
          if (typeof res.data.spawnsToday === "number") b.spawnsToday = res.data.spawnsToday;
        } else if (res.data && res.data.reason === "daily_cap") {
          b.spawnsToday = MAX_DAILY_SPAWNS;
          persist();
          return;
        }
      }
    } catch (e) {
      console.warn("[Buddy] server spawn claim failed, using local roll:", e.message);
    }

    if (!spawn) spawn = localRollSpawn();

    // Place the spawn a short walk from the player so it is discoverable but
    // never directly on top of them.
    const angle = Math.random() * Math.PI * 2;
    const offsetM = 22 + Math.random() * 48;
    const dLat = (offsetM * Math.cos(angle)) / 111320;
    const dLon = (offsetM * Math.sin(angle)) / (111320 * Math.cos(playerPos.lat * Math.PI / 180));

    const record = {
      id: spawn.id,
      speciesId: spawn.speciesId,
      level: spawn.level,
      ivs: spawn.ivs,
      natureId: spawn.natureId,
      hue: spawn.hue,
      colorway: spawn.colorway,
      rarity: spawn.rarity || (BuddyData.getSpecies(spawn.speciesId) || {}).rarity,
      lat: playerPos.lat + dLat,
      lon: playerPos.lon + dLon,
      createdAt: Date.now(),
      expiresAt: Date.now() + SPAWN_TTL_MS,
      source: spawn.source || "local",
    };

    b.spawns.push(record);
    b.spawnsToday += 1;
    b.totalSpawns += 1;
    persist();

    addSpawnMarker(record);
    toast(`✨ A wild ${BuddyData.getSpecies(record.speciesId)?.name || "buddy"} appeared nearby!`);

    if (typeof PlayerXP !== "undefined") {
      PlayerXP.addXP(PlayerXP.XP.spawnSeen, "wild_spawn");
    }
    renderHudBadge();
  }

  /* ============================================================ MARKERS */
  function markerElement(spawn) {
    const sp = BuddyData.getSpecies(spawn.speciesId) || {};
    const type = BuddyData.getType((sp.types && sp.types[0]) || "metal") || { color: "#94a3b8", icon: "🐾" };
    const hueDeg = Math.round((((spawn.hue % 1) + 1) % 1) * 360);
    const rar = BuddyData.getRarity(spawn.rarity || (sp.rarity || "common"));

    const el = document.createElement("div");
    el.className = "buddy-spawn-marker";
    el.innerHTML = `
      <div class="bsm-glow" style="filter:hue-rotate(${hueDeg}deg)"></div>
      <div class="bsm-orb" style="background:radial-gradient(circle at 32% 28%, rgba(255,255,255,.9), ${type.color} 46%, rgba(10,14,26,.92)); filter:hue-rotate(${hueDeg}deg)"></div>
      <div class="bsm-ring" style="border-color:${rar.color}"></div>
      <div class="bsm-icon" style="filter:hue-rotate(${hueDeg}deg)">${type.icon}</div>
      <div class="bsm-label" style="border-color:${rar.color}40">
        ${sp.name || "?"} · Lv.${spawn.level}
      </div>
    `;
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      openEncounter(spawn.id);
    });
    return el;
  }

  function addSpawnMarker(spawn) {
    if (!mapInstance || typeof mapboxgl === "undefined") return;
    if (markers[spawn.id]) return;
    try {
      const marker = new mapboxgl.Marker({
        element: markerElement(spawn),
        anchor: "center",
        pitchAlignment: "map",
        rotationAlignment: "map",
      }).setLngLat([spawn.lon, spawn.lat]).addTo(mapInstance);
      markers[spawn.id] = marker;
    } catch (e) {
      console.warn("[Buddy] marker add failed:", e.message);
    }
  }

  function removeSpawnMarker(spawnId) {
    const m = markers[spawnId];
    if (m) {
      try { m.remove(); } catch (e) {}
      delete markers[spawnId];
    }
  }

  function rebuildMarkers() {
    const b = buddyState();
    const now = Date.now();
    // Clear stale.
    Object.keys(markers).forEach(id => {
      if (!b.spawns.find(s => s.id === id)) removeSpawnMarker(id);
    });
    b.spawns.forEach(s => {
      if (s.expiresAt > now) addSpawnMarker(s);
      else removeSpawnMarker(s.id);
    });
  }

  function cullMarkersByDistance() {
    if (!playerPos) return;
    const b = buddyState();
    b.spawns.forEach(s => {
      const d = haversine(playerPos.lat, playerPos.lon, s.lat, s.lon);
      const m = markers[s.id];
      if (d > SPAWN_RENDER_RADIUS_M) {
        if (m) removeSpawnMarker(s.id);
      } else if (!m && s.expiresAt > Date.now()) {
        addSpawnMarker(s);
      }
    });
  }

  /* ============================================================== CSS */
  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const css = `
/* Buddy block lives inside the Player Info modal (Profile tab) under the
   trainer block — it is the entry point to the Buddy Bag. */
#${INMODAL_ID}{
  margin:10px 0 4px; padding:12px 13px; border-radius:15px;
  background:linear-gradient(140deg, rgba(139,92,246,.16), rgba(14,165,233,.14));
  border:1px solid rgba(139,92,246,.32);
}
#${INMODAL_ID} .bdim-row{display:flex; align-items:center; gap:11px;}
#${INMODAL_ID} .bdim-icon{
  flex:0 0 auto; width:44px; height:44px; border-radius:13px;
  background:linear-gradient(150deg,#6d28d9,#0ea5e9); color:#fff;
  display:flex; align-items:center; justify-content:center; font-size:20px;
}
#${INMODAL_ID} .bdim-meta{flex:1 1 auto; min-width:0;}
#${INMODAL_ID} .bdim-title{
  font-size:12.5px; font-weight:800; color:#eaf1ff; letter-spacing:.2px;
  white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
}
#${INMODAL_ID} .bdim-sub{
  font-size:10.5px; color:#a9bede; margin-top:3px;
  white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
}
#${INMODAL_ID} .bdim-btn{
  flex:0 0 auto; padding:9px 13px; border-radius:11px; cursor:pointer;
  font-family:inherit; font-size:11px; font-weight:800; letter-spacing:.3px;
  background:linear-gradient(135deg,#2b6cf0,#7c3aed); border-color:transparent;
  color:#fff;
}
#${INMODAL_ID} .bdim-btn:active{transform:scale(.96);}
#${INMODAL_ID} .bdim-alert{
  display:inline-flex; align-items:center; gap:4px; margin-left:6px;
  padding:1px 7px; border-radius:99px; font-size:9px; font-weight:800;
  background:rgba(244,63,94,.9); color:#fff; letter-spacing:.4px;
}

/* ---- map spawn markers ---- */
.buddy-spawn-marker{
  position:relative; width:58px; height:58px; cursor:pointer;
  display:flex; align-items:center; justify-content:center;
}
.buddy-spawn-marker .bsm-orb{
  width:40px; height:40px; border-radius:50%;
  border:2px solid rgba(255,255,255,.75);
  box-shadow:0 6px 18px rgba(0,0,0,.5), inset 0 -6px 12px rgba(0,0,0,.35);
  animation:bsmFloat 2.6s ease-in-out infinite;
}
.buddy-spawn-marker .bsm-glow{
  position:absolute; width:74px; height:74px; border-radius:50%;
  background:radial-gradient(circle, rgba(160,120,255,.55), transparent 66%);
  animation:bsmGlow 2.6s ease-in-out infinite; pointer-events:none;
}
.buddy-spawn-marker .bsm-ring{
  position:absolute; width:52px; height:52px; border-radius:50%;
  border:2px dashed rgba(255,255,255,.55); animation:bsmSpin 9s linear infinite;
}
.buddy-spawn-marker .bsm-icon{
  position:absolute; font-size:15px; pointer-events:none;
  animation:bsmFloat 2.6s ease-in-out infinite;
}
.buddy-spawn-marker .bsm-label{
  position:absolute; top:46px; white-space:nowrap;
  font-size:9.5px; font-weight:800; letter-spacing:.3px; color:#eaf1ff;
  background:rgba(10,14,26,.9); border:1px solid rgba(160,190,255,.3);
  padding:2px 7px; border-radius:99px;
}
@keyframes bsmFloat{0%,100%{transform:translateY(0);} 50%{transform:translateY(-6px);}}
@keyframes bsmGlow{0%,100%{opacity:.45; transform:scale(1);} 50%{opacity:.85; transform:scale(1.12);}}
@keyframes bsmSpin{to{transform:rotate(360deg);}}

/* ---- shared modal bits (namespaced so we never collide) ---- */
.bd-modal .bd-card{
  width:100%; max-width:430px; max-height:88vh; overflow-y:auto;
  padding:18px 16px calc(18px + env(safe-area-inset-bottom,0px));
  border-radius:18px; position:relative;
  background:linear-gradient(165deg,rgba(28,36,64,.98),rgba(16,20,36,.99));
  border:1px solid rgba(150,180,240,.26);
  box-shadow:0 24px 70px rgba(0,0,0,.6);
  animation:bdPop .28s cubic-bezier(.22,1,.36,1);
}
@keyframes bdPop{from{opacity:0; transform:translateY(16px) scale(.97);} to{opacity:1; transform:none;}}
.bd-modal h2{
  margin:0 0 4px; font-size:20px; font-weight:900; letter-spacing:.2px; color:#fff;
}
.bd-modal .bd-sub{margin:0 0 14px; font-size:12px; color:#a9bede; line-height:1.55;}
.bd-close{
  position:absolute; top:11px; right:11px; width:32px; height:32px; border-radius:10px;
  background:rgba(255,255,255,.08); border:1px solid rgba(150,180,240,.2);
  color:#dbe6fb; font-size:15px; cursor:pointer; font-family:inherit;
}
.bd-close:active{transform:scale(.94);}

.bd-preview{
  width:100%; height:190px; border-radius:16px; overflow:hidden;
  background:radial-gradient(circle at 50% 30%, rgba(120,90,220,.18), rgba(10,14,26,.55));
  border:1px solid rgba(150,180,240,.18); margin-bottom:12px;
}
.bd-grid{display:grid; grid-template-columns:1fr 1fr; gap:8px; margin:12px 0;}
.bd-stat{
  padding:10px 11px; border-radius:12px; background:rgba(255,255,255,.055);
  border:1px solid rgba(150,180,240,.14);
}
.bd-stat .k{font-size:9.5px; letter-spacing:1.1px; text-transform:uppercase; color:#7f97ba;}
.bd-stat .v{font-size:17px; font-weight:800; margin-top:2px; color:#fff; font-variant-numeric:tabular-nums;}
.bd-row{display:flex; gap:8px; margin:8px 0;}
.bd-btn{
  flex:1 1 auto; padding:12px 10px; border-radius:12px; cursor:pointer;
  font-family:inherit; font-size:12.5px; font-weight:800; letter-spacing:.3px;
  border:1px solid rgba(150,180,240,.22); background:rgba(32,42,70,.9); color:#eaf1ff;
  transition:transform .12s ease;
}
.bd-btn:active{transform:scale(.97);}
.bd-btn.primary{background:linear-gradient(135deg,#2b6cf0,#7c3aed); border-color:transparent;}
.bd-btn.gold{background:linear-gradient(135deg,#b45309,#d97706); border-color:transparent;}
.bd-btn.danger{background:rgba(190,50,60,.28); border-color:rgba(248,113,113,.35);}
.bd-btn:disabled{opacity:.45; cursor:not-allowed;}

.bd-progress{
  height:9px; border-radius:99px; background:rgba(255,255,255,.12); overflow:hidden;
}
.bd-progress > i{
  display:block; height:100%; border-radius:99px;
  background:linear-gradient(90deg,#38bdf8,#818cf8,#c084fc);
  transition:width .4s ease;
}

.bd-chip{
  display:inline-flex; align-items:center; gap:4px;
  font-size:10.5px; padding:4px 9px; border-radius:99px; font-weight:700;
  color:#0b1020; letter-spacing:.3px;
}
.bd-tag{
  display:inline-block; font-size:10px; padding:3px 9px; border-radius:99px;
  background:rgba(255,255,255,.1); color:#dbe6fb; border:1px solid rgba(150,180,240,.2);
  margin:0 5px 5px 0; letter-spacing:.4px;
}

/* ---- buddy bag list ---- */
.bd-bag-list{
  display:grid; grid-template-columns:repeat(auto-fill,minmax(94px,1fr));
  gap:9px; margin:10px 0 4px;
}
.bd-bag-cell{
  position:relative; padding:9px 7px; border-radius:14px; cursor:pointer;
  background:rgba(255,255,255,.055); border:1px solid rgba(150,180,240,.16);
  text-align:center; transition:transform .12s ease, border-color .18s ease;
}
.bd-bag-cell:active{transform:scale(.96);}
.bd-bag-cell.active{
  border-color:rgba(139,92,246,.85);
  box-shadow:0 0 0 1px rgba(139,92,246,.4), 0 8px 22px rgba(109,40,217,.28);
}
.bd-bag-cell .bd-orb{
  width:46px; height:46px; border-radius:50%; margin:0 auto 6px;
  border:2px solid rgba(255,255,255,.55);
  position:relative; overflow:hidden;
}
/* Real 3D render of the buddy — replaces the placeholder gradient orb once
   the thumbnail has been generated, so the grid matches the map + detail. */
.bd-bag-cell .bd-orb .bd-orb-img{
  position:absolute; inset:0; width:100%; height:100%;
  object-fit:cover; opacity:0; transition:opacity .25s ease;
}
.bd-bag-cell .bd-orb.bd-orb-3d{ background:rgba(12,18,32,.85) !important; filter:none !important; }
.bd-bag-cell .bd-orb.bd-orb-3d .bd-orb-img{ opacity:1; }
.bd-bag-cell .bd-nm{
  font-size:10.5px; font-weight:800; color:#eaf1ff;
  white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
}
.bd-bag-cell .bd-lv{font-size:9px; color:#9db8dd; margin-top:1px;}
.bd-bag-cell .bd-act{
  position:absolute; top:5px; right:5px; font-size:9px; padding:1px 6px;
  border-radius:99px; background:#7c3aed; color:#fff; font-weight:800;
}

/* ---- encounter modal ---- */
.bd-vs{
  display:flex; align-items:center; justify-content:center; gap:10px;
  margin:12px 0; font-size:12px; color:#9db8dd;
}
.bd-vs .line{flex:1 1 auto; height:1px; background:rgba(150,180,240,.22);}
.bd-vs .vs{
  font-size:15px; font-weight:900; letter-spacing:2px; color:#c4b5fd;
}

/* ---- customization ---- */
.bd-cos-list{display:flex; flex-direction:column; gap:7px; margin:10px 0;}
.bd-cos-item{
  display:flex; align-items:center; gap:10px; padding:10px 11px; border-radius:12px;
  background:rgba(255,255,255,.05); border:1px solid rgba(150,180,240,.14);
}
.bd-cos-item.locked{opacity:.42;}
.bd-cos-item .ci-icon{
  width:34px; height:34px; border-radius:10px; flex:0 0 auto;
  display:flex; align-items:center; justify-content:center; font-size:16px;
  background:rgba(139,92,246,.2);
}
.bd-cos-item .ci-body{flex:1 1 auto; min-width:0;}
.bd-cos-item .ci-name{font-size:12px; font-weight:800; color:#eaf1ff;}
.bd-cos-item .ci-desc{font-size:10px; color:#9db8dd; margin-top:2px; line-height:1.45;}
.bd-cos-item .ci-btn{
  flex:0 0 auto; padding:7px 11px; border-radius:9px; cursor:pointer;
  font-family:inherit; font-size:10.5px; font-weight:800;
  border:1px solid rgba(150,180,240,.22); background:rgba(32,42,70,.9); color:#eaf1ff;
}
.bd-cos-item .ci-btn.on{background:linear-gradient(135deg,#2b6cf0,#7c3aed); border-color:transparent;}

/* ---- toast ---- */
.bd-toast{
  position:fixed; left:50%; top:16%; transform:translateX(-50%);
  z-index:4200; padding:11px 18px; border-radius:13px;
  background:rgba(18,24,42,.95); border:1px solid rgba(150,180,240,.3);
  color:#eaf1ff; font-size:12.5px; font-weight:700; letter-spacing:.2px;
  box-shadow:0 16px 44px rgba(0,0,0,.5); pointer-events:none;
  animation:bdToast 2.8s ease forwards;
}
@keyframes bdToast{
  0%{opacity:0; transform:translate(-50%,-10px);}
  12%{opacity:1; transform:translate(-50%,0);}
  80%{opacity:1;}
  100%{opacity:0; transform:translate(-50%,-8px);}
}
.bd-hp-wrap{
  padding:11px 12px; border-radius:13px;
  background:rgba(255,255,255,.05); border:1px solid rgba(150,180,240,.16);
}
.bd-hp-row{display:flex; align-items:center; gap:9px;}
.bd-hp-bar{flex:1 1 auto; height:11px;}
.bd-hp-bar > i{transition:width .4s ease;}
.bd-hp-text{
  flex:0 0 auto; font-size:11.5px; font-weight:800; color:#eaf1ff;
  font-variant-numeric:tabular-nums;
}
.bd-hp-note{font-size:10px; color:#8fa6c4; margin-top:7px; line-height:1.5;}
.bd-hp-note.bad{color:#fca5a5; font-weight:700;}
.bd-hp-note.good{color:#86efac;}
/* per-cell HP strip in the Buddy Bag grid */
.bd-cell-hp{
  height:4px; border-radius:99px; background:rgba(255,255,255,.14);
  overflow:hidden; margin-top:5px;
}
.bd-cell-hp > i{display:block; height:100%; border-radius:99px;}
.bd-reward-line{
  display:flex; align-items:center; gap:8px; padding:5px 0;
  font-size:12px; color:#e2ebfa;
}
.bd-reward-badge{
  flex:0 0 auto; font-size:8.5px; font-weight:900; letter-spacing:.8px;
  padding:3px 7px; border-radius:99px; color:#0b1020;
  background:linear-gradient(120deg,#7dd3fc,#c4b5fd);
}
.bd-empty{
  padding:26px 14px; text-align:center; color:#8aa0bd; font-size:12.5px; line-height:1.7;
}
`;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = css;
    document.head.appendChild(style);
  }

  function toast(message) {
    try {
      const t = document.createElement("div");
      t.className = "bd-toast";
      t.textContent = message;
      document.body.appendChild(t);
      setTimeout(() => { try { t.remove(); } catch (e) {} }, 3000);
    } catch (e) {}
  }

  /* ========================================================== MODALS */
  function openModal(id) {
    if (typeof window !== "undefined" && typeof window.openModal === "function") {
      window.openModal(id);
    } else {
      const m = document.getElementById(id);
      if (m) m.classList.remove("hidden");
    }
  }

  function closeModal(id) {
    if (typeof window !== "undefined" && typeof window.closeModal === "function") {
      window.closeModal(id);
    } else {
      const m = document.getElementById(id);
      if (m) m.classList.add("hidden");
    }
  }

  // Always re-renders the card body. Returning a stale shell would leave the
  // previous list items in place and every re-open would append duplicates.
  function buildModal(id, inner) {
    let m = document.getElementById(id);
    if (!m) {
      m = document.createElement("div");
      m.id = id;
      m.className = "modal hidden bd-modal";
      // Backdrop dismiss. Bound once to the shell so a body re-render never
      // stacks a second listener on the same element.
      m.addEventListener("click", (e) => {
        if (e.target === m) closeModal(id);
      });
      document.body.appendChild(m);
    }
    m.innerHTML = `<div class="bd-card">${inner}</div>`;
    return m;
  }

  function wireClose(id) {
    const btn = document.querySelector(`#${id} .bd-close`);
    if (btn) btn.addEventListener("click", () => closeModal(id));
  }

  /* ------------------------------------------------------ starter pick */
  let starterWaitMs = 0;
  function maybeForceStarter() {
    const b = buddyState();
    if (b.starterChosen && b.bag.length > 0) return true;

    // Never offer a starter while the cloud save is still in flight. A fresh
    // tab would otherwise hand out a SECOND starter before the first one
    // arrives, and the player ends up with two buddies.
    // Bail out after STARTER_GRACE_MS so offline/local play is never blocked.
    const STARTER_GRACE_MS = 12000;
    let synced = true;
    try {
      if (typeof Store !== "undefined" && typeof Store.isCloudSyncComplete === "function") {
        synced = Store.isCloudSyncComplete();
      }
    } catch (e) {}
    if (!synced) {
      starterWaitMs += 400;
      if (starterWaitMs < STARTER_GRACE_MS) {
        toast("Loading your buddies…");
        return false;
      }
    }
    openStarterPicker();
    return false;
  }

  function openStarterPicker() {
    injectStyle();
    const starters = ["emberling", "aqualit", "voltkit", "terrapod", "wispurr"];
    buildModal("buddy-starter-modal", `
      <h2>Choose your Starter Buddy</h2>
      <p class="bd-sub">
        Every journey across Elden Earth begins with a companion. Pick one of
        the Gen-0 starters — you can find all 28 species out in the wild.
      </p>
      <div class="bd-bag-list" id="bd-starter-list"></div>
      <div class="bd-empty">You can change your active buddy any time from the Buddy Bag.</div>
    `);

    const list = document.getElementById("bd-starter-list");
    starters.forEach(id => {
      const sp = BuddyData.getSpecies(id);
      if (!sp) return;
      const type = BuddyData.getType(sp.types[0]) || { color: "#94a3b8", icon: "🐾" };
      const cell = document.createElement("div");
      cell.className = "bd-bag-cell";
      cell.innerHTML = `
        <div class="bd-orb" style="background:radial-gradient(circle at 32% 28%, rgba(255,255,255,.9), ${type.color} 48%, rgba(10,14,26,.92))"></div>
        <div class="bd-nm">${sp.name}</div>
        <div class="bd-lv">${type.icon} ${sp.types.map(t => (BuddyData.getType(t) || {}).name).join(" / ")}</div>
      `;
      cell.addEventListener("click", () => claimStarter(id));
      list.appendChild(cell);
    });

    openModal("buddy-starter-modal");
  }

  function claimStarter(speciesId) {
    const b = buddyState();
    const inst = BuddyEngine.makeInstance(speciesId, 5, { source: "starter" });
    b.bag.push(inst);
    b.activeUid = inst.uid;
    b.starterChosen = true;
    persist();

    closeModal("buddy-starter-modal");
    const m = document.getElementById("buddy-starter-modal");
    if (m) m.remove();

    toast(`🎉 ${inst.nickname} joined you!`);
    if (typeof PlayerXP !== "undefined") PlayerXP.addXP(PlayerXP.XP.tame, "starter");
    renderHudBadge();
    syncCompanion();
  }

  /* --------------------------------------------------------- Buddy Bag */
  function openBag() {
    injectStyle();
    const b = buddyState();
    buildModal(BAG_ID, `
      <button class="bd-close">✕</button>
      <h2>🎒 Buddy Bag</h2>
      <p class="bd-sub">
        ${b.bag.length} / 30 buddies collected &middot; ${b.totalTamed} tamed &middot;
        ${b.totalFeasted} feasted &middot; ${b.totalSpawns} wild spawns seen
      </p>
      <div class="bd-bag-list" id="bd-bag-list"></div>
      <div class="bd-row">
        <button class="bd-btn" id="bd-bag-trainer">🏆 Trainer</button>
        <button class="bd-btn" id="bd-bag-customize">✨ Customize</button>
      </div>
      <div class="bd-empty" id="bd-bag-empty" style="display:${b.bag.length ? "none" : "block"}">
        No buddies yet. Walk around the map to find wild buddies, then battle
        and tame them.
      </div>
    `);
    wireClose(BAG_ID);

    const list = document.getElementById("bd-bag-list");
    b.bag.forEach(inst => {
      const sp = BuddyData.getSpecies(inst.speciesId) || {};
      const type = BuddyData.getType((sp.types && sp.types[0]) || "metal") || { color: "#94a3b8" };
      const hueDeg = Math.round((((inst.hue % 1) + 1) % 1) * 360);
      const cell = document.createElement("div");
      cell.className = "bd-bag-cell" + (inst.uid === b.activeUid ? " active" : "");
      cell.innerHTML = `
        ${inst.uid === b.activeUid ? '<div class="bd-act">ACTIVE</div>' : ""}
        <div class="bd-orb" style="background:radial-gradient(circle at 32% 28%, rgba(255,255,255,.9), ${type.color} 48%, rgba(10,14,26,.92)); filter:hue-rotate(${hueDeg}deg)">
          <img class="bd-orb-img" alt="" />
        </div>
        <div class="bd-nm">${inst.nickname}</div>
        <div class="bd-lv">Lv.${inst.level} · ${inst.colorway}</div>
        <div class="bd-cell-hp"><i style="width:${buddyHp(inst).pct}%; background:${hpColor(buddyHp(inst).pct)}"></i></div>
      `;
      cell.addEventListener("click", () => openDetail(inst.uid));
      list.appendChild(cell);

      // Swap the placeholder orb for a real render of this buddy so the grid
      // shows the same creature the map companion and detail screen show.
      const orb = cell.querySelector(".bd-orb");
      const img = cell.querySelector(".bd-orb-img");
      BuddyPreview.thumbnail(inst, 132, (url) => {
        if (!url || !img || !img.isConnected) return;
        img.src = url;
        orb.classList.add("bd-orb-3d");
      });
    });

    document.getElementById("bd-bag-trainer").addEventListener("click", () => {
      closeModal(BAG_ID);
      openTrainerModal();
    });
    document.getElementById("bd-bag-customize").addEventListener("click", () => {
      const active = activeBuddy();
      if (!active) { toast("Choose a buddy first"); return; }
      closeModal(BAG_ID);
      openCustomizeModal(active.uid);
    });

    openModal(BAG_ID);
  }

  /* ------------------------------------------------------- Buddy detail */
  function openDetail(uid) {
    const b = buddyState();
    const inst = b.bag.find(x => x.uid === uid);
    if (!inst) return;

    injectStyle();
    const sp = BuddyData.getSpecies(inst.speciesId) || {};
    const nature = BuddyData.getNature(inst.natureId);
    const pct = BuddyEngine.ivPercent(inst.ivs);
    const grade = BuddyEngine.ivGrade(pct);
    const xp = BuddyEngine.xpProgress(inst);
    const hp = buddyHp(inst);
    const isDefender = (typeof Arena !== "undefined" && Arena.getState)
      ? ((Arena.getState() && Arena.getState().me && Arena.getState().me.defenderBuddyId) === inst.uid)
      : false;

    buildModal(DETAIL_ID, `
      <button class="bd-close">✕</button>
      <h2>${inst.nickname}</h2>
      <p class="bd-sub">
        ${sp.name || inst.speciesId} &middot; ${(sp.types || []).map(t => (BuddyData.getType(t) || {}).icon + " " + (BuddyData.getType(t) || {}).name).join(" / ")}
      </p>

      <div class="bd-preview" id="bd-detail-preview"></div>

      <div style="margin:2px 0 10px">
        <span class="bd-tag">${inst.colorway} hue</span>
        <span class="bd-tag">${nature.name} nature</span>
        <span class="bd-tag">${(sp.rarity || "common")} rarity</span>
        <span class="bd-tag">Grade ${grade.letter} · ${pct}% IV</span>
      </div>

      <div style="font-size:10px; letter-spacing:1.2px; text-transform:uppercase; color:#7f97ba; margin:12px 0 5px">
        Health
      </div>
      <div class="bd-hp-wrap">
        <div class="bd-hp-row">
          <div class="bd-progress bd-hp-bar"><i class="bd-hp-fill" style="width:${hp.pct}%; background:${hpColor(hp.pct)}"></i></div>
          <div class="bd-hp-text">${hp.hp} / ${hp.max}</div>
        </div>
        ${hp.fainted
          ? `<div class="bd-hp-note bad">Fainted — heal to battle again.</div>`
          : (hp.pct < 100 ? "" : `<div class="bd-hp-note good">Fully healed.</div>`)}
        <div class="bd-row" style="margin-top:8px">
          <button class="bd-btn gold" id="bd-detail-heal" ${hp.pct >= 100 ? "disabled" : ""}>
            🍓 Heal with Berries
          </button>
        </div>
        <div class="bd-hp-note">Berries heal 30% each · HP also recovers over time</div>
      </div>

      <div class="bd-grid">
        <div class="bd-stat"><div class="k">Level</div><div class="v">${inst.level}</div></div>
        <div class="bd-stat"><div class="k">Battles Won</div><div class="v">${inst.battlesWon || 0}</div></div>
        <div class="bd-stat"><div class="k">Max HP</div><div class="v">${inst.stats.hp}</div></div>
        <div class="bd-stat"><div class="k">Attack</div><div class="v">${inst.stats.atk}</div></div>
        <div class="bd-stat"><div class="k">Defense</div><div class="v">${inst.stats.def}</div></div>
        <div class="bd-stat"><div class="k">Speed</div><div class="v">${inst.stats.spd}</div></div>
      </div>

      <div style="font-size:10px; letter-spacing:1.2px; text-transform:uppercase; color:#7f97ba; margin:6px 0 5px">
        Experience ${xp.maxed ? "· MAX" : `· ${xp.current} / ${xp.need}`}
      </div>
      <div class="bd-progress"><i style="width:${xp.maxed ? 100 : xp.pct}%"></i></div>

      <div style="font-size:10px; letter-spacing:1.2px; text-transform:uppercase; color:#7f97ba; margin:14px 0 5px">
        Individual Values
      </div>
      ${ivBar("HP", inst.ivs.hp)}
      ${ivBar("ATK", inst.ivs.atk)}
      ${ivBar("DEF", inst.ivs.def)}
      ${ivBar("SPD", inst.ivs.spd)}

      <div style="font-size:10px; letter-spacing:1.2px; text-transform:uppercase; color:#7f97ba; margin:14px 0 5px">
        Moves
      </div>
      <div>
        ${inst.moves.map(id => {
          const mv = BuddyData.getMove(id);
          const t = mv ? BuddyData.getType(mv.type) : null;
          return `<span class="bd-chip" style="background:${t ? t.color : "#94a3b8"}">${mv ? mv.name : id}</span>`;
        }).join(" ")}
      </div>

      <div class="bd-row" style="margin-top:16px">
        <button class="bd-btn primary" id="bd-detail-active">
          ${inst.uid === b.activeUid ? "✓ Currently Active" : "Set as Active"}
        </button>
        <button class="bd-btn" id="bd-detail-rename">Rename</button>
      </div>
      <div class="bd-row">
        <button class="bd-btn" id="bd-detail-cos">✨ Customize</button>
      </div>
      <div class="bd-row">
        <button class="bd-btn gold" id="bd-detail-defender">
          🛡️ ${isDefender ? "Defense Buddy Set" : "Set as Defense Buddy"}
        </button>
      </div>
      <div class="bd-hp-note">
        Your Defense Buddy is what other players fight in the PvP Arena.
        Its stats are snapshotted the moment you set it.
      </div>
    `);
    wireClose(DETAIL_ID);

    try {
      const box = document.getElementById("bd-detail-preview");
      if (box) {
        if (detailPreview) { try { detailPreview.dispose(); } catch (e) {} }
        detailPreview = BuddyPreview.create(box, inst, { animate: true, spinRate: 0.14, anim: "idle" });
      }
    } catch (e) {}

    document.getElementById("bd-detail-active").addEventListener("click", () => {
      b.activeUid = inst.uid;
      persist();
      toast(`${inst.nickname} is now your active buddy`);
      syncCompanion();
      openDetail(uid);
    });

    document.getElementById("bd-detail-rename").addEventListener("click", () => {
      const name = window.prompt("New nickname (max 16 characters):", inst.nickname);
      if (name == null) return;
      const clean = String(name).trim().slice(0, 16);
      if (!clean) return;
      inst.nickname = clean;
      persist();
      syncCompanion();
      openDetail(uid);
    });

    document.getElementById("bd-detail-cos").addEventListener("click", () => {
      closeModal(DETAIL_ID);
      openCustomizeModal(inst.uid);
    });

    const defBtn = document.getElementById("bd-detail-defender");
    if (defBtn) defBtn.addEventListener("click", async () => {
      if (typeof Arena === "undefined" || !Arena.setDefender) {
        toast("⚠️ Arena is unavailable right now.");
        return;
      }
      defBtn.disabled = true;
      defBtn.textContent = "Setting…";
      const ok = await Arena.setDefender(inst.uid);
      if (ok) openDetail(uid);
      else defBtn.disabled = false;
    });

    const healBtn = document.getElementById("bd-detail-heal");
    if (healBtn) healBtn.addEventListener("click", () => {
      const r = healBuddy(inst.uid, 3);
      if (r.ok) toast(`🍓 ${inst.nickname} recovered ${r.healed} HP (spent ${r.spent} berries)`);
      else if (r.reason === "no_berries") toast("Not enough berries — spin Elden Stops for more");
      else if (r.reason === "already_full") toast(`${inst.nickname} is already at full health`);
      openDetail(uid);
    });

    openModal(DETAIL_ID);
  }

  function ivBar(label, value) {
    const pct = Math.round((value / BuddyEngine.IV_MAX) * 100);
    return `
      <div style="display:flex; align-items:center; gap:8px; margin:4px 0">
        <div style="width:38px; font-size:10px; color:#9db8dd; letter-spacing:.7px">${label}</div>
        <div class="bd-progress" style="flex:1 1 auto"><i style="width:${pct}%"></i></div>
        <div style="width:22px; text-align:right; font-size:11px; font-weight:700">${value}</div>
      </div>
    `;
  }

  /* ------------------------------------------------------- Customization */
  function openCustomizeModal(uid) {
    const b = buddyState();
    const inst = b.bag.find(x => x.uid === uid);
    if (!inst) return;

    injectStyle();
    buildModal(CUSTOMIZE_ID, `
      <button class="bd-close">✕</button>
      <h2>✨ Customize ${inst.nickname}</h2>
      <p class="bd-sub">
        Cosmetic pieces unlock as your buddy levels up. Level ${inst.level} right now.
      </p>
      <div class="bd-preview" id="bd-cos-preview"></div>
      <div class="bd-cos-list" id="bd-cos-list"></div>
    `);
    wireClose(CUSTOMIZE_ID);

    try {
      const box = document.getElementById("bd-cos-preview");
      if (box) {
        if (customizePreview) { try { customizePreview.dispose(); } catch (e) {} }
        // The levitation pose, turned slowly so every equipped piece is
        // visible. (It previously asked for "dance", which the doll does not
        // have — and spun fast enough that the cosmetics were hard to see.)
        customizePreview = BuddyPreview.create(box, inst, {
          animate: true,
          spinRate: 0.14,
          anim: "idle",
        });
      }
    } catch (e) {}

    const list = document.getElementById("bd-cos-list");
    BuddyData.CUSTOMIZATION_TIERS.forEach(tier => {
      const unlocked = inst.level >= tier.level;
      // `hue` is the buddy's rolled colour — always on, nothing to toggle.
      const passive = tier.slot === "hue";
      const equipped = passive || (inst.customization && inst.customization[tier.slot] === tier.id);
      const item = document.createElement("div");
      item.className = "bd-cos-item" + (unlocked ? "" : " locked");
      item.innerHTML = `
        <div class="ci-icon">${unlocked ? "✨" : "🔒"}</div>
        <div class="ci-body">
          <div class="ci-name">${tier.name} <span style="color:#7f97ba;font-weight:600">· Lv.${tier.level}</span></div>
          <div class="ci-desc">${passive ? tier.desc + " Always on." : tier.desc}</div>
        </div>
        ${passive
          ? `<span class="ci-btn on" style="cursor:default">Always on</span>`
          : (unlocked ? `<button class="ci-btn ${equipped ? "on" : ""}">${equipped ? "Equipped" : "Equip"}</button>` : "")}
      `;
      if (!passive && unlocked) {
        item.querySelector(".ci-btn").addEventListener("click", () => {
          if (!inst.customization) inst.customization = {};
          inst.customization[tier.slot] = equipped ? null : tier.id;
          persist();
          syncCompanion();
          openCustomizeModal(uid);
        });
      }
      list.appendChild(item);
    });

    openModal(CUSTOMIZE_ID);
  }

  /* ---------------------------------------------------------- Encounter */
  function openEncounter(spawnId) {
    const b = buddyState();
    const spawn = b.spawns.find(s => s.id === spawnId);
    if (!spawn) { toast("That wild buddy has moved on"); return; }

    const sp = BuddyData.getSpecies(spawn.speciesId) || {};
    const nature = BuddyData.getNature(spawn.natureId);
    const rar = BuddyData.getRarity(spawn.rarity || (sp.rarity || "common"));
    const inst = BuddyEngine.makeInstance(spawn.speciesId, spawn.level, {
      ivs: spawn.ivs,
      natureId: spawn.natureId,
      hue: spawn.hue,
      source: "wild",
    });

    injectStyle();
    buildModal(ENCOUNTER_ID, `
      <button class="bd-close">✕</button>
      <h2>Wild Buddy Sighted!</h2>
      <p class="bd-sub">
        A wild <b>${sp.name || "buddy"}</b> is nearby. Tap Battle to challenge
        it with your active buddy.
      </p>

      <div class="bd-preview" id="bd-enc-preview"></div>

      <div style="margin:2px 0 12px; text-align:center">
        <span class="bd-tag" style="border-color:${rar.color}60; color:${rar.color}">${rar.name}</span>
        <span class="bd-tag">${inst.colorway} hue</span>
        <span class="bd-tag">${nature.name} nature</span>
      </div>

      <div class="bd-grid">
        <div class="bd-stat"><div class="k">Level</div><div class="v">${inst.level}</div></div>
        <div class="bd-stat"><div class="k">Type</div><div class="v" style="font-size:13px">${(sp.types || []).map(t => (BuddyData.getType(t) || {}).name).join(" / ")}</div></div>
      </div>

      <div class="bd-vs">
        <div class="line"></div>
        <div class="vs">VS</div>
        <div class="line"></div>
      </div>

      <div id="bd-enc-ally"></div>

      <div class="bd-row" style="margin-top:12px">
        <button class="bd-btn primary" id="bd-enc-battle">⚔️ Battle</button>
        <button class="bd-btn" id="bd-enc-ignore">Leave</button>
      </div>
    `);
    wireClose(ENCOUNTER_ID);

    try {
      const box = document.getElementById("bd-enc-preview");
      if (box) {
        if (encounterPreview) { try { encounterPreview.dispose(); } catch (e) {} }
        encounterPreview = BuddyPreview.create(box, inst, { animate: true, anim: "idle" });
      }
    } catch (e) {}

    const active = activeBuddy();
    const allyBox = document.getElementById("bd-enc-ally");
    const allyHp = buddyHp(active);
    if (active) {
      const asp = BuddyData.getSpecies(active.speciesId) || {};
      allyBox.innerHTML = `
        <div style="display:flex; align-items:center; gap:10px; padding:11px 12px; border-radius:13px; background:rgba(139,92,246,.14); border:1px solid rgba(139,92,246,.32)">
          <div style="width:40px;height:40px;border-radius:50%;background:radial-gradient(circle at 32% 28%, rgba(255,255,255,.9), ${ (BuddyData.getType((asp.types && asp.types[0]) || "metal") || {color:"#94a3b8"}).color } 48%, rgba(10,14,26,.92)); filter:hue-rotate(${Math.round((((active.hue % 1) + 1) % 1) * 360)}deg)"></div>
          <div style="flex:1 1 auto; min-width:0">
            <div style="font-size:13px;font-weight:800;color:#fff">${active.nickname}</div>
            <div style="font-size:10.5px;color:#a9bede">Lv.${active.level} · ${asp.name || active.speciesId} · HP ${allyHp.hp}/${allyHp.max}</div>
            <div class="bd-progress" style="margin-top:6px"><i style="width:${allyHp.pct}%; background:${hpColor(allyHp.pct)}"></i></div>
          </div>
          <div style="font-size:11px;color:#c4b5fd;font-weight:800">YOUR BUDDY</div>
        </div>
        ${allyHp.fainted ? `<div class="bd-hp-note bad" style="margin-top:8px">⚠ ${active.nickname} has fainted and cannot battle. Heal first.</div>`
          : (allyHp.pct < 40 ? `<div class="bd-hp-note" style="margin-top:8px">⚠ ${active.nickname} is hurt (${allyHp.pct}% HP). Consider healing before you fight.</div>` : "")}
        <div class="bd-row" style="margin-top:8px">
          <button class="bd-btn gold" id="bd-enc-heal" ${allyHp.pct >= 100 ? "disabled" : ""}>🍓 Heal ${active.nickname}</button>
        </div>
      `;
    } else {
      allyBox.innerHTML = `
        <div class="bd-empty">
          You have no buddy ready. Open the Buddy Bag to claim a starter first.
        </div>
      `;
    }

    const healBtn = document.getElementById("bd-enc-heal");
    if (healBtn) healBtn.addEventListener("click", () => {
      const r = healBuddy(active ? active.uid : null, 3);
      if (r.ok) toast(`🍓 Recovered ${r.healed} HP (spent ${r.spent} berries)`);
      else if (r.reason === "no_berries") toast("Not enough berries — spin Elden Stops for more");
      else if (r.reason === "already_full") toast("Already at full health");
      openEncounter(spawnId);
    });

    const battleBtn = document.getElementById("bd-enc-battle");
    if (allyHp.fainted) {
      battleBtn.disabled = true;
      battleBtn.textContent = "Buddy has fainted";
    }
    battleBtn.addEventListener("click", () => {
      if (!active) {
        toast("You need a buddy before you can battle");
        return;
      }
      if (buddyHp(active).fainted) {
        toast(`${active.nickname} has fainted — heal before battling`);
        return;
      }
      startBattle(spawn, active);
    });
    document.getElementById("bd-enc-ignore").addEventListener("click", () => {
      closeModal(ENCOUNTER_ID);
    });

    if (typeof PlayerXP !== "undefined") {
      PlayerXP.addXP(PlayerXP.XP.encounter, "encounter");
    }

    openModal(ENCOUNTER_ID);
  }

  /* -------------------------------------------------------------- Battle */
  function startBattle(spawn, activeInst) {
    const b = buddyState();
    closeModal(ENCOUNTER_ID);

    const wildInst = BuddyEngine.makeInstance(spawn.speciesId, spawn.level, {
      ivs: spawn.ivs,
      natureId: spawn.natureId,
      hue: spawn.hue,
      source: "wild",
    });

    b.totalBattles += 1;
    persist();

    try { if (typeof PlayerXP !== "undefined") PlayerXP.setHidden(true); } catch (e) {}

    BuddyBattle.startEncounter({
      ally: activeInst,
      wild: wildInst,
      spawn,
      bag: b.bag.slice(),
      onResult: (summary) => handleBattleResult(summary, spawn, activeInst, wildInst),
    });
  }

  async function handleBattleResult(summary, spawn, activeInst, wildInst) {
    const b = buddyState();

    // Sync the ally's battle HP back into the bag.
    const bagAlly = b.bag.find(x => x.uid === activeInst.uid);
    if (bagAlly && typeof summary.allyHp === "number") {
      bagAlly.currentHp = Math.max(0, summary.allyHp);
    }

    // The spawn is resolved either way.
    b.spawns = b.spawns.filter(s => s.id !== spawn.id);
    removeSpawnMarker(spawn.id);

    const playerXpReason = summary.outcome;

    // Buddy XP is awarded for EVERY outcome — winning is how a buddy grows.
    // The tame path used to skip this entirely, so the most common win left
    // the buddy at 0 XP while `battlesWon` still ticked up.
    const awardBuddyXp = (amount, label) => {
      const target = bagAlly || activeInst;
      if (!target || !amount) return null;
      const r = BuddyEngine.addXp(target, amount);
      if (r.leveled > 0) {
        toast(`⭐ ${target.nickname} reached Lv.${target.level}!`);
        if (typeof PlayerXP !== "undefined") {
          PlayerXP.addXP(PlayerXP.XP.buddyLevelUp * r.leveled, "buddy_level");
        }
      } else if (label) {
        toast(`${target.nickname} gained ${amount} XP`);
      }
      return r;
    };

    if (summary.outcome === "tame" && summary.tamed) {
      const tamed = summary.tamed;
      if (b.bag.length < 30) {
        b.bag.push(tamed);
        b.totalTamed += 1;
        if (!b.activeUid) b.activeUid = tamed.uid;
        toast(`🎉 ${tamed.nickname} was tamed and added to your Buddy Bag!`);
      } else {
        toast("Your Buddy Bag is full (30 max)");
      }
      // Winning the fight is what earns the XP — same as feast/loss.
      awardBuddyXp(BuddyEngine.battleXpReward(wildInst, "win"));
      if (typeof PlayerXP !== "undefined") PlayerXP.addXP(PlayerXP.XP.tame, "tame");
    } else if (summary.outcome === "feast") {
      b.totalFeasted += 1;
      const gained = summary.bonusXp || 0;
      const result = BuddyEngine.addXp(bagAlly || activeInst, gained + BuddyEngine.battleXpReward(wildInst, "win"));
      if (bagAlly) {
        bagAlly.happiness = Math.min(100, (bagAlly.happiness || 50) + (summary.happinessGain || 10));
        bagAlly.feasts = (bagAlly.feasts || 0) + 1;
      }
      if (result.leveled > 0) {
        toast(`🍖 ${activeInst.nickname} feasted and reached Lv.${(bagAlly || activeInst).level}!`);
        if (typeof PlayerXP !== "undefined") PlayerXP.addXP(PlayerXP.XP.buddyLevelUp * result.leveled, "buddy_level");
      } else {
        toast(`🍖 ${activeInst.nickname} feasted and gained ${gained} XP`);
      }
      if (typeof PlayerXP !== "undefined") PlayerXP.addXP(PlayerXP.XP.feast, "feast");
    } else if (summary.outcome === "lost") {
      const result = BuddyEngine.addXp(bagAlly || activeInst, BuddyEngine.battleXpReward(wildInst, "loss"));
      if (result.leveled > 0 && bagAlly) {
        toast(`💪 ${activeInst.nickname} learned from defeat and reached Lv.${bagAlly.level}!`);
      }
      if (typeof PlayerXP !== "undefined") PlayerXP.addXP(PlayerXP.XP.battleLoss, "battle_loss");
    } else if (summary.outcome === "released") {
      toast("The wild buddy was released unharmed");
      awardBuddyXp(Math.floor(BuddyEngine.battleXpReward(wildInst, "win") * 0.6));
      if (typeof PlayerXP !== "undefined") PlayerXP.addXP(PlayerXP.XP.battleWin, "battle_win");
    }

    if (summary.outcome === "tame" || summary.outcome === "feast") {
      b.totalWins += 1;
      if (bagAlly) bagAlly.battlesWon = (bagAlly.battlesWon || 0) + 1;
      if (typeof PlayerXP !== "undefined" && summary.outcome === "tame") {
        PlayerXP.addXP(PlayerXP.XP.battleWin, "battle_win");
      }
    }

    // Recovery floor. A buddy must never be saved at 1 HP — the next fight
    // would be hopeless and the only way out was waiting. Every outcome now
    // leaves at least POST_BATTLE_FLOOR_PCT of max HP, and a win heals more.
    if (bagAlly) {
      const maxHp = bagAlly.stats.hp;
      const floor = Math.max(1, Math.floor(maxHp * POST_BATTLE_FLOOR_PCT));
      const winFloor = Math.max(1, Math.floor(maxHp * 0.6));
      const target = (summary.outcome === "tame" || summary.outcome === "feast" || summary.outcome === "released")
        ? winFloor
        : floor;
      if (bagAlly.currentHp < target) bagAlly.currentHp = target;
    }

    persist();
    renderHudBadge();
    syncCompanion();

    // Best-effort server settlement (rewards + anti-cheat telemetry).
    try {
      if (typeof firebase !== "undefined" && firebase.functions) {
        const fn = firebase.functions().httpsCallable("buddyResolveEncounter");
        await fn({
          spawnId: spawn.id,
          outcome: summary.outcome,
          turns: summary.turns || 0,
          wildSpecies: summary.wildSpecies,
          wildLevel: summary.wildLevel,
          allyUid: summary.allyUid,
          lat: playerPos ? playerPos.lat : null,
          lon: playerPos ? playerPos.lon : null,
        });
      }
    } catch (e) {
      console.warn("[Buddy] server encounter resolve failed:", e.message);
    }
  }

  /* ---------------------------------------------------------- Trainer UI */
  function openTrainerModal() {
    injectStyle();
    const ebCoinImg = new Image();
    ebCoinImg.src = "assets/eb-coin.png";
    const diamondImg = new Image();
    diamondImg.src = "assets/diamond-spawn.png";
    const b = buddyState();
    // Lifetime PvP record lives server-side (arena_defenders) so it survives
    // weekly season resets and device changes.
    const arState = (typeof Arena !== "undefined" && Arena.getState) ? Arena.getState() : null;
    const pvp = (arState && arState.me) ? {
      wins: Number(arState.me.lifetimeWins) || 0,
      losses: Number(arState.me.lifetimeLosses) || 0,
    } : { wins: 0, losses: 0 };
    const p = (typeof PlayerXP !== "undefined") ? PlayerXP.progress() : { level: 1, xp: 0, need: 1, pct: 0, title: "Wanderer", totalXp: 0 };

    buildModal(TRAINER_ID, `
      <button class="bd-close">✕</button>
      <h2>🏆 Trainer Profile</h2>
      <p class="bd-sub">
        You are <b>${p.title}</b>. Earn XP from every action and especially from
        buddy battle wins.
      </p>

      <div style="display:flex; align-items:center; gap:14px; margin:6px 0 14px">
        <div style="width:62px;height:62px;border-radius:18px;background:linear-gradient(140deg,#2b6cf0,#7c3aed);display:flex;align-items:center;justify-content:center;font-size:23px;font-weight:900;color:#fff;flex:0 0 auto">${p.level}</div>
        <div style="flex:1 1 auto">
          <div style="font-size:10px;letter-spacing:1.4px;text-transform:uppercase;color:#7f97ba">Trainer Level</div>
          <div style="font-size:16px;font-weight:800;color:#fff">${p.title}</div>
          <div style="font-size:11px;color:#9db8dd;margin-top:3px">
            ${p.maxed ? "MAX LEVEL" : `${p.xp.toLocaleString()} / ${p.need.toLocaleString()} XP to Lv.${p.level + 1}`}
          </div>
          <div class="bd-progress" style="margin-top:6px"><i style="width:${p.maxed ? 100 : p.pct}%"></i></div>
        </div>
      </div>

      <div class="bd-grid">
        <div class="bd-stat"><div class="k">Total XP</div><div class="v">${(p.totalXp || 0).toLocaleString()}</div></div>
        <div class="bd-stat"><div class="k">Buddies</div><div class="v">${b.bag.length}</div></div>
        <div class="bd-stat"><div class="k">Battles</div><div class="v">${b.totalBattles}</div></div>
        <div class="bd-stat"><div class="k">Wins</div><div class="v">${b.totalWins}</div></div>
        <div class="bd-stat"><div class="k">Tamed</div><div class="v">${b.totalTamed}</div></div>
        <div class="bd-stat"><div class="k">Feasted</div><div class="v">${b.totalFeasted}</div></div>
        <div class="bd-stat"><div class="k">PvP Wins</div><div class="v">${pvp.wins}</div></div>
        <div class="bd-stat"><div class="k">PvP Losses</div><div class="v">${pvp.losses}</div></div>
      </div>

      <div style="font-size:10px;letter-spacing:1.2px;text-transform:uppercase;color:#7f97ba;margin:14px 0 6px">
        Wild Spawn Progress Today
      </div>
      <div class="bd-progress">
        <i style="width:${Math.min(100, (b.spawnsToday / MAX_DAILY_SPAWNS) * 100)}%"></i>
      </div>
      <div style="font-size:11px;color:#9db8dd;margin-top:6px">
        ${b.spawnsToday} / ${MAX_DAILY_SPAWNS} wild spawns today &middot;
        ${Math.max(0, Math.round(METERS_PER_SPAWN - b.distCredit))} m until the next spawn
      </div>
      <div class="bd-hp-note">
        Walking counts anywhere &mdash; the same route works again after a short
        stop (8 min) or automatically every 2 hours. Keep the app open and the
        screen on while you walk.
      </div>

      <div style="font-size:10px;letter-spacing:1.2px;text-transform:uppercase;color:#7f97ba;margin:16px 0 6px">
        Level Rewards
      </div>
      <div class="bd-hp-wrap">
        <div class="bd-reward-line"><span class="bd-reward-badge">EVERY LEVEL</span> 🍓 ${5 + p.level}+ berries</div>
        <div class="bd-reward-line"><span class="bd-reward-badge">EVERY 2</span> <img src="assets/eb-coin.png" style="width:16px;height:16px;vertical-align:middle;margin-right:4px"> 10 EB</div>
        <div class="bd-reward-line"><span class="bd-reward-badge">EVERY 5</span> <img src="assets/diamond-spawn.png" style="width:16px;height:16px;vertical-align:middle;margin-right:4px"> 25 diamonds</div>
        <div class="bd-reward-line"><span class="bd-reward-badge">EVERY 10</span> ⭐ 5 RP</div>
      </div>

      <div style="font-size:10px;letter-spacing:1.2px;text-transform:uppercase;color:#7f97ba;margin:14px 0 6px">
        Coming Up
      </div>
      <div class="bd-cos-list">
        ${(typeof BuddyData !== "undefined" ? BuddyData.upcomingTrainerRewards(p.level, 3) : []).map(u => `
          <div class="bd-cos-item">
            <div class="ci-icon">🎁</div>
            <div class="ci-body">
              <div class="ci-name">Level ${u.level}</div>
              <div class="ci-desc">+${u.label}</div>
            </div>
          </div>
        `).join("") || '<div class="bd-empty">Reach the next milestone to earn bonuses.</div>'}
      </div>

      <div class="bd-row" style="margin-top:16px">
        <button class="bd-btn primary" id="bd-trainer-bag">🎒 Open Buddy Bag</button>
      </div>
    `);
    wireClose(TRAINER_ID);

    document.getElementById("bd-trainer-bag").addEventListener("click", () => {
      closeModal(TRAINER_ID);
      openBag();
    });

    openModal(TRAINER_ID);
  }

  /* ============================================================= HEALING */
  function hpColor(pct) {
    if (pct <= 25) return "linear-gradient(90deg,#dc2626,#f87171)";
    if (pct <= 55) return "linear-gradient(90deg,#eab308,#facc15)";
    return "linear-gradient(90deg,#22c55e,#4ade80)";
  }

  function buddyHp(inst) {
    if (!inst) return { hp: 0, max: 1, pct: 0, fainted: true };
    const max = Math.max(1, inst.stats ? inst.stats.hp : 1);
    const hp = Math.max(0, Math.min(max, (typeof inst.currentHp === "number") ? inst.currentHp : max));
    return { hp, max, pct: Math.round((hp / max) * 100), fainted: hp <= 0 };
  }

  /**
   * Spend berries to restore a buddy's HP.
   * @param {string} uid         buddy instance id (defaults to the active one)
   * @param {number} berryCount  berries to spend
   * @returns {{ok:boolean, healed:number, spent:number, reason?:string}}
   */
  function healBuddy(uid, berryCount) {
    const state = (typeof Store !== "undefined" && Store.get) ? Store.get() : null;
    if (!state) return { ok: false, healed: 0, spent: 0, reason: "no_state" };

    const b = buddyState();
    const inst = b.bag.find(x => x.uid === (uid || b.activeUid)) || b.bag.find(x => x.uid === b.activeUid) || b.bag[0];
    if (!inst) return { ok: false, healed: 0, spent: 0, reason: "no_buddy" };

    const info = buddyHp(inst);
    if (info.hp >= info.max) return { ok: false, healed: 0, spent: 0, reason: "already_full" };

    const want = Math.max(1, Math.floor(berryCount || 1));
    const affordable = Math.floor((state.berries || 0) / 1);
    const spend = Math.min(want, affordable, Math.ceil((info.max - info.hp) / (info.max * HEAL_BERRY_PCT)));
    if (spend <= 0) return { ok: false, healed: 0, spent: 0, reason: "no_berries" };

    const healAmount = Math.min(info.max - info.hp, Math.round(info.max * HEAL_BERRY_PCT * spend));
    state.berries = Math.max(0, (state.berries || 0) - spend);
    inst.currentHp = info.hp + healAmount;

    persist();
    renderHudBadge();
    syncCompanion();
    if (typeof PlayerXP !== "undefined") PlayerXP.addXP(PlayerXP.XP.petFeed, "buddy_heal");
    return { ok: true, healed: healAmount, spent: spend };
  }

  // Passive recovery so a wiped buddy is never permanently out of action.
  function tickRegen() {
    const b = buddyState();
    const now = Date.now();
    const elapsedMin = (now - (b.lastRegenAt || now)) / 60000;
    if (elapsedMin < 1) return;
    b.lastRegenAt = now;

    let changed = false;
    b.bag.forEach(inst => {
      const info = buddyHp(inst);
      if (info.hp >= info.max) return;
      const gain = Math.max(1, Math.round(info.max * REGEN_PCT_PER_MIN * elapsedMin));
      const next = Math.min(info.max, info.hp + gain);
      if (next !== info.hp) {
        inst.currentHp = next;
        changed = true;
      }
    });
    if (changed) persist();
  }

  /* =========================================================== HELPERS */
  function activeBuddy() {
    const b = buddyState();
    return b.bag.find(x => x.uid === b.activeUid) || b.bag[0] || null;
  }

  // Push the current active buddy (and its cosmetics) to the map companion AND
  // the companion pet, so the creature walking beside the player and the pet
  // modal both show the same buddy — same species, same rolled colour, same
  // cosmetics — as the Buddy Bag.
  function syncCompanion() {
    try {
      if (typeof BuddyCompanion !== "undefined" && BuddyCompanion.refresh) {
        BuddyCompanion.refresh();
      }
    } catch (e) {}
    try {
      if (typeof CompanionPet !== "undefined" && CompanionPet.refreshPetLook) {
        CompanionPet.refreshPetLook();
      }
    } catch (e) {}
  }

  function renderHudBadge() {
    injectStyle();

    // Drop the legacy floating map button if a stale session left one behind.
    const legacy = document.getElementById(HUD_ID);
    if (legacy) legacy.remove();

    let el = document.getElementById(INMODAL_ID);
    if (!el) {
      el = document.createElement("div");
      el.id = INMODAL_ID;
      el.innerHTML = `
        <div class="bdim-row">
          <div class="bdim-icon">🐾</div>
          <div class="bdim-meta">
            <div class="bdim-title">Buddy Bag</div>
            <div class="bdim-sub">No buddies yet</div>
          </div>
          <button class="bdim-btn" type="button">Open</button>
        </div>
      `;
      el.querySelector(".bdim-btn").addEventListener("click", (e) => {
        e.stopPropagation();
        if (!maybeForceStarter()) return;
        openBag();
      });
    }

    // Place it directly under the trainer block inside the Profile tab.
    const panel = document.querySelector(TARGET_PANEL);
    if (panel) {
      const anchor = document.getElementById("player-xp-inmodal");
      if (anchor && anchor.parentNode === panel) {
        anchor.insertAdjacentElement("afterend", el);
      } else {
        const header = panel.querySelector(".profile-header-card");
        if (header && header.parentNode === panel) {
          header.insertAdjacentElement("afterend", el);
        } else {
          panel.insertBefore(el, panel.firstChild);
        }
      }
    } else if (!el.parentNode) {
      el.style.display = "none";
      document.body.appendChild(el);
    }

    const b = buddyState();
    const titleEl = el.querySelector(".bdim-title");
    const subEl = el.querySelector(".bdim-sub");
    const hasAlert = b.spawns.length > 0;

    if (titleEl) {
      titleEl.innerHTML = `Buddy Bag${hasAlert ? '<span class="bdim-alert">✨ ' + b.spawns.length + ' wild</span>' : ""}`;
    }
    if (subEl) {
      const nextIn = Math.max(0, Math.round(METERS_PER_SPAWN - b.distCredit));
      subEl.textContent = b.bag.length
        ? `${b.bag.length} collected · ${b.totalTamed} tamed · ${nextIn} m to next spawn`
        : `Walk the realm to find wild buddies · ${nextIn} m to next spawn`;
    }
    el.style.display = "";
  }

  /* ============================================================= INIT */
  function init(map, lng, lat) {
    mapInstance = map || null;
    if (typeof lat === "number" && typeof lng === "number") {
      playerPos = { lat, lon: lng };
    }

    injectStyle();
    ensureState();
    renderHudBadge();
    rebuildMarkers();

    // Refresh the in-modal block whenever the Player Info modal opens so the
    // buddy count / spawn alert never renders stale.
    try {
      const modal = document.getElementById("player-info-modal");
      if (modal && typeof MutationObserver !== "undefined") {
        const observer = new MutationObserver(() => {
          if (!modal.classList.contains("hidden")) renderHudBadge();
        });
        observer.observe(modal, { attributes: true, attributeFilter: ["class"] });
      }
    } catch (e) {}

    // Mount the active buddy as a real 3D model walking beside the player.
    if (typeof BuddyCompanion !== "undefined" && mapInstance) {
      try {
        BuddyCompanion.init(mapInstance, typeof lng === "number" ? lng : null, typeof lat === "number" ? lat : null);
      } catch (e) {
        console.warn("[Buddy] companion mount failed:", e.message);
      }
      // The collection is restored from the cloud shortly after boot. Retry the
      // mount a few times so the buddy appears as soon as the data lands
      // instead of waiting for the next 15s maintenance tick.
      [1200, 3500, 8000].forEach((ms) => {
        setTimeout(() => { try { syncCompanion(); } catch (e) {} }, ms);
      });
    }

    // Periodic maintenance: expire old spawns, cull by distance.
    setInterval(() => {
      const b = buddyState();
      const now = Date.now();

      // Passive HP recovery (see tickRegen) — keeps a defeated buddy usable.
      try { tickRegen(); } catch (e) {}

      // Re-sync the map companion. The buddy collection arrives from the cloud
      // AFTER this module boots, so the one-shot refresh() at init finds an
      // empty bag, attaches no layer, and the buddy stays invisible. This
      // call is idempotent (same buddy -> no-op) so it is cheap to repeat.
      try { syncCompanion(); } catch (e) {}

      const before = b.spawns.length;
      b.spawns = b.spawns.filter(s => {
        if (s.expiresAt <= now) {
          removeSpawnMarker(s.id);
          return false;
        }
        return true;
      });
      if (b.spawns.length !== before) persist();
      cullMarkersByDistance();
      renderHudBadge();
    }, 15000);

    console.log("[Buddy] Buddy system online —", b2(), "species loaded");
  }

  function b2() { return BuddyData.allSpecies().length; }

  /**
   * Called from the main GPS loop. Drives spawn accrual.
   * Signature matches CompanionPet.setPlayerPosition for consistency, with an
   * optional accuracy argument.
   */
  function setPlayerPosition(lat, lon, accuracy) {
    if (typeof lat !== "number" || typeof lon !== "number") return;
    const prev = playerPos;
    playerPos = { lat, lon };

    if (typeof BuddyCompanion !== "undefined" && BuddyCompanion.setPlayerPosition) {
      try { BuddyCompanion.setPlayerPosition(lat, lon); } catch (e) {}
    }

    // Only track distance when the fix is meaningfully new.
    trackPosition(lat, lon, accuracy);
    if (prev) cullMarkersByDistance();
    rebuildMarkersThrottled();
  }

  let rebuildTimer = 0;
  function rebuildMarkersThrottled() {
    const now = Date.now();
    if (now - rebuildTimer < 2500) return;
    rebuildTimer = now;
    rebuildMarkers();
  }

  return {
    init,
    setPlayerPosition,
    openBag,
    openTrainerModal,
    openCustomizeModal,
    openEncounter,
    activeBuddy,
    healBuddy,
    buddyHp,
    tickRegen,
    trackPosition,
    renderHudBadge,
    METERS_PER_SPAWN,
    MAX_DAILY_SPAWNS,
  };
})();
