// ============================================================
// Elden Earth — Demo / Reviewer Read-Only Mode
// UI lock for accounts flagged with `saves/{uid}.demoMode = true`
// (see server/seed-demo.js). The REAL enforcement is server-side:
// playerCallable() in functions/index.js and !isDemo() in
// firestore.rules. This module only makes the demo experience
// honest — a reviewer can navigate everything, and every control
// that would claim, consume, link or publish is visibly disabled.
// ============================================================
const DemoMode = (() => {
  let active = false;
  let domObserver = null;

  // Buttons/inputs that would mutate state. Matched by id substring so new
  // action controls are covered without a maintenance list. Navigation-ish
  // matches are explicitly re-allowed below (exit/cancel must always work).
  const BLOCK_SELECTORS = [
    'button[id*="claim"]',
    'button[class*="claim"]',
    'button[id*="buy"]',
    'button[id*="spin"]',
    'button[id*="redeem"]',
    'button[id*="withdraw"]',
    'button[id*="convert"]',
    'button[id*="boost"]',
    'button[id*="gift"]',
    'button[id*="trade"]',
    'button[id*="upgrade"]',
    'button[id*="ascend"]',
    'button[id*="plant"]',
    'button[id*="relocate"]',
    'button[id*="collect"]',
    'button[id*="send"]',
    'button[id*="conquer"]',
    'button[id*="siege"]',
    'button[id*="confirm"]',
    'button[id*="submit"]',
    'button[id*="add-friend"]',
    'button[id*="referral"]',
    'button[id*="spawn"]',
    'button[id*="feed"]',
    'button[type="submit"]',
    'input[id*="paypal"]',
    'input[id*="dob"]',
  ];

  // Controls that must keep working: closing modals, cancelling, navigating.
  const ALLOW_SELECTORS = [
    '#exit-buy-mode-btn',
    '#buy-cancel-btn',
    '[data-close]',
    '.close-btn',
    '.nav-tab',
    '#ban-appeal-link',
    'a[href]',
  ];

  // Chat publishes to the live realm — hide the composer entirely.
  const HIDE_SELECTORS = ['#chat-input', '#chat-send-btn'];

  function isBlockedTarget(target) {
    if (!target || !target.closest) return false;
    if (target.closest(ALLOW_SELECTORS.join(','))) return false;
    return !!target.closest(BLOCK_SELECTORS.join(','));
  }

  function showToast() {
    const existing = document.getElementById('demo-toast');
    if (existing) {
      existing.classList.remove('hidden');
      clearTimeout(existing._hideTimer);
      existing._hideTimer = setTimeout(() => existing.classList.add('hidden'), 2200);
      return;
    }
    const toast = document.createElement('div');
    toast.id = 'demo-toast';
    toast.className = 'demo-toast hidden';
    toast.textContent = 'Demo view — actions are disabled';
    document.body.appendChild(toast);
    requestAnimationFrame(() => toast.classList.remove('hidden'));
    toast._hideTimer = setTimeout(() => toast.classList.add('hidden'), 2200);
  }

  function injectStyles() {
    if (document.getElementById('demo-mode-styles')) return;
    const style = document.createElement('style');
    style.id = 'demo-mode-styles';
    style.textContent = `
      .demo-banner {
        position: fixed; top: 8px; left: 50%; transform: translateX(-50%);
        z-index: 99999; padding: 6px 14px; border-radius: 50px;
        background: rgba(20, 22, 34, 0.92); border: 1px solid #3a4b5c;
        color: #cfd8e3; font-size: 11px; letter-spacing: 0.6px;
        font-weight: 600; pointer-events: none; white-space: nowrap;
      }
      body.demo-mode .demo-blocked {
        opacity: 0.42 !important;
        filter: grayscale(0.7);
        pointer-events: none !important;
        cursor: not-allowed !important;
      }
      .demo-toast {
        position: fixed; bottom: 84px; left: 50%; transform: translateX(-50%);
        z-index: 99999; padding: 10px 18px; border-radius: 50px;
        background: rgba(20, 22, 34, 0.95); border: 1px solid #3a4b5c;
        color: #f0f0f5; font-size: 13px; font-weight: 600;
        transition: opacity 0.25s ease; white-space: nowrap;
      }
      .demo-toast.hidden { opacity: 0; pointer-events: none; }
    `;
    document.head.appendChild(style);
  }

  function lockControls() {
    document.querySelectorAll(BLOCK_SELECTORS.join(',')).forEach((el) => {
      if (el.closest && el.closest(ALLOW_SELECTORS.join(','))) return;
      el.classList.add('demo-blocked');
      el.setAttribute('aria-disabled', 'true');
    });
    document.querySelectorAll(HIDE_SELECTORS.join(',')).forEach((el) => {
      el.style.display = 'none';
    });
    // SPA re-renders panels constantly — re-apply cheaply on DOM growth.
    if (!domObserver) {
      domObserver = new MutationObserver(() => {
        document.querySelectorAll(BLOCK_SELECTORS.join(',')).forEach((el) => {
          if (el.classList && !el.classList.contains('demo-blocked') && !(el.closest && el.closest(ALLOW_SELECTORS.join(',')))) {
            el.classList.add('demo-blocked');
            el.setAttribute('aria-disabled', 'true');
          }
        });
        document.querySelectorAll(HIDE_SELECTORS.join(',')).forEach((el) => {
          if (el.style.display !== 'none') el.style.display = 'none';
        });
      });
      domObserver.observe(document.body, { childList: true, subtree: true });
    }
  }

  function activate() {
    if (active) return;
    active = true;
    injectStyles();
    document.body.classList.add('demo-mode');

    const banner = document.createElement('div');
    banner.className = 'demo-banner';
    banner.textContent = 'DEMO VIEW — READ-ONLY PREVIEW';
    document.body.appendChild(banner);

    lockControls();

    // Backstop: any click that slips past the styles is stopped here.
    document.addEventListener('click', (e) => {
      if (isBlockedTarget(e.target)) {
        e.preventDefault();
        e.stopPropagation();
        showToast();
      }
    }, true);

    console.log('[DemoMode] Demo account — read-only lock active');
  }

  function attach() {
    if (active) return;
    const state = window.Store && typeof Store.get === 'function' ? Store.get() : null;
    if (state && state.demoMode === true) {
      activate();
      return;
    }
    // State may still be loading at sign-in — retry briefly.
    let attempts = 0;
    const timer = setInterval(() => {
      attempts++;
      const s = window.Store && typeof Store.get === 'function' ? Store.get() : null;
      if (s && s.demoMode === true) {
        clearInterval(timer);
        activate();
      } else if (attempts >= 120) {
        clearInterval(timer);
      }
    }, 500);
  }

  return { attach, isActive: () => !!active };
})();

window.DemoMode = DemoMode;
