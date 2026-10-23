// ============================================================
// Elden Earth — Anti-Cheat & Anti-Spoofing System
// GPS velocity checks, North Korea embargo, rate limiting,
// balance validation, replay protection.
// ============================================================
const AntiCheat = (() => {

  // ======================== CONFIG ========================
  const MAX_SPEED_MPS = 20.12;        // 45 mph / 72.4 km/h — jogging & cycling allowed, cars not
  const MAX_ACCEL_MPS2 = 15;          // ~54 km/h per second — impossible for humans
  const POSITION_HISTORY_SIZE = 10;   // Track last 10 GPS readings
  const POSITION_STALE_MS = 30000;    // Ignore positions older than 30s
  const SPEED_WINDOW_S = 2;           // Speed is measured over ≥2 s: over that span the two
                                      // fixes' independent errors do not accumulate, so GPS
                                      // jitter stops inflating the number.
  const ACCURACY_SKIP_M = 50;         // 50-500m: accept the fix, skip motion checks
  const ACCURACY_REJECT_M = 500;      // worse than this is not a usable fix at all
  const VIOLATIONS_TO_FLAG = 2;       // two consecutive bad samples before a fix is rejected
  const PURCHASE_COOLDOWN_MS = 5000;  // 5s minimum between ANY purchase type
  const MAX_PURCHASES_PER_MINUTE = 5; // Hard cap on purchases in 60s window
  const BALANCE_MAX_EB = 500000;      // Impossible EB balance threshold
  const BALANCE_MAX_DIAMONDS = 10000; // Impossible diamond threshold
  const MAX_TRACKED_PURCHASE_IDS = 500; // Replay-protection ring buffer size
  const REPORT_THROTTLE_MS = 60000;   // Max one cheat report per type per minute

  // ======================== EMBARGO LIST ========================
  const EMBARGOED_COUNTRIES = [
    "north korea", "dprk", "democratic people's republic of korea",
    "corée du nord", "korea (democratic people's republic of)",
    "朝鲜民主主义人民共和国"
  ];

  const EMBARGOED_DISPLAY_NAMES = [
    "North Korea", "DPRK", "Democratic People's Republic of Korea"
  ];

  // ======================== STATE ========================
  let positionHistory = [];
  let lastPurchaseTime = 0;
  let purchaseTimestamps = [];
  let purchaseIdSet = new Set();
  let playerCountry = null;
  let isEmbargoed = false;
  let spoofingWarnings = 0;
  let lastWarningTime = 0;
  let recentMotionFlags = [];  // last 3 samples: true = violation (2 of 3 rejects)
  let lastReportAt = {};       // type -> ms of last cheat_report write (throttle)

  // ======================== GPS SPOOFING DETECTION ========================

  // Combined error budget of two independent fixes (root-sum-square).
  function noiseBound(accA, accB) {
    const a = Number(accA) > 0 ? Number(accA) : 0;
    const b = Number(accB) > 0 ? Number(accB) : 0;
    return Math.sqrt(a * a + b * b);
  }

  /**
   * Speed that still holds up AFTER the GPS error budget is subtracted.
   * A jittery fix pair reports ~0 m/s; a real 72 km/h move still reports ~72.
   * This is what stops a stationary phone from "teleporting" 15 metres.
   */
  function conservativeSpeed(prev, next) {
    const dt = (next.time - prev.time) / 1000;
    if (dt <= 0) return { dt: 0, dist: 0, speed: 0 };
    const dist = haversine(prev.lat, prev.lon, next.lat, next.lon);
    const usable = Math.max(0, dist - noiseBound(prev.accuracy, next.accuracy));
    return { dt, dist, speed: usable / dt };
  }

  // OLDEST sample at least SPEED_WINDOW_S seconds back (null while warming up).
  // Measuring over a window matters because the two fixes' independent errors
  // do not accumulate across the span — noise stays bounded instead of scaling,
  // so a longer window makes real motion EASIER to see and jitter harder to
  // mistake for motion. Within the history the oldest qualifying sample wins.
  function windowReference(posTime) {
    for (let i = 0; i < positionHistory.length; i++) {
      if (posTime - positionHistory[i].time >= SPEED_WINDOW_S * 1000) return positionHistory[i];
    }
    return null;
  }

  // Record the outcome of every sample; a position is only rejected once 2 of
  // the last 3 samples look wrong. One multipath spike can therefore never drop
  // a player's position (or block a diamond pickup), while a repeating pattern
  // — the shape real spoofing has — is caught immediately.
  function recordSample(violated, reason, newPos, speed) {
    recentMotionFlags.push(Boolean(violated));
    if (recentMotionFlags.length > 3) recentMotionFlags.shift();
    positionHistory.push(newPos);
    trimHistory();

    if (!violated) return { valid: true, reason, speed };

    const hits = recentMotionFlags.filter(Boolean).length;
    if (hits < VIOLATIONS_TO_FLAG) {
      console.warn(`[AntiCheat] motion anomaly (${hits}/${VIOLATIONS_TO_FLAG}): ${reason}`);
      return { valid: true, reason: reason + "_first", speed };
    }
    spoofingWarnings++;
    lastWarningTime = Date.now();
    console.warn(`[AntiCheat] MOTION VIOLATION: ${reason}`);
    return { valid: false, reason, speed };
  }

  // Kept for readability at the call sites.
  function flagViolation(reason, newPos, speed) {
    return recordSample(true, reason, newPos, speed);
  }

  /**
   * Feed a new GPS position into the anti-spoofing system.
   * Returns { valid: bool, reason: string, speed: number }
   */
  function validatePosition(lat, lon, accuracy, timestamp) {
    const now = Date.now();
    const posTime = timestamp || now;

    // Skip if position is stale
    if (now - posTime > POSITION_STALE_MS) {
      return { valid: true, reason: "stale", speed: 0 };
    }

    const newPos = { lat, lon, time: posTime, accuracy };

    // First position — just record it
    if (positionHistory.length === 0) {
      positionHistory.push(newPos);
      return { valid: true, reason: "initial", speed: 0 };
    }

    const prev = positionHistory[positionHistory.length - 1];
    const dt = (posTime - prev.time) / 1000;

    // Skip if time delta is too small (the same fix arriving twice)
    if (dt < 0.1) {
      return { valid: true, reason: "tiny_dt", speed: 0 };
    }

    // --- Accuracy gates -------------------------------------------------
    // 50-500m: degraded but usable — accept the position, skip motion checks.
    // (Rejecting these used to freeze the player in place, which then made
    //  in-range diamonds read as "too far".)
    if (accuracy > ACCURACY_REJECT_M) {
      positionHistory.push(newPos);
      trimHistory();
      return { valid: false, reason: "low_accuracy_" + accuracy.toFixed(0), speed: 0 };
    }
    if (accuracy > ACCURACY_SKIP_M) {
      positionHistory.push(newPos);
      trimHistory();
      recentMotionFlags = [];
      return { valid: true, reason: "low_accuracy_accepted_" + accuracy.toFixed(0), speed: 0 };
    }

    const current = conservativeSpeed(prev, newPos);
    const speed = current.speed;

    // --- Speed check: 45 mph (72.4 km/h) cap, measured over >=2s ---------
    const ref = windowReference(posTime);
    if (ref) {
      const win = conservativeSpeed(ref, newPos);
      if (win.dt >= SPEED_WINDOW_S && win.speed > MAX_SPEED_MPS) {
        return flagViolation(`speed_violation_${win.speed.toFixed(0)}ms`, newPos, win.speed);
      }
    }

    // --- Acceleration check (needs two >=2s intervals to be meaningful) --
    if (positionHistory.length >= 2 && current.dt >= SPEED_WINDOW_S) {
      const prev2 = positionHistory[positionHistory.length - 2];
      const back = conservativeSpeed(prev2, prev);
      if (back.dt >= SPEED_WINDOW_S) {
        const accel = Math.abs(back.speed - current.speed) / ((back.dt + current.dt) / 2);
        if (accel > MAX_ACCEL_MPS2) {
          return flagViolation(`accel_violation_${accel.toFixed(0)}ms2`, newPos, speed);
        }
      }
    }

    // Clean sample — record it so an earlier spike decays away.
    return recordSample(false, "ok", newPos, speed);
  }

  function trimHistory() {
    if (positionHistory.length > POSITION_HISTORY_SIZE) {
      positionHistory = positionHistory.slice(-POSITION_HISTORY_SIZE);
    }
  }

  // ======================== NORTH KOREA EMBARGO ========================

  /**
   * Set the player's country from reverse geocoding.
   * Call this whenever geo.js resolves territory info.
   */
  function setPlayerCountry(country) {
    if (!country) return;
    const lower = country.toLowerCase().trim();
    isEmbargoed = EMBARGOED_COUNTRIES.some(e => lower.includes(e));
    playerCountry = country;

    if (isEmbargoed) {
      console.warn(`[AntiCheat] EMBARGO ACTIVATED — Country: ${country}`);
    }
  }

  function getEmbargoStatus() {
    return {
      isEmbargoed,
      country: playerCountry,
      displayCountry: isEmbargoed ? "Restricted Territory" : playerCountry
    };
  }

  /**
   * Check if a game action is allowed under embargo.
   * Actions: "purchase", "spin", "earn", "gift", "citadel"
   */
  function isActionAllowed(action) {
    if (!isEmbargoed) return { allowed: true };

    // Reading/looking is always allowed
    if (action === "view" || action === "chat") return { allowed: true };

    return {
      allowed: false,
      reason: `⛔ ${playerCountry || "Restricted Territory"} — gameplay actions are suspended due to international sanctions compliance.`
    };
  }

  // ======================== PURCHASE RATE LIMITING ========================

  /**
   * Check if a purchase is allowed (rate limiting + replay protection).
   * @param {string} purchaseType - "land", "spin", "calendar", "citadel", "upgrade", "gift"
   * @param {string} [purchaseId] - Unique ID for replay protection
   * @returns {{ allowed: bool, reason?: string, waitMs?: number }}
   */
  function canPurchase(purchaseType, purchaseId) {
    const now = Date.now();

    // Embargo check
    const embargo = isActionAllowed(purchaseType);
    if (!embargo.allowed) return embargo;

    // Replay protection — prevent double-spend
    if (purchaseId) {
      if (purchaseIdSet.has(purchaseId)) {
        console.warn(`[AntiCheat] REPLAY BLOCKED: ${purchaseId}`);
        return { allowed: false, reason: "Replay detected — this action was already performed." };
      }
    }

    // Cooldown between ANY purchases
    if (now - lastPurchaseTime < PURCHASE_COOLDOWN_MS) {
      const waitMs = PURCHASE_COOLDOWN_MS - (now - lastPurchaseTime);
      return {
        allowed: false,
        reason: `Too fast! Wait ${(waitMs / 1000).toFixed(1)}s.`,
        waitMs
      };
    }

    // Rolling window: max N purchases per 60 seconds
    purchaseTimestamps = purchaseTimestamps.filter(t => now - t < 60000);
    if (purchaseTimestamps.length >= MAX_PURCHASES_PER_MINUTE) {
      const oldest = purchaseTimestamps[0];
      const waitMs = 60000 - (now - oldest);
      console.warn(`[AntiCheat] RATE LIMIT: ${purchaseTimestamps.length} purchases in 60s`);
      return {
        allowed: false,
        reason: `Purchase rate limit reached. Wait ${(waitMs / 1000).toFixed(0)}s.`,
        waitMs
      };
    }

    return { allowed: true };
  }

  /**
   * Record that a purchase was made. Call this AFTER a successful purchase.
   */
  function recordPurchase(purchaseType, purchaseId) {
    const now = Date.now();
    lastPurchaseTime = now;
    purchaseTimestamps.push(now);

    if (purchaseId) {
      // Re-insert so the ID moves to the end of the insertion-ordered Set
      purchaseIdSet.delete(purchaseId);
      purchaseIdSet.add(purchaseId);
      // Evict the OLDEST tracked IDs one at a time. Wiping the whole set on
      // threshold (the previous behaviour) re-opened a replay window for every
      // ID still inside its validity period.
      while (purchaseIdSet.size > MAX_TRACKED_PURCHASE_IDS) {
        const oldest = purchaseIdSet.values().next().value;
        if (oldest === undefined) break;
        purchaseIdSet.delete(oldest);
      }
    }
  }

  // ======================== BALANCE SANITY CHECKS ========================

  /**
   * Validate that a balance is within sane limits before a transaction.
   */
  function validateBalance(eb, diamonds) {
    const issues = [];

    const ebNum = Number(eb);
    const diaNum = Number(diamonds);

    // NaN/Infinity bypass every `<` / `>` comparison, so reject them up front.
    if (!Number.isFinite(ebNum)) issues.push("EB balance is not a finite number");
    if (!Number.isFinite(diaNum)) issues.push("Diamond balance is not a finite number");
    if (Number.isFinite(ebNum) && ebNum < 0) issues.push("Negative EB balance");
    if (Number.isFinite(ebNum) && ebNum > BALANCE_MAX_EB) issues.push(`EB balance impossibly high: ${eb}`);
    if (Number.isFinite(diaNum) && diaNum < 0) issues.push("Negative diamond balance");
    if (Number.isFinite(diaNum) && diaNum > BALANCE_MAX_DIAMONDS) issues.push(`Diamond balance impossibly high: ${diamonds}`);

    return {
      valid: issues.length === 0,
      issues
    };
  }

  /**
   * Validate a transaction won't create an impossible state.
   */
  function validateTransaction(currentEB, currentDiamonds, costEB, costDiamonds, earnEB, earnDiamonds) {
    const num = (v) => {
      const x = Number(v);
      return Number.isFinite(x) ? x : 0;
    };
    const safeCostEB = num(costEB);
    const safeCostDiamonds = num(costDiamonds);
    const safeEarnEB = num(earnEB);
    const safeEarnDiamonds = num(earnDiamonds);

    const curEB = Number(currentEB);
    const curDiamonds = Number(currentDiamonds);
    if (!Number.isFinite(curEB) || !Number.isFinite(curDiamonds)) {
      return { valid: false, reason: "Current balance is not a finite number" };
    }

    const newEB = curEB - safeCostEB + safeEarnEB;
    const newDiamonds = curDiamonds - safeCostDiamonds + safeEarnDiamonds;

    if (newEB < 0) return { valid: false, reason: `Insufficient EB: need ${costEB}, have ${currentEB}` };
    if (newDiamonds < 0) return { valid: false, reason: `Insufficient diamonds: need ${costDiamonds}, have ${currentDiamonds}` };
    if (newEB > BALANCE_MAX_EB) return { valid: false, reason: "Transaction would create impossible EB balance" };
    if (newDiamonds > BALANCE_MAX_DIAMONDS) return { valid: false, reason: "Transaction would create impossible diamond balance" };

    return { valid: true };
  }

  // ======================== PURCHASE ID GENERATOR ========================

  /**
   * Generate a unique purchase ID for replay protection.
   */
  function generatePurchaseId(type, tx, ty) {
    const ts = Date.now();
    let rand;
    if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
      const buf = new Uint32Array(2);
      crypto.getRandomValues(buf);
      rand = buf[0].toString(36) + buf[1].toString(36);
    } else {
      rand = Math.random().toString(36).slice(2, 8);
    }
    return `${type}_${tx || 0}_${ty || 0}_${ts}_${rand}`;
  }

  // ======================== CHEAT REPORTING ========================

  /**
   * Log a cheat detection to Firestore for admin review.
   */
  function reportViolation(type, details) {
    const state = (typeof Store !== "undefined" && Store.get) ? Store.get() : null;
    const db = (typeof Store !== "undefined" && Store.getDb) ? Store.getDb() : null;
    if (!db || !state?.player?.id) return;

    // Throttle: one document per type per minute. GPS bursts used to write
    // dozens of rows back-to-back for a single harmless anomaly.
    const reportedAt = Date.now();
    if (lastReportAt[type] && reportedAt - lastReportAt[type] < REPORT_THROTTLE_MS) return;
    lastReportAt[type] = reportedAt;

    db.collection("cheat_reports").add({
      playerId: state.player.id,
      playerName: state.player.name || "Unknown",
      type,
      details,
      timestamp: Date.now(),
      position: positionHistory.length > 0 ? positionHistory[positionHistory.length - 1] : null
    }).catch(e => console.warn("[AntiCheat] Report failed:", e));
  }

  // ======================== UTILITY ========================

  function haversine(lat1, lon1, lat2, lon2) {
    const R = 6371000;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  function reset() {
    positionHistory = [];
    lastPurchaseTime = 0;
    purchaseTimestamps = [];
    purchaseIdSet.clear();
    spoofingWarnings = 0;
    recentMotionFlags = [];
    lastReportAt = {};
  }

  // ======================== PUBLIC API ========================
  return {
    validatePosition,
    setPlayerCountry,
    getEmbargoStatus,
    isActionAllowed,
    canPurchase,
    recordPurchase,
    validateBalance,
    validateTransaction,
    generatePurchaseId,
    reportViolation,
    reset,
    EMBARGOED_COUNTRIES,
    EMBARGOED_DISPLAY_NAMES
  };
})();
