// ============================================================
// Elden Earth — Firebase App Check (Fraud Defense / reCAPTCHA Enterprise)
//
// ATTESTATION ONLY. Enforcement is a Firebase Console toggle per API and must
// stay OFF (monitor mode) until the App Check dashboard shows real players
// attesting cleanly — enforcing too early locks out legit devices.
//
// Fail-soft by design: any load/init trouble just logs and lets requests go
// unattested, exactly as before this file existed. Never blocks gameplay.
//
// The site key is PUBLIC (it ships in the client by design). The reCAPTCHA
// SECRET key must never reach client code — it lives in functions/.env as
// RECAPTCHA_ENTERPRISE_SECRET for any future server-side verification.
// ============================================================
(function () {
  "use strict";

  var SITEKEY = "6LfBd_8tAAAAANGZgbRnRPP8K_xLMpQppeUnWA6e";
  var SDK_SRC = "https://www.gstatic.com/firebasejs/10.9.0/firebase-app-check-compat.js";
  var SDK_SRI = "sha384-NDFDftmSWhHkz3UIclV1BgVjP4jQatEUrT4I3UH3s3rOSAjwtTIGM332IgOKDs/d";

  var started = false;

  function loadSdk() {
    return new Promise(function (resolve, reject) {
      if (typeof firebase !== "undefined" && firebase.appCheck) return resolve();
      var s = document.createElement("script");
      s.src = SDK_SRC;
      s.integrity = SDK_SRI;
      s.crossOrigin = "anonymous";
      s.onload = function () { resolve(); };
      s.onerror = function () { reject(new Error("app-check sdk failed to load")); };
      document.head.appendChild(s);
    });
  }

  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  async function boot() {
    if (started) return;
    try {
      await loadSdk();
      // The Firebase app is created by the game (storage.js) or the portal
      // (portal.js) — both load with defer, so poll briefly instead of
      // assuming ordering.
      for (var i = 0; i < 50 && typeof firebase === "undefined"; i++) await wait(100);
      for (var j = 0; j < 50 && firebase && firebase.apps && firebase.apps.length === 0; j++) await wait(100);
      if (typeof firebase === "undefined" || !firebase.appCheck || !firebase.apps || !firebase.apps.length) return;
      started = true;
      firebase.appCheck().initializeApp(firebase.app, {
        provider: new firebase.appCheck.ReCaptchaEnterpriseProvider(SITEKEY),
        isTokenAutoRefreshEnabled: true,
      });
      console.log("[AppCheck] reCAPTCHA Enterprise attestation active (monitor mode)");
    } catch (e) {
      console.warn("[AppCheck] init skipped:", e && e.message);
    }
  }

  window.EEAppCheck = { boot: boot };
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
