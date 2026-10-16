#!/usr/bin/env node
// ============================================================
// Elden Earth — Demo / Reviewer Account Seeder
//
// Seeds a read-only demo account for Play Store review:
//   - marks the uid in demo_players/ (server-side read-only enforcement)
//   - sets the `demo: true` custom claim (defense in depth)
//   - plants 10 plots of EACH rarity around a location you choose
//   - fills saves + saves_private with a plausible 18+ account
//   - excludes it from leaderboards automatically (demo flags)
//
// Run AFTER the demo Google account has signed into the game once
// (that creates the Firebase Auth user and the players/ record):
//
//   GOOGLE_APPLICATION_CREDENTIALS=../your-service-account.json \
//     node server/seed-demo.js --uid FIREBASE_UID --lat 33.4484 --lon -112.0740
//
// Options:
//   --uid <id>          Firebase Auth uid of the demo account (required)
//   --lat <deg>         Latitude to seed around (required)
//   --lon <deg>         Longitude to seed around (required)
//   --name <name>       Display name (default: "Demo Explorer")
//   --per-rarity <n>    Plots per rarity tier (default: 10)
//   --city <s>          Territory label city (default: "Demo Realm")
//   --state <s>         Territory label state (default: "Demo Lands")
//   --country <s>       Territory label country (default: "Demo Territory")
//   --tile-size <m>     Tile size in meters (default: 6.096)
//
// Safety: refuses to overwrite plots that already exist (skips occupied
// tiles), and never touches any account that is not the given uid.
// ============================================================
"use strict";

const path = require("path");

let admin;
try {
  admin = require("firebase-admin");
} catch (e) {
  admin = require(path.join(__dirname, "..", "functions", "node_modules", "firebase-admin"));
}

// ---- args ----
function arg(name, fallback) {
  const i = process.argv.indexOf("--" + name);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const UID = arg("uid", null);
const LAT = Number(arg("lat", NaN));
const LON = Number(arg("lon", NaN));
const NAME = arg("name", "Demo Explorer");
const PER_RARITY = Number(arg("per-rarity", 10));
const CITY = arg("city", "Demo Realm");
const STATE = arg("state", "Demo Lands");
const COUNTRY = arg("country", "Demo Territory");
const TILE_SIZE = Number(arg("tile-size", 6.096));

if (!UID || !Number.isFinite(LAT) || !Number.isFinite(LON)) {
  console.error("Usage: node server/seed-demo.js --uid <uid> --lat <deg> --lon <deg> [options]");
  process.exit(1);
}

admin.initializeApp({ credential: admin.credential.applicationDefault() });
const db = admin.firestore();

// ---- tile math (must match js/geo.js Geo.tileForLatLon) ----
const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;
const ORIGIN_SHIFT = (2 * Math.PI * 6378137) / 2.0;
const MERC_RATIO = ORIGIN_SHIFT / 180.0;

function tileForLatLon(lat, lon, tileSizeMeters) {
  const x = lon * MERC_RATIO;
  let y = Math.log(Math.tan((90 + lat) * 0.008726646259971648)) * RAD2DEG;
  y = y * MERC_RATIO;
  return { tx: Math.floor(x / tileSizeMeters), ty: Math.floor(y / tileSizeMeters) };
}

// ---- rarity table (must match PLOT_RARITY_RATE_MAP in functions/index.js) ----
const RARITIES = [
  { key: "common", rate: 0.0000000004 },
  { key: "rare", rate: 0.000000001214 },
  { key: "epic", rate: 0.0000000036825 },
  { key: "legendary", rate: 0.000000011165 },
];

function spiralOffsets(count) {
  // Ring-by-ring offsets around (0,0) so the demo block is compact but
  // every tile is unique.
  const out = [];
  let x = 0;
  let y = 0;
  let dx = 0;
  let dy = -1;
  while (out.length < count) {
    out.push([x, y]);
    if (x === y || (x < 0 && x === -y) || (x > 0 && x === 1 - y)) {
      const t = dx;
      dx = -dy;
      dy = t;
    }
    x += dx;
    y += dy;
  }
  return out;
}

async function main() {
  // 1. The account must already exist (created by the first Google sign-in).
  let user;
  try {
    user = await admin.auth().getUser(UID);
  } catch (e) {
    console.error(`ERROR: no Firebase Auth user for uid ${UID}.`);
    console.error("Sign into the game once with the demo Google account first.");
    process.exit(1);
  }
  console.log(`Seeding demo account: ${user.email || user.uid} (${UID})`);

  // 2. Custom claim + demo marker. The marker is what firestore.rules and
  //    playerCallable() in functions/index.js check on every write.
  const claims = { ...(user.customClaims || {}), demo: true };
  await admin.auth().setCustomUserClaims(UID, claims);
  await db.collection("demo_players").doc(UID).set({
    enabled: true,
    email: user.email || "",
    displayName: NAME,
    seededAt: Date.now(),
  }, { merge: true });

  // 3. Plots: 10 per rarity around the chosen location, skipping live tiles.
  const base = tileForLatLon(LAT, LON, TILE_SIZE);
  const offsets = spiralOffsets(RARITIES.length * PER_RARITY + 40);
  const now = Date.now();
  const plots = {}; // save.plots map
  let placed = 0;
  let oi = 0;

  for (const rarity of RARITIES) {
    for (let n = 0; n < PER_RARITY; n++) {
      let tid = null;
      let tx = 0;
      let ty = 0;
      while (oi < offsets.length) {
        const [dx, dy] = offsets[oi++];
        tx = base.tx + dx;
        ty = base.ty + dy;
        const candidate = `${tx}_${ty}`;
        const doc = await db.collection("plots").doc(candidate).get();
        if (!doc.exists) {
          tid = candidate;
          break;
        }
        console.log(`  skip occupied tile ${candidate}`);
      }
      if (!tid) {
        console.error("ERROR: ran out of free tiles around that location.");
        process.exit(1);
      }

      const instanceId = `demo_${tid}_${n}`;
      const plot = {
        tx,
        ty,
        city: CITY,
        state: STATE,
        country: COUNTRY,
        countryCode: "XX",
        rarity: rarity.key,
        rate: rarity.rate,
        ownerId: UID,
        ownerName: NAME,
        avatar: "🗺️",
        claimedAt: now,
        serverVerified: true,
        instanceId,
        lucky: false,
        source: "admin_gift",
        demo: true, // leaderboard + filters skip these
      };

      const batch = db.batch();
      batch.set(db.collection("plots").doc(tid), plot);
      batch.set(db.collection("player_plots").doc(instanceId), {
        uid: UID,
        status: "map",
        tileId: tid,
        obtainedAt: now,
        updatedAt: now,
      });
      await batch.commit();

      plots[tid] = plot;
      placed++;
    }
  }
  console.log(`Placed ${placed} plots (${PER_RARITY} per rarity) around tile ${base.tx}_${base.ty}`);

  // 4. Save: the seeded state the game loads. merge:true keeps createdAt etc.
  await db.collection("saves").doc(UID).set({
    demoMode: true,
    player: {
      id: UID,
      name: NAME,
      avatar: "🗺️",
      model3d: "soldier",
    },
    plots,
    plotBagItems: {},
    plotsVersion: now,
    eb: 25000,
    diamonds: 400,
    cash: 1250,
    lifetimeRent: 1250,
    totalDividends: 85,
    lastSavedAt: now,
  }, { merge: true });

  // 5. Private: 18+ DOB so every redeem screen is visible (but unwritable —
  //    submitWithdrawalRequest is a playerCallable and refuses demo uids).
  const dobMs = Date.UTC(1990, 5, 15);
  const privSnap = await db.collection("saves_private").doc(UID).get();
  const priv = privSnap.exists ? (privSnap.data() || {}) : {};
  const privUpdate = {};
  const existingDob = Number(priv.dateOfBirth) || 0;
  const ageYears = existingDob ? (now - existingDob) / (365.25 * 24 * 3600 * 1000) : 0;
  if (!existingDob || ageYears < 18) {
    privUpdate.dateOfBirth = dobMs;
    privUpdate.dateOfBirthSetAt = now;
  }
  if (typeof priv.rewardPoints !== "number" || priv.rewardPoints < 450) {
    privUpdate.rewardPoints = 450;
    privUpdate.rpDaily = { date: "", amount: 0 };
  }
  await db.collection("saves_private").doc(UID).set(privUpdate, { merge: true });

  console.log("Done. Demo account is seeded and read-only.");
  console.log("");
  console.log("Checklist:");
  console.log("  - Restart the demo app (fully close it) so it loads the seeded state.");
  console.log("  - Confirm the DEMO VIEW banner shows and action buttons are dimmed.");
  console.log("  - Confirm the account is absent from the leaderboard.");
  console.log("  - Play Console → App access → add " + (user.email || UID) + " as demo login (no 2FA).");
}

main().then(() => process.exit(0)).catch((e) => {
  console.error(e);
  process.exit(1);
});
