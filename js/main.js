// ============================================================
// Elden Earth — main
// Wires sign-in -> location permission -> map -> game loop.
// ============================================================
(() => {
  let map, watchId;
  const _savedStore = (typeof Store !== "undefined" && Store.get) ? Store.get() : null;
  let currentPos = _savedStore?.lastDiamondPlayerPosition || null;
  let toastTimer = null;
  let pulseAnimId = null;
  let _lastKnownCity = null;
  
  const iconCoin = `<img src="assets/eb-coin.png" style="width: 1.1em; height: 1.1em; vertical-align: -0.15em; display: inline-block;" />`;
  const iconDiamond = `<img src="assets/diamond-spawn.png" style="width: 1.1em; height: 1.1em; vertical-align: -0.15em; display: inline-block;" />`;

  // --- AUTOMATION / HEADLESS DETECTION ---
  function detectAutomation() {
    if (typeof window === "undefined") return false;

    // 1. Selenium / Puppeteer / Playwright webdriver flag
    if (navigator.webdriver === true) return true;

    // 2. Chrome DevTools protocol detection
    if (window.chrome && window.chrome.runtime && window.chrome.runtime.id) return true;

    // 3. Missing hardware sensors (common in headless)
    if (typeof DeviceOrientationEvent !== "undefined" &&
        typeof DeviceMotionEvent !== "undefined") {
      // Both exist — likely real device or emulator with sensor spoofing
    } else if (typeof DeviceOrientationEvent === "undefined" &&
               typeof DeviceMotionEvent === "undefined") {
      // Neither exists — suspicious on desktop, but could be desktop browser
      // Only flag if also has headless indicators
      if (navigator.userAgent.includes("HeadlessChrome") ||
          navigator.userAgent.includes("headless")) {
        return true;
      }
    }

    // 4. Known headless user agent patterns
    const ua = (navigator.userAgent || "").toLowerCase();
    if (ua.includes("headlesschrome") ||
        ua.includes("phantomjs") ||
        ua.includes("slimerjs") ||
        ua.includes("nightmare") ||
        ua.includes("puppeteer")) {
      return true;
    }

    // 5. Missing plugins (headless browsers typically have 0 plugins)
    if (navigator.plugins && navigator.plugins.length === 0 &&
        navigator.userAgent.includes("Chrome")) {
      // Chrome with 0 plugins is suspicious
    }

    // 6. Languages check — headless often has empty languages
    if (navigator.languages && navigator.languages.length === 0) return true;

    return false;
  }

  // Teleportation Watchdog State
  let _tp_lastLat = 0;
  let _tp_lastLon = 0;
  let _tp_lastTimestamp = 0;
  const TELEPORT_SPEED_KMH = 900;
  const TELEPORT_MIN_DISTANCE_KM = 5;

  function escapeHtmlFallback(str) {
    const div = document.createElement("div");
    div.textContent = str || "";
    return div.innerHTML;
  }
  let isOrbiting = false;
  let isUserInteracting = false;

  const el = (id) => document.getElementById(id);

  // ======================== HUD FLY-TARGET RESOLVER ========================
  // Reward particles (coins, gems) animate toward a currency readout. Those
  // readouts moved inside the Player Info modal, which is hidden most of the
  // time — a hidden element reports a 0x0 rect at (0,0), so the particles would
  // fly into the top-left corner. Resolve to the readout when it is genuinely
  // on screen, otherwise fall back to the player chip, which always is.
  function hudFlyTarget(id) {
    const t = el(id);
    if (t) {
      const r = t.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) return t;
    }
    return el("player-chip-wrap") || t;
  }
  window.hudFlyTarget = hudFlyTarget;

  // ======================== REFRESH RAPID DETECTION ========================
  (() => {
    const KEY = "elden_refresh_log";
    const MAX_REFRESHES = 5;
    const WINDOW_MS = 30000; // 30 seconds
    const WARN_THRESHOLD = 3;

    const now = Date.now();
    let log = [];
    try { log = JSON.parse(sessionStorage.getItem(KEY) || "[]"); } catch (e) { log = []; }

    // Prune entries older than window
    log = log.filter(t => now - t < WINDOW_MS);
    log.push(now);
    sessionStorage.setItem(KEY, JSON.stringify(log));

    if (log.length >= WARN_THRESHOLD && log.length < MAX_REFRESHES) {
      // Show warning float text after a short delay (let game init first)
      setTimeout(() => {
        if (typeof window.showToast === "function") {
          window.showToast(`⚠️ Rapid refresh detected (${log.length}x in 30s). Stop or you will be signed out.`, 6000);
        }
      }, 2000);
    }

    if (log.length >= MAX_REFRESHES) {
      // Reset the counter and warn — never wipe the save or force sign-out here, since
      // desktop/private-tab testing legitimately reloads several times in a row and
      // that must never cost the player their real progress.
      sessionStorage.removeItem(KEY);
      document.addEventListener("DOMContentLoaded", () => {
        if (typeof window.showToast === "function") {
          window.showToast("⚠️ Rapid refresh detected. Please slow down.", 6000);
        }
      });
    }
  })();

  // ======================== UNIVERSAL CUSTOM CONFIRM ========================
  window.gameConfirm = function(message, opts = {}) {
    return new Promise(resolve => {
      const modal = document.getElementById("game-confirm-modal");
      if (!modal) {
        showToast(message, 5000);
        resolve(false);
        return;
      }
      const msgEl = modal.querySelector(".confirm-msg");
      const okBtn = modal.querySelector(".confirm-ok");
      const cancelBtn = modal.querySelector(".confirm-cancel");
      if (msgEl) msgEl.textContent = message;
      if (okBtn) okBtn.textContent = opts.okText || "Confirm";
      if (cancelBtn) cancelBtn.textContent = opts.cancelText || "Cancel";
      modal.classList.remove("hidden");

      function cleanup(result) {
        modal.classList.add("hidden");
        okBtn?.removeEventListener("click", onOk);
        cancelBtn?.removeEventListener("click", onCancel);
        resolve(result);
      }
      function onOk() { cleanup(true); }
      function onCancel() { cleanup(false); }
      okBtn?.addEventListener("click", onOk);
      cancelBtn?.addEventListener("click", onCancel);
    });
  };

  function showToast(msg, ms = 2200) {
    const t = el("toast");
    if (!t) return;
    // Move to end of body so it always paints ABOVE modals (DOM order matters)
    document.body.appendChild(t);
    t.innerHTML = msg;
    t.classList.remove("hidden");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.add("hidden"), ms);
  }
  // Other modules (multiplier.js, friends.js, referrals.js, etc.) call this by name
  // or via window.showToast — it was only ever local to this IIFE, never exposed.
  window.showToast = showToast;

  function openModal(id) { el(id).classList.remove("hidden"); }
  function closeModal(id) {
    const m = el(id);
    if (m) m.classList.add("hidden");
    deactivateMapObjectAnimations(id);
  }

  // Dyson/ring animations on map markers only run while the player is
  // interacting with that object. Closing its modal freezes them again.
  function deactivateMapObjectAnimations(modalId) {
    if (modalId === "extractor-modal") {
      document.querySelectorAll(".extractor-3d-wrap.is-active").forEach(n => n.classList.remove("is-active"));
    }
    if (modalId === "citadel-modal" || modalId === "citadel-upgrade-modal" || modalId === "siege-modal") {
      document.querySelectorAll(".citadel-3d-monument.is-active").forEach(n => n.classList.remove("is-active"));
    }
  }

  let cachedCashWhole = null;
  let cachedCashDecimal = null;

  // High-Efficiency Cached State Tracker (Zero Redundant DOM Reflows)
  let lastCashStr = "";
  let lastEBVal = -1;
  let lastDiaVal = -1;
  let lastRateVal = "";

  // ===================== LIVE WALLET READOUT =====================
  // The balance bar used to live on the map and was repainted every couple of
  // seconds forever. It now lives in the Player Info header, so it only needs
  // to repaint while that sheet is actually open — and when it is open it runs
  // at 200ms so the digits tick in realtime instead of in 2s jumps.
  function isWalletLive() {
    const m = el("player-info-modal");
    return !!m && !m.classList.contains("hidden") && m.dataset.otherPlayer !== "true";
  }

  function renderCashReadout() {
    if (!isWalletLive()) return;
    const cashContainer = el("stat-cash");
    if (!cashContainer) return;
    const state = Store.get();
    // 6 dp is enough for the counter to visibly tick at any realistic rate
    // without printing 15 meaningless digits. Full precision lives in the
    // player info modal (info-total-rent), not on the HUD.
    const val = Number(state.cash) || 0;
    const fixedStr = val.toFixed(6);
    if (fixedStr === lastCashStr) return;
    lastCashStr = fixedStr;
    const parts = fixedStr.split(".");
    const whole = parseInt(parts[0], 10);
    const decimals = parts[1] || "000000";
    // Sub-1 balances drop the leading zero entirely ("RC .975801"), which is
    // how the counter reads best — a big "0" crowds the digits that matter.
    const wholeHTML = whole > 0
      ? `<span class="cash-whole">${Fmt.group(whole)}</span>`
      : `<span class="cash-whole cash-whole-zero">0</span>`;
    cashContainer.innerHTML = `<span class="cash-dollar">RC</span>${wholeHTML}<span class="cash-point">.</span><span class="cash-decimal">${decimals}</span>`;
  }

  let _cashTickerId = null;

  function startCashTicker() {
    if (_cashTickerId) return;
    _cashTickerId = setInterval(renderCashReadout, 200);
  }

  function stopCashTicker() {
    if (!_cashTickerId) return;
    clearInterval(_cashTickerId);
    _cashTickerId = null;
  }

  // Start/stop the ticker purely from the modal's own attribute changes, so
  // every open path works: openModal, closeModal, closeAllPanels(), and the
  // direct classList writes other modules do. Also flips on the data attribute
  // that says "this sheet is someone else's profile".
  function syncCashTicker() {
    if (isWalletLive()) {
      renderCashReadout();
      startCashTicker();
    } else {
      stopCashTicker();
    }
  }
  window.syncCashTicker = syncCashTicker;

  // Watch the sheet itself rather than hooking every open/close call site —
  // modules open this modal by id from all over the codebase.
  (function watchWalletModal() {
    const m = el("player-info-modal");
    if (!m || typeof MutationObserver === "undefined") return;
    new MutationObserver(syncCashTicker).observe(m, {
      attributes: true,
      attributeFilter: ["class", "data-other-player"],
    });
  })();

  function updateTopbar() {
    window.updateTopbar = updateTopbar;
    if (document.hidden) return; // Battery Saver: Skip UI work when phone is in pocket!
    const state = Store.get();
    if (state.cash === undefined) state.cash = 0;

    // 1. Realm Coins — only repainted while the Player Info wallet is on screen.
    renderCashReadout();

    // 2. Dirty-Checked Currency Updates (Only updates DOM if numbers actually changed)
    const currentEB = Math.floor(Number(state.eb) || 0);
    if (currentEB !== lastEBVal) {
      lastEBVal = currentEB;
      if (el("stat-eb")) {
        el("stat-eb").innerHTML = `${currentEB} <span class="eb-coin-icon"></span>`;
      }
      if (el("wheel-eb-display")) {
        el("wheel-eb-display").innerHTML = `${currentEB} <span class="eb-coin-icon"></span>`;
      }
    }

    const currentDiamonds = Number(state.diamonds) || 0;
    if (currentDiamonds !== lastDiaVal) {
      lastDiaVal = currentDiamonds;
      if (el("stat-diamonds")) el("stat-diamonds").innerHTML = `${currentDiamonds} <span class="hud-gem-icon"></span>`;
      if (el("wheel-diamond-display")) el("wheel-diamond-display").innerHTML = `${currentDiamonds} <span class="hud-gem-icon"></span>`;
    }

    const currentRate = Fmt.rate(Store.totalRate(), { bare: false, perSec: true });
    if (currentRate !== lastRateVal) {
      lastRateVal = currentRate;
      if (el("stat-rate")) el("stat-rate").textContent = currentRate;
    }

    // 3. Global 20X/50X Multiplier UI (Delegated to Multiplier module)
    if (typeof Multiplier !== "undefined") {
      Multiplier.updateUI(state);
    }

    // 4. Live Player Identity Chip (Name & Photo Avatar)
    const playerNameEl = el("player-name");
    const playerAvatarEl = el("player-avatar");
    const pName = state.player?.name || "Traveler";
    const pAvatar = state.player?.avatar || "🙂";

    if (playerNameEl && playerNameEl.textContent !== pName) {
      playerNameEl.textContent = pName;
    }

    if (playerAvatarEl) {
      if (pAvatar.startsWith("img:")) {
        const imgSrc = pAvatar.slice(4);
        if (!playerAvatarEl.querySelector("img") || playerAvatarEl.querySelector("img").src !== imgSrc) {
          playerAvatarEl.innerHTML = `<img src="${escapeHtmlFallback(imgSrc)}" style="width:100%;height:100%;border-radius:50%;object-fit:cover;display:block;">`;
        }
      } else if (playerAvatarEl.textContent !== pAvatar) {
        playerAvatarEl.textContent = pAvatar;
      }
    }
  }

  function formatRate(val) {
    return Fmt.rate(val, { bare: true, perSec: false });
  }

  function updateLandModal() {
    const state = Store.get();
    el("land-count").textContent = Fmt.int(Object.keys(state.plots).length);
    el("land-rate").textContent = Fmt.rate(Store.totalRate());

    // Count plots by rarity
    const counts = { common: 0, rare: 0, epic: 0, legendary: 0 };
    let luckyCount = 0;
    for (const id in state.plots) {
      const r = state.plots[id].rarity?.key || state.plots[id].rarity;
      if (counts[r] !== undefined) counts[r]++;
      if (state.plots[id].lucky) luckyCount++;
    }

    if (el("count-common")) el("count-common").textContent = counts.common;
    if (el("count-rare")) el("count-rare").textContent = counts.rare;
    if (el("count-epic")) el("count-epic").textContent = counts.epic;
    if (el("count-legendary")) el("count-legendary").textContent = counts.legendary;

    const total = counts.common + counts.rare + counts.epic + counts.legendary;
    CONFIG.PLOT_RARITIES.forEach(rarity => {
      const pct = total > 0 ? ((counts[rarity.key] / total) * 100).toFixed(1) : "0.0";
      if (el(`weight-${rarity.key}`)) el(`weight-${rarity.key}`).textContent = pct;
      if (el(`rate-${rarity.key}`)) el(`rate-${rarity.key}`).textContent = formatRate(rarity.rate * (counts[rarity.key] || 0));
    });

    // 🍀 Lucky plot counter (shown only when the player owns at least one)
    const luckyEl = el("count-lucky");
    if (luckyEl) {
      luckyEl.textContent = luckyCount;
      luckyEl.parentElement?.classList.toggle("hidden", luckyCount === 0);
    }
  }
  
  async function updatePlayerInfoModal(targetPlayerData = null) {
    const state = Store.get();
    const isOtherPlayer = targetPlayerData && targetPlayerData.ownerId !== state.player.id;
    // Achievements.renderAll() reads this to decide whether badges may render —
    // badges are private, exactly like the RP balance.
    const infoModalEl = el("player-info-modal");
    if (infoModalEl) infoModalEl.dataset.otherPlayer = isOtherPlayer ? "true" : "false";

    // The header wallet is YOUR relocated HUD — cash, EB, gems, rate. It makes
    // no sense on someone else's profile (their private balances aren't ours to
    // show), so it hides and the standalone PASSIVE INCOME block takes over to
    // report their rate. On your own profile the two swap the other way.
    const walletRow = el("profile-wallet");
    if (walletRow) walletRow.classList.toggle("hidden", isOtherPlayer);
    const incomeSection = el("info-income-section");
    if (incomeSection) incomeSection.classList.toggle("hidden", !isOtherPlayer);
    // dataset.otherPlayer just changed, so re-evaluate whether the live cash
    // ticker should be running.
    syncCashTicker();
    
    const name = isOtherPlayer ? (targetPlayerData.ownerName || "Traveler") : (state.player.name || "Traveler");
    // Image Safety Review Status: Shows centered banner while pending; vanishes when approved!
    const isPending = !isOtherPlayer && state.player?.avatarStatus === "pending";
    if (el("avatar-pending-banner")) el("avatar-pending-banner").classList.toggle("hidden", !isPending);
    // Name changes are moderated the same way: show what is waiting on staff.
    const pendingName = !isOtherPlayer ? (state.player?.pendingName || "") : "";
    const nameBanner = el("name-pending-banner");
    if (nameBanner) {
      nameBanner.classList.toggle("hidden", !pendingName);
      const t = el("name-pending-text");
      if (t && pendingName) t.textContent = `Your new name "${pendingName}" is under review.`;
    }
    const avatar = isOtherPlayer ? (targetPlayerData.avatar || "🙂") : (state.player.avatar || "🙂");

    el("info-name").textContent = name;

    // Permanent "Alpha Founder" flair for closed-beta opt-ins.
    const founderBadge = el("founder-badge");
    if (founderBadge) {
      const isFounder = isOtherPlayer
        ? !!(targetPlayerData && targetPlayerData.betaFounder)
        : !!state.player?.betaFounder;
      founderBadge.classList.toggle("hidden", !isFounder);
    }
    
    // Avatar
    const av = el("info-avatar");
    if (avatar && avatar.startsWith("img:")) {
      av.innerHTML = `<img src="${escapeHtmlFallback(avatar.slice(4))}">`;
    } else {
      av.textContent = avatar || "🙂";
    }

    // Only show edit buttons on your own profile
    const editAvatarBtn = el("edit-avatar-btn");
    const uploadOverlay = el("avatar-upload-overlay");
    const editNameBtn = el("edit-name-btn");
    const reportBtn = el("report-player-btn");
    if (editAvatarBtn) editAvatarBtn.style.display = isOtherPlayer ? "none" : "flex";
    if (uploadOverlay) uploadOverlay.style.display = isOtherPlayer ? "none" : "flex";
    if (editNameBtn) editNameBtn.style.display = isOtherPlayer ? "none" : "inline-flex";

    // Report button — only on other players
    if (reportBtn) {
      reportBtn.classList.toggle("hidden", !isOtherPlayer);
      reportBtn.onclick = () => {
        const db = Store.getDb();
        if (db && targetPlayerData?.ownerId) {
          db.collection("player_reports").add({
            reporterId: state.player.id,
            reporterName: state.player.name || "Traveler",
            reportedId: targetPlayerData.ownerId,
            reportedName: targetPlayerData.ownerName || "Unknown",
            reason: "player_report",
            timestamp: Date.now()
          }).then(() => {
            showToast("🚨 Player reported. Thank you for helping keep the realm safe!", 3500);
            reportBtn.disabled = true;
            reportBtn.textContent = "✅ Reported";
          }).catch(() => {
            showToast("⚠️ Could not submit report. Try again later.", 3000);
          });
        }
      };
    }

    // Staff Tools — visible only to GAME_ADMIN_UIDS, only on other players.
    // Cosmetic gate only: banPlayer / purgePlayer both re-verify the caller
    // server-side against ADMIN_UIDS in functions/index.js.
    const adminBlock = el("admin-actions-block");
    const adminBanBtn = el("admin-ban-btn");
    const adminPurgeBtn = el("admin-purge-btn");
    const adminStatusEl = el("admin-action-status");
    const myUid = state.player?.id || firebase.auth().currentUser?.uid || "";
    const isAdminUser = !!(myUid && (CONFIG.GAME_ADMIN_UIDS || []).includes(myUid));
    const showAdmin = isOtherPlayer && isAdminUser && !!targetPlayerData?.ownerId;
    if (adminBlock) adminBlock.classList.toggle("hidden", !showAdmin);
    if (adminStatusEl && !showAdmin) {
      adminStatusEl.classList.add("hidden");
      adminStatusEl.textContent = "";
    }

    const setAdminBusy = (busy) => {
      if (adminBanBtn) adminBanBtn.disabled = busy;
      if (adminPurgeBtn) adminPurgeBtn.disabled = busy;
    };
    const setAdminStatus = (msg, isError) => {
      if (!adminStatusEl) return;
      adminStatusEl.textContent = msg || "";
      adminStatusEl.classList.toggle("hidden", !msg);
      adminStatusEl.style.color = isError ? "#f87171" : "var(--text-dim)";
    };

    if (adminBanBtn && showAdmin) {
      adminBanBtn.onclick = () => {
        const targetUid = targetPlayerData.ownerId;
        const targetName = targetPlayerData.ownerName || "Traveler";
        const reason = window.prompt(
          `Ban ${targetName}?\n\nThey will be blocked on next login and their save will be zeroed.\nEnter a reason (recorded in banned_users):`,
          "Admin ban"
        );
        if (reason === null) return;
        setAdminBusy(true);
        setAdminStatus("Banning…");
        firebase.functions().httpsCallable("banPlayer")({ uid: targetUid, reason: reason || "Admin ban" })
          .then((res) => {
            const msg = res?.data?.message || `Player ${targetName} banned.`;
            setAdminStatus("✅ " + msg, false);
            showToast("⛔ " + msg, 4000);
          })
          .catch((err) => {
            const msg = err?.message || "Ban failed.";
            setAdminStatus("⚠️ " + msg, true);
            showToast("⚠️ " + msg, 4000);
          })
          .finally(() => setAdminBusy(false));
      };
    }

    if (adminPurgeBtn && showAdmin) {
      adminPurgeBtn.onclick = () => {
        const targetUid = targetPlayerData.ownerId;
        const targetName = targetPlayerData.ownerName || "Traveler";
        const confirmText = window.prompt(
          `PERMANENTLY DELETE ${targetName}?\n\nThis removes every trace of this player across all collections (saves, saves_private, plots, referrals, chat, achievements, …).\nThis cannot be undone.\n\nType DELETE to confirm:`,
          ""
        );
        if (confirmText === null) return;
        if (confirmText.trim().toUpperCase() !== "DELETE") {
          setAdminStatus("Cancelled — confirmation text did not match.", true);
          return;
        }
        setAdminBusy(true);
        setAdminStatus("Purging player data…");
        firebase.functions().httpsCallable("purgePlayer")({ uid: targetUid })
          .then((res) => {
            const ok = res?.data?.ok !== false;
            const deleted = res?.data?.deleted ?? res?.data?.totalDeleted;
            const msg = ok
              ? `✅ ${targetName} purged${deleted ? ` (${deleted} docs)` : ""}.`
              : `⚠️ Purge returned not-ok: ${res?.data?.reason || "unknown"}`;
            setAdminStatus(msg, !ok);
            showToast(msg, 4500);
          })
          .catch((err) => {
            const msg = err?.message || "Purge failed.";
            setAdminStatus("⚠️ " + msg, true);
            showToast("⚠️ " + msg, 4000);
          })
          .finally(() => setAdminBusy(false));
      };
    }

    // Hide "Sign in with Google" button — Google sign-in only, no guest mode
    const googleLinkSection = el("info-google-link-section");
    if (googleLinkSection) {
      googleLinkSection.style.display = "none";
    }

    // Phone verification status
    const phoneVerifiedEl = el("info-phone-verified");
    const phoneNotVerifiedEl = el("info-phone-not-verified");
    if (phoneVerifiedEl && phoneNotVerifiedEl) {
      if (!isOtherPlayer) {
        const user = firebase.auth().currentUser;
        const hasPhone = user && user.providerData.some(p => p.providerId === "phone");
        phoneVerifiedEl.classList.toggle("hidden", !hasPhone);
        phoneNotVerifiedEl.classList.toggle("hidden", hasPhone);
      } else {
        phoneVerifiedEl.classList.add("hidden");
        phoneNotVerifiedEl.classList.add("hidden");
      }
    }

    // Reset to Profile tab
    document.querySelectorAll(".pi-tab").forEach(t => t.classList.remove("active"));
    document.querySelectorAll(".pi-tab-panel").forEach(p => p.classList.remove("active"));
    const profileTab = document.querySelector('[data-pi-tab="profile"]');
    const profilePanel = document.querySelector('[data-pi-panel="profile"]');
    if (profileTab) profileTab.classList.add("active");
    if (profilePanel) profilePanel.classList.add("active");

    // Show/hide Citadel tab (own profile only)
    const citadelTab = document.querySelector('[data-pi-tab="citadel"]');
    if (citadelTab) citadelTab.style.display = isOtherPlayer ? "none" : "";

    // Initial Rent Display (Shows Lifetime Accrued Rent, NOT spendable balance)
    let rentVal = isOtherPlayer ? 0 : (state.lifetimeRent || state.cash || 0);
    el("info-total-rent").textContent = Fmt.rcPrecise(rentVal);

    // REWARD POINTS — private. The block is hidden outright on another player's
    // profile, and their RP is never fetched in the first place: it lives in
    // saves_private, whose Firestore rules are owner-only. This is the one
    // place a player can track their balance while redemption is still locked.
    const rpSection = el("info-rp-section");
    if (rpSection) {
      rpSection.classList.toggle("hidden", isOtherPlayer);
      if (!isOtherPlayer) {
        const rp = Number(state.rewardPoints) || 0;
        const rpValEl = el("info-rp-balance");
        if (rpValEl) rpValEl.textContent = `${Fmt.int(rp)} RP`;
        const hint = el("info-rp-hint");
        if (hint) {
          const usd = (rp / 100).toFixed(2);
          hint.textContent = `100 RP = $1.00 · worth $${usd}`;
          if (typeof Treasury !== "undefined") {
            Treasury.getStatus().then((s) => {
              if (!hint.isConnected) return;
              hint.textContent = (s && s.unlocked)
                ? `100 RP = $1.00 · worth $${usd} · redemptions open`
                : `100 RP = $1.00 · worth $${usd} · redemptions open once the Realm reaches its revenue goal`;
            }).catch(() => {});
          }
        }
      }
    }

    // Badges — private, exactly like the RP balance. Hidden outright on another
    // player's profile, and their unlocks are never fetched.
    if (typeof Achievements !== "undefined") {
      Achievements.renderBadges(el("info-badges-section"), isOtherPlayer);
    }

    // Fetch and display the other player's live cloud earnings (including offline accumulation)
    if (isOtherPlayer && targetPlayerData.ownerId) {
      const db = Store.getDb();
      if (db) {
        try {
          const doc = await db.collection("saves").doc(targetPlayerData.ownerId).get();
          if (doc.exists) {
            const dData = doc.data();
            const now = Date.now();
            const lastActive = dData.lastTick || dData.createdAt || now;
            const offlineSec = Math.max(0, (now - lastActive) / 1000);

            // Calculate target player's base rate
            let playerBaseRate = 0;
            for (const id in allPlots) {
              if (allPlots[id].ownerId === targetPlayerData.ownerId) {
                const rKey = allPlots[id].rarity?.key || allPlots[id].rarity;
                playerBaseRate += CONFIG.plotRate(rKey, allPlots[id].lucky === true);
              }
            }

            const offlineEarned = offlineSec * playerBaseRate;
            let lRent = (dData.lifetimeRent !== undefined ? dData.lifetimeRent : (dData.cash || 0)) + offlineEarned;

            el("info-total-rent").textContent = Fmt.rcPrecise(lRent);
          }
        } catch (e) {
          console.warn("[PlayerInfo] Error fetching player cash:", e);
        }
      }
    }

    // Calculate Counts from global plots
    const allPlots = (typeof Grid !== "undefined" && Grid.getAllPlots) ? Grid.getAllPlots() : state.plots;
    const targetOwnerId = isOtherPlayer ? targetPlayerData.ownerId : state.player.id;

    const counts = { common: 0, rare: 0, epic: 0, legendary: 0 };
    let total = 0;
    let luckyTotal = 0;

    for (const id in allPlots) {
      if (allPlots[id].ownerId === targetOwnerId) {
        const r = allPlots[id].rarity?.key || allPlots[id].rarity;
        if (counts[r] !== undefined) counts[r]++;
        if (allPlots[id].lucky) luckyTotal++;
        total++;
      }
    }

    el("info-total-plots").textContent = total;
    el("info-count-common").textContent = counts.common;
    el("info-count-rare").textContent = counts.rare;
    el("info-count-epic").textContent = counts.epic;
    el("info-count-legendary").textContent = counts.legendary;
    // 🍀 Lucky badge — only shown when the player owns at least one.
    const luckyBadge = document.getElementById("info-count-lucky");
    if (luckyBadge) {
      luckyBadge.textContent = luckyTotal;
      luckyBadge.closest(".rarity-badge")?.classList.toggle("hidden", luckyTotal === 0);
    }

    // Calculate and display income rate ($/s)
    let incomeRate = 0;
    for (const id in allPlots) {
      if (allPlots[id].ownerId === targetOwnerId) {
        const rKey = allPlots[id].rarity?.key || allPlots[id].rarity;
        incomeRate += CONFIG.plotRate(rKey, allPlots[id].lucky === true);
      }
    }
    // Apply boost multiplier if viewing self (delegated to Multiplier module)
    if (typeof Multiplier !== "undefined") {
      incomeRate = Multiplier.applyMultiplier(incomeRate, state, isOtherPlayer);
    }
    const incomeEl = el("info-income-rate");
    if (incomeEl) incomeEl.textContent = Fmt.rate(incomeRate);

    // --- Populate Mayorship & Dividends Card ---
    const mayorStatusEl = el("info-mayor-status");
    const dividendsEl = el("info-total-dividends");
    const royaltyBadge = el("info-royalty-badge") || document.querySelector(".mayorship-dividends-card .btn-royalty, .mayorship-dividends-card span:last-child");

    let totalDiv = isOtherPlayer ? 0 : (state.totalDividends || 0);
    if (dividendsEl) dividendsEl.textContent = `${totalDiv} EB`;

    if (mayorStatusEl) {
      mayorStatusEl.textContent = "Checking realm...";
      if (typeof Leaderboard !== "undefined" && Leaderboard.fetchRankings) {
        Leaderboard.fetchRankings(true).then((data) => { // ⚡ Always force fresh titles when opening profile!
          const targetPlayerStat = (data.players || []).find(p => p.id === targetOwnerId);
          const titlesList = [];

          if (targetPlayerStat && targetPlayerStat.badges) {
            targetPlayerStat.badges.forEach(b => {
              titlesList.push(`${b.icon} ${b.title}`);
            });
          }

          if (titlesList.length > 0) {
            mayorStatusEl.innerHTML = titlesList.join("<br>");
            mayorStatusEl.className = "mayor-crown-pill active-mayor";

            const myMayors = targetPlayerStat?.badges?.filter(b => b.scope === "city") || [];
            const myGovs = targetPlayerStat?.badges?.filter(b => b.scope === "state") || [];
            const myPres = targetPlayerStat?.badges?.filter(b => b.scope === "country") || [];
            
            const stackRate = Math.min(6, (myMayors.length ? 2 : 0) + (myGovs.length ? 2 : 0) + (myPres.length ? 2 : 0));
            if (royaltyBadge) {
              royaltyBadge.textContent = `${stackRate}% Royalty`;
              royaltyBadge.style.display = "inline-block";
            }
          } else {
            mayorStatusEl.innerHTML = `🛡️ Citizen of the Realm`;
            mayorStatusEl.className = "mayor-crown-pill";
            if (royaltyBadge) {
              royaltyBadge.textContent = "0% (Citizen)";
              royaltyBadge.style.opacity = "0.6";
            }
          }
        });
      } else {
        mayorStatusEl.textContent = "🛡️ Citizen of the Realm";
      }
    }

    // --- Permanent Stronghold Status Hub (Never Disappears!) ---
    const remoteCard = el("info-citadel-remote-card");
    const recallBtn = el("remote-recall-citadel-btn");

    if (remoteCard) {
      if (isOtherPlayer) {
        remoteCard.style.display = "none"; // Hide on other players' profiles
      } else {
        remoteCard.style.display = "flex"; // Always visible on YOUR profile!

        const myCit = (typeof Citadels !== "undefined" && Citadels.getMyCitadel) ? Citadels.getMyCitadel() : null;

        if (myCit) {
          if (el("remote-citadel-title")) el("remote-citadel-title").textContent = `${myCit.creatorName}'s Hold (${myCit.rarity.toUpperCase()})`;
          if (el("remote-citadel-coords")) el("remote-citadel-coords").textContent = `Coords: [${myCit.lat.toFixed(3)}, ${myCit.lon.toFixed(3)}]`;
          if (recallBtn) {
            recallBtn.disabled = false;
            recallBtn.innerHTML = "📦 Recall to Bag";
            recallBtn.style.opacity = "1";
            recallBtn.style.cursor = "pointer";
          }
        } else {
          if (el("remote-citadel-title")) el("remote-citadel-title").textContent = "No Active Stronghold";
          // Only claim a capsule is "in bag" when it truly is — this used to be
          // hardcoded, so players with no capsule were told to plant one.
          const myCap = state && state.capsule;
          const plantable = !!(myCap && myCap.awarded && !myCap.planted);
          if (el("remote-citadel-coords")) {
            el("remote-citadel-coords").textContent = plantable
              ? "Capsule in bag — Plant via Buy Land!"
              : "No capsule yet — unlocks at $0.01 total earned (rent/RC).";
          }
          if (recallBtn) {
            recallBtn.disabled = true;
            recallBtn.innerHTML = "🔒 Not Planted";
            recallBtn.style.opacity = "0.45";
            recallBtn.style.cursor = "not-allowed";
          }
        }
      }
    }

    // Render friends tab content
    if (typeof Friends !== "undefined" && !isOtherPlayer) {
      Friends.renderFriendsTab();
    } else if (isOtherPlayer) {
      // Show relationship-aware friend UI for other players (not a blind "send request" every time)
      const friendsPanel = document.querySelector('[data-pi-panel="friends"]');
      if (friendsPanel) {
        const container = friendsPanel.querySelector(".friends-list-container");
        if (container) {
          const targetId = targetPlayerData.ownerId;
          const targetName = escapeHtmlFallback(targetPlayerData.ownerName || "Player");
          const targetAvatar = targetPlayerData.avatar || "🙂";

          container.innerHTML = `
            <div class="friends-placeholder-inner">
              <div class="friends-placeholder-icon">👤</div>
              <h3>${targetName}</h3>
              <p id="friend-relationship-status">Checking friendship status…</p>
            </div>`;

          if (typeof Friends !== "undefined" && Friends.getRelationshipStatus) {
            Friends.getRelationshipStatus(targetId).then((rel) => {
              const statusEl = container.querySelector("#friend-relationship-status");
              const wrap = container.querySelector(".friends-placeholder-inner");
              if (!wrap) return;

              if (rel.status === "friends") {
                wrap.innerHTML = `
                  <div class="friends-placeholder-icon">👤</div>
                  <h3>${targetName}</h3>
                  <p>✅ You're already friends!</p>`;
              } else if (rel.status === "pending_sent") {
                wrap.innerHTML = `
                  <div class="friends-placeholder-icon">👤</div>
                  <h3>${targetName}</h3>
                  <p>📨 Friend request sent — awaiting response.</p>`;
              } else if (rel.status === "pending_received") {
                wrap.innerHTML = `
                  <div class="friends-placeholder-icon">👤</div>
                  <h3>${targetName}</h3>
                  <p>📬 ${targetName} sent you a request! Accept it in your Friends tab.</p>`;
              } else if (rel.status === "self") {
                wrap.innerHTML = `
                  <div class="friends-placeholder-icon">👤</div>
                  <h3>${targetName}</h3>
                  <p>This is you!</p>`;
              } else {
                wrap.innerHTML = `
                  <div class="friends-placeholder-icon">👤</div>
                  <h3>${targetName}</h3>
                  <p>Send a friend request to connect!</p>
                  <button class="btn btn-primary" style="margin-top:12px"
                    onclick="Friends.sendRequest('${targetId}','${targetName}','${targetAvatar}');this.textContent='✅ Sent!';this.disabled=true;">
                    📨 Send Friend Request
                  </button>`;
              }
            }).catch(() => {
              if (statusEl) statusEl.textContent = "⚠️ Could not check friendship status.";
            });
          }
        }
      }
    }

    // Render referrals tab content
    if (typeof Referrals !== "undefined" && !isOtherPlayer) {
      Referrals.renderReferralsTab();
    } else if (isOtherPlayer) {
      const referralsPanel = document.querySelector('[data-pi-panel="referrals"]');
      if (referralsPanel) {
        referralsPanel.innerHTML = `
          <div class="referrals-placeholder">
            <div class="referrals-placeholder-icon">🔒</div>
            <h3>Private</h3>
            <p>Referral stats are private to each player.</p>
          </div>`;
      }
    }
  }

  // ---------------- Sign-in & Sequenced Boot ----------------
  let _onSignedInCalled = false;
  async function onSignedIn(playerData) {
    if (_onSignedInCalled) {
      console.log("[Main] onSignedIn already called — ignoring duplicate.");
      return;
    }
    _onSignedInCalled = true;

    const player = playerData || Store.get()?.player || { name: "Traveler" };
    console.log("[Main] onSignedIn called with player:", player);

    // Demo / reviewer accounts get a read-only lock (server enforces it too).
    if (typeof DemoMode !== "undefined") DemoMode.attach();

    // Force immediate dismissal of signin screen on all browsers (Brave, Chrome, Safari)
    const signin = document.getElementById("signin-screen");
    if (signin) {
      signin.classList.add("hidden");
      signin.style.display = "none";
      signin.style.pointerEvents = "none";
    }

    // Ensure no other screens are visible during boot
    const locationScreen = document.getElementById("location-required-screen");
    if (locationScreen) locationScreen.classList.add("hidden");

    // REGIONAL COMPLIANCE: kicked off FIRST so its network round trip overlaps
    // the whole boot pipeline instead of stalling its start. The gate itself is
    // still enforced — the game screen is only revealed after it answers.
    let regionPromise = Promise.resolve({ allowed: true });
    if (typeof ServerAntiCheat !== "undefined" && ServerAntiCheat.isReady()) {
      const countryCode = String(navigator?.language?.split("-")[1] || "").toUpperCase();
      const usStateCode = ""; // Will be filled by server via geolocation
      // Bounded: a hung compliance call must never hold the whole game back.
      regionPromise = Promise.race([
        ServerAntiCheat.checkCountryAccess(countryCode, usStateCode),
        new Promise((resolve) => setTimeout(() => resolve({ allowed: true, reason: "region_timeout" }), 6000)),
      ]).catch((e) => {
        console.warn("[Compliance] Region check failed (allowing for now):", e);
        return { allowed: true };
      });
    }

    const enforceRegionThenLaunch = async (coords) => {
      const regionResult = await regionPromise;
      if (!regionResult?.allowed) {
        console.warn("[Compliance] Region restricted:", regionResult);
        document.getElementById("region-blocked-modal")?.classList.remove("hidden");
        return;
      }
      // Keep the hot Cloud Functions' containers alive while this player is in
      // the game — otherwise the first spin/collect after a quiet spell pays a
      // full cold start (3-15s).
      if (typeof ServerAntiCheat !== "undefined" && ServerAntiCheat.startKeepAlive) {
        ServerAntiCheat.startKeepAlive();
      }
      if (coords) launchGame(coords);
      beginWatch();
    };

    // REFERRAL INVITE: Auto-apply referral code from URL if present
    if (typeof window.Referrals !== "undefined" && window.Referrals?.applyInviteFromUrl) {
      try {
        window.Referrals.applyInviteFromUrl();
      } catch (e) {
        console.warn("[Referrals] Invite auto-apply failed:", e);
      }
    }

    // Execute the professional 3D load pipeline
    if (typeof Bootloader !== "undefined" && Bootloader.run) {
      Bootloader.run(player, (coords) => enforceRegionThenLaunch(coords));
    } else {
      enforceRegionThenLaunch(null);
    }

    // Global Event: (re)start now that Auth + session are ready
    if (typeof GlobalEvent !== "undefined" && GlobalEvent.startWhenReady) {
      GlobalEvent.startWhenReady(0);
    }
  }

  // ---------------- Location ----------------
  function startLocating() {
    if (!("geolocation" in navigator)) {
      showLocationRequired();
      return;
    }
    el("locate-status").textContent = "Locating…";
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        hideLocationRequired();
        launchGame(pos.coords);
        beginWatch();
      },
      (err) => {
        console.warn("[Location] Permission denied or error:", err.code);
        showLocationRequired();
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 5000 }
    );
  }

  function showLocationRequired() {
    const screen = document.getElementById("location-required-screen");
    if (screen) screen.classList.remove("hidden");
  }

  function hideLocationRequired() {
    const screen = document.getElementById("location-required-screen");
    if (screen) screen.classList.add("hidden");
  }

  // High-Efficiency GPS Hardware Controller (Saves 40% Battery)
  let lastProcessedLat = 0;
  let lastProcessedLon = 0;

  function beginWatch() {
    if (!navigator.geolocation) return;
    if (watchId) navigator.geolocation.clearWatch(watchId);

    watchId = navigator.geolocation.watchPosition(
      (pos) => {
        // Battery Guard: Don't spend CPU if phone screen is locked
        if (document.hidden) return;

        const { latitude, longitude } = pos.coords;

        const distMoved = Geo.haversine(lastProcessedLat, lastProcessedLon, latitude, longitude);
        if (distMoved > 1.5 || lastProcessedLat === 0) {
          // Calculate exact walking direction vector (N, S, E, W)
          if (lastProcessedLat !== 0 && typeof Character3D !== "undefined" && Character3D.setHeading) {
            const y = Math.sin((longitude - lastProcessedLon) * Math.PI / 180) * Math.cos(latitude * Math.PI / 180);
            const x = Math.cos(lastProcessedLat * Math.PI / 180) * Math.sin(latitude * Math.PI / 180) -
                      Math.sin(lastProcessedLat * Math.PI / 180) * Math.cos(latitude * Math.PI / 180) * Math.cos((longitude - lastProcessedLon) * Math.PI / 180);
            const walkBearingRad = Math.atan2(y, x);
            Character3D.setHeading(walkBearingRad);
          }

          lastProcessedLat = latitude;
          lastProcessedLon = longitude;
          handlePosition(pos.coords);
        }
      },
      (err) => console.warn("watchPosition error", err),
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 }
    );
  }

  // Turn off GPS satellite radio when screen is locked in pocket
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      if (watchId) { navigator.geolocation.clearWatch(watchId); watchId = null; }
    } else {
      if (!watchId) beginWatch();
    }
  });

  function updatePlayerRadiusLayer() {
    if (!map || !currentPos) return;
    const radiusM = CONFIG.DIAMOND_COLLECT_RADIUS_METERS || 100;
    const ringCoords = Geo.createCirclePolygon(currentPos.lat, currentPos.lon, radiusM);

    const data = {
      type: "FeatureCollection",
      features: [
        // 100m boundary polygon
        {
          type: "Feature",
          properties: { type: "boundary" },
          geometry: { type: "Polygon", coordinates: [ringCoords] }
        },
        // Center point for the pulsing shockwave
        {
          type: "Feature",
          properties: { type: "center" },
          geometry: { type: "Point", coordinates: [currentPos.lon, currentPos.lat] }
        }
      ]
    };

    if (map.getSource("player-sonar-source")) {
      map.getSource("player-sonar-source").setData(data);
    }
  }

  function gateCashoutButtons(block) {
    if (typeof window === "undefined") return;
    document.querySelectorAll(".cashout-teaser-card, .lp-cashout-card, [data-cashout]").forEach(btn => {
      if (block) {
        btn.style.opacity = "0.35";
        btn.style.pointerEvents = "none";
        btn.title = "Disabled — VPN or datacenter connection detected";
      } else {
        btn.style.opacity = "";
        btn.style.pointerEvents = "";
        btn.title = "";
      }
    });
  }

  function triggerInstantBan() {
    console.error("[AntiCheat] Excessive teleportation strikes — flagging for review (no longer wipes local data).");
    showToast("🛡️ Unusual movement detected. Land/collect actions are temporarily paused.", 6000);
    if (typeof Store !== "undefined" && Store.getDb && Store.get().player?.id) {
      const db = Store.getDb();
      if (db) {
        db.collection("cheat_reports").add({
          playerId: Store.get().player.id,
          playerName: Store.get().player.name || "Unknown",
          type: "instant_ban_teleport",
          details: "Exceeded 3 teleportation strikes",
          timestamp: Date.now()
        }).catch(() => {});
      }
    }
    // NOTE: previously signed the player out and wiped their local save here.
    // Desktop/private-tab geolocation is frequently coarse and jumpy (Wi-Fi/IP based),
    // which made this trip constantly on completely legitimate players and destroyed
    // real progress. We now only log the report and reset the strike counter below
    // so a real player is never permanently punished for a false positive.
    const state = Store.get();
    state.antiCheatStrikes = 0;
    Store.save(true);
  }

  function checkTeleportation(lat, lon, timestamp, accuracy) {
    // Coarse Wi-Fi/IP-based fixes (common on desktop & private-tab browsers) can jump
    // many km between reads with no real movement — don't treat those as teleportation.
    if (typeof accuracy === "number" && accuracy > 1000) {
      return true;
    }
    const now = Date.now();
    if (_tp_lastTimestamp === 0) {
      _tp_lastLat = lat;
      _tp_lastLon = lon;
      _tp_lastTimestamp = now;
      return true;
    }

    const deltaMs = now - _tp_lastTimestamp;
    const deltaHours = deltaMs / 3600000;
    if (deltaHours < 0.001) {
      _tp_lastLat = lat;
      _tp_lastLon = lon;
      _tp_lastTimestamp = now;
      return true;
    }

    const distMeters = Geo.haversine(_tp_lastLat, _tp_lastLon, lat, lon);
    const distKm = distMeters / 1000;
    const speedKmh = distKm / deltaHours;

    _tp_lastLat = lat;
    _tp_lastLon = lon;
    _tp_lastTimestamp = now;

    if (distKm > TELEPORT_MIN_DISTANCE_KM && speedKmh > TELEPORT_SPEED_KMH) {
      const state = Store.get();
      state.antiCheatStrikes = (state.antiCheatStrikes || 0) + 1;
      Store.save(true);
      console.warn(`[AntiCheat] TELEPORT STRIKE ${state.antiCheatStrikes}/3: ${distKm.toFixed(1)}km in ${deltaHours.toFixed(3)}h (${speedKmh.toFixed(0)} km/h)`);
      if (typeof AntiCheat !== "undefined" && typeof AntiCheat.reportViolation === "function") {
        AntiCheat.reportViolation("teleport", `${distKm.toFixed(0)}km in ${deltaHours.toFixed(3)}h`);
      }
      if (state.antiCheatStrikes >= 3) {
        triggerInstantBan();
        return false;
      }
      showToast(`⚠️ Teleportation detected (${distKm.toFixed(0)}km). Strike ${state.antiCheatStrikes}/3.`, 5000);
      return false;
    }

    return true;
  }

  function detectMockProvider(coords) {
    const { accuracy, altitude, speed, altitudeAccuracy } = coords;

    if (typeof accuracy === "number" && accuracy <= 0) {
      return { flagged: true, reason: "invalid_accuracy_" + accuracy };
    }

    if (typeof accuracy === "number" && accuracy === 5 && altitudeAccuracy === 0) {
      return { flagged: true, reason: "simulator_default_accuracy" };
    }

    const accStr = String(accuracy);
    if (/^\d+\.\d{6,}$/.test(accStr)) {
      const decPart = accStr.split(".")[1];
      if (decPart.replace(/0/g, "").length === 0) {
        return { flagged: true, reason: "artificial_accuracy_" + decPart.slice(0, 4) };
      }
    }

    // NOTE: null_alt_and_speed check REMOVED — legitimate browsers (desktop, Safari private)
    // often don't report altitude/speed. This caused false rejections for real players.

    return { flagged: false, reason: null };
  }

  let lastCameraCenter = null;
  let _gpsGraceUntil = Date.now() + 15000; // 15-second grace period on first load

  function handlePosition(coords) {
    currentPos = { lat: coords.latitude, lon: coords.longitude };
    if (!map) return;

    // GPS grace period: skip speed/teleport checks for 15 seconds after sign-in
    // to prevent false positives from the auto-login → manual sign-in race condition
    const inGracePeriod = Date.now() < _gpsGraceUntil;

    // Anti-cheat: Validate GPS position for spoofing
    if (typeof AntiCheat !== "undefined" && !inGracePeriod) {
      const gpsCheck = AntiCheat.validatePosition(
        coords.latitude, coords.longitude,
        coords.accuracy, coords.timestamp
      );
      if (!gpsCheck.valid) {
        console.warn(`[AntiCheat] GPS rejected: ${gpsCheck.reason}`);
        showToast("🛡️ GPS anomaly detected. Please verify your location.", 4000);
        if (typeof AntiCheat.reportViolation === "function") {
          AntiCheat.reportViolation("gps_spoof", gpsCheck.reason);
        }
        return; // Reject this position
      }
    }

    // Teleportation Sanity Watchdog (skip during grace period)
    if (!inGracePeriod && !checkTeleportation(coords.latitude, coords.longitude, coords.timestamp, coords.accuracy)) {
      return;
    }

    // GPS Accuracy & Mock Provider Detection (skip during grace period)
    const mockCheck = inGracePeriod ? { flagged: false } : detectMockProvider(coords);
    if (mockCheck.flagged) {
      console.warn(`[AntiCheat] MOCK GPS FLAGGED: ${mockCheck.reason}`);
      showToast("⚠️ Mock location detected. Please use real GPS.", 4000);
      if (typeof AntiCheat !== "undefined" && typeof AntiCheat.reportViolation === "function") {
        AntiCheat.reportViolation("mock_gps", mockCheck.reason);
      }
      return;
    }

    // Server-side position validation (async — doesn't block game loop)
    // Skip during grace period to prevent false rejections on first load
    if (!inGracePeriod && typeof ServerAntiCheat !== "undefined" && ServerAntiCheat.isReady()) {
      ServerAntiCheat.sendPosition(coords).then(result => {
        if (result && !result.valid) {
          console.warn(`[ServerAntiCheat] REJECTED: ${result.reason} (speed=${result.speed}km/h)`);
          // Show user-friendly message instead of raw reason codes
          const friendlyMessages = {
            "rate_limited": "Too many updates. Slow down.",
            "invalid_coordinates": "Invalid GPS coordinates detected.",
            "coordinates_out_of_range": "GPS coordinates out of range.",
            "stale_position": "Position data is outdated.",
            "invalid_accuracy": "GPS accuracy issue detected.",
            "simulator_default_accuracy": "Simulator detected. Please use a real device.",
            "artificial_accuracy": "GPS accuracy anomaly detected.",
            "teleportation": "Movement too fast. Possible GPS spoofing.",
            "excessive_speed": "Movement speed exceeded limit.",
          };
          const msg = friendlyMessages[result.reason] || "Position rejected. Please verify your location.";
          showToast("🛡️ " + msg, 5000);
          if (result.reason && result.reason.includes("banned")) {
            setTimeout(() => { window.location.href = "/"; }, 3000);
          }
        }
      }).catch(() => {});
    }
    
    if (typeof Citadels !== "undefined") Citadels.setPlayerPosition(currentPos.lat, currentPos.lon);
    if (typeof EldenStops !== "undefined") EldenStops.setPlayerPosition(currentPos.lat, currentPos.lon);

    // 1. Move 3D Character & Radius Layer
    Character3D.setPlayerPosition(currentPos.lon, currentPos.lat);
    if (typeof CompanionPet !== "undefined") {
      CompanionPet.setPlayerPosition(currentPos.lon, currentPos.lat);
    }
    if (typeof BuddySystem !== "undefined") {
      try {
        BuddySystem.setPlayerPosition(currentPos.lat, currentPos.lon, coords.accuracy);
      } catch (err) {
        console.warn("[Buddy] setPlayerPosition failed:", err);
      }
    }
    updatePlayerRadiusLayer();
    Diamonds.setPlayerPosition(currentPos.lat, currentPos.lon);
    // The grid is drawn from its own playerCoords — without this buy mode stays
    // frozen at the position it was opened at and you walk straight out of the
    // placement radius before the tile lands.
    if (typeof Grid !== "undefined" && Grid.setPlayerPosition) {
      Grid.setPlayerPosition(currentPos.lat, currentPos.lon);
    }

    // Anti-cheat: Periodic territory check for embargo (every ~500m movement)
    if (typeof AntiCheat !== "undefined" && typeof Geo !== "undefined") {
      const _acs = Store.get();
      const lastTerritory = _acs?.lastTerritoryCheck || { lat: 0, lon: 0 };
      const territoryDist = Geo.haversine(lastTerritory.lat, lastTerritory.lon, currentPos.lat, currentPos.lon);
      if (territoryDist > 500 || !lastTerritory.lat) {
        _acs.lastTerritoryCheck = { lat: currentPos.lat, lon: currentPos.lon };
        Store.save(true);
        Geo.getTerritoryInfo(currentPos.lat, currentPos.lon).then(info => {
          if (AntiCheat.getEmbargoStatus().isEmbargoed) {
            const emModal = document.getElementById("embargo-modal");
            if (emModal) emModal.classList.remove("hidden");
          }
        }).catch(() => {});
      }
    }

    // Realtime city boundary detection — refresh leaderboard when player enters a new city
    if (typeof Geo !== "undefined" && Geo.getTerritoryInfo) {
      Geo.getTerritoryInfo(currentPos.lat, currentPos.lon).then(info => {
        if (!info || !info.city) return;
        const cityKey = info.city.replace(/[\u{1F1E6}-\u{1F1FF}\u{2600}-\u{27BF}\uFE0F]/gu, "").trim().toLowerCase();
        if (cityKey && cityKey !== _lastKnownCity) {
          _lastKnownCity = cityKey;
          // Invalidate leaderboard caches so city/state tabs re-scope to new location
          if (typeof Leaderboard !== "undefined") {
            Leaderboard.invalidateLiveTerritory();
            Leaderboard.invalidateCache();
            // Auto-render leaderboard if modal is currently open
            const lbModal = document.getElementById("leaderboard-modal");
            if (lbModal && !lbModal.classList.contains("hidden")) {
              Leaderboard.open();
            }
          }
          // Immediately update the landlord pill to reflect new city
          if (typeof updateLandlordPill === "function") {
            updateLandlordPill();
          }
        }
      }).catch(() => {});
    }

    // 2. Camera Follow Deadzone: Only glide camera if player actually moved > 0.8 meters
    const dist = lastCameraCenter ? Geo.haversine(lastCameraCenter.lat, lastCameraCenter.lon, currentPos.lat, currentPos.lon) : 999;

    if (dist > 0.8 && !isUserInteracting && !isOrbiting && !(typeof EldenStops !== "undefined" && EldenStops.isCinematicOpen())) {
      lastCameraCenter = { lat: currentPos.lat, lon: currentPos.lon };
      map.easeTo({
        center: [currentPos.lon, currentPos.lat],
        duration: 1000,
        easing: (t) => t,
        essential: true
      });
    }
  }
  
  // ---------------- 3D Map / Game Launch with Auto-Fallback ----------------
  function launchGame(coords) {
    document.body.classList.toggle("no-shake", Boolean(Store.get()?.disableShake));
    currentPos = { lat: coords.latitude, lon: coords.longitude };

    // --- HARD VPN BLOCK: Run verification BEFORE showing the game screen ---
    // VPN/Datacenter users are blocked entirely — no gameplay allowed.
    if (typeof Geo !== "undefined" && Geo.NetworkVerifier) {
      Geo.NetworkVerifier.verify(coords.latitude, coords.longitude).then(result => {
        const state = Store.get();
        state.networkVerification = result;
        Store.save(true);

        if (result.isVPN || result.isDatacenter) {
          const reason = result.isVPN ? "VPN" : "datacenter";
          el("locate-screen")?.classList.add("hidden");
          el("loading-screen")?.classList.add("hidden");
          el("game-screen")?.classList.add("hidden");

          const blockModal = document.getElementById("vpn-block-modal");
          const reasonEl = document.getElementById("vpn-block-reason");
          if (reasonEl) {
            reasonEl.textContent = reason === "VPN"
              ? "VPN connections are not allowed in Elden Earth."
              : "Datacenter/proxy connections are not allowed.";
          }
          if (blockModal) blockModal.classList.remove("hidden");

          gateCashoutButtons(true);
          return;
        }

        if (result.isSuspicious) {
          showToast("⚠️ Network location mismatch. Please disable VPN.", 5000);
          gateCashoutButtons(true);
        }

        // Network clean — launch the game
        el("locate-screen")?.classList.add("hidden");
        el("loading-screen")?.classList.add("hidden");
        el("game-screen")?.classList.remove("hidden");
        _finishGameLaunch();
      }).catch(() => {
        // If verification fails entirely, allow gameplay but flag for review
        el("locate-screen")?.classList.add("hidden");
        el("loading-screen")?.classList.add("hidden");
        el("game-screen")?.classList.remove("hidden");
        _finishGameLaunch();
      });
      return; // Defer — verification handles the launch
    }

    // No NetworkVerifier available — launch immediately
    el("locate-screen")?.classList.add("hidden");
    el("loading-screen")?.classList.add("hidden");
    el("game-screen")?.classList.remove("hidden");
    _finishGameLaunch();
  }

  // Shared object visibility (normal view + Bird's Eye; outer IIFE scope).
  //
  // The player collection radius ring is GAMEPLAY information, not decoration.
  // It used to be culled together with foliage/citadel parcels at
  // MAP_CULL_MIN_ZOOM, which made it vanish the moment you zoomed out — so it
  // gets its own (much lower) floor instead.
  const PLAYER_RING_MIN_ZOOM = 12;

  function applyBirdsEyeLayerVisibility() {
    if (typeof map === "undefined" || !map) return;
    const off = (k) => document.body.classList.contains("be-off-" + k);
    const culled = document.body.classList.contains("map-culled-far") ||
      map.getZoom() < (CONFIG.MAP_CULL_MIN_ZOOM || 14);
    const ringVisible = !off("player") && map.getZoom() >= PLAYER_RING_MIN_ZOOM;
    const setVis = (id, visible) => {
      if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", visible ? "visible" : "none");
    };
    setVis("plots-grass-base", !off("plots"));
    setVis("plots-fill", !off("plots"));
    setVis("plots-line", !off("plots"));
    setVis("player-sonar-fill", ringVisible);
    setVis("player-sonar-line", ringVisible);
    setVis("foliage-layer", !off("foliage") && !culled);
    setVis("citadel-parcels-fill", !off("citadel") && !culled);
    setVis("citadel-parcels-line", !off("citadel") && !culled);
    setVis("empty-grid-fill", !culled);
    setVis("empty-grid-line", !culled);
    setVis("3d-buildings", !culled);
  }

  function _finishGameLaunch() {
    const MAP_STYLES = {
      "elden-earth": "https://tiles.openfreemap.org/styles/dark",
      liberty: "https://tiles.openfreemap.org/styles/liberty",
      positron: "https://tiles.openfreemap.org/styles/positron",
      bright: "https://tiles.openfreemap.org/styles/bright",
    };
    const mapStyle = localStorage.getItem("eldenEarth.mapStyle") || "elden-earth";
    const styleUrl = MAP_STYLES[mapStyle] || MAP_STYLES.dark;

    // 1. Initialize 3D Camera with 2-Finger Vertical Tilt & 1-Finger Orbit
    map = new mapboxgl.Map({
      container: "map",
      style: styleUrl,
      center: [currentPos.lon, currentPos.lat],
      zoom: 18.0,
      minZoom: 2,        // Allow full globe zoom-out
      maxZoom: 20.0,     // Street-level max zoom-in
      pitch: 75,         // Default 60° angle
      minPitch: 0,       // Allows flat 0° top-down view
      maxPitch: 75,      // Allows cinematic 70° low angle
      bearing: 0,
      antialias: false, // Saves 30% GPU load
      dragPan: false,    // Map stays locked to player (cannot scroll away)
      dragRotate: true,
      touchZoomRotate: true,
      touchPitch: true,  // Enables native 2-finger vertical swipe to tilt camera angle!
      fadeDuration: 0, // Eliminates expensive GPU alpha-blending on tile loads
      canvasContextAttributes: { antialias: false, powerPreference: "low-power" } // Routes graphics through mobile energy-efficiency cores
    });

    // --- MAP STYLE TOGGLE ---
    function toggle3DBuildings(enable) {
      if (!map) return;
      const layers = map.getStyle().layers;
      let labelLayerId;
      for (let i = 0; i < layers.length; i++) {
        if (layers[i].type === "symbol" && layers[i].layout["text-field"]) {
          labelLayerId = layers[i].id;
          break;
        }
      }
      if (map.getLayer("3d-buildings")) {
        map.removeLayer("3d-buildings");
      }
      if (enable && labelLayerId) {
        map.addLayer({
          id: "3d-buildings",
          source: "carto",
          "source-layer": "building",
          type: "fill-extrusion",
          minzoom: 15,
          paint: {
            "fill-extrusion-color": [
              "interpolate", ["linear"], ["get", "render_height"], 0, "#1a1a2e", 50, "#2a3a5c", 100, "#3a5a8c"
            ],
            "fill-extrusion-height": ["get", "render_height"],
            "fill-extrusion-base": ["get", "render_min_height"],
            "fill-extrusion-opacity": 0.7,
          },
        }, labelLayerId);
      }
    }

    function applyMapStyle(styleKey) {
      if (!map) return;
      const is3D = styleKey === "3d";
      const url = is3D ? (MAP_STYLES["elden-earth"]) : (MAP_STYLES[styleKey] || MAP_STYLES["elden-earth"]);
      // Register BEFORE setStyle(). The handler was previously attached after
      // the call, so if the style resolved from cache the load event could fire
      // first and setupGameLayers() would never run — which is exactly what
      // left street names visible and the player model buried under plots.
      map.once("style.load", () => {
        // Re-add all game layers that setStyle destroyed
        Grid.render();
        setupGameLayers();
        toggle3DBuildings(is3D);
        Diamonds.renderAll();
        if (typeof Citadels !== "undefined") Citadels.render();
        // Style swap recreated layers — force a fresh LOD visibility pass
        lastCulledState = null;
        applyMapLod();
        refreshMapModulesAfterZoom();
      });
      map.setStyle(url);
      localStorage.setItem("eldenEarth.mapStyle", styleKey);
      document.querySelectorAll(".map-style-btn").forEach(btn => {
        btn.classList.toggle("is-active", btn.dataset.style === styleKey);
        btn.style.borderColor = "";
        btn.style.color = "";
        btn.style.background = "";
      });
    }

    document.querySelectorAll(".map-style-btn").forEach(btn => {
      btn.addEventListener("click", () => applyMapStyle(btn.dataset.style));
    });
    applyMapStyle(mapStyle);

    // Multi-touch Controller: 1-finger orbit & 2-finger pitch/zoom
    let lastTouchX = 0;
    const canvas = map.getCanvas();

    canvas.addEventListener("touchstart", (e) => {
      isUserInteracting = true;
      if (e.touches.length === 1) {
        isOrbiting = true;
        lastTouchX = e.touches[0].clientX;
      } else {
        // 2 fingers on screen: Hand control directly to MapLibre for vertical pitch & pinch-zoom
        isOrbiting = false;
      }
    }, { passive: true });

    canvas.addEventListener("touchmove", (e) => {
      // 1-finger horizontal swipe rotates camera around player
      if (isOrbiting && e.touches.length === 1) {
        const deltaX = e.touches[0].clientX - lastTouchX;
        lastTouchX = e.touches[0].clientX;
        map.setBearing(map.getBearing() + deltaX * 0.45);
      }
    }, { passive: true });

    canvas.addEventListener("touchend", () => {
      isOrbiting = false;
      // Grace period before GPS auto-follow resumes
      setTimeout(() => { isUserInteracting = false; }, 350);
    });

    // Re-lock center strictly when gestures finish (never interrupts animations mid-flight)
    map.on("zoomend", () => {
      if (currentPos) map.setCenter([currentPos.lon, currentPos.lat]);
      applyMapLod();
      refreshMapModulesAfterZoom();
    });

    // Cheap per-frame LOD toggle while pinching/scrolling (class + CSS var only).
    // Layer visibility + marker teardown happen on zoomend.
    map.on("zoom", applyMapLod);

    // ======================== FAR-ZOOM LOD CULLING ========================
    // When the player zooms out past MAP_CULL_MIN_ZOOM (or enters Bird's Eye),
    // destroy every decorative 3D/DOM game object. Only landplot tile polygons
    // stay on the map. This is the main phone-GPU heat relief valve.
    let lastCulledState = null;

    function applyMapLod() {
      if (!map || !map.getStyle) return;
      const zoom = map.getZoom();
      const cullZoom = CONFIG.MAP_CULL_MIN_ZOOM || 14;
      const culled = zoom < cullZoom;

      document.body.classList.toggle("map-culled-far", culled);

      // World-anchored beacon scale: shrinks Elden Stops as the player zooms out
      // so they keep a fixed map size instead of a fixed (massive) screen size.
      const refZoom = CONFIG.ELDEN_STOP_BASE_ZOOM || 18;
      const minScale = CONFIG.ELDEN_STOP_MIN_SCALE || 0.4;
      const maxScale = CONFIG.ELDEN_STOP_MAX_SCALE || 1.15;
      const scale = Math.min(maxScale, Math.max(minScale, Math.pow(2, zoom - refZoom)));
      document.documentElement.style.setProperty("--eld-stop-scale", scale.toFixed(3));

      // All layer visibility is owned by applyBirdsEyeLayerVisibility() and is
      // re-applied on EVERY pass. The old "only when the culled flag flips"
      // optimisation is gone: it saved a handful of setLayoutProperty calls but
      // was exactly how the player collection ring ended up stuck at
      // visibility:none after a Bird's Eye pass or a style reload.
      applyBirdsEyeLayerVisibility();
    }

    function refreshMapModulesAfterZoom() {
      if (typeof Grid !== "undefined" && Grid.render) Grid.render();
      if (typeof EldenStops !== "undefined") {
        EldenStops.renderAll();
      }
      if (typeof Citadels !== "undefined") Citadels.render();
      if (typeof Diamonds !== "undefined") Diamonds.renderAll();
      if (typeof Foliage !== "undefined") Foliage.update();
      applyMapLod();
    }

    // Initial LOD pass once the map exists
    applyMapLod();

    // --- Instant Identity Recovery (Pulls Name & Photo from your 25 plots) ---
    const state = Store.get();
    if (state && state.player && (!state.player.name || state.player.name === "Traveler")) {
      const allPlots = (typeof Grid !== "undefined" && Grid.getAllPlots) ? Grid.getAllPlots() : (state.plots || {});
      for (const id in allPlots) {
        const p = allPlots[id];
        if (p.ownerId === state.player.id && p.ownerName && p.ownerName !== "Traveler") {
          state.player.name = p.ownerName;
          if (p.avatar && p.avatar !== "🙂") state.player.avatar = p.avatar;
          console.log(`[Main] Restored player identity: ${state.player.name}`);
          Store.save(true);
          break;
        }
      }
    }
    
    function setupGameLayers() {
      if (!map || !map.getStyle()) return;

      // 0. Privacy: hide street / road / address labels on every style.
      // Re-runnable — the style can finish populating its symbol layers after
      // this first pass, which is how street names were leaking back in.
      hideStreetLabels();

      // 1. Dynamic Street & Road Illuminator (Brightens pitch-black vector tiles)
      try {
        const layers = map.getStyle().layers || [];
        layers.forEach((l) => {
          // Brighten and highlight all roads, streets, highways, and paths
          if (l.type === "line" && (l.id.includes("road") || l.id.includes("street") || l.id.includes("highway") || l.id.includes("transportation") || l.id.includes("path") || l.id.includes("track"))) {
            map.setPaintProperty(l.id, "line-color", "#2d4059");
            map.setPaintProperty(l.id, "line-opacity", 0.9);
          }
          // Lift pitch-black background to rich midnight obsidian
          if (l.type === "background") {
            map.setPaintProperty(l.id, "background-color", "#0e1522");
          }
        });
      } catch (err) {
        console.warn("[MapEngine] Street brighten notice:", err);
      }

      // 2. Add True 3D Extruded Buildings (if source exists)
      try {
        const layers = map.getStyle().layers || [];
        const labelLayerId = layers.find(l => l.type === "symbol" && l.layout && l.layout["text-field"])?.id;

        if (!map.getLayer("3d-buildings") && (map.getSource("composite") || map.getSource("openmaptiles"))) {
          const buildingSource = map.getSource("composite") ? "composite" : "openmaptiles";
          map.addLayer({
            id: "3d-buildings",
            source: buildingSource,
            "source-layer": "building",
            filter: ["==", "extrude", "true"],
            type: "fill-extrusion",
            minzoom: 15,
            paint: {
              "fill-extrusion-color": "#1f2c40",
              "fill-extrusion-height": ["get", "height"],
              "fill-extrusion-base": ["get", "min_height"],
              "fill-extrusion-opacity": 0.85,
            },
          }, labelLayerId);
        }
      } catch (err) {
        console.log("[MapEngine] 3D buildings setup note:", err);
      }

      // 3. Mount 3D Animated Character
      // Each subsystem below is isolated. They all share this function with
      // the player sonar ring (3.5) and Grid/Diamonds (4) — one throw must
      // never leave the map without its collection radius ring or with
      // unlit roads.
      try {
        Character3D.init(map, currentPos.lon, currentPos.lat);
      } catch (err) {
        console.warn("[MapEngine] Character3D init failed (map setup continues):", err);
      }

      // 3.1. Mount 3D Companion Pet System
      try {
        if (typeof CompanionPet !== "undefined") {
          CompanionPet.init(map, currentPos.lon, currentPos.lat);
        }
      } catch (err) {
        console.warn("[CompanionPet] init failed (map setup continues):", err);
      }

      // 3.1b. Mount Buddy System (wild spawns, Buddy Bag, battles).
      try {
        if (typeof BuddySystem !== "undefined") {
          BuddySystem.init(map, currentPos.lon, currentPos.lat);
        }
      } catch (err) {
        console.warn("[Buddy] init failed (map setup continues):", err);
      }
      try {
        if (typeof PlayerXP !== "undefined") {
          PlayerXP.init();
        }
      } catch (err) {
        console.warn("[PlayerXP] init failed (map setup continues):", err);
      }

      // 3.2. Initialize 3D Standing Foliage Engine
      try {
        if (typeof Foliage !== "undefined") {
          Foliage.init(map);
        }
      } catch (err) {
        console.warn("[Foliage] init failed (map setup continues):", err);
      }
      
      // 3.5. Mount 3D Ground Sonar Layer (Locked to exact real-world meters)
      const radiusM = CONFIG.DIAMOND_COLLECT_RADIUS_METERS || 100;
      const initialRing = Geo.createCirclePolygon(currentPos.lat, currentPos.lon, radiusM);

      if (!map.getSource("player-sonar-source")) {
        map.addSource("player-sonar-source", {
          type: "geojson",
          data: {
            type: "FeatureCollection",
            features: [
              {
                type: "Feature",
                properties: { type: "boundary" },
                geometry: { type: "Polygon", coordinates: [initialRing] }
              },
              {
                type: "Feature",
                properties: { type: "center" },
                geometry: { type: "Point", coordinates: [currentPos.lon, currentPos.lat] }
              }
            ]
          }
        });

        map.addLayer({
          id: "player-sonar-fill",
          type: "fill",
          source: "player-sonar-source",
          filter: ["==", ["get", "type"], "boundary"],
          paint: {
            "fill-color": "#4fd6c4",
            "fill-opacity": 0.05
          }
        });

        map.addLayer({
          id: "player-sonar-line",
          type: "line",
          source: "player-sonar-source",
          paint: {
            "line-color": "#4fd6c4",
            "line-width": 2,
            "line-dasharray": [3, 2],
            "line-opacity": 0.85
          }
        });
      }

      // 4. Initialize Core Game Subsystems
      Grid.init(map, {
        onBuyAttempt: (success, rarity) => {
          if (success) {
            showToast(`Claimed a ${rarity.label} plot!`);
            updateTopbar();

            // Check if pet should be unlocked (50 plots milestone)
            if (typeof CompanionPet !== "undefined") {
              CompanionPet.checkUnlockMilestone();
              CompanionPet.updatePetHUD();
            }

            // Refresh leaderboard data every 60 seconds so passive rent stays current
            if (Date.now() - lastLeaderboardRefresh >= 60000) {
              lastLeaderboardRefresh = Date.now();
              if (typeof Leaderboard !== "undefined" && Leaderboard.fetchRankings) {
                Leaderboard.fetchRankings(true);
              }
            }
            updateLandModal();
          } else {
            // Grid already shows the precise failure reason (cooldown, distance,
            // already claimed, EB...). Never mislabel failures as "need 100 EB".
          }
        },
      });
      Grid.render();

      Diamonds.init(map, {
        onCollect: () => { updateTopbar(); showToast(`Found a diamond! ${iconDiamond} +1`); },
        onDenied: () => {},
      });
      Diamonds.setPlayerPosition(currentPos.lat, currentPos.lon);
      // Hoist the 3D layers above the plot tiles and re-sweep street labels.
      // Both depend on layers that may not exist yet at this exact instant, so
      // this runs now AND again shortly after (see finalizeMapLayers).
      finalizeMapLayers();

      // Late passes: the custom layers and the style's symbol layers can land
      // after setupGameLayers() returns. Without these the player model could
      // render underneath the plot tiles and street names could reappear.
      clearTimeout(finalizeMapLayers._t1);
      clearTimeout(finalizeMapLayers._t2);
      finalizeMapLayers._t1 = setTimeout(finalizeMapLayers, 350);
      finalizeMapLayers._t2 = setTimeout(finalizeMapLayers, 1500);
    }

    // Hide street labels (idempotent).
    function hideStreetLabels() {
      if (!map || !map.getStyle) return;
      try {
        (map.getStyle().layers || []).forEach((l) => {
          if (l.type !== "symbol") return;
          const id = String(l.id || "").toLowerCase();
          const srcLayer = String(l["source-layer"] || "").toLowerCase();
          const isStreetLabel =
            id.includes("road") ||
            id.includes("street") ||
            id.includes("highway") ||
            id.includes("motorway") ||
            id.includes("address") ||
            id.includes("housenumber") ||
            id.includes("path") ||
            id.includes("track") ||
            id.includes("transportation") ||
            srcLayer.includes("transportation") ||
            srcLayer.includes("road") ||
            srcLayer.includes("street") ||
            srcLayer.includes("building");
          if (isStreetLabel) {
            try { map.setLayoutProperty(l.id, "visibility", "none"); } catch (_) {}
          }
        });
      } catch (err) {
        console.warn("[MapEngine] Street label hide notice:", err);
      }
    }

    // Put every 3D game layer above the plot tiles, and re-sweep labels.
    // Idempotent — safe to call as often as we like.
    function finalizeMapLayers() {
      if (!map || !map.getLayer) return;
      try {
        hideStreetLabels();
        ["3d-player-character", "3d-companion-pet", "3d-active-buddy"].forEach((id) => {
          try {
            if (map.getLayer(id)) map.moveLayer(id);
          } catch (e) {}
        });
      } catch (err) {
        console.warn("[MapEngine] finalizeMapLayers notice:", err);
      }
    }

    map.on("load", () => {
      setupGameLayers();

      // Atmospheric Horizon Fog (Atlas Earth Style Sky/Horizon Blend)
      try {
        if (map.setFog) {
          map.setFog({
            range: [0.5, 3.5], // Blends the horizon smoothly into clean dark sky
            color: "#080d14",  // Deep midnight obsidian sky
            "horizon-blend": 0.5
          });
        }
      } catch (e) {}
      // Apply 3D buildings if user has 3D style selected
      if ((localStorage.getItem("eldenEarth.mapStyle") || "elden-earth") === "3d") {
        toggle3DBuildings(true);
      }
      // Game layers now exist — apply far-zoom LOD visibility for real
      lastCulledState = null;
      applyMapLod();
    });

    Wheel.init();
    if (typeof Feed !== "undefined") Feed.init();
    if (typeof Leaderboard !== "undefined") Leaderboard.init();
    if (typeof Chat !== "undefined") Chat.init();
    if (typeof Citadels !== "undefined") {
      Citadels.init(map);
      Citadels.setPlayerPosition(currentPos.lat, currentPos.lon); // Immediate GPS sync on boot!
    }
    if (typeof EldenStops !== "undefined") {
      EldenStops.init(map, { 
        onRewards: () => {
          updateTopbar();
          // Award berries when spinning Elden Stops
          if (typeof CompanionPet !== "undefined") {
            const berryCount = Math.floor(Math.random() * 3) + 1; // 1-3 berries per spin
            CompanionPet.addBerries(berryCount);
            showToast(`🍓 +${berryCount} Berries from Elden Stop!`);
          }
        }
      });
      EldenStops.setPlayerPosition(currentPos.lat, currentPos.lon);
    }
    if (typeof WeeklyPool !== "undefined") WeeklyPool.init();
    startIncomeLoop();
    wireUI();
    wireTutorial();
    initLandlordPill();

    // --- Battery Saver & Background Sleep Controller (0% Battery in Pocket) ---
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) {
        // Phone screen locked or app backgrounded -> Put game to complete sleep!
        console.log("[Power] Screen locked/backgrounded — Game asleep (0% GPU/CPU).");
      } else {
        // Phone unlocked -> Wake up & calculate accrued offline rent in 0ms!
        console.log("[Power] Screen active — Game resumed.");
        Store.applyOfflineProgress();
        updateTopbar();
        if (typeof Leaderboard !== "undefined" && Leaderboard.fetchRankings) {
          Leaderboard.fetchRankings(true);
        }
      }
    });

    // Start tutorial for new players after game is fully loaded
    setTimeout(() => { startTutorial(); }, 1500);
    setTimeout(() => { maybeRecoverNewPlayerBonus(); }, 2500);
  }

  // ======================== NEW PLAYER TUTORIAL ========================
  const TUTORIAL_KEY = "eldenEarth.tutorialComplete.v1";

  const TUTORIAL_STEPS = [
    {
      target: null,
      title: "Welcome to Elden Earth!",
      text: "I'm your guide. I'll walk you through the Realm so you can start claiming land and earning passive income. Let's go!",
      position: "center",
    },
    {
      target: ".player-chip",
      title: "Your Treasury",
      text: "Tap your avatar up here to open your profile. Your Realm Coins balance, Elden Bucks, gems and live income rate all live there — and the balance ticks in real time while the panel is open.",
      position: "below",
    },
    {
      target: "#buy-nav-btn",
      title: "Claim Land",
      text: "Tap BUY to enter claim mode. Walk around in the real world and tap empty tiles near you to purchase plots. More plots = more income!",
      position: "above",
    },
    {
      target: "#leaderboard-btn",
      title: "Realm Rankings",
      text: "Check your rank against other landlords. Compete to become Mayor of your city, Governor of your state, or President of your country!",
      position: "right",
    },
    {
      target: "#menu-btn",
      title: "How to Play",
      text: "Tap this button any time for the full guide — collecting diamonds, spinning the wheel, claiming land, boosts, and how the Realm's rewards work. Your avatar button on the left is where you change your name and photo.",
      position: "below",
    },
    {
      target: null,
      title: "You're All Set!",
      text: "Here's your New Explorer Bonus: 4,000 EB + 500 Diamonds! Use them to claim your first plots and start building your empire. Welcome to the Realm!",
      position: "center",
      isFinal: true,
    },
  ];

  let _tutorialStep = 0;
  let _tutorialActive = false;

  function isTutorialComplete() {
    return localStorage.getItem(TUTORIAL_KEY) === "true";
  }

  function isNewPlayer() {
    const state = Store.get();
    // Existing players have plots — don't show tutorial
    const plotCount = Object.keys(state.plots || {}).length;
    if (plotCount > 0) return false;
    // Check if bonus was already claimed (cloud-persisted, survives cache clear)
    if (state.player?.bonusClaimed) return false;
    // Check account creation time — if created more than 10 minutes ago, skip
    const createdAt = state.player?.createdAt || 0;
    if (createdAt && (Date.now() - createdAt > 10 * 60 * 1000)) return false;
    return true;
  }

  function markTutorialComplete() {
    localStorage.setItem(TUTORIAL_KEY, "true");
  }

  function startTutorial() {
    if (isTutorialComplete()) return;
    if (!isNewPlayer()) {
      markTutorialComplete();
      return;
    }
    _tutorialStep = 0;
    _tutorialActive = true;
    const overlay = el("tutorial-overlay");
    if (overlay) overlay.classList.remove("hidden");
    initTutorialGuide();
    renderTutorialStep();
  }

  function endTutorial() {
    _tutorialActive = false;
    const overlay = el("tutorial-overlay");
    if (overlay) overlay.classList.add("hidden");
    markTutorialComplete();
    destroyTutorialGuide();
  }

  function renderTutorialStep() {
    const step = TUTORIAL_STEPS[_tutorialStep];
    if (!step) { endTutorial(); return; }

    const spotlight = el("tutorial-spotlight");
    const tooltip = el("tutorial-tooltip");
    const titleEl = el("tutorial-tooltip-title");
    const textEl = el("tutorial-tooltip-text");
    const stepEl = el("tutorial-step-indicator");
    const nextBtn = el("tutorial-next-btn");
    const skipBtn = el("tutorial-skip-btn");
    const guide = el("tutorial-guide");

    if (!tooltip || !titleEl) return;

    titleEl.textContent = step.title;
    textEl.textContent = step.text;
    stepEl.textContent = `Step ${_tutorialStep + 1} of ${TUTORIAL_STEPS.length}`;

    // Final step: change Next → Claim Reward
    if (step.isFinal) {
      nextBtn.textContent = "Claim Reward";
      nextBtn.classList.add("tutorial-finish");
      skipBtn.style.display = "none";
    } else {
      nextBtn.textContent = "Next";
      nextBtn.classList.remove("tutorial-finish");
      skipBtn.style.display = "";
    }

    // Spotlight cutout around target element
    if (step.target) {
      const targetEl = document.querySelector(step.target);
      if (targetEl) {
        const rect = targetEl.getBoundingClientRect();
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        const r = Math.max(rect.width, rect.height) / 2 + 16;
        spotlight.style.clipPath = `circle(0px at ${cx}px ${cy}px)`;
        requestAnimationFrame(() => {
          spotlight.style.clipPath = `circle(${r}px at ${cx}px ${cy}px)`;
        });
        positionTooltip(step.position, rect);
        if (guide) guide.style.display = "none";
      }
    } else {
      // Center steps: full-screen spotlight off, show guide
      spotlight.style.clipPath = "none";
      positionTooltip("center", null);
      if (guide) {
        guide.style.display = "";
        guide.style.position = "fixed";
        guide.style.bottom = "200px";
        guide.style.left = "20px";
      }
    }
  }

  function positionTooltip(position, targetRect) {
    const tooltip = el("tutorial-tooltip");
    if (!tooltip) return;
    const tw = tooltip.offsetWidth || 280;
    const th = tooltip.offsetHeight || 180;
    const margin = 16;

    if (!targetRect) {
      // Center on screen
      tooltip.style.left = `calc(50% - ${tw / 2}px)`;
      tooltip.style.top = `calc(50% - ${th / 2}px)`;
      return;
    }

    let left, top;
    switch (position) {
      case "below":
        left = targetRect.left + targetRect.width / 2 - tw / 2;
        top = targetRect.bottom + margin;
        break;
      case "above":
        left = targetRect.left + targetRect.width / 2 - tw / 2;
        top = targetRect.top - th - margin;
        break;
      case "right":
        left = targetRect.right + margin;
        top = targetRect.top + targetRect.height / 2 - th / 2;
        break;
      case "left":
        left = targetRect.left - tw - margin;
        top = targetRect.top + targetRect.height / 2 - th / 2;
        break;
      default:
        left = targetRect.left + targetRect.width / 2 - tw / 2;
        top = targetRect.bottom + margin;
    }

    // Clamp to viewport
    left = Math.max(8, Math.min(left, window.innerWidth - tw - 8));
    top = Math.max(8, Math.min(top, window.innerHeight - th - 8));

    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
  }

  function advanceTutorial() {
    const step = TUTORIAL_STEPS[_tutorialStep];
    if (step && step.isFinal) {
      // Victory dance on final step!
      playGuideEmote("Victory");
      setTimeout(() => {
        awardNewPlayerBonus();
        endTutorial();
      }, 1200);
      return;
    }
    _tutorialStep++;
    // Play a random emote on each Next tap
    const emotes = ["Wave", "Jump", "Yes", "Dance"];
    playGuideEmote(emotes[_tutorialStep % emotes.length]);
    renderTutorialStep();
  }

  function awardNewPlayerBonus() {
    // Only award if player is actually new
    if (!isNewPlayer()) return;
    const state = Store.get();
    const BONUS_EB = 4000;
    const BONUS_DIAMONDS = 500;
    // Optimistic for feel. The SERVER grant is what sticks — eb/diamonds are
    // server-owned, so the old client-only "+=" was stomped by the next sync's
    // authoritative mirror (the "bonus doesn't stick" bug).
    state.eb = (Number(state.eb) || 0) + BONUS_EB;
    state.diamonds = (Number(state.diamonds) || 0) + BONUS_DIAMONDS;
    state.player.bonusClaimed = true; // Cloud-persisted — prevents re-claim
    Store.save(true);
    updateTopbar();
    showToast(`🎁 Welcome Bonus! +${BONUS_EB} EB & +${BONUS_DIAMONDS} Diamonds added to your treasury!`, 6000);
    if (typeof ServerAntiCheat !== "undefined" && ServerAntiCheat.isReady()) {
      ServerAntiCheat.claimNewPlayerBonus().then((res) => {
        if (res && res.ok) {
          const st = Store.get();
          if (res.nextEb !== undefined) st.eb = Number(res.nextEb) || st.eb;
          if (res.nextDiamonds !== undefined) st.diamonds = Number(res.nextDiamonds) || st.diamonds;
          st.player.bonusClaimed = true;
          Store.save(true);
          updateTopbar();
        }
      }).catch(() => {});
    }
  }

  // If the tutorial ended while offline (or the server call failed), the
  // optimistic grant was lost to the sync mirror. Retry once at startup —
  // claimNewPlayerBonus is idempotent server-side.
  function maybeRecoverNewPlayerBonus() {
    const state = Store.get();
    if (!isTutorialComplete() || state.player?.bonusClaimed) return;
    if (typeof ServerAntiCheat === "undefined" || !ServerAntiCheat.isReady()) return;
    ServerAntiCheat.claimNewPlayerBonus().then((res) => {
      if (res && res.ok && !res.already) {
        const st = Store.get();
        if (res.nextEb !== undefined) st.eb = Number(res.nextEb) || st.eb;
        if (res.nextDiamonds !== undefined) st.diamonds = Number(res.nextDiamonds) || st.diamonds;
        st.player.bonusClaimed = true;
        Store.save(true);
        updateTopbar();
        showToast("🎁 Welcome Bonus applied: +4,000 EB & +500 Diamonds!", 5000);
      } else if (res && res.already) {
        const st = Store.get();
        st.player.bonusClaimed = true;
        Store.save(true);
      }
    }).catch(() => {});
  }

  // --- Robot Pet Guide (3D rendered on canvas) ---
  let _guideScene = null;
  let _guideRenderer = null;
  let _guideCamera = null;
  let _guidePet = null;
  let _guideAnimId = null;
  let _guideMixer = null;
  let _guideActions = {};
  let _guideCurrentAnim = "Idle";

  const GUIDE_EMOTES = ["Idle", "Wave", "Jump", "Dance", "Victory", "Yes", "No"];

  function initTutorialGuide() {
    const canvas = el("tutorial-guide-canvas");
    if (!canvas || typeof THREE === "undefined") return;

    try {
      _guideScene = new THREE.Scene();
      _guideCamera = new THREE.PerspectiveCamera(35, canvas.width / canvas.height, 0.1, 100);
      _guideCamera.position.set(0, 1.0, 11.0);
      _guideCamera.lookAt(0, 0.5, 0);

      _guideRenderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
      _guideRenderer.setSize(canvas.width, canvas.height);
      _guideRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      _guideRenderer.setClearColor(0x000000, 0);

      // Lighting
      _guideScene.add(new THREE.AmbientLight(0xffffff, 0.8));
      const dirLight = new THREE.DirectionalLight(0xffffff, 0.9);
      dirLight.position.set(3, 4, 5);
      _guideScene.add(dirLight);
      const fillLight = new THREE.DirectionalLight(0x4fd6c4, 0.3);
      fillLight.position.set(-2, 2, -1);
      _guideScene.add(fillLight);

      // Load RobotExpressive
      const loader = new THREE.GLTFLoader();
      loader.load("models/RobotExpressive.glb", (gltf) => {
        _guidePet = gltf.scene;
        _guidePet.scale.set(1.0, 1.0, 1.0);
        _guidePet.position.set(0, -0.8, 0);
        _guideScene.add(_guidePet);

        // Setup all animations
        if (gltf.animations && gltf.animations.length) {
          _guideMixer = new THREE.AnimationMixer(_guidePet);
          gltf.animations.forEach(clip => {
            _guideActions[clip.name] = _guideMixer.clipAction(clip);
          });
          // Play idle by default
          if (_guideActions["Idle"]) {
            _guideActions["Idle"].play();
          }
        }
      }, undefined, () => {});

      animateGuide();
    } catch (e) {
      console.warn("[Tutorial] Guide init notice:", e);
    }
  }

  function playGuideEmote(emoteName) {
    if (!_guideMixer || !_guideActions[emoteName]) return;
    // Stop all current actions
    Object.values(_guideActions).forEach(a => a.stop());
    // Play the requested emote
    const action = _guideActions[emoteName];
    action.reset();
    action.clampWhenFinished = true;
    action.loop = emoteName === "Idle" ? THREE.LoopRepeat : THREE.LoopOnce;
    action.play();
    _guideCurrentAnim = emoteName;

    // Return to idle after non-idle emote finishes
    if (emoteName !== "Idle") {
      const duration = action.getClip().duration;
      setTimeout(() => {
        if (_guideCurrentAnim === emoteName && _guideActions["Idle"]) {
          Object.values(_guideActions).forEach(a => a.stop());
          _guideActions["Idle"].reset().play();
          _guideCurrentAnim = "Idle";
        }
      }, (duration + 0.5) * 1000);
    }
  }

  function animateGuide() {
    if (!_guideRenderer || !_guideScene || !_guideCamera) return;
    _guideAnimId = requestAnimationFrame(animateGuide);
    if (_guideMixer) _guideMixer.update(0.016);
    _guideRenderer.render(_guideScene, _guideCamera);
  }

  function destroyTutorialGuide() {
    if (_guideAnimId) cancelAnimationFrame(_guideAnimId);
    if (_guideRenderer) _guideRenderer.dispose();
    _guideScene = null;
    _guideRenderer = null;
    _guideCamera = null;
    _guidePet = null;
    _guideMixer = null;
    _guideActions = {};
    const canvas = el("tutorial-guide-canvas");
    if (canvas) {
      const ctx = canvas.getContext("2d");
      if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
  }

  function wireTutorial() {
    el("tutorial-next-btn")?.addEventListener("click", advanceTutorial);
    el("tutorial-skip-btn")?.addEventListener("click", endTutorial);
  }

  function startIncomeLoop() {
    const earned = Store.applyOfflineProgress();
    const state = Store.get();
    const pName = (state?.player?.name || "").toLowerCase();

    updateTopbar();

    // High-Performance Ticker: Calculates exact delta & saves locally without network thrashing
    let lastTickTime = Date.now();
    let lastIncomeCloudSave = Date.now();
    let lastLeaderboardRefresh = Date.now();
    let lastUIUpdate = 0;
    setInterval(() => {
      if (document.hidden) return;
      if (typeof Store !== "undefined" && !Store.isSessionActive()) return;

      if (typeof Citadels !== "undefined") Citadels.checkCapsuleUnlock();
      const now = Date.now();
      const rawDelta = (now - lastTickTime) / 1000;

      if (rawDelta < 0.3 || rawDelta > 120) {
        lastTickTime = now;
        return;
      }
      const deltaSec = Math.min(60, rawDelta);
      lastTickTime = now;

      const state = Store.get();
      if (state.cash === undefined) state.cash = 0;
      if (state.lifetimeRent === undefined) state.lifetimeRent = state.cash;

      const deltaEarned = Store.totalRate() * deltaSec;
      state.cash += deltaEarned;
      state.lifetimeRent += deltaEarned;
      state.lastTick = now;

      // Cloud save every 30 seconds (was 20s — reduces syncSafeState calls)
      if (now - lastIncomeCloudSave >= 30000) {
        lastIncomeCloudSave = now;
        if (state.sessionLock) state.sessionLock.lockedAt = now;
        Store.save(true);
      }

      // Throttle UI updates to every 2 seconds instead of every second
      if (now - lastUIUpdate >= 2000) {
        lastUIUpdate = now;
        if (typeof Multiplier !== "undefined" && Multiplier.updateUI) {
          Multiplier.updateUI(state);
        }
        if (typeof CompanionPet !== "undefined" && CompanionPet.updatePetHUD) {
          CompanionPet.updatePetHUD();
        }
        updateTopbar();
      }
    }, 1000);
  }

  // --- Landlord Title Pill (cycles Mayor / Governor / President) ---
  let landlordTimer = null;
  let landlordIndex = 0;
  const LANDLORD_CYCLE_MS = 6000; // 6 seconds per title

  function initLandlordPill() {
    const pill = el("landlord-pill");
    if (!pill) return;
    updateLandlordPill();
    landlordTimer = setInterval(updateLandlordPill, LANDLORD_CYCLE_MS);
  }

  async function updateLandlordPill() {
    const pill = el("landlord-pill");
    const titleEl = el("landlord-ruler-title");
    const locEl = el("landlord-ruler-location");
    const rulerAvatarEl = el("landlord-ruler-avatar");
    if (!pill || !titleEl || !locEl) return;

    try {
      // Ensure leaderboard data is loaded
      if (typeof Leaderboard !== "undefined" && Leaderboard.fetchRankings) {
        await Leaderboard.fetchRankings();
      }

      if (typeof Leaderboard === "undefined" || !Leaderboard.getLocalTerritoryRulers) {
        pill.classList.add("hidden");
        return;
      }

      // Get territory from live GPS position (not from plots)
      const local = Leaderboard.getPlayerLocalTerritory();
      const myCity = local.city;
      const myState = local.state;
      const myCountry = local.country;

      if (!myCity && !myState && !myCountry) {
        pill.classList.add("hidden");
        return;
      }

      // No real city (claim-less territory like a PA borough, or no GPS city
      // yet) → cycle Governor/President only; a "Mayor of Local City" phase
      // would be meaningless.
      const hasCity = Boolean(myCity) && myCity !== "Local City" && !/^\d/.test(myCity);
      const titles = hasCity ? ["mayor", "governor", "president"] : ["governor", "president"];
      const title = titles[landlordIndex % titles.length];
      landlordIndex++;

      const rulers = Leaderboard.getLocalTerritoryRulers(myCity, myState, myCountry);
      const ruler = rulers[title];

      locEl.textContent = title === "mayor"
        ? `IN ${myCity.toUpperCase()}`
        : title === "governor"
          ? `IN ${myState.toUpperCase()}`
          : `IN ${myCountry.toUpperCase()}`;

      // Trigger marquee scroll if text overflows
      locEl.classList.remove("marquee-active");
      void locEl.offsetWidth; // force reflow
      if (locEl.scrollWidth > locEl.clientWidth) {
        // Calculate exact scroll distance so the flag/text end becomes visible
        const overflow = locEl.scrollWidth - locEl.clientWidth;
        locEl.style.setProperty("--marquee-shift", `-${overflow + 6}px`);
        locEl.classList.add("marquee-active");
      }

      titleEl.textContent = title.toUpperCase();

      // Set ruler avatar (large circle)
      if (ruler) {
        let rulerAvatar = "👤";
        // If the ruler is the current player, use their live avatar from state
        const myId = Store.get()?.player?.id;
        if (ruler.ownerId === myId) {
          rulerAvatar = Store.get()?.player?.avatar || "👤";
        } else {
          // Look up from leaderboard data (has latest avatar from Firestore)
          const lbData = typeof Leaderboard !== "undefined" && Leaderboard.fetchRankings
            ? await Leaderboard.fetchRankings() : null;
          const rulerPlayer = lbData?.players?.find(p => p.id === ruler.ownerId);
          if (rulerPlayer?.avatar) {
            rulerAvatar = rulerPlayer.avatar;
          } else {
            // Fallback: scan plots
            const allPlots = (typeof Grid !== "undefined" && Grid.getAllPlots) ? Grid.getAllPlots() : {};
            for (const tid in allPlots) {
              const p = allPlots[tid];
              if (p.ownerId === ruler.ownerId && p.avatar) {
                rulerAvatar = p.avatar;
                break;
              }
            }
          }
        }
        if (rulerAvatar.startsWith("img:")) {
          rulerAvatarEl.innerHTML = `<img src="${rulerAvatar.slice(4)}" alt="">`;
        } else {
          rulerAvatarEl.textContent = rulerAvatar;
        }
      } else {
        rulerAvatarEl.innerHTML = "👤";
      }

      pill.classList.remove("hidden");
    } catch (e) {
      console.warn("[LandlordPill] Error:", e);
      pill.classList.add("hidden");
    }
  }

  // ---------------- UI wiring ----------------
  /**
   * Pin modal titles and the ✕ button so they stay put while the body scrolls.
   *
   * .modal-card is the scroll container, so everything inside it — including
   * the header — scrolled away. This moves the header chrome out of the scroll
   * flow into a .modal-head and wraps the remainder in .modal-scroll. Purely
   * structural: no markup changes, so it works across every modal including
   * ones added later.
   *
   * Cards that already manage their own scrolling are left alone — they have an
   * inner scroll region and already keep their chrome in place.
   */
  function pinModalHeaders() {
    const SELF_MANAGED = /player-info-card|citadel-chamber-card|guide-modal-card|wheel-card/;
    const HEADISH = /(header|head|icon|glow|badge|halo|burst)/i;

    document.querySelectorAll(".modal-card").forEach((card) => {
      if (card.dataset.headPinned === "1") return;
      const cls = card.className || "";
      if (SELF_MANAGED.test(cls)) return;

      const kids = Array.from(card.children);
      if (kids.length < 2) return;

      const head = [];
      let sawAnchor = false;

      for (const k of kids) {
        const isClose = k.classList && k.classList.contains("close-btn");
        const tag = k.tagName;
        // A *header* div almost always contains the title + subtitle.
        const isHeaderDiv = k.classList && /header|head/i.test(k.className || "");
        const isTitle = tag === "H2" || tag === "H3";
        const isPara = tag === "P";
        const isFraming = k.classList && /(icon|glow|badge|halo|burst)/i.test(k.className || "");

        if (isClose || isHeaderDiv || isTitle || isPara || isFraming) {
          head.push(k);
          if (isClose || isHeaderDiv) sawAnchor = true;
          // Title/subtitle caps the run — anything after is body.
          if (isHeaderDiv || isTitle || isPara) break;
        } else {
          break;
        }
      }

      // Nothing recognisable as a header: leave the card alone rather than
      // guessing (simple confirm dialogs fall into this bucket).
      if (!sawAnchor || head.length === 0) return;

      // The ✕ is sometimes declared after the header block (royalties modal).
      // Always pin it, wherever it sits.
      kids.forEach((k) => {
        if (k.classList && k.classList.contains("close-btn") && !head.includes(k)) {
          head.unshift(k);
        }
      });

      const body = kids.filter((k) => !head.includes(k));
      if (body.length === 0) return;

      const headWrap = document.createElement("div");
      headWrap.className = "modal-head";
      head.forEach((k) => headWrap.appendChild(k));

      const bodyWrap = document.createElement("div");
      bodyWrap.className = "modal-scroll";
      body.forEach((k) => bodyWrap.appendChild(k));

      card.appendChild(headWrap);
      card.appendChild(bodyWrap);
      card.classList.add("has-fixed-head");
      card.dataset.headPinned = "1";
    });
  }

  function wireUI() {
    // --- Pin modal headers ---
    // .modal-card is the scroll container, so the title and the ✕ scrolled away
    // with the content. Move the header chrome out of the scroll flow and give
    // the rest a .modal-scroll wrapper. Runs once; markup is untouched.
    pinModalHeaders();

    // --- Side HUD Stack Collapse Toggle ---
    const collapseBtn = el("side-hud-collapse");
    const hudStack = el("side-hud-stack");
    if (collapseBtn && hudStack) {
      collapseBtn.addEventListener("click", () => {
        hudStack.classList.toggle("collapsed");
      });
    }

    window.addEventListener("openPlayerInfo", (e) => {       const cluster = e.detail?.cluster;       updatePlayerInfoModal(cluster ? cluster[0] : null);       openModal("player-info-modal");     });

    // --- Flying 3D Gem Arc Particle to HUD ---
    function spawnFlyingGemToHUD(startX, startY) {
      launchFlyingGemStream(startX, startY, 1);
    }

    // --- Multi-Gem Flying Diamond Stream Launcher ---
    function launchFlyingGemStream(startX, startY, count) {
      const targetEl = hudFlyTarget("stat-diamonds");
      if (!targetEl) return;

      const targetBounds = targetEl.getBoundingClientRect();
      const endX = targetBounds.left + targetBounds.width / 2;
      const endY = targetBounds.top + targetBounds.height / 2;

      const particleCount = Math.min(25, Math.max(1, count));

      for (let i = 0; i < particleCount; i++) {
        setTimeout(() => {
          const spreadX = (Math.random() - 0.5) * 80;
          const spreadY = (Math.random() - 0.5) * 50;

          const gem = document.createElement("div");
          gem.className = "flying-3d-gem";
          gem.style.left = `${startX + spreadX}px`;
          gem.style.top = `${startY + spreadY}px`;
          gem.innerHTML = `
            <svg viewBox="0 0 32 38" style="filter: drop-shadow(0 0 6px rgba(255, 0, 40, 0.8));">
              <polygon points="16,2 29,12 16,16 3,12" fill="#ff6b81"/>
              <polygon points="3,12 16,16 16,36" fill="#8b0000"/>
              <polygon points="29,12 16,16 16,36" fill="#ff1744"/>
              <polygon points="16,2 20,8 16,16 12,8" fill="rgba(255,255,255,0.85)"/>
            </svg>
          `;
          document.body.appendChild(gem);

          requestAnimationFrame(() => {
            const dx = endX - (startX + spreadX);
            const dy = endY - (startY + spreadY);
            gem.style.transform = `translate(${dx}px, ${dy}px) scale(0.4) rotate(${Math.random() * 360}deg)`;
            gem.style.opacity = "0.2";
          });

          setTimeout(() => {
            gem.remove();
            targetEl.classList.remove("hud-impact-bump");
            void targetEl.offsetWidth;
            targetEl.classList.add("hud-impact-bump");
          }, 750);
        }, i * (count > 5 ? 40 : 80));
      }
    }

    // --- Multi-Particle Flying EB Stream Launcher ---
    function launchFlyingEBStream(startX, startY, totalAmount) {
      const targetEl = hudFlyTarget("stat-eb");
      if (!targetEl) return;

      const targetBounds = targetEl.getBoundingClientRect();
      const endX = targetBounds.left + targetBounds.width / 2;
      const endY = targetBounds.top + targetBounds.height / 2;

      // Launch individual particles up to total amount (max 50)
      const particleCount = Math.min(50, totalAmount);
      const isJackpot = totalAmount >= 25;

      for (let i = 0; i < particleCount; i++) {
        // Stagger each particle slightly in time & random burst spread
        setTimeout(() => {
          const eb = document.createElement("div");
          eb.className = "flying-eb-coin" + (isJackpot ? " jackpot-spark" : "");
          
          // Random burst jitter from origin
          const spreadX = (Math.random() - 0.5) * (isJackpot ? 120 : 60);
          const spreadY = (Math.random() - 0.5) * (isJackpot ? 120 : 60);
          eb.style.left = `${startX + spreadX}px`;
          eb.style.top = `${startY + spreadY}px`;
          eb.innerHTML = isJackpot
            ? `<img src="assets/eb-coin.png" class="flying-coin-img"><span class="jackpot-lightning">⚡</span>`
            : `<img src="assets/eb-coin.png" class="flying-coin-img">`;
          document.body.appendChild(eb);

          requestAnimationFrame(() => {
            const dx = endX - (startX + spreadX);
            const dy = endY - (startY + spreadY);
            eb.style.transform = `translate(${dx}px, ${dy}px) scale(0.45) rotate(${Math.random() * 360}deg)`;
            eb.style.opacity = "0.15";
          });

          setTimeout(() => {
            eb.remove();
            targetEl.classList.remove("hud-impact-bump");
            void targetEl.offsetWidth;
            targetEl.classList.add("hud-impact-bump");
          }, 750);
        }, i * (totalAmount > 10 ? 25 : 80)); // Fast machine-gun cascade for 50 EB
      }
    }

    // --- 90-Day Daily Login Calendar (one claim per UTC day) ---
    const UTC_DAY_MS = 86400000;
    const DAILY_CALENDAR_LENGTH = 90;
    // Date.now() is epoch-based UTC millis, so integer division gives the UTC
    // calendar day directly. Mirrors utcDayOf() in functions/index.js.
    const utcDayOf = (ts) => Math.floor(ts / UTC_DAY_MS);

    function getCalendarState() {
      const state = Store.get();
      if (!state.calendar) {
        state.calendar = {
          claimedDays: 0,       // Position on the 1-90 ladder
          cycle: 1,             // Completed 90-day laps (lifetime counter)
          graceAvailable: true, // One-day streak forgiveness not yet spent
          lastClaimTime: 0,     // Timestamp of last claim
          lastClaimDay: 0,      // UTC day index of the last claim
          lastClaimDate: null   // Legacy migration support
        };
      }
      // Migrate legacy formats
      if (state.calendar.currentDay !== undefined && state.calendar.claimedDays === undefined) {
        state.calendar.claimedDays = Math.max(0, state.calendar.currentDay - 1);
        delete state.calendar.currentDay;
      }
      // Migrate old date-string format to timestamp if present
      if (state.calendar.lastClaimDate && !state.calendar.lastClaimTime) {
        state.calendar.lastClaimTime = new Date(state.calendar.lastClaimDate).getTime() || Date.now();
      }
      // Accounts that predate lastClaimDay derive it from the timestamp, so
      // their existing streak carries over instead of restarting.
      if (!state.calendar.lastClaimDay && state.calendar.lastClaimTime) {
        state.calendar.lastClaimDay = utcDayOf(state.calendar.lastClaimTime);
      }
      if (!state.calendar.cycle) state.calendar.cycle = 1;
      if (state.calendar.graceAvailable === undefined) state.calendar.graceAvailable = true;
      return state.calendar;
    }

    function isRewardReady() {
      const cal = getCalendarState();
      // Different UTC day to the last claim = claimable. The server re-checks
      // this in claimDailyReward; this copy is UI affordance only.
      return utcDayOf(Date.now()) !== (cal.lastClaimDay || 0);
    }

    function msUntilUtcReset() {
      return (utcDayOf(Date.now()) + 1) * UTC_DAY_MS - Date.now();
    }

    /**
     * Any daily quest finished and waiting to be claimed? Used for the red dot
     * on the side-hub Daily button.
     */
    function hasClaimableQuest() {
      try {
        const q = getDailyQuestsState().quests || {};
        return Object.keys(q).some((id) => q[id] && q[id].completed && !q[id].claimed);
      } catch (e) {
        return false;
      }
    }

    function updateCalendarHUD() {
      const cal = getCalendarState();
      const ready = isRewardReady();
      const now = new Date();
      const months = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
      if (el("cal-hud-month")) el("cal-hud-month").textContent = months[now.getMonth()];
      if (el("cal-hud-day")) el("cal-hud-day").textContent = now.getDate();

      // The dot now means "there is something to claim in here" — the daily
      // login reward, a finished quest, or an unlocked achievement. It used to
      // gate on claimedDays < 30, which silently hid it at the top of the
      // ladder, exactly when a player should claim to start the next cycle.
      //
      // It now covers EVERYTHING behind the Events tab (Global Challenge,
      // Daily Progress and Weekly Treasury Pool), and each row in the hub
      // carries its own dot so the player knows which one is asking.
      const claimableQuest = hasClaimableQuest();
      const claimableBadge = typeof Achievements !== "undefined" && Achievements.hasClaimable
        ? Achievements.hasClaimable()
        : false;
      const dailyReady = ready || claimableQuest || claimableBadge;

      let challengePending = false;
      let poolPending = false;
      if (typeof hubSignals === "function") {
        const sig = hubSignals();
        challengePending = sig.challengePending;
        poolPending = sig.poolPending;
      } else {
        challengePending = (typeof GlobalEvent !== "undefined" && GlobalEvent.getState)
          ? (() => { const g = GlobalEvent.getState(); return !!g.event && !g.settled; })()
          : false;
        poolPending = (typeof WeeklyPool !== "undefined" && WeeklyPool.hasPending)
          ? !!WeeklyPool.hasPending()
          : false;
      }

      const unreadDot = el("calendar-unread-dot");
      if (unreadDot) {
        if (dailyReady || challengePending || poolPending) unreadDot.classList.remove("hidden");
        else unreadDot.classList.add("hidden");
      }
    }
    // Achievements' realtime listener drives this so the dot lights the instant
    // a badge or quest becomes claimable, not on the next full sync.
    window.updateCalendarHUD = updateCalendarHUD;

    /**
     * Human-readable streak summary shown under the modal title: which cycle the
     * player is on, how far along the 90-day ladder they are, and how long until
     * the next UTC reset.
     */
    function calendarStreakStatus() {
      const cal = getCalendarState();
      const claimed = cal.claimedDays || 0;
      const cycle = cal.cycle || 1;
      const parts = [];
      parts.push(cycle > 1 ? `Cycle ${cycle} · Day ${claimed || 1} / ${DAILY_CALENDAR_LENGTH}`
        : `Day ${claimed} / ${DAILY_CALENDAR_LENGTH}`);

      if (isRewardReady()) {
        parts.push("Ready to claim");
      } else {
        const ms = msUntilUtcReset();
        const hrs = Math.floor(ms / 3600000);
        const mins = Math.floor((ms % 3600000) / 60000);
        parts.push(`Next reward in ${hrs}h ${mins}m`);
      }

      // Only surface the grace once it has actually been spent — otherwise it is
      // just noise for players who have never missed a day.
      if (cal.graceAvailable === false) {
        parts.push("Streak grace used");
      }
      return parts.join(" · ");
    }

    function renderCalendarModal() {
      const statusEl = el("calendar-streak-status");
      if (statusEl) statusEl.textContent = calendarStreakStatus();

      const list = el("calendar-days-list");
      if (!list) return;
      list.innerHTML = "";

      const cal = getCalendarState();
      const ready = isRewardReady();
      const claimedCount = cal.claimedDays || 0;
      const rewards = CONFIG.DAILY_CALENDAR_REWARDS || [];

      rewards.forEach((r) => {
        const dayNum = r.day;
        const isAlreadyClaimed = dayNum <= claimedCount;
        const isReadyToClaim = (dayNum === claimedCount + 1) && ready;
        const isLockedTomorrow = (dayNum === claimedCount + 1) && !ready;
        const isFutureLocked = dayNum > claimedCount + 1;

        // Check if day has diamonds
        const diamondText = r.diamonds ? ` & +${r.diamonds} ${iconDiamond}` : "";
        const dayRp = rpForCalendarDay(dayNum);
        const rpText = dayRp ? ` <span class="quest-rp">+${dayRp}RP</span>` : "";
        const rewardLabel = `+${r.eb} EB${diamondText}${rpText}`;

        const row = document.createElement("div");
        row.className = "cal-day-row" + (isReadyToClaim ? " active" : "") + (isAlreadyClaimed ? " claimed" : "") + (isLockedTomorrow || isFutureLocked ? " locked" : "");

        let actionHtml = "";
        if (isAlreadyClaimed) {
          actionHtml = `<span class="cal-status-claimed">✓ Claimed</span>`;
        } else if (isReadyToClaim) {
          actionHtml = `<button class="cal-claim-btn" id="claim-day-${dayNum}">Claim ${rewardLabel}</button>`;
        } else if (isLockedTomorrow) {
          const remainingMs = msUntilUtcReset();
          const remHrs = Math.floor(remainingMs / 3600000);
          const remMins = Math.floor((remainingMs % 3600000) / 60000);
          actionHtml = `<span class="cal-status-locked" style="color:var(--teal);opacity:0.85;">⏳ ${remHrs}h ${remMins}m</span>`;
        } else {
          actionHtml = `<span class="cal-status-locked">🔒 Day ${dayNum}</span>`;
        }

        row.innerHTML = `
          <div class="cal-day-left">
            <span class="cal-day-badge">Day ${dayNum}</span>
            <span class="cal-reward-amount">${rewardLabel}</span>
          </div>
          <div class="cal-day-right">
            ${actionHtml}
          </div>
        `;

        list.appendChild(row);

        if (isReadyToClaim) {
          const claimBtn = row.querySelector(".cal-claim-btn");
          claimBtn?.addEventListener("click", () => {
            const rect = claimBtn.getBoundingClientRect();
            claimDailyReward(r.eb, r.diamonds || 0, rect.left + rect.width / 2, rect.top + rect.height / 2);
          });
        }
      });
    }

    async function claimDailyReward(ebAmount, diamondAmount, clickX, clickY) {
      // Session lock: block if paused
      if (typeof Store !== "undefined" && !Store.isSessionActive()) {
        showToast("🔒 Account active on another tab. Close the other tab first.", 4000);
        return;
      }

      // Anti-cheat: Embargo check
      if (typeof AntiCheat !== "undefined") {
        const check = AntiCheat.isActionAllowed("earn");
        if (!check.allowed) { showToast(check.reason, 5000); return; }
      }

      const state = Store.get();
      const cal = getCalendarState();

      if (!isRewardReady()) return; // Strict 20h cooldown guard

      if (typeof firebase === "undefined" || !firebase.functions) {
        showToast("⚠️ Server connection required to claim daily rewards.", 4000);
        return;
      }

      let serverResult;
      try {
        const claimDailyReward = firebase.functions().httpsCallable("claimDailyReward");
        serverResult = (await claimDailyReward()).data;
      } catch (err) {
        console.warn("[Calendar] Server claim failed:", err);
        showToast("⚠️ Daily reward could not be verified. Try again.", 4000);
        return;
      }
      if (!serverResult?.claimed) {
        if (serverResult?.reason === "cooldown") showToast("⏳ Already claimed today — next reward at 00:00 UTC.", 3500);
        return;
      }

      const totalEB = serverResult.eb;
      cal.lastClaimTime = serverResult.calendar.lastClaimTime;
      cal.claimedDays = serverResult.calendar.claimedDays;
      cal.lastClaimDate = serverResult.calendar.lastClaimDate;
      cal.lastClaimDay = serverResult.calendar.lastClaimDay;
      cal.cycle = serverResult.calendar.cycle || 1;
      cal.graceAvailable = serverResult.calendar.graceAvailable !== false;
      state.dailyQuests = serverResult.dailyQuests;
      // Stamp the day the login quest was paid so getDailyQuestsState() can
      // keep it claimed even if a later sync drops the per-quest flag.
      state.loginClaimedDate = serverResult.calendar.lastClaimDate
        || new Date().toISOString().slice(0, 10);
      state.eb = serverResult.nextEb;
      state.diamonds = serverResult.nextDiamonds;
      if (serverResult.nextRewardPoints !== undefined) {
        state.rewardPoints = Number(serverResult.nextRewardPoints) || 0;
      }
      Store.save(true);

      updateTopbar();
    updateCalendarHUD();
    // Keep the countdown and the red dot honest while the game is left open
    // across a UTC midnight. Without this the dot only appeared on a reload,
    // which is exactly the moment a player about to log off would miss it.
    setInterval(() => {
      updateCalendarHUD();
      const modal = document.getElementById("calendar-modal");
      const status = el("calendar-streak-status");
      if (status && modal && !modal.classList.contains("hidden")) {
        status.textContent = calendarStreakStatus();
      }
    }, 30000);

      // Trigger visual particles with full EB amount to the sub stat bar
      launchFlyingEBStream(clickX, clickY, totalEB);
      if (diamondAmount > 0) {
        setTimeout(() => launchFlyingGemStream(clickX, clickY, diamondAmount), 300);
      }
      
      const diaToast = serverResult.diamonds > 0 ? ` & +${serverResult.diamonds} Diamonds` : "";
      const questMsg = serverResult.eb > ebAmount ? ` (+${serverResult.eb - ebAmount} EB Quest Bonus)` : "";
      const rpToast = serverResult.rp ? ` · +${serverResult.rp}RP` : "";
      showToast(`🎉 Claimed +${totalEB} EB${questMsg}${diaToast}${rpToast} Daily Reward!`);

      // Broadcast login streak
      if (typeof Feed !== "undefined") {
        Feed.broadcast("daily", { day: cal.claimedDays });
      }

      // Re-render modal to show "✓ Claimed" and countdown
      renderCalendarModal();
      renderDailyQuests();

      setTimeout(() => {
        closeModal("calendar-modal");
      }, 650);
    }

    // RP per quest. `wheel` pays EB only — awarding redeemable points for a
    // chance outcome is exactly what FINANCIALPLAN.md §3 exists to prevent.
    // `purchase_plots_5x` and the ascend quests are likewise EB-only: plots cost
    // 100 EB and EB comes from the wheel, so paying RP for them re-opens the
    // same path. Must match QUEST_RP / QUEST_REWARDS in functions/index.js.
    // Points are integers (1 RP = 1c).
    const QUEST_DEFS = [
      { id: "login", title: "Claim daily login bonus", reward: 5, rewardText: "+5 EB", rp: 2, action: "login" },
      { id: "wheel", title: "Spin the Diamond Wheel", reward: 10, rewardText: "+10 EB", rp: 0, action: "wheel" },
      { id: "gift", title: "Send a gift to a friend", reward: 10, rewardText: "+10 EB", rp: 3, action: "gift" },
      { id: "mayor", title: "Check Mayoralship & Dividends", reward: 5, rewardText: "+5 EB", rp: 1, action: "mayor" },
      { id: "survey", title: "Explore & survey 1 new area", reward: 15, rewardText: "+15 EB", rp: 1, action: "survey" },

      // --- Added 2026-10-09 ---
      { id: "recall_defender", title: "Recall a defender from a Citadel", reward: 15, rewardText: "+15 EB", rp: 2, action: "citadel" },
      // The standout daily quest — server pays 40 EB + 20 RP (see QUEST_REWARDS
      // and the RP map in functions/index.js). Reward text must match those or
      // the player is shown one number and paid another.
      { id: "recall_defender_5x", title: "Recall 5 defenders from Citadels", reward: 40, rewardText: "+40 EB", rp: 20, action: "citadel", progressNeeded: 5 },
      { id: "convert_cash", title: "Convert Cash to EB", reward: 25, rewardText: "+25 EB", rp: 2, action: "cashout" },
      { id: "spin_elden_stop", title: "Spin an Elden Stop", reward: 2, rewardText: "+2 EB", rp: 1, action: "eldenstop" },
      { id: "feed_berries", title: "Feed a berry to Buddy", reward: 5, rewardText: "+5 EB", rp: 1, action: "pet" },
      { id: "purchase_plots_5x", title: "Purchase 5 plots today", reward: 90, rewardText: "+90 EB", rp: 0, action: "grid", progressNeeded: 5 },
    ];

    // Exactly ONE ascend quest is active per UTC day, picked from the date so
    // every player gets the same one and it cannot be re-rolled by reloading.
    // Three separate ids because each tier carries its own reward.
    const ASCEND_QUESTS = [
      { id: "ascend_common", title: "Ascend 1 Common Plot to Rare", reward: 50, rewardText: "+50 EB", rp: 0, action: "ascend" },
      { id: "ascend_rare", title: "Ascend 1 Rare Plot to Epic", reward: 50, rewardText: "+50 EB", rp: 0, action: "ascend" },
      { id: "ascend_epic", title: "Ascend 1 Epic Plot to Legendary", reward: 100, rewardText: "+100 EB", rp: 0, action: "ascend" },
    ];

    function todaysAscendQuest() {
      const day = new Date().toISOString().slice(0, 10);
      let h = 0;
      for (let i = 0; i < day.length; i++) h = (h * 31 + day.charCodeAt(i)) >>> 0;
      return ASCEND_QUESTS[h % ASCEND_QUESTS.length];
    }

    // Full board for today: the fixed quests plus whichever ascend quest the
    // date selected.
    function activeQuestDefs() {
      return QUEST_DEFS.concat([todaysAscendQuest()]);
    }

    // Mirror of rpForCalendarDay() in functions/index.js — the ladder curve is
    // derived so the UI and the server can never disagree about the value.
    function rpForCalendarDay(day) {
      const d = Number(day) || 0;
      if (d >= 90) return 5;
      if (d >= 60) return 4;
      if (d >= 30) return 3;
      if (d % 7 === 0) return 3;
      if (d % 5 === 0) return 2;
      return 1;
    }

    function getDailyQuestsState() {
      const state = Store.get();
      if (!state) return { date: "", quests: {} };
      const today = new Date().toISOString().slice(0, 10);

      // Fresh quest entry — ALWAYS with an explicit progress counter.
      // Seeding without `progress` left it undefined, and any later merge or
      // read could see a stale number carried in from a previous day.
      const freshQuest = () => ({ completed: false, claimed: false, progress: 0 });

      if (!state.dailyQuests || state.dailyQuests.date !== today) {
        // FULL reset: build every quest on today's board from scratch. The old
        // version seeded only the original five and then kept whatever else was
        // already in the map, which is how yesterday's `completed: true` rode
        // into a brand new day and the 5-count quests arrived pre-completed.
        const quests = {
          login: freshQuest(),
          wheel: freshQuest(),
          gift: freshQuest(),
          mayor: freshQuest(),
          survey: freshQuest()
        };
        activeQuestDefs().forEach(q => { quests[q.id] = freshQuest(); });
        state.dailyQuests = { date: today, quests };
      }

      activeQuestDefs().forEach(q => {
        const item = state.dailyQuests.quests[q.id];
        if (!item) {
          state.dailyQuests.quests[q.id] = freshQuest();
          return;
        }
        // Sanity: a counter can never sit above its target, and a quest cannot
        // be "completed" without actually having reached it. This is what
        // turns the 5/5-but-not-claimed and the pre-completed day into
        // impossible states rather than merely unlikely ones.
        const needed = Number(q.progressNeeded) || 0;
        item.progress = Math.max(0, Math.floor(Number(item.progress) || 0));
        if (needed > 1) {
          if (item.progress > needed) item.progress = needed;
          item.completed = item.claimed === true ? item.completed : (item.progress >= needed);
        }
      });
      // The login quest is auto-completed and auto-claimed together with the
      // calendar reward — claimDailyReward writes `quests.login = {completed:
      // true, claimed: true}` and `calendar.lastClaimDate = today` in the SAME
      // transaction. So a calendar claim today IS proof the login quest was
      // paid. (Reliying on a separate `loginClaimedDate` stamp left older saves
      // showing the quest as still claimable, with a red highlight.)
      const cal = getCalendarState();
      const loginQuest = state.dailyQuests.quests.login;
      if (loginQuest && cal && cal.lastClaimDate === today) {
        loginQuest.completed = true;
        loginQuest.claimed = true;
        state.loginClaimedDate = today;
      }
      return state.dailyQuests;
    }

    /**
     * Mark a quest complete. Repeat-count quests (recall 5 defenders, buy 5
     * plots) take their target from the definition and complete once the
     * counter reaches it.
     *
     * Only quests on today's board can be completed. Without that guard the two
     * inactive ascend tiers could be pre-completed and claimed on a later day.
     *
     * NOTE: completion is recorded client-side, same as the original five
     * quests — claimQuestReward trusts `completed`, so a tampered client could
     * claim anything. The RP caps bound the damage to the $5/month ceiling, but
     * this is a known gap and should move server-side alongside the achievements
     * pass, which will need trusted progress counters anyway.
     */
    function completeDailyQuest(questId) {
      const qState = getDailyQuestsState();
      const q = qState.quests[questId];
      if (!q || q.claimed || q.completed) return;

      const qDef = activeQuestDefs().find(x => x.id === questId);
      if (!qDef) return;

      const needed = Number(qDef.progressNeeded) || 0;
      if (needed > 1) {
        // Clamp first: a stale/oversized counter must never let one action
        // "complete" a multi-count quest, and progress can never exceed the
        // target shown in the UI.
        const base = Math.max(0, Math.min(needed - 1, Math.floor(Number(q.progress) || 0)));
        q.progress = base + 1;
        q.completed = q.progress >= needed;
      } else {
        q.progress = 1;
        q.completed = true;
      }
      Store.save(true);
      renderDailyQuests();
    }
    window.completeDailyQuest = completeDailyQuest;

    async function claimQuestReward(questId, startX, startY) {
      if (typeof Store !== "undefined" && !Store.isSessionActive()) {
        showToast("🔒 Account active on another tab. Close the other tab first.", 4000);
        return;
      }
      const qState = getDailyQuestsState();
      const itemState = qState.quests[questId];
      if (!itemState || !itemState.completed || itemState.claimed) return;

      const qDef = activeQuestDefs().find(q => q.id === questId);
      if (!qDef) return;

      if (typeof ServerAntiCheat === "undefined" || !ServerAntiCheat.isReady()) {
        showToast("⚠️ Server connection required to claim quest reward.", 3500);
        return;
      }

      // --- OPTIMISTIC UI: the reward lands on screen the instant you tap.
      // The server confirms in the background and its numbers win; a rejection
      // rolls everything back and says so.
      const state = Store.get();
      const prevEb = Number(state.eb) || 0;
      const prevRp = Number(state.rewardPoints) || 0;
      const prevClaimed = itemState.claimed;
      state.eb = prevEb + qDef.reward;
      if (qDef.rp) state.rewardPoints = prevRp + qDef.rp;
      itemState.claimed = true;
      Store.save(true);
      updateTopbar();
      renderDailyQuests();

      const originX = (typeof startX === "number" && startX > 0) ? startX : window.innerWidth / 2;
      const originY = (typeof startY === "number" && startY > 0) ? startY : window.innerHeight / 2;
      launchFlyingEBStream(originX, originY, qDef.reward);
      const rpBit = qDef.rp ? ` · +${qDef.rp}RP` : "";
      showToast(`🎉 Quest Claimed! +${qDef.reward} EB${rpBit}`);

      const rollbackQuest = () => {
        const r = Store.get();
        r.eb = prevEb;
        r.rewardPoints = prevRp;
        itemState.claimed = prevClaimed;
        Store.save(true);
        updateTopbar();
        renderDailyQuests();
      };

      try {
        const result = await ServerAntiCheat.claimQuestReward(questId);
        if (!result.claimed) {
          if (result.reason === "already_claimed") {
            // The server ledger says today's reward was already paid — keep the
            // ✓ claimed state. Rolling back would resurrect a claim button for
            // a reward that no longer exists (the old "claimed but unpaid"
            // confusion).
            const fresh = Store.get();
            const qs = fresh.dailyQuests && fresh.dailyQuests.quests;
            if (qs && qs[questId]) qs[questId].claimed = true;
            Store.save(true);
            renderDailyQuests();
            showToast("✓ This quest was already claimed today.", 3000);
            return;
          }
          rollbackQuest();
          showToast(result.reason === "not_ready"
            ? "⚠️ Quest not ready or already claimed."
            : "⚠️ Quest claim could not be verified.", 3500);
          return;
        }
        const fresh = Store.get();
        fresh.eb = result.nextEb;
        fresh.dailyQuests = result.dailyQuests;
        if (result.nextRewardPoints !== undefined) {
          fresh.rewardPoints = Number(result.nextRewardPoints) || 0;
        }
        Store.save(true);
        updateTopbar();
        renderDailyQuests();
      } catch (e) {
        rollbackQuest();
        showToast("⚠️ Quest claim could not be verified.", 3500);
      }
    }
    window.claimQuestReward = claimQuestReward;

    function renderDailyQuests() {
      const questList = el("calendar-quest-list");
      if (!questList) return;

      const qState = getDailyQuestsState();

      questList.innerHTML = activeQuestDefs().map(q => {
        const item = qState.quests[q.id] || { completed: false, claimed: false };
        let actionHtml = "";
        // The `login` quest is auto-claimed by claimDailyReward and deliberately
        // has NO QUEST_REWARDS entry on the server (it cannot be claimed twice).
        // Rendering a Claim button for it sends claimQuestReward("login"), which
        // the server rejects with invalid-argument — a 400 in the console.
        if (q.id === "login") {
          actionHtml = item.claimed
            ? `<div class="quest-check done" title="Claimed with your daily reward">✓</div>`
            : `<div class="quest-check" title="Claimed automatically with your daily login reward">⟳</div>`;
        } else if (item.claimed) {
          actionHtml = `<div class="quest-check done" title="Claimed">✓</div>`;
        } else if (item.completed) {
          const rpBit = q.rp ? ` +${q.rp}RP` : "";
          actionHtml = `<button class="cal-claim-btn quest-claim-btn" data-quest-id="${q.id}">Claim ${q.rewardText}${rpBit}</button>`;
        } else {
          actionHtml = `<div class="quest-check">○</div>`;
        }

        // Repeat-count quests show 2/5 style progress until they complete.
        let progressHtml = "";
        if (q.progressNeeded > 1 && !item.completed && !item.claimed) {
          const done = Math.min(Number(item.progress) || 0, q.progressNeeded);
          const pct = Math.round((done / q.progressNeeded) * 100);
          progressHtml = `
            <div class="quest-progress">
              <div class="quest-progress-track"><div class="quest-progress-fill" style="width:${pct}%"></div></div>
              <span class="quest-progress-label">${done}/${q.progressNeeded}</span>
            </div>`;
        }

        // `login` is settled server-side and has no claim action, so it must
        // never get the red "ready to claim" highlight.
        const readyToClaim = q.id !== "login" && item.completed && !item.claimed;

        return `
          <div class="calendar-quest-item ${readyToClaim ? 'ready-claim' : ''} ${q.id === 'login' && item.claimed ? 'quest-auto' : ''}" data-quest-id="${q.id}" style="${readyToClaim ? 'cursor:pointer;' : ''}">
            <div>
              <div class="quest-title">${q.title}</div>
              <div class="quest-reward">${q.rewardText}${q.rp ? ` <span class="quest-rp">+${q.rp}RP</span>` : ""}</div>
              ${progressHtml}
            </div>
            <div class="quest-action-slot">
              ${actionHtml}
            </div>
          </div>
        `;
      }).join("");

      // Wire up claim buttons
      questList.querySelectorAll(".quest-claim-btn").forEach(btn => {
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          const qId = btn.getAttribute("data-quest-id");
          const rect = btn.getBoundingClientRect();
          claimQuestReward(qId, rect.left + rect.width / 2, rect.top + rect.height / 2);
        });
      });

      // Allow clicking uncompleted quests to navigate directly to their action
      questList.querySelectorAll(".calendar-quest-item").forEach(row => {
        row.addEventListener("click", (e) => {
          if (e.target.closest(".quest-claim-btn")) return;
          const qId = row.getAttribute("data-quest-id");
          const item = qState.quests[qId];
          // `login` is settled by claimDailyReward and has no server reward
          // entry — never route it through claimQuestReward (it 400s).
          if (qId !== "login" && item && item.completed && !item.claimed) {
            const rect = row.getBoundingClientRect();
            claimQuestReward(qId, rect.left + rect.width / 2, rect.top + rect.height / 2);
            return;
          }
          if (item && !item.completed) {
            closeModal("calendar-modal");
            if (qId === "login") {
              openModal("calendar-modal");
              document.querySelector('[data-calendar-tab="rewards"]')?.click();
            } else if (qId === "wheel") {
              openModal("wheel-modal");
            } else if (qId === "gift") {
              updatePlayerInfoModal();
              openModal("player-info-modal");
              document.querySelector('[data-pi-tab="friends"]')?.click();
            } else if (qId === "mayor") {
              updatePlayerInfoModal();
              openModal("player-info-modal");
              completeDailyQuest("mayor");
            } else if (qId === "survey") {
              closeModal("calendar-modal");
              if (typeof toggleBuyMode === "function") toggleBuyMode(true);
              showToast("🗺️ Walk or tap an unclaimed parcel to claim land!");
            }
          }
        });
      });
    }

    // Calendar & Quests Tab Switcher
    document.querySelectorAll(".calendar-tab").forEach(tab => {
      tab.addEventListener("click", () => {
        document.querySelectorAll(".calendar-tab").forEach(t => t.classList.remove("active"));
        tab.classList.add("active");
        const target = tab.getAttribute("data-calendar-tab");
        // One panel per tab — panels are id'd calendar-<tab>-panel.
        ["rewards", "quests", "achievements"].forEach((name) => {
          const panel = el(`calendar-${name}-panel`);
          if (!panel) return;
          const on = name === target;
          panel.classList.toggle("hidden", !on);
          panel.classList.toggle("active", on);
        });
        if (target === "quests") {
          renderDailyQuests();
        } else if (target === "achievements") {
          if (typeof Achievements !== "undefined") Achievements.renderAll();
        } else {
          renderCalendarModal();
        }
      });
    });

    // ---- Events hub (the bottom-nav "Events" tab) ----
    // Sectional list like Atlas Earth: the live Global Challenge pins to the
    // top while it runs, then drops to the bottom as a disabled row with a
    // countdown to the next round. Daily Progress and Weekly Treasury Pool are
    // always in the list and open their own screens.
    function nextGlobalChallengeStart() {
      // Future rounds run Mon–Wed. Countdown targets the next Monday 00:00 UTC.
      const now = new Date();
      const day = now.getUTCDay(); // 0 = Sun
      const daysToMonday = day === 0 ? 1 : 8 - day;
      const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + daysToMonday);
      return next;
    }

    function fmtHubCountdown(ms) {
      if (ms <= 0) return "0d 0h 0m";
      const s = Math.floor(ms / 1000);
      const d = Math.floor(s / 86400);
      const h = Math.floor((s % 86400) / 3600);
      const m = Math.floor((s % 3600) / 60);
      return `${d}d ${h}h ${m}m`;
    }

    // Per-row "something to claim" signals. The Events tab dot is the union of
    // these, and each row carries its own dot so the player can see WHICH event
    // is asking for attention before opening the hub.
    function hubSignals() {
      const claimableQuest = hasClaimableQuest();
      const claimableBadge = typeof Achievements !== "undefined" && Achievements.hasClaimable
        ? Achievements.hasClaimable()
        : false;
      const dailyReady = isRewardReady() || claimableQuest || claimableBadge;

      const ge = (typeof GlobalEvent !== "undefined" && GlobalEvent.getState)
        ? GlobalEvent.getState()
        : { event: null, expired: true, settled: true };
      const challengeLive = !!ge.event && !ge.expired && !ge.settled;
      // Unclaimed prize from a finished round also counts.
      const challengePending = !!ge.event && !ge.settled;

      const poolPending = (typeof WeeklyPool !== "undefined" && WeeklyPool.hasPending)
        ? !!WeeklyPool.hasPending()
        : false;

      return { dailyReady, challengeLive, challengePending, poolPending };
    }
    window.hubSignals = hubSignals;

    function hubDot(show) {
      return show ? `<span class="events-hub-row-dot"></span>` : "";
    }

    function renderEventsHub() {
      const liveList = document.getElementById("events-hub-list");
      const upList = document.getElementById("events-hub-upcoming-list");
      const liveLabel = document.getElementById("events-hub-live-label");
      const upLabel = document.getElementById("events-hub-upcoming-label");
      if (!liveList || !upList) return;

      const sig = hubSignals();
      const ge = (typeof GlobalEvent !== "undefined" && GlobalEvent.getState)
        ? GlobalEvent.getState()
        : { event: null, expired: true, settled: true };
      const ev = ge.event;
      const challengeLive = !!ev && !ge.expired && !ge.settled;

      // Daily Progress — always available.
      const dailyBtn = `
        <button class="events-hub-row" data-hub-action="daily">
          <span class="events-hub-row-icon">📅${hubDot(sig.dailyReady)}</span>
          <span class="events-hub-row-body">
            <span class="events-hub-row-title">Daily Progress</span>
            <span class="events-hub-row-sub">Login rewards, quests &amp; badges</span>
          </span>
          <span class="events-hub-row-go">›</span>
        </button>`;

      // Weekly Treasury Pool — always available.
      const poolBtn = `
        <button class="events-hub-row" data-hub-action="pool">
          <span class="events-hub-row-icon">👑${hubDot(sig.poolPending)}</span>
          <span class="events-hub-row-body">
            <span class="events-hub-row-title">Weekly Treasury Pool</span>
            <span class="events-hub-row-sub">Top 10 landlords split the weekly pool</span>
          </span>
          <span class="events-hub-row-go">›</span>
        </button>`;

      // Global Challenge — live row, or a clickable "ended" row while the
      // round still needs action (admin Top-10 payout / player EB claim),
      // or a disabled countdown row once fully settled.
      let challengeRow;
      const challengePending = !!ev && !ge.settled; // expired but not finished
      if (challengeLive) {
        const pct = Math.max(0, Math.min(100, Number(ev.pct) || 0));
        challengeRow = `
          <button class="events-hub-row is-live" data-hub-action="challenge">
            <span class="events-hub-row-icon">🌍${hubDot(sig.challengePending)}</span>
            <span class="events-hub-row-body">
              <span class="events-hub-row-title">Global Challenge</span>
              <span class="events-hub-row-sub">Spin the wheel — help the Realm hit the goal</span>
              <span class="events-hub-row-bar"><i style="width:${pct}%"></i></span>
            </span>
            <span class="events-hub-row-go">›</span>
          </button>`;
      } else if (challengePending) {
        // Ended, but not fully settled: the admin still needs "Process Top 10
        // Plots", or this player has an unclaimed EB share. Keep it clickable
        // so the modal (and its payout / claim buttons) stay reachable.
        challengeRow = `
          <button class="events-hub-row" data-hub-action="challenge">
            <span class="events-hub-row-icon">🌍${hubDot(true)}</span>
            <span class="events-hub-row-body">
              <span class="events-hub-row-title">Global Challenge</span>
              <span class="events-hub-row-sub">Event ended — view results &amp; rewards</span>
            </span>
            <span class="events-hub-row-go">›</span>
          </button>`;
      } else {
        const ms = Math.max(0, nextGlobalChallengeStart() - Date.now());
        challengeRow = `
          <div class="events-hub-row is-disabled" aria-disabled="true">
            <span class="events-hub-row-icon">🌍</span>
            <span class="events-hub-row-body">
              <span class="events-hub-row-title">Global Challenge</span>
              <span class="events-hub-row-sub">Returns in ${fmtHubCountdown(ms)}</span>
            </span>
            <span class="events-hub-row-go events-hub-row-go-disabled">⏱</span>
          </div>`;
      }

      // Plot Rush (monthly) — a second community event with its own schedule.
      // It pins to "Live now" while its round is open and drops to "Upcoming"
      // with a countdown between rounds, and it can sit alongside the weekly
      // Global Challenge whenever their windows overlap.
      const monthlyRow = (typeof PlotChallenge !== "undefined" && PlotChallenge.hubRow)
        ? PlotChallenge.hubRow() : "";
      const monthlyLive = (typeof PlotChallenge !== "undefined" && PlotChallenge.isLive)
        ? PlotChallenge.isLive() : false;

      if (challengeLive || challengePending) {
        if (challengePending) {
          // Ended but not settled: keep everything actionable in one list.
          liveList.innerHTML = challengeRow + (monthlyLive ? monthlyRow : "") + dailyBtn + poolBtn;
          upList.innerHTML = monthlyLive ? "" : monthlyRow;
          if (upLabel) upLabel.classList.toggle("hidden", monthlyLive);
        } else {
          liveList.innerHTML = challengeRow + (monthlyLive ? monthlyRow : "");
          upList.innerHTML = dailyBtn + poolBtn + (monthlyLive ? "" : monthlyRow);
          if (upLabel) {
            upLabel.textContent = monthlyLive ? "More events" : "Upcoming";
            upLabel.classList.remove("hidden");
          }
        }
        if (liveLabel) {
          liveLabel.textContent = challengeLive ? "Live now" : "Available now";
          liveLabel.classList.remove("hidden");
        }
      } else {
        liveList.innerHTML = (monthlyLive ? monthlyRow : "") + dailyBtn + poolBtn;
        upList.innerHTML = challengeRow + (monthlyLive ? "" : monthlyRow);
        if (liveLabel) {
          liveLabel.textContent = monthlyLive ? "Live now" : "Available now";
          liveLabel.classList.remove("hidden");
        }
        if (upLabel) {
          upLabel.textContent = "Upcoming";
          upLabel.classList.remove("hidden");
        }
      }

      liveList.querySelectorAll("[data-hub-action]").forEach((b) => {
        b.addEventListener("click", () => onHubAction(b.getAttribute("data-hub-action")));
      });
      upList.querySelectorAll("[data-hub-action]").forEach((b) => {
        b.addEventListener("click", () => onHubAction(b.getAttribute("data-hub-action")));
      });
    }

    function onHubAction(action) {
      if (action === "daily") {
        closeModal("events-hub-modal");
        renderCalendarModal();
        renderDailyQuests();
        if (typeof Achievements !== "undefined") Achievements.renderAll();
        openModal("calendar-modal");
      } else if (action === "monthly") {
        closeModal("events-hub-modal");
        if (typeof PlotChallenge !== "undefined" && PlotChallenge.openModal) {
          PlotChallenge.openModal();
        }
      } else if (action === "pool") {
        closeModal("events-hub-modal");
        // Module is WeeklyPool (see js/pool.js) — the old name `Pool` silently
        // no-op'd, which is why the Treasury window never opened.
        if (typeof WeeklyPool !== "undefined" && WeeklyPool.open) WeeklyPool.open();
      } else if (action === "challenge") {
        closeModal("events-hub-modal");
        if (typeof GlobalEvent !== "undefined" && GlobalEvent.openModal) GlobalEvent.openModal();
      }
    }

    // Keep the countdown ticking while the hub is open.
    setInterval(() => {
      const hub = document.getElementById("events-hub-modal");
      if (hub && !hub.classList.contains("hidden")) renderEventsHub();
    }, 30000);

    // ---- Bottom-nav panel management ----
    // Switching tabs must never stack windows: whatever is open is dismissed
    // first, then the tapped tab opens its own (or nothing, for MAP).
    function closeAllPanels() {
      document.querySelectorAll(".modal:not(.hidden)").forEach((m) => {
        m.classList.add("hidden");
        if (typeof deactivateMapObjectAnimations === "function") {
          deactivateMapObjectAnimations(m.id);
        }
      });
      // The chat drawer is not a .modal — it is its own slide-up container.
      const drawer = document.getElementById("chat-drawer");
      if (drawer && !drawer.classList.contains("hidden")) {
        drawer.classList.add("hidden");
        if (typeof Chat !== "undefined" && Chat.close) Chat.close();
      }
    }
    window.closeAllPanels = closeAllPanels;

    function setActiveTab(tabId) {
      document.querySelectorAll(".nav-tab").forEach((t) => t.classList.remove("is-active"));
      el(tabId)?.classList.add("is-active");
    }

    el("calendar-btn")?.addEventListener("click", () => {
      closeAllPanels();
      setActiveTab("calendar-btn");
      renderEventsHub();
      openModal("events-hub-modal");
    });

    // MORE holds the four destinations that used to be tabs (Land / Earn /
    // Events / Chat). Tapping it again while the sheet is open dismisses it —
    // the escape-hatch role the old MAP tab used to play.
    el("more-nav-btn")?.addEventListener("click", () => {
      const sheet = el("more-modal");
      if (sheet && !sheet.classList.contains("hidden")) {
        closeAllPanels();
        return;
      }
      closeAllPanels();
      openModal("more-modal");
    });

    // The four destinations moved inside MORE, so their unread dots went with
    // them and would be invisible from the map. Mirror them onto the MORE
    // button so "something needs attention" still reads at a glance.
    (function wireMoreUnreadDot() {
      const moreDot = el("more-unread-dot");
      if (!moreDot || typeof MutationObserver === "undefined") return;
      const sources = ["calendar-unread-dot", "chat-unread-badge"];
      const sync = () => {
        const anyUnread = sources.some((id) => {
          const n = el(id);
          return n && !n.classList.contains("hidden");
        });
        moreDot.classList.toggle("hidden", !anyUnread);
      };
      sources.forEach((id) => {
        const n = el(id);
        if (n) new MutationObserver(sync).observe(n, { attributes: true, attributeFilter: ["class"] });
      });
      sync();
    })();

    // Land / Earn / Chat handlers live further down next to the modals they
    // open — each calls closeAllPanels() + setActiveTab() first (see those).
    el("chat-hud-btn")?.addEventListener("click", () => {
      // The chat drawer is opened by its own module (js/chat.js); just clear
      // any modal so it never stacks on top of another window.
      document.querySelectorAll(".modal:not(.hidden)").forEach((m) => {
        m.classList.add("hidden");
        if (typeof deactivateMapObjectAnimations === "function") {
          deactivateMapObjectAnimations(m.id);
        }
      });
      setActiveTab("chat-hud-btn");
    });

    updateCalendarHUD();

    // --- 3D Character Wardrobe Selector ---
    function renderWardrobe() {
      const grid = el("wardrobe-grid");
      if (!grid) return;
      grid.innerHTML = "";

      const state = Store.get();
      const currentModelId = state?.player?.model3d || "soldier";
      const characters = CONFIG.AVAILABLE_CHARACTERS || [];

      characters.forEach((char) => {
        const isSelected = char.id === currentModelId;
        const card = document.createElement("div");
        card.className = "wardrobe-card" + (isSelected ? " selected" : "");
        card.innerHTML = `
          <span class="char-icon">${char.icon || "👤"}</span>
          <span class="char-name">${char.name}</span>
          <span class="char-status">${isSelected ? "EQUIPPED" : "Equip"}</span>
        `;

        card.addEventListener("click", () => {
          if (typeof Character3D !== "undefined" && Character3D.changeCharacter) {
            Character3D.changeCharacter(char.id);
            showToast(`Equipped ${char.name}!`);
          }
          closeModal("wardrobe-modal");
          updatePlayerInfoModal();
        });

        grid.appendChild(card);
      });
    }

    // Open Wardrobe on Avatar Pencil Tap
    el("edit-avatar-btn")?.addEventListener("click", (e) => {
      e.stopPropagation();
      renderWardrobe();
      openModal("wardrobe-modal");
    });

    // Rename Player on Name Pencil Tap (With Unique Name Registry & "Vic" Lock)
    el("edit-name-btn")?.addEventListener("click", async () => {
      const state = Store.get();
      const currentName = state?.player?.name || "Traveler";

      const newName = prompt(
        "Choose a new realm name (2–16 characters).\n\nName changes are reviewed by staff before they go live.",
        currentName
      );
      if (!newName) return;
      const cleanName = newName.trim().slice(0, 16);
      if (cleanName.length < 2 || cleanName === currentName) return;

      if (typeof ServerAntiCheat === "undefined" || !ServerAntiCheat.isReady()) {
        showToast("⚠️ Server connection required to request a name change.", 3500);
        return;
      }

      try {
        // NOT validateUsername() — that applies the rename instantly. Names are
        // moderated now: requestNameChange stages it for admin approval, exactly
        // like an avatar photo under safety review.
        const result = await ServerAntiCheat.requestNameChange(cleanName);

        if (!result.ok) {
          if (result.banned) {
            showToast(`⛔ ${result.reason}`, 5000);
            setTimeout(() => window.location.reload(), 3000);
            return;
          }
          if (result.nameReset) {
            showToast(`${result.reason}`, 4000);
            if (typeof Store.syncFromCloud === "function") {
              await Store.syncFromCloud();
              updateTopbar();
              updatePlayerInfoModal();
            }
            return;
          }
          showToast(`⚠️ ${result.reason}`, 3500);
          return;
        }

        // Remember it locally so the pending banner shows immediately.
        state.player.pendingName = cleanName;
        Store.save(true);
        updatePlayerInfoModal();
        showToast(`📝 Name change to "${cleanName}" submitted for review.`, 4500);
      } catch (err) {
        console.warn("[Name] Name-change request failed:", err);
        showToast("⚠️ Could not submit name change. Try again later.", 3500);
      }
    });

    // ---- Admin: name-change review queue (mirrors the avatar review flow) ----
    async function renderNameQueue() {
      const list = el("name-queue-list");
      if (!list) return;
      list.innerHTML = `<div class="feed-empty-msg">Loading…</div>`;
      const res = (typeof ServerAntiCheat !== "undefined" && ServerAntiCheat.listNameChangeRequests)
        ? await ServerAntiCheat.listNameChangeRequests()
        : null;
      const rows = (res && res.requests) || [];
      if (!rows.length) {
        list.innerHTML = `<div class="feed-empty-msg">No pending name change requests.</div>`;
        return;
      }
      list.innerHTML = rows.map((r) => `
        <div class="name-queue-row" data-uid="${r.uid}">
          <div class="name-queue-text">
            <strong>${escapeHtmlFallback(String(r.currentName || "?"))}</strong>
            <span>→</span>
            <strong class="name-queue-new">${escapeHtmlFallback(String(r.requestedName || "?"))}</strong>
            <small>${new Date(Number(r.requestedAt) || 0).toLocaleString()}</small>
          </div>
          <div class="name-queue-actions">
            <button class="btn-receive-gift" data-name-approve="${r.uid}">Approve</button>
            <button class="btn-remove-friend" data-name-reject="${r.uid}" title="Reject">✕</button>
          </div>
        </div>`).join("");

      list.querySelectorAll("[data-name-approve]").forEach((b) => {
        b.addEventListener("click", async () => {
          const uid = b.getAttribute("data-name-approve");
          b.disabled = true;
          const r = await ServerAntiCheat.approveNameChange(uid);
          showToast(r && r.ok ? `✅ Approved "${r.name}"` : `⚠️ ${(r && r.reason) || "Could not approve"}`, 3500);
          renderNameQueue();
        });
      });
      list.querySelectorAll("[data-name-reject]").forEach((b) => {
        b.addEventListener("click", async () => {
          const uid = b.getAttribute("data-name-reject");
          b.disabled = true;
          const r = await ServerAntiCheat.rejectNameChange(uid, "rejected_by_staff");
          showToast(r && r.ok ? "Rejected." : "⚠️ Could not reject", 3000);
          renderNameQueue();
        });
      });
    }

    el("admin-name-queue-btn")?.addEventListener("click", () => {
      openModal("name-queue-modal");
      renderNameQueue();
    });

    // 1. Remote Citadel Recall
    el("remote-recall-citadel-btn")?.addEventListener("click", () => {
      const activeCit = typeof Citadels !== "undefined" ? Citadels.getMyCitadel() : null;
      if (activeCit && typeof Citadels !== "undefined") {
        Citadels.relocateCitadel(activeCit.id);
        closeModal("player-info-modal");
      }
    });

    // 1b. Player Info Modal Tab Switching
    document.querySelectorAll(".pi-tab").forEach(tab => {
      tab.addEventListener("click", () => {
        const target = tab.dataset.piTab;
        document.querySelectorAll(".pi-tab").forEach(t => t.classList.remove("active"));
        document.querySelectorAll(".pi-tab-panel").forEach(p => p.classList.remove("active"));
        tab.classList.add("active");
        const panel = document.querySelector(`[data-pi-panel="${target}"]`);
        if (panel) panel.classList.add("active");
      });
    });

    // --- Companion Pet UI Handlers ---
    el("pet-hud-btn")?.addEventListener("click", () => {
      if (typeof CompanionPet !== "undefined") {
        CompanionPet.openPetModal();
      }
    });

    el("pet-feed-btn")?.addEventListener("click", () => {
      if (typeof CompanionPet !== "undefined") {
        CompanionPet.feedBerry();
      }
    });

    el("pet-rename-btn")?.addEventListener("click", () => {
      if (typeof CompanionPet !== "undefined") {
        CompanionPet.renamePet();
      }
    });

    // 1c. Avatar Tap to Upload — triggers hidden file input
    el("avatar-upload-trigger")?.addEventListener("click", () => {
      const state = Store.get();
      if (state.player?.avatarUploaded) {
        showToast("🔒 Custom photo already uploaded.", 3000);
        return;
      }
      el("avatar-file-input")?.click();
    });

    // 2. Client-Side Canvas 96x96 Photo Resizer (Zero Storage Cost)
    const avatarInput = el("avatar-file-input");

    avatarInput?.addEventListener("change", (e) => {
      const file = e.target.files?.[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (event) => {
        const img = new Image();
        img.onload = () => {
          // Off-screen Canvas Resizer: Downsamples to lightweight 96x96 thumbnail
          const canvas = document.createElement("canvas");
          canvas.width = 96;
          canvas.height = 96;
          const ctx = canvas.getContext("2d");

          // Center Crop to Square
          const minSide = Math.min(img.width, img.height);
          const sx = (img.width - minSide) / 2;
          const sy = (img.height - minSide) / 2;
          ctx.drawImage(img, sx, sy, minSide, minSide, 0, 0, 96, 96);

          // Convert to Blob for Firebase Storage upload
          canvas.toBlob(async (blob) => {
            if (!blob) return;
            const state = Store.get();
            const userId = state.player?.id;
            if (!userId) return;

            try {
              // Upload to Firebase Storage
              const storageRef = firebase.storage().ref();
              const avatarRef = storageRef.child(`avatars/${userId}.jpg`);
              await avatarRef.put(blob, { contentType: "image/jpeg" });
              const downloadURL = await avatarRef.getDownloadURL();

              // Update player state with Storage URL
              state.player.pendingAvatar = "img:" + downloadURL;
              state.player.avatarStatus = "pending";
              state.player.avatarUploaded = true;
              Store.save(true);

              // Queue to Firestore for safety moderation
              const db = Store.getDb();
              if (db) {
                await db.collection("avatar_reviews").doc(userId).set({
                  userId,
                  userName: state.player.name || "Traveler",
                  avatarData: "img:" + downloadURL,
                  submittedAt: Date.now(),
                  status: "pending"
                });
              }

              updatePlayerInfoModal();
              showToast("📷 Photo submitted! Pending community safety review.", 4000);
            } catch (uploadErr) {
              console.warn("[Avatar] Upload error:", uploadErr);
              showToast("⚠️ Upload failed. Please try again.", 3000);
            }
          }, "image/jpeg", 0.82);
        };
        img.src = event.target.result;
      };
      reader.readAsDataURL(file);
    });

    // 3. Cinematic "Bird's Eye View" — Globe Zoom with Anonymized Territories
    let isBirdsEye = false;

    function enterBirdsEye() {
      if (isBirdsEye || !map || !currentPos) return;
      isBirdsEye = true;
      document.body.classList.add("birds-eye-mode");

      // Bird's Eye keeps landplot tiles visible (player wants ONLY the plot
      // squares on screen when zoomed all the way out — no billboards/3D).
      // Empty buy-grid is irrelevant at globe zoom.
      ["empty-grid-fill", "empty-grid-line"].forEach(id => {
        if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", "none");
      });
      applyBirdsEyeLayerVisibility();

      // Build anonymized territory fills from ALL plots (grouped by state)
      const state = Store.get();
      const plots = state.plots || {};
      const stateGroups = {};

      for (const tid in plots) {
        const p = plots[tid];
        const stateKey = (p.state || "").replace(/\s+/g, " ").trim();
        if (!stateKey || stateKey === "Unknown State") continue;
        if (!stateGroups[stateKey]) stateGroups[stateKey] = [];
        const ts = CONFIG.TILE_SIZE_METERS || 6.096;
        const bounds = Geo.tileBounds(Number(p.tx), Number(p.ty), ts);
        stateGroups[stateKey].push(bounds);
      }

      const territoryFeatures = [];
      for (const stateKey in stateGroups) {
        const tiles = stateGroups[stateKey];
        let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
        for (const b of tiles) {
          minLat = Math.min(minLat, b[0][0], b[3][0]);
          maxLat = Math.max(maxLat, b[1][0], b[2][0]);
          minLon = Math.min(minLon, b[0][1], b[1][1]);
          maxLon = Math.max(maxLon, b[2][1], b[3][1]);
        }
        // Pad the bounding box for visibility at low zoom
        const padLat = (maxLat - minLat) * 0.3 + 0.05;
        const padLon = (maxLon - minLon) * 0.3 + 0.05;
        minLat -= padLat; maxLat += padLat;
        minLon -= padLon; maxLon += padLon;

        territoryFeatures.push({
          type: "Feature",
          properties: { state: stateKey, count: tiles.length },
          geometry: {
            type: "Polygon",
            coordinates: [[
              [minLon, minLat], [maxLon, minLat], [maxLon, maxLat], [minLon, maxLat], [minLon, minLat]
            ]]
          }
        });
      }

      if (territoryFeatures.length > 0 && !map.getSource("territory-overview-source")) {
        map.addSource("territory-overview-source", {
          type: "geojson",
          data: { type: "FeatureCollection", features: territoryFeatures }
        });
        map.addLayer({
          id: "territory-overview-fill",
          type: "fill",
          source: "territory-overview-source",
          paint: {
            "fill-color": "#5a6a7a",
            "fill-opacity": 0.25,
          }
        }, "plots-grass-base");
        map.addLayer({
          id: "territory-overview-line",
          type: "line",
          source: "territory-overview-source",
          paint: {
            "line-color": "#8892a2",
            "line-width": 1.5,
            "line-opacity": 0.5,
          }
        }, "plots-grass-base");
      } else if (map.getSource("territory-overview-source")) {
        map.getSource("territory-overview-source").setData({
          type: "FeatureCollection", features: territoryFeatures
        });
      }

      // Fly to globe view
      map.flyTo({
        center: [currentPos.lon, currentPos.lat],
        zoom: 3,
        pitch: 0,
        bearing: 0,
        duration: 2500,
        essential: true
      });

      showToast("🦅 Bird's Eye — Globe View", 3500);
      showExitBirdsEye();
    }

    function exitBirdsEye() {
      if (!isBirdsEye || !map || !currentPos) return;
      isBirdsEye = false;
      document.body.classList.remove("birds-eye-mode");
      // Kill the exit control first so a later cleanup error can't strand it on the main HUD.
      hideExitBirdsEye();

      try {
        // Remove territory overview layers
        if (map.getLayer("territory-overview-line")) map.removeLayer("territory-overview-line");
        if (map.getLayer("territory-overview-fill")) map.removeLayer("territory-overview-fill");
        if (map.getSource("territory-overview-source")) map.removeSource("territory-overview-source");

        // Restore layers from current toggle prefs (applyMapLod is out of scope here)
        ["empty-grid-fill", "empty-grid-line", "3d-buildings"].forEach(id => {
          if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", "visible");
        });
        applyBirdsEyeLayerVisibility();
      } catch (err) {
        console.warn("[Bird's Eye] exit cleanup:", err);
      }

      // Smooth fly back to player
      map.flyTo({
        center: [currentPos.lon, currentPos.lat],
        zoom: 18.5,
        pitch: 70,
        bearing: 0,
        duration: 2000,
        essential: true
      });

      showToast("📍 Back to your location", 2500);
    }

    // ---- Permanent View hub (collapse + toggles) ----
    const BE_KEYS = ["player", "diamonds", "mine", "citadel", "foliage", "stops", "plots"];

    document.getElementById("be-hub-header")?.addEventListener("click", () => {
      const hub = document.getElementById("be-visibility-hub");
      if (!hub) return;
      const open = hub.classList.toggle("is-open");
      document.getElementById("be-hub-header")?.setAttribute("aria-expanded", open ? "true" : "false");
    });

    const beHub = document.getElementById("be-visibility-hub");
    if (beHub) {
      beHub.addEventListener("touchstart", (e) => e.stopPropagation(), { passive: true });
      beHub.addEventListener("touchmove", (e) => e.stopPropagation(), { passive: true });
      beHub.addEventListener("wheel", (e) => e.stopPropagation(), { passive: true });
    }

    function resetBirdsEyeToggles() {
      document.querySelectorAll(".be-toggle").forEach(cb => {
        cb.checked = true;
      });
      BE_KEYS.forEach(k => document.body.classList.remove("be-off-" + k));
      applyBirdsEyeLayerVisibility();
    }

    function syncBirdsEyeToggleClasses() {
      document.querySelectorAll(".be-toggle").forEach(cb => {
        const key = cb.dataset.be;
        if (!key) return;
        document.body.classList.toggle("be-off-" + key, !cb.checked);
      });
    }

    document.querySelectorAll(".be-toggle").forEach(cb => {
      cb.addEventListener("change", () => {
        syncBirdsEyeToggleClasses();
        applyBirdsEyeLayerVisibility();
      });
    });

    function showExitBirdsEye() {
      let exitBtn = document.getElementById("exit-birds-eye-btn");
      if (!exitBtn) {
        exitBtn = document.createElement("button");
        exitBtn.id = "exit-birds-eye-btn";
        exitBtn.type = "button";
        exitBtn.textContent = "✕ Exit Bird's Eye";
        exitBtn.addEventListener("click", exitBirdsEye);
        document.body.appendChild(exitBtn);
      }
      exitBtn.classList.remove("hidden");
    }

    function hideExitBirdsEye() {
      const exitBtn = document.getElementById("exit-birds-eye-btn");
      if (exitBtn) exitBtn.remove();
    }

    el("birds-eye-trigger-btn")?.addEventListener("click", () => {
      closeModal("player-info-modal");
      enterBirdsEye();
    });
    // --- Diamond Extractor Dynamic Level Math (2-min base, up to 50 gems) ---
    function getExtractorStats(level = 1) {
      const baseInterval = CONFIG.EXTRACTOR_INTERVAL_MS || 600000; // 10 mins (600,000ms)
      const timeUpgrades = Math.floor((level - 1) / 2);
      const storageUpgrades = Math.floor(level / 2);

      // 0.0001% safe time reduction per time upgrade
      const interval = baseInterval * Math.pow(1 - 0.025, timeUpgrades);
      const maxStored = (CONFIG.EXTRACTOR_MAX_STORED || 50) + storageUpgrades;
      const nextCost = level * 1.0; // $1.00, $2.00, $3.00...
      const nextIsCapacity = level % 2 === 1;

      return { interval, maxStored, nextCost, nextIsCapacity };
    }

    function checkExtractorTick() {
      if (document.hidden) return; // Battery Saver: 0% CPU while phone in pocket

      const state = Store.get();
      if (!state.extractor) state.extractor = { built: false, level: 1, lastHarvest: Date.now(), stored: 0 };
      if (!state.extractor.built) return;

      const lvl = state.extractor.level || 1;
      const { interval, maxStored, nextCost, nextIsCapacity } = getExtractorStats(lvl);

      const now = Date.now();
      const baseLastHarvest = Number(state.extractor.lastHarvest) || now;
      const timeSince = now - baseLastHarvest;
      const readyCount = Math.floor(timeSince / interval);

      // SERVER-AUTHORITATIVE: Don't modify lastHarvest or stored — they get synced to cloud.
      // Compute display values locally only. Server recomputes stored in collectExtractor.
      const displayStored = Math.min(maxStored, readyCount);
      const displayLastHarvest = readyCount > 0 ? now - (timeSince % interval) : baseLastHarvest;

      // Live UI Updates
      const remainingMs = Math.max(0, interval - (now - displayLastHarvest));
      const hrs = Math.floor(remainingMs / 3600000);
      const mins = Math.floor((remainingMs % 3600000) / 60000);
      const secs = Math.floor((remainingMs % 60000) / 1000);

      if (el("extractor-lvl-badge")) el("extractor-lvl-badge").textContent = `Level ${lvl}`;
      if (el("extractor-next-timer")) el("extractor-next-timer").textContent = `${String(hrs).padStart(2, "0")}:${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
      if (el("extractor-stored-count")) el("extractor-stored-count").innerHTML = `${displayStored} / ${maxStored} <span class="hud-gem-icon"></span>`;
      if (el("extractor-next-perk")) el("extractor-next-perk").textContent = nextIsCapacity ? "Next: +1 Max Diamond Capacity" : "Next: -2.5% Mining Time";
      
      // $1.00 Unlock Condition Check
      const upgradeBtn = el("upgrade-extractor-btn");
      const lockNotice = el("extractor-locked-notice");
      const hasReachedOneDollar = (Number(state.cash) || 0) >= 1.00 || lvl > 1;

      if (upgradeBtn && lockNotice) {
        if (hasReachedOneDollar) {
          upgradeBtn.style.display = "block";
          upgradeBtn.textContent = `⚡ Upgrade (RC ${nextCost.toFixed(2)})`;
          lockNotice.classList.add("hidden");
        } else {
          upgradeBtn.style.display = "none";
          lockNotice.classList.remove("hidden");
        }
      }

      if (el("collect-extractor-btn")) {
        el("collect-extractor-btn").innerHTML = `Collect All (${displayStored} <span class="hud-gem-icon"></span>)`;
        el("collect-extractor-btn").disabled = displayStored === 0;
      }
      const adExtTickBtn = el("watch-ad-extract-btn");
      if (adExtTickBtn) {
        const adsReady = typeof Ads !== "undefined" && Ads.isRewardedAvailable();
        adExtTickBtn.classList.toggle("hidden", displayStored === 0 || !adsReady);
      }

      // Live Update Extractor Side HUD Button & Red Notification Dot
      const extractorHudBtn = el("extractor-hud-btn");
      const extractorRedDot = el("extractor-unread-dot");

      if (extractorHudBtn) {
        if (state.extractor.built) {
          extractorHudBtn.classList.remove("hidden");
          if (extractorRedDot) {
            if (displayStored > 0) {
              extractorRedDot.classList.remove("hidden");
            } else {
              extractorRedDot.classList.add("hidden");
            }
          }
        } else {
          extractorHudBtn.classList.add("hidden");
        }
      }
    }

    function openExtractorModal() {
      const state = Store.get();
      if (!state.extractor) state.extractor = { built: false, lastHarvest: Date.now(), stored: 0 };

      if (!state.extractor.built) {
        el("extractor-unbuilt-view")?.classList.remove("hidden");
        el("extractor-active-view")?.classList.add("hidden");
      } else {
        el("extractor-unbuilt-view")?.classList.add("hidden");
        el("extractor-active-view")?.classList.remove("hidden");
        checkExtractorTick();
      }
      openModal("extractor-modal");
    }

    window.addEventListener("openExtractorModal", openExtractorModal);

    // Tap Quick Extractor Button to Open Modal
    el("extractor-hud-btn")?.addEventListener("click", openExtractorModal);

    // Upgrade Extractor Button — cash spent SERVER-SIDE (upgradeExtractor callable)
    el("upgrade-extractor-btn")?.addEventListener("click", async () => {
      const state = Store.get();
      if (!state.extractor || !state.extractor.built) return;

      const lvl = state.extractor.level || 1;
      const { nextCost } = getExtractorStats(lvl);

      if ((state.cash || 0) < nextCost) {
        showToast(`You need RC ${nextCost.toFixed(2)} in Cash Balance to upgrade.`);
        return;
      }
      if (typeof ServerAntiCheat === "undefined" || !ServerAntiCheat.isReady()) {
        showToast("⚠️ Server connection required to upgrade the Extractor.", 3500);
        return;
      }

      const result = await ServerAntiCheat.upgradeExtractor();
      if (!result?.ok) {
        const msgs = {
          not_built: "⚠️ Build the Extractor first.",
          max_level: "✅ Extractor is already max level.",
          not_enough_cash: `🔒 You need $${Number(result?.cost || nextCost).toFixed(2)} Cash.`,
          rate_limited: "⏳ Slow down — try again shortly.",
        };
        showToast(msgs[result?.reason] || `⚠️ Upgrade rejected: ${result?.reason || "server_error"}`, 3500);
        return;
      }

      // Mirror server balances — critical so cash max-merge cannot refund the cost
      if (Number.isFinite(Number(result.nextCash))) {
        state.cash = Math.max(0, Number(result.nextCash));
      }
      state.extractor.level = result.level;
      Store.save(true);
      updateTopbar();
      showToast(`⚡ Extractor Upgraded to Level ${result.level}! (RC ${Number(result.cost).toFixed(2)} Cash)`);
      checkExtractorTick();
    });

    // Build Extractor Button
    el("build-extractor-btn")?.addEventListener("click", () => {
      const state = Store.get();
      const cost = CONFIG.EXTRACTOR_BUILD_COST_EB || 50;
      if (state.eb < cost) {
        showToast(`You need ${cost} EB to construct the Extractor.`);
        return;
      }
      state.eb -= cost;
      if (!state.extractor) state.extractor = { level: 1 };
      state.extractor.built = true;
      state.extractor.level = 1;
      state.extractor.lastHarvest = Date.now();
      state.extractor.stored = 0;
      Store.save(true);
      updateTopbar();

      // Immediately render 3D Extractor Beacon on map
      if (typeof Grid !== "undefined" && Grid.render) {
        Grid.render();
      }

      showToast("Diamond Extractor Constructed!");
      openExtractorModal();
    });

    // Collect Diamonds Button with Multi-Gem Particle Shower & Auto-Close
    const collectExtBtn = el("collect-extractor-btn");
    // Shared collect flow. useAdDouble consumes a server-held rewarded-ad
    // credit (claimAdReward 'extractor_double') and doubles the payout.
    async function runExtractorCollect(useAdDouble) {
        const state = Store.get();
        const now = Date.now();
        const lvl = Number(state.extractor && state.extractor.level) || 1;
        const stats = getExtractorStats(lvl);
        const ready = Math.floor((now - (Number(state.extractor && state.extractor.lastHarvest) || now)) / stats.interval);
        if (!state.extractor || ready <= 0) return;

        if (typeof ServerAntiCheat === "undefined" || !ServerAntiCheat.isReady()) {
          showToast("⚠️ Server connection required to collect diamonds.", 3500);
          return;
        }

        const rect = collectExtBtn.getBoundingClientRect();
        const originX = rect.left + rect.width / 2;
        const originY = rect.top + rect.height / 2;

        // --- OPTIMISTIC UI: the player already knows the stored count, so the
        // gems land on screen instantly. The server confirms in the background
        // and its totals are authoritative; a rejection rolls the collect back.
        const prevDiamonds = Number(state.diamonds) || 0;
        const prevHarvest = Number(state.extractor && state.extractor.lastHarvest) || 0;
        const prevStored = Number(state.extractor && state.extractor.stored) || 0;
        const optimisticCount = useAdDouble ? ready * 2 : ready;

        const timeSince = now - prevHarvest;
        state.diamonds = prevDiamonds + optimisticCount;
        state.extractor.lastHarvest = now - (timeSince % stats.interval);
        state.extractor.stored = 0;
        Store.save(true);
        updateTopbar();
        showToast(`${iconDiamond} Collected ${optimisticCount} Diamond${optimisticCount > 1 ? "s" : ""} from Extractor!${useAdDouble ? " (2x ad bonus!)" : ""}`);
        checkExtractorTick();
        launchFlyingGemStream(originX, originY, optimisticCount);

        const rollbackCollect = () => {
          const r = Store.get();
          r.diamonds = prevDiamonds;
          if (r.extractor) {
            r.extractor.lastHarvest = prevHarvest;
            r.extractor.stored = prevStored;
          }
          Store.save(true);
          updateTopbar();
          showToast("⚠️ Collect could not be verified.", 3500);
        };

        ServerAntiCheat.collectExtractor(useAdDouble).then((result) => {
          if (!result || !result.collected) {
            const r = Store.get();
            r.diamonds = prevDiamonds;
            if (r.extractor) {
              r.extractor.lastHarvest = prevHarvest;
              r.extractor.stored = prevStored;
            }
            Store.save(true);
            updateTopbar();
            showToast(result && result.reason === "nothing_stored"
              ? `${iconDiamond} Nothing to collect yet!`
              : "⚠️ Collect could not be verified.", 3500);
            return;
          }
          const fresh = Store.get();
          fresh.diamonds = result.nextDiamonds;
          // Adopt the server's exact harvest clock — the optimistic estimate
          // must never become the local truth or the mine drifts out of sync.
          if (fresh.extractor && result.nextLastHarvest) {
            fresh.extractor.lastHarvest = result.nextLastHarvest;
            fresh.extractor.stored = 0;
          }
          Store.save(true);
          updateTopbar();
        }).catch(rollbackCollect);

        // Auto-close Extractor modal after short celebration delay
        setTimeout(() => {
          closeModal("extractor-modal");
        }, 250);
    }

    if (collectExtBtn) {
      collectExtBtn.addEventListener("click", () => runExtractorCollect(false));
    }

    // Rewarded placement: double the harvest. Hidden when no ad provider
    // exists (browser) or nothing is stored — never a dead button.
    const adExtBtn = el("watch-ad-extract-btn");
    if (adExtBtn) {
      adExtBtn.addEventListener("click", async () => {
        if (typeof Ads === "undefined" || !Ads.isRewardedAvailable()) return;
        adExtBtn.disabled = true;
        try {
          const earned = await Ads.showRewarded("extractor_double");
          if (!earned) {
            showToast("Ad not completed — no bonus collected.", 3500);
            return;
          }
          const claim = await ServerAntiCheat.claimAdReward("extractor_double");
          if (!claim || !claim.ok) {
            showToast(claim && claim.reason === "daily_cap"
              ? "🎬 No bonus collects left today."
              : "⚠️ Bonus could not be granted.", 4000);
            return;
          }
          await runExtractorCollect(true);
        } finally {
          adExtBtn.disabled = false;
        }
      });
    }

    // Check extractor every 2 seconds
    setInterval(checkExtractorTick, 2000);
    // --- Global Multiplier & +2EB Boost Wiring (Delegated to Multiplier module) ---
    if (typeof Multiplier !== "undefined") {
      Multiplier.init();
      Multiplier.updateUI(Store.get());
    }

    // --- Smooth BUY LAND 2D Camera Transition (Zero Black Flash) ---
    // BUY lives in the bottom nav now (it replaced the floating BUY LAND CTA).
    const buyLandBtn = el("buy-nav-btn");
    const exitBuyBtn = el("exit-buy-mode-btn");
    const buyBanner = el("buy-mode-banner");

    // Top banner copy: buying land vs relocating a bagged plot
    function updateBuyModeBanner() {
      const state = Store.get();
      const items = state.plotBagItems;
      const bagCount = (items && typeof items === "object" && Object.keys(items).length > 0)
        ? Object.keys(items).length
        : Object.values(state.plotBag || {}).reduce((s, n) => s + (Number(n) || 0), 0);
      const titleEl = el("buy-mode-title");
      const descEl = el("buy-mode-desc");
      if (bagCount > 0) {
        if (titleEl) titleEl.textContent = "Place Plot";
        if (descEl) descEl.textContent = "These squares represent land around you in the real world. Tap an empty tile inside your circle to relocate a plot from your Bag.";
      } else {
        if (titleEl) titleEl.textContent = "Buy Land";
        if (descEl) descEl.textContent = "These squares represent land around you in the real world. Tap an empty tile inside your circle to claim it for 100 EB.";
      }
    }

    // Entering buy/place mode must start clean: close every open panel and
    // modal (pet, ranks, diamond extractor, bag, events, ...) so the map is
    // unobstructed and nothing can float over the purchase UI.
    function closeAllModals() {
      document.querySelectorAll(".modal, .modal-fullscreen").forEach((m) => m.classList.add("hidden"));
    }

    function enterBuyLandMode() {
      if (!map || !currentPos) return;
      document.body.classList.add("buy-mode");
      closeAllModals();
      updateBuyModeBanner();
      buyBanner?.classList.remove("hidden");
      Grid.setBuyMode(true, currentPos);

      // Show buy-mode ad banner safely
      const buyModeAd = el("buy-mode-ad-container");
      if (buyModeAd && window.EEAdPolicy && window.EEAdPolicy.adsAllowed) {
        buyModeAd.classList.remove("hidden");
        // Completely recreate the tag so Google knows it's a fresh impression
        buyModeAd.innerHTML = `<ins class="adsbygoogle" style="display:inline-block;width:320px;height:50px" data-ad-client="ca-pub-5972331036113330" data-ad-slot="4287691766"></ins>`;
        try { (window.adsbygoogle = window.adsbygoogle || []).push({}); } catch (e) {}
      }

      // 1. Lock camera strictly to 2D Top-Down View (minPitch = 0, maxPitch = 0)
      map.setMinPitch(0);
      map.setMaxPitch(0); // Physically impossible to tilt into 3D!

      // 2. Wide framing — whole 75m reach circle visible at once
      map.setMinZoom(17.5);
      map.setMaxZoom(20.0);

      map.flyTo({
        center: [currentPos.lon, currentPos.lat],
        pitch: 0,
        bearing: 0,
        zoom: 18.0,
        duration: 800,
        essential: true,
      });
    }

    function exitBuyLandMode() {
      document.body.classList.remove("buy-mode");
      buyBanner?.classList.add("hidden");
      Grid.setBuyMode(false);

      // Hide buy-mode ad banner and clear memory
      const buyModeAd = el("buy-mode-ad-container");
      if (buyModeAd) {
        buyModeAd.classList.add("hidden");
        buyModeAd.innerHTML = ""; // Destroys the ad to free up Google's queue
      }

      // Re-push treasury ad instantly now that the screen is clear
      setTimeout(() => {
        const treasuryAd = el("treasury-ad-container");
        if (treasuryAd && window.EEAdPolicy && window.EEAdPolicy.adsAllowed && !document.body.classList.contains("buy-mode")) {
          // Only inject if no ad is already loaded
          const existingAd = treasuryAd.querySelector("ins.adsbygoogle");
          if (!existingAd || existingAd.getAttribute("data-ad-status") === "unfilled") {
            treasuryAd.innerHTML = `<ins class="adsbygoogle" style="display:inline-block;width:320px;height:50px" data-ad-client="ca-pub-5972331036113330" data-ad-slot="4287691766"></ins>`;
            try { (window.adsbygoogle = window.adsbygoogle || []).push({}); } catch (e) {}
          }
        }
      }, 500);

      // 1. Restore normal 3D tilt limits
      map.setMinPitch(0);
      map.setMaxPitch(70);

      // 2. Restore normal zoom limits
      map.setMinZoom(2);
      map.setMaxZoom(20.0);

      // 3. Smoothly tilt back to 58° 3D perspective
      map.setMinPitch(0);
      map.setMaxPitch(80);
      map.flyTo({
        center: [currentPos.lon, currentPos.lat],
        pitch: 70,
        zoom: 18.4,
        duration: 800,
        essential: true,
      });
    }

    buyLandBtn?.addEventListener("click", enterBuyLandMode);
    exitBuyBtn?.addEventListener("click", exitBuyLandMode);

    // --- Territory Location Pill (reverse geocode during Buy Land mode) ---
    const territoryPill = el("territory-pill");
    const territoryText = el("territory-text");
    let territoryTimer = null;
    let lastTerritoryQuery = "";

    async function updateTerritory() {
      if (!map || !document.body.classList.contains("buy-mode")) return;
      try {
        const center = map.getCenter();
        const lat = center.lat;
        const lon = center.lng;

        // Throttle: don't query the same location twice within 10 seconds
        const locKey = `${lat.toFixed(4)},${lon.toFixed(4)}`;
        if (locKey === lastTerritoryQuery) return;
        lastTerritoryQuery = locKey;

        // Gated reverse geocode via Geo module (PA boroughs/townships resolve
        // to no city; result is cached by coordinate so this stays cheap)
        const info = await Geo.getTerritoryInfo(lat, lon);
        if (!info) return;

        let display = info.city || info.state || "";
        if (!display && info.country) display = info.country;

        if (territoryText) territoryText.textContent = `📍 ${display || "Unknown Territory"}`;
      } catch (e) {
        console.warn("[Territory] Reverse geocode failed:", e);
      }
    }

    function startTerritoryUpdates() {
      if (territoryPill) territoryPill.classList.remove("hidden");
      updateTerritory();
      territoryTimer = setInterval(updateTerritory, 8000); // Update every 8 seconds while panning
    }

    function stopTerritoryUpdates() {
      if (territoryPill) territoryPill.classList.add("hidden");
      if (territoryTimer) { clearInterval(territoryTimer); territoryTimer = null; }
      lastTerritoryQuery = "";
    }

    // Patch buy mode functions to include territory updates
    const _origEnterBuy = enterBuyLandMode;
    const _origExitBuy = exitBuyLandMode;
    // (already wired above — add territory to the button listeners)
    buyLandBtn?.removeEventListener("click", enterBuyLandMode);
    exitBuyBtn?.removeEventListener("click", exitBuyLandMode);
    buyLandBtn?.addEventListener("click", () => { _origEnterBuy(); startTerritoryUpdates(); });
    exitBuyBtn?.addEventListener("click", () => { _origExitBuy(); stopTerritoryUpdates(); });

    // Reset Camera to True North & Default Zoom Level
    el("recenter-btn")?.addEventListener("click", () => {
      if (currentPos && map) {
        map.flyTo({
          center: [currentPos.lon, currentPos.lat],
          bearing: 0,      // Snaps camera back to True North
          pitch: 70,       // Resets to 3D Isometric View
          zoom: 18.5,      // Returns to default sweetspot zoom
          duration: 750,
          essential: true,
        });
      }
    });
    
    // Tap Profile Chip to open Player Info Modal (balance card now opens cashout)
    function openPlayerInfo() {
      updatePlayerInfoModal();
      openModal("player-info-modal");
      if (typeof window.completeDailyQuest === "function") {
        window.completeDailyQuest("mayor");
      }
    }
    document.querySelector(".player-chip")?.addEventListener("click", openPlayerInfo);
    // Wire up Guest "Sign in with Google" button in Player Info Modal
    document.getElementById("google-link-btn")?.addEventListener("click", () => {
      // Wipe all guest data from localStorage before signing in with Google
      console.log("[Auth] Wiping guest data before Google sign-in...");
      localStorage.removeItem("eldenEarth.save.v1");
      localStorage.removeItem("eldenEarth.guestModeUsed");
      // Sign out of Firebase anonymous session to force fresh Google auth
      if (typeof firebase !== "undefined" && firebase.auth && firebase.auth().currentUser) {
        firebase.auth().signOut();
      }
      // Force page reload to show clean sign-in screen
      window.location.reload();
    });

    el("earn-btn").addEventListener("click", () => {
      // Never stack windows — dismiss whatever the previous tab opened.
      closeAllPanels();
      setActiveTab("earn-btn");
      // Safety unlock in case modal was closed mid-spin
      const spinBtn = el("spin-btn");
      if (spinBtn && !el("wheel-result").textContent.includes("Spinning")) {
        spinBtn.disabled = false;
        if (typeof Wheel !== "undefined" && Wheel.resetSpinningState) Wheel.resetSpinningState();
      }
      openModal("wheel-modal");
      updateTopbar();
      updateSpinButtonState();
    });
    el("land-btn").addEventListener("click", () => {
      closeAllPanels();
      setActiveTab("land-btn");
      updateLandModal();
      openModal("land-modal");
    });
    el("ascension-forge-btn")?.addEventListener("click", () => {
      if (typeof PlotAscension !== "undefined") PlotAscension.openForge(null);
    });

    // --- Tutorial Unread Alert Dot Logic ---
    const menuDot = el("menu-unread-dot");
    const TUTORIAL_KEY = "eldenEarth.tutorialViewed.v1";

    // Show glowing red dot if player hasn't opened the updated guide yet
    if (!localStorage.getItem(TUTORIAL_KEY) && menuDot) {
      menuDot.classList.remove("hidden");
    }

    // ---- Closed beta opt-in (Menu -> "Join the Play Store Closed Beta") ----
    el("opt-in-beta-btn")?.addEventListener("click", async () => {
      const state = Store.get();
      if (state.player?.betaFounder) {
        showToast("⋆☬⋆ You're already an Alpha Founder — thanks for testing!", 3500);
        return;
      }
      if (typeof ServerAntiCheat === "undefined" || !ServerAntiCheat.isReady()) {
        showToast("⚠️ Server connection required to join the beta list.", 3500);
        return;
      }
      const btn = el("opt-in-beta-btn");
      if (btn) btn.classList.add("disabled");
      const res = await ServerAntiCheat.joinClosedBeta();
      if (!res || !res.ok) {
        showToast("⚠️ Could not join the list — please try again.", 3500);
        if (btn) btn.classList.remove("disabled");
        return;
      }
      const st = Store.get();
      st.player.betaFounder = true;
      if (res.nextEb !== undefined) st.eb = Number(res.nextEb) || st.eb;
      if (res.nextDiamonds !== undefined) st.diamonds = Number(res.nextDiamonds) || st.diamonds;
      Store.save(true);
      updateTopbar();
      updatePlayerInfoModal();
      const title = el("opt-in-beta-title");
      const sub = el("opt-in-beta-sub");
      if (title) title.textContent = "✓ Alpha Founder";
      if (sub) sub.textContent = "You're on the closed beta list — your Google account email goes to the Play test invite.";
      showToast(res.already
        ? "⋆☬⋆ You're already on the list!"
        : `⋆☬⋆ You're on the list! +1,000 EB & +50 ${iconDiamond} Founders Pack added!`, 6000);
    });

    el("menu-btn").addEventListener("click", () => {
      // Mark viewed & remove alert dot
      localStorage.setItem(TUTORIAL_KEY, "true");
      if (menuDot) menuDot.classList.add("hidden");
      openModal("menu-modal");
      // Update phone verification button state when menu opens
      updatePhoneButtonState();
    });

    // Wire up Session Conflict Resume Button
    document.getElementById("resume-session-btn")?.addEventListener("click", () => {
      if (typeof Store !== "undefined" && Store.resumeSession) {
        Store.resumeSession();
      } else {
        window.location.reload();
      }
    });
    
    // --- Google AdSense Compliant 60-Second Treasury Ad Refresher ---
    function initTreasuryAdRefresher() {
      // No AdSense inside the native Android app (Play policy + AdSense terms).
      if (!window.EEAdPolicy || !window.EEAdPolicy.adsAllowed) return;
      const adContainer = el("treasury-ad-container");
      if (!adContainer) return;

      const REFRESH_INTERVAL_MS = 60000; // 🚨 MUST be 60s to prevent Google AdSense permanent ban!
      let lastAdRefreshTime = Date.now();

      function refreshAd() {
        // Do not refresh treasury ad if phone is asleep OR if player is in Buy Land Mode!
        if (document.hidden || document.body.classList.contains("buy-mode")) return;

        try {
          // SPA Safe Refresh: Destroy and recreate only if ad is unfilled or stale
          const existingAd = adContainer.querySelector("ins.adsbygoogle");
          const adFilled = existingAd && existingAd.getAttribute("data-ad-status") !== "unfilled" && existingAd.offsetHeight > 10;
          if (!adFilled) {
            adContainer.innerHTML = `<ins class="adsbygoogle" style="display:inline-block;width:320px;height:50px" data-ad-client="ca-pub-5972331036113330" data-ad-slot="4287691766"></ins>`;
            (window.adsbygoogle = window.adsbygoogle || []).push({});
            console.log("[AdSense] Refreshed treasury banner (was unfilled).");
          }
          lastAdRefreshTime = Date.now();
        } catch (e) {
          console.warn("[AdSense] Refresh notice:", e);
        }
      }

      // Initial push for ALL ad slots currently sitting in the HTML on boot
      try {
        const adSlots = document.querySelectorAll('ins.adsbygoogle');
        adSlots.forEach(() => {
          (window.adsbygoogle = window.adsbygoogle || []).push({});
        });
      } catch (e) {}

      // 60-Second Refresh Ticker
      setInterval(() => {
        if (Date.now() - lastAdRefreshTime >= REFRESH_INTERVAL_MS) refreshAd();
      }, REFRESH_INTERVAL_MS);

      // Refresh when waking up phone
      document.addEventListener("visibilitychange", () => {
        if (!document.hidden && (Date.now() - lastAdRefreshTime >= REFRESH_INTERVAL_MS)) refreshAd();
      });
    }

    initTreasuryAdRefresher();

    // --- PWA Standalone Status Bar & Battery Guard for Fullscreen Ads ---
    const adObserver = new MutationObserver(() => {
      const overlays = document.querySelectorAll('body > div[style*="2147483647"], body > div[id*="aswift"], body > ins[style*="2147483647"]');
      overlays.forEach(el => {
        if (el.dataset.adSafe) return;
        el.dataset.adSafe = "1";
        el.style.setProperty("top", "env(safe-area-inset-top, 0px)", "important");
        el.style.setProperty("height", "calc(100dvh - env(safe-area-inset-top, 0px))", "important");
        el.style.setProperty("bottom", "0", "important");
      });
    });
    adObserver.observe(document.body, { childList: true, subtree: false });

    document.querySelectorAll("[data-close]").forEach(btn => {
      btn.addEventListener("click", () => closeModal(btn.dataset.close));
    });
    document.querySelectorAll(".modal").forEach(modal => {
      modal.addEventListener("click", (e) => {
        if (e.target === modal) {
          modal.classList.add("hidden");
          deactivateMapObjectAnimations(modal.id);
        }
      });
    });

    // --- 10X Multi-Spin Toggle Wiring ---
    const toggle10x = document.getElementById("wheel-10x-toggle");
    const spinBtn = el("spin-btn");

    // Rewarded-ad placements policy (AdMob/Play): ads ACCELERATE, never gate.
    // 3 free spins/day are the baseline, "Watch Ad to Spin" tops them up, and
    // paying diamonds stays available beside the ad — a hard ad-wall would be
    // flagged as deceptive design.
    // AD_SPIN_DAILY_CAP: cut from 10 to 3 while the native app is paused —
    // the AdMob units behind those ads are DEMO units that earn nothing, so
    // 10 free spins a day was giving away value for no revenue. Keep this in
    // sync with `wheel_spin.cap` in functions/index.js.
    const AD_SPIN_DAILY_CAP = 3;
    function adWheelSpinsLeft() {
      const st = Store.get();
      const used = Number(st && st.player && st.player.adRewardCounts && st.player.adRewardCounts.wheel_spin) || 0;
      return Math.max(0, AD_SPIN_DAILY_CAP - used);
    }

    function updateSpinButtonState() {
      const is10x = toggle10x && toggle10x.checked;
      const mult = is10x ? 10 : 1;
      const cost = is10x ? 20 : 2;

      // 1. Tell Wheel to update numbers on canvas
      if (typeof Wheel !== "undefined" && Wheel.setMultiplier) {
        Wheel.setMultiplier(mult);
        Wheel.redraw();
      }

      const st = Store.get();
      const freeSpinsLeft = Number(st && st.player && st.player.freeSpins) || 0;
      const freeCap = Number(st && st.player && st.player.freeSpinsCap) || 3;
      const hasFree = freeSpinsLeft > 0 && !!(st && st.player && st.player.freeSpinsNoDiamondCost);
      const adsReady = typeof Ads !== "undefined" && Ads.isRewardedAvailable();
      const adLeft = adWheelSpinsLeft();

      // 2. Daily free-spin status line
      const spinsLeftEl = el("wheel-spins-left");
      if (spinsLeftEl) {
        const freeLabel = freeSpinsLeft > freeCap ? `${freeSpinsLeft}` : `${freeSpinsLeft}/${freeCap}`;
        spinsLeftEl.innerHTML = `Spins remaining today: ${freeLabel}`
          + (adLeft > 0 ? ` &middot; ${adLeft} ad spin${adLeft === 1 ? "" : "s"} left` : "");
      }

      // 3. Top subtitle text
      const wheelSub = el("wheel-sub");
      if (wheelSub && !el("wheel-result")?.textContent?.includes("Spinning")) {
        if (!is10x && hasFree) {
          wheelSub.innerHTML = `Free spin — no diamonds needed!`;
        } else {
          wheelSub.innerHTML = `${cost} <span class="hud-gem-icon"></span> per spin`;
        }
      }

      // 4. Spin button: free spins first, then the ad CTA (with the diamond
      //    escape hatch), then the plain paid button. 10X always pays.
      const payBtn = el("spin-pay-btn");
      if (spinBtn && !el("wheel-result")?.textContent?.includes("Spinning")) {
        if (!is10x && hasFree) {
          spinBtn.dataset.mode = "free";
          spinBtn.innerHTML = `Tap to Spin (FREE)`;
          if (payBtn) payBtn.classList.add("hidden");
        } else if (!is10x && adsReady && adLeft > 0) {
          spinBtn.dataset.mode = "ad";
          spinBtn.innerHTML = `Watch Ad to Spin ▶`;
          if (payBtn) {
            payBtn.classList.remove("hidden");
            payBtn.innerHTML = `Pay ${cost} <span class="hud-gem-icon"></span> instead`;
          }
        } else {
          spinBtn.dataset.mode = "pay";
          spinBtn.innerHTML = `Spin (${cost} <span class="hud-gem-icon"></span>)`;
          if (payBtn) payBtn.classList.add("hidden");
        }
      }
    }

    if (toggle10x) {
      toggle10x.addEventListener("change", () => {
        updateSpinButtonState();
      });
    }

    // The diamond-paid path must always exist next to the ad (no hard ad-wall).
    el("spin-pay-btn")?.addEventListener("click", () => {
      if (spinBtn) {
        spinBtn.dataset.mode = "pay"; // skip the ad branch in the shared flow
        spinBtn.click();
      }
    });

    // --- Spin Button Execution ---
    el("spin-btn").addEventListener("click", async () => {
      // Session lock: block if paused
      if (typeof Store !== "undefined" && !Store.isSessionActive()) {
        showToast("🔒 Account active on another tab. Close the other tab first.", 4000);
        return;
      }

      // Anti-cheat: Embargo check
      if (typeof AntiCheat !== "undefined") {
        const check = AntiCheat.isActionAllowed("spin");
        if (!check.allowed) { showToast(check.reason, 5000); return; }
      }

      const state = Store.get();

      if (typeof ServerAntiCheat === "undefined" || !ServerAntiCheat.isReady()) {
        showToast("⚠️ Server connection required to spin the wheel.", 3500);
        return;
      }

      // "Watch Ad to Spin": the ad finishes, then the SERVER grants the free
      // spin (claimAdReward). Nothing is ever granted from the client promise
      // alone — see IMPLEMENTATIONADMOB.md §4.
      if (spinBtn && spinBtn.dataset.mode === "ad") {
        spinBtn.disabled = true;
        el("wheel-result").textContent = "Loading ad…";
        const earned = await Ads.showRewarded("wheel_spin");
        if (!earned) {
          el("wheel-result").textContent = "";
          showToast("Ad not completed — no bonus spin granted.", 3500);
          spinBtn.disabled = false;
          updateSpinButtonState();
          return;
        }
        const claim = await ServerAntiCheat.claimAdReward("wheel_spin");
        if (!claim || !claim.ok) {
          el("wheel-result").textContent = "";
          showToast(claim && claim.reason === "daily_cap"
            ? "🎬 No ad spins left today — free spins reset at midnight UTC."
            : "⚠️ Bonus spin could not be granted.", 4000);
          spinBtn.disabled = false;
          updateSpinButtonState();
          return;
        }
        const st0 = Store.get();
        st0.player.freeSpins = Number(claim.freeSpins) || 1;
        st0.player.freeSpinsNoDiamondCost = true;
        if (claim.adRewardCounts) st0.player.adRewardCounts = claim.adRewardCounts;
        Store.save(true);
        // Fall through — the spin just granted pays for this spin.
      }

      const currentMult = (typeof Wheel !== "undefined" && Wheel.getMultiplier) ? Wheel.getMultiplier() : 1;
      const spinCost = 2 * currentMult;

      // Client-side diamond check before hitting server
      const hasFreeSpins = Number(state.player?.freeSpins) > 0 && state.player?.freeSpinsNoDiamondCost && currentMult === 1;
      if (!hasFreeSpins && (Number(state.diamonds) || 0) < spinCost) {
        showToast(`Not enough diamonds — you need ${spinCost} diamonds for this spin!`, 3500);
        return;
      }

      el("spin-btn").disabled = true;
      el("wheel-result").textContent = "Spinning...";

      const spinMsgs = {
        insufficient_diamonds: `Not enough diamonds — you need ${spinCost} diamonds!`,
        no_save_found: "⚠️ Account not found. Please restart the game.",
        functions_not_initialized: "⚠️ Server connection required to spin the wheel.",
        server_error: "⚠️ Wheel spin could not be verified.",
      };

      let spinResult = null;
      try {
        spinResult = await ServerAntiCheat.spinWheel(currentMult);
      } catch (err) {
        spinResult = { spun: false, reason: "server_error" };
      }

      if (!spinResult || !spinResult.spun) {
        el("wheel-result").textContent = "Spin not verified.";
        showToast(spinMsgs[spinResult && spinResult.reason] || "⚠️ Wheel spin could not be verified.", 3500);
        el("spin-btn").disabled = false;
        updateSpinButtonState();
        return;
      }

      // Spin directly to the server's authoritative slice — eliminates double spins & mismatches
      Wheel.spin((slice) => {
        // Update currency AFTER animation completes, not before
        state.diamonds = spinResult.nextDiamonds;
        state.eb = spinResult.nextEb;
        state.player.freeSpins = spinResult.nextFreeSpins;
        state.player.freeSpinsNoDiamondCost = spinResult.nextFreeSpins > 0;
        Store.save(true);
        updateTopbar();

        if (typeof window.completeDailyQuest === "function") {
          window.completeDailyQuest("wheel");
        }

        // Coordinates from the center of the wheel for flying particle fountains
        const wheelEl = el("wheel-canvas");
        const wRect = wheelEl ? wheelEl.getBoundingClientRect() : { left: window.innerWidth / 2, top: window.innerHeight / 2, width: 0, height: 0 };
        const originX = wRect.left + wRect.width / 2;
        const originY = wRect.top + wRect.height / 2;

        const multAward = currentMult; // 1 or 10
        const winningSlice = spinResult.slice || slice;

        if (winningSlice.type === "diamond") {
          const winDiamonds = 1 * multAward;
          // 1. Uses .innerHTML so the image renders on the modal!
          el("wheel-result").innerHTML = `Your diamond found its way back to you. (${iconDiamond} +${winDiamonds})`;
          // 2. Uses clean emoji so the floating toast doesn't print raw HTML code!
          showToast(`💎 +${winDiamonds} Diamond${winDiamonds > 1 ? 's' : ''} Refunded!`);
          launchFlyingGemStream(originX, originY, winDiamonds);

        } else if (winningSlice.type === "diamond_jackpot") {
          // +12 or +24 Diamond Jackpot!
          const winDiamonds = (Number(winningSlice.amount) || 12) * multAward;
          el("wheel-result").innerHTML = `🎉 MEGA BONUS! +${winDiamonds} Diamonds!`;
          showToast(`💎 MEGA BONUS! Won +${winDiamonds} Diamonds!`);

          // Only broadcast diamond jackpots on 1X spins (not 10X) to prevent feed flooding
          if (multAward === 1 && typeof Feed !== "undefined") {
            Feed.broadcast("diamond_jackpot", { amount: winDiamonds });
          }

          launchFlyingGemStream(originX, originY, winDiamonds);

        } else if (winningSlice.type === "miss") {
          el("wheel-result").textContent = "Better luck next time! (No reward)";
          showToast("🚫 Nothing this time — keep searching!");
          if (spinResult.eventContributed > 0 && typeof GlobalEvent !== "undefined") {
            GlobalEvent.notifySpinContributed(spinResult.eventContributed);
          }

        } else {
          // Elden Bucks Winner
          const winAmount = (Number(winningSlice.amount) || 0) * multAward;
          el("wheel-result").textContent = `🎉 You won ${winAmount} EB!`;
          showToast(`🎉 Won +${winAmount} Elden Bucks!`);

          // Global Event: server already recorded contribution via spinWheel
          if (spinResult.eventContributed > 0 && typeof GlobalEvent !== "undefined") {
            GlobalEvent.notifySpinContributed(spinResult.eventContributed);
          }

          // Only broadcast 25+ EB Jackpots on 1X spins (not 10X) to prevent feed flooding
          if (winAmount >= 25 && multAward === 1 && typeof Feed !== "undefined") {
            Feed.broadcast("jackpot", { amount: winAmount });
          }

          launchFlyingEBStream(originX, originY, winAmount);
        }

        updateTopbar();
        el("spin-btn").disabled = false;
        updateSpinButtonState();
      }, spinResult.slice);
    });

    // --- LOG OUT BUTTON ---
    el("logout-btn")?.addEventListener("click", async () => {
      if (await window.gameConfirm("Log out of Elden Earth?")) {
        if (typeof firebase !== "undefined" && firebase.auth) {
          firebase.auth().signOut();
        }
        localStorage.removeItem("eldenEarth.save.v1");
        window.location.reload();
      }
    });

    // --- DELETE ACCOUNT PERMANENTLY ---
    el("delete-account-btn")?.addEventListener("click", async () => {
      if (!await window.gameConfirm("DELETE your account PERMANENTLY? This cannot be undone. All your data will be erased from Firebase.", { okText: "Delete" })) return;
      if (!await window.gameConfirm("Are you absolutely sure? Your plots, balance, and progress will be gone forever.", { okText: "Yes, Delete" })) return;

      try {
        const user = firebase.auth().currentUser;
        if (!user) {
          showToast("No user logged in.");
          return;
        }
        const uid = user.uid;
        const db = Store.getDb();

        // Reauthenticate with Google (required for account deletion)
        showToast("Reauthenticating... please sign in again to confirm deletion.");
        const provider = new firebase.auth.GoogleAuthProvider();
        try {
          await user.reauthenticateWithPopup(provider);
        } catch (reauthErr) {
          showToast("Reauthentication cancelled — account not deleted.");
          return;
        }

        showToast("Deleting account data...");

        // 1. Delete all Firestore data in parallel (fastest wipe)
        if (db) {
          const deletePromises = [];
          const userCollections = ["saves", "plots", "presence", "dividends", "usernames", "avatar_reviews"];
          for (const col of userCollections) {
            deletePromises.push(db.collection(col).doc(uid).delete().catch(() => {}));
          }
          // Delete citadels owned by this user
          try {
            const citadelSnap = await db.collection("citadels").where("creatorId", "==", uid).get();
            citadelSnap.forEach(doc => deletePromises.push(doc.ref.delete().catch(() => {})));
          } catch (e) {}
          await Promise.all(deletePromises);
        }

        // 2. Delete Firebase Auth account (must be last)
        await user.delete();
        console.log("[Auth] Account deleted:", uid);

        // 3. Wipe ALL local storage for this game
        localStorage.removeItem("eldenEarth.save.v1");
        localStorage.removeItem("eldenEarth.guestModeUsed");
        localStorage.removeItem("elden_sess_token");

        // 4. Clear IndexedDB (Firestore persistence cache)
        try {
          const dbs = await indexedDB.databases();
          for (const dbInfo of dbs) {
            if (dbInfo.name) indexedDB.deleteDatabase(dbInfo.name);
          }
        } catch (e) {}

        // 5. Clear sessionStorage
        try { sessionStorage.clear(); } catch (e) {}

        showToast("Account permanently deleted. Redirecting...");
        // 6. Instant redirect — no delay
        window.location.replace(window.location.href.split("?")[0]);
      } catch (err) {
        console.error("[Auth] Delete account error:", err);
        if (err.code === "auth/requires-recent-login") {
          showToast("Session expired — please log out and log back in, then try again.");
        } else {
          showToast("Failed to delete account: " + err.message);
        }
      }
    });

    // --- LINK PHONE NUMBER ---
    let phoneConfirmationResult = null;
    let recaptchaVerifier = null;
    let recaptchaWidgetId = null;

    function resetPhoneModal() {
      el("phone-step-input").classList.remove("hidden");
      el("phone-step-verify").classList.add("hidden");
      el("phone-step-loading").classList.add("hidden");
      el("phone-number-input").value = "";
      el("phone-code-input").value = "";
      phoneConfirmationResult = null;
      if (recaptchaVerifier) {
        try { recaptchaVerifier.clear(); } catch (e) {}
        recaptchaVerifier = null;
        recaptchaWidgetId = null;
      }
      // Clear the reCAPTCHA container HTML
      const container = el("recaptcha-container");
      if (container) container.innerHTML = "";
      // Reset send button state
      const sendBtn = el("phone-send-code-btn");
      if (sendBtn) {
        sendBtn.disabled = true;
        sendBtn.style.opacity = "0.5";
        sendBtn.textContent = "Complete reCAPTCHA first";
      }
    }

    async function sendPhoneCode() {
      const phoneNumber = el("phone-number-input").value.trim();
      if (!phoneNumber || phoneNumber.length < 7) {
        showToast("Please enter a valid phone number with country code.");
        return;
      }
      const user = firebase.auth().currentUser;
      if (!user) { showToast("Please log in first."); return; }

      if (!recaptchaVerifier) {
        showToast("Verification not ready. Please close and reopen the modal.");
        return;
      }

      el("phone-step-input").classList.add("hidden");
      el("phone-step-loading").classList.remove("hidden");

      try {
        phoneConfirmationResult = await firebase.auth().signInWithPhoneNumber(phoneNumber, recaptchaVerifier);
        el("phone-step-loading").classList.add("hidden");
        el("phone-step-verify").classList.remove("hidden");
        showToast("SMS code sent!");
      } catch (err) {
        console.error("[Phone] Send code error:", err);
        el("phone-step-loading").classList.add("hidden");
        el("phone-step-input").classList.remove("hidden");
        if (err.code === "auth/too-many-requests") {
          showToast("Too many attempts. Please try again later.");
        } else if (err.code === "auth/invalid-phone-number") {
          showToast("Invalid phone number format.");
        } else if (err.code === "auth/captcha-check-failed") {
          showToast("reCAPTCHA check failed. Please try again.");
        } else {
          showToast("Failed to send code: " + err.message);
        }
        if (recaptchaVerifier) {
          try { grecaptcha.reset(recaptchaWidgetId); } catch (e) {}
        }
      }
    }

    function updatePhoneButtonState() {
      const user = firebase.auth().currentUser;
      const btn = el("link-phone-btn");
      const label = el("phone-verified-label");
      if (!btn || !label) return;
      
      if (user) {
        const phoneProvider = user.providerData.find(p => p.providerId === "phone");
        if (phoneProvider) {
          // Phone is verified - show green checkmark state
          btn.textContent = "✓ Verified";
          btn.style.background = "linear-gradient(180deg, #4ade80, #22c55e)";
          btn.style.color = "#ffffff";
          btn.style.border = "1px solid #4ade80";
          btn.style.boxShadow = "0 4px 12px rgba(74, 222, 128, 0.3)";
          btn.disabled = true;
          label.classList.remove("hidden");
          return;
        }
      }
      // Not verified - show default state
      btn.textContent = "Link Phone Number";
      btn.style.background = "";
      btn.style.color = "";
      btn.style.border = "";
      btn.style.boxShadow = "";
      btn.disabled = false;
      label.classList.add("hidden");
    }
    window.updatePhoneButtonState = updatePhoneButtonState;

    el("link-phone-btn")?.addEventListener("click", async () => {
      const user = firebase.auth().currentUser;
      if (!user) { showToast("Please log in first."); return; }
      const phoneProvider = user.providerData.find(p => p.providerId === "phone");
      if (phoneProvider) {
        showToast("Phone number already verified: " + phoneProvider.phoneNumber);
        return;
      }
      resetPhoneModal();
      el("phone-link-modal").classList.remove("hidden");
      console.log("[Phone] Modal opened");
      
      // Disable send button initially
      const sendBtn = el("phone-send-code-btn");
      if (sendBtn) {
        sendBtn.disabled = true;
        sendBtn.style.opacity = "0.5";
        sendBtn.textContent = "Complete reCAPTCHA first";
      }
      
      // Wait for modal to be visible, then render reCAPTCHA
      await new Promise(resolve => setTimeout(resolve, 300));
      try {
        if (!recaptchaVerifier) {
          const container = el("recaptcha-container");
          console.log("[Phone] Container visible:", container.offsetParent !== null);
          recaptchaVerifier = new firebase.auth.RecaptchaVerifier("recaptcha-container", {
            size: "normal",
            callback: () => {
              console.log("[Phone] reCAPTCHA solved - enabling send button");
              if (sendBtn) {
                sendBtn.disabled = false;
                sendBtn.style.opacity = "1";
                sendBtn.textContent = "Send Code";
              }
            },
            "expired-callback": () => {
              showToast("reCAPTCHA expired. Please try again.");
              if (sendBtn) {
                sendBtn.disabled = true;
                sendBtn.style.opacity = "0.5";
                sendBtn.textContent = "Complete reCAPTCHA first";
              }
              if (recaptchaVerifier) {
                try { grecaptcha.reset(recaptchaWidgetId); } catch (e) {}
              }
            }
          });
          recaptchaWidgetId = await recaptchaVerifier.render();
          console.log("[Phone] reCAPTCHA rendered, widgetId:", recaptchaWidgetId);
        }
      } catch (err) {
        console.error("[Phone] reCAPTCHA render error:", err);
        showToast("Failed to load verification. Please refresh and try again.");
      }
    });

    el("phone-cancel-btn")?.addEventListener("click", () => {
      el("phone-link-modal").classList.add("hidden");
      resetPhoneModal();
    });

    el("phone-back-btn")?.addEventListener("click", () => {
      el("phone-step-verify").classList.add("hidden");
      el("phone-step-input").classList.remove("hidden");
      phoneConfirmationResult = null;
      // Reset send button state
      const sendBtn = el("phone-send-code-btn");
      if (sendBtn) {
        sendBtn.disabled = false;
        sendBtn.style.opacity = "1";
        sendBtn.textContent = "Send Code";
      }
    });

    el("phone-send-code-btn")?.addEventListener("click", () => {
      sendPhoneCode();
    });

    el("phone-verify-btn")?.addEventListener("click", async () => {
      const code = el("phone-code-input").value.trim();
      if (!code || code.length < 4) {
        showToast("Please enter the verification code.");
        return;
      }
      if (!phoneConfirmationResult) {
        showToast("Please request a code first.");
        return;
      }

      el("phone-step-verify").classList.add("hidden");
      el("phone-step-loading").classList.remove("hidden");
      el("phone-step-loading").querySelector("p").textContent = "Verifying code...";

      try {
        const credential = firebase.auth.PhoneAuthProvider.credential(
          phoneConfirmationResult.verificationId,
          code
        );
        const user = firebase.auth().currentUser;
        await user.linkWithCredential(credential);
        el("phone-link-modal").classList.add("hidden");
        resetPhoneModal();
        el("phone-step-loading").querySelector("p").textContent = "Sending SMS code...";
        showToast("Phone number linked successfully!");
        updatePhoneButtonState();
      } catch (err) {
        console.error("[Phone] Verify error:", err);
        el("phone-step-loading").classList.add("hidden");
        el("phone-step-verify").classList.remove("hidden");
        el("phone-step-loading").querySelector("p").textContent = "Sending SMS code...";
        if (err.code === "auth/invalid-verification-code") {
          showToast("Invalid code. Please try again.");
        } else if (err.code === "auth/code-expired") {
          showToast("Code expired. Please request a new one.");
        } else if (err.code === "auth/credential-already-in-use") {
          showToast("This phone number is already linked to another account.");
        } else {
          showToast("Verification failed: " + err.message);
        }
      }
    });
  }

  // ===================== CASHOUT / CONVERT PAGE =====================
  let cashoutConvertAmount = 1;

  function openCashoutPage() {
    const state = Store.get();
    const cashBalance = state.cash || 0;
    el("cashout-cash-amount").textContent = Fmt.rcPrecise(cashBalance);
    cashoutConvertAmount = 1;
    updateCashoutDisplay();
    el("cashout-page").classList.remove("hidden");
    // Refresh the treasury gate on the way in so the lock and the progress bar
    // are never showing an hour-old figure.
    if (typeof Cashout !== "undefined" && Cashout.refreshAfterSync) Cashout.refreshAfterSync();
  }

  function closeCashoutPage() {
    el("cashout-page").classList.add("hidden");
  }

  function updateCashoutDisplay() {
    el("cashout-convert-amount").textContent = cashoutConvertAmount;
    el("cashout-eb-reward").textContent = cashoutConvertAmount * 25;
    el("cashout-diamond-reward").textContent = cashoutConvertAmount * 10;

    const state = Store.get();
    const cashBalance = state.cash || 0;
    const convertBtn = el("cashout-convert-btn");
    if (convertBtn) {
      convertBtn.disabled = cashBalance < cashoutConvertAmount;
    }
  }

  // Wire up cashout page. The entry point moved with the balance bar: it used
  // to be the map's hero card, now it's the wallet balance in Player Info.
  el("profile-cash-box")?.addEventListener("click", openCashoutPage);

  el("cashout-close-btn")?.addEventListener("click", closeCashoutPage);

  // Tap black background to close
  el("cashout-page")?.addEventListener("click", (e) => {
    if (e.target.id === "cashout-page" || e.target.classList.contains("cashout-overlay-bg")) {
      closeCashoutPage();
    }
  });

  el("cashout-decrease-btn")?.addEventListener("click", () => {
    if (cashoutConvertAmount > 1) {
      cashoutConvertAmount--;
      updateCashoutDisplay();
    }
  });

  el("cashout-increase-btn")?.addEventListener("click", () => {
    const state = Store.get();
    const cashBalance = state.cash || 0;
    if (cashoutConvertAmount < Math.floor(cashBalance) && cashoutConvertAmount < 1000) {
      cashoutConvertAmount++;
      updateCashoutDisplay();
    }
  });

  el("cashout-convert-btn")?.addEventListener("click", async () => {
    const state = Store.get();
    const cashBalance = state.cash || 0;

    if (cashBalance < cashoutConvertAmount) {
      showToast("Insufficient cash balance.");
      return;
    }

    const convertBtn = el("cashout-convert-btn");
    if (convertBtn) {
      convertBtn.disabled = true;
      convertBtn.textContent = "CONVERTING...";
    }

    try {
      const convertFn = firebase.functions().httpsCallable("convertCash");
      // Clamp server-side tolerance here too: the callable rejects anything
      // outside 1..1000 with invalid-argument (a 400 in the console).
      const amount = Math.max(1, Math.min(1000, Math.floor(Number(cashoutConvertAmount) || 1)));
      cashoutConvertAmount = amount;
      const result = await convertFn({ amount });

      if (result.data?.ok) {
        showToast(`✓ Converted RC ${cashoutConvertAmount} → +${result.data.ebReward} EB +${result.data.diamondReward} Diamonds!`, 4000);
        // Update local state
        state.cash = result.data.newCash;
        state.eb = result.data.newEb;
        state.diamonds = result.data.newDiamonds;
        Store.save(true);
        completeDailyQuest("convert_cash");
        updateTopbar();
        closeCashoutPage();
      } else {
        showToast("Conversion failed. Please try again.");
      }
    } catch (err) {
      console.error("[Cashout] Convert error:", err);
      if (err.code === "permission-denied") {
        showToast("Phone verification required. Please link your phone number first.");
      } else if (err.code === "failed-precondition") {
        showToast("Insufficient cash balance.");
      } else {
        showToast("Conversion failed: " + err.message);
      }
    } finally {
      if (convertBtn) {
        convertBtn.disabled = false;
        convertBtn.textContent = "CONVERT";
      }
    }
  });

  // Hardware Compass: Rotates 3D Character when turning your body in place
  if (typeof window !== "undefined" && window.DeviceOrientationEvent) {
    window.addEventListener("deviceorientation", (e) => {
      if (document.hidden) return;
      const compassHeading = e.webkitCompassHeading || (e.alpha ? 360 - e.alpha : null);
      if (compassHeading !== null && !isNaN(compassHeading)) {
        if (typeof Character3D !== "undefined" && Character3D.setHeading) {
          Character3D.setHeading((compassHeading * Math.PI) / 180);
        }
      }
    }, { passive: true });
  }

  // Hardware Compass: Rotates 3D Character when turning your body in place
    document.getElementById("resume-session-btn")?.addEventListener("click", () => {
      if (typeof Store !== "undefined" && Store.resumeSession) {
        Store.resumeSession();
      } else {
        window.location.reload();
      }
    });

  // Expose for leaderboard cross-module access
  window.updatePlayerInfoModal = updatePlayerInfoModal;
  window.updateLandModal = updateLandModal;
  window.openModal = openModal;
  window.getPlayerPosition = () => currentPos ? { lat: currentPos.lat, lon: currentPos.lon } : null;

  // ---------------- Boot ----------------
  document.addEventListener("DOMContentLoaded", () => {
    // --- AUTOMATION / HEADLESS BROWSER DETECTION ---
    if (typeof detectAutomation === "function" && detectAutomation()) {
      console.error("[AntiCheat] Automated browser detected — aborting game init.");
      document.body.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100vh;background:#0e1522;color:#ff4757;font-family:system-ui;font-size:1.4rem;text-align:center;padding:2rem;">🛡️ Automated browser detected.<br>Please use a real browser to play Elden Earth.</div>';
      return;
    }

    Store.load();
    if (Store.get()?._epochWiped) {
      showToast("✨ A new Realm Era has begun! Your account has been reset for the new season.", 6000);
      // Consume the flag so the toast never repeats on future logins
      Store.get()._epochWiped = false;
      Store.save(false);
    }
    Auth.init(onSignedIn);
    if (typeof ServerAntiCheat !== "undefined") ServerAntiCheat.init();
    if (typeof Cashout !== "undefined") Cashout.init();
    if (typeof AgeGate !== "undefined") AgeGate.init();
    if (typeof Achievements !== "undefined") Achievements.init();
    // AdSense placements — fills every .ee-ad-slot in the modals. Only ever
    // renders in the browser (EEAdPolicy.adsAllowed is false in the native
    // shell, where the AdMob units are DEMO units that earn nothing).
    if (typeof EEAdSlots !== "undefined") {
      try { EEAdSlots.init(); } catch (e) { console.warn("[AdSlots] init failed:", e); }
    }

    if (typeof GlobalEvent !== "undefined") GlobalEvent.init();
    // Plot Rush (monthly challenge) — separate doc/schedule from the weekly
    // Global Challenge, so the two can be live at the same time.
    if (typeof PlotChallenge !== "undefined") {
      try {
        PlotChallenge.init();
        window.addEventListener("plotChallengeUpdated", () => {
          try { renderEventsHub(); } catch (e) {}
        });
      } catch (e) {
        console.warn("[PlotChallenge] init failed:", e);
      }
    }
    el("locate-btn")?.addEventListener("click", startLocating);
    el("retry-location-btn")?.addEventListener("click", startLocating);

    // --- VPN Block Retry ---
    el("vpn-block-retry")?.addEventListener("click", () => window.location.reload());

    // Periodic friend request notification dot check (every 30s)
    setInterval(() => {
      const id = Store.get()?.player?.id;
      const d = Store.getDb();
      if (!id || !d) return;
      if (typeof Friends !== "undefined" && Friends.syncTradeAlerts) Friends.syncTradeAlerts();
      d.collection("friend_requests")
        .where("toId", "==", id)
        .where("status", "==", "pending")
        .get()
        .then(snap => {
          const dot = document.getElementById("friend-request-dot");
          if (dot) {
            if (snap.size > 0) dot.classList.remove("hidden");
            else dot.classList.add("hidden");
          }
        })
        .catch(() => {});
    }, 30000);

    // First pending-trade poll shortly after boot (badge + toast).
    setTimeout(() => {
      if (!Store.get()?.player?.id || !Store.getDb()) return;
      if (typeof Friends !== "undefined" && Friends.syncTradeAlerts) Friends.syncTradeAlerts();
      // Live listener so a trade opening/committing while the Friends tab is
      // open updates the dot and badge immediately instead of next time the
      // modal is reopened.
      if (typeof Friends !== "undefined" && Friends.startTradeAlertsListener) Friends.startTradeAlertsListener();
      // Sweep any friend gifts already waiting in the mailbox. Without this the
      // only path to claimMailbox was the royalties flow, so gifts sat unclaimed
      // and the "Receive N gifts" badges never moved.
      if (typeof Friends !== "undefined" && Friends.claimDailyGifts) Friends.claimDailyGifts();
    }, 6000);

    // Re-sweep every few minutes so a gift sent while the app is open still
    // settles without the player having to open the Friends tab.
    setInterval(() => {
      if (!Store.get()?.player?.id || !Store.getDb()) return;
      if (typeof Friends !== "undefined" && Friends.claimDailyGifts) Friends.claimDailyGifts();
      // Trade receipts for partners still online when the swap settled with
      // the trade modal closed — without this they only saw results next login.
      if (typeof Trade !== "undefined" && Trade.checkPendingResults) Trade.checkPendingResults();
    }, 180000);

    // Trade receipts for swaps that settled while this player was offline.
    setTimeout(() => {
      if (!Store.get()?.player?.id) return;
      if (typeof Trade !== "undefined" && Trade.checkPendingResults) Trade.checkPendingResults();
    }, 8000);
  });
})();