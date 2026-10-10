// ============================================================
// Elden Earth — Territory-Scoped Leaderboards (Multi-Language & Global)
// ============================================================
const Leaderboard = (() => {
  let modal = null;
  let currentScope = "global"; // "global" | "country" | "state" | "city"
  let currentTab = "plots";    // "plots" | "rent"
  let cachedData = null;
  let lastFetchTime = 0;
  const CACHE_TTL_MS = 60000;

  // Player names / badges / avatar URLs come from Firestore player documents,
  // so they are untrusted. Escape before any innerHTML interpolation.
  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  // Universal Flag Calculator: Converts any ISO country code ("JP", "FR", "US", "BR") into its Flag Emoji!
  function getFlagEmoji(countryCode) {
    if (!countryCode || countryCode.length !== 2) return "🌐";
    const codePoints = countryCode
      .toUpperCase()
      .split("")
      .map(char => 127397 + char.charCodeAt(0));
    return String.fromCodePoint(...codePoints);
  }

  // Universal Territory Key Cleaner: strips flag emoji/whitespace/case so the same
  // real-world place always produces the same lookup key, regardless of whether one
  // copy of the string has a trailing flag emoji (or different casing) and another doesn't.
  function cleanTerritoryKey(str) {
    if (!str) return "unknown";
    return str.replace(/[\u{1F1E6}-\u{1F1FF}\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\uFE0F]/gu, "").trim().toLowerCase();
  }

  // True when a territory label is pure English/Latin (after stripping flags).
  // Local-script names (上海市, Москва) return false so dual titles can collapse
  // to the English badge while fixTerritoryNames backfills the plot docs.
  function looksEnglishTerritory(str) {
    const s = String(str || "")
      .replace(/[\u{1F1E6}-\u{1F1FF}\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\uFE0F]/gu, "")
      .trim();
    if (!s) return false;
    return /^[\u0020-\u007E\u00A0-\u024F]+$/.test(s);
  }

  // Collapse a player's same-scope badges down to English-only when both a
  // local-script and an English label exist (duplicate governor/mayor titles).
  function preferEnglishBadges(badges) {
    const fixed = [];
    const byScope = { country: [], state: [], city: [] };
    const passthrough = [];
    for (const b of badges) {
      if (b && (b.scope === "country" || b.scope === "state" || b.scope === "city")) {
        byScope[b.scope].push(b);
      } else {
        passthrough.push(b);
      }
    }
    fixed.push(...passthrough);
    for (const scope of ["country", "state", "city"]) {
      const group = byScope[scope];
      if (group.length <= 1) {
        fixed.push(...group);
        continue;
      }
      const english = group.filter((b) => looksEnglishTerritory(b.territory || b.title));
      // Keep every English badge for this scope; drop local-script duplicates
      // only when at least one English variant is present for the same player.
      fixed.push(...(english.length ? english : group));
    }
    return fixed;
  }

  // Exact then clean-key lookup so "SHANGHAI 🇨" and "Shanghai" resolve
  // to the same ruler even before fixTerritoryNames finishes backfill.
  function lookupRuler(map, name) {
    if (!map || !name) return null;
    if (map[name]) return map[name];
    const key = cleanTerritoryKey(name);
    for (const place in map) {
      if (cleanTerritoryKey(place) === key) return map[place];
    }
    return null;
  }

  // Universal Multi-Language Country Normalizer (Supports all 195+ Countries automatically in English!)
  function normalizeCountry(rawCountry, cityStr) {
    const c = (rawCountry || "").toLowerCase().trim();
    const ci = (cityStr || "").toLowerCase().trim();

    // ⛔ FIRST: North Korea excluded from all titles/presidencies — must run
    // before the flag-emoji fallback so 🇰🇵 never resolves to a title.
    if (c.includes("north korea") || c.includes("dprk") || c.includes("corée du nord") || c === "kp" || c.includes("조선") || c.includes("🇰🇵") || ci.includes("🇰🇵")) {
      return "⛔ Restricted Territory";
    }

    // 1. South Africa (Checked FIRST so 'Africa' never collides with 'fr'!)
    if (c.includes("south africa") || c.includes("afrique du sud") || c.includes("südafrika") || ci.includes("🇿🇦") || ci.includes("eastern cape") || ci.includes("kouga")) {
      return "South Africa 🇿🇦";
    }
    // 2. United States (All multi-language translations)
    if (c.includes("united states") || c.includes("usa") || c.includes("états-unis") || c.includes("etats-unis") || c.includes("estados unidos") || c.includes("vereinigte staaten") || c === "us" || ci.includes("🇺🇸")) {
      return "United States 🇺🇸";
    }
    // 3. United Kingdom / Great Britain / England
    if (c.includes("united kingdom") || c.includes("great britain") || c.includes("england") || c.includes("scotland") || c.includes("wales") || c.includes("grande-bretagne") || c === "uk" || ci.includes("🇬🇧")) {
      return "United Kingdom 🇬🇧";
    }
    // 4. France
    if (c.includes("france") || c === "fr" || ci.includes("🇫🇷")) {
      return "France 🇫🇷";
    }
    // 5. Germany
    if (c.includes("germany") || c.includes("deutschland") || c.includes("allemagne") || c === "de" || ci.includes("🇩🇪")) {
      return "Germany 🇩🇪";
    }
    // 6. Canada
    if (c.includes("canada") || c === "ca" || ci.includes("🇨🇦") || ci.includes("nanaimo") || ci.includes("bc")) {
      return "Canada 🇨🇦";
    }
    // 7. Spain
    if (c.includes("spain") || c.includes("españa") || c.includes("espagne") || c === "es" || ci.includes("🇪🇸")) {
      return "Spain 🇪🇸";
    }
    // 8. Australia
    if (c.includes("australia") || c.includes("australie") || c === "au" || ci.includes("🇦🇺")) {
      return "Australia 🇦🇺";
    }
    // 9. Puerto Rico
    if (c.includes("puerto rico") || c === "pr" || ci.includes("🇵🇷") || ci.includes("san juan")) {
      return "Puerto Rico 🇵🇷";
    }
    // 10. South Korea (checked BEFORE North Korea to avoid "korea" collision)
    if (c.includes("south korea") || c.includes("republic of korea") || c === "kr" || ci.includes("🇰🇷") || ci.includes("seoul") || ci.includes("busan")) {
      return "South Korea 🇰🇷";
    }

    // 11. Automatic 249-Country Fallback using Unicode Flag Math & Intl English
    if (rawCountry && rawCountry.length === 2) {
      try {
        const enName = new Intl.DisplayNames(["en"], { type: "region" }).of(rawCountry.toUpperCase());
        return `${enName} ${getFlagEmoji(rawCountry)}`;
      } catch (e) {}
    }

    // 12. 🌐 Universal flag-emoji fallback: stored country values are always
    // "LocalName + flag" (never a bare ISO code). The flag is language-
    // independent — derive the ISO code from it and resolve the English name
    // so ANY country in ANY language (中国 🇨🇳, 日本 🇯🇵, Brasil 🇧🇷…)
    // resolves to one canonical English label for president/title grouping.
    const flagSource =
      (rawCountry || "").match(/[\u{1F1E6}-\u{1F1FF}]{2}/u) ||
      (cityStr || "").match(/[\u{1F1E6}-\u{1F1FF}]{2}/u);
    if (flagSource) {
      // Iterate by code point — split("") breaks surrogate pairs in flag emoji.
      const cc = [...flagSource[0]]
        .map((ch) => String.fromCharCode(ch.codePointAt(0) - 0x1f1e6 + 65))
        .join("");
      try {
        const enName = new Intl.DisplayNames(["en"], { type: "region" }).of(cc);
        if (enName) return `${enName} ${getFlagEmoji(cc)}`;
      } catch (e) {}
    }

    return "";
  }

  // Universal State Normalizer
  // ================= MAYOR-RACE ELIGIBILITY =================
  // A plot may sit in any place Nominatim resolves, but only a real CITY or
  // TOWN may run a mayor race. Boroughs, townships, villages, counties and
  // other sub-municipal units stay display-only territory: without this, one
  // landlord collects a crown per tiny adjacent borough and out-mayors whole
  // real cities (all 17 PA borough/township territories are held by a single
  // player).
  const NON_CITY_TOWN_SUFFIX =
    /(township|borough|municipality|village|hamlet|precinct|county|cdp|census-designated place|neighbourhood|neighborhood)$/i;

  // Pennsylvania has exactly three municipal classes — cities, boroughs and
  // townships — and no incorporated "towns". PA boroughs also drop the word
  // "Borough" from everyday use (Carnegie, Dormont, Castle Shannon, Rosslyn
  // Farms…), so no suffix rule can ever catch them. Only PA's 56 cities may
  // hold a mayorship. Source: List of cities in Pennsylvania (Wikipedia).
  const PA_CITIES = new Set([
    "Aliquippa", "Allentown", "Altoona", "Arnold", "Beaver Falls", "Bethlehem",
    "Bradford", "Butler", "Carbondale", "Chester", "Clairton", "Coatesville",
    "Connellsville", "Corry", "DuBois", "Duquesne", "Easton", "Erie", "Farrell",
    "Franklin", "Greensburg", "Harrisburg", "Hazleton", "Hermitage", "Jeannette",
    "Johnstown", "Lancaster", "Lebanon", "Lock Haven", "Lower Burrell",
    "McKeesport", "Meadville", "Monessen", "Monongahela", "Nanticoke",
    "New Castle", "New Kensington", "Oil City", "Parker", "Philadelphia",
    "Pittsburgh", "Pittston", "Pottsville", "Reading", "St. Marys", "Saint Marys", "Scranton",
    "Shamokin", "Sharon", "Sunbury", "Titusville", "Uniontown", "Warren",
    "Washington", "Wilkes-Barre", "Williamsport", "York",
  ].map(n => n.replace(/[^a-z0-9]/gi, "").toLowerCase()));

  // rawCity looks like "Castle Shannon, PA 🇺🇸" / "Pittsburgh, PA 🇺🇸" /
  // "Halle (Saale), Saxony-Anhalt 🇩🇪" — the place name is everything before
  // the first comma, the state code the first token after it.
  function isCityOrTown(rawCity) {
    const label = String(rawCity || "").split(",")[0].trim();
    if (!label || label === "Unknown City") return false;
    if (NON_CITY_TOWN_SUFFIX.test(label)) return false;
    const stateSeg = String(rawCity).split(",")[1] || "";
    const stateCode = ((stateSeg.trim().match(/^[A-Za-z]{2}/) || [""])[0]).toUpperCase();
    if (stateCode === "PA" && !PA_CITIES.has(label.replace(/[^a-z0-9]/gi, "").toLowerCase())) return false;
    return true;
  }

  function normalizeState(rawState, cityStr) {
    const s = (rawState || "").toLowerCase();
    const ci = (cityStr || "").toLowerCase();

    // US-state mapping only applies to US territories — prevents Seoul 🇰🇷 → Arizona 🇺🇸
    const isUS = (rawState || "").includes("🇺🇸") || (cityStr || "").includes("🇺🇸");
    if (isUS) {
      if (s.includes("ohio") || ci.includes(", oh")) return "Ohio 🇺🇸";
      if (s.includes("arizona") || ci.includes(", az") || ci.includes("phoenix") || ci.includes("scottsdale")) return "Arizona 🇺🇸";
      if (s.includes("connecticut") || ci.includes(", ct") || ci.includes("torrington")) return "Connecticut 🇺🇸";
      if (s.includes("washington") || ci.includes(", wa") || ci.includes("spokane")) return "Washington 🇺🇸";
      if (s.includes("indiana") || ci.includes(", in")) return "Indiana 🇺🇸";
      if (s.includes("illinois") || ci.includes(", il")) return "Illinois 🇺🇸";
    }

    if (s.includes("british columbia") || ci.includes("bc") && ci.includes("🇨🇦")) return "British Columbia 🇨🇦";
    if (s.includes("puerto rico") || ci.includes(", pr") || s.includes("🇵🇷")) return "Puerto Rico 🇵🇷";

    return rawState || "";
  }

  function calculatePreciseLifetimeRent(playerId, playerDoc, allPlots) {
    const now = Date.now();
    const playerPlots = {};

    for (const tid in allPlots) {
      if (allPlots[tid].ownerId === playerId) playerPlots[tid] = allPlots[tid];
    }
    for (const tid in (playerDoc.plots || {})) {
      const plot = playerDoc.plots[tid];
      if (!plot.ownerId || plot.ownerId === playerId) playerPlots[tid] = plot;
    }

    let totalRent = 0;
    for (const tid in playerPlots) {
      const plot = playerPlots[tid];
      let claimedTime = Number(plot.claimedAt || playerDoc.createdAt || now);
      // Normalize legacy seconds-unit timestamps to milliseconds
      if (claimedTime > 0 && claimedTime < 1e11) claimedTime *= 1000;
      if (!claimedTime || claimedTime > now) claimedTime = now;
      const ageSec = Math.max(0, (now - claimedTime) / 1000);
      const rarityKey = plot.rarity?.key || plot.rarity || "common";
      // 🍀 Lucky plots accrue ×1.1 rent over their lifetime.
      totalRent += ageSec * CONFIG.plotRate(rarityKey, plot.lucky === true);
    }

    // Players with plots get true passive rent computed from plot ages —
    // immune to stale/inflated stored values. Players without plots fall
    // back to their stored lifetime rent (e.g. all plots bagged).
    const stored = Number(playerDoc.lifetimeRent || playerDoc.cash || 0);
    const storedCash = Number(playerDoc.lifetimeRent || playerDoc.cash || 0);
  return Math.max(totalRent, storedCash);
  }

  function invalidateCache() {
    cachedData = null;
    lastFetchTime = 0;
  }

  function invalidateLiveTerritory() {
    _liveTerritoryCache = null;
    _liveTerritoryLat = 0;
    _liveTerritoryLon = 0;
  }

  async function fetchRankings(forceRefresh = false) {
    const now = Date.now();
    if (!forceRefresh && cachedData && (now - lastFetchTime < CACHE_TTL_MS)) {
      return cachedData;
    }

    const allPlots = (typeof Grid !== "undefined" && Grid.getAllPlots) ? Grid.getAllPlots() : {};
    const state = Store.get();
    const db = Store.getDb();

    const playerStats = {};
    const cityCounts = {};
    const stateCounts = {};
    const countryCounts = {};
    const playerRateMap = {};

    if (state.player?.id) {
      playerStats[state.player.id] = {
        id: state.player.id,
        name: state.player.name || "Traveler",
        avatar: state.player.avatar || "🙂",
        plotsCount: Object.keys(state.plots || {}).length,
        cash: Number(state.cash) || 0,
        lifetimeRent: Number(state.lifetimeRent || state.cash) || 0,
        cities: {}, states: {}, countries: {},
        citiesClean: {}, statesClean: {}, countriesClean: {}
      };
    }

    const uniquePlots = {};

    // 1-Pass Optimization: Aggregates plots, cities, AND rates simultaneously with ZERO hardcoded Phoenix defaults!
    for (const tid in allPlots) {
      const p = allPlots[tid];
      const oid = p.ownerId || "unknown";

      const rKey = p.rarity?.key || p.rarity || "common";
      // 🍀 Lucky plots contribute ×1.1 to a player's displayed rate.
      const pRate = CONFIG.plotRate(rKey, p.lucky === true);
      playerRateMap[oid] = (playerRateMap[oid] || 0) + pRate;

      if (!playerStats[oid]) {
        playerStats[oid] = {
          id: oid,
          name: p.ownerName || "Traveler",
          avatar: p.avatar || "🙂",
          plotsCount: 0,
          cash: 0,
          lifetimeRent: 0,
          cities: {},
          states: {},
          countries: {},
          citiesClean: {},
          statesClean: {},
          countriesClean: {}
        };
      }

      const plotKey = (p.tx !== undefined && p.ty !== undefined) ? `${p.tx}_${p.ty}` : tid;
      if (!uniquePlots[oid]) uniquePlots[oid] = new Set();
      uniquePlots[oid].add(plotKey);

      // Clean, un-defaulted City resolution
      let rawCity = p.city || "";
      if (rawCity.includes("Phoenix, AR")) rawCity = "Phoenix, AZ 🇺🇸";
      if (rawCity.includes("Nanaimo, British Columbia")) rawCity = "Nanaimo, BC 🇨🇦";

      // Universal Multi-Language State & Country Derivation
      const stateName = normalizeState(p.state, rawCity);
      const country = normalizeCountry(p.country, rawCity);

      // Skip invalid/unknown territories for mayorship/governor/president calculations
      const isUnknownCity = !rawCity || rawCity === "Unknown City" || rawCity.match(/^\d+[\.\d]*[NS]\s/);
      const isUnknownState = !stateName || stateName === "Unknown State";
      const isUnknownCountry = !country || country === "Unknown" || country.includes("International Realm") || country.includes("Unknown");

      if (!isUnknownCity) {
        playerStats[oid].cities[rawCity] = (playerStats[oid].cities[rawCity] || 0) + 1;
        const cityKey = cleanTerritoryKey(rawCity);
        playerStats[oid].citiesClean[cityKey] = (playerStats[oid].citiesClean[cityKey] || 0) + 1;
        // Boroughs/townships/villages remain in the player's territory list but
        // never enter the mayor race — no race, no crown, no royalty stack, and
        // awardTerritoryDividends finds no ruler to pay.
        if (isCityOrTown(rawCity)) {
          cityCounts[rawCity] = cityCounts[rawCity] || {};
          cityCounts[rawCity][oid] = (cityCounts[rawCity][oid] || 0) + 1;
        }
      }
      if (!isUnknownState) {
        playerStats[oid].states[stateName] = (playerStats[oid].states[stateName] || 0) + 1;
        const stateKey = cleanTerritoryKey(stateName);
        playerStats[oid].statesClean[stateKey] = (playerStats[oid].statesClean[stateKey] || 0) + 1;
        stateCounts[stateName] = stateCounts[stateName] || {};
        stateCounts[stateName][oid] = (stateCounts[stateName][oid] || 0) + 1;
      }
      if (!isUnknownCountry) {
        playerStats[oid].countries[country] = (playerStats[oid].countries[country] || 0) + 1;
        const countryKey = cleanTerritoryKey(country);
        playerStats[oid].countriesClean[countryKey] = (playerStats[oid].countriesClean[countryKey] || 0) + 1;
        countryCounts[country] = countryCounts[country] || {};
        countryCounts[country][oid] = (countryCounts[country][oid] || 0) + 1;
      }
    }

    if (state.player?.id && !playerStats[state.player.id]) {
      playerStats[state.player.id] = {
        id: state.player.id,
        name: state.player.name || "Traveler",
        avatar: state.player.avatar || "🙂",
        plotsCount: Object.keys(state.plots || {}).length,
        cash: state.cash || 0,
        cities: {}, states: {}, countries: {},
        citiesClean: {}, statesClean: {}, countriesClean: {}
      };
    }

    // Helper to pick top ruler with Passive Rent tie-breaker
    function pickTopRuler(countsObj) {
      const results = {};
      for (const place in countsObj) {
        let maxPlots = 0;
        let topOid = null;
        let topCash = -1;

        for (const oid in countsObj[place]) {
          const pCount = countsObj[place][oid];
          const pCash = Number(playerStats[oid]?.cash) || 0;

          if (pCount > maxPlots || (pCount === maxPlots && pCash > topCash)) {
            maxPlots = pCount;
            topOid = oid;
            topCash = pCash;
          }
        }
        if (topOid) {
          results[place] = { ownerId: topOid, plots: maxPlots, name: playerStats[topOid]?.name, place };
        }
      }
      return results;
    }

    const mayorsMap = pickTopRuler(cityCounts);
    const governorsMap = pickTopRuler(stateCounts);
    const presidentsMap = pickTopRuler(countryCounts);

    for (const oid in uniquePlots) {
      if (playerStats[oid]) {
        playerStats[oid].plotsCount = uniquePlots[oid].size;
      }
    }

    // Sort Global with Highest Passive Rent Tie-Breaker (Descending)
    const sortedGlobal = Object.values(playerStats).sort((a, b) => {
      const plotDiff = (b.plotsCount || 0) - (a.plotsCount || 0);
      if (plotDiff !== 0) return plotDiff;
      return (Number(b.lifetimeRent || b.cash) || 0) - (Number(a.lifetimeRent || a.cash) || 0);
    });
    const globalLordId = sortedGlobal.length > 0 ? sortedGlobal[0].id : null;

    for (const oid in playerStats) {
      const p = playerStats[oid];
      p.titles = [];
      p.badges = [];

      // #1 Global Player is Lord of the Elden Realm
      if (oid === globalLordId && p.plotsCount > 0) {
        p.badges.push({ title: "Lord of the Elden Realm", icon: "⚔️", scope: "global" });
      }

      for (const co in presidentsMap) {
        if (presidentsMap[co].ownerId === oid) {
          p.badges.push({ title: `President of ${co}`, icon: "🦅", scope: "country", territory: co });
          p.titles.push(`President of ${co}`);
        }
      }
      for (const st in governorsMap) {
        if (governorsMap[st].ownerId === oid) {
          p.badges.push({ title: `Governor of ${st}`, icon: "🏛️", scope: "state", territory: st });
          p.titles.push(`Governor of ${st}`);
        }
      }
      for (const city in mayorsMap) {
        if (mayorsMap[city].ownerId === oid) {
          p.badges.push({ title: `Mayor of ${city}`, icon: "👑", scope: "city", territory: city });
          p.titles.push(`Mayor of ${city}`);
        }
      }

      // Only English governor/mayor/president titles when a player somehow
      // tops both a local-language and an English group for the same scope.
      p.badges = preferEnglishBadges(p.badges);
      p.titles = p.badges
        .filter((b) => b.scope === "country" || b.scope === "state" || b.scope === "city")
        .map((b) => b.title);

      if (p.badges.length === 0) {
        p.badges.push({ title: "Citizen of the Realm", icon: "🛡️", scope: "realm" });
      }
    }

    const playerArray = Object.values(playerStats);
    const savedPlayers = {};
    if (db) {
      try {
        const snap = await db.collection("saves").limit(50).get();

        snap.forEach(doc => {
          const d = doc.data();
          savedPlayers[doc.id] = d;
          const target = playerArray.find(p => p.id === doc.id);

          let finalLifetime = calculatePreciseLifetimeRent(doc.id, d, allPlots);

          if (target) {
            target.cash = Number(d.cash) || 0;
            target.lifetimeRent = Math.max(Number(d.cash) || 0, finalLifetime);
            target.totalDividends = Number(d.totalDividends) || 0;
            target.plots = d.plots || {};
          } else if (d.player) {
            playerArray.push({
              id: doc.id,
              name: d.player.name || "Traveler",
              avatar: d.player.avatar || "🙂",
              plotsCount: Object.keys(d.plots || {}).length,
              cash: Number(d.cash) || 0,
              lifetimeRent: Math.max(Number(d.cash) || 0, finalLifetime),
              totalDividends: Number(d.totalDividends) || 0,
              plots: d.plots || {},
              cities: {}, states: {}, countries: {},
              citiesClean: {}, statesClean: {}, countriesClean: {}
            });
          }
        });
      } catch (e) {
        console.warn("[Leaderboard] Saves query notice:", e);
      }
    }

    for (const player of playerArray) {
      const playerDoc = savedPlayers[player.id] || {
        cash: player.cash,
        lifetimeRent: player.lifetimeRent,
        plots: player.plots
      };
      player.lifetimeRent = calculatePreciseLifetimeRent(player.id, playerDoc, allPlots);
    }

    const me = playerArray.find(p => p.id === state.player?.id);
    if (me) {
      me.cash = Math.max(Number(me.cash) || 0, Number(state.cash) || 0);
    }

    cachedData = { players: playerArray, mayorsMap, governorsMap, presidentsMap };
    lastFetchTime = Date.now();
    return cachedData;
  }

  // Live GPS territory cache — avoids re-calling Nominatim on every render
  let _liveTerritoryCache = null;
  let _liveTerritoryLat = 0;
  let _liveTerritoryLon = 0;
  const LIVE_TERRITORY_MIN_MOVE = 200; // re-resolve after 200m movement

  // Determine local player's primary territory scopes using live GPS position.
  // Falls back to plot-based detection if GPS is unavailable.
  function getPlayerLocalTerritory() {
    // Try live GPS first
    const pos = (typeof Grid !== "undefined" && Grid.getPlayerPosition)
      ? Grid.getPlayerPosition()
      : (typeof window !== "undefined" && window.getPlayerPosition ? window.getPlayerPosition() : null);

    if (pos && pos.lat && pos.lon) {
      // Only re-resolve if player moved significantly (avoid Nominatim thrash)
      if (_liveTerritoryCache && typeof Geo !== "undefined" && Geo.haversine) {
        const dist = Geo.haversine(_liveTerritoryLat, _liveTerritoryLon, pos.lat, pos.lon);
        if (dist < LIVE_TERRITORY_MIN_MOVE) {
          return _liveTerritoryCache;
        }
      }

      // Resolve territory from live GPS (Geo.getTerritoryInfo is async but cached)
      if (typeof Geo !== "undefined" && Geo.getTerritoryInfo) {
        // Use cached territory from Geo module (it has its own internal cache)
        const geoResult = Geo.getTerritoryInfo(pos.lat, pos.lon);
        // Handle both sync (cached) and async (fresh fetch) results
        if (geoResult && typeof geoResult.then === "function") {
          // Async — return last known while waiting, trigger refresh after
          geoResult.then(info => {
            if (info) {
              _liveTerritoryCache = buildTerritoryResult(info.city, info.state, info.country);
              _liveTerritoryLat = pos.lat;
              _liveTerritoryLon = pos.lon;
            }
          }).catch(() => {});
          if (_liveTerritoryCache) return _liveTerritoryCache;
        } else if (geoResult) {
          // Sync (already cached in Geo module)
          _liveTerritoryCache = buildTerritoryResult(geoResult.city, geoResult.state, geoResult.country);
          _liveTerritoryLat = pos.lat;
          _liveTerritoryLon = pos.lon;
          return _liveTerritoryCache;
        }
      }
    }

    // Fallback: use player's first plot location (legacy behavior)
    return getPlotBasedTerritory();
  }

  function buildTerritoryResult(city, state, country) {
    const normalizedState = normalizeState(state, city);
    const normalizedCountry = normalizeCountry(country, city);
    return {
      city: city || "Local City",
      state: normalizedState || "Local State",
      country: normalizedCountry || "United States 🇺🇸",
      cityKey: cleanTerritoryKey(city),
      stateKey: cleanTerritoryKey(normalizedState),
      countryKey: cleanTerritoryKey(normalizedCountry),
    };
  }

  function getPlotBasedTerritory() {
    const state = Store.get();
    const myId = state.player?.id;
    const allPlots = (typeof Grid !== "undefined" && Grid.getAllPlots) ? Grid.getAllPlots() : {};

    let myCity = "Local City";
    let myState = "Local State";
    let myCountry = "United States 🇺🇸";

    for (const tid in allPlots) {
      const p = allPlots[tid];
      if (p.ownerId === myId) {
        if (p.city) myCity = p.city;
        if (p.state) myState = normalizeState(p.state, p.city);
        if (p.country) myCountry = normalizeCountry(p.country, p.city);
        break;
      }
    }
    return {
      city: myCity, state: myState, country: myCountry,
      cityKey: cleanTerritoryKey(myCity),
      stateKey: cleanTerritoryKey(myState),
      countryKey: cleanTerritoryKey(myCountry),
    };
  }

  function render(data) {
    const listEl = document.getElementById("leaderboard-list");
    if (!listEl || !data || document.hidden) return;

    const modalEl = document.getElementById("leaderboard-modal");
    if (modalEl && modalEl.classList.contains("hidden")) return;

    const fragment = document.createDocumentFragment();
    const state = Store.get();
    const myId = state.player?.id;
    const local = getPlayerLocalTerritory();

    let filteredPlayers = [...data.players];

    if (currentScope === "city") {
      filteredPlayers = filteredPlayers.filter(p => p.citiesClean && p.citiesClean[local.cityKey] > 0);
      filteredPlayers.sort((a, b) => {
        const diff = (b.citiesClean[local.cityKey] || 0) - (a.citiesClean[local.cityKey] || 0);
        if (diff !== 0) return diff;
        return (Number(b.lifetimeRent || b.cash) || 0) - (Number(a.lifetimeRent || a.cash) || 0);
      });
    } else if (currentScope === "state") {
      filteredPlayers = filteredPlayers.filter(p => p.statesClean && p.statesClean[local.stateKey] > 0);
      filteredPlayers.sort((a, b) => {
        const diff = (b.statesClean[local.stateKey] || 0) - (a.statesClean[local.stateKey] || 0);
        if (diff !== 0) return diff;
        return (Number(b.lifetimeRent || b.cash) || 0) - (Number(a.lifetimeRent || a.cash) || 0);
      });
    } else if (currentScope === "country") {
      filteredPlayers = filteredPlayers.filter(p => p.countriesClean && p.countriesClean[local.countryKey] > 0);
      filteredPlayers.sort((a, b) => {
        const diff = (b.countriesClean[local.countryKey] || 0) - (a.countriesClean[local.countryKey] || 0);
        if (diff !== 0) return diff;
        return (Number(b.lifetimeRent || b.cash) || 0) - (Number(a.lifetimeRent || a.cash) || 0);
      });
    } else {
      if (currentTab === "plots") {
        filteredPlayers.sort((a, b) => {
          const diff = (b.plotsCount || 0) - (a.plotsCount || 0);
          if (diff !== 0) return diff;
          return (Number(b.lifetimeRent || b.cash) || 0) - (Number(a.lifetimeRent || a.cash) || 0);
        });
      } else {
        filteredPlayers.sort((a, b) => (Number(b.lifetimeRent || b.cash) || 0) - (Number(a.lifetimeRent || a.cash) || 0));
      }
    }

    if (filteredPlayers.length === 0) {
      listEl.innerHTML = `<div class="feed-empty-msg">No landowners found in this territory yet. Claim land to take the lead!</div>`;
      return;
    }

    filteredPlayers.forEach((p, idx) => {
      const isSelf = p.id === myId;
      const rankMedal = idx === 0 ? "🥇" : idx === 1 ? "🥈" : idx === 2 ? "🥉" : `#${idx + 1}`;
      
      let displayCount = p.plotsCount;
      if (currentScope === "city") displayCount = (p.citiesClean && p.citiesClean[local.cityKey]) || 0;
      else if (currentScope === "state") displayCount = (p.statesClean && p.statesClean[local.stateKey]) || 0;
      else if (currentScope === "country") displayCount = (p.countriesClean && p.countriesClean[local.countryKey]) || 0;

      let activeBadge = p.badges ? p.badges.find(b => b.scope === currentScope) : null;
      if (!activeBadge && p.badges && p.badges.length > 0) {
        activeBadge = p.badges[0];
      }
      const badgeIcon = activeBadge ? activeBadge.icon : "🛡️";
      const badgeText = activeBadge ? activeBadge.title : "Citizen of the Realm";
      const rentDisplay = Number(p.lifetimeRent || p.cash) || 0;
      const metricVal = currentTab === "plots" ? `${escapeHtml(displayCount)} <span class="lb-unit">Plots</span>` : `$${escapeHtml(rentDisplay.toFixed(6))}`;

      const row = document.createElement("div");
      row.className = "lb-row" + (isSelf ? " self-row" : "");
      row.innerHTML = `
        <div class="lb-rank">${escapeHtml(rankMedal)}</div>
        <div class="lb-avatar">${renderAvatar(p.avatar)}</div>
        <div class="lb-info">
          <span class="lb-name">${escapeHtml(p.name)} ${isSelf ? "<em>(You)</em>" : ""}</span>
          <span class="lb-sub lb-title-glow">${escapeHtml(badgeIcon)} ${escapeHtml(badgeText)}</span>
        </div>
        <div class="lb-metric ${currentTab === "rent" ? "gold" : ""}">${metricVal}</div>
      `;

      // Make rows clickable — opens player profile modal with accurate stats
      if (!isSelf) {
        row.style.cursor = "pointer";
        row.addEventListener("click", () => {
          if (typeof window.updatePlayerInfoModal === "function") {
            // Close leaderboard first so player profile isn't behind it
            const lbModal = document.getElementById("leaderboard-modal");
            if (lbModal) lbModal.classList.add("hidden");

            window.updatePlayerInfoModal({
              ownerId: p.id,
              ownerName: p.name,
              avatar: p.avatar,
              cash: p.lifetimeRent || p.cash || 0,
              lifetimeRent: p.lifetimeRent || p.cash || 0,
              dividends: p.totalDividends || 0,
              totalDividends: p.totalDividends || 0,
              plotsCount: p.plotsCount || 0
            });
            window.openModal("player-info-modal");
          }
        });
      }

      fragment.appendChild(row);
    });

    listEl.innerHTML = "";
    listEl.appendChild(fragment);
  }

  function renderAvatar(avatar) {
    if (avatar && avatar.startsWith("img:")) {
      return `<img src="${escapeHtml(avatar.slice(4))}" style="width:100%;height:100%;border-radius:50%;object-fit:cover;">`;
    }
    return `<span>${escapeHtml(avatar || "🙂")}</span>`;
  }

  // Drops royalty payouts into the global dividends mailbox with Multi-Language support
  async function awardTerritoryDividends(territory, buyerId, plotCostEB = 100) {
    if (!territory) return;
    const db = Store.getDb();
    const state = Store.get();
    const data = await fetchRankings(false);

    const cleanCity = territory.city || "";
    const cleanState = normalizeState(territory.state, cleanCity);
    const cleanCountry = normalizeCountry(territory.country, cleanCity);

    // Skip dividend awards for plots with unknown/incomplete country data.
    // City may legitimately be empty (PA boroughs/townships resolve to no
    // territory) — Governor and President royalties still pay; the Mayor
    // lookup below just finds no race.
    if (!cleanCountry) return;
    const cleanTerritory = territory.city || territory.state || "";

    const mayor = lookupRuler(data.mayorsMap, cleanCity);
    const governor = lookupRuler(data.governorsMap, cleanState);
    const president = lookupRuler(data.presidentsMap, cleanCountry);

    const payouts = {};
    function addP(ruler, title, icon) {
      if (!ruler || !ruler.ownerId) return;
      if (!payouts[ruler.ownerId]) {
        payouts[ruler.ownerId] = { amount: 0, titles: [], icons: [], name: ruler.name };
      }
      payouts[ruler.ownerId].amount += 2;
      payouts[ruler.ownerId].titles.push(title);
      payouts[ruler.ownerId].icons.push(icon);
    }

    if (mayor) addP(mayor, `Mayor of ${mayor.place || cleanCity}`, "👑");
    if (governor) addP(governor, `Governor of ${governor.place || cleanState}`, "🏛️");
    if (president) addP(president, `President of ${president.place || cleanCountry}`, "🦅");

    for (const oid in payouts) {
      const p = payouts[oid];
      const isSelf = oid === state.player?.id;

      if (isSelf) {
        // Drop into own mailbox and claim via server so save.eb stays authoritative
        if (db) {
          db.collection("dividends").add({
            recipientId: oid,
            amount: p.amount,
            titleBadge: p.titles.join(" & "),
            territory: cleanTerritory,
            claimed: false,
            createdAt: Date.now()
          }).then(() => claimPendingDividends()).catch(e => console.warn("[Dividends] Mailbox drop notice:", e));
        }
      } else if (db) {
        db.collection("dividends").add({
          recipientId: oid,
          amount: p.amount,
          titleBadge: p.titles.join(" & "),
          territory: cleanTerritory,
          claimed: false,
          createdAt: Date.now()
        }).catch(e => console.warn("[Dividends] Mailbox drop notice:", e));
      }

      if (typeof Feed !== "undefined") {
        Feed.broadcast("dividend", {
          rulerName: p.name,
          territory: cleanTerritory,
          amount: p.amount,
          titleBadge: p.titles.join(" & "),
          titleIcon: p.icons.join("")
        });
      }
    }
  }

  // Automatically collects all royalties deposited into your mailbox while offline!
  // Server-authoritative: save.eb is incremented by the claimMailbox callable so
  // the displayed balance and the server balance never drift apart.
  async function claimPendingDividends() {
    const state = Store.get();
    const myId = state?.player?.id;
    if (!myId) return;
    if (typeof ServerAntiCheat === "undefined" || !ServerAntiCheat.isReady()) return;

    try {
      const result = await ServerAntiCheat.claimMailbox();
      if (!result || !result.claimed) return;

      if (typeof result.nextEb === "number") state.eb = result.nextEb;
      if (typeof result.nextTotalDividends === "number") state.totalDividends = result.nextTotalDividends;
      Store.save(true);
      if (typeof updateTopbar === "function") updateTopbar();

      const toastFn = window.showToast || alert;
      const parts = [];
      if (result.dividendsEb > 0) parts.push(`+${result.dividendsEb} EB royalties`);
      if (result.giftsEb > 0) parts.push(`+${result.giftsEb} EB friend gifts`);
      toastFn(`👑 Royal Dividend! You collected ${parts.join(" and ")}!`, 5000);
    } catch (e) {
      console.warn("[Dividends] Auto-claim notice:", e);
    }
  }

  // Live Real-Time Royalties Listener — tracks pending count ONLY, never auto-claims
  let dividendUnsubscribe = null;
  window._pendingDividendsCount = 0;
  window._pendingDividendsTotal = 0;
  window._pendingReferralBonusesCount = 0;
  window._pendingReferralBonusesTotal = 0;

  function updateRoyaltiesButton() {
    const btn = document.getElementById("royalties-btn");
    const badge = document.getElementById("royalties-badge");
    if (!btn) return;
    const totalPending = (window._pendingDividendsCount || 0) + (window._pendingReferralBonusesCount || 0);
    const totalEB = (window._pendingDividendsTotal || 0) + (window._pendingReferralBonusesTotal || 0);
    if (totalPending > 0) {
      btn.classList.remove("hidden");
      if (badge) badge.textContent = totalEB > 0 ? `+${totalEB} EB` : `${totalPending}`;
    } else {
      btn.classList.add("hidden");
    }
  }

  async function fetchPendingReferralBonuses() {
    const db = Store.getDb();
    const myId = Store.get()?.player?.id;
    if (!db || !myId) return;
    try {
      const snap = await db.collection("referral_bonuses")
        .where("toId", "==", myId)
        .where("claimed", "==", false)
        .get();
      let total = 0;
      snap.forEach(doc => { total += Number(doc.data()?.amount) || 0; });
      window._pendingReferralBonusesCount = snap.size;
      window._pendingReferralBonusesTotal = total;
      updateRoyaltiesButton();
    } catch (e) {}
  }

  function initDividendMailbox() {
    const state = Store.get();
    const db = Store.getDb();
    const myId = state?.player?.id;
    if (!db || !myId) return;

    if (dividendUnsubscribe) {
      dividendUnsubscribe();
      dividendUnsubscribe = null;
    }

    try {
      dividendUnsubscribe = db.collection("dividends")
        .where("recipientId", "==", myId)
        .where("claimed", "==", false)
        .onSnapshot((snapshot) => {
          const pendingCount = snapshot ? snapshot.size : 0;
          let pendingTotal = 0;
          if (snapshot) {
            snapshot.forEach((doc) => {
              pendingTotal += (Number(doc.data()?.amount) || 2);
            });
          }
          window._pendingDividendsCount = pendingCount;
          window._pendingDividendsTotal = pendingTotal;
          updateRoyaltiesButton();
        }, (err) => console.warn("[Dividends] Listener notice:", err));
    } catch (e) {
      console.warn("[Dividends] Init notice:", e);
    }
    fetchPendingReferralBonuses();
  }

  async function renderRoyaltiesModal() {
    const db = Store.getDb();
    const myId = Store.get()?.player?.id;
    const listEl = document.getElementById("royalties-list");
    const summaryEl = document.getElementById("royalties-summary");
    const claimAllBtn = document.getElementById("royalties-claim-all-btn");
    if (!listEl || !myId) return;

    let dividendItems = [];
    let referralItems = [];

    if (db) {
      try {
        const divSnap = await db.collection("dividends")
          .where("recipientId", "==", myId)
          .where("claimed", "==", false)
          .get();
        divSnap.forEach(doc => {
          const d = doc.data();
          dividendItems.push({ id: doc.id, amount: Number(d.amount) || 2, titleBadge: d.titleBadge || "Royalty", territory: d.territory || "", createdAt: d.createdAt });
        });
      } catch (e) {}

      try {
        const refSnap = await db.collection("referral_bonuses")
          .where("toId", "==", myId)
          .where("claimed", "==", false)
          .get();
        refSnap.forEach(doc => {
          const d = doc.data();
          referralItems.push({ id: doc.id, amount: Number(d.amount) || 0, fromName: d.fromName || "Referral" });
        });
      } catch (e) {}
    }

    const totalDivEb = dividendItems.reduce((s, i) => s + i.amount, 0);
    const totalRefEb = referralItems.reduce((s, i) => s + i.amount, 0);
    const totalEB = totalDivEb + totalRefEb;

    if (summaryEl) {
      summaryEl.textContent = totalEB > 0 ? `Total Pending: +${totalEB} EB` : "No pending royalties";
    }
    if (claimAllBtn) {
      claimAllBtn.disabled = totalEB <= 0;
      claimAllBtn.textContent = totalEB > 0 ? `CLAIM ALL (+${totalEB} EB)` : "Nothing to Claim";
    }

    let html = "";
    if (dividendItems.length > 0) {
      html += `<div class="royalty-section-title">👑 Territory Dividends</div>`;
      dividendItems.forEach(item => {
        html += `
          <div class="royalty-row">
            <div class="royalty-row-info">
              <span class="royalty-row-title">${escapeHtml(item.titleBadge)}</span>
              <span class="royalty-row-sub">from ${escapeHtml(item.territory)}</span>
            </div>
            <span class="royalty-row-amount">+${item.amount} EB</span>
          </div>`;
      });
    }
    if (referralItems.length > 0) {
      html += `<div class="royalty-section-title">🔗 Referral Bonuses</div>`;
      referralItems.forEach(item => {
        html += `
          <div class="royalty-row">
            <div class="royalty-row-info">
              <span class="royalty-row-title">${escapeHtml(item.fromName)}</span>
              <span class="royalty-row-sub">referral bonus</span>
            </div>
            <span class="royalty-row-amount">+${item.amount} EB</span>
          </div>`;
      });
    }
    if (dividendItems.length === 0 && referralItems.length === 0) {
      html = `<div class="royalty-empty">No pending royalties. Earn more by owning land as a ruler or referring friends!</div>`;
    }

    listEl.innerHTML = html;
  }

  async function claimAllRoyalties() {
    const claimAllBtn = document.getElementById("royalties-claim-all-btn");
    if (claimAllBtn) {
      claimAllBtn.disabled = true;
      claimAllBtn.textContent = "CLAIMING...";
    }

    let totalClaimed = 0;

    // 1. Claim territory dividends + friend gifts via server
    try {
      const divResult = await ServerAntiCheat.claimMailbox();
      if (divResult && divResult.claimed > 0) {
        const s = Store.get();
        if (typeof divResult.nextEb === "number") s.eb = divResult.nextEb;
        if (typeof divResult.nextTotalDividends === "number") s.totalDividends = divResult.nextTotalDividends;
        totalClaimed += (divResult.dividendsEb || 0) + (divResult.giftsEb || 0);
        Store.save(true);
      }
    } catch (e) {
      console.warn("[Royalties] Dividend claim error:", e);
    }

    // 2. Claim referral bonuses via server
    try {
      const refResult = await ServerAntiCheat.claimReferralBonuses();
      if (refResult && refResult.claimed && refResult.totalClaimed > 0) {
        const s = Store.get();
        if (typeof refResult.nextEb === "number") s.eb = refResult.nextEb;
        totalClaimed += refResult.totalClaimed;
        Store.save(true);
      }
    } catch (e) {
      console.warn("[Royalties] Referral claim error:", e);
    }

    // 3. Refresh pending counts
    window._pendingDividendsCount = 0;
    window._pendingDividendsTotal = 0;
    window._pendingReferralBonusesCount = 0;
    window._pendingReferralBonusesTotal = 0;
    updateRoyaltiesButton();

    // 4. Flying EB animation
    if (totalClaimed > 0 && typeof updateTopbar === "function") updateTopbar();
    if (totalClaimed > 0 && typeof launchFlyingEBStream === "function") {
      const claimBtn = document.getElementById("royalties-claim-all-btn");
      const rect = claimBtn ? claimBtn.getBoundingClientRect() : { left: window.innerWidth / 2, top: window.innerHeight / 2 };
      launchFlyingEBStream(rect.left + rect.width / 2, rect.top, totalClaimed);
    }

    // 5. Toast + refresh modal
    const toastFn = window.showToast || alert;
    if (totalClaimed > 0) {
      toastFn(`👑 Claimed ${totalClaimed} EB in royalties!`, 4500);
      await renderRoyaltiesModal();
    } else {
      toastFn("No pending royalties to claim.", 3000);
      document.getElementById("royalties-modal")?.classList.add("hidden");
    }

    if (typeof updateTopbar === "function") updateTopbar();
  }

  function openRoyaltiesModal() {
    const modal = document.getElementById("royalties-modal");
    if (modal) modal.classList.remove("hidden");
    renderRoyaltiesModal();
  }

  async function open() {
    if (!modal) modal = document.getElementById("leaderboard-modal");
    if (modal) modal.classList.remove("hidden");
    
    const data = await fetchRankings(false);
    render(data);
  }

  function init() {
    modal = document.getElementById("leaderboard-modal");
    document.getElementById("leaderboard-btn")?.addEventListener("click", open);
    document.getElementById("royalties-btn")?.addEventListener("click", openRoyaltiesModal);
    document.getElementById("royalties-claim-all-btn")?.addEventListener("click", claimAllRoyalties);
    document.getElementById("royalties-modal")?.querySelector(".close-btn")?.addEventListener("click", () => {
      document.getElementById("royalties-modal")?.classList.add("hidden");
    });
    initDividendMailbox();

    const scopeBtns = document.querySelectorAll(".lb-scope-btn");
    scopeBtns.forEach(btn => {
      btn.addEventListener("click", () => {
        scopeBtns.forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        currentScope = btn.dataset.scope;
        if (cachedData) render(cachedData);
        else fetchRankings().then(data => render(data));
      });
    });

    const tabBtns = document.querySelectorAll(".lb-tab-btn");
    tabBtns.forEach(tab => {
      tab.addEventListener("click", () => {
        tabBtns.forEach(t => t.classList.remove("active"));
        tab.classList.add("active");
        currentTab = tab.dataset.tab;
        if (cachedData) render(cachedData);
        else fetchRankings().then(data => render(data));
      });
    });
  }

  function getLocalTerritoryRulers(city, stateName, country) {
    if (!cachedData) return { mayor: null, governor: null, president: null };
    return {
      mayor: lookupRuler(cachedData.mayorsMap, city),
      governor: lookupRuler(cachedData.governorsMap, stateName),
      president: lookupRuler(cachedData.presidentsMap, country)
    };
  }

  return { init, open, render, fetchRankings, invalidateCache, invalidateLiveTerritory, isCityOrTown, awardTerritoryDividends, initDividendMailbox, getLocalTerritoryRulers, getPlayerLocalTerritory, openRoyaltiesModal, claimAllRoyalties, renderRoyaltiesModal, fetchPendingReferralBonuses, updateRoyaltiesButton };
})();