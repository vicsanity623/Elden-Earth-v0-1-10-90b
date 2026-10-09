// ============================================================
// Elden Earth — Global Community Chat (Last 25 Messages, Moderated)
// ============================================================
const Chat = (() => {
  let drawer = null;
  let listEl = null;
  let inputEl = null;
  let sendBtn = null;
  let unreadBadge = null;
  let isOpen = false;
  let lastSentTime = 0;
  const COOLDOWN_MS = 4000; // 4s anti-spam cooldown
  let onlineCountEl = null;
  let heartbeatTimer = null;
  let kbGuessTimer = null;
  let kbGuessPx = 0;
  let baseInnerHeight = 0;
  const PRESENCE_HEARTBEAT_MS = 90000; // Lightweight pulse every 90 seconds
  const MAX_MESSAGES = 25;
  const messages = [];

  // Unified with the shared ProfanityFilter (js/profanity-filter.js) — the
  // server (functions/index.js) mirrors the same list and matcher. This is
  // only the offline fallback; online sends go through filterChatMessage.
  function filterProfanity(text) {
    if (typeof ProfanityFilter !== "undefined" && ProfanityFilter.filterProfanity) {
      return ProfanityFilter.filterProfanity(text);
    }
    return text;
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  function formatTime(timestamp) {
    const now = Date.now();
    const diff = now - timestamp;
    const mins = Math.floor(diff / 60000);
    const hrs = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (mins < 1) return "Just now";
    if (mins < 60) return `${mins}m ago`;
    if (hrs < 24) return `${hrs}h ago`;
    if (days < 7) return `${days}d ago`;

    const d = new Date(timestamp);
    const h = d.getHours();
    const m = String(d.getMinutes()).padStart(2, "0");
    const ampm = h >= 12 ? "PM" : "AM";
    return `${h % 12 || 12}:${m} ${ampm}`;
  }

  function renderMessages() {
    if (!listEl) return;
    listEl.innerHTML = "";

    if (messages.length === 0) {
      listEl.innerHTML = `<div class="chat-system-msg">No messages yet. Say hello to the realm!</div>`;
      return;
    }

    const state = Store.get();
    const myId = state?.player?.id;

    messages.forEach((msg) => {
      const isSelf = msg.senderId === myId;
      const row = document.createElement("div");
      row.className = "chat-message-row" + (isSelf ? " self" : "");

      const avatarContent = msg.avatar && msg.avatar.startsWith("img:")
        ? `<img src="${escapeHtml(msg.avatar.slice(4))}" style="width:100%;height:100%;object-fit:cover;">`
        : `<span>${escapeHtml(msg.avatar || "🙂")}</span>`;

      row.innerHTML = `
        <div class="chat-msg-avatar">${avatarContent}</div>
        <div class="chat-msg-bubble">
          <div class="chat-msg-sender">
            <span class="chat-sender-name">${escapeHtml(msg.senderName)}</span>
            <span class="chat-sender-time">${formatTime(msg.timestamp)}</span>
          </div>
          <div class="chat-msg-text">${escapeHtml(msg.text)}</div>
        </div>
      `;

      listEl.appendChild(row);
    });

    // Auto-scroll to latest message
    listEl.scrollTop = listEl.scrollHeight;
  }

  async function sendMessage() {
    if (!inputEl) return;
    const text = inputEl.value.trim();
    if (!text) return;

    const now = Date.now();
    if (now - lastSentTime < COOLDOWN_MS) {
      const waitSec = Math.ceil((COOLDOWN_MS - (now - lastSentTime)) / 1000);
      showToast(`⏳ Please wait ${waitSec}s before sending another message.`);
      return;
    }

    const state = Store.get();
    const senderName = state?.player?.name || "Traveler";
    const senderId = state?.player?.id;

    if (!senderId || senderId.startsWith("guest-")) {
      showToast("️ Sign in with Google to chat!", 3000);
      return;
    }

    // Check chat eligibility (50 plots required)
    if (typeof ServerAntiCheat !== "undefined" && ServerAntiCheat.isReady()) {
      try {
        const eligibility = await ServerAntiCheat.checkChatEligibility();
        if (!eligibility.chatUnlocked) {
          showToast(` Chat locked! Own ${eligibility.plotsNeeded} more plots to unlock (${eligibility.plotCount}/10).`, 4000);
          return;
        }
      } catch (e) {
        console.warn("[Chat] Eligibility check failed:", e);
      }
    }

    inputEl.value = "";
    lastSentTime = now;

    // Use server-side filtering
    if (typeof ServerAntiCheat !== "undefined" && ServerAntiCheat.isReady()) {
      try {
        const result = await ServerAntiCheat.filterChatMessage(text, senderName);
        if (!result.allowed) {
          showToast(`⚠️ ${result.reason}`, 3500);
          return;
        }
        if (result.filtered) {
          showToast("⚠️ Your message contained filtered words.", 2500);
        }
      } catch (err) {
        console.warn("[Chat] Server filter failed:", err);
        showToast("⚠️ Chat unavailable. Try again.", 3000);
      }
    } else {
      // Fallback: local filter (legacy)
      const db = Store.getDb();
      if (!db) {
        showToast("Database unavailable. Please check your connection.");
        return;
      }
      const cleanText = filterProfanity(text).slice(0, 120);
      try {
        await db.collection("chat").add({
          text: cleanText,
          senderId,
          senderName,
          timestamp: now,
          filtered: true,
        });
      } catch (err) {
        console.warn("[Chat] Send failed:", err);
      }
    }
  }

  function listen() {
    const db = Store.getDb();
    if (!db) return;

    if (!localStorage.getItem("eldenEarth.lastChatRead.v1")) {
      localStorage.setItem("eldenEarth.lastChatRead.v1", Date.now().toString());
    }

    try {
      db.collection("chat")
        .orderBy("timestamp", "desc")
        .limit(MAX_MESSAGES)
        .onSnapshot((snapshot) => {
          const lastReadTime = parseInt(
            localStorage.getItem("eldenEarth.lastChatRead.v1") || "0",
            10
          );
          let unreadCount = 0;

          const state = Store.get();
          const myId = state?.player?.id;

          messages.length = 0;

          snapshot.forEach((doc) => {
            const data = doc.data();
            const message = JSON.parse(JSON.stringify(data));

            // Auto-remove filtered messages after 5 seconds (client-side)
            if (message.filtered && message.autoDeleteAt) {
              const delay = message.autoDeleteAt - Date.now();
              if (delay > 0 && delay < 10000) {
                setTimeout(() => {
                  const idx = messages.findIndex(m => m.timestamp === message.timestamp);
                  if (idx >= 0) {
                    messages.splice(idx, 1);
                    renderMessages();
                  }
                }, delay);
              }
            }

            messages.unshift(message);

            // Only count unread messages from OTHER players.
            if (
              !isOpen &&
              message.timestamp &&
              message.timestamp > lastReadTime &&
              message.senderId !== myId
            ) {
              unreadCount++;
            }
          });

          renderMessages();

          if (!isOpen && unreadBadge) {
            if (unreadCount > 0) {
              unreadBadge.textContent =
                unreadCount > 9 ? "9+" : unreadCount.toString();
              unreadBadge.classList.remove("hidden");
            } else {
              unreadBadge.classList.add("hidden");
            }
          }
        });
    } catch (e) {
      console.warn("[Chat] Sync notice:", e);
    }
  }
  
  // --- REAL-TIME PRESENCE & ONLINE COUNT ENGINE ---
  async function sendHeartbeat() {
    if (document.hidden) return; // 0% network in pocket
    const db = Store.getDb();
    const state = Store.get();
    if (!db || !state?.player?.id) return;

    try {
      await db.collection("presence").doc(state.player.id).set({
        lastSeen: Date.now(),
        name: state.player.name || "Traveler"
      }, { merge: true });
    } catch (e) {}
  }

  async function updateOnlineCount() {
    const db = Store.getDb();
    if (!db || !onlineCountEl) return;

    try {
      // Any player active in the last 2.5 minutes is considered Online
      const threshold = Date.now() - 150000;
      const snap = await db.collection("presence").where("lastSeen", ">", threshold).get();
      const count = Math.max(1, snap.size);
      onlineCountEl.textContent = count;
    } catch (e) {
      console.warn("[Chat] Online count notice:", e);
    }
  }

  // --- Android keyboard handling ---
  // --kb-inset is only "how far the fixed bottom UI must rise ON TOP OF any
  // layout-viewport resize that already happened". Four signals, best first:
  //   1. MainActivity.setupKeyboardResize() pads the WebView with the real IME
  //      height, so the LAYOUT viewport shrinks and fixed bottom UI rises on
  //      its own -> inset 0;
  //   2. viewport meta `interactive-widget=resizes-content` (Chrome/WebView
  //      108+) does the same in browsers -> inset 0;
  //   3. visualViewport reports the overlap when the IME merely overlays the
  //      page (iOS Safari, non-resizing WebViews);
  //   4. applyKeyboardGuess() when nothing is reported at all.
  // The guess is remembered until blur or a real signal arrives, because the
  // keyboard animates in over ~300ms and a late resize/scroll event used to
  // wipe it back to 0 and hide the input again.
  function noteBaseHeight(force) {
    // Not trustworthy while the keyboard is open: the window may already have
    // been resized for the IME, and that shrunken height is not the baseline.
    if (!force && inputEl && document.activeElement === inputEl) return;
    if (window.innerHeight <= 0) return;
    baseInnerHeight = force ? window.innerHeight : Math.max(baseInnerHeight, window.innerHeight);
  }

  function layoutAlreadyResized() {
    return baseInnerHeight > 0 && baseInnerHeight - window.innerHeight > 40;
  }

  function applyKeyboardInset() {
    if (!drawer) return;
    const vv = window.visualViewport;
    // +12px margin: keyboards with suggestion strips (Gboard "Suggest strong
    // password") report slightly less than they actually cover.
    const overlay = vv ? Math.max(0, window.innerHeight - vv.height - vv.offsetTop) : 0;
    let inset = 0;
    if (overlay > 40) {
      kbGuessPx = 0;
      inset = overlay + 12;
    } else if (kbGuessPx > 0 && !layoutAlreadyResized() && document.activeElement === inputEl) {
      inset = kbGuessPx;
    }
    drawer.style.setProperty("--kb-inset", `${inset}px`);
  }

  // No-signal fallback: assume the on-screen keyboard covers the lower ~45% of
  // the screen (typical Android IME plus its suggestion strip). Overshooting is
  // safe — the input just sits a little higher.
  function applyKeyboardGuess() {
    if (!drawer || !inputEl || document.activeElement !== inputEl) return;
    const vv = window.visualViewport;
    if (vv && window.innerHeight - vv.height > 40) return; // real signal won
    if (layoutAlreadyResized()) return; // viewport already shrank for the IME
    // Hardware-keyboard desktops never show an IME. Pointer type alone is not
    // reliable here — emulators and stylus/tablet setups report a fine pointer —
    // so only skip when it is definitely a desktop UA as well.
    const finePointer = window.matchMedia && window.matchMedia("(hover: hover) and (pointer: fine)").matches;
    const mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || "");
    if (finePointer && !mobile) return;
    kbGuessPx = Math.round((baseInnerHeight || window.innerHeight) * 0.45);
    applyKeyboardInset();
  }

  function startKeyboardTracking() {
    if (!inputEl) return;
    applyKeyboardInset();
    // The IME animates in and often reports nothing at all in an immersive
    // WebView, so keep guessing until a real signal or blur settles it.
    clearInterval(kbGuessTimer);
    kbGuessTimer = setInterval(applyKeyboardGuess, 250);
    applyKeyboardGuess();
    setTimeout(() => inputEl.scrollIntoView({ block: "nearest", behavior: "smooth" }), 350);
  }

  function stopKeyboardTracking() {
    clearInterval(kbGuessTimer);
    kbGuessTimer = null;
    kbGuessPx = 0;
    drawer?.style.setProperty("--kb-inset", "0px");
    // Re-read the height once the keyboard has finished closing.
    setTimeout(() => {
      noteBaseHeight();
      applyKeyboardInset();
    }, 300);
  }

  async function open() {
    if (!drawer) return;
    isOpen = true;
    drawer.classList.remove("hidden");
    applyKeyboardInset();
    
    // Mark all current messages as read in local storage!
    localStorage.setItem("eldenEarth.lastChatRead.v1", Date.now().toString());
    if (unreadBadge) {
      unreadBadge.textContent = "0";
      unreadBadge.classList.add("hidden");
    }

    // Check chat eligibility
    if (typeof ServerAntiCheat !== "undefined" && ServerAntiCheat.isReady() && inputEl && sendBtn) {
      try {
        const eligibility = await ServerAntiCheat.checkChatEligibility();
        if (!eligibility.chatUnlocked) {
          inputEl.disabled = true;
          inputEl.placeholder = `Chat locked (${eligibility.plotCount}/10 plots)`;
          sendBtn.disabled = true;
          sendBtn.style.opacity = "0.5";
          sendBtn.style.cursor = "not-allowed";
        } else {
          inputEl.disabled = false;
          inputEl.placeholder = "Type a message...";
          sendBtn.disabled = false;
          sendBtn.style.opacity = "1";
          sendBtn.style.cursor = "pointer";
        }
      } catch (e) {
        console.warn("[Chat] Eligibility check failed:", e);
      }
    }

    renderMessages();
    updateOnlineCount();
    setTimeout(() => {
      // focus() is a no-op if the input is already focused (no focus event), so
      // start tracking explicitly rather than relying on the listener alone.
      if (document.activeElement !== inputEl) inputEl?.focus();
      startKeyboardTracking();
    }, 250);
  }

  function close() {
    if (!drawer) return;
    isOpen = false;
    stopKeyboardTracking();
    drawer.classList.add("hidden");
    drawer.style.setProperty("--kb-inset", "0px");
  }

  function init() {
    drawer = document.getElementById("chat-drawer");
    listEl = document.getElementById("chat-messages-list");
    inputEl = document.getElementById("chat-input");
    sendBtn = document.getElementById("chat-send-btn");
    unreadBadge = document.getElementById("chat-unread-badge");

    document.getElementById("chat-hud-btn")?.addEventListener("click", open);
    document.getElementById("close-chat-btn")?.addEventListener("click", close);
    document.getElementById("chat-drawer-overlay")?.addEventListener("click", close);

    sendBtn?.addEventListener("click", sendMessage);
    inputEl?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") sendMessage();
    });

    // Keep the input above the Android keyboard (see applyKeyboardInset).
    noteBaseHeight(true);
    if (window.visualViewport) {
      window.visualViewport.addEventListener("resize", applyKeyboardInset);
      window.visualViewport.addEventListener("scroll", applyKeyboardInset);
    }
    window.addEventListener("resize", () => {
      noteBaseHeight();
      applyKeyboardInset();
    });
    // Rotation makes the old baseline wrong (it would block the guess forever),
    // so re-read it once the new viewport has settled.
    window.addEventListener("orientationchange", () => setTimeout(() => noteBaseHeight(true), 300));
    inputEl?.addEventListener("focus", startKeyboardTracking);
    inputEl?.addEventListener("blur", stopKeyboardTracking);

    // Cache online element & start heartbeat
    onlineCountEl = document.getElementById("chat-online-count");
    sendHeartbeat();
    heartbeatTimer = setInterval(sendHeartbeat, PRESENCE_HEARTBEAT_MS);

    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) {
        sendHeartbeat();
        if (isOpen) updateOnlineCount();
      }
    });

    listen();
  }

  return { init, open, close };
})();
