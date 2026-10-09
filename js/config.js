// ============================================================
// Elden Earth — configuration
// Edit these values to tune the game or enable Google sign-in.
// ============================================================

// MapLibre exposes `maplibregl`; the game code uses the `mapboxgl` alias.
// maplibre-gl.js is loaded with defer, so it is guaranteed to have run first
// (deferred scripts execute in document order, before this file).
if (typeof maplibregl !== "undefined") window.mapboxgl = maplibregl;

const CONFIG = {
  // --- Game Version (bump on every patch to auto-wipe stale localStorage) ---
  GAME_VERSION: "0.1.11.55b",
  
  // --- Realm Server Epoch ---
  // Bump this timestamp whenever you intentionally wipe the Firestore database.
  // Any local or cloud save created before this epoch is treated as stale.
  REALM_SERVER_EPOCH: 1735689600000, // milliseconds — must match functions/index.js

  // --- Map Tile Engine & Rate Limit Fallback ---
  // Set to true to bypass Mapbox completely and use unlimited 100% free OpenFreeMap
  USE_OPENFREEMAP_DIRECTLY: true,
  MAPBOX_STYLE_URL: "mapbox://styles/mapbox/dark-v11",
  FALLBACK_STYLE_URL: "https://tiles.openfreemap.org/styles/dark", // 100% free, no key, no limits

  GOOGLE_CLIENT_ID: "231253239262-l1ep169u103iuitvl1i6gonrn2k9a69a.apps.googleusercontent.com",

  // --- Access Control Server (DEPRECATED — migrated to Firebase Cloud Functions) ---
  ACCESS_CONTROL_URL: "",

  // --- Firebase Cloud Save Config ---
  FIREBASE_CONFIG: {
    apiKey: "AIzaSyAf8u0qUQJaajJp4352-SrY7lIh8rNFPWY",
    authDomain: "elden-earth.firebaseapp.com",
    projectId: "elden-earth",
    storageBucket: "elden-earth.firebasestorage.app",
    messagingSenderId: "231253239262",
    appId: "1:231253239262:web:3fa1ca28575fcade15e94f",
    measurementId: "G-X24EB16156"
  },
  
  // --- Tile grid ---
  TILE_SIZE_METERS: 6.096,        // ~20 x 20 feet
  GRID_RENDER_MIN_ZOOM: 16,       // grid only draws once zoomed in this close
  GRID_RENDER_MAX_TILES: 1200,    // safety cap per redraw

  // --- Diamonds ---
  DIAMOND_SPAWN_RADIUS_METERS: 1000,     // ~.75 mile maximum
  DIAMOND_COLLECT_RADIUS_METERS: 75,     // Exact player collection radius
  DIAMOND_MAX_ACTIVE: 11,
  DIAMOND_SPAWN_CHECK_MS: 5 * 60 * 1000, // Check for respawns every 5 minutes
  DIAMOND_INNER_COOLDOWN_MS: 60 * 60 * 1000, // 1-Hour inner cooldown (stops pet infinite farm)
  DIAMOND_IDLE_TIMEOUT_MS: 120 * 60 * 1000,  // Pause spawning after 2 hours idle
  DIAMOND_MOVEMENT_THRESHOLD_METERS: 50,     // Ignore GPS drift smaller than 50m
  DIAMOND_LIFETIME_MS: 90 * 60 * 1000,       // 90 minutes lifetime before despawn

  // --- Diamond Extractor ---
  EXTRACTOR_MIN_TILES: 5,               // Requires 5+ connected plots
  EXTRACTOR_INTERVAL_MS: 10 * 60 * 1000, // 1 diamond every 10 minutes
  EXTRACTOR_MAX_STORED: 50,             // Stores up to 50 diamonds max
  EXTRACTOR_BUILD_COST_EB: 50,          // 50 EB to construct

  // --- 50X Super Boost Event Engine ---
  // SINGLE SOURCE OF TRUTH — must match eventAnchor in functions/index.js (activateBoost).
  // REBALANCE 2026-10-08: 50X is now far rarer — 12h live every 12 days
  // (was 24h live every 4 days: 25% duty cycle -> 4.2% duty cycle).
  // duration + cooldown MUST sum to exactly 12 days or the client countdown
  // and the server's activateBoost multiplier disagree about what is live.
  EVENT_50X_ANCHOR_MS: 1788912000000,          // Server-locked cycle anchor (ms)
  EVENT_50X_DURATION_MS: 12 * 3600 * 1000,     // 12 Hours of 50X Active
  EVENT_50X_COOLDOWN_MS: 12 * 24 * 3600 * 1000 - 12 * 3600 * 1000, // 11.5 days -> 12-day cycle

  is50XActive: function() {
    const totalCycle = this.EVENT_50X_DURATION_MS + this.EVENT_50X_COOLDOWN_MS;
    let elapsed = (Date.now() - this.EVENT_50X_ANCHOR_MS) % totalCycle;
    if (elapsed < 0) elapsed += totalCycle;
    return elapsed < this.EVENT_50X_DURATION_MS;
  },

  // --- Boost Tier Collapse (Anti-Whale Curve) ---
  // Multiplier scales down as plot count increases to prevent runaway liabilities.
  // Based on the Atlas Earth model: base multiplier * tier factor = effective multiplier.
  BOOST_TIERS: [
    // UNCHANGED by the 2026-10-08 rebalance — this curve stays as-is by design.
    // tierFactor is relative to the base, so 20X * 0.67 = 13.4X effective now.
    { minPlots: 0,   maxPlots: 150,  tierFactor: 1.00 }, // 1-150:   full 20X/50X
    { minPlots: 151, maxPlots: 220,  tierFactor: 0.67 }, // 151-220: 13X effective (20X * 0.67)
    { minPlots: 221, maxPlots: 290,  tierFactor: 0.50 }, // 221-290: 10X effective
    { minPlots: 291, maxPlots: 365,  tierFactor: 0.40 }, // 291-365: 8X effective
    { minPlots: 366, maxPlots: 730,  tierFactor: 0.30 }, // 366-730: 6X effective
    { minPlots: 731, maxPlots: 1500, tierFactor: 0.20 }, // 731-1500: 4X effective
    { minPlots: 1501, maxPlots: Infinity, tierFactor: 0.067 }, // 1501+: 1.3X effective
  ],
  
  // --- Spin wheel --- (+12 & +24 Diamond Jackpots, 1 Miss Slice)
  WHEEL_SLICES: [
    { type: "diamond",         amount: 1,  label: "+1 ◆",  color: "#8fa3b8", weight: 110 },
    { type: "eb",              amount: 3,  label: "3 EB",  color: "#4fd6c4", weight: 240 },
    { type: "diamond_jackpot", amount: 12, label: "+12 ◆", color: "#4fd6c4", weight: 2  }, // rarer than 50 EB (w5)
    { type: "eb",              amount: 2,  label: "2 EB",  color: "#4f9dd6", weight: 130 },
    { type: "eb",              amount: 5,  label: "5 EB",  color: "#a86ee0", weight: 50  },
    { type: "eb",              amount: 7,  label: "7 EB",  color: "#ff4757", weight: 35  }, // 🍀 Lucky 7 EB Slice!
    { type: "eb",              amount: 25, label: "25 EB", color: "#e0a84f", weight: 15  },
    { type: "diamond_jackpot", amount: 24, label: "+24 ◆", color: "#2ee59d", weight: 1   }, // extremely rare mega jackpot
    { type: "eb",              amount: 50, label: "50 EB", color: "#d4af61", weight: 5   },
  ],
  SPIN_COST_DIAMONDS: 2,
  
  // --- Realm Citadels & Dyson Sphere Holds ---
  CITADEL_UNLOCK_BALANCE: 0.01,        // $0.01 threshold to unlock the Capsule
  CITADEL_GROWTH_MS: 30 * 60 * 1000,   // 30 mins growth timer
  CITADEL_MIN_SPACING_METERS: 0,       // Legacy setting; nearby Citadels are allowed to overlap
  CITADEL_SIEGE_COST_DIAMONDS: 1,      // 1 Diamond to challenge an enemy Citadel
  CITADEL_CONQUEST_BOUNTY_EB: 5,       // +5 EB bonus for dethroning a defender
  CITADEL_EVOLUTION_MS: 10 * 60 * 1000, // 10 Minutes Evolution Timer
  CITADEL_RARITIES: {
    common:    { key: "common",    label: "Common Hold",    color: "#ff6b81", diamondHours: 3,   ebChance: 0.15, ebAmount: 1, weight: 50 },
    rare:      { key: "rare",      label: "Rare Hold",      color: "#ff1744", diamondHours: 2,   ebChance: 0.25, ebAmount: 2, weight: 30 }, // 🔴 Crimson Red (was #4fd6c4)
    epic:      { key: "epic",      label: "Epic Hold",      color: "#b30021", diamondHours: 1.5, ebChance: 0.40, ebAmount: 3, weight: 15 }, // 🔴 Deep Ruby
    legendary: { key: "legendary", label: "Legendary Hold", color: "#f0d38a", diamondHours: 1,   ebChance: 0.60, ebAmount: 5, weight: 5  }, // 🟡 Legendary Gold
  },
  // Upgrade Forge Progression (Balanced: Diamonds as an Active Walking Sink)
  CITADEL_UPGRADE_COSTS: {
    common: { next: "rare",      eb: 50,  diamonds: 100,  cashRequired: 0.50, nextLabel: "Rare Hold",      nextColor: "#4fd6c4" },
    rare:   { next: "epic",      eb: 250, diamonds: 300, cashRequired: 0.75, nextLabel: "Epic Hold",      nextColor: "#a86ee0" },
    epic:   { next: "legendary", eb: 500, diamonds: 750, cashRequired: 1.125, nextLabel: "Legendary Hold", nextColor: "#f0d38a" },
  },

  // --- Land plots (Exact Rates & Odds) ---
  PLOT_COST_EB: 100,
  PLOT_RARITIES: [
    // REBALANCE 2026-10-08: all rates cut 50% (x0.50) to bring max payout
    // liability under ad ARPU. Server mirror: functions/index.js
    // PLOT_RARITY_RATE_MAP — the two MUST stay identical or the client's
    // displayed rate diverges from what the server credits.
    { key: "common",    label: "Common",    rate: 0.0000000004, weight: 50, color: "#64748b" }, // 50%
    { key: "rare",      label: "Rare",      rate: 0.000000001214, weight: 30, color: "#00d2ff" }, // 30% — 3C→1R ≈ +1.17%
    { key: "epic",      label: "Epic",      rate: 0.0000000036825, weight: 15, color: "#b537f2" }, // 15% — 3R→1E ≈ +1.11%
    { key: "legendary", label: "Legendary", rate: 0.000000011165, weight: 5,  color: "#ffb703" }, // 5%  — 3E→1L ≈ +1.06%
  ],

  // --- Plot Ascension Forge (3 same-rarity plots → 1 next-rarity plot) ---
  // Sacrifices are permanently destroyed; target plot upgrades in place.
  PLOT_ASCENSION: {
    common:    { next: "rare",      count: 3, eb: 50,  cashRequired: 0.25 },
    rare:      { next: "epic",      count: 3, eb: 100, cashRequired: 0.75 },
    epic:      { next: "legendary", count: 3, eb: 150, cashRequired: 1.25 },
  },

  // --- Lucky Plots (🍀 rainbow holo variant; +10% earn rate) ---
  // Rolled on Buy Land and on trade re-roll. A lucky plot's rate is its
  // rarity rate × LUCKY_RATE_MULT. The flag survives Ascension Forge.
  LUCKY: {
    RATE_MULT: 1.1,        // +10% earn rate vs a normal plot of the same rarity
    BUY_CHANCE: 0.005,     // 0.5% chance when purchasing land
    TRADE_CHANCE: 0.005,   // 0.5% base chance on a trade re-roll
    MAX_FRIEND_BONUS: 0.05,// +5% only at max friendship (10 hearts) → 5.5% cap
  },

  // Helper: authoritative rate for one plot (rarity key + lucky flag).
  // Lucky = rarity rate × 1.1, so a Lucky Common beats a normal Common, etc.
  plotRate(rKey, lucky) {
    const r = this.PLOT_RARITIES.find(x => x.key === rKey) || this.PLOT_RARITIES[0];
    return lucky ? r.rate * this.LUCKY.RATE_MULT : r.rate;
  },

  // --- Friendship (❤ hearts / XP) ---
  // Hearts start at 1 and one heart is added per level up, to a max of 10.
  // XP is earned by gifting and trading; thresholds scale so higher levels
  // take progressively longer. Max level grants +5% lucky trade chance.
  FRIENDSHIP: {
    MAX_HEARTS: 10,
    XP_PER_GIFT: 10,
    XP_PER_TRADE: 40,
    // Cumulative XP required to REACH each heart count (index = hearts-1).
    // Level 1 = 0 XP; each step needs more XP than the last.
    LEVEL_XP: [0, 60, 180, 400, 750, 1250, 1950, 2900, 4150, 5750],
  },

  // Helper: current hearts (level) from total friendship XP.
  friendshipHearts(xp) {
    const t = this.FRIENDSHIP.LEVEL_XP;
    let hearts = 1;
    for (let i = 0; i < t.length; i++) {
      if (Number(xp) >= t[i]) hearts = i + 1;
    }
    return Math.min(hearts, this.FRIENDSHIP.MAX_HEARTS);
  },

  // Helper: XP still needed for the next heart (0 at max).
  friendshipXpToNext(xp) {
    const f = this.FRIENDSHIP;
    const hearts = this.friendshipHearts(xp);
    if (hearts >= f.MAX_HEARTS) return 0;
    return Math.max(0, f.LEVEL_XP[hearts] - Number(xp || 0));
  },

  // --- Global Event Engine (Global Challenge) ---
  // Live now (surprise Sat start, 3 days). Future rounds: Mon–Wed weekly.
  GLOBAL_EVENT: {
    id: "global_challenge",
    title: "Global Challenge",
    subtitle: "Spin the Wheel — help the Realm hit the goal!",
    goal: 20000,
    rewardPoolEB: 20000,
    durationMs: 3 * 24 * 60 * 60 * 1000, // 3 days (Mon–Wed for future weeks)
    top10: {
      rank1:  { legendary: 2, epic: 3, rare: 10 },
      rank2plus: { legendary: 1, epic: 3 },
    },
  },

  // --- Withdrawal Limits ---
  WITHDRAWAL: {
    minUsd: 5.00,
    maxUsd: 1000.00,
    weeklyLimitUsd: 5.00,
    minAccountAgeDays: 30,
    cooldownHours: 48,
  },

  // --- Regional Compliance (Server-Authoritative) ---
  // Players from these ISO 3166-1 alpha-2 country codes are BLOCKED from:
  // 1. Playing the game (login/registration blocked)
  // 2. Cashout withdrawals (withdrawal requests rejected)
  // Source: OFAC sanctions, GDPR/e-Privacy, US state gambling laws, PayPal availability
  RESTRICTED_COUNTRIES: [
    // US Sanctions (OFAC)
    "IR", // Iran
    "KP", // North Korea
    "SY", // Syria
    "CU", // Cuba
    "RU", // Russia (sanctions)
    "BY", // Belarus
    // EU / GDPR / e-Privacy / strict gambling
    "CN", // China
    "HK", // Hong Kong
    "MO", // Macau
    // Strict gambling / money transmission
    "WA", // Washington State (US - strict online gambling laws)
    "NY", // New York (sweepstakes registration required)
    "FL", // Florida (strict sweepstakes laws)
    // Additional high-risk / sanctions
    "BY", // Belarus
    "MM", // Myanmar
    "VE", // Venezuela
    "YE", // Yemen
    "ZW", // Zimbabwe
    // PayPal unavailable / restricted
    "AF", // Afghanistan
    "CD", // Congo (DRC)
    "CF", // Central African Republic
    "GN", // Guinea
    "GN", // Guinea-Bissau
    "HT", // Haiti
    "IQ", // Iraq
    "LB", // Lebanon
    "LY", // Libya
    "SD", // Sudan
    "SO", // Somalia
    "SS", // South Sudan
  ],

  // US States where cashout is restricted (internal codes, not ISO)
  RESTRICTED_US_STATES: [
    "WA", // Washington - strict online gambling
    "NY", // New York - sweepstakes registration
    "FL", // Florida - sweepstakes laws
    "MD", // Maryland - strict gambling
    "NJ", // New Jersey - regulated only
    "NV", // Nevada - regulated only
    "PA", // Pennsylvania - regulated only
  ],

  
  // --- Elden Stops (Dyson Disc Beacons) ---
  ELDEN_STOP_GROWTH_MS: 30 * 60 * 1000,         // 30-minute construction phase before spin-ready
  ELDEN_STOP_COOLDOWN_MS: 15 * 60 * 1000,        // 15-minute PokéStop-style recharge
  ELDEN_STOP_SPIN_RADIUS_METERS: 75,             // Must walk within 75m to spin
  ELDEN_STOP_VISIBILITY_METERS: 1500,            // Beacon culling range on the map
  ELDEN_STOP_DIAMOND_RANGE: [1, 20],             // Diamonds per spin (informational)
  ELDEN_STOP_EB_RANGE: [0, 5],                   // EB per spin (informational)
  ELDEN_STOP_PLOT_JACKPOT_CHANCE: 0.015,         // 1.5% Lucky Land Plot drop
  ELDEN_STOP_BASE_ZOOM: 18,                      // Reference zoom where beacon screen-scale = 1.0
  ELDEN_STOP_MIN_SCALE: 0.28,                    // Floor scale when zoomed out (before full cull)
  ELDEN_STOP_MAX_SCALE: 0.75,                    // Ceiling scale when zoomed in

  // --- Map LOD / Far-Zoom Culling (phone GPU heat relief) ---
  // Below this zoom, ALL decorative 3D/DOM game objects are destroyed/hidden.
  // Only the landplot tile polygons (plots-fill / plots-line / plots-grass-base) remain.
  MAP_CULL_MIN_ZOOM: 14,

  // --- 3D Character Roster (Heroic Scale) ---
  AVAILABLE_CHARACTERS: [
    { id: "soldier",   name: "Vanguard Soldier", file: "models/Soldier.glb",   scale: 3.2, icon: "🛡️" },
    { id: "xbot",      name: "X-Operative",      file: "models/Xbot.glb",      scale: 2.8, icon: "🦾" },
    { id: "fox",       name: "Spirit Fox",       file: "models/Fox.glb",       scale: 0.06, icon: "🦊" },
    { id: "cesium",    name: "Cesium Runner",    file: "models/CesiumMan.glb", scale: 3.4, icon: "🏃" },
  ],

  // --- 30-Day Daily Login Calendar ---
  // Base 3 EB daily, scaling on Day 2 & every 5th day up to Day 30 (200 EB Jackpot)
  // 90-day login ladder. MUST match DAILY_REWARDS in functions/index.js exactly
  // — the server pays out from its copy and the UI renders from this one, so a
  // drift here shows players one reward and pays another. Edit both together.
  DAILY_CALENDAR_REWARDS: [
    { day: 1,  eb: 3   },
    { day: 2,  eb: 5   },
    { day: 3,  eb: 3   },
    { day: 4,  eb: 3   },
    { day: 5,  eb: 10  },
    { day: 6,  eb: 3   },
    { day: 7,  eb: 12, diamonds: 75 },
    { day: 8,  eb: 3   },
    { day: 9,  eb: 3   },
    { day: 10, eb: 20  },
    { day: 11, eb: 3   },
    { day: 12, eb: 3   },
    { day: 13, eb: 3   },
    { day: 14, eb: 3   },
    { day: 15, eb: 35, diamonds: 75 },
    { day: 16, eb: 3   },
    { day: 17, eb: 3   },
    { day: 18, eb: 3   },
    { day: 19, eb: 3   },
    { day: 20, eb: 50, diamonds: 75 },
    { day: 21, eb: 3   },
    { day: 22, eb: 3   },
    { day: 23, eb: 3   },
    { day: 24, eb: 3   },
    { day: 25, eb: 75, diamonds: 75 },
    { day: 26, eb: 3   },
    { day: 27, eb: 3   },
    { day: 28, eb: 3   },
    { day: 29, eb: 3   },
    { day: 30, eb: 200, diamonds: 100 },
    { day: 31, eb: 3   },
    { day: 32, eb: 6   },
    { day: 33, eb: 3   },
    { day: 34, eb: 3   },
    { day: 35, eb: 12  },
    { day: 36, eb: 3   },
    { day: 37, eb: 15, diamonds: 75 },
    { day: 38, eb: 3   },
    { day: 39, eb: 3   },
    { day: 40, eb: 25  },
    { day: 41, eb: 3   },
    { day: 42, eb: 3   },
    { day: 43, eb: 3   },
    { day: 44, eb: 3   },
    { day: 45, eb: 42, diamonds: 100 },
    { day: 46, eb: 3   },
    { day: 47, eb: 3   },
    { day: 48, eb: 3   },
    { day: 49, eb: 3   },
    { day: 50, eb: 60, diamonds: 100 },
    { day: 51, eb: 3   },
    { day: 52, eb: 3   },
    { day: 53, eb: 3   },
    { day: 54, eb: 3   },
    { day: 55, eb: 90, diamonds: 100 },
    { day: 56, eb: 3   },
    { day: 57, eb: 3   },
    { day: 58, eb: 3   },
    { day: 59, eb: 3   },
    { day: 60, eb: 150, diamonds: 250 },
    { day: 61, eb: 3   },
    { day: 62, eb: 6   },
    { day: 63, eb: 3   },
    { day: 64, eb: 3   },
    { day: 65, eb: 12  },
    { day: 66, eb: 3   },
    { day: 67, eb: 15, diamonds: 100 },
    { day: 68, eb: 3   },
    { day: 69, eb: 3   },
    { day: 70, eb: 25  },
    { day: 71, eb: 3   },
    { day: 72, eb: 3   },
    { day: 73, eb: 3   },
    { day: 74, eb: 3   },
    { day: 75, eb: 45, diamonds: 125 },
    { day: 76, eb: 3   },
    { day: 77, eb: 3   },
    { day: 78, eb: 3   },
    { day: 79, eb: 3   },
    { day: 80, eb: 70, diamonds: 125 },
    { day: 81, eb: 3   },
    { day: 82, eb: 3   },
    { day: 83, eb: 3   },
    { day: 84, eb: 3   },
    { day: 85, eb: 110, diamonds: 150 },
    { day: 86, eb: 3   },
    { day: 87, eb: 3   },
    { day: 88, eb: 3   },
    { day: 89, eb: 3   },
    { day: 90, eb: 250, diamonds: 400 },
  ],
};