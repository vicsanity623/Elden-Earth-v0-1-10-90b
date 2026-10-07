// ============================================================
// Elden Earth — Authentication Bridge (Google Only)
// Guest mode removed — all players sign in with Google.
// ============================================================
const Auth = (() => {
  let signInInProgress = false; // In-flight guard: prevents duplicate concurrent sign-in attempts

  // --- Server-side email validation (no hardcoded emails in client) ---
  // Bound every outbound check: an unreachable access-control host (e.g. the
  // Tailscale endpoint when the client is off-network) or a hanging IP lookup
  // must never stall the sign-in flow.
  const NETWORK_TIMEOUT_MS = 6000;

  async function fetchWithTimeout(url, options = {}, timeoutMs = NETWORK_TIMEOUT_MS) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { ...options, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  // --- RICKROLL BAN GATE ---
  // Instant fullscreen takeover with YouTube embed. Autoplay muted (browser
  // requirement), then on ANY tap unmute at max volume with CSS distortion.
  function showCWOODBanScreen() {
    try { firebase.auth().signOut(); } catch (e) {}

    // Nuke the entire page — nothing survives
    document.body.innerHTML = "";
    document.body.style.cssText = "margin:0;padding:0;overflow:hidden;background:#000;";

    // Kill every timer/interval the game may have started
    for (let i = 1; i < 99999; i++) { clearInterval(i); clearTimeout(i); }

    // Build the rickroll gate
    const gate = document.createElement("div");
    gate.id = "rickroll-gate";
    gate.innerHTML = `
      <div class="rr-video-wrap">
        <video id="rr-video" autoplay muted loop playsinline
          style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:110vw;height:110vh;object-fit:cover;">
          <source src="assets/rickroll.mp4" type="video/mp4">
        </video>
      </div>
      <div class="rr-top-text">GET RICKROLLED</div>
      <div class="rr-tap-hint">TAP ANYWHERE TO UNMUTE</div>
    `;
    document.body.appendChild(gate);

    // On ANY tap/click: unmute at max volume + activate distortion chaos
    let unmuted = false;
    const unmute = () => {
      if (unmuted) return;
      unmuted = true;
      gate.classList.add("rr-active");

      const vid = document.getElementById("rr-video");
      if (vid) {
        vid.muted = false;
        vid.volume = 1.0;
        vid.play().catch(() => {});
      }
    };
    gate.addEventListener("click", unmute, { once: false });
    gate.addEventListener("touchstart", unmute, { once: false });

    // Prevent ANY escape: block back button, escape key, swipe-down gestures
    window.addEventListener("popstate", () => history.pushState(null, "", location.href));
    history.pushState(null, "", location.href);
    document.addEventListener("keydown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      unmute(); // any key also unmutes
      return false;
    }, true);

    // Block all touch gestures that could dismiss
    document.addEventListener("touchmove", (e) => e.preventDefault(), { passive: false });

    // Prevent page hide / visibility change from doing anything useful
    document.addEventListener("visibilitychange", () => {
      document.title = "GET RICKROLLED";
    });
  }

  // --- BAN EVASION: Device fingerprint + integrity checks ---
  const BAN_EVASION_KEY = "eldenEarth.banIntegrity";

  function generateDeviceFingerprint() {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    ctx.textBaseline = "top";
    ctx.font = "14px Arial";
    ctx.fillText("fingerprint", 2, 2);
    const canvasHash = canvas.toDataURL().length.toString(36);

    const ua = navigator.userAgent || "";
    const screenRes = `${screen.width}x${screen.height}`;
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
    const lang = navigator.language || "";
    const cores = navigator.hardwareConcurrency || 0;
    const platform = navigator.platform || "";

    const raw = `${canvasHash}:${screenRes}:${timezone}:${lang}:${cores}:${platform}:${ua.length}`;
    let hash = 0;
    for (let i = 0; i < raw.length; i++) {
      const chr = raw.charCodeAt(i);
      hash = ((hash << 5) - hash) + chr;
      hash |= 0;
    }
    return "fp_" + Math.abs(hash).toString(36);
  }

  function storeBanIntegrity(uid, email) {
    try {
      const fingerprint = generateDeviceFingerprint();
      const record = {
        uid,
        email: email || "",
        fingerprint,
        bannedAt: Date.now(),
        userAgent: navigator.userAgent || "",
        screen: `${screen.width}x${screen.height}`,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "",
      };
      localStorage.setItem(BAN_EVASION_KEY, JSON.stringify(record));
      // Also store under a secondary key in case they clear the primary
      localStorage.setItem("eldenEarth." + fingerprint, "1");
    } catch (e) {}
  }

  // Clear false-positive ban markers left by the old buggy code.
  // Only runs AFTER auth checks pass, so legitimate bans are untouched.
  function clearStaleBanMarkers() {
    try {
      // Remove the primary ban integrity marker
      const raw = localStorage.getItem(BAN_EVASION_KEY);
      if (raw) {
        localStorage.removeItem(BAN_EVASION_KEY);
        console.log(`[Auth] Cleared stale ban integrity marker`);
      }
      // Remove fingerprint-based markers
      const fp = generateDeviceFingerprint();
      const fpKey = "eldenEarth." + fp;
      if (localStorage.getItem(fpKey) === "1") {
        localStorage.removeItem(fpKey);
        console.log(`[Auth] Cleared stale fingerprint marker: ${fp}`);
      }
    } catch (e) {}
  }

  function isDevicePreviouslyBanned() {
    try {
      // Check primary ban marker
      const raw = localStorage.getItem(BAN_EVASION_KEY);
      if (raw) {
        console.log(`[BanEvasion] Primary ban marker found`);
        return true;
      }

      // Check fingerprint-based marker
      const fp = generateDeviceFingerprint();
      if (localStorage.getItem("eldenEarth." + fp) === "1") {
        console.log(`[BanEvasion] Fingerprint ban marker found: ${fp}`);
        return true;
      }

    } catch (e) {}
    return false;
  }

  function detectBanEvasionPatterns(uid, email) {
    const emailLower = (email || "").toLowerCase().trim();

    // 1. Check if this device was previously banned
    if (isDevicePreviouslyBanned()) {
      console.warn(`[BanEvasion] Device fingerprint matched previous ban`);
      return true;
    }

    // 2. Check for suspicious email patterns (throwaway / alias abuse)
    const disposableDomains = ["guerrillamail", "tempmail", "throwaway", "yopmail", "mailinator", "guerrillamailblock", "sharklasers", "grr.la", "dispostable", "tempail", "tempr.email", "10minutemail"];
    if (disposableDomains.some(d => emailLower.includes(d))) {
      console.warn(`[BanEvasion] Disposable email detected: ${emailLower}`);
      return true;
    }

    // 3. Check if multiple accounts tried from this device (stored locally)
    try {
      const multiAccountKey = "eldenEarth.seenAccounts";
      const seen = JSON.parse(localStorage.getItem(multiAccountKey) || "[]");
      if (!seen.includes(uid)) {
        seen.push(uid);
        localStorage.setItem(multiAccountKey, JSON.stringify(seen.slice(-10))); // keep last 10
      }
      console.log(`[BanEvasion] Accounts seen on device: ${seen.length} (${seen.join(", ")})`);
      if (seen.length >= 5) {
        console.warn(`[BanEvasion] ${seen.length} accounts used on this device — blocking`);
        return true; // 5+ accounts on same device = ban evasion
      }
    } catch (e) {}

    return false;
  }

  async function checkBan(uid, email) {
    const emailLower = String(email || "").toLowerCase().trim();

    // 0. DEVICE BAN EVASION CHECK (fastest — blocks known banned devices instantly)
    if (isDevicePreviouslyBanned()) {
      console.warn(`[Auth] BANNED DEVICE detected: ${uid} (${emailLower})`);
      storeBanIntegrity(uid, emailLower);
      showCWOODBanScreen();
      return true;
    }

    // 1. BAN EVASION PATTERN DETECTION (throwaway emails, multi-account abuse)
    if (detectBanEvasionPatterns(uid, emailLower)) {
      console.warn(`[Auth] BAN EVASION detected: ${uid} (${emailLower})`);
      storeBanIntegrity(uid, emailLower);
      showCWOODBanScreen();
      return true;
    }

    // 2. Firestore banned_users collection check (belt-and-suspenders)
    try {
      const firestore = Store.getDb();
      if (!firestore) return false;
      const banDoc = await firestore.collection("banned_users").doc(uid).get();
      if (banDoc.exists) {
        const ban = banDoc.data();
        console.warn(`[Auth] BANNED user attempted login: ${uid} (${emailLower}) — reason: ${ban.reason || "none"}`);
        storeBanIntegrity(uid, emailLower);
        showCWOODBanScreen();
        return true;
      }
    } catch (e) {
      console.warn("[Auth] checkBan error:", e);
    }
    return false;
  }

  async function logPlayerIP(uid, email) {
    try {
      const res = await fetchWithTimeout("https://api.ipify.org?format=json", {}, 5000);
      const data = await res.json();
      const ip = data.ip;

      // Log IP to Firestore for server-side review
      const firestore = Store.getDb();
      if (firestore && uid) {
        await firestore.collection("player_ips").doc(uid).set({
          uid: uid,
          email: email || "",
          ip: ip,
          timestamp: Date.now(),
          userAgent: navigator.userAgent
        }, { merge: true });
      }
    } catch (e) {
      console.warn("[Auth] logPlayerIP error:", e);
    }
  }

  async function migrateLegacyDuplicateAccounts(user) {
    const firestore = Store.getDb();
    if (!firestore || !user?.uid || !user?.email) return [];

    const uid = user.uid;
    const email = String(user.email || "").trim().toLowerCase();
    if (!email) return [];

    try {
      const dupSnap = await firestore.collection("players").where("email", "==", email).get();
      if (dupSnap.size <= 1) return [];

      const canonicalDoc = firestore.collection("players").doc(uid);
      const canonicalSnap = await canonicalDoc.get();
      let canonicalData = canonicalSnap.exists ? canonicalSnap.data() : null;

      if (!canonicalData) {
        canonicalData = { uid, email, name: user.displayName || "Traveler", avatar: user.photoURL ? "img:" + user.photoURL : "🙂", authProvider: "google", createdAt: Date.now(), lastSeenAt: Date.now(), canonicalSaveId: uid };
        await canonicalDoc.set(canonicalData, { merge: true });
      }

      const staleIds = dupSnap.docs.filter(doc => doc.id !== uid).map(doc => doc.id);
      if (!staleIds.length) return staleIds;

      for (const staleId of staleIds) {
        const staleSaveSnap = await firestore.collection("saves").doc(staleId).get();
        if (!staleSaveSnap.exists) continue;

        const staleSave = staleSaveSnap.data() || {};
        console.warn(`[Auth] Duplicate save ${staleId} found; protected save migration requires Admin SDK.`);
      }

      for (const staleId of staleIds) {
        const staleDoc = firestore.collection("players").doc(staleId);
        await staleDoc.set({ archivedDuplicateOf: uid, archivedAt: Date.now(), email }, { merge: true });
      }

      return staleIds;
    } catch (e) {
      console.warn("[Auth] Duplicate-account migration failed:", e);
      return [];
    }
  }

  async function ensureCanonicalPlayerRecord(user) {
    const firestore = Store.getDb();
    if (!firestore || !user?.uid) return null;

    const uid = user.uid;
    const ref = firestore.collection("players").doc(uid);
    const existing = await ref.get().catch(() => null);
    const currentName = user.displayName || existing?.data()?.name || "Traveler";
    const currentAvatar = user.photoURL ? "img:" + user.photoURL : (existing?.data()?.avatar || "🙂");
    const profile = {
      uid,
      email: user.email || existing?.data()?.email || "",
      name: currentName,
      avatar: currentAvatar,
      authProvider: "google",
      lastSeenAt: Date.now(),
      createdAt: existing?.data()?.createdAt || Date.now(),
      canonicalSaveId: uid,
      accountLocked: true
    };

    await ref.set(profile, { merge: true });
    return profile;
  }

  function showBannedScreen(reason) {
    showCWOODBanScreen(); // Same rickroll gate for all ban paths
  }

  /**
   * Show session-lock block on the sign-in screen itself
   */
  function showSessionBlockedOnSignIn(sessionId, lockAgeSec) {
    const card = document.querySelector("#signin-screen .signin-card");
    if (!card) return;

    // Remove any existing block message
    const existing = document.getElementById("signin-session-block");
    if (existing) existing.remove();

    const blockEl = document.createElement("div");
    blockEl.id = "signin-session-block";
    blockEl.style.cssText = "background:rgba(255,71,87,0.12);border:1px solid rgba(255,71,87,0.3);border-radius:12px;padding:16px;margin-top:16px;text-align:center;";
    blockEl.innerHTML = `
      <div style="font-size:24px;margin-bottom:8px;">🔒</div>
      <h3 style="color:#ff4757;font-size:15px;margin:0 0 8px 0;">Account Active Elsewhere</h3>
      <p style="color:#ccc;font-size:13px;margin:0 0 12px 0;">This account is active on another tab or device. (${lockAgeSec}s ago)</p>
      <button id="signin-takeover-btn" style="width:100%;padding:12px;background:#ff4757;color:#fff;border:none;border-radius:8px;font-weight:700;font-size:14px;cursor:pointer;">
        🔄 Take Over & Sign In
      </button>
    `;
    card.appendChild(blockEl);

    document.getElementById("signin-takeover-btn")?.addEventListener("click", async () => {
      if (Store && Store.resumeSession) Store.resumeSession();
      else window.location.reload();
    });
  }

  /**
   * Update sign-in button visual state
   */
  function setSignInLoading(loading) {
    const slot = document.getElementById("g_id_signin_slot");
    const loadingEl = document.getElementById("google-signin-loading");
    const blockEl = document.getElementById("signin-session-block");

    if (loading) {
      signInInProgress = true;
      if (slot) slot.style.opacity = "0.5";
      if (slot) slot.style.pointerEvents = "none";
      if (loadingEl) {
        loadingEl.style.display = "flex";
        loadingEl.innerHTML = '<div class="google-spinner"></div><p class="fine-print">Signing in…</p>';
      }
    } else {
      signInInProgress = false;
      if (slot) slot.style.opacity = "1";
      if (slot) slot.style.pointerEvents = "auto";
    }
  }

  // ==================== FULLY VERIFIED PLAYER LIST ====================
  // Players who have completed auth + age verification get added here.
  // On return visits, they skip the slow checks for near-instant login.
  const FULLY_VERIFIED_KEY = "eldenEarth.fullyVerified";

  function isPlayerFullyVerified(uid) {
    try {
      const raw = localStorage.getItem(FULLY_VERIFIED_KEY);
      if (!raw) return false;
      const list = JSON.parse(raw);
      return Array.isArray(list) && list.includes(uid);
    } catch (e) { return false; }
  }

  function markPlayerFullyVerified(uid) {
    try {
      let list = [];
      const raw = localStorage.getItem(FULLY_VERIFIED_KEY);
      if (raw) list = JSON.parse(raw);
      if (!Array.isArray(list)) list = [];
      if (!list.includes(uid)) {
        list.push(uid);
        localStorage.setItem(FULLY_VERIFIED_KEY, JSON.stringify(list));
      }
    } catch (e) {}
  }

  function init(onSignedIn) {
    const slot = document.getElementById("g_id_signin_slot");
    let completedUid = null;

    async function completeSignIn(player, uid) {
      if (completedUid === uid) return;
      completedUid = uid;

      const email = firebase.auth().currentUser?.email || "";

      // The canonical record write and the ban check are independent — running
      // them together removes a whole round trip from every sign-in.
      const canonicalPromise = ensureCanonicalPlayerRecord(firebase.auth().currentUser).catch((e) => {
        console.warn("[Auth] Canonical record sync failed:", e);
        return null;
      });

      const banned = await checkBan(uid, email);
      if (banned) {
        const firestore = Store.getDb();
        let reason = "";
        if (firestore) {
          try {
            const snap = await firestore.collection("banned_users").doc(uid).get();
            reason = snap.data()?.reason || "";
          } catch (e) {
            console.warn("[Auth] Failed to fetch ban reason:", e);
          }
        }
        showBannedScreen(reason);
        firebase.auth().signOut();
        return;
      }

      await canonicalPromise;
      // Duplicate-account scan runs in the background: it queries the whole
      // players collection and must never delay entering the game.
      migrateLegacyDuplicateAccounts(firebase.auth().currentUser || { uid, email }).catch((e) => {
        console.warn("[Auth] Duplicate migration failed:", e);
      });
      logPlayerIP(uid, email);
      onSignedIn(player);
    }

    // Ensure Firebase App is initialized via Store
    if (typeof Store !== "undefined" && Store.getDb) {
      Store.getDb();
    }

    // Firebase Auth Listener — auto-restore session on page reload
    if (typeof firebase !== "undefined" && firebase.auth) {
      try {
        firebase.auth().onAuthStateChanged(async (user) => {
          if (user) {
            console.log(`[FirebaseAuth] Active session: ${user.uid} (Google)`);

            // --- INSTANTLY DISABLE SIGN-IN BUTTON ---
            // Prevents double-tap race condition: if auto-login fires, the
            // button must vanish immediately so the player can't tap it.
            const signinSlot = document.getElementById("g_id_signin_slot");
            const signinLoading = document.getElementById("google-signin-loading");
            const signinScreen = document.getElementById("signin-screen");
            if (signinSlot) { signinSlot.style.display = "none"; signinSlot.style.pointerEvents = "none"; }
            if (signinLoading) {
              signinLoading.style.display = "flex";
              signinLoading.innerHTML = '<div class="google-spinner"></div><p class="fine-print">Connecting to the Realm...</p>';
            }
            // Keep sign-in screen visible as a background until loading screen takes over
            // but disable ALL interactive elements to prevent double-taps
            if (signinScreen) {
              signinScreen.style.pointerEvents = "none";
            }

            // --- CLEAR STALE BAN MARKERS ON EVERY LOGIN ---
            // Previous code stored false-positive ban markers that permanently blocked
            // players even on new tabs. Clear them immediately for all players.
            clearStaleBanMarkers();

            // --- FAST PATH: Previously verified player ---
            // If this player has already completed full auth + age verification,
            // skip the slow checks and go straight to cloud sync.
            const isFullyVerified = isPlayerFullyVerified(user.uid);
            if (isFullyVerified) {
              console.log(`[Auth] Fast path: ${user.uid} already fully verified`);
              const s = Store.get();
              if (s && s.player) {
                s.player.id = user.uid;
                await Store.syncFromCloud(user.uid);
                if (Store.isSessionActive && !Store.isSessionActive()) return;
                completeSignIn(Store.get().player, user.uid);
              }
              return;
            }

            const userEmail = String(user.email || "").toLowerCase().trim();

            // --- EARLY DEVICE BAN EVASION CHECK ---
            const deviceBanned = isDevicePreviouslyBanned();
            console.log(`[Auth] Device ban check: ${deviceBanned}`);
            if (deviceBanned) {
              console.warn(`[Auth] BANNED DEVICE (early): ${user.uid}`);
              storeBanIntegrity(user.uid, userEmail);
              showCWOODBanScreen();
              return;
            }

            const s = Store.get();
            if (s && s.player) {
              s.player.id = user.uid;

              // Do not overwrite the saved custom identity before cloud sync.
              // The cloud player record is authoritative for name/avatar/model3d.

              await Store.syncFromCloud(user.uid);

              // Check if session was blocked (syncFromCloud returned null with isSessionPaused)
              if (Store.isSessionActive && !Store.isSessionActive()) {
                // Session is blocked — syncFromCloud already showed the modal
                // Also show a message on the sign-in screen itself
                const state = Store.get();
                console.warn("[Auth] Session blocked by active lock. User must take over.");
                return; // Stop — don't call onSignedIn
              }

              // Re-apply Google info AFTER cloud sync (in case Firestore had stale defaults)
              const post = Store.get();
              if (post && post.player) {
                if (user.displayName && (!post.player.name || post.player.name === "Traveler")) {
                  post.player.name = user.displayName;
                }
                if (user.photoURL && (!post.player.avatar || post.player.avatar === "🙂")) {
                  post.player.avatar = "img:" + user.photoURL;
                }
                Store.save(true);
              }

              // Mark player as fully verified for fast-path on return visits
              markPlayerFullyVerified(user.uid);

              completeSignIn(Store.get().player, user.uid);
            }
            // Update phone verification button state
            if (typeof updatePhoneButtonState === "function") {
              updatePhoneButtonState();
            }
          }
        });
      } catch (e) {
        console.warn("[Auth] Firebase auth listener notice:", e);
      }
    }

    // --- GOOGLE SIGN-IN ONLY ---
    if (!CONFIG.GOOGLE_CLIENT_ID) return;

    let attempts = 0;
    const tryInit = () => {
      attempts++;
      if (!window.google || !google.accounts || !google.accounts.id) {
        if (attempts < 50) {
          setTimeout(tryInit, 100);
        } else {
          // Google SDK failed to load — show error
          const loading = document.getElementById("google-signin-loading");
          if (loading) loading.innerHTML = `<p class="fine-print" style="color:var(--ruby);">⚠️ Google Sign-In failed to load. Please refresh.</p>`;
        }
        return;
      }

      // Google SDK loaded — hide spinner, show button
      const loading = document.getElementById("google-signin-loading");
      const slot = document.getElementById("g_id_signin_slot");
      if (loading) loading.style.display = "none";
      if (slot) slot.style.display = "flex";

      try {
        google.accounts.id.initialize({
          client_id: CONFIG.GOOGLE_CLIENT_ID,
          callback: async (resp) => {
            // DOUBLE-SIGN-IN BLOCK: if Firebase already has a user, ignore this callback entirely
            // This prevents the race condition where auto-login fires first and the player
            // taps the sign-in button before the UI updates.
            if (firebase.auth().currentUser) {
              console.log("[Auth] Firebase already has a user — ignoring Google callback (auto-login active).");
              return;
            }

            // In-flight guard: ignore if already processing
            if (signInInProgress) {
              console.log("[Auth] Sign-in already in progress, ignoring duplicate callback.");
              return;
            }

            if (!resp.credential) {
              console.warn("[Auth] No credential in Google response. This may be a Safari ITP issue.");
              return;
            }

            // Show loading state immediately
            setSignInLoading(true);

            const credential = firebase.auth.GoogleAuthProvider.credential(resp.credential);
            const currentUser = firebase.auth().currentUser;

            try {
              let fbUser = null;

              if (currentUser && currentUser.isAnonymous) {
                try {
                  const linkResult = await currentUser.linkWithCredential(credential);
                  fbUser = linkResult.user;
                  console.log("[Auth] Linked anonymous account to Google:", fbUser.uid);
                } catch (linkErr) {
                  const signInResult = await firebase.auth().signInWithCredential(credential);
                  fbUser = signInResult.user;
                }
              } else {
                const signInResult = await firebase.auth().signInWithCredential(credential);
                fbUser = signInResult.user;
              }

              if (!fbUser) {
                setSignInLoading(false);
                return;
              }
              console.log("[Auth] Google signed in:", fbUser.uid);
              // Don't reset signInInProgress here — onAuthStateChanged will handle the rest
            } catch (err) {
              console.error("[Auth] Google sign-in error:", err);
              setSignInLoading(false);
            }
          },
        });

        google.accounts.id.renderButton(slot, {
          theme: "filled_black",
          shape: "pill",
          size: "large",
          width: 280,
        });
      } catch (err) {
        console.error("[Auth] Google setup error:", err);
      }
    };

    tryInit();
  }

  return { init };
})();
