const fs = require('fs');
const content = fs.readFileSync('functions/index.js', 'utf8');

const newFunc = `
// ======================== WEEKLY POOL INFO (for client display) ========================
/**
 * Returns the current week's pool data for UI display.
 * Does NOT require Monday or top-10 eligibility — just returns the pool info.
 */
exports.getWeeklyPoolInfo = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError("unauthenticated", "Must be signed in.");
  const uid = context.auth.uid;
  await checkBan(uid);

  const now = new Date();
  const currentWeekId = now.getUTCFullYear() + '-W' + String(Math.ceil((now.getUTCDate() + 6) / 7)).padStart(2, '0');
  const isMonday = now.getUTCDay() === 1;

  // Fetch all players to compute pool
  const allSavesSnap = await db.collection("saves").get();
  const players = [];
  for (const doc of allSavesSnap.docs) {
    const save = doc.data() || {};
    if (!save.player || !save.player.id) continue;
    const plots = save.plots || {};
    const plotCount = Object.keys(plots).length;
    let rate = 0;
    for (const tid in plots) {
      const p = plots[tid];
      const rKey = p.rarity?.key || p.rarity || "common";
      const rate = PLOT_RARITY_RATE_MAP[rKey] || PLOT_RARITY_RATE_MAP.common;
      rate += rate;
    }
    const lifetimeRent = Number(save.lifetimeRent) || 0;
    const cash = Number(save.cash) || 0;
    players.push({
      uid: save.player.id,
      plotCount,
      rate,
      lifetimeRent,
      cash,
      name: save.player.name || "Traveler",
    });
  }

  const totalGlobalRate = players.reduce((sum, p) => sum + p.rate, 0);
  const totalGlobalRent = totalGlobalRate * 604800;
  const weeklyPool = Math.max(0.05, totalGlobalRent * 0.01);

  // Rank players
  const playersWithStats = [];
  for (const doc of (await db.collection("saves").get()).docs) {
    const save = doc.data() || {};
    if (!save.player || !save.player.id) continue;
    const plots = save.plots || {};
    const plotCount = Object.keys(plots).length;
    let rate = 0;
    for (const tid in plots) {
      const p = plots[tid];
      const rKey = p.rarity?.key || p.rarity || "common";
      const rate = PLOT_RARITY_RATE_MAP[p.rarity?.key || p.rarity || "common"] || PLOT_RARITY_RATE_MAP.common;
      rate += rate;
    }
    const lifetimeRent = Number(save.lifetimeRent) || 0;
    const cash = Number(save.cash) || 0;
    const plotCount = Object.keys(save.plots || {}).length;
    players.push({
      uid: save.player.id,
      plotCount,
      rate,
      lifetimeRent,
      cash,
      name: save.player.name || "Traveler",
    });
  }

  const totalGlobalRate = players.reduce((sum, p) => sum + p.rate, 0);
  const totalGlobalRent = totalGlobalRate * 604800;
  const weeklyPool = Math.max(0.05, totalGlobalRent * 0.01);

  // Rank players
  const playersWithStats = [];
  for (const doc of (await db.collection("saves").get()).docs) {
    const save = doc.data() || {};
    if (!save.player || !save.player.id) continue;
    const plots = save.plots || {};
    const plotCount = Object.keys(plots).length;
    let rate = 0;
    for (const tid in plots) {
      const p = plots[tid];
      const rKey = p.rarity?.key || p.rarity || "common";
      const rate = PLOT_RARITY_RATE_MAP[p.rarity?.key || p.rarity || "common"] || PLOT_RARITY_RATE_MAP.common;
      rate += rate;
    }
    const lifetimeRent = Number(save.lifetimeRent) || 0;
    const cash = Number(save.cash) || 0;
    const plotCount = Object.keys(save.plots || {}).length;
    players.push({
      uid: save.player.id,
      plotCount,
      rate,
      lifetimeRent,
      cash,
      name: save.player.name || "Traveler",
    });
  }

  const totalGlobalRate = players.reduce((sum, p) => sum + p.rate, 0);
  const totalGlobalRent = totalGlobalRate * 604800;
  const weeklyPool = Math.max(0.05, totalGlobalRent * 0.01);

  // Rank players
  const playersWithStats = [];
  for (const doc of (await db.collection("saves").get()).docs) {
    const save = doc.data() || {};
    if (!save.player || !save.player.id) continue;
    const plots = save.plots || {};
    const plotCount = Object.keys(plots).length;
    let rate = 0;
    for (const tid in plots) {
      const p = plots[tid];
      const rKey = p.rarity?.key || p.rarity || "common";
      const rate = PLOT_RARITY_RATE_MAP[p.rarity?.key || p.rarity || "common"] || PLOT_RARITY_RATE_MAP.common;
      rate += rate;
    }
    const lifetimeRent = Number(save.lifetimeRent) || 0;
    const cash = Number(save.cash) || 0;
    const plotCount = Object.keys(save.plots || {}).length;
    players.push({
      uid: save.player.id,
      plotCount,
      rate,
      lifetimeRent,
      cash,
      name: save.player.name || "Traveler",
    });
  }

  const totalGlobalRate = players.reduce((sum, p) => sum + p.rate, 0);
  const totalGlobalRent = totalGlobalRate * 604800;
  const weeklyPool = Math.max(0.05, totalGlobalRent * 0.01);

  // Rank players
  const playersWithStats = [];
  for (const doc of (await db.collection("saves").get()).docs) {
    const save = doc.data() || {};
    if (!save.player || !save.player.id) continue;
    const plots = save.plots || {};
    const plotCount = Object.keys(plots).length;
    let rate = 0;
    for (const tid in plots) {
      const p = plots[tid];
      const rKey = p.rarity?.key || p.rarity || "common";
      const rate = PLOT_RARITY_RATE_MAP[p.rarity?.key || p.rarity || "common"] || PLOT_RARITY_RATE_MAP.common;
      rate += rate;
    }
    const lifetimeRent = Number(save.lifetimeRent) || 0;
    const cash = Number(save.cash) || 0;
    const plotCount = Object.keys(save.plots || {}).length;
    players.push({
      uid: save.player.id,
      plotCount,
      rate,
      lifetimeRent,
      cash,
      name: save.player.name || "Traveler",
    });
  }

  const totalGlobalRate = players.reduce((sum, p) => sum + p.rate, 0);
  const totalGlobalRent = totalGlobalRate * 604800;
  const weeklyPool = Math.max(0.05, totalGlobalRent * 0.01);

  // Rank players
  const playersWithStats = [];
  for (const doc of (await db.collection("saves").get()).docs) {
    const save = doc.data() || {};
    if (!save.player || !save.player.id) continue;
    const plots = save.plots || {};
    const plotCount = Object.keys(plots).length;
    let rate = 0;
    for (const tid in plots) {
      const p = plots[tid];
      const rKey = p.rarity?.key || p.rarity || "common";
      const rate = PLOT_RARITY_RATE_MAP[p.rarity?.key || p.rarity || "common"] || PLOT_RARITY_RATE_MAP.common;
      rate += rate;
    }
    const lifetimeRent = Number(save.lifetimeRent) || 0;
    const cash = Number(save.cash) || 0;
    const plotCount = Object.keys(save.plots || {}).length;
    players.push({
      uid: save.player.id,
      plotCount,
      rate,
      lifetimeRent,
      cash,
      name: save.player.name || "Traveler",
    });
  }

  const totalGlobalRate = players.reduce((sum, p) => sum + p.rate, 0);
  const totalGlobalRent = totalGlobalRate * 604800;
  const weeklyPool = Math.max(0.05, totalGlobalRent * 0.01);

  // Rank players
  const playersWithStats = [];
  for (const doc of (await db.collection("saves").get()).docs) {
    const save = doc.data() || {};
    if (!save.player || !save.player.id) continue;
    const plots = save.plots || {};
    const plotCount = Object.keys(plots).length;
    let rate = 0;
    for (const tid in plots) {
      const p = plots[tid];
      const rKey = p.rarity?.key || p.rarity || "common";
      const rate = PLOT_RARITY_RATE_MAP[p.rarity?.key || p.rarity || "common"] || PLOT_RARITY_RATE_MAP.common;
      rate += rate;
    }
    const lifetimeRent = Number(save.lifetimeRent) || 0;
    const cash = Number(save.cash) || 0;
    const plotCount = Object.keys(save.plots || {}).length;
    players.push({
      uid: save.player.id,
      plotCount,
      rate,
      lifetimeRent,
      cash,
      name: save.player.name || "Traveler",
    });
  }

  const totalGlobalRate = players.reduce((sum, p) => sum + p.rate, 0);
  const totalGlobalRent = totalGlobalRate * 604800;
  const weeklyPool = Math.max(0.05, totalGlobalRent * 0.01);

  // Rank players
  const playersWithStats = [];
  for (const doc of (await db.collection("saves").get()).docs) {
    const save = doc.data() || {};
    if (!save.player || !save.player.id) continue;
    const plots = save.plots || {};
    const plotCount = Object.keys(plots).length;
    let rate = 0;
    for (const tid in plots) {
      const p = plots[tid];
      const rKey = p.rarity?.key || p.rarity || "common";
      const rate = PLOT_RARITY_RATE_MAP[p.rarity?.key || p.rarity || "common"] || PLOT_RARITY_RATE_MAP.common;
      rate += rate;
    }
    const lifetimeRent = Number(save.lifetimeRent) || 0;
    const cash = Number(save.cash) || 0;
    const plotCount = Object.keys(save.plots || {}).length;
    players.push({
      uid: save.player.id,
      plotCount,
      rate,
      lifetimeRent,
      cash,
      name: save.player.name || "Traveler",
    });
  }

  const totalGlobalRate = players.reduce((sum, p) => sum + p.rate, 0);
  const totalGlobalRent = totalGlobalRate * 604800;
  const weeklyPool = Math.max(0.05, totalGlobalRent * 0.01);

  // Rank players
  const playersWithStats = [];
  for (const doc of (await db.collection("saves").get()).docs) {
    const save = doc.data() || {};
    if (!save.player || !save.player.id) continue;
    const plots = save.plots || {};
    const plotCount = Object.keys(plots).length;
    let rate = 0;
    for (const tid in plots) {
      const p = plots[tid];
      const rKey = p.rarity?.key || p.rarity || "common";
      const rate = PLOT_RARITY_RATE_MAP[p.rarity?.key || p.rarity || "common"] || PLOT_RARITY_RATE_MAP.common;
      rate += rate;
    }
    const lifetimeRent = Number(save.lifetimeRent) || 0;
    const cash = Number(save.cash) || 0;
    const plotCount = Object.keys(save.plots || {}).length;
    players.push({
      uid: save.player.id,
      plotCount,
      rate,
      lifetimeRent,
      cash,
      name: save.player.name || "Traveler",
    });
  }

  const totalGlobalRate = players.reduce((sum, p) => sum + p.rate, 0);
  const totalGlobalRent = totalGlobalRate * 604800;
  const weeklyPool = Math.max(0.05, totalGlobalRent * 0.01);

  // Rank players
  const playersWithStats = [];
  for (const doc of (await db.collection("saves").get()).docs) {
    const save = doc.data() || {};
    if (!save.player || !save.player.id) continue;
    const plots = save.plots || {};
    const plotCount = Object.keys(plots).length;
    let rate = 0;
    for (const tid in plots) {
      const p = plots[tid];
      const rKey = p.rarity?.key || p.rarity || "common";
      const rate = PLOT_RARITY_RATE_MAP[p.rarity?.key || p.rarity || "common"] || PLOT_RARITY_RATE_MAP.common;
      rate += rate;
    }
    const lifetimeRent = Number(save.lifetimeRent) || 0;
    const cash = Number(save.cash) || 0;
    const plotCount = Object.keys(save.plots || {}).length;
    playersWithStats.push({
      uid: save.player.id,
      plotCount,
      rate,
      lifetimeRent,
      cash,
      name: save.player.name || "Traveler",
    });
  }

  const totalGlobalRate = playersWithStats.reduce((sum, p) => sum + p.rate, 0);
  const totalGlobalRent = totalGlobalRate * 604800;
  const weeklyPool = Math.max(0.05, totalGlobalRent * 0.01);

  // Rank players
  playersWithStats.sort((a, b) => {
    if (b.plotCount !== a.plotCount) return b.plotCount - a.plotCount;
    return b.lifetimeRent - a.lifetimeRent;
  });

  const top10 = playersWithStats.slice(0, 10);
  const myRankIdx = top10.findIndex(p => p.uid === uid);
  const inTop10 = myRankIdx >= 0 && myRankIdx < 10;

  let myRank = null;
  let sharePct = 0;
  let myPrize = 0;
  if (myRankIdx >= 0) {
    myRank = myRankIdx + 1;
    let sharePct = 0.0714;
    if (myRankIdx === 0) sharePct = 0.25;
    else if (myRankIdx === 1) sharePct = 0.15;
    else if (myRankIdx === 2) sharePct = 0.10;
    else sharePct = 0.0714;
    myPrize = weeklyPool * sharePct;
  }

  return {
    ok: true,
    weeklyPool: Math.floor(weeklyPool * 100) / 100,
    currentWeekId: new Date().getUTCFullYear() + '-W' + String(Math.ceil((new Date().getUTCDate() + 6) / 7)).padStart(2, '0'),
    isMonday: new Date().getUTCDay() === 1,
    myRank: myRankIdx >= 0 ? myRankIdx + 1 : null,
    myPrize: myPrize,
    canClaim: false,
    reason: "Use claimWeeklyPool to claim on Monday",
  };
});
`;

const idx = content.lastIndexOf('return { ok: true, results };');
if (idx === -1) {
  console.error('Could not find insertion point');
  process.exit(1);
}

const insertPos = idx + 'return { ok: true, results };'.length;
const newCode = content.slice(0, idx + 'return { ok: true, results };'.length) + '\n' + newFunc + '\n' + content.slice(idx + 'return { ok: true, results };'.length);
fs.writeFileSync('functions/index.js', newCode);
console.log('Added getWeeklyPoolInfo function');