const fs = require('fs');
const content = fs.readFileSync('functions/index.js', 'utf8');

const startMarker = '// ======================== ADMIN: retroactiveWeeklyPoolPayout ========================';
const endMarker = '// ======================== REGIONAL COMPLIANCE: checkCountryAccess ========================';

const startIdx = content.indexOf(startMarker);
const endIdx = content.indexOf(endMarker);

if (startIdx === -1 || endIdx === -1) {
  console.error('Could not find markers');
  process.exit(1);
}

const newFunction = `
// ======================== ADMIN: retroactiveWeeklyPoolPayout ========================
/**
 * Admin-only: trigger retroactive weekly pool payouts for missed weeks.
 * Usage: Call with { weeksBack: 2 } to pay out for the past 2 Mondays.
 */
exports.retroactiveWeeklyPoolPayout = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError("unauthenticated", "Must be signed in.");
  const caller = context.auth.uid;
  if (!isGlobalEventAdmin(context)) return { ok: false, reason: "not_admin" };

  const weeksBack = Math.min(Number(data?.weeksBack) || 2, 4); // max 4 weeks
  const now = new Date();
  
  // Find the most recent Monday before today
  const dayOfWeek = now.getUTCDay(); // 0=Sun, 1=Mon
  const daysSinceMonday = (now.getUTCDay() + 6) % 7;
  const lastMonday = new Date(now.getTime() - daysSinceMonday * 24 * 60 * 60 * 1000);
  lastMonday.setUTCHours(0, 0, 0, 0);

  const results = [];
  
  for (let i = 0; i < weeksBack; i++) {
    const targetMonday = new Date(lastMonday.getTime() - i * 7 * 24 * 60 * 60 * 1000);
    const weekId = targetMonday.getUTCFullYear() + '-W' + String(Math.ceil((targetMonday.getUTCDate() + 6) / 7)).padStart(2, '0');
    
    try {
      // Call the existing claimWeeklyPool logic but for a specific week
      const result = await db.runTransaction(async (transaction) => {
        // Get all players to compute pool for this week
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
            const conf = CONFIG.PLOT_RARITIES?.find(r => r.key === rKey) || CONFIG.PLOT_RARITIES[0];
            rate += conf?.rate || 0;
          }
          const lifetimeRent = Number(save.lifetimeRent) || 0;
          const cash = Number(save.cash) || 0;
          players.push({
            uid: save.player.id,
            plotCount,
            rate,
            lifetimeRent,
            cash: Number(save.cash) || 0,
            name: save.player.name || "Traveler",
          });
        }

        const totalGlobalRate = players.reduce((sum, p) => sum + p.rate, 0);
        const totalGlobalRent = totalGlobalRate * 604800; // weekly seconds
        const weeklyPool = Math.max(0.05, totalGlobalRent * 0.01);

        // Rank players
        players.sort((a, b) => {
          if (b.plotCount !== a.plotCount) return b.plotCount - a.plotCount;
          return b.lifetimeRent - a.lifetimeRent;
        });

        const top10 = players.slice(0, 10);
        
        // Track results for this week
        const weekResults = [];
        
        for (let rankIdx = 0; rankIdx < top10.length; rankIdx++) {
          const p = top10[rankIdx];
          const rank = rankIdx + 1;
          let sharePct = 0.0714;
          if (rank === 1) sharePct = 0.25;
          else if (rank === 2) sharePct = 0.15;
          else if (rank === 3) sharePct = 0.10;
          
          const reward = weeklyPool * sharePct;
          if (reward < 0.001) continue;

          const uid = p.uid;
          const saveRef = db.collection("saves").doc(uid);
          
          // Check if already claimed for this week
          const saveDoc = await transaction.get(db.collection("saves").doc(uid));
          if (saveDoc.exists) {
            const save = saveDoc.data() || {};
            const weekId = targetMonday.getUTCFullYear() + '-W' + String(Math.ceil((targetMonday.getUTCDate() + 6) / 7)).padStart(2, '0');
            if (save.lastWeeklyPoolClaim === weekId) {
              return { ok: false, reason: "already_claimed" };
            }
          }
          
          const saveRef = db.collection("saves").doc(p.uid);
          transaction.update(saveRef, {
            cash: admin.firestore.FieldValue.increment(reward),
            lifetimeRent: admin.firestore.FieldValue.increment(reward),
            lastWeeklyPoolClaim: weekId,
            lastSavedAt: Date.now(),
          });
          
          weekResults.push({
            uid: p.uid,
            name: p.name,
            rank,
            reward,
            pool: weeklyPool,
          });
        }
        
        return { ok: true, week: weekId, pool: weeklyPool, results: weekResults };
      });
      
      results.push({ week: weekId, ...result });
    } catch (e) {
      console.error("[RetroactivePayout] Error for week:", weekId, e);
      results.push({ week: weekId, ok: false, error: e.message });
    }
  }
  
  return { ok: true, results };
});

`;

// Replace the function
const newContent = content.substring(0, startIdx) + newFunction + content.substring(endIdx);
fs.writeFileSync('functions/index.js', newContent);
console.log('Fixed retroactiveWeeklyPoolPayout function');