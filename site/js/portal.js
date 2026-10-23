// ============================================================
// Elden Earth — Portal shared runtime
// Injects header/footer, signs players in with the SAME Google account
// as the game (shared Firebase session on this origin), shows the RP
// balance chip, and loads AdSense on content pages.
// ============================================================
(function () {
  "use strict";

  // Mirrors js/config.js — same Firebase project, so a sign-in here is a
  // sign-in inside the game (shared IndexedDB auth session per origin).
  var FIREBASE_CONFIG = {
    apiKey: "AIzaSyAf8u0qUQJaajJp4352-SrY7lIh8rNFPWY",
    authDomain: "elden-earth.firebaseapp.com",
    projectId: "elden-earth",
    storageBucket: "elden-earth.firebasestorage.app",
    messagingSenderId: "231253239262",
    appId: "1:231253239262:web:3fa1ca28575fcade15e94f",
  };
  var GOOGLE_CLIENT_ID = "231253239262-l1ep169u103iuitvl1i6gonrn2k9a69a.apps.googleusercontent.com";
  var ADSENSE_CLIENT = "ca-pub-5972331036113330";

  var NAV = [
    { href: "index.html", label: "Home" },
    { href: "game.html", label: "Play" },
    { href: "guides.html", label: "Guides" },
    { href: "community.html", label: "Community" },
    { href: "trade.html", label: "Trading" },
    { href: "rewards.html", label: "Rewards" },
    { href: "roadmap.html", label: "Roadmap" },
    { href: "downloads.html", label: "Downloads" },
    { href: "about.html", label: "About" },
  ];

  // Mount-point detection. The portal must work at the domain root
  // (elden-earth.web.app) AND under a sub-path (GitHub Pages project sites
  // live at /Elden-Earth-v0-1-10-90b/). Derive the base from this script's own
  // URL: .../<base>site/js/portal.js -> <base>.
  var BASE = (function () {
    try {
      var cur = document.currentScript;
      var src = (cur && cur.src) || "";
      var m = src.match(/^(.*)site\/js\/portal\.js(?:\?.*)?$/);
      if (m) return m[1];
      var scripts = document.getElementsByTagName("script");
      for (var i = 0; i < scripts.length; i++) {
        var m2 = (scripts[i].src || "").match(/^(.*)site\/js\/portal\.js(?:\?.*)?$/);
        if (m2) return m2[1];
      }
    } catch (e) {}
    return "/";
  })();

  function url(p) { return BASE + p; }

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function timeAgo(ts) {
    var s = Math.floor((Date.now() - Number(ts || 0)) / 1000);
    if (s < 60) return "just now";
    if (s < 3600) return Math.floor(s / 60) + "m ago";
    if (s < 86400) return Math.floor(s / 3600) + "h ago";
    return Math.floor(s / 86400) + "d ago";
  }

  function currentPage() {
    var path = location.pathname.split("/").pop() || "index.html";
    return path;
  }

  // ---------- Header / footer ----------
  function headerHTML() {
    var page = currentPage();
    var links = NAV.map(function (n) {
      var active = n.href.split("/").pop() === page ? " class=\"active\"" : "";
      return "<a href=\"" + url(n.href) + "\"" + active + ">" + n.label + "</a>";
    }).join("");
    return (
      "<header class=\"site-header\"><div class=\"bar\">" +
      "<a class=\"brand\" href=\"" + url("index.html") + "\">" +
      "<img src=\"" + url("assets/icon512.png") + "\" alt=\"Elden Earth icon\">" +
      "<span><span class=\"name\">Elden Earth</span><span class=\"tag\">Realm Portal</span></span>" +
      "</a>" +
      "<nav class=\"site-nav\">" + links + "</nav>" +
      "<div class=\"header-cta\">" +
      "<div class=\"auth-chip\" id=\"site-auth-chip\" title=\"Signed in — your Reward Points\">" +
      "<span id=\"site-auth-avatar\" class=\"chip-avatar\"></span><span id=\"site-auth-name\">Traveler</span>" +
      "<span class=\"rp\" id=\"site-auth-rp\">0 RP</span></div>" +
      "<button class=\"btn btn-primary btn-sm\" id=\"site-signin\">Sign in with Google</button>" +
      "<a class=\"btn btn-danger btn-sm\" href=\"" + url("game.html") + "\">▶ Play Now</a>" +
      "</div></div></header>"
    );
  }

  function footerHTML() {
    return (
      "<footer class=\"site-footer\"><div class=\"wrap\"><div class=\"footer-grid\">" +
      "<div><h4>Elden Earth</h4><p class=\"footer-note\">Walk the real world, claim the ground beneath your feet, and build a passive realm. Free to play in any browser — now in Google Play closed testing.</p></div>" +
      "<div><h4>Game</h4><ul>" +
      "<li><a href=\"" + url("game.html") + "\">Play in browser</a></li>" +
      "<li><a href=\"" + url("downloads.html") + "\">Downloads</a></li>" +
      "<li><a href=\"" + url("roadmap.html") + "\">Roadmap</a></li>" +
      "<li><a href=\"" + url("faq.html") + "\">FAQ</a></li></ul></div>" +
      "<div><h4>Learn</h4><ul>" +
      "<li><a href=\"" + url("guides/getting-started.html") + "\">Getting started</a></li>" +
      "<li><a href=\"" + url("guides/land-plots.html") + "\">Land &amp; plots</a></li>" +
      "<li><a href=\"" + url("trade.html") + "\">Trading</a></li>" +
      "<li><a href=\"" + url("rewards.html") + "\">Rewards &amp; RP</a></li></ul></div>" +
      "<div><h4>Legal &amp; Support</h4><ul>" +
      "<li><a href=\"" + url("privacy.html") + "\">Privacy policy</a></li>" +
      "<li><a href=\"" + url("rewards-terms.html") + "\">Rewards terms</a></li>" +
      "<li><a href=\"" + url("delete-account.html") + "\">Delete account</a></li>" +
      "<li><a href=\"" + url("about.html") + "\">Contact</a></li></ul></div>" +
      "</div><div class=\"footer-bottom\">" +
      "<span>© " + new Date().getFullYear() + " Elden Earth Studios. All rights reserved.</span>" +
      "<span>Free to play · No purchase necessary · Rewards availability varies by region</span>" +
      "</div></div></footer>"
    );
  }

  // ---------- Auth + RP ----------
  var authReadyCb = [];
  var currentUser = null;

  function whenAuthReady(cb) {
    if (currentUser !== null) cb(currentUser);
    else authReadyCb.push(cb);
  }

  function fireAuthReady(user) {
    currentUser = user;
    authReadyCb.splice(0).forEach(function (cb) { cb(user); });
  }

  function rpLabel(n) {
    return (Number(n) || 0).toLocaleString() + " RP";
  }

  function updateChip(user, rp) {
    var chip = document.getElementById("site-auth-chip");
    var btn = document.getElementById("site-signin");
    if (!chip || !btn) return;
    if (!user) {
      chip.classList.remove("visible");
      btn.classList.remove("hidden");
      return;
    }
    chip.classList.add("visible");
    btn.classList.add("hidden");
    // The IN-GAME identity wins — custom name + avatar, exactly like every
    // other surface in the game. The Google profile is only the fallback.
    var name = user.__gameName || user.displayName || "Traveler";
    var gav = user.__gameAvatar || "";
    var photo = user.photoURL || (user.providerData && user.providerData[0] && user.providerData[0].photoURL) || "";
    var av = document.getElementById("site-auth-avatar");
    if (av) {
      if (gav && String(gav).indexOf("img:") === 0) {
        av.innerHTML = "<img src=\"" + esc(String(gav).slice(4)) + "\" alt=\"\">";
      } else if (gav) {
        av.innerHTML = "<span class=\"chip-emoji\">" + esc(gav) + "</span>";
      } else if (photo) {
        av.innerHTML = "<img src=\"" + esc(photo) + "\" alt=\"\">";
      } else {
        av.innerHTML = "<span class=\"chip-emoji\">🙂</span>";
      }
    }
    document.getElementById("site-auth-name").textContent = String(name).slice(0, 22);
    document.getElementById("site-auth-rp").textContent = rp == null ? "…RP" : rpLabel(rp);
  }

  function initAuth() {
    if (typeof firebase === "undefined") {
      console.warn("[Portal] firebase SDK not loaded");
      fireAuthReady(null);
      return;
    }
    if (!firebase.apps.length) firebase.initializeApp(FIREBASE_CONFIG);
    var auth = firebase.auth();

    auth.onAuthStateChanged(function (user) {
      updateChip(user, null);
      if (!user) { fireAuthReady(null); return; }
      // RP lives in the player's private doc (owner-readable); the display
      // name/avatar come from the players registry so the chip shows the
      // in-game identity, not the Google profile.
      var fdb = firebase.firestore();
      Promise.all([
        fdb.collection("saves_private").doc(user.uid).get(),
        fdb.collection("players").doc(user.uid).get(),
      ]).then(function (res) {
        var rp = res[0].exists ? Number(res[0].data().rewardPoints) || 0 : 0;
        var prof = res[1].exists ? res[1].data() || {} : {};
        if (prof.name) user.__gameName = prof.name;
        if (prof.avatar) user.__gameAvatar = prof.avatar;
        updateChip(user, rp);
        fireAuthReady(user);
      }).catch(function () { fireAuthReady(user); });
    });

    function onGsiCredential(resp) {
      if (!resp || !resp.credential) return;
      var cred = firebase.auth.GoogleAuthProvider.credential(resp.credential);
      auth.signInWithCredential(cred).catch(function (e) {
        console.warn("[Portal] credential sign-in failed:", e && e.message);
      });
    }

    // The GSI script tag is `async` — it regularly lands AFTER portal.js runs.
    // Calling prompt() without initialize() first is exactly the
    // "Missing required parameter: client_id" error, so initialize the moment
    // the library appears (and fall back to a Firebase popup if it never does).
    var gsiReady = false;
    function ensureGsi(cb) {
      if (gsiReady) { cb && cb(false); return; }
      var g = window.google;
      if (g && g.accounts && g.accounts.id) {
        try {
          g.accounts.id.initialize({
            client_id: GOOGLE_CLIENT_ID,
            callback: onGsiCredential,
            auto_select: false,
          });
          gsiReady = true;
          cb && cb(false);
        } catch (e) {
          console.warn("[Portal] GSI init failed:", e);
          cb && cb(true);
        }
        return;
      }
      var tries = 0;
      var timer = setInterval(function () {
        tries++;
        if (window.google && google.accounts && google.accounts.id) {
          clearInterval(timer);
          ensureGsi(cb);
        } else if (tries > 40) {
          clearInterval(timer);
          cb && cb(true); // GSI never loaded — caller uses the popup fallback
        }
      }, 150);
    }

    var signInBtn = document.getElementById("site-signin");
    if (signInBtn) {
      signInBtn.addEventListener("click", function () {
        ensureGsi(function (failed) {
          if (failed) {
            auth.signInWithPopup(new firebase.auth.GoogleAuthProvider()).catch(function (e) {
              console.warn("[Portal] sign-in failed:", e && e.message);
            });
          } else {
            try { google.accounts.id.prompt(); } catch (e) {
              auth.signInWithPopup(new firebase.auth.GoogleAuthProvider()).catch(function () {});
            }
          }
        });
      });
    }

    // Warm up GSI early so the first click is instant.
    ensureGsi();
  }

  // ---------- AdSense ----------
  function initAdsense() {
    if (document.body && document.body.getAttribute("data-no-ads") === "true") return;
    if (window.AndroidBridge) return; // never inside the native app
    if (!document.getElementById("adsense-portal")) {
      var s = document.createElement("script");
      s.async = true;
      s.crossOrigin = "anonymous";
      s.id = "adsense-portal";
      s.src = "https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=" + ADSENSE_CLIENT;
      s.setAttribute("data-ad-client", ADSENSE_CLIENT);
      document.head.appendChild(s);
    }
    // NOTE: no bare push({}) here — it fills every ins at once and then
    // mountAds() would push them again ("already have ads in them"). Each
    // unit is filled exactly once, by mountAds().
  }

  function mountAds() {
    document.querySelectorAll("ins.adsbygoogle").forEach(function (ins) {
      if (ins.getAttribute("data-ad-status")) return;
      ins.setAttribute("data-ad-status", "requested");
      try { (window.adsbygoogle = window.adsbygoogle || []).push({}); } catch (e) {}
    });
  }

  // ---------- Boot ----------
  function boot() {
    var h = document.getElementById("site-header");
    if (h) h.outerHTML = headerHTML();
    var f = document.getElementById("site-footer");
    if (f) f.outerHTML = footerHTML();
    initAuth();
    initAdsense();
    mountAds();
    document.dispatchEvent(new CustomEvent("portal:ready"));
  }

  window.Portal = {
    esc: esc,
    timeAgo: timeAgo,
    whenAuthReady: whenAuthReady,
    currentUser: function () { return currentUser; },
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
