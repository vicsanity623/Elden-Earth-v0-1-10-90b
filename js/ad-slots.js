/* ==========================================================================
   Elden Earth — AdSense slot injector

   Fills every `<div class="ee-ad-slot">` with a real AdSense unit. Keeping the
   markup to a single empty div means we can add/remove placements in
   game.html without ever copying `<ins>` boilerplate around.

   Policy notes (keep these when adding slots):
     * Ads must sit NEXT TO content, never over it or under a game control.
     * Never place an ad where a mis-tap spends currency — that is a Play /
       AdSense "deceptive design" strike.
     * At most one visible slot per screen the player is actively reading.
     * Hidden modals are filled on open, not on boot, so an ad is never
       rendered into an invisible box (that reads as an empty impression).

   Slots are disabled entirely inside the native shell (EEAdPolicy.adsAllowed
   is false there) — the Android app is paused and the AdMob units behind it
   are DEMO units that earn nothing.
   ========================================================================== */
const EEAdSlots = (() => {
  "use strict";

  // Approved AdSense unit. Reused across placements so every slot serves
  // immediately without needing new units in the AdSense console.
  const AD_CLIENT = "ca-pub-5972331036113330";
  const AD_SLOT = "4287691766";

  const FILLED = "data-ee-filled";

  function adsAllowed() {
    try {
      return !!(window.EEAdPolicy && window.EEAdPolicy.adsAllowed);
    } catch (e) {
      return false;
    }
  }

  /** Fill a single .ee-ad-slot container (idempotent). */
  function fillOne(box) {
    if (!box || box.getAttribute(FILLED)) return false;
    if (!adsAllowed()) {
      // Keep the space reserved but inert inside the native shell.
      box.setAttribute(FILLED, "native");
      box.style.display = "none";
      return false;
    }
    box.setAttribute(FILLED, "1");

    const ins = document.createElement("ins");
    ins.className = "adsbygoogle";
    ins.style.display = "inline-block";
    ins.style.width = "100%";
    ins.style.minHeight = "90px";
    ins.setAttribute("data-ad-client", AD_CLIENT);
    ins.setAttribute("data-ad-slot", AD_SLOT);
    ins.setAttribute("data-ad-format", "auto");
    ins.setAttribute("data-full-width-responsive", "y");
    box.innerHTML = "";
    box.appendChild(ins);

    try {
      (window.adsbygoogle = window.adsbygoogle || []).push({});
    } catch (e) {
      // Never let an ad failure disturb gameplay.
      try { box.style.display = "none"; } catch (e2) {}
    }
    return true;
  }

  /** Fill every slot currently in the DOM. */
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

  /** Call when a modal/panel becomes visible so its slot actually renders. */
  function fillVisible(root) {
    return fillAll(root);
  }

  function init() {
    fillAll();
    // Modals are display:none until opened — fill their slots the moment they
    // become visible so the unit has a real box to render into.
    try {
      if (typeof MutationObserver !== "undefined") {
        const obs = new MutationObserver(() => {
          // Cheap: only scan when something actually changed.
          fillAll();
        });
        obs.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
      }
    } catch (e) {}
  }

  return { init, fillAll, fillVisible, adsAllowed };
})();

if (typeof window !== "undefined") window.EEAdSlots = EEAdSlots;
