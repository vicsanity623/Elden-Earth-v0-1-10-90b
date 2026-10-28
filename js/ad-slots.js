/* ==========================================================================
   Elden Earth — AdSense slot injector

   Fills every `<div class="ee-ad-slot">` with a real AdSense unit. Keeping the
   markup to a single empty div means we can add/remove placements in
   game.html without ever copying `<ins>` boilerplate around.

   ⚠️ THE RULE THAT MATTERS: only call adsbygoogle.push() when the slot is
   actually VISIBLE. AdSense throws
       TagError: No slot size for availableWidth=0
   if the container is display:none / zero-width, and a failed push BURNS that
   slot for the page lifetime — it will never fill. That is exactly what left
   the modal placements as empty grey boxes.

   Policy notes (keep these when adding slots):
     * Ads must sit NEXT TO content, never over it or under a game control.
     * Never place an ad where a mis-tap spends currency — that is a Play /
       AdSense "deceptive design" strike.
     * At most one visible slot per screen the player is actively reading.
     * Hidden modals are filled on open, not on boot.

   Slots are disabled entirely inside the native shell (EEAdPolicy.adsAllowed
   is false there).
   ========================================================================== */
const EEAdSlots = (() => {
  "use strict";

  // Approved AdSense unit. Reused across placements so every slot serves
  // immediately without needing new units in the AdSense console.
  const AD_CLIENT = "ca-pub-5972331036113330";
  const AD_SLOT = "4287691766";

  const FILLED = "data-ee-filled";
  const PENDING = "ee-pending";

  function adsAllowed() {
    try {
      return !!(window.EEAdPolicy && window.EEAdPolicy.adsAllowed);
    } catch (e) {
      return false;
    }
  }

  /** True only when the element is actually laid out with a real width.
      AdSense only cares about WIDTH ("No slot size for availableWidth=0"),
      so an empty slot with a 1px placeholder height still counts as
      measurable — checking height here used to deadlock the fill. */
  function isVisible(el) {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return r.width > 1 && r.height > 0;
  }

  /** Fill a single .ee-ad-slot container. Safe to call repeatedly. */
  function fillOne(box) {
    if (!box) return false;
    if (box.getAttribute(FILLED)) return false;

    if (!adsAllowed()) {
      box.setAttribute(FILLED, "native");
      box.style.display = "none";
      return false;
    }

    // Never push while the box has no size — AdSense rejects it and the slot
    // is dead for the rest of the page. Leave it untouched so a later pass
    // (the modal opened) retries it.
    //
    // NOTE: the box must NOT be display:none while pending, or it can never
    // become measurable and we deadlock. The CSS keeps it invisible with
    // `visibility:hidden` instead, which preserves the layout box.
    if (!isVisible(box)) {
      box.classList.add(PENDING);
      return false;
    }
    box.classList.remove(PENDING);
    box.setAttribute(FILLED, "1");
    box.classList.add("ee-has-ad");

    const ins = document.createElement("ins");
    ins.className = "adsbygoogle";
    ins.style.display = "inline-block";
    ins.style.width = "100%";
    ins.style.minHeight = "90px";
    ins.setAttribute("data-ad-client", AD_CLIENT);
    ins.setAttribute("data-ad-slot", AD_SLOT);

    // REVENUE FIRST: "auto" + full-width-responsive lets AdSense pick the
    // highest-paying unit that fits — including the big responsive / rich
    // formats. Those are the creatives most likely to trip the browser's
    // Heavy Ad Intervention ("Ad hidden for using significant resources"),
    // but they pay far more than a fixed rectangle, so we take that trade.
    //
    // Per-placement downgrade if a slot ever becomes annoying:
    //   <div class="ee-ad-slot" data-ee-format="rectangle"></div>
    const raw = String(box.getAttribute("data-ee-format") || "auto");
    const fmt = ["auto", "horizontal", "vertical", "rectangle"].includes(raw) ? raw : "auto";
    ins.setAttribute("data-ad-format", fmt);
    if (fmt === "auto") {
      ins.setAttribute("data-full-width-responsive", "y");
    }

    box.innerHTML = "";
    box.appendChild(ins);

    try {
      (window.adsbygoogle = window.adsbygoogle || []).push({});
    } catch (e) {
      // Never let an ad failure disturb gameplay. Collapse so we don't leave
      // a grey hole where an ad was supposed to be.
      try {
        box.setAttribute(FILLED, "failed");
        box.style.display = "none";
      } catch (e2) {}
    }
    return true;
  }

  /** Fill every slot that is currently on screen and not yet filled. */
  function fillAll(root) {
    if (!adsAllowed()) return 0;
    let n = 0;
    try {
      const scope = root || document;
      scope.querySelectorAll(".ee-ad-slot").forEach((b) => {
        if (fillOne(b)) n++;
      });
    } catch (e) {}
    return n;
  }

  let scheduled = 0;
  function scheduleFill() {
    if (scheduled) return;
    scheduled = 1;
    // Wait for the browser to finish laying out a just-opened modal so the
    // box has a real width before AdSense measures it. setTimeout is used
    // rather than requestAnimationFrame because rAF is throttled/parked in
    // background tabs and inside WKWebView — the fill silently never ran.
    setTimeout(() => {
      scheduled = 0;
      fillAll();
    }, 60);
  }

  function init() {
    // Anything already on screen (the map banner) can fill now.
    fillAll();

    // Modals are display:none until opened. Watch for the visibility flip and
    // fill the slots that just became measurable.
    try {
      if (typeof MutationObserver !== "undefined") {
        const obs = new MutationObserver(scheduleFill);
        obs.observe(document.body, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ["class", "style"],
        });
      }
    } catch (e) {}

    // Belt and braces: also re-check when a modal is opened by any code path
    // that mutates the DOM without touching a class we watch.
    try {
      document.addEventListener("click", (e) => {
        const t = e.target;
        if (t && t.closest && (t.closest("[data-close]") || t.closest(".modal"))) {
          scheduleFill();
        }
      }, true);
    } catch (e) {}

    // Safety net: if a MutationObserver ever misses a visibility flip, this
    // catches any slot that is on screen and still unfilled.
    try {
      setInterval(() => {
        if (document.hidden) return;
        fillAll();
      }, 4000);
    } catch (e) {}
  }

  return { init, fillAll, fillOne, adsAllowed };
})();

if (typeof window !== "undefined") window.EEAdSlots = EEAdSlots;
