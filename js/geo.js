// ============================================================
// Elden Earth — Geometry & High-Performance Spherical Math
// Optimized for Zero-Garbage-Collection (Zero GC Stutter)
// ============================================================
const Geo = (() => {
  const DEG2RAD = Math.PI / 180;
  const RAD2DEG = 180 / Math.PI;
  const EARTH_RADIUS_METERS = 6378137;
  const ORIGIN_SHIFT = 2 * Math.PI * 6378137 / 2.0;

  // Pre-computed constants (Multiplication is 3x faster than division in mobile V8 engine)
  const INV_ORIGIN_SHIFT = 1.0 / ORIGIN_SHIFT;
  const MERC_RATIO = ORIGIN_SHIFT / 180.0;
  const INV_MERC_RATIO = 180.0 / ORIGIN_SHIFT;

  // Lat/Lon -> Spherical Mercator meters
  function toMercator(lat, lon) {
    const x = lon * MERC_RATIO;
    let y = Math.log(Math.tan((90 + lat) * 0.008726646259971648)) * RAD2DEG; // (PI / 360)
    y = y * MERC_RATIO;
    return { x, y };
  }

  // Spherical Mercator meters -> Lat/Lon
  function fromMercator(x, y) {
    const lon = x * INV_MERC_RATIO;
    let lat = y * INV_MERC_RATIO;
    lat = RAD2DEG * (2 * Math.atan(Math.exp(lat * DEG2RAD)) - 1.5707963267948966); // PI / 2
    return { lat, lon };
  }

  // Fast Inlined Mercator-to-Lat (Zero heap object creation)
  function fastMercYToLat(y) {
    const lat = y * INV_MERC_RATIO;
    return RAD2DEG * (2 * Math.atan(Math.exp(lat * DEG2RAD)) - 1.5707963267948966);
  }

  // Given (lat, lon) and a tile size in meters, return tile coordinates (tx, ty)
  function tileForLatLon(lat, lon, tileSizeMeters) {
    const m = toMercator(lat, lon);
    const invTile = 1.0 / tileSizeMeters;
    return {
      tx: Math.floor(m.x * invTile),
      ty: Math.floor(m.y * invTile),
    };
  }

  // High-Performance Inlined tileBounds (Eliminates 8 temporary objects per tile!)
  function tileBounds(tx, ty, tileSizeMeters) {
    const minX = tx * tileSizeMeters;
    const minY = ty * tileSizeMeters;
    const maxX = (tx + 1) * tileSizeMeters;
    const maxY = (ty + 1) * tileSizeMeters;

    const minLon = minX * INV_MERC_RATIO;
    const maxLon = maxX * INV_MERC_RATIO;

    const minLat = fastMercYToLat(minY);
    const maxLat = fastMercYToLat(maxY);

    return [
      [minLat, minLon], // SW
      [maxLat, minLon], // NW
      [maxLat, maxLon], // NE
      [minLat, maxLon], // SE
    ];
  }

  // Fast Haversine distance in meters
  function haversine(lat1, lon1, lat2, lon2) {
    const dLat = (lat2 - lat1) * DEG2RAD;
    const dLon = (lon2 - lon1) * DEG2RAD;
    const sinDLat = Math.sin(dLat * 0.5);
    const sinDLon = Math.sin(dLon * 0.5);
    const a = sinDLat * sinDLat +
              Math.cos(lat1 * DEG2RAD) * Math.cos(lat2 * DEG2RAD) *
              sinDLon * sinDLon;
    return EARTH_RADIUS_METERS * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
  }

  // Generate a point in an annulus so diamonds never spawn inside reach.
  function randomPointInRadius(lat, lon, maxRadiusM = 1000, minRadiusM = 0) {
    const innerLimit = Math.max(0, Math.min(minRadiusM, maxRadiusM));
    const outerLimit = Math.max(innerLimit, maxRadiusM);
    const r = innerLimit + Math.random() * (outerLimit - innerLimit);

    const theta = Math.random() * 6.283185307179586; // 2 * PI
    const cosLat = Math.cos(lat * DEG2RAD);
    const dLat = (r * Math.cos(theta)) * 0.00000898311175; // 1 / 111320
    const dLon = (r * Math.sin(theta)) * (0.00000898311175 / (cosLat || 1));
    return { lat: lat + dLat, lon: lon + dLon };
  }

  // Optimized Circle Polygon Generator (32 smooth vertices, 33% less memory)
  function createCirclePolygon(centerLat, centerLon, radiusMeters, points = 32) {
    const coords = [];
    const km = radiusMeters * 0.001;
    const distanceLat = (km * 0.00898311175);
    const distanceLon = (km * (0.00898311175 / Math.cos(centerLat * DEG2RAD)));
    const step = 6.283185307179586 / points;

    for (let i = 0; i < points; i++) {
      const theta = i * step;
      coords.push([centerLon + distanceLon * Math.cos(theta), centerLat + distanceLat * Math.sin(theta)]);
    }
    coords.push(coords[0]); // Close polygon
    return coords;
  }

  // Fast Reverse-Geocoding Cache
  const territoryCache = {};
  const US_STATES = {
    "Alabama":"AL","Alaska":"AK","Arizona":"AZ","Arkansas":"AR","California":"CA","Colorado":"CO",
    "Connecticut":"CT","Delaware":"DE","Florida":"FL","Georgia":"GA","Hawaii":"HI","Idaho":"ID",
    "Illinois":"IL","Indiana":"IN","Iowa":"IA","Kansas":"KS","Kentucky":"KY","Louisiana":"LA",
    "Maine":"ME","Maryland":"MD","Massachusetts":"MA","Michigan":"MI","Minnesota":"MN",
    "Mississippi":"MS","Missouri":"MO","Montana":"MT","Nebraska":"NE","Nevada":"NV",
    "New Hampshire":"NH","New Jersey":"NJ","New Mexico":"NM","New York":"NY","North Carolina":"NC",
    "North Dakota":"ND","Ohio":"OH","Oklahoma":"OK","Oregon":"OR","Pennsylvania":"PA",
    "Rhode Island":"RI","South Carolina":"SC","South Dakota":"SD","Tennessee":"TN","Texas":"TX",
    "Utah":"UT","Vermont":"VT","Virginia":"VA","Washington":"WA","West Virginia":"WV",
    "Wisconsin":"WI","Wyoming":"WY","District of Columbia":"DC"
  };

  // Pennsylvania gate — PA has 56 official cities and ~2,560 boroughs plus
  // ~1,000 townships; only official cities may become a territory label.
  // Nominatim labels PA boroughs inconsistently: at zoom=14 a borough point
  // returns town/village=<borough> with NO city key, but at zoom=18 the
  // borough level is sometimes dropped and a lying city=Pittsburgh appears
  // (Castle Shannon, Dormont). So PA is resolved municipality-key-first and
  // re-queried at zoom=14 whenever the borough level is missing.
  const PA_CITY_NAMES = new Set([
    "Aliquippa", "Allentown", "Altoona", "Arnold", "Beaver Falls", "Bethlehem",
    "Bradford", "Butler", "Carbondale", "Chester", "Clairton", "Coatesville",
    "Connellsville", "Corry", "DuBois", "Duquesne", "Easton", "Erie", "Farrell",
    "Franklin", "Greensburg", "Harrisburg", "Hazleton", "Hermitage", "Jeannette",
    "Johnstown", "Lancaster", "Lebanon", "Lock Haven", "Lower Burrell",
    "McKeesport", "Meadville", "Monessen", "Monongahela", "Nanticoke",
    "New Castle", "New Kensington", "Oil City", "Parker", "Philadelphia",
    "Pittsburgh", "Pittston", "Pottsville", "Reading", "St. Marys", "Saint Marys",
    "Scranton", "Shamokin", "Sharon", "Sunbury", "Titusville", "Uniontown",
    "Warren", "Washington", "Wilkes-Barre", "Williamsport", "York",
  ].map(n => n.replace(/[^a-z0-9]/gi, "").toLowerCase()));

  function isPAAddress(addr) {
    return addr["ISO3166-2-lvl4"] === "US-PA" || US_STATES[addr.state] === "PA";
  }
  function paMunicipalKey(addr) {
    return addr.township || addr.borough || addr.town || addr.village || addr.municipality || "";
  }
  function normalizePlaceName(n) {
    return String(n || "").replace(/[^a-z0-9]/gi, "").toLowerCase();
  }
  // Resolves the raw (flag-less) municipality name for an address. Returns ""
  // for PA locations that are not inside an official city — no territory.
  function resolveCityName(addr) {
    if (isPAAddress(addr)) {
      const name = paMunicipalKey(addr) || addr.city || "";
      return PA_CITY_NAMES.has(normalizePlaceName(name)) ? name : "";
    }
    return addr.city || addr.town || addr.village || addr.municipality || addr.county || "";
  }

  async function getTerritoryInfo(lat, lon) {
    const key = `${lat.toFixed(4)}_${lon.toFixed(4)}`;
    if (territoryCache[key]) return territoryCache[key];

    try {
      // zoom=18 for maximum address detail; addressdetails=1 for full hierarchy
      const res = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json&zoom=18&addressdetails=1`, {
        headers: { "User-Agent": "EldenEarth/1.0 (vicsanity623.github.io)", "Accept-Language": "en" }
      });
      const data = await res.json();
      let addr = data.address || {};
      let city = resolveCityName(addr);

      // PA address with no borough/township-level key at zoom=18 — the city
      // key alone is untrustworthy (may name the metro city, not the
      // municipality). Re-resolve at zoom=14 where the borough level shows.
      if (isPAAddress(addr) && !paMunicipalKey(addr)) {
        try {
          const res14 = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json&zoom=14&addressdetails=1`, {
            headers: { "User-Agent": "EldenEarth/1.0 (vicsanity623.github.io)", "Accept-Language": "en" }
          });
          if (res14.ok) {
            const data14 = await res14.json();
            if (data14.address && Object.keys(data14.address).length) {
              addr = data14.address;
              city = resolveCityName(addr);
            }
          }
        } catch (e) { /* keep the zoom=18 resolution */ }
      }

      const rawState = addr.state || "";
      const stateCode = rawState ? (US_STATES[rawState] || (rawState.length === 2 ? rawState.toUpperCase() : rawState)) : "";
      const country = addr.country || "";
      const cc = addr.country_code ? addr.country_code.toUpperCase() : "";
      const flag = cc ? cc.replace(/./g, char => String.fromCodePoint(char.charCodeAt(0) + 127397)) : "";

      // Reject if Nominatim couldn't resolve a country
      if (!country) return null;

      const stateDisplay = rawState ? `${rawState} ${flag}` : flag;
      const countryDisplay = `${country} ${flag}`;

      // PA boroughs/townships resolve to a claim-less territory: empty city,
      // state+country kept so purchases/dividends still work.
      if (!city) {
        if (!isPAAddress(addr)) return null;
        const info = { city: "", state: stateDisplay, country: countryDisplay };
        territoryCache[key] = info;
        if (typeof AntiCheat !== "undefined") AntiCheat.setPlayerCountry(country);
        return info;
      }
      if (city.match(/^\d/)) return null;

      const cityDisplay = stateCode ? `${city}, ${stateCode} ${flag}` : `${city} ${flag}`;

      const info = {
        city: cityDisplay,
        state: stateDisplay,
        country: countryDisplay
      };

      territoryCache[key] = info;

      // Anti-cheat: Update player country for embargo detection
      if (typeof AntiCheat !== "undefined" && country && country !== "Unknown") {
        AntiCheat.setPlayerCountry(country);
      }

      return info;
    } catch (e) {
      // Geocoding failed — return null to block purchase
      return null;
    }
  }

  // ============================================================
  // NetworkVerifier — IP Geolocation & VPN/Datacenter Detection
  // Lightweight client-side network origin cross-reference.
  // ============================================================
  const NetworkVerifier = (() => {
    const IP_API_URL = "https://ip-api.com/json/?fields=status,message,country,regionName,city,lat,lon,isp,as,mobile,proxy,hosting";
    const VPN_KEYWORDS = [
      "vpn", "proxy", "tor", "tunnel", "anonymi", "cyberghost", "nordvpn",
      "expressvpn", "surfshark", "private internet", "mullvad", "windscribe",
      "hotspot shield", "hidemyass", "ipvanish", "protonvpn", "purevpn",
      "astrill", "vyprvpn", "tunnelbear", "cloudflare warp", "warp"
    ];
    const DATACENTER_KEYWORDS = [
      "hosting", "data center", "datacenter", "cloud", "amazon", "aws",
      "microsoft", "azure", "google cloud", "alibaba", "digitalocean",
      "linode", "vultr", "heroku", "ovh", "hetzner", "scaleway"
    ];
    const MAX_DISTANCE_KM = 500;

    let ipInfo = null;
    let isVerified = false;
    let isSuspicious = false;
    let isVPN = false;
    let isDatacenter = false;
    let isMobile = false;
    let verifyPromise = null;

    function distanceKm(lat1, lon1, lat2, lon2) {
      const R = 6371;
      const dLat = (lat2 - lat1) * Math.PI / 180;
      const dLon = (lon2 - lon1) * Math.PI / 180;
      const a = Math.sin(dLat / 2) ** 2 +
                Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
                Math.sin(dLon / 2) ** 2;
      return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }

    function matchesKeywords(str, keywords) {
      const lower = (str || "").toLowerCase();
      return keywords.some(kw => lower.includes(kw));
    }

    async function fetchIPInfo() {
      // This call sits on the launch critical path — launchGame does not reveal
      // the game screen until it resolves — so it must never be allowed to hang.
      const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
      const timer = controller ? setTimeout(() => controller.abort(), 3000) : null;
      try {
        const res = await fetch(IP_API_URL, {
          cache: "no-store",
          signal: controller ? controller.signal : undefined,
        });
        const data = await res.json();
        if (data.status === "success") return data;
      } catch (e) {
        console.warn("[NetworkVerifier] IP lookup failed:", e.message);
      } finally {
        if (timer) clearTimeout(timer);
      }
      // null => verification reports ip_lookup_failed and the game launches anyway
      return null;
    }

    /**
     * Run the full network verification against the given GPS position.
     * Returns { isSuspicious, isVPN, isDatacenter, distance, ipCountry, reason }
     */
    async function verify(gpsLat, gpsLon) {
      if (verifyPromise) return verifyPromise;

      verifyPromise = (async () => {
        const result = {
          isSuspicious: false,
          isVPN: false,
          isDatacenter: false,
          distance: null,
          ipCountry: null,
          reason: null
        };

        ipInfo = await fetchIPInfo();
        if (!ipInfo || ipInfo.lat === undefined) {
          result.reason = "ip_lookup_failed";
          return result;
        }

        isMobile = Boolean(ipInfo.mobile);
        isVPN = Boolean(ipInfo.proxy) || matchesKeywords(ipInfo.isp, VPN_KEYWORDS);
        isDatacenter = Boolean(ipInfo.hosting) || matchesKeywords(ipInfo.isp, DATACENTER_KEYWORDS);
        result.isVPN = isVPN;
        result.isDatacenter = isDatacenter;
        result.ipCountry = ipInfo.country;

        if (isVPN) {
          result.isSuspicious = true;
          result.reason = "vpn_detected";
        } else if (isDatacenter) {
          result.isSuspicious = true;
          result.reason = "datacenter_ip";
        }

        const dist = distanceKm(gpsLat, gpsLon, ipInfo.lat, ipInfo.lon);
        result.distance = dist;

        if (dist > MAX_DISTANCE_KM && !isMobile) {
          result.isSuspicious = true;
          if (!result.reason) {
            result.reason = `ip_gps_mismatch_${Math.round(dist)}km`;
          }
        }

        isSuspicious = result.isSuspicious;
        isVerified = true;

        if (isSuspicious) {
          console.warn(`[NetworkVerifier] FLAGGED: ${result.reason} (dist=${dist ? dist.toFixed(0) : "?"}km, ip=${ipInfo.country})`);
        }

        return result;
      })();

      return verifyPromise;
    }

    function getState() {
      return {
        isVerified,
        isSuspicious,
        isVPN,
        isDatacenter,
        isMobile,
        ipInfo: ipInfo ? {
          country: ipInfo.country,
          region: ipInfo.regionName,
          city: ipInfo.city,
          isp: ipInfo.isp
        } : null
      };
    }

    function reset() {
      ipInfo = null;
      isVerified = false;
      isSuspicious = false;
      isVPN = false;
      isDatacenter = false;
      isMobile = false;
      verifyPromise = null;
    }

    return { verify, getState, reset };
  })();

  return {
    tileForLatLon,
    tileBounds,
    fromMercator,
    toMercator,
    haversine,
    randomPointInRadius,
    createCirclePolygon,
    getTerritoryInfo,
    resolveCityName,
    isPAAddress,
    paMunicipalKey,
    NetworkVerifier
  };
})();