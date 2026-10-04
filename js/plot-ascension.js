// ============================================================
// Elden Earth — Plot Ascension Forge
// 3 same-rarity plots → 1 next-rarity plot (server-authoritative)
// Map selection (Buy-Land style) + Thanos-snap FX + Complete screen
// ============================================================
const PlotAscension = (() => {
  const RARITY_ORDER = ["common", "rare", "epic", "legendary"];

  let isOpen = false;
  let isPicking = false;
  let preselectTid = null;
  let selections = []; // [{tid, tx, ty, rarity, rate}]
  let incomeBefore = 0;
  let plotsBefore = 0;
  let lastResult = null;

  const toast = (msg, ms = 2800) => {
    if (typeof window !== "undefined" && typeof window.showToast === "function") window.showToast(msg, ms);
    else console.log("[PlotAscension]", msg);
  };

  const el = (id) => document.getElementById(id);

  function rarityConf(key) {
    return (CONFIG.PLOT_RARITIES || []).find(r => r.key === key) || CONFIG.PLOT_RARITIES[0];
  }

  function ascensionCost(rarityKey) {
    return (CONFIG.PLOT_ASCENSION || {})[rarityKey] || null;
  }

  function formatIncome(val) {
    if (!Number.isFinite(val)) return "0";
    if (val === 0) return "0";
    // Show enough precision for micro-rent rates
    const s = val.toFixed(12).replace(/\.?0+$/, "");
    return s || "0";
  }

  function formatCash(val) {
    return "$" + (Number(val) || 0).toFixed(2);
  }

  function tileCenter(tx, ty) {
    const ts = CONFIG.TILE_SIZE_METERS || 6.096;
    const b = Geo.tileBounds(tx, ty, ts);
    return {
      lat: (b[0][0] + b[2][0]) / 2,
      lon: (b[0][1] + b[2][1]) / 2,
    };
  }

  function countOwnPlotsByRarity() {
    const state = Store.get();
    const counts = { common: 0, rare: 0, epic: 0, legendary: 0 };
    for (const id in state.plots) {
      const r = state.plots[id].rarity?.key || state.plots[id].rarity;
      if (counts[r] !== undefined) counts[r]++;
    }
    return counts;
  }

  // ---------------- Modal open / close ----------------

  function openForge(preselect = null) {
    const state = Store.get();
    if (!state.player?.id) {
      toast("⚠️ Sign in to use the Ascension Forge.");
      return;
    }
    if (typeof ServerAntiCheat === "undefined" || !ServerAntiCheat.isReady()) {
      toast("⚠️ Server connection required to use the Forge.", 3500);
      return;
    }

    isOpen = true;
    isPicking = false;
    preselectTid = preselect || null;
    selections = [];
    incomeBefore = Store.totalRate();
    plotsBefore = Object.keys(state.plots || {}).length;

    // If preselect is a valid own plot, seed it as Target
    if (preselectTid) {
      const plot = state.plots[preselectTid];
      if (plot && plot.ownerId === state.player.id) {
        const rKey = String(plot.rarity?.key || plot.rarity || "common").toLowerCase();
        if (rKey === "legendary") {
          toast("⚠️ Legendary plots cannot be Ascended further.");
          isOpen = false;
          return;
        }
        selections = [{
          tid: preselectTid,
          tx: plot.tx,
          ty: plot.ty,
          rarity: rKey,
          rate: plot.rate,
        }];
      }
    }

    renderForge();
    el("land-modal")?.classList.add("hidden");
    el("ascension-complete-modal")?.classList.add("hidden");
    el("ascension-modal")?.classList.remove("hidden");
  }

  function closeForge() {
    const wasPicking = isPicking;
    isOpen = false;
    // Removes body.buy-mode (HUD) + restores camera only if map pick was active
    exitMapPickMode(true);
    // Belt-and-suspenders: never leave HUD-hiding classes stuck on <body>
    document.body.classList.remove("ascension-pick-mode", "buy-mode");
    el("ascension-map-hud")?.classList.add("hidden");
    el("ascension-modal")?.classList.add("hidden");
    if (typeof Grid !== "undefined") {
      Grid.setAscensionMode?.(false);
      Grid.setBuyMode?.(false);
    }
    selections = [];
    preselectTid = null;
    if (wasPicking) {
      // Ensure map re-renders after overlay layers are cleared
      Grid.render?.();
    }
  }

  /** Hard restore to normal game HUD/camera — safe to call anytime. */
  function forceExitToNormalGame() {
    const wasPicking = isPicking;
    isPicking = false;
    isOpen = false;
    document.body.classList.remove("ascension-pick-mode", "buy-mode");
    el("ascension-map-hud")?.classList.add("hidden");
    el("ascension-modal")?.classList.add("hidden");
    el("ascension-complete-modal")?.classList.add("hidden");
    if (typeof Grid !== "undefined") {
      Grid.setAscensionMode?.(false);
      Grid.setBuyMode?.(false);
      Grid.render?.();
    }
    // Only yank the camera if the player was actually stuck in pick mode
    if (wasPicking) {
      const map = Grid.getMap && Grid.getMap();
      const pos = (typeof window.getPlayerPosition === "function" && window.getPlayerPosition())
        || (Grid.getPlayerPosition && Grid.getPlayerPosition());
      if (map) {
        map.setMinPitch(0);
        map.setMaxPitch(80);
        map.setMinZoom(2);
        map.setMaxZoom(20.0);
        if (pos && pos.lat) {
          map.flyTo({
            center: [pos.lon, pos.lat],
            pitch: 70,
            zoom: 18.4,
            duration: 800,
            essential: true,
          });
        } else {
          map.easeTo({ pitch: 70, zoom: 18.4, duration: 800 });
        }
      }
    }
    selections = [];
    preselectTid = null;
  }

  function renderForge() {
    const state = Store.get();
    const target = selections[0] || null;
    const rKey = target ? target.rarity : "common";
    const costs = ascensionCost(rKey) || ascensionCost("common");
    const nextKey = costs?.next || "rare";
    const fromConf = rarityConf(rKey);
    const toConf = rarityConf(nextKey);

    const fromTier = el("asc-from-tier");
    const toTier = el("asc-to-tier");
    if (fromTier) {
      fromTier.textContent = fromConf.label;
      fromTier.style.color = fromConf.color;
    }
    if (toTier) {
      toTier.textContent = toConf.label;
      toTier.style.color = toConf.color;
    }
    const fromRate = el("asc-from-rate");
    const toRate = el("asc-to-rate");
    if (fromRate) fromRate.textContent = `$${formatIncome(fromConf.rate)} /s`;
    if (toRate) toRate.textContent = `$${formatIncome(toConf.rate)} /s`;

    // Slots
    const setSlot = (id, text, cls) => {
      const node = el(id);
      if (!node) return;
      node.textContent = text;
      const slot = node.closest(".asc-slot");
      if (slot) {
        slot.classList.remove("filled-target", "filled-sacrifice");
        if (cls) slot.classList.add(cls);
      }
    };

    if (target) {
      setSlot("asc-slot-target", `[${target.tx}, ${target.ty}] ${fromConf.label}`, "filled-target");
    } else {
      setSlot("asc-slot-target", "— select on map —", null);
    }

    const sac1 = selections[1];
    const sac2 = selections[2];
    if (sac1) setSlot("asc-slot-sac1", `[${sac1.tx}, ${sac1.ty}]`, "filled-sacrifice");
    else setSlot("asc-slot-sac1", "—", null);
    if (sac2) setSlot("asc-slot-sac2", `[${sac2.tx}, ${sac2.ty}]`, "filled-sacrifice");
    else setSlot("asc-slot-sac2", "—", null);

    // Costs
    const costEb = el("asc-cost-eb");
    const costCash = el("asc-cost-cash");
    const costBal = el("asc-cost-balance");
    if (costEb) costEb.textContent = `${costs.eb} EB`;
    if (costCash) costCash.textContent = formatCash(costs.cashRequired);
    if (costBal) {
      costBal.textContent = `${formatIncome(state.eb)} EB · ${formatCash(state.cash)}`;
    }

    // Gates
    const locked = el("asc-locked-notice");
    const confirmBtn = el("asc-confirm-btn");
    const selectBtn = el("asc-select-btn");
    const hasEnough = (Number(state.eb) || 0) >= costs.eb && (Number(state.cash) || 0) >= costs.cashRequired;
    const ready = selections.length === 3 && hasEnough;

    if (confirmBtn) confirmBtn.classList.toggle("hidden", !ready);
    if (selectBtn) {
      selectBtn.classList.toggle("hidden", ready);
      selectBtn.textContent = selections.length > 0
        ? "🗺 Choose Sacrifices on Map"
        : "🗺 Choose Plots on Map";
    }

    if (locked) {
      if (!hasEnough) {
        locked.classList.remove("hidden");
        locked.innerHTML = `🔒 Need <strong>${costs.eb} EB</strong> + <strong>${formatCash(costs.cashRequired)}</strong> Cash to Ascend.`;
      } else if (selections.length < 3) {
        locked.classList.remove("hidden");
        locked.innerHTML = `🗺 Select <strong>1 Target</strong> + <strong>2 Sacrifices</strong> on the map (${3 - selections.length} remaining).`;
      } else {
        locked.classList.add("hidden");
        locked.innerHTML = "";
      }
    }
  }

  // ---------------- Map pick mode (Buy-Land style top-down) ----------------

  function enterMapPickMode() {
    const map = Grid.getMap && Grid.getMap();
    const pos = (typeof window.getPlayerPosition === "function" && window.getPlayerPosition())
      || Grid.getPlayerPosition();
    if (!map || !pos || !pos.lat) {
      toast("⚠️ GPS position required to pick plots on the map.", 3500);
      return;
    }

    isPicking = true;
    el("ascension-modal")?.classList.add("hidden");
    el("ascension-map-hud")?.classList.remove("hidden");
    // buy-mode hides topbar/bottombar/side-hud via CSS — removed again on exit
    document.body.classList.add("buy-mode", "ascension-pick-mode");
    // Don't leave Buy Land empty-tile grid competing with ascension highlights
    if (typeof Grid !== "undefined" && Grid.setBuyMode) Grid.setBuyMode(false);

    // Top-down camera like Buy Land
    map.setMinPitch(0);
    map.setMaxPitch(0);
    map.setMinZoom(17.5);
    map.setMaxZoom(20.0);
    map.flyTo({
      center: [pos.lon, pos.lat],
      pitch: 0,
      bearing: 0,
      zoom: 18.0,
      duration: 800,
      essential: true,
    });

    // Keep a preselected Target; otherwise start clean
    if (!preselectTid || selections.length === 0) selections = [];

    Grid.setAscensionMode(true, {
      coords: { lat: pos.lat, lon: pos.lon },
      onPick: handleMapPick,
    });
    Grid.setAscensionSelections(selections);
    updateHud();
  }

  function exitMapPickMode(silent = false) {
    const wasPicking = isPicking;
    isPicking = false;

    // CRITICAL: buy-mode CSS hides #topbar, #bottombar, .side-hud-stack, etc.
    document.body.classList.remove("ascension-pick-mode", "buy-mode");
    el("ascension-map-hud")?.classList.add("hidden");

    if (typeof Grid !== "undefined" && Grid.setAscensionMode) {
      Grid.setAscensionMode(false);
    }
    if (typeof Grid !== "undefined" && Grid.setBuyMode) {
      Grid.setBuyMode(false);
    }
    if (typeof Grid !== "undefined" && Grid.render) {
      Grid.render();
    }

    // Restore normal 3D camera (mirror exitBuyLandMode in main.js)
    const map = Grid.getMap && Grid.getMap();
    const pos = (typeof window.getPlayerPosition === "function" && window.getPlayerPosition())
      || (Grid.getPlayerPosition && Grid.getPlayerPosition());
    if (map && wasPicking) {
      map.setMinPitch(0);
      map.setMaxPitch(80);
      map.setMinZoom(2);
      map.setMaxZoom(20.0);
      if (pos && pos.lat) {
        map.flyTo({
          center: [pos.lon, pos.lat],
          pitch: 70,
          zoom: 18.4,
          duration: 800,
          essential: true,
        });
      } else {
        map.easeTo({ pitch: 70, zoom: 18.4, duration: 800 });
      }
    }

    if (!silent && isOpen) {
      el("ascension-modal")?.classList.remove("hidden");
      renderForge();
    }
  }

  function handleMapPick(pick) {
    if (!pick || !pick.tid) return;
    const exists = selections.findIndex(s => s.tid === pick.tid);
    if (exists === 0) {
      // Tapping target again clears everything
      selections = [];
      Grid.setAscensionSelections(selections);
      updateHud();
      toast("Selection cleared.");
      return;
    }
    if (exists > 0) {
      selections.splice(exists, 1);
      Grid.setAscensionSelections(selections);
      updateHud();
      return;
    }

    if (selections.length === 0) {
      selections = [pick];
      toast(`🎯 Target set: ${pick.rarity.toUpperCase()} [${pick.tx}, ${pick.ty}]`, 2200);
    } else if (selections.length < 3) {
      const targetRarity = selections[0].rarity;
      if (pick.rarity !== targetRarity) {
        toast(`⚠️ Sacrifices must be ${targetRarity.toUpperCase()}.`, 2500);
        return;
      }
      selections.push(pick);
      const n = selections.length - 1;
      toast(`🔥 Sacrifice ${n} set: [${pick.tx}, ${pick.ty}]`, 2000);
    }

    Grid.setAscensionSelections(selections);
    updateHud();

    if (selections.length === 3) {
      toast("✅ 3 plots selected — tap Done to review costs.", 3000);
    }
  }

  function updateHud() {
    const setChip = (id, text, mode) => {
      const n = el(id);
      if (!n) return;
      n.textContent = text;
      n.classList.remove("filled", "filled-target");
      if (mode) n.classList.add(mode);
    };
    const t = selections[0];
    const s1 = selections[1];
    const s2 = selections[2];
    setChip("asc-hud-target", t ? `Target: ${t.rarity} [${t.tx},${t.ty}]` : "Target: —", t ? "filled-target" : null);
    setChip("asc-hud-sac1", s1 ? `Sac1: [${s1.tx},${s1.ty}]` : "Sac 1: —", s1 ? "filled" : null);
    setChip("asc-hud-sac2", s2 ? `Sac2: [${s2.tx},${s2.ty}]` : "Sac 2: —", s2 ? "filled" : null);

    const hint = el("asc-hud-hint");
    if (hint) {
      if (!t) hint.textContent = "Tap one of your plots to set the TARGET (gold).";
      else if (!s1) hint.textContent = `Now tap 2 more ${t.rarity.toUpperCase()} plots as sacrifices.`;
      else if (!s2) hint.textContent = `One more ${t.rarity.toUpperCase()} sacrifice to go.`;
      else hint.textContent = "All set! Tap Done to review forge costs.";
    }

    const doneBtn = el("asc-hud-done-btn");
    if (doneBtn) doneBtn.disabled = selections.length !== 3;
  }

  // ---------------- Confirm + execute ----------------

  async function confirmAscension() {
    const state = Store.get();
    if (selections.length !== 3) {
      toast("⚠️ Select 1 Target + 2 Sacrifices first.");
      return;
    }
    const target = selections[0];
    const costs = ascensionCost(target.rarity);
    if (!costs) {
      toast("⚠️ This rarity cannot be Ascended.");
      return;
    }
    if ((Number(state.eb) || 0) < costs.eb) {
      toast(`🔒 You need ${costs.eb} EB.`);
      return;
    }
    if ((Number(state.cash) || 0) < costs.cashRequired) {
      toast(`🔒 You need ${formatCash(costs.cashRequired)} Cash.`);
      return;
    }

    const fromConf = rarityConf(target.rarity);
    const toConf = rarityConf(costs.next);
    const ok = await window.gameConfirm(
      `Ascend [${target.tx}, ${target.ty}] from ${fromConf.label} to ${toConf.label}?\n\n` +
      `Sacrifices (PERMANENTLY DESTROYED):\n` +
      `• [${selections[1].tx}, ${selections[1].ty}]\n` +
      `• [${selections[2].tx}, ${selections[2].ty}]\n\n` +
      `Cost: ${costs.eb} EB + ${formatCash(costs.cashRequired)} Cash`,
      { okText: "⚒ Ascend" }
    );
    if (!ok) return;

    if (typeof ServerAntiCheat === "undefined" || !ServerAntiCheat.isReady()) {
      toast("⚠️ Server connection required.", 3500);
      return;
    }

    // Project sacrifice/target screen positions BEFORE exiting pick mode / mutating map
    const fxPoints = selections.map(s => ({
      tid: s.tid,
      rarity: s.rarity,
      pos: (Grid.projectTid && Grid.projectTid(s.tid)) || null,
    }));

    // Capture "before" metrics immediately prior to server mutation
    incomeBefore = Store.totalRate();
    plotsBefore = Object.keys(Store.get().plots || {}).length;

    const payload = {
      targetTid: target.tid,
      sacrifice: [
        { type: "map", tid: selections[1].tid },
        { type: "map", tid: selections[2].tid },
      ],
    };

    toast("⚒ Forging at the Ascension Forge…", 2500);

    let result;
    try {
      result = await ServerAntiCheat.ascendPlot(payload);
    } catch (e) {
      console.warn("[PlotAscension] ascendPlot threw:", e);
      result = { ok: false, reason: "server_error" };
    }

    // Transport failure recovery: check server truth
    if (result && result.ok === false && result.reason === "server_error") {
      const recovered = await recoverAscension(target.tid);
      if (recovered) result = recovered;
    }

    if (!result || !result.ok) {
      const msgs = {
        not_enough_eb: "🔒 Not enough EB.",
        not_enough_cash: "🔒 Not enough Cash.",
        not_enough_plots: "⚠️ Not enough same-rarity plots.",
        legendary_max: "⚠️ Legendary is the maximum rarity.",
        not_your_plot: "⚠️ You can only Ascend your own plots.",
        sacrifice_is_target: "⚠️ Invalid sacrifice selection.",
        invalid_sacrifice: "⚠️ Invalid sacrifice selection.",
        target_not_found: "⚠️ Target plot no longer exists.",
        sacrifice_not_found: "⚠️ A sacrifice plot no longer exists.",
        rate_limited: "⏳ Forge rate limit — try again shortly.",
        no_save_found: "⚠️ Save not found.",
      };
      toast(msgs[result?.reason] || `⚠️ Ascension rejected: ${result?.reason || "unknown"}`, 4000);
      return;
    }

    lastResult = result;
    incomeBefore = result.__incomeBefore ?? incomeBefore;
    // Mirror server balances + inventory (cash MUST drop locally or max-merge refunds it)
    state.eb = result.nextEb;
    if (Number.isFinite(Number(result.nextCash))) {
      state.cash = Math.max(0, Number(result.nextCash));
    }
    if (result.plots) state.plots = result.plots;
    if (result.plotBagItems && typeof result.plotBagItems === "object") {
      state.plotBagItems = { ...result.plotBagItems };
    }
    if (result.plotBag && typeof result.plotBag === "object") {
      state.plotBag = { ...result.plotBag };
    }
    if (result.plotsVersion !== undefined) {
      state.plotsVersion = result.plotsVersion;
    }
    Store.save(true);

    // Exit pick mode if still active, keep FX points
    if (isPicking) exitMapPickMode(true);
    el("ascension-modal")?.classList.add("hidden");
    isOpen = false;
    selections = [];

    // Refresh map + land modal
    if (typeof Grid !== "undefined" && Grid.render) Grid.render();
    if (typeof window.updateLandModal === "function") window.updateLandModal();

    // Play FX then show complete screen
    playAscensionFx(fxPoints, result.newRarity, () => {
      showCompleteScreen(result);
    });
  }

  async function recoverAscension(targetTid) {
    try {
      const db = Store.getDb();
      const state = Store.get();
      const uid = state.player?.id;
      if (!db || !uid) return null;
      const targetSnap = await db.collection("plots").doc(targetTid).get();
      if (!targetSnap.exists) return null;
      const target = targetSnap.data() || {};
      const saveSnap = await db.collection("saves").doc(uid).get();
      if (!saveSnap.exists) return null;
      const save = saveSnap.data() || {};
      // If target upgraded and plotsVersion moved, treat as committed
      const local = (state.plots || {})[targetTid] || {};
      const serverRarity = String(target.rarity || "");
      const localRarity = String(local.rarity || "");
      if (serverRarity && serverRarity !== localRarity) {
        return {
          ok: true,
          targetTid,
          fromRarity: localRarity,
          newRarity: serverRarity,
          newRate: target.rate,
          plots: save.plots || state.plots,
          plotBagItems: save.plotBagItems,
          plotBag: save.plotBag,
          plotsVersion: Number(save.plotsVersion) || 0,
          nextEb: Number(save.eb) || 0,
          nextCash: Number(save.cash) || 0,
          recovered: true,
        };
      }
      return null;
    } catch (e) {
      console.warn("[PlotAscension] recovery failed:", e);
      return null;
    }
  }

  // ---------------- Complete screen ----------------

  function showCompleteScreen(result) {
    const state = Store.get();
    const newRarity = String(result.newRarity || "rare");
    const conf = rarityConf(newRarity);
    const incomeAfter = Store.totalRate();
    const plotsAfter = Object.keys(state.plots || {}).length;

    // Capture "before" from result if available, else estimate from rates
    let beforeIncome = incomeBefore;
    if (result.recovered || !Number.isFinite(beforeIncome) || beforeIncome <= 0) {
      // Estimate: after income - (new rate - old rates of sacrificed)
      // Fall back to a simple reconstruction using plot counts if needed
      beforeIncome = incomeAfter; // will show delta 0 if unknown
    }
    // Better before estimate: incomeAfter minus upgraded plot's new rate plus 3x old rarity rate
    // when we still know fromRarity
    if (result.fromRarity) {
      const fromConf = rarityConf(result.fromRarity);
      const toConf2 = rarityConf(newRarity);
      // before = after - toRate + 3 * fromRate  (target upgraded + 2 sacrifices removed,
      // net: remove (toRate - fromRate) for target and 2*fromRate for sacrifices)
      // after = before - fromRate(target was from) - 2*fromRate(sacrifices) + toRate
      // => before = after + fromRate + 2*fromRate - toRate = after + 3*fromRate - toRate
      const estimated = incomeAfter + (3 * fromConf.rate) - toConf2.rate;
      if (Number.isFinite(estimated) && estimated > 0) beforeIncome = estimated;
    }

    const delta = incomeAfter - beforeIncome;
    const deltaPct = beforeIncome > 0 ? ((delta / beforeIncome) * 100) : 0;

    // Portfolio % can be tiny when you own hundreds of plots — never show "0.0%" on a real increase
    function formatDeltaPct(pct) {
      const a = Math.abs(pct);
      if (a === 0) return "0%";
      if (a < 0.01) return pct.toFixed(4) + "%";
      if (a < 1) return pct.toFixed(3) + "%";
      return pct.toFixed(2) + "%";
    }

    // Forge-step math: 3× old rarity vs 1× new rarity (the real ascension win)
    let forgeStepTxt = "";
    if (result.fromRarity) {
      const fromConf = rarityConf(result.fromRarity);
      const toConf2 = rarityConf(newRarity);
      const inRate = 3 * fromConf.rate;
      const outRate = toConf2.rate;
      const stepDelta = outRate - inRate;
      const stepPct = inRate > 0 ? (stepDelta / inRate) * 100 : 0;
      forgeStepTxt = `Forge step: 3× ${fromConf.label} ($${formatIncome(inRate)}) → 1× ${toConf2.label} ($${formatIncome(outRate)}) = ${stepDelta >= 0 ? "+" : "−"}${formatDeltaPct(Math.abs(stepPct))} on those plots`;
    }

    const setTxt = (id, val) => { const n = el(id); if (n) n.textContent = val; };

    const rarityBadge = el("asc-complete-rarity");
    if (rarityBadge) {
      rarityBadge.textContent = conf.label.toUpperCase();
      rarityBadge.style.color = conf.color;
      rarityBadge.style.textShadow = `0 0 22px ${conf.color}`;
    }
    setTxt("asc-complete-rate", `$${formatIncome(conf.rate)} /s per plot`);
    setTxt("asc-complete-sub", `A ${conf.label} plot has been reforged on the map.`);
    setTxt("asc-before-income", `$${formatIncome(beforeIncome)}`);
    setTxt("asc-after-income", `$${formatIncome(incomeAfter)}`);
    setTxt("asc-before-plots", String(plotsBefore));
    setTxt("asc-after-plots", String(plotsAfter));

    const deltaEl = el("asc-income-delta");
    if (deltaEl) {
      deltaEl.classList.remove("up", "down", "flat");
      if (delta > 0) {
        deltaEl.classList.add("up");
        deltaEl.textContent = `▲ Income up +$${formatIncome(delta)}/s · portfolio ${formatDeltaPct(deltaPct)}${forgeStepTxt ? " · " + forgeStepTxt : ""}`;
      } else if (delta < 0) {
        deltaEl.classList.add("down");
        deltaEl.textContent = `▼ Income −$${formatIncome(Math.abs(delta))}/s · Prestige & plot-cap gained`;
      } else {
        deltaEl.classList.add("flat");
        deltaEl.textContent = forgeStepTxt || "◆ Income steady · Prestige unlocked";
      }
    }

    const costEl = el("asc-complete-cost");
    if (costEl && result.cost) {
      costEl.textContent = `${result.cost.eb} EB + ${formatCash(result.cost.cash)} Cash`;
    }

    el("ascension-complete-modal")?.classList.remove("hidden");
  }

  // ---------------- Particle FX (Thanos snap + rarity burst) ----------------

  function playAscensionFx(fxPoints, newRarity, onDone) {
    const canvas = el("ascension-fx-canvas");
    if (!canvas || typeof requestAnimationFrame === "undefined") {
      if (onDone) onDone();
      return;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      if (onDone) onDone();
      return;
    }

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = window.innerWidth;
    const h = window.innerHeight;
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    canvas.style.width = w + "px";
    canvas.style.height = h + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    canvas.classList.remove("hidden");

    const particles = [];
    const conf = rarityConf(newRarity || "rare");

    // Fallback centers if project failed
    const fallback = { x: w * 0.5, y: h * 0.45 };

    function spawnSnap(point) {
      const origin = point.pos || fallback;
      const count = 70;
      for (let i = 0; i < count; i++) {
        const ang = Math.random() * Math.PI * 2;
        const spd = 0.6 + Math.random() * 2.8;
        particles.push({
          x: origin.x + (Math.random() - 0.5) * 28,
          y: origin.y + (Math.random() - 0.5) * 28,
          vx: Math.cos(ang) * spd * 0.35,
          vy: -Math.abs(Math.sin(ang)) * spd - 0.4, // drift upward (dust)
          life: 1,
          decay: 0.008 + Math.random() * 0.012,
          size: 1.2 + Math.random() * 2.8,
          // Thanos snap: violet/grey dust
          color: Math.random() > 0.5
            ? `rgba(160, 110, 220,`
            : `rgba(180, 180, 190,`,
          glow: false,
        });
      }
    }

    function spawnBurst(point) {
      const origin = point.pos || fallback;
      const palette = [
        { c: "rgba(255,255,255,", w: 0.35 }, // white core
        { c: "rgba(255,43,67,", w: 0.35 },   // red
        { c: "rgba(255,211,138,", w: 0.30 }, // gold
      ];
      const count = 120;
      for (let i = 0; i < count; i++) {
        const ang = Math.random() * Math.PI * 2;
        const spd = 2 + Math.random() * 9;
        let pick = palette[0];
        const roll = Math.random();
        if (roll < palette[0].w) pick = palette[0];
        else if (roll < palette[0].w + palette[1].w) pick = palette[1];
        else pick = palette[2];
        particles.push({
          x: origin.x,
          y: origin.y,
          vx: Math.cos(ang) * spd,
          vy: Math.sin(ang) * spd,
          life: 1,
          decay: 0.012 + Math.random() * 0.02,
          size: 1.5 + Math.random() * 3.5,
          color: pick.c,
          glow: true,
        });
      }
      // Central flash
      for (let i = 0; i < 30; i++) {
        const ang = Math.random() * Math.PI * 2;
        const spd = 0.5 + Math.random() * 2;
        particles.push({
          x: origin.x,
          y: origin.y,
          vx: Math.cos(ang) * spd,
          vy: Math.sin(ang) * spd,
          life: 1,
          decay: 0.03,
          size: 3 + Math.random() * 5,
          color: "rgba(255,255,255,",
          glow: true,
        });
      }
    }

    // Phase timeline
    // 0ms: snap sacrifices (~1400ms)
    // 1500ms: burst at target (~1600ms)
    // 3200ms: fade out → complete screen at 4200ms
    // fxPoints[0] is target; rest are sacrifices
    const targetPoint = fxPoints[0];
    const sacPoints = fxPoints.slice(1);

    let phase = "snap";
    let phaseStart = performance.now();

    sacPoints.forEach((p, i) => {
      setTimeout(() => spawnSnap(p), i * 180);
    });

    setTimeout(() => {
      phase = "burst";
      phaseStart = performance.now();
      if (targetPoint) spawnBurst(targetPoint);
      else spawnBurst({ pos: fallback });
    }, 1500);

    const fadeStart = 3200;
    const endAt = 4200;
    const startTime = performance.now();

    function frame(now) {
      ctx.clearRect(0, 0, w, h);

      // Soft vignette during active FX
      if (particles.length > 0 || now - startTime < endAt) {
        if (phase === "snap") {
          const g = ctx.createRadialGradient(w / 2, h * 0.4, 40, w / 2, h * 0.4, Math.max(w, h) * 0.7);
          g.addColorStop(0, "rgba(40, 20, 60, 0.15)");
          g.addColorStop(1, "rgba(0, 0, 0, 0.35)");
          ctx.fillStyle = g;
          ctx.fillRect(0, 0, w, h);
        } else if (phase === "burst") {
          const g = ctx.createRadialGradient(w / 2, h * 0.4, 40, w / 2, h * 0.4, Math.max(w, h) * 0.7);
          g.addColorStop(0, "rgba(255, 220, 160, 0.12)");
          g.addColorStop(0.4, "rgba(255, 43, 67, 0.1)");
          g.addColorStop(1, "rgba(0, 0, 0, 0.4)");
          ctx.fillStyle = g;
          ctx.fillRect(0, 0, w, h);
        }
      }

      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.x += p.vx;
        p.y += p.vy;
        if (phase === "snap") {
          p.vx *= 0.98;
          p.vy = p.vy * 0.98 - 0.01;
        } else {
          p.vx *= 0.96;
          p.vy = p.vy * 0.96 + 0.03;
        }
        p.life -= p.decay;
        if (p.life <= 0) {
          particles.splice(i, 1);
          continue;
        }
        const alpha = Math.max(0, Math.min(1, p.life));
        ctx.beginPath();
        ctx.fillStyle = p.color + (alpha * 0.95) + ")";
        if (p.glow) {
          ctx.shadowBlur = 12;
          ctx.shadowColor = p.color + "0.8)";
        } else {
          ctx.shadowBlur = 0;
        }
        ctx.arc(p.x, p.y, p.size * (0.4 + p.life), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.shadowBlur = 0;

      // Rarity flash ring at burst
      if (phase === "burst" && targetPoint && targetPoint.pos) {
        const t = (now - phaseStart) / 900;
        if (t < 1) {
          const r = 20 + t * 120;
          ctx.beginPath();
          ctx.strokeStyle = conf.color + (0.7 * (1 - t)) + ")";
          ctx.lineWidth = 3 * (1 - t) + 0.5;
          ctx.arc(targetPoint.pos.x, targetPoint.pos.y, r, 0, Math.PI * 2);
          ctx.stroke();
        }
      }

      const globalElapsed = now - startTime;
      if (globalElapsed < endAt || particles.length > 0) {
        if (globalElapsed > fadeStart) {
          const fo = Math.max(0, 1 - (globalElapsed - fadeStart) / (endAt - fadeStart));
          canvas.style.opacity = String(fo);
        }
        requestAnimationFrame(frame);
      } else {
        canvas.classList.add("hidden");
        canvas.style.opacity = "1";
        ctx.clearRect(0, 0, w, h);
        if (onDone) onDone();
      }
    }

    requestAnimationFrame(frame);
  }

  // ---------------- Wiring ----------------

  function bind() {
    // #ascension-forge-btn is wired in main.js (single listener)
    el("asc-select-btn")?.addEventListener("click", () => enterMapPickMode());
    el("asc-confirm-btn")?.addEventListener("click", () => confirmAscension());
    el("asc-cancel-btn")?.addEventListener("click", () => closeForge());
    el("asc-hud-done-btn")?.addEventListener("click", () => {
      if (selections.length !== 3) return;
      exitMapPickMode(false);
    });
    el("asc-hud-clear-btn")?.addEventListener("click", () => {
      selections = [];
      preselectTid = null;
      Grid.setAscensionSelections(selections);
      updateHud();
      toast("Selection cleared.");
    });
    el("asc-hud-cancel-btn")?.addEventListener("click", () => {
      closeForge();
    });
    el("asc-complete-close-btn")?.addEventListener("click", () => {
      el("ascension-complete-modal")?.classList.add("hidden");
      if (typeof window.updateLandModal === "function") window.updateLandModal();
    });
  }

  // Auto-bind when DOM is ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bind);
  } else {
    bind();
  }

  return {
    openForge,
    closeForge,
    forceExitToNormalGame,
    refreshAfterSync() {
      if (isOpen) renderForge();
    },
  };
})();
