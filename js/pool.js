// ============================================================
// Elden Earth — 1% Weekly Realm Treasury Pool Distribution
// Distributes 1% of Global Lifetime Rent to Top 10 Every Monday 12:00 AM UTC
// ============================================================
const WeeklyPool = (() => {
  let modal = null;
  let rewardModal = null;
  let pendingRewardAmount = 0;

  // Calculates ISO Week ID: "2025-W36" (Ensures exactly 1 claim per week)
  function getISOWeekId(date = new Date()) {
    // Must match the server's isoWeekId() exactly. This used to build the date
    // from the LOCAL year/month/day, so anyone behind UTC got the previous
    // week's id during Monday 00:00-08:00 UTC — precisely the claim window —
    // and the 1-claim lock disagreed with the server.
    const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
    return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
  }

  // Same table as the server's weeklyPoolSharePct() — display-only fallback.
  function sharePctForRank(rank) {
    if (rank === 1) return 0.25;
    if (rank === 2) return 0.15;
    if (rank === 3) return 0.10;
    return 0.0714;
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, c => (
      { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
    ));
  }

  // Next Monday 00:00:00 UTC timestamp
  function getNextMondayUTCTimestamp() {
    const now = new Date();
    const result = new Date(now.getTime());
    result.setUTCHours(0, 0, 0, 0);
    const day = result.getUTCDay();
    const daysUntilMonday = (day === 0 ? 1 : 8 - day);
    result.setUTCDate(result.getUTCDate() + daysUntilMonday);
    return result.getTime();
  }

  // Calculate Total Global Lifetime Rent & Global $/Sec Across All Players
  async function calculateGlobalPool() {
    if (typeof Leaderboard === "undefined" || !Leaderboard.fetchRankings) {
      return { totalGlobalRent: 1.0, weeklyPool: 0.01, globalRateSec: 0, sortedTop10: [] };
    }

    const data = await Leaderboard.fetchRankings();
    const players = data?.players || [];

    let totalGlobalRent = 0;
    let globalRateSec = 0;

    // Fast Rarity Rate Lookup Table
    const RATE_MAP = {
      common: 0.0000000008,
      rare: 0.000000002428,
      epic: 0.000000007365,
      legendary: 0.000000022330
    };
    // Calculate global lifetime rent AND global velocity
    // --- 14-Day (2-Week) Fiscal Period Reset Engine ---
    const now = Date.now();
    const TWO_WEEKS_MS = 14 * 24 * 3600 * 1000; // 14-Day Period
    const MAX_PERIOD_SEC = 14 * 86400;           // Hard cap: Cannot exceed 14 days!
    const PERIOD_ANCHOR_MS = 1704067200000;      // Monday, Jan 1, 2024 00:00:00 UTC (In the PAST)

    const periodElapsed = Math.abs((now - PERIOD_ANCHOR_MS) % TWO_WEEKS_MS);
    const periodStartTime = now - periodElapsed;

    // Calculate rent generated ONLY during this active 14-day fiscal period
    players.forEach(p => {
      if (p.plots) {
        for (const tid in p.plots) {
          const plot = p.plots[tid];
          const rKey = plot.rarity?.key || plot.rarity || "common";
          // 🍀 Lucky plots accrue ×1.1 into the global rent pool.
          const rate = CONFIG.plotRate(rKey, plot.lucky === true);

          // Safe timestamp check
          let plotClaimedTime = Number(plot.claimedAt) || periodStartTime;
          if (plotClaimedTime > 0 && plotClaimedTime < 1e11) plotClaimedTime *= 1000; // convert sec to ms
          
          const activeSince = Math.max(plotClaimedTime, periodStartTime);
          // Hard-cap at MAX_PERIOD_SEC so it can NEVER calculate years of rent
          const periodAgeSec = Math.min(MAX_PERIOD_SEC, Math.max(0, (now - activeSince) / 1000));

          totalGlobalRent += (periodAgeSec * rate);
          globalRateSec += rate;
        }
      } else if (p.plotsCount) {
        const fallbackRate = p.plotsCount * 0.000000007365;
        const periodSec = Math.min(MAX_PERIOD_SEC, Math.max(0, (now - periodStartTime) / 1000));
        totalGlobalRent += (periodSec * fallbackRate);
        globalRateSec += fallbackRate;
      }
    });

    let weeklyPool = totalGlobalRent * 0.01;

    // 🛡️ GUARANTEED TREASURY SEED:
    // Ensure the pool never drops below a minimum threshold ($0.05)
    // so top landlords always receive a tangible cash reward!
    const MINIMUM_WEEKLY_TREASURY = 0.05;
    if (weeklyPool < MINIMUM_WEEKLY_TREASURY) {
      weeklyPool = MINIMUM_WEEKLY_TREASURY;
    }

    // Top 10 sorted by plots + lifetimeRent
    const sortedTop10 = [...players].sort((a, b) => {
      const pDiff = (b.plotsCount || 0) - (a.plotsCount || 0);
      if (pDiff !== 0) return pDiff;
      return (Number(b.lifetimeRent || b.cash) || 0) - (Number(a.lifetimeRent || a.cash) || 0);
    }).slice(0, 10);

    return { totalGlobalRent, weeklyPool, globalRateSec, sortedTop10 };
  }

  // "YYYY-MM-DD HH:MM UTC" for freeze/settlement timestamps.
  function fmtUTC(ms) {
    const d = new Date(Number(ms) || 0);
    if (isNaN(d.getTime())) return "";
    const pad = n => String(n).padStart(2, "0");
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;
  }

  // The Monday scheduler credits the Top 10 automatically, so most players never
  // click "claim". Tell them once per week (localStorage marker, because the
  // server-side lastWeeklyPoolClaim is already set by the time we see it).
  function announceAutoPayout(state, weekId, info) {
    try {
      const key = `eldenEarth.poolPayoutShown.${weekId}`;
      if (window.localStorage.getItem(key)) return;
      window.localStorage.setItem(key, String(Date.now()));
    } catch (e) { /* private mode: worst case the toast repeats */ }

    if (state.lastWeeklyPoolClaim !== weekId) {
      state.lastWeeklyPoolClaim = weekId;
      Store.save(true);
    }

    const prize = Number(info?.myPrize) || 0;
    if (prize > 0 && info?.myRank && typeof showToast === "function") {
      showToast(`👑 Weekly pool paid automatically: +$${fmtCash(prize)} (Rank #${info.myRank})`, 6000);
    }
  }

  // Check if today is Monday & user is in Top 10 for claim
  async function checkMondayDistribution() {
    const now = new Date();
    const isMonday = now.getUTCDay() === 1; // 1 = Monday in UTC

    // STRICT GUARD: ONLY triggers on Mondays!
    if (!isMonday) return;

    const currentWeekId = getISOWeekId(now);
    const state = Store.get();
    if (!state || !state.player?.id) return;

    let myRank = null;
    let prize = 0;

    // Server-authoritative standing: the reward modal must promise exactly what
    // claimWeeklyPool() will credit (same frozen snapshot, same share table).
    let serverAnswered = false;
    if (typeof ServerAntiCheat !== "undefined" && ServerAntiCheat.isReady()) {
      try {
        const info = await ServerAntiCheat.getWeeklyPoolInfo();
        if (info && info.ok) {
          serverAnswered = true;
          // Already credited by the Monday auto-payout — just tell the player.
          if (info.myClaimed) {
            announceAutoPayout(state, currentWeekId, info);
            return;
          }
          if (info.myRank) {
            myRank = info.myRank;
            prize = Number(info.myPrize) || 0;
          }
        }
      } catch (e) {
        console.warn("[Pool] Server standing check failed, using local estimate:", e);
      }
    }

    // Local estimate only when the server could not answer (offline / cold start)
    if (!serverAnswered) {
      // Offline keeps the local 1-claim lock: there is no server guard to rely on.
      if (state.lastWeeklyPoolClaim === currentWeekId) return;
      const { weeklyPool, sortedTop10 } = await calculateGlobalPool();
      const myRankIdx = sortedTop10.findIndex(p => p.id === state.player.id);
      if (myRankIdx >= 0 && myRankIdx < 10) {
        myRank = myRankIdx + 1;
        prize = weeklyPool * sharePctForRank(myRank);
      }
    }

    // Only Top 10 Players qualify!
    if (myRank != null) {
      pendingRewardAmount = prize;

      // Minimum floor check
      if (pendingRewardAmount < 0.001) {
        pendingRewardAmount = Math.max(0.005, 0.05 * sharePctForRank(myRank));
      }

      // Grab the modal DOM elements
      const rankBadgeEl = document.getElementById("reward-user-rank");
      const cashValEl = document.getElementById("reward-user-cash");
      const modalEl = document.getElementById("weekly-reward-modal");

      const rankIcon = myRank === 1 ? "🥇" : myRank === 2 ? "🥈" : myRank === 3 ? "🥉" : "🏅";
      if (rankBadgeEl) rankBadgeEl.textContent = `${rankIcon} Rank #${myRank} Global Landlord`;
      if (cashValEl) {
        cashValEl.textContent = `+$${pendingRewardAmount >= 0.01 ? pendingRewardAmount.toFixed(4) : pendingRewardAmount.toFixed(6)}`;
      }

      if (modalEl) modalEl.classList.remove("hidden");
    }
  }

  async function claimWeeklyReward() {
    if (pendingRewardAmount <= 0) return;
    const state = Store.get();
    const currentWeekId = getISOWeekId();

    // Server-authoritative claim — prevents client-side cash forging
    let serverReward = null;
    if (typeof ServerAntiCheat !== "undefined" && ServerAntiCheat.isReady()) {
      try {
        const result = await ServerAntiCheat.claimWeeklyPool();
        if (!result || !result.claimed) {
          if (typeof showToast === "function") showToast("⚠️ Pool claim could not be verified.", 3000);
          return;
        }
        if (typeof result.newCash === "number") state.cash = result.newCash;
        if (typeof result.newLifetimeRent === "number") state.lifetimeRent = result.newLifetimeRent;
        // Credit the amount the SERVER paid — the local estimate may differ.
        if (typeof result.reward === "number") serverReward = result.reward;
      } catch (e) {
        console.warn("[Pool] Server claim failed:", e);
        if (typeof showToast === "function") showToast("⚠️ Pool claim failed. Try again.", 3000);
        return;
      }
    } else {
      // Offline fallback — only allow if player has no cloud sync capability
      state.cash = (Number(state.cash) || 0) + pendingRewardAmount;
      state.lifetimeRent = (Number(state.lifetimeRent) || 0) + pendingRewardAmount;
    }

    state.lastWeeklyPoolClaim = currentWeekId;
    Store.save(true);

    // Report what was actually credited, not the pre-claim estimate.
    const paidAmount = typeof serverReward === "number" ? serverReward : pendingRewardAmount;

    document.getElementById("weekly-reward-modal")?.classList.add("hidden");
    if (typeof showToast === "function") {
      showToast(`👑 Claimed +$${paidAmount.toFixed(6)} from the Weekly Dividend Pool!`, 4000);
    }
    pendingRewardAmount = 0;
  }

  let cachedHudCountdown = null;
  let cachedModalCountdown = null;
  let lastHudText = "";

  // Battery-Efficient Countdown Ticker (Zero Unnecessary DOM Updates)
  function updateCountdownTicker() {
    if (document.hidden) return; // 0% CPU in pocket

    const nextMondayMs = getNextMondayUTCTimestamp();
    const now = Date.now();
    const diffSec = Math.max(0, Math.floor((nextMondayMs - now) / 1000));

    const days = Math.floor(diffSec / 86400);
    const hrs = Math.floor((diffSec % 86400) / 3600);
    const mins = Math.floor((diffSec % 3600) / 60);
    const secs = diffSec % 60;

    // 1. Only update HUD text if the hour string actually changed
    const newHudText = `${days}D ${hrs}H`;
    if (newHudText !== lastHudText && cachedHudCountdown) {
      cachedHudCountdown.textContent = newHudText;
      lastHudText = newHudText;
    }

    // 2. ONLY update the second-by-second timers if the modal is currently OPEN!
    if (modal && !modal.classList.contains("hidden")) {
      if (cachedModalCountdown) {
        cachedModalCountdown.textContent = `${String(days).padStart(2, "0")}D : ${String(hrs).padStart(2, "0")}H : ${String(mins).padStart(2, "0")}M : ${String(secs).padStart(2, "0")}s`;
      }

      // 3. Real-Time 50X Super Boost Countdown (Delegated to Multiplier module)
      const timer50xEl = document.getElementById("modal-50x-countdown-timer");
      const label50xEl = document.getElementById("modal-50x-label");
      const card50xEl = document.querySelector(".event-50x-countdown-card");

      if (timer50xEl && label50xEl && typeof Multiplier !== "undefined") {
        const countdownData = Multiplier.get50XCountdownData();
        
        if (countdownData.isLive) {
          card50xEl?.classList.add("active-now");
        } else {
          card50xEl?.classList.remove("active-now");
        }

        label50xEl.textContent = countdownData.label;
        timer50xEl.textContent = countdownData.timerStr;
      }
    }
  }

  function fmtCash(value) {
    const n = Number(value) || 0;
    const abs = Math.abs(n);
    if (abs >= 1) return n.toFixed(2);
    if (abs >= 0.01) return n.toFixed(4);
    return n.toFixed(6);
  }

  function renderStats({ totalGlobalRent, weeklyPool, globalRateSec, frozenAt, settled }) {
    const rentEl = document.getElementById("modal-global-rent-val");
    const poolEl = document.getElementById("modal-weekly-pool-val");
    const rateEl = document.getElementById("modal-global-rate-val");
    const basisEl = document.getElementById("modal-pool-basis");
    if (rentEl) rentEl.textContent = `$${fmtCash(totalGlobalRent)}`;
    if (poolEl) poolEl.textContent = `$${fmtCash(weeklyPool)}`;
    if (rateEl) rateEl.textContent = `+$${Number(globalRateSec || 0).toFixed(10)} / sec`;
    if (basisEl) {
      // Make the $0.05 floor visible instead of silently reporting "1%".
      const onePercent = (Number(totalGlobalRent) || 0) * 0.01;
      let text = onePercent < 0.05
        ? `1% of weekly rent = $${fmtCash(onePercent)} → minimum floor $0.05 is paying instead.`
        : `1% of weekly rent = $${fmtCash(onePercent)}.`;
      if (frozenAt) text += ` Frozen ${fmtUTC(frozenAt)}${settled ? " · paid automatically." : "."}`;
      basisEl.textContent = text;
    }
  }

  // Renders the ranked Top 10 with each rank's exact share of the pool.
  function renderTop10(top10, myUid) {
    const listEl = document.getElementById("modal-top10-list");
    if (!listEl) return;

    if (!Array.isArray(top10) || top10.length === 0) {
      listEl.innerHTML = `<li class="pool-top10-empty">Rankings are unavailable right now.</li>`;
      return;
    }

    const icons = ["🥇", "🥈", "🥉"];
    listEl.innerHTML = top10.map(p => {
      const rank = Number(p.rank) || 0;
      const share = (Number(p.sharePct || 0) * 100).toFixed(2).replace(/\.00$/, "");
      const prize = fmtCash(p.prize);
      const isMe = !!myUid && (p.uid === myUid || p.id === myUid);
      return `<li class="pool-top10-row${isMe ? " is-me" : ""}">
        <span class="pool-top10-rank">${icons[rank - 1] || "👑"}${rank}</span>
        <span class="pool-top10-name">${escapeHtml(String(p.name || "Traveler"))}${isMe ? " <em>(you)</em>" : ""}</span>
        <span class="pool-top10-meta">${Number(p.plotCount) || 0} plots</span>
        <span class="pool-top10-share">${share}%</span>
        <span class="pool-top10-prize">$${prize}</span>
      </li>`;
    }).join("");
  }

  // "Your standing" line + honest claim-window copy.
  function renderStanding(info, myUid) {
    const el = document.getElementById("modal-pool-my-standing");
    const note = document.getElementById("modal-top10-note");
    if (!el) return;
    if (!info || info.myRank == null) {
      el.textContent = myUid ? "Your standing: outside the Top 10" : "Your standing: sign in to see";
      if (note) note.textContent = "Rankings freeze at Monday 00:00 UTC; the Top 10 are paid automatically.";
      return;
    }
    const icon = info.myRank === 1 ? "🥇" : info.myRank === 2 ? "🥈" : info.myRank === 3 ? "🥉" : "🏅";
    el.innerHTML = `Your standing: <strong>${icon} #${info.myRank}</strong> · prize <strong>$${fmtCash(info.myPrize)}</strong>`;
    if (note) {
      if (info.myClaimed) {
        note.textContent = `✓ Paid automatically${info.settledAt ? " " + fmtUTC(info.settledAt) : ""}. This week's standings are frozen.`;
      } else if (info.isMonday) {
        note.textContent = "Rankings are frozen — automatic payout runs at 00:00 UTC. Claim now if you would rather not wait.";
      } else {
        note.textContent = "Payout lands automatically at the next Monday 00:00 UTC.";
      }
    }
  }

  async function open() {
    if (!modal) modal = document.getElementById("weekly-pool-modal");
    if (modal) modal.classList.remove("hidden");

    updateCountdownTicker();

    const state = Store.get();
    const myUid = state?.player?.id;

    // Server-authoritative first: the modal shows exactly the numbers the
    // Monday payout uses (same computeWeeklyPool + same share table), so the
    // displayed prize is the amount that will actually be credited.
    if (typeof ServerAntiCheat !== "undefined" && ServerAntiCheat.isReady()) {
      try {
        const info = await ServerAntiCheat.getWeeklyPoolInfo();
        if (info && info.ok) {
          renderStats({
            totalGlobalRent: info.totalGlobalRent,
            weeklyPool: info.weeklyPool,
            globalRateSec: info.globalRateSec,
            frozenAt: info.frozenAt,
            settled: info.settled,
          });
          renderTop10(info.top10, myUid);
          renderStanding(info, myUid);
          return;
        }
      } catch (e) {
        console.warn("[Pool] Server pool info failed, using local estimate:", e);
      }
    }

    // Offline / pre-auth fallback: local estimate from the leaderboard.
    const { totalGlobalRent, weeklyPool, globalRateSec, sortedTop10 } = await calculateGlobalPool();
    renderStats({ totalGlobalRent, weeklyPool, globalRateSec });
    renderTop10(
      (sortedTop10 || []).slice(0, 10).map((p, i) => {
        const sharePct = sharePctForRank(i + 1);
        return {
          rank: i + 1,
          uid: p.id,
          name: p.name || "Traveler",
          plotCount: p.plotsCount || 0,
          sharePct,
          prize: weeklyPool * sharePct,
        };
      }),
      myUid
    );
    const myIdx = (sortedTop10 || []).findIndex(p => p.id === myUid);
    renderStanding(
      myIdx >= 0
        ? { myRank: myIdx + 1, myPrize: weeklyPool * sharePctForRank(myIdx + 1), myClaimed: false, isMonday: new Date().getUTCDay() === 1 }
        : {},
      myUid
    );
  }

  function init() {
    modal = document.getElementById("weekly-pool-modal");
    rewardModal = document.getElementById("weekly-reward-modal");
    cachedHudCountdown = document.getElementById("hud-pool-countdown");
    cachedModalCountdown = document.getElementById("modal-pool-countdown-timer");

    document.getElementById("weekly-pool-hud-btn")?.addEventListener("click", open);
    document.getElementById("claim-weekly-reward-btn")?.addEventListener("click", claimWeeklyReward);

    // Single 1-Second Ticker with Sleep Guard
    setInterval(updateCountdownTicker, 1000);
    updateCountdownTicker();

    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) {
        updateCountdownTicker();
      }
    });

    setTimeout(checkMondayDistribution, 2500);
  }

  return { init, open, calculateGlobalPool, checkMondayDistribution };
})();
