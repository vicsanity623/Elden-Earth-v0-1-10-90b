// ============================================================
// Elden Earth — Game Menu engine (js/game-menu.js)
//
// Powers the Realm Menu modal (#menu-modal):
//   · tab switching (Home · Mail · Alerts · How to Play · Settings)
//   · live global UTC clock
//   · Settings: GPS mode (High Accuracy / Normal), Sound, Screen Shake
//   · Mail: dev gifts (global_mail) + one-claim-per-player via the
//     claimGlobalMail callable (server-side receipt, nothing client-trusted)
//   · Alerts: dev announcements with per-device "seen" state
//   · red bubble dots (#mail-tab-dot, #alerts-tab-dot, #menu-unread-dot)
//   · website shortcuts: player profile + transaction history
// ============================================================
(function () {
  "use strict";

  var MAIL_SEEN_KEY = "eldenEarth.seenAlerts.v1";   // JSON array of seen alert ids
  var TUTORIAL_KEY = "eldenEarth.tutorialViewed.v1";
  var GPS_KEY = "eldenEarth.gpsMode";               // "high" | "normal"
  var SOUND_KEY = "eldenEarth.soundEnabled";        // "1" | "0"

  var PROFILE_URL = "https://vicsanity623.github.io/Elden-Earth-v0-1-10-90b/player.html";
  var HISTORY_URL = PROFILE_URL + "#transaction-history";

  var mailItems = [];      // type "gift"
  var alertItems = [];     // type "alert"
  var claims = {};         // mailId -> claim record
  var loaded = false;
  var audioCtx = null;

  // ---------- helpers ----------
  function $(id) { return document.getElementById(id); }
  function show(el) { if (el) el.classList.remove("hidden"); }
  function hide(el) { if (el) el.classList.add("hidden"); }
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }
  function seenAlerts() {
    try { return new Set(JSON.parse(localStorage.getItem(MAIL_SEEN_KEY) || "[]")); }
    catch (e) { return new Set(); }
  }
  function markAlertSeen(id) {
    var s = seenAlerts();
    s.add(String(id));
    try { localStorage.setItem(MAIL_SEEN_KEY, JSON.stringify(Array.from(s).slice(-200))); } catch (e) {}
  }
  function soundEnabled() { return localStorage.getItem(SOUND_KEY) !== "0"; }

  // Tiny WebAudio chime — no assets needed (the game had no audio system at
  // all before this; the Sound toggle was a dead control).
  function playTone(kind) {
    if (!soundEnabled()) return;
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      audioCtx = audioCtx || new AC();
      if (audioCtx.state === "suspended") audioCtx.resume();
      var t = audioCtx.currentTime;
      var notes = kind === "claim" ? [659, 880, 1174] : [523];
      notes.forEach(function (f, i) {
        var o = audioCtx.createOscillator(), g = audioCtx.createGain();
        o.type = "triangle";
        o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, t + i * 0.09);
        g.gain.exponentialRampToValueAtTime(0.16, t + i * 0.09 + 0.015);
        g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.09 + 0.22);
        o.connect(g).connect(audioCtx.destination);
        o.start(t + i * 0.09);
        o.stop(t + i * 0.09 + 0.25);
      });
    } catch (e) {}
  }

  // ---------- UTC clock ----------
  function tickClock() {
    var el = $("menu-utc-clock");
    if (!el) return;
    var d = new Date();
    var hh = String(d.getUTCHours()).padStart(2, "0");
    var mm = String(d.getUTCMinutes()).padStart(2, "0");
    var ss = String(d.getUTCSeconds()).padStart(2, "0");
    var date = d.toLocaleDateString("en-US", {
      timeZone: "UTC", weekday: "short", month: "short", day: "numeric", year: "numeric",
    });
    el.textContent = "🌐 " + hh + ":" + mm + ":" + ss + " UTC · " + date;
  }

  // ---------- red dots ----------
  function unclaimedCount() {
    return mailItems.filter(function (m) { return !claims[String(m.id)]; }).length;
  }
  function unseenAlertCount() {
    var seen = seenAlerts();
    return alertItems.filter(function (a) { return !seen.has(String(a.id)); }).length;
  }
  function refreshDots() {
    var mailDot = $("mail-tab-dot");
    var alertDot = $("alerts-tab-dot");
    if (mailDot) mailDot.classList.toggle("hidden", unclaimedCount() === 0);
    if (alertDot) alertDot.classList.toggle("hidden", unseenAlertCount() === 0);
    refreshMenuDot();
  }
  // The big dot on the menu BUTTON: tutorial unseen OR unclaimed gifts OR
  // unseen alerts (js/main.js also drives it for the tutorial part).
  function refreshMenuDot() {
    var dot = $("menu-unread-dot");
    if (!dot) return;
    var tutorialUnseen = !localStorage.getItem(TUTORIAL_KEY);
    if (tutorialUnseen || unclaimedCount() > 0 || unseenAlertCount() > 0) show(dot);
    else hide(dot);
  }

  // ---------- tabs ----------
  function activateTab(name) {
    document.querySelectorAll("#menu-tabs .menu-tab").forEach(function (b) {
      b.classList.toggle("active", b.getAttribute("data-tab") === name);
    });
    document.querySelectorAll("#menu-modal .menu-panel").forEach(function (p) {
      p.classList.toggle("active", p.getAttribute("data-panel") === name);
    });
    playTone("tap");
    if (name === "mail") {
      // Visiting the tab acknowledges nothing — gifts stay bubbled until
      // claimed — but any alert the player has now seen clears its dot.
    }
    if (name === "alerts") {
      alertItems.forEach(function (a) { markAlertSeen(a.id); });
      refreshDots();
    }
  }

  // ---------- mail + alerts ----------
  function rewardChip(icon, label, amount) {
    return '<span class="mail-reward-chip">' + icon + " " + esc(label) + " ×" + esc(String(amount)) + "</span>";
  }
  function rewardChips(r) {
    var out = [];
    if (!r) return "";
    if (Number(r.eb) > 0) out.push(rewardChip("🪙", "EB", r.eb));
    if (Number(r.diamonds) > 0) out.push(rewardChip("💎", "Diamonds", r.diamonds));
    if (Number(r.berries) > 0) out.push(rewardChip("🍓", "Berries", r.berries));
    if (Number(r.eldenStopSeeds) > 0) out.push(rewardChip("🌱", "Elden Stop Seeds", r.eldenStopSeeds));
    if (Number(r.rp) > 0) out.push(rewardChip("⭐", "RP", r.rp));
    return out.length ? '<div class="mail-rewards">' + out.join("") + "</div>" : "";
  }
  function whenLabel(ts) {
    var d = new Date(Number(ts) || 0);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  }

  function renderMail() {
    var box = $("mail-list");
    if (!box) return;
    if (!mailItems.length) {
      box.innerHTML = '<div class="mail-empty">📭 No gifts right now — the dev mails players here when there is something to celebrate.</div>';
      return;
    }
    box.innerHTML = mailItems.map(function (m) {
      var claimed = !!claims[String(m.id)];
      return (
        '<div class="mail-card' + (claimed ? "" : " unclaimed") + '">' +
        '<div class="mail-card-head">' +
        '<span class="mail-card-icon">🎁</span>' +
        '<span class="mail-card-title">' + esc(m.title || "Gift from the Dev") + "</span>" +
        '<span class="mail-card-date">' + esc(whenLabel(m.createdAt)) + "</span>" +
        "</div>" +
        '<div class="mail-card-body">' + esc(m.body || m.summary || "") + "</div>" +
        rewardChips(m.rewards) +
        '<button class="mail-claim-btn' + (claimed ? " claimed" : "") + '" data-claim="' + esc(m.id) + '"' +
        (claimed ? " disabled" : "") + ">" + (claimed ? "✓ Claimed" : "CLAIM GIFT") + "</button>" +
        "</div>"
      );
    }).join("");
  }

  function renderAlerts() {
    var box = $("alerts-list");
    if (!box) return;
    if (!alertItems.length) {
      box.innerHTML = '<div class="mail-empty">🚨 No alerts yet — major updates and announcements will appear here.</div>';
      return;
    }
    var seen = seenAlerts();
    box.innerHTML = alertItems.map(function (a) {
      return (
        '<div class="mail-card' + (seen.has(String(a.id)) ? "" : " alert-new") + '">' +
        '<div class="mail-card-head">' +
        '<span class="mail-card-icon">🚨</span>' +
        '<span class="mail-card-title">' + esc(a.title || "Game Update") + "</span>" +
        '<span class="mail-card-date">' + esc(whenLabel(a.createdAt)) + "</span>" +
        "</div>" +
        '<div class="mail-card-body">' + esc(a.body || a.summary || "") + "</div>" +
        "</div>"
      );
    }).join("");
  }

  function loadMailbox() {
    if (loaded || typeof firebase === "undefined" || !firebase.firestore) return;
    var user = firebase.auth && firebase.auth().currentUser;
    if (!user) return;
    loaded = true;
    var db = firebase.firestore();
    db.collection("global_mail").orderBy("createdAt", "desc").limit(50).get().then(function (snap) {
      mailItems = [];
      alertItems = [];
      snap.docs.forEach(function (d) {
        var m = d.data() || {};
        m.id = d.id;
        if (m.active === false) return;
        if (m.type === "alert") alertItems.push(m);
        else mailItems.push(m);
      });
      renderMail();
      renderAlerts();
      refreshDots();
    }).catch(function () {
      loaded = false; // allow retry on next open
    });
    db.collection("global_mail_claims").where("uid", "==", user.uid).limit(200).get().then(function (snap) {
      snap.docs.forEach(function (d) {
        var c = d.data() || {};
        if (c.mailId) claims[String(c.mailId)] = c;
      });
      renderMail();
      refreshDots();
    }).catch(function () {});
  }

  function claimGift(mailId, btn) {
    if (!mailId || (btn && btn.disabled)) return;
    if (typeof firebase === "undefined" || !firebase.functions) {
      if (typeof showToast === "function") showToast("⚠️ Server connection required.", 3500);
      return;
    }
    if (btn) { btn.disabled = true; btn.textContent = "CLAIMING…"; }
    var fn = firebase.functions().httpsCallable("claimGlobalMail");
    fn({ mailId: String(mailId) }).then(function (res) {
      var r = (res && res.data) || {};
      if (!r.ok) {
        if (r.reason === "already_claimed") {
          claims[String(mailId)] = { uid: "me", mailId: String(mailId) };
          renderMail();
          refreshDots();
        } else {
          if (btn) { btn.disabled = false; btn.textContent = "CLAIM GIFT"; }
          if (typeof showToast === "function") showToast("⚠️ Gift could not be claimed (" + esc(r.reason || "error") + ").", 4000);
        }
        return;
      }
      claims[String(mailId)] = { uid: "me", mailId: String(mailId) };
      // Apply server-returned totals immediately (server is the authority).
      try {
        var st = (typeof Store !== "undefined" && Store.get) ? Store.get() : null;
        if (st && r.next) {
          if (r.next.eb !== undefined) st.eb = Math.max(0, Number(r.next.eb) || 0);
          if (r.next.diamonds !== undefined) st.diamonds = Math.max(0, Number(r.next.diamonds) || 0);
          if (r.next.berries !== undefined) st.berries = Math.max(0, Number(r.next.berries) || 0);
          if (r.next.eldenStopSeeds !== undefined) st.eldenStopSeeds = Math.max(0, Number(r.next.eldenStopSeeds) || 0);
          if (r.next.rewardPoints !== undefined) st.rewardPoints = Math.max(0, Number(r.next.rewardPoints) || 0);
          if (typeof Store.save === "function") Store.save(true);
        }
      } catch (e) {}
      renderMail();
      refreshDots();
      playTone("claim");
      if (typeof updateTopbar === "function") updateTopbar();
      if (typeof CompanionPet !== "undefined" && CompanionPet.updatePetHUD) CompanionPet.updatePetHUD();
      if (typeof showToast === "function") showToast("🎁 " + (r.title || "Gift") + " claimed!", 4500);
    }).catch(function () {
      if (btn) { btn.disabled = false; btn.textContent = "CLAIM GIFT"; }
      if (typeof showToast === "function") showToast("⚠️ Gift could not be claimed.", 4000);
    });
  }

  // ---------- settings ----------
  function gpsMode() {
    return localStorage.getItem(GPS_KEY) === "normal" ? "normal" : "high";
  }
  function applyGpsUI() {
    document.querySelectorAll(".gps-mode-btn").forEach(function (b) {
      b.classList.toggle("active", b.getAttribute("data-gps") === gpsMode());
    });
  }
  function setGpsMode(mode) {
    try { localStorage.setItem(GPS_KEY, mode === "normal" ? "normal" : "high"); } catch (e) {}
    applyGpsUI();
    playTone("tap");
    // Restart the watcher so the new accuracy takes effect immediately.
    try { if (typeof window.restartGpsWatch === "function") window.restartGpsWatch(); } catch (e) {}
    if (typeof showToast === "function") {
      showToast(mode === "normal"
        ? "🔋 GPS: Normal (battery saver) — slightly less precise."
        : "🎯 GPS: High Accuracy — best precision for claiming plots.", 3500);
    }
  }

  function wireSettings() {
    // GPS mode
    applyGpsUI();
    document.querySelectorAll(".gps-mode-btn").forEach(function (b) {
      b.addEventListener("click", function () {
        setGpsMode(b.getAttribute("data-gps") === "normal" ? "normal" : "high");
      });
    });

    // Sound (was a dead control — now persisted and actually gates audio)
    var audio = $("audio-toggle");
    if (audio) {
      audio.checked = soundEnabled();
      audio.addEventListener("change", function () {
        try { localStorage.setItem(SOUND_KEY, audio.checked ? "1" : "0"); } catch (e) {}
        if (audio.checked) playTone("tap");
      });
    }

    // Screen shake (game pref on the save: state.disableShake)
    var shake = $("shake-toggle");
    if (shake) {
      try {
        var st = (typeof Store !== "undefined" && Store.get) ? Store.get() : null;
        if (st) shake.checked = !st.disableShake;
      } catch (e) {}
      shake.addEventListener("change", function () {
        try {
          var st2 = (typeof Store !== "undefined" && Store.get) ? Store.get() : null;
          if (st2) {
            st2.disableShake = !shake.checked;
            if (typeof Store.save === "function") Store.save(true);
          }
        } catch (e) {}
        playTone("tap");
      });
    }
  }

  // ---------- website shortcuts ----------
  function openExternal(url) {
    // Opens the player's browser (outside the app) — the same way the
    // Discord card works, but done via a synthetic anchor so it works from
    // buttons too.
    var a = document.createElement("a");
    a.href = url;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  // ---------- boot ----------
  function init() {
    tickClock();
    setInterval(tickClock, 1000);

    var tabs = $("menu-tabs");
    if (tabs) {
      tabs.addEventListener("click", function (e) {
        var btn = e.target.closest(".menu-tab");
        if (btn) activateTab(btn.getAttribute("data-tab"));
      });
    }

    // Claim buttons (delegated — the list re-renders)
    var mailBox = $("mail-list");
    if (mailBox) {
      mailBox.addEventListener("click", function (e) {
        var btn = e.target.closest("[data-claim]");
        if (btn) claimGift(btn.getAttribute("data-claim"), btn);
      });
    }

    var profileBtn = $("menu-profile-btn");
    if (profileBtn) profileBtn.addEventListener("click", function () { openExternal(PROFILE_URL); });
    var historyBtn = $("menu-history-btn");
    if (historyBtn) historyBtn.addEventListener("click", function () { openExternal(HISTORY_URL); });

    wireSettings();

    // Mail/alerts arrive once signed in (and refresh every time the menu
    // opens so a fresh gift shows up without a restart).
    if (typeof firebase !== "undefined" && firebase.auth) {
      firebase.auth().onAuthStateChanged(function (user) {
        if (user) { loaded = false; loadMailbox(); }
      });
    }
    document.addEventListener("visibilitychange", function () {
      if (!document.hidden) { loaded = false; loadMailbox(); }
    });

    // Re-assert the button dot whenever the menu closes as well — main.js
    // hides it on open, but unclaimed gifts should keep nagging.
    var modal = $("menu-modal");
    if (modal && typeof MutationObserver !== "undefined") {
      new MutationObserver(function () {
        if (modal.classList.contains("hidden")) refreshMenuDot();
      }).observe(modal, { attributes: true, attributeFilter: ["class"] });
    }

    refreshMenuDot();
    if (typeof firebase !== "undefined" && firebase.auth && firebase.auth().currentUser) loadMailbox();
  }

  window.GameMenu = {
    init: init,
    refreshMenuDot: refreshMenuDot,
    refresh: function () { loaded = false; loadMailbox(); },
    playTone: playTone,
    gpsMode: gpsMode,
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
