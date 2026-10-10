// ============================================================
// Elden Earth — Friends System (Firestore-Backed)
// ============================================================
const Friends = (() => {
  const DAILY_GIFT_EB = 5;
  const MAX_FRIENDS = 50;

  function db() { return Store.getDb(); }
  function myId() { return Store.get()?.player?.id; }
  function myName() { return Store.get()?.player?.name || "Traveler"; }
  function myAvatar() { return Store.get()?.player?.avatar || "🙂"; }

  // ======================== FRIEND REQUESTS ========================
  async function getRelationshipStatus(targetId) {
    const id = myId();
    const d = db();
    if (!id || !d || !targetId || id === targetId) return { status: "self" };

    try {
      const existing = await d.collection("friendships")
        .where("user1Id", "in", [id, targetId])
        .where("user2Id", "in", [id, targetId])
        .limit(1).get();
      if (!existing.empty) return { status: "friends", friendshipId: existing.docs[0].id };
    } catch (e) {
      console.warn("[Friends] Relationship check error:", e);
    }

    try {
      const sent = await d.collection("friend_requests")
        .where("fromId", "==", id)
        .where("toId", "==", targetId)
        .where("status", "==", "pending")
        .limit(1).get();
      if (!sent.empty) return { status: "pending_sent", requestId: sent.docs[0].id };
    } catch (e) {
      console.warn("[Friends] Relationship check error:", e);
    }

    try {
      const theirs = await d.collection("friend_requests")
        .where("fromId", "==", targetId)
        .where("toId", "==", id)
        .where("status", "==", "pending")
        .limit(1).get();
      if (!theirs.empty) return { status: "pending_received", requestId: theirs.docs[0].id };
    } catch (e) {
      console.warn("[Friends] Relationship check error:", e);
    }

    return { status: "none" };
  }

  async function sendRequest(targetId, targetName, targetAvatar) {
    const id = myId();
    if (!id || !targetId || id === targetId) return;
    const d = db();
    if (!d) return;

    // Check if already friends
    const existing = await d.collection("friendships")
      .where("user1Id", "in", [id, targetId])
      .where("user2Id", "in", [id, targetId])
      .limit(1).get();
    if (!existing.empty) {
      toast("⚠️ Already friends with this player!", 3000);
      return;
    }

    // Check if request already sent
    const sent = await d.collection("friend_requests")
      .where("fromId", "==", id)
      .where("toId", "==", targetId)
      .where("status", "==", "pending")
      .limit(1).get();
    if (!sent.empty) {
      toast("⚠️ Request already sent!", 3000);
      return;
    }

    // Check if they already sent us a request
    const theirs = await d.collection("friend_requests")
      .where("fromId", "==", targetId)
      .where("toId", "==", id)
      .where("status", "==", "pending")
      .limit(1).get();
    if (!theirs.empty) {
      toast(`📬 ${targetName} already sent you a request! Accept it in your Friends tab.`, 4000);
      return;
    }

    await d.collection("friend_requests").add({
      fromId: id,
      fromName: myName(),
      fromAvatar: myAvatar(),
      toId: targetId,
      toName: targetName,
      toAvatar: targetAvatar,
      status: "pending",
      timestamp: Date.now()
    });
    toast(`📨 Friend request sent to ${targetName}!`, 3000);
  }

  async function acceptRequest(requestDocId) {
    const id = myId();
    const d = db();
    if (!id || !d) return;

    try {
      const doc = await d.collection("friend_requests").doc(requestDocId).get();
      if (!doc.exists) return;
      const req = doc.data();

      await d.collection("friendships").add({
        user1Id: req.fromId,
        user1Name: req.fromName,
        user1Avatar: req.fromAvatar,
        user2Id: req.toId,
        user2Name: req.toName,
        user2Avatar: req.toAvatar,
        since: Date.now(),
        lastGift: null,
        friendshipXp: 0,
        hearts: 1
      });

      await d.collection("friend_requests").doc(requestDocId).delete();
      toast("✅ Friend request accepted!", 3000);
      setTimeout(() => renderFriendsTab(), 350);
    } catch (e) {
      console.warn("[Friends] Accept error:", e);
      toast("⚠️ Could not accept request.", 3000);
    }
  }

  async function rejectRequest(requestDocId) {
    const d = db();
    if (!d) return;
    try {
      await d.collection("friend_requests").doc(requestDocId).delete();
      toast("Request declined.", 2500);
      setTimeout(() => renderFriendsTab(), 200);
    } catch (e) {
      console.warn("[Friends] Reject error:", e);
    }
  }

  async function removeFriend(friendshipDocId) {
    const d = db();
    if (!d) return;
    try {
      await d.collection("friendships").doc(friendshipDocId).delete();
      toast("👋 Friend removed.", 2500);
      renderFriendsTab();
    } catch (e) {
      console.warn("[Friends] Remove error:", e);
      toast("⚠️ Could not remove friend.", 3000);
    }
  }

  function toast(msg, dur) {
    if (typeof window.showToast === "function") window.showToast(msg, dur);
    else console.log("[Friends]", msg);
  }

  function syncRequestBadge() {
    const id = myId();
    const d = db();
    if (!id || !d) return;
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
  }

  // ======================== PENDING TRADE ALERTS ========================
  // The server writes trade_alerts/{myId}/items/{tradeId} for BOTH sides of an
  // open trade (no rarity/instanceId, so the commit-reveal seal stays intact).
  // Polling it means a trade waiting on THIS player is impossible to miss.
  let tradeAlerts = {};
  const tradeAlertSeen = new Set();

  function pendingTradeFor(friendshipId) {
    return (friendshipId && tradeAlerts[friendshipId]) || null;
  }

  async function syncTradeAlerts() {
    const id = myId();
    const d = db();
    if (!id || !d) return;
    try {
      const snap = await d.collection("trade_alerts").doc(id).collection("items").get();
      const now = Date.now();
      const map = {};
      let waiting = 0;
      snap.forEach(doc => {
        const a = doc.data() || {};
        if (Number(a.expiresAt || 0) <= now) return;
        if (["completed", "cancelled", "expired"].includes(a.status)) return;
        if (!a.friendshipId) return;
        map[a.friendshipId] = a;
        if (a.waitingOn === "me") waiting++;
      });
      tradeAlerts = map;

      const dot = document.getElementById("trade-pending-dot");
      if (dot) dot.classList.toggle("hidden", waiting === 0);

      const due = Object.values(map)
        .filter(a => a.waitingOn === "me")
        .sort((x, y) => (Number(y.updatedAt) || 0) - (Number(x.updatedAt) || 0))[0];
      if (!due) return;
      const key = `${due.tradeId}:${due.status}`;
      if (tradeAlertSeen.has(key)) return;
      tradeAlertSeen.add(key);
      const who = due.fromName || "A friend";
      if (due.status === "selecting") {
        toast(`🌐 ${who} opened a ${due.type === "local" ? "📍 Local" : "🌐 Remote"} trade — open Friends to pick your plot!`, 6000);
      } else {
        toast(`🤝 ${who} committed their plot — open the trade to confirm it!`, 6000);
      }
    } catch (e) {
      console.warn("[Friends] trade alert sync failed:", e);
    }
  }

  // Accounts younger than 14 days cannot trade (server enforces too).
  function tradeAgeBlocked() {
    const created = Number(Store.get()?.createdAt) || 0;
    if (!created) return false;
    const age = Date.now() - created;
    return age >= 0 && age < 14 * 24 * 60 * 60 * 1000;
  }

  function questFromXp(xp, toNext) {
    if (toNext <= 0) return "Max friendship! Enjoy the 🍀 lucky trade bonus with this friend.";
    const f = CONFIG.FRIENDSHIP;
    const level = CONFIG.friendshipHearts(xp);
    return `Send daily gifts (+${f.XP_PER_GIFT} XP each) and trade plots (+${f.XP_PER_TRADE} XP each) to reach ${level + 1} hearts — ${toNext} XP to go.`;
  }

  function openFriendshipDetail(friendship) {
    if (!friendship) return;
    const modal = document.getElementById("friendship-detail-modal");
    if (!modal) return;
    const title = modal.querySelector("#friendship-detail-name");
    const xp = modal.querySelector("#friendship-xp-value");
    const hearts = modal.querySelector("#friendship-hearts");
    const reward = modal.querySelector("#friendship-reward");
    const quest = modal.querySelector("#friendship-quest");
    const giftBtn = modal.querySelector("#friendship-detail-gift-btn");
    const xpFill = modal.querySelector("#friendship-xp-fill");
    const xpCaption = modal.querySelector("#friendship-xp-caption");

    // Hearts / XP come from CONFIG.FRIENDSHIP (1..10, XP grows with gifts + trades).
    const totalXp = Number(friendship.xp) || 0;
    const level = CONFIG.friendshipHearts(totalXp);
    const maxHearts = CONFIG.FRIENDSHIP.MAX_HEARTS;
    const toNext = CONFIG.friendshipXpToNext(totalXp);
    const prevThreshold = level >= maxHearts ? (CONFIG.FRIENDSHIP.LEVEL_XP[maxHearts - 1] || 0) : (CONFIG.FRIENDSHIP.LEVEL_XP[level - 1] || 0);
    const curThreshold = level >= maxHearts ? prevThreshold : (CONFIG.FRIENDSHIP.LEVEL_XP[level] || prevThreshold);
    const span = Math.max(1, curThreshold - prevThreshold);
    const pct = level >= maxHearts ? 100 : Math.min(100, Math.max(0, ((totalXp - prevThreshold) / span) * 100));

    if (title) title.textContent = friendship.name || "Friend";
    if (xp) xp.textContent = `${level}/${maxHearts}`;
    if (hearts) hearts.innerHTML = Array.from({ length: maxHearts }, (_, i) => `<span class="friendship-heart ${i < level ? "filled" : "dimmed"}">♥</span>`).join("");
    if (xpFill) xpFill.style.width = pct + "%";
    if (xpCaption) xpCaption.textContent = level >= maxHearts
      ? `${totalXp} XP — Max friendship ❤`
      : `${totalXp} XP — ${toNext} XP to next heart`;
    if (reward) reward.textContent = level >= maxHearts ? "🍀 +5% Lucky Trade Chance (active)" : "🍀 +5% Lucky Trade Chance (at 10 hearts)";
    const rewardBox = modal.querySelector(".friendship-reward-box");
    if (rewardBox) rewardBox.classList.toggle("active", level >= maxHearts);
    if (hearts) hearts.classList.toggle("maxed", level >= maxHearts);
    if (quest) quest.textContent = questFromXp(totalXp, toNext);

    if (giftBtn) {
      if (friendship.alreadyGifted) {
        giftBtn.textContent = "✓ Gift Sent Today";
        giftBtn.disabled = true;
        giftBtn.style.opacity = "0.5";
      } else {
        giftBtn.textContent = `🎁 Send Gift (+${DAILY_GIFT_EB} EB)`;
        giftBtn.disabled = false;
        giftBtn.style.opacity = "1";
        giftBtn.onclick = () => {
          if (friendship.fsId && friendship.friendId) {
            sendDailyGift(friendship.fsId, friendship.friendId, friendship.name);
            giftBtn.textContent = "✓ Gift Sent Today";
            giftBtn.disabled = true;
            giftBtn.style.opacity = "0.5";
          }
        };
      }
    }

    // Trade buttons — Local (≤500m, free) and Remote (25 EB relay).
    const localBtn = modal.querySelector("#trade-local-btn");
    const remoteBtn = modal.querySelector("#trade-remote-btn");
    if (localBtn && remoteBtn) {
      const tooNew = tradeAgeBlocked();
      const canTrade = Boolean(friendship.fsId) && !tooNew;
      const pending = pendingTradeFor(friendship.fsId);
      // Reset to stock labels first so a re-open never leaves stale text.
      localBtn.innerHTML = "📍 Local Trade";
      remoteBtn.innerHTML = '🌐 Remote Trade <span class="trade-fee-tag">25 EB</span>';
      localBtn.title = "";
      remoteBtn.title = "";
      [localBtn, remoteBtn].forEach(b => { b.disabled = !canTrade; b.style.opacity = canTrade ? "1" : "0.5"; });

      if (tooNew) {
        [localBtn, remoteBtn].forEach(b => {
          b.disabled = true;
          b.style.opacity = "0.5";
          b.title = "Trading unlocks once your account is 14 days old.";
        });
        localBtn.innerHTML = "🔒 Local Trade";
        remoteBtn.innerHTML = "🔒 Remote Trade";
      } else if (pending) {
        const match = pending.type === "local" ? localBtn : remoteBtn;
        match.innerHTML = pending.waitingOn === "me"
          ? (pending.status === "selecting" ? "🟡 Pick Your Plot →" : "🤝 Confirm Trade →")
          : "⏳ Waiting For Friend →";
      }

      localBtn.onclick = () => startTrade(friendship, "local");
      remoteBtn.onclick = () => startTrade(friendship, "remote");
    }

    modal.classList.remove("hidden");
    modal.style.zIndex = "2147483647";
  }

  // Kick off a trade session and hand off to the Trade UI.
  async function startTrade(friendship, type) {
    if (!friendship || !friendship.fsId) {
      toast("⚠️ Could not start a trade.", 3000);
      return;
    }
    if (tradeAgeBlocked()) {
      toast("🔒 Trading unlocks once your account is 14 days old.", 4000);
      return;
    }
    if (typeof Trade === "undefined" || !Trade.open) {
      toast("⚠️ Trade UI not loaded.", 3000);
      return;
    }
    document.getElementById("friendship-detail-modal")?.classList.add("hidden");
    Trade.open({ friendshipId: friendship.fsId, friendName: friendship.name || "Friend", type });
  }

  // ======================== DAILY EB GIFT ========================
  async function sendDailyGift(friendshipDocId, friendId, friendName) {
    const id = myId();
    const d = db();
    if (!id || !d) return;

    const today = new Date().toISOString().slice(0, 10);
    const giftKey = `${id}_${friendId}_${today}`;

    // Check if already gifted today
    try {
      const existing = await d.collection("daily_gifts").doc(giftKey).get();
      if (existing.exists) {
        toast("🎁 Already sent a gift to this friend today!", 3000);
        return;
      }
    } catch (e) {
      console.warn("[Friends] Gift check error:", e);
      toast("⚠️ Could not check gift status.", 3000);
      return;
    }

    // Record gift (only the sender writes — recipient claims later)
    try {
      await d.collection("daily_gifts").doc(giftKey).set({
        fromId: id,
        fromName: myName(),
        fromAvatar: myAvatar(),
        toId: friendId,
        toName: friendName,
        date: today,
        amount: DAILY_GIFT_EB,
        claimed: false,
        timestamp: Date.now()
      });
    } catch (e) {
      console.warn("[Friends] Gift record error:", e);
      toast("⚠️ Could not send gift.", 3000);
      return;
    }

    // Update friendship lastGift & optimistic local render immediately
    try {
      d.collection("friendships").doc(friendshipDocId).update({ lastGift: today }).catch(err => console.warn("[Friends] Friendship update error:", err));
    } catch (e) {
      console.warn("[Friends] Friendship update error:", e);
    }

    toast(`🎁 Sent ${DAILY_GIFT_EB} EB to ${friendName}!`, 3000);
    if (typeof window.completeDailyQuest === "function") {
      window.completeDailyQuest("gift");
    }
    if (typeof Achievements !== "undefined") Achievements.record("giftsSent");
    renderFriendsTab();
  }

  // ======================== CLAIM DAILY GIFTS ========================
  async function claimDailyGifts() {
    const id = myId();
    if (!id) return;
    // Server-authoritative claim (includes gifts + dividends) so save.eb never drifts
    if (typeof ServerAntiCheat === "undefined" || !ServerAntiCheat.isReady()) return;
    try {
      const result = await ServerAntiCheat.claimMailbox();
      if (!result || !result.claimed) return;
      const state = Store.get();
      if (state) {
        if (typeof result.nextEb === "number") state.eb = result.nextEb;
        if (typeof result.nextTotalDividends === "number") state.totalDividends = result.nextTotalDividends;
        Store.save(true);
        if (typeof updateTopbar === "function") updateTopbar();
      }
      if (result.giftsEb > 0) {
        toast(`🎁 Claimed ${result.giftsEb} EB from friend gift${result.giftsEb > 1 ? 's' : ''}!`, 4000);
      }
    } catch (e) {
      console.warn("[Friends] Claim gifts error:", e);
    }
  }

  // ======================== RENDER FRIENDS TAB ========================
  async function renderFriendsTab() {
    const id = myId();
    const d = db();
    if (!id || !d) return;

    const panel = document.querySelector('[data-pi-panel="friends"]');
    if (!panel) return;

    const container = panel.querySelector(".friends-list-container");
    if (!container) return;

    let incoming = [];
    let friendships = [];

    try {
      // Fetch friend requests (incoming)
      const incomingSnap = await d.collection("friend_requests")
        .where("toId", "==", id)
        .where("status", "==", "pending")
        .get();
      incoming = incomingSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    } catch (e) {
      console.warn("[Friends] Could not fetch incoming requests:", e);
    }

    try {
      const fsSnap1 = await d.collection("friendships")
        .where("user1Id", "==", id)
        .get();
      const fsSnap2 = await d.collection("friendships")
        .where("user2Id", "==", id)
        .get();
      friendships = [
        ...fsSnap1.docs.map(doc => ({ id: doc.id, ...doc.data() })),
        ...fsSnap2.docs.map(doc => ({ id: doc.id, ...doc.data() }))
      ];
    } catch (e) {
      console.warn("[Friends] Could not fetch friendships:", e);
    }

    // Update notification dot on avatar
    const dot = document.getElementById("friend-request-dot");
    if (dot) {
      if (incoming.length > 0) dot.classList.remove("hidden");
      else dot.classList.add("hidden");
    }
    syncRequestBadge();
    await syncTradeAlerts();

    const today = new Date().toISOString().slice(0, 10);
    const myNameVal = myName();
    const myAvatarVal = myAvatar();

    let html = "";

    // Incoming Requests Section
    if (incoming.length > 0) {
      html += `<div class="friends-section-title">📨 Incoming Requests (${incoming.length})</div>`;
      incoming.forEach(req => {
        const av = req.fromAvatar && req.fromAvatar.startsWith("img:")
          ? `<img src="${req.fromAvatar.slice(4)}">` : `<span>${req.fromAvatar || "🙂"}</span>`;
        html += `
          <div class="friend-row request-row">
            <div class="friend-avatar">${av}</div>
            <div class="friend-info">
              <span class="friend-name">${escapeHtml(req.fromName)}</span>
              <span class="friend-status">Wants to be your friend!</span>
            </div>
            <div class="friend-actions">
              <button class="btn-accept" onclick="Friends.acceptRequest('${req.id}');Friends.renderFriendsTab();">✓</button>
              <button class="btn-reject" onclick="Friends.rejectRequest('${req.id}');Friends.renderFriendsTab();">✕</button>
            </div>
          </div>`;
      });
    }

    // Friends List Section
    if (friendships.length === 0 && incoming.length === 0) {
      html += `
        <div class="friends-placeholder-inner">
          <div class="friends-placeholder-icon">👥</div>
          <h3>No Friends Yet</h3>
          <p>Find players on the map or leaderboard and send them a friend request!</p>
          <p class="friends-hint">Send +${DAILY_GIFT_EB} EB daily to each friend.</p>
        </div>`;
    } else if (friendships.length > 0) {
      html += `<div class="friends-section-title">👥 Friends (${friendships.length}/${MAX_FRIENDS})</div>`;
      friendships.forEach(fs => {
        const isUser1 = fs.user1Id === id;
        const friendName = isUser1 ? fs.user2Name : fs.user1Name;
        const friendAvatar = isUser1 ? fs.user2Avatar : fs.user1Avatar;
        const friendId = isUser1 ? fs.user2Id : fs.user1Id;
        const alreadyGifted = fs.lastGift === today;
        const fsXp = Number(fs.friendshipXp) || 0;
        const fsHearts = CONFIG.friendshipHearts(fsXp);
        const pendingTrade = pendingTradeFor(fs.id);
        const pendingBadge = pendingTrade
          ? `<span class="friend-trade-badge ${pendingTrade.waitingOn === "me" ? "is-you" : "is-waiting"}">${pendingTrade.waitingOn === "me" ? "🟡 Trade waiting" : "⏳ Trade in progress"}</span>`
          : "";

        const av = friendAvatar && friendAvatar.startsWith("img:")
          ? `<img src="${friendAvatar.slice(4)}">` : `<span>${friendAvatar || "🙂"}</span>`;
        html += `
          <div class="friend-row" onclick="Friends.openFriendshipDetail({ name: '${escapeHtml(friendName).replace(/'/g, "\\'")}', fsId: '${fs.id}', friendId: '${friendId}', alreadyGifted: ${alreadyGifted}, xp: ${fsXp}, reward: '+5 EB', quest: 'Send gifts and trade plots to earn Friendship XP and level up your hearts.'}); event.stopPropagation();" style="cursor:pointer;">
            <div class="friend-avatar">${av}</div>
            <div class="friend-info">
              <span class="friend-name">${escapeHtml(friendName)}${pendingBadge}</span>
              <span class="friend-status">Friends since ${new Date(fs.since).toLocaleDateString()}</span>
            </div>
            <div class="friend-actions" onclick="event.stopPropagation();">
              <span class="friend-hearts-mini" title="${fsXp} Friendship XP">${"♥".repeat(fsHearts)}${"♡".repeat(CONFIG.FRIENDSHIP.MAX_HEARTS - fsHearts)}</span>
              <button class="btn-gift ${alreadyGifted ? 'gifted' : ''}"
                ${alreadyGifted ? 'disabled' : ''}
                onclick="Friends.sendDailyGift('${fs.id}','${friendId}','${escapeHtml(friendName)}')">
                ${alreadyGifted ? '✓ Sent' : `🎁 +${DAILY_GIFT_EB} EB`}
              </button>
              <button class="btn-remove-friend" onclick="Friends.removeFriend('${fs.id}')">✕</button>
            </div>
          </div>`;
      });
    }

    container.innerHTML = html;
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  // ======================== PUBLIC API ========================
  return {
    getRelationshipStatus,
    sendRequest,
    acceptRequest,
    rejectRequest,
    removeFriend,
    sendDailyGift,
    claimDailyGifts,
    renderFriendsTab,
    openFriendshipDetail,
    syncRequestBadge,
    syncTradeAlerts,
    pendingTradeFor,
    DAILY_GIFT_EB
  };
})();
