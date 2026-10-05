// ============================================================
// Elden Earth — land grid & real-time multiplayer sync (Mapbox 3D)
// ============================================================
const Grid = (() => {
  let map = null;
  let onBuyAttempt = () => {};
  let pendingTile = null;
  let globalPlots = {};
  let activeMarkers = [];
  let isBuyMode = false;
  let playerCoords = null;
  let selectedPlotId = null;
  let isAscensionMode = false;
  let ascensionSelections = [];
  let onAscensionPick = null;

  function tileId(tx, ty) { return tx + "_" + ty; }

  function pickRarity() {
    const rarities = CONFIG.PLOT_RARITIES;
    const totalWeight = rarities.reduce((s, r) => s + r.weight, 0);
    let roll = Math.random() * totalWeight;
    for (const r of rarities) {
      if (roll < r.weight) return r;
      roll -= r.weight;
    }
    return rarities[0];
  }

  function rarityInfo(key) {
    return CONFIG.PLOT_RARITIES.find(r => r.key === key) || CONFIG.PLOT_RARITIES[0];
  }

  function getAllPlots() {
    const state = Store.get();
    // Live listener wins over local state so a server-side deletion (pickup/
    // relocate) can never be painted over by a stale local entry. Local plots
    // still render as a fallback until the listener has delivered them.
    return Object.assign({}, state.plots || {}, globalPlots);
  }

  function promptBuyTile(tx, ty) {
    // Anti-cheat: Embargo check
    if (typeof AntiCheat !== "undefined") {
      const check = AntiCheat.isActionAllowed("purchase");
      if (!check.allowed) {
        const toast = window.showToast || alert;
        toast(check.reason, 5000);
        return;
      }
    }

    const state = Store.get();

    // ⏳ 5-Second Land Purchase Cooldown (Stops rapid spam & refresh exploits)
    const now = Date.now();
    const BUY_COOLDOWN_MS = 5000; // 5 second Cooldown
    const lastBuy = state.lastLandPurchaseAt || 0;
    if (now - lastBuy < BUY_COOLDOWN_MS) {
      const remSec = Math.ceil((BUY_COOLDOWN_MS - (now - lastBuy)) / 1000);
      const toast = window.showToast || alert;
      toast(`⏳ Land Registry Cooldown: Please wait ${remSec}s before claiming your next parcel.`, 3000);
      return; // Block opening modal!
    }

    const ts = CONFIG.TILE_SIZE_METERS || 6.096;
    const radiusM = CONFIG.DIAMOND_COLLECT_RADIUS_METERS || 75;

    if (playerCoords && playerCoords.lat) {
      const bounds = Geo.tileBounds(tx, ty, ts);
      const cLat = (bounds[0][0] + bounds[2][0]) / 2;
      const cLon = (bounds[0][1] + bounds[2][1]) / 2;
      if (Geo.haversine(playerCoords.lat, playerCoords.lon, cLat, cLon) > radiusM) {
        return;
      }
    }
    // Strict Guest Guard: Only permanent Google accounts may claim realm land!
    const fbUser = (typeof firebase !== "undefined" && firebase.auth) ? firebase.auth().currentUser : null;
    const isGuest = fbUser ? fbUser.isAnonymous : (!state.player?.id || state.player.id.startsWith("guest-"));
    if (isGuest) {
      const toastFn = window.showToast || alert;
      toastFn("🛡️ YOU ARE A GUEST. Sign in with Google to claim permanent land plots!", 3500);
      onBuyAttempt(false, null);
      return;
    }
    const tid = tileId(tx, ty);
    const allPlots = getAllPlots();

    if (allPlots[tid]) {
      if (allPlots[tid].ownerId === state.player.id) openPlotModal(tid, allPlots[tid]);
      else showToast(`This tile is already claimed by ${allPlots[tid].ownerName || "another player"}!`);
      return;
    }

    // Check if player holds an unplanted Citadel Capsule
    const hasCapsule = state.capsule && state.capsule.awarded && !state.capsule.planted;
    const hasEldenSeed = (Number(state.eldenStopSeeds) || 0) > 0;

    // Always allow opening modal — server validates EB balance authoritatively
    pendingTile = { tx, ty };
    scheduleRender();
    const modal = document.getElementById("buy-modal");
    const plantBtn = document.getElementById("plant-capsule-confirm-btn");

    // Seamless toggle: Shows or hides the plant button without touching innerHTML!
    if (plantBtn) {
      plantBtn.style.display = hasCapsule ? "inline-block" : "none";
    }
    const eldenBtn = document.getElementById("plant-elden-stop-btn");
    if (eldenBtn) {
      eldenBtn.style.display = hasEldenSeed ? "inline-block" : "none";
      eldenBtn.textContent = `🗼 Plant Elden Stop x${Number(state.eldenStopSeeds) || 0} (Free)`;
    }
    const bagBtn = document.getElementById("plot-bag-btn");
    if (bagBtn) bagBtn.style.display = hasBagPlots(state) ? "inline-block" : "none";

    if (modal) modal.classList.remove("hidden");
  }

  function bagItemCount(state) {
    const items = state.plotBagItems;
    if (items && typeof items === "object" && Object.keys(items).length > 0) {
      return Object.keys(items).length;
    }
    return Object.values(state.plotBag || {}).reduce((s, n) => s + (Number(n) || 0), 0);
  }

  function hasBagPlots(state) {
    return bagItemCount(state) > 0;
  }

  function openPlotModal(tid, plot) {
    selectedPlotId = tid;
    const state = Store.get();
    const rarity = rarityInfo(plot.rarity);
    const isLucky = plot.lucky === true;
    // 🍀 Lucky plots are titled and rated at ×1.1 their rarity rate.
    document.getElementById("plot-modal-rarity").textContent = isLucky ? `🍀 ${rarity.label.toUpperCase()} PLOT` : `${rarity.label} PLOT`;
    document.getElementById("plot-modal-rarity").classList.toggle("lucky-text", isLucky);
    document.getElementById("plot-modal-rarity").style.color = isLucky ? "" : rarity.color;
    document.getElementById("plot-modal-name").textContent = `${plot.ownerName || "Traveler"}'s Plot`;
    document.getElementById("plot-modal-coords").textContent = `Coords: [${plot.tx}, ${plot.ty}]`;
    const modalRate = CONFIG.plotRate(String(plot.rarity?.key || plot.rarity || "common"), isLucky);
    document.getElementById("plot-modal-rate").textContent = `${modalRate} EB / sec${isLucky ? " (🍀 +10%)" : ""}`;
    document.getElementById("plot-modal-location").textContent = [plot.city, plot.state, plot.country].filter(Boolean).join(", ") || "Unknown";
    // Show relocate button only for the player's own plots
    const relocateBtn = document.getElementById("plot-relocate-btn");
    if (relocateBtn) {
      relocateBtn.style.display = (plot.ownerId === state.player?.id) ? "inline-block" : "none";
    }
    // Show Ascend button for own non-legendary plots
    const ascendBtn = document.getElementById("plot-ascend-btn");
    if (ascendBtn) {
      const rKey = String(plot.rarity?.key || plot.rarity || "common").toLowerCase();
      ascendBtn.style.display = (plot.ownerId === state.player?.id && rKey !== "legendary") ? "inline-block" : "none";
    }
    document.getElementById("plot-modal")?.classList.remove("hidden");
  }

  async function relocatePlot() {
    if (!selectedPlotId) return;
    const state = Store.get();
    const plot = state.plots[selectedPlotId] || getAllPlots()[selectedPlotId];
    if (!plot || plot.ownerId !== state.player?.id) {
      showToast("⚠️ You can only relocate your own plots.", 3500);
      return;
    }

    if (!(await window.gameConfirm("Pick up this plot and add it to your Plot Bag? You can place it at a new location later.", { okText: "Pick Up" }))) {
      return;
    }

    if (typeof ServerAntiCheat === "undefined" || !ServerAntiCheat.isReady()) {
      showToast("⚠️ Server connection required to relocate a plot.", 4000);
      return;
    }

    const result = await ServerAntiCheat.pickupPlot(selectedPlotId);
    if (!result.allowed) {
      // Transport error after the server already committed is indistinguishable
      // from a real failure without a recovery read — check server truth.
      if (result.reason === "server_error") {
        const recovered = await recoverCommittedPickup(selectedPlotId);
        if (recovered) {
          applyPickupSuccess(recovered, selectedPlotId);
          return;
        }
      }
      const msgs = {
        plot_not_found: "⚠️ This plot no longer exists.",
        not_your_plot: "⚠️ You can only relocate your own plots.",
        plot_already_claimed: "⚠️ This plot was just claimed by someone else!",
      };
      showToast(msgs[result.reason] || "⚠️ Could not pick up plot.", 3500);
      return;
    }

    applyPickupSuccess(result, selectedPlotId);
  }

  async function recoverCommittedPickup(tid) {
    try {
      const db = Store.getDb();
      const state = Store.get();
      const uid = state.player?.id;
      if (!db || !uid) return null;
      const plotSnap = await db.collection("plots").doc(tid).get();
      if (plotSnap.exists) return null; // server did NOT commit
      const saveSnap = await db.collection("saves").doc(uid).get();
      if (!saveSnap.exists) return null;
      const save = saveSnap.data() || {};
      const localPlot = (state.plots || {})[tid] || getAllPlots()[tid] || {};
      const rarityKey = localPlot.rarity || "common";
      return {
        allowed: true,
        reason: "ok",
        rarity: rarityKey,
        plotBag: save.plotBag || {},
        plotBagItems: save.plotBagItems || undefined,
        luckyBagItems: save.luckyBagItems || undefined,
        plots: save.plots || {},
        plotsVersion: Number(save.plotsVersion) || 0,
      };
    } catch (e) {
      console.warn("[Grid] Pickup recovery failed:", e);
      return null;
    }
  }

  function applyPickupSuccess(result, tid) {
    const state = Store.get();
    state.plots = result.plots || state.plots;
    // Always drop the picked-up tid even if the server response omitted plots
    if (state.plots) delete state.plots[tid];
    if (result.plotBagItems && typeof result.plotBagItems === "object") {
      state.plotBagItems = { ...result.plotBagItems };
    }
    if (result.luckyBagItems && typeof result.luckyBagItems === "object") {
      state.luckyBagItems = { ...result.luckyBagItems };
    }
    state.plotBag = result.plotBag || state.plotBag;
    if (result.plotsVersion !== undefined) {
      state.plotsVersion = result.plotsVersion;
    }
    delete globalPlots[tid];
    Store.save(true);

    document.getElementById("plot-modal")?.classList.add("hidden");
    selectedPlotId = null;
    render();
    const rarityLabel = String(result.rarity || "common").toUpperCase();
    showToast(`📦 Plot picked up! Added ${rarityLabel} Plot to your bag.`, 3500);
  }

  function openPlotBag() {
    const state = Store.get();
    const items = document.getElementById("plot-bag-items");
    if (!items) return;
    items.innerHTML = "";
    // Phase 2: group instance IDs by rarity; fall back to legacy counters.
    // 🍀 Lucky plots stack separately so a Lucky Common renders as its own
    // rainbow "🍀 Common Plot x3" button.
    const counts = {};
    const hasItems = state.plotBagItems && typeof state.plotBagItems === "object" && Object.keys(state.plotBagItems).length > 0;
    if (hasItems) {
      for (const id in state.plotBagItems) {
        const rarity = String(state.plotBagItems[id] || "common").split("_")[0];
        const lucky = state.luckyBagItems && state.luckyBagItems[id] === true;
        const key = lucky ? `${rarity}~lucky` : rarity;
        counts[key] = (counts[key] || 0) + 1;
      }
    } else {
      for (const slot in (state.plotBag || {})) {
        const rarity = slot.split("_")[0];
        counts[rarity] = (counts[rarity] || 0) + (Number(state.plotBag[slot]) || 0);
      }
    }
    for (const groupKey in counts) {
      const count = counts[groupKey];
      if (!count) continue;
      const lucky = groupKey.endsWith("~lucky");
      const rarityKey = lucky ? groupKey.slice(0, -7) : groupKey;
      const rarity = rarityInfo(rarityKey);
      const button = document.createElement("button");
      button.className = lucky ? "btn btn-primary bag-btn-lucky" : "btn btn-primary";
      button.textContent = lucky ? `🍀 ${rarity.label} Plot x${count}` : `${rarity.label} Plot x${count}`;
      button.style.borderColor = lucky ? "" : rarity.color;
      button.addEventListener("click", () => placeBagPlot(lucky ? `${rarityKey}~lucky` : rarityKey));
      items.appendChild(button);
    }
    document.getElementById("buy-modal")?.classList.add("hidden");
    document.getElementById("plot-bag-modal")?.classList.remove("hidden");
  }

  async function placeBagPlot(slot) {
    if (!pendingTile) return;
    const state = Store.get();
    const { tx, ty } = pendingTile;
    const tid = tileId(tx, ty);
    const wantLucky = String(slot).endsWith("~lucky");
    const rarityKey = String(slot).split("~")[0].split("_")[0];
    if (getAllPlots()[tid]) return;
    // Phase 2: resolve WHICH instance id leaves the bag (items preferred).
    const itemsMap = (state.plotBagItems && typeof state.plotBagItems === "object" && Object.keys(state.plotBagItems).length > 0)
      ? state.plotBagItems
      : null;
    let plotItemId = null;
    if (itemsMap) {
      // 🍀 Match rarity AND lucky flag so the right instance is consumed.
      plotItemId = Object.keys(itemsMap).find((id) => {
        if (String(itemsMap[id] || "common").split("_")[0] !== rarityKey) return false;
        const isLucky = !!(state.luckyBagItems && state.luckyBagItems[id] === true);
        return isLucky === wantLucky;
      }) || null;
      if (!plotItemId) {
        if (typeof showToast === "function") showToast("⚠️ That plot is no longer in your bag.", 3500);
        return;
      }
    } else {
      const count = Number(state.plotBag?.[slot]) || 0;
      if (!count) return;
    }

    const corners = Geo.tileBounds(tx, ty, CONFIG.TILE_SIZE_METERS);
    const centerLat = (corners[0][0] + corners[2][0]) / 2;
    const centerLon = (corners[0][1] + corners[2][1]) / 2;
    const territory = await Geo.getTerritoryInfo(centerLat, centerLon);
    if (!territory || !territory.city || !territory.country) {
      if (typeof showToast === "function") showToast("📍 Could not resolve location — try a different area.", 3500);
      return;
    }
    const rarity = rarityInfo(rarityKey);

    if (typeof ServerAntiCheat === "undefined" || !ServerAntiCheat.isReady()) {
      if (typeof showToast === "function") showToast("⚠️ Server connection required to relocate a plot.", 4000);
      return;
    }

    const serverResult = await ServerAntiCheat.relocatePlot(slot, tx, ty, plotItemId);
    if (!serverResult.allowed) {
      const why = serverResult.reason === "plot_in_trade"
        ? "it is committed to an open trade."
        : serverResult.reason;
      if (typeof showToast === "function") showToast("⚠️ Couldn't place plot: " + why, 4000);
      return;
    }

    const serverPlotData = serverResult.plotData;
    const serverTid = serverResult.tid;

    // Authoritative inventory from the server (same instance id moved out).
    if (serverResult.plotBagItems && typeof serverResult.plotBagItems === "object") {
      state.plotBagItems = { ...serverResult.plotBagItems };
    }
    if (serverResult.luckyBagItems && typeof serverResult.luckyBagItems === "object") {
      state.luckyBagItems = { ...serverResult.luckyBagItems };
    }
    state.plots[serverTid] = serverPlotData;
    globalPlots[serverTid] = serverPlotData;
    // Prefer authoritative ledger fields from the server response
    if (serverResult.plots) state.plots = serverResult.plots;
    if (serverResult.plotsVersion !== undefined) state.plotsVersion = serverResult.plotsVersion;
    if (serverResult.plotBag) state.plotBag = serverResult.plotBag;
    pendingTile = null;
    Store.save(true);
    document.getElementById("plot-bag-modal")?.classList.add("hidden");
    render();
    showPlotFloatText(tx, ty, `RELOCATED ${rarity.label.toUpperCase()} TO NEW LOCATION`);
  }

  function showPlotFloatText(tx, ty, text) {
    if (!map) return;
    const corners = Geo.tileBounds(tx, ty, CONFIG.TILE_SIZE_METERS);
    const lat = (corners[0][0] + corners[2][0]) / 2;
    const lon = (corners[0][1] + corners[2][1]) / 2;
    const pt = map.project([lon, lat]);
    const popup = document.createElement("div");
    popup.className = "combat-text-popup";
    popup.style.left = `${pt.x}px`;
    popup.style.top = `${pt.y}px`;
    popup.textContent = text;
    document.body.appendChild(popup);
    setTimeout(() => popup.remove(), 1500);
  }

  // Checks Firestore for a plot the server committed even though the callable
  // response was lost (mobile timeout / crash). Returns plot data if we own it.
  async function recoverCommittedPurchase(tid) {
    try {
      const db = Store.getDb();
      const myId = Store.get()?.player?.id;
      if (!db || !myId) return null;
      const doc = await db.collection("plots").doc(tid).get();
      if (!doc.exists) return null;
      const data = doc.data() || {};
      if (data.ownerId !== myId) return null;
      console.log(`[Grid] Recovered committed purchase for ${tid} despite failed response.`);
      return data;
    } catch (e) {
      console.warn("[Grid] Purchase recovery check failed:", e && e.message);
      return null;
    }
  }

  // Applies a server-approved (or recovered) purchase to local state and UI.
  // Isolated so a UI/decoration error can never be misreported as a failure.
  function applyPurchaseSuccess(plotData, tid, opts, centerLat, centerLon) {
    const state = Store.get();
    if (!state.plots) state.plots = {};
    if (typeof opts.nextEb === "number") {
      state.eb = opts.nextEb;
    } else {
      // Server committed the transaction (it always deducts 100 EB on success),
      // but didn't report the new balance — mirror the cost locally.
      state.eb = Math.max(0, (Number(state.eb) || 0) - 100);
    }
    if (opts.lastLandPurchaseAt) state.lastLandPurchaseAt = opts.lastLandPurchaseAt;
    state.plots[tid] = plotData;
    globalPlots[tid] = plotData;
    Store.save(true);

    const rarityObj = CONFIG.PLOT_RARITIES.find(r => r.key === plotData.rarity) || CONFIG.PLOT_RARITIES[0];

    try {
      onBuyAttempt(true, rarityObj);
      render();
      if (typeof updateTopbar === "function") updateTopbar();
      if (typeof updatePlayerInfoModal === "function") updatePlayerInfoModal();
      if (typeof showToast === "function") {
        showToast(`✅ Land purchase verified! -100 EB deducted. +1 ${rarityObj.label} Plot added!`, 3000);
      }
    } catch (uiErr) {
      console.warn("[Grid] Post-purchase UI notice:", uiErr && uiErr.message);
    }

    try {
      const rarityLabel = rarityObj.label || plotData.rarity;
      if (typeof map !== "undefined" && map) {
        const pt = map.project([centerLon, centerLat]);
        const popup = document.createElement("div");
        popup.className = "combat-text-popup";
        popup.style.left = `${pt.x}px`;
        popup.style.top = `${pt.y}px`;
        popup.innerHTML = `+1 ${rarityLabel} Plot!`;
        document.body.appendChild(popup);
        setTimeout(() => popup.remove(), 1100);
      }
      if (typeof AntiCheat !== "undefined") AntiCheat.recordPurchase("land", tid);
      if (typeof window.completeDailyQuest === "function") window.completeDailyQuest("survey");
      if (typeof Leaderboard !== "undefined" && Leaderboard.invalidateCache) Leaderboard.invalidateCache();
    } catch (extraErr) {
      console.warn("[Grid] Post-purchase extras notice:", extraErr && extraErr.message);
    }
  }

  async function executeBuy() {
    if (!pendingTile) return;
    if (typeof Store !== "undefined" && Store.isSessionActive && !Store.isSessionActive()) {
      const toast = window.showToast || alert;
      toast("⛔ Account active on another tab! Please refresh.", 3500);
      return;
    }
    const { tx, ty } = pendingTile;
    pendingTile = null;

    const state = Store.get();

    // 1. Strict Guest Guard: Catches Firebase Anonymous Guests too!
    const fbUser = (typeof firebase !== "undefined" && firebase.auth) ? firebase.auth().currentUser : null;
    const isGuest = fbUser ? fbUser.isAnonymous : (!state.player?.id || state.player.id.startsWith("guest-"));
    if (isGuest) {
      const toastFn = window.showToast || alert;
      toastFn("🛡️ YOU ARE A GUEST. Sign in with Google to claim permanent land!", 3500);
      onBuyAttempt(false, null);
      return;
    }

    // Cloud sync gate — block purchases until account data is fully loaded from Firestore
    if (typeof Store !== "undefined" && !Store.isCloudSyncComplete()) {
      const toastFn = window.showToast || alert;
      toastFn("⏳ Syncing your account data — please wait a moment...", 3000);
      onBuyAttempt(false, null);
      return;
    }

    // Anti-cheat: Rate limiting & replay protection
    if (typeof AntiCheat !== "undefined") {
      const purchaseId = AntiCheat.generatePurchaseId("land", tx, ty);
      const rateCheck = AntiCheat.canPurchase("land", purchaseId);
      if (!rateCheck.allowed) {
        const toastFn = window.showToast || alert;
        toastFn("🛡️ " + rateCheck.reason, 3000);
        onBuyAttempt(false, null);
        return;
      }
    }

    const modal = document.getElementById("buy-modal");
    if (modal) modal.classList.add("hidden");

    const tid = tileId(tx, ty);
    const allPlots = getAllPlots();
    if (allPlots[tid]) return;

    if (typeof ServerAntiCheat === "undefined" || !ServerAntiCheat.isReady()) {
      const toastFn = window.showToast || alert;
      toastFn("⚠️ Server connection required to claim land.", 3500);
      onBuyAttempt(false, null);
      return;
    }

    const corners = Geo.tileBounds(tx, ty, CONFIG.TILE_SIZE_METERS);
    const centerLat = (corners[0][0] + corners[2][0]) / 2;
    const centerLon = (corners[0][1] + corners[2][1]) / 2;
    const territory = await Geo.getTerritoryInfo(centerLat, centerLon);

    if (!territory || !territory.city || !territory.country) {
      if (typeof showToast === "function") showToast("📍 Could not resolve location — try a different area.", 3500);
      onBuyAttempt(false, null);
      return;
    }

    // 🛡️ SERVER-SIDE PURCHASE VALIDATION — authoritative check before any client write
    if (typeof ServerAntiCheat !== "undefined" && ServerAntiCheat.isReady() && playerCoords) {
      // Force a fresh position ping so stationary players never hit
      // "waiting for GPS lock" — the purchase itself re-verifies server-side.
      if (ServerAntiCheat.sendPosition) {
        try {
          await ServerAntiCheat.sendPosition({
            latitude: playerCoords.lat,
            longitude: playerCoords.lon,
            accuracy: 10,
            altitude: null,
            speed: null,
            altitudeAccuracy: null,
            timestamp: Date.now(),
          }, true);
        } catch (posErr) {
          console.warn("[Grid] Position ping failed (proceeding to purchase):", posErr && posErr.message);
        }
      }

      let serverResult = null;
      let transportError = false;
      try {
        serverResult = await ServerAntiCheat.validatePurchase(
          playerCoords.lat, playerCoords.lon, tx, ty, territory
        );
      } catch (callErr) {
        console.warn("[Grid] Purchase call threw:", callErr && callErr.stack || callErr);
        transportError = true;
      }

      // Transport-level failure (timeout / dropped response): the server
      // transaction may still have COMMITTED. Verify against the authoritative
      // plots collection before ever reporting a failure to the player.
      if (transportError || (serverResult && !serverResult.allowed && serverResult.reason === "server_error")) {
        const recoveredPlot = await recoverCommittedPurchase(tid);
        if (recoveredPlot) {
          applyPurchaseSuccess(recoveredPlot, tid, { recovered: true, lastLandPurchaseAt: Date.now() }, centerLat, centerLon);
          return;
        }
      }

      if (!serverResult || !serverResult.allowed) {
        const toastFn = window.showToast || alert;
        const reason = serverResult ? serverResult.reason : "server_error";
        // Sync server's cooldown timestamp to keep client in check
        if (serverResult && serverResult.lastLandPurchaseAt) {
          state.lastLandPurchaseAt = serverResult.lastLandPurchaseAt;
          Store.save(true);
        }
        // Sync server's EB balance if provided
        if (serverResult && typeof serverResult.nextEb === "number") {
          state.eb = serverResult.nextEb;
          Store.save(true);
          if (typeof updateTopbar === "function") updateTopbar();
        }
        let msg = "🛡️ Purchase rejected by server.";
        if (reason === "insufficient_eb") msg = "⚠️ Not enough EB — you need 100 EB to claim land.";
        else if (reason === "cooldown") msg = `⏳ Purchase cooldown active. Wait ${Math.ceil((serverResult?.waitMs || 5000) / 1000)}s.`;
        else if (reason === "plot_already_claimed") msg = "⚠️ This tile was just claimed by someone else!";
        else if (reason === "too_far_from_tile") msg = "🚶 You must walk closer to claim this tile.";
        else if (reason === "velocity_check_failed") msg = "🚫 Movement anomaly detected.";
        else if (reason === "position_not_verified") msg = "📍 Waiting for GPS lock — try again in a moment.";
        else if (reason === "location_not_resolved") msg = "📍 Could not resolve location — try a different area.";
        else if (reason === "server_error") msg = "⚠️ Land claim could not be verified. Try again.";
        else if (reason) msg = "🛡️ " + reason;
        toastFn(msg, 3500);
        onBuyAttempt(false, null);
        return;
      }

      // Server approved — apply authoritative results.
      applyPurchaseSuccess(serverResult.plotData, serverResult.tid, serverResult, centerLat, centerLon);
      return;
    }
  }

  function visibleTileRange() {
    const bounds = map.getBounds();
    const ts = CONFIG.TILE_SIZE_METERS;
    const sw = Geo.tileForLatLon(bounds.getSouth(), bounds.getWest(), ts);
    const ne = Geo.tileForLatLon(bounds.getNorth(), bounds.getEast(), ts);
    return {
      minTx: Math.min(sw.tx, ne.tx), maxTx: Math.max(sw.tx, ne.tx),
      minTy: Math.min(sw.ty, ne.ty), maxTy: Math.max(sw.ty, ne.ty),
    };
  }

  let renderScheduled = false;

  function scheduleRender() {
    if (renderScheduled || document.hidden) return;
    renderScheduled = true;
    requestAnimationFrame(() => {
      render();
      renderScheduled = false;
    });
  }

  // Cache tile bounds — they never change for a given tx/ty/TILE_SIZE
  const _boundsCache = {};
  function cachedTileBounds(tx, ty) {
    const key = tx + "_" + ty;
    if (!_boundsCache[key]) _boundsCache[key] = Geo.tileBounds(tx, ty, CONFIG.TILE_SIZE_METERS);
    return _boundsCache[key];
  }

  // Cache rarity color lookups
  const _rarityCache = {};
  function cachedRarityColor(rarity) {
    if (!_rarityCache[rarity]) _rarityCache[rarity] = rarityInfo(rarity).color;
    return _rarityCache[rarity];
  }

  function render() {
    // Battery Saver: Don't spend GPU/CPU cycles if phone is in pocket or map not ready!
    if (!map || !map.getStyle() || document.hidden) return;

    activeMarkers.forEach(m => m.remove());
    activeMarkers = [];

    const state = Store.get();
    const allPlots = getAllPlots();
    const zoom = map.getZoom();

    // Update 3D Standing Grass Foliage (Safeguarded against WebGL context interruption)
    if (typeof Foliage !== "undefined" && Foliage.update) {
      try {
        Foliage.update();
      } catch (err) {
        console.warn("[Foliage] Update safely bypassed:", err);
      }
    }

    // 1. RENDER CLAIMED PLOTS (With 5-Mile Horizon Culling)
    const claimedFeatures = [];
    const myPlayerId = state.player?.id;
    const refLat = (playerCoords && playerCoords.lat) ? playerCoords.lat : (map ? map.getCenter().lat : null);
    const refLon = (playerCoords && playerCoords.lon) ? playerCoords.lon : (map ? map.getCenter().lng : null);

    // Horizon cull: tight near street level, opens up as you zoom out so
    // plots stay visible all the way to Bird's Eye distance.
    // scale ≈ 1 at z>=14, doubles every zoom level below that (capped).
    const horizonM = zoom >= 14
      ? 8000
      : Math.min(2500000, 8000 * Math.pow(2, 14 - zoom));

    // Pre-compute cull radius once instead of calling haversine per plot
    const cullSquared = horizonM < Infinity ? horizonM * horizonM : Infinity;

    for (const tid in allPlots) {
      const plot = allPlots[tid];
      const bounds = cachedTileBounds(plot.tx, plot.ty);
      const coords = bounds.map(pt => [pt[1], pt[0]]);
      coords.push(coords[0]);

      if (refLat && refLon && cullSquared < Infinity) {
        const cLat = (bounds[0][0] + bounds[2][0]) / 2;
        const cLon = (bounds[0][1] + bounds[2][1]) / 2;
        // Quick squared-distance check instead of full haversine
        const dLat = (cLat - refLat) * 111320;
        const dLon = (cLon - refLon) * 111320 * Math.cos(refLat * Math.PI / 180);
        if (dLat * dLat + dLon * dLon > cullSquared) {
          continue;
        }
      }

      const isSelf = Boolean(myPlayerId && plot.ownerId === myPlayerId);

      claimedFeatures.push({
        type: "Feature",
        properties: {
          color: cachedRarityColor(plot.rarity),
          rarity: plot.rarity,
          ownerId: plot.ownerId,
          isSelf: isSelf,
          // 🍀 Lucky plots get an animated rainbow outline on the map.
          lucky: plot.lucky === true,
        },
        geometry: { type: "Polygon", coordinates: [coords] },
      });
    }

    const claimedGeoJSON = { type: "FeatureCollection", features: claimedFeatures };

    if (map.getSource("plots-source")) {
      map.getSource("plots-source").setData(claimedGeoJSON);
    } else {
      map.addSource("plots-source", { type: "geojson", data: claimedGeoJSON });

      // 1. Lush Green Grass Base (ONLY on Epic & Legendary Parcels)
      map.addLayer({
        id: "plots-grass-base",
        type: "fill",
        source: "plots-source",
        paint: {
          "fill-color": "#27ae60",
          "fill-opacity": [
            "case",
            ["in", ["get", "rarity"], ["literal", ["epic", "legendary"]]],
            ["case", ["==", ["get", "isSelf"], true], 0.35, 0.12],
            0
          ],
        },
      });

      // 2. Rarity Tint (Bright on your plots, dimmed on rivals)
      map.addLayer({
        id: "plots-fill",
        type: "fill",
        source: "plots-source",
        paint: {
          "fill-color": ["get", "color"],
          "fill-opacity": ["case", ["==", ["get", "isSelf"], true], 0.55, 0.20],
        },
      });

      // 3. Neon Rarity Borders (Thick on your plots, thin on rivals)
      // Slightly wider lines at low zoom so parcels stay readable when tiny
      map.addLayer({
        id: "plots-line",
        type: "line",
        source: "plots-source",
        paint: {
          "line-color": ["get", "color"],
          "line-width": [
            "interpolate", ["linear"], ["zoom"],
            3, ["case", ["==", ["get", "isSelf"], true], 3.5, 2],
            10, ["case", ["==", ["get", "isSelf"], true], 2.5, 1.2],
            16, ["case", ["==", ["get", "isSelf"], true], 2.5, 1.2]
          ],
          "line-opacity": ["case", ["==", ["get", "isSelf"], true], 0.95, 0.45],
        },
      });

      // 4. 🍀 LUCKY outline — dashed glowing border on Lucky plots only.
      map.addLayer({
        id: "plots-lucky-line",
        type: "line",
        source: "plots-source",
        filter: ["==", ["get", "lucky"], true],
        paint: {
          "line-color": "#8dffb0",
          "line-width": 4,
          "line-dasharray": [2, 1.4],
          "line-opacity": 0.95,
        },
      });
    }

    // 2. RENDER EMPTY PURCHASE GRID ONLY IN "BUY LAND" MODE OR ZOOM 18+
    const emptyGridFeatures = [];
    if (isBuyMode && playerCoords) {
      const ts = CONFIG.TILE_SIZE_METERS;
      const radiusM = CONFIG.DIAMOND_COLLECT_RADIUS_METERS || 50;
      const centerTile = Geo.tileForLatLon(playerCoords.lat, playerCoords.lon, ts);
      const tileRadius = Math.ceil(radiusM / ts);

      for (let dx = -tileRadius; dx <= tileRadius; dx++) {
        for (let dy = -tileRadius; dy <= tileRadius; dy++) {
          const tx = centerTile.tx + dx;
          const ty = centerTile.ty + dy;
          const tid = tileId(tx, ty);
          if (allPlots[tid]) continue;

          const bounds = Geo.tileBounds(tx, ty, ts);
          const cLat = (bounds[0][0] + bounds[2][0]) / 2;
          const cLon = (bounds[0][1] + bounds[2][1]) / 2;

          // Only tiles inside player radius
          if (Geo.haversine(playerCoords.lat, playerCoords.lon, cLat, cLon) <= radiusM) {
            const coords = bounds.map(pt => [pt[1], pt[0]]);
            coords.push(coords[0]);

            emptyGridFeatures.push({
              type: "Feature",
              properties: {
                tx,
                ty,
                selected: pendingTile && pendingTile.tx === tx && pendingTile.ty === ty,
              },
              geometry: { type: "Polygon", coordinates: [coords] },
            });
          }
        }
      }
    }

    const emptyGeoJSON = { type: "FeatureCollection", features: emptyGridFeatures };

    if (map.getSource("empty-grid-source")) {
      map.getSource("empty-grid-source").setData(emptyGeoJSON);
    } else {
      map.addSource("empty-grid-source", { type: "geojson", data: emptyGeoJSON });

      map.addLayer({
        id: "empty-grid-fill",
        type: "fill",
        source: "empty-grid-source",
        paint: {
          "fill-color": ["case", ["==", ["get", "selected"], true], "#ffffff", "#4fd6c4"],
          "fill-opacity": ["case", ["==", ["get", "selected"], true], 0.65, 0.14],
        },
      });

      map.addLayer({
        id: "empty-grid-line",
        type: "line",
        source: "empty-grid-source",
        paint: {
          "line-color": ["case", ["==", ["get", "selected"], true], "#ffffff", "#4fd6c4"],
          "line-width": ["case", ["==", ["get", "selected"], true], 2.5, 1.2],
        },
      });
    }

    // 2b. ASCENSION SELECTION OVERLAY — own plots within reach radius
    const ascensionFeatures = [];
    if (isAscensionMode && playerCoords) {
      const ts = CONFIG.TILE_SIZE_METERS;
      const radiusM = CONFIG.DIAMOND_COLLECT_RADIUS_METERS || 75;
      const selMap = {};
      ascensionSelections.forEach((s, i) => { selMap[s.tid] = i; });

      for (const tid in allPlots) {
        const plot = allPlots[tid];
        if (!myPlayerId || plot.ownerId !== myPlayerId) continue;
        const rKey = String(plot.rarity?.key || plot.rarity || "common").toLowerCase();
        if (rKey === "legendary") continue;

        const bounds = cachedTileBounds(plot.tx, plot.ty);
        const cLat = (bounds[0][0] + bounds[2][0]) / 2;
        const cLon = (bounds[0][1] + bounds[2][1]) / 2;
        if (Geo.haversine(playerCoords.lat, playerCoords.lon, cLat, cLon) > radiusM) continue;

        const coords = bounds.map(pt => [pt[1], pt[0]]);
        coords.push(coords[0]);
        const selIdx = selMap[tid];
        let role = "eligible";
        if (selIdx === 0) role = "target";
        else if (selIdx > 0) role = "sacrifice";
        // After target chosen, only same-rarity plots remain eligible
        let selectable = true;
        if (ascensionSelections.length > 0) {
          const targetRarity = String(ascensionSelections[0].rarity || "").toLowerCase();
          if (rKey !== targetRarity && role === "eligible") selectable = false;
        }

        ascensionFeatures.push({
          type: "Feature",
          properties: { tid, rarity: rKey, role, selectable, selIdx },
          geometry: { type: "Polygon", coordinates: [coords] },
        });
      }
    }

    const ascensionGeoJSON = { type: "FeatureCollection", features: ascensionFeatures };

    if (map.getSource("ascension-select-source")) {
      map.getSource("ascension-select-source").setData(ascensionGeoJSON);
    } else if (ascensionFeatures.length > 0 || isAscensionMode) {
      map.addSource("ascension-select-source", { type: "geojson", data: ascensionGeoJSON });
      map.addLayer({
        id: "ascension-select-fill",
        type: "fill",
        source: "ascension-select-source",
        paint: {
          "fill-color": [
            "case",
            ["==", ["get", "role"], "target"], "#ff2b43",
            ["==", ["get", "role"], "sacrifice"], "#d1495b",
            ["==", ["get", "selectable"], true], "#ff2b43",
            "#8fa3b8"
          ],
          "fill-opacity": [
            "case",
            ["==", ["get", "role"], "target"], 0.7,
            ["==", ["get", "role"], "sacrifice"], 0.65,
            ["==", ["get", "selectable"], true], 0.28,
            0.08
          ],
        },
      });
      map.addLayer({
        id: "ascension-select-line",
        type: "line",
        source: "ascension-select-source",
        paint: {
          "line-color": [
            "case",
            ["==", ["get", "role"], "target"], "#ffffff",
            ["==", ["get", "role"], "sacrifice"], "#ffb3bd",
            ["==", ["get", "selectable"], true], "#ff2b43",
            "#4a5568"
          ],
          "line-width": [
            "case",
            ["==", ["get", "role"], "target"], 3.2,
            ["==", ["get", "role"], "sacrifice"], 2.6,
            ["==", ["get", "selectable"], true], 2.0,
            1.0
          ],
          "line-dasharray": [
            "case",
            ["==", ["get", "role"], "target"], ["literal", [1, 0]],
            ["literal", [2, 1.5]]
          ],
        },
      });
    }

    // 3. RENDER CLUSTERED AVATARS & EXTRACTOR BEACONS (1 Avatar per Connected Territory)
    if (zoom >= 14) {
      const visited = new Set();
      let playerExtractorRendered = false;

      // Find all connected tile clusters using 4-directional flood fill
      for (const startTid in allPlots) {
        if (visited.has(startTid)) continue;

        const startPlot = allPlots[startTid];
        const clusterOwnerId = startPlot.ownerId;
        const cluster = [];
        const queue = [startPlot];
        visited.add(startTid);

        while (queue.length > 0) {
          const current = queue.shift();
          cluster.push(current);

          // Guarantee integer values to prevent string concatenation ("100" + 1 = "1001")
          const cx = parseInt(current.tx, 10);
          const cy = parseInt(current.ty, 10);

          // Check 4 adjacent orthogonal neighbors (N, S, E, W)
          const neighbors = [
            tileId(cx + 1, cy),
            tileId(cx - 1, cy),
            tileId(cx, cy + 1),
            tileId(cx, cy - 1),
          ];

          for (const nId of neighbors) {
            if (!visited.has(nId) && allPlots[nId] && allPlots[nId].ownerId === clusterOwnerId) {
              visited.add(nId);
              queue.push(allPlots[nId]);
            }
          }
        }

        // Calculate average centroid for the entire connected cluster
        let totalLat = 0;
        let totalLon = 0;

        for (const p of cluster) {
          let px = parseInt(p.tx, 10);
          let py = parseInt(p.ty, 10);

          // Auto-recover tx/ty from plot ID if missing in Firestore!
          if (isNaN(px) || isNaN(py)) {
            const tidStr = p.id || startTid || "";
            const parts = tidStr.split("_");
            if (parts.length === 2) {
              px = parseInt(parts[0], 10);
              py = parseInt(parts[1], 10);
              p.tx = px;
              p.ty = py;
            }
          }

          if (!isNaN(px) && !isNaN(py)) {
            const centerMerc = Geo.fromMercator(
              px * CONFIG.TILE_SIZE_METERS + CONFIG.TILE_SIZE_METERS / 2,
              py * CONFIG.TILE_SIZE_METERS + CONFIG.TILE_SIZE_METERS / 2
            );
            totalLat += centerMerc.lat;
            totalLon += centerMerc.lon;
          }
        }

        if (cluster.length === 0) continue;

        const centroidLat = totalLat / cluster.length;
        const centroidLon = totalLon / cluster.length;

        // 🛡️ NaN SANITY GUARD: Never pass invalid NaN coordinates to MapLibre!
        if (isNaN(centroidLat) || isNaN(centroidLon) || !isFinite(centroidLat) || !isFinite(centroidLon)) {
          continue; // Skip invalid marker safely without crashing!
        }

        // 5KM HORIZON CULLING: Don't render signboards for plots in Ohio, Canada, or Indiana!
        const refLat = (playerCoords && playerCoords.lat) ? playerCoords.lat : (map ? map.getCenter().lat : null);
        const refLon = (playerCoords && playerCoords.lon) ? playerCoords.lon : (map ? map.getCenter().lng : null);
        if (refLat && refLon) {
          const dist = Geo.haversine(refLat, refLon, centroidLat, centroidLon);
          if (dist > 40000) continue; // 25-mile bird's-eye city view; keep city billboard density readable
        }

        const isSelf = clusterOwnerId === state.player.id;
        const rep = cluster[0];
        const avatar = isSelf ? (state.player.avatar || "🙂") : (rep.avatar || "🙂");

        const innerContent = avatar.startsWith("img:")
          ? `<img src="${avatar.slice(4)}" style="width:18px;height:18px;border-radius:50%;object-fit:cover;display:block;">`
          : `<span style="font-size:11px;line-height:1;">${avatar}</span>`;

        // Count badge if more than 1 tile connected
        const countBadge = cluster.length > 1
          ? `<span style="position:absolute;bottom:-3px;right:-3px;background:#d4af61;color:#0b1118;font-size:8px;font-weight:800;border-radius:8px;padding:0 4px;box-shadow:0 0 3px rgba(0,0,0,0.9);line-height:1.3;">${cluster.length}</span>`
          : "";

        const el = document.createElement("div");
        el.className = "custom-plot-icon standing-plot-sign";
        el.innerHTML = `
          <div class="sign-avatar-disc">
            ${innerContent}
            ${countBadge}
          </div>
          <div class="sign-stem"></div>
          <div class="sign-ground-shadow"></div>
        `;

        el.addEventListener("click", () => {
          const evt = new CustomEvent("openPlayerInfo", { detail: { cluster, isSelf } });
          window.dispatchEvent(evt);
        });

        // "viewport" makes the sign stand vertically upright & billboard toward the player camera
        const m = new mapboxgl.Marker({
          element: el,
          anchor: "bottom",              // Anchors the bottom tip of the stem to the exact ground coordinates
          pitchAlignment: "viewport",    // Stands vertically upright (not flat on the ground)
          rotationAlignment: "viewport", // Rotates to continuously face the camera
        })
          .setLngLat([centroidLon, centroidLat])
          .addTo(map);

        activeMarkers.push(m);

        // Mount Extractor at the centroid if criteria met
        if (isSelf && Object.keys(state.plots || {}).length >= (CONFIG.EXTRACTOR_MIN_TILES || 5) && !playerExtractorRendered) {
          playerExtractorRendered = true;

          const beaconEl = document.createElement("div");
          beaconEl.className = "extractor-3d-wrap standing-extractor-wrap";
          beaconEl.innerHTML = `
            <div class="beacon-root">
              <div class="beacon-ground-aura"></div>
              <div class="orbit-ring ring-1"></div>
              <div class="orbit-ring ring-2"></div>
              <div class="beacon-core-gem">
                <img src="assets/mine-extractor.png" class="beacon-img" alt="Extractor">
              </div>
            </div>
          `;
          beaconEl.dataset.extractor = "1";
          beaconEl.addEventListener("click", () => {
            // Orbital rings/gem only animate while the extractor modal is open
            beaconEl.classList.add("is-active");
            const evt = new CustomEvent("openExtractorModal");
            window.dispatchEvent(evt);
          });

          // Upright 2.5D billboard that faces the player's camera smoothly
          const extMarker = new mapboxgl.Marker({
            element: beaconEl,
            anchor: "bottom",              // Grounded at the bottom
            pitchAlignment: "viewport",    // Stands vertically upright in 3D
            rotationAlignment: "viewport", // Always rotates to face the player
          })
            .setLngLat([centroidLon + 0.00008, centroidLat + 0.00008])
            .addTo(map);

          activeMarkers.push(extMarker);
        }
      }
    }

    // Keep the extractor animating across re-renders while its modal is open
    const extractorModal = document.getElementById("extractor-modal");
    if (extractorModal && !extractorModal.classList.contains("hidden")) {
      activeMarkers.forEach(m => {
        const node = m.getElement();
        if (node && node.dataset.extractor) node.classList.add("is-active");
      });
    }
  }

  function setPlayerPosition(lat, lon) {
    playerCoords = { lat, lon };
  }

  function getPlayerPosition() {
    return playerCoords ? { ...playerCoords } : null;
  }

  function setBuyMode(active, coords = null) {
    isBuyMode = active;
    if (coords) playerCoords = coords;
    scheduleRender();
  }

  function handleAscensionClick(lngLat) {
    if (!isAscensionMode || !onAscensionPick) return;
    const ts = CONFIG.TILE_SIZE_METERS || 6.096;
    const radiusM = CONFIG.DIAMOND_COLLECT_RADIUS_METERS || 75;
    const { lng, lat } = lngLat;

    if (playerCoords && playerCoords.lat) {
      const dist = Geo.haversine(playerCoords.lat, playerCoords.lon, lat, lng);
      if (dist > radiusM) {
        if (typeof showToast === "function") {
          showToast("🚶 Walk closer! That plot is outside your reach circle.", 2500);
        }
        return;
      }
    }

    const t = Geo.tileForLatLon(lat, lng, ts);
    const tid = tileId(t.tx, t.ty);
    const plot = getAllPlots()[tid];
    const state = Store.get();
    if (!plot || plot.ownerId !== state.player?.id) {
      if (typeof showToast === "function") {
        showToast("⚠️ Select one of your own plots.", 2200);
      }
      return;
    }
    const rKey = String(plot.rarity?.key || plot.rarity || "common").toLowerCase();
    if (rKey === "legendary") {
      if (typeof showToast === "function") {
        showToast("⚠️ Legendary plots cannot be used in the Forge.", 2500);
      }
      return;
    }
    // Enforce same-rarity after target is chosen
    if (ascensionSelections.length > 0) {
      const targetRarity = String(ascensionSelections[0].rarity || "").toLowerCase();
      if (rKey !== targetRarity) {
        if (typeof showToast === "function") {
          showToast(`⚠️ Sacrifices must be ${targetRarity.toUpperCase()}.`, 2500);
        }
        return;
      }
      const already = ascensionSelections.some(s => s.tid === tid);
      if (already) {
        if (typeof showToast === "function") showToast("⚠️ That plot is already selected.", 2000);
        return;
      }
    }

    onAscensionPick({
      tid,
      tx: t.tx,
      ty: t.ty,
      rarity: rKey,
      rate: plot.rate,
    });
    scheduleRender();
  }

  function setAscensionMode(active, opts = {}) {
    isAscensionMode = !!active;
    if (!active) {
      ascensionSelections = [];
      onAscensionPick = null;
      // Clear overlay by emptying the source
      if (map && map.getSource("ascension-select-source")) {
        map.getSource("ascension-select-source").setData({ type: "FeatureCollection", features: [] });
      }
    } else {
      if (opts.coords) playerCoords = opts.coords;
      onAscensionPick = opts.onPick || null;
      ascensionSelections = [];
    }
    scheduleRender();
  }

  function getAscensionSelections() {
    return ascensionSelections.map(s => ({ ...s }));
  }

  function setAscensionSelections(list) {
    ascensionSelections = Array.isArray(list) ? list.slice(0, 3) : [];
    scheduleRender();
  }

  function getMap() {
    return map;
  }

  function projectTid(tid) {
    if (!map) return null;
    const parts = String(tid || "").split("_");
    const tx = parseInt(parts[0], 10);
    const ty = parseInt(parts[1], 10);
    if (!Number.isFinite(tx) || !Number.isFinite(ty)) return null;
    const ts = CONFIG.TILE_SIZE_METERS || 6.096;
    const b = Geo.tileBounds(tx, ty, ts);
    const lat = (b[0][0] + b[2][0]) / 2;
    const lon = (b[0][1] + b[2][1]) / 2;
    try {
      const p = map.project([lon, lat]);
      return { x: p.x, y: p.y };
    } catch (e) {
      return null;
    }
  }

  function setGlobalPlot(tid, data) {
    globalPlots[tid] = data;
    scheduleRender();
  }

  function listenToGlobalPlots() {
    const db = Store.getDb();
    if (!db) return;

    try {
      db.collection("plots").onSnapshot((snapshot) => {
        snapshot.docChanges().forEach((change) => {
          const tid = change.doc.id;
          const data = change.doc.data();
          if (change.type === "added" || change.type === "modified") {
            globalPlots[tid] = data;
            // Keep local mirror in sync with server truth
            const st = Store.get();
            if (st && st.player && data.ownerId === st.player.id) {
              if (!st.plots) st.plots = {};
              st.plots[tid] = data;
            }
          } else if (change.type === "removed") {
            delete globalPlots[tid];
            // Server deleted this plot (pickup/relocate) — drop the local copy
            // too, otherwise getAllPlots keeps rendering the ghost forever.
            const st = Store.get();
            if (st && st.plots && st.plots[tid]) {
              delete st.plots[tid];
            }
          }
        });
        render();
        // Invalidate leaderboard cache when plots change so mayorship updates in realtime
        if (typeof Leaderboard !== "undefined" && Leaderboard.invalidateCache) {
          Leaderboard.invalidateCache();
        }
      }, (err) => console.warn("[Multiplayer] Sync error:", err));
    } catch (err) {
      console.warn("[Multiplayer] Listener error:", err);
    }
  }

  function init(mapboxMap, callbacks) {
    map = mapboxMap;
    onBuyAttempt = callbacks.onBuyAttempt || onBuyAttempt;

    map.on("click", (e) => {
      if (isAscensionMode) {
        handleAscensionClick(e.lngLat);
        return;
      }
      if (!isBuyMode) return; // Only allow buying in Buy Land mode
      const { lng, lat } = e.lngLat;
      const ts = CONFIG.TILE_SIZE_METERS || 6.096;
      const radiusM = CONFIG.DIAMOND_COLLECT_RADIUS_METERS || 75;

      // Strict Reach Radius Guard: Block any tile clicked outside the circle!
      if (playerCoords && playerCoords.lat) {
        const dist = Geo.haversine(playerCoords.lat, playerCoords.lon, lat, lng);
        if (dist > radiusM) {
          if (typeof showToast === "function") {
            showToast("🚶 Walk closer! That tile is outside your reach circle.", 2500);
          }
          return; // Block click!
        }
      }

      const t = Geo.tileForLatLon(lat, lng, ts);
      promptBuyTile(t.tx, t.ty);
    });

    // Wire up Persistent Click Listeners for Claim Modal
    const confirmBtn = document.getElementById("buy-confirm-btn");
    const cancelBtn = document.getElementById("buy-cancel-btn");
    const plantBtn = document.getElementById("plant-capsule-confirm-btn");
    const bagBtn = document.getElementById("plot-bag-btn");
    const buyModal = document.getElementById("buy-modal");

    confirmBtn?.addEventListener("click", () => {
      executeBuy();
    });

    cancelBtn?.addEventListener("click", () => {
      pendingTile = null;
      if (buyModal) buyModal.classList.add("hidden");
    });

    plantBtn?.addEventListener("click", async () => {
      if (pendingTile && typeof Citadels !== "undefined") {
        const corners = Geo.tileBounds(pendingTile.tx, pendingTile.ty, CONFIG.TILE_SIZE_METERS);
        const cLat = (corners[0][0] + corners[2][0]) / 2;
        const cLon = (corners[0][1] + corners[2][1]) / 2;
        const planted = await Citadels.plantCapsule(pendingTile.tx, pendingTile.ty, cLat, cLon);
        if (planted) {
          pendingTile = null;
          if (buyModal) buyModal.classList.add("hidden");
        }
      }
    });

    document.getElementById("plant-elden-stop-btn")?.addEventListener("click", async () => {
      if (!pendingTile || typeof EldenStops === "undefined") return;
      const planted = await EldenStops.plantSeed(pendingTile.tx, pendingTile.ty);
      if (planted) {
        pendingTile = null;
        if (buyModal) buyModal.classList.add("hidden");
      }
    });

    bagBtn?.addEventListener("click", openPlotBag);
    document.getElementById("plot-relocate-btn")?.addEventListener("click", relocatePlot);
    document.getElementById("plot-ascend-btn")?.addEventListener("click", () => {
      if (selectedPlotId && typeof PlotAscension !== "undefined") {
        document.getElementById("plot-modal")?.classList.add("hidden");
        PlotAscension.openForge(selectedPlotId);
      }
    });

    // Debounced renders prevent lag during rapid zoom/orbit gestures
    map.on("moveend zoomend", scheduleRender);

    // Auto-refresh plots when phone is unlocked
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) {
        scheduleRender();
      }
    });

    listenToGlobalPlots();
    scheduleRender();
  }

  return { init, render, promptBuyTile, executeBuy, getAllPlots, setBuyMode, setAscensionMode, getAscensionSelections, setAscensionSelections, getMap, projectTid, setGlobalPlot, setPlayerPosition, getPlayerPosition };
})();
