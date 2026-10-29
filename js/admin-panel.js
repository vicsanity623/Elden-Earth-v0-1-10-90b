/* ==========================================================================
   Elden Earth — Admin Approval Panel
   A single in-game place to review and approve custom avatars and name
   changes. It appears as an extra "Admin" tab inside the Player Info modal and
   ONLY for UIDs listed in CONFIG.GAME_ADMIN_UIDS.

   Why this exists: approvals used to be done by hand in Firestore and the
   change never propagated — an approved avatar could sit in `avatar_reviews`
   while the player's `saves.player.avatar` still held the old value (and even
   then in the wrong format). Approving here writes the canonical avatar AND
   fans it out to every mirror (chat, leaderboard, plots, trades, citadels,
   PvP Arena) immediately, so the player updates within seconds.

   The server re-checks the admin allowlist on every call — this UI is
   convenience, never the security boundary.
   ========================================================================== */
const AdminPanel = (() => {
  "use strict";

  const el = (id) => document.getElementById(id);
  const PANEL_ID = "pi-admin-panel";
  const STYLE_ID = "admin-panel-style";

  let bound = false;
  let lastLoad = 0;

  function isAdmin() {
    try {
      const uid = Store.get()?.player?.id;
      return !!(uid && (window.CONFIG && CONFIG.GAME_ADMIN_UIDS || []).includes(uid));
    } catch (e) {
      return false;
    }
  }

  function toast(msg, ms) {
    try { if (typeof showToast === "function") { showToast(msg, ms || 3000); return; } } catch (e) {}
    console.log("[AdminPanel]", msg);
  }

  function escapeHtml(str) {
    return String(str == null ? "" : str)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function avatarHtml(v) {
    const a = String(v || "🙂");
    if (a.startsWith("img:")) {
      return `<img class="adm-avatar" src="${escapeHtml(a.slice(4))}" alt="" referrerpolicy="no-referrer">`;
    }
    return `<span class="adm-avatar adm-avatar-emoji">${escapeHtml(a)}</span>`;
  }

  function fmtAge(ts) {
    const d = Date.now() - (Number(ts) || 0);
    const m = Math.floor(d / 60000);
    if (m < 1) return "just now";
    if (m < 60) return m + "m ago";
    const h = Math.floor(m / 60);
    if (h < 24) return h + "h ago";
    return Math.floor(h / 24) + "d ago";
  }

  /* ------------------------------------------------------------- CSS */
  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const css = `
#${PANEL_ID}{ padding-top:4px; }
.adm-sec-title{
  font-size:10px; letter-spacing:1.4px; text-transform:uppercase;
  color:#7f97ba; margin:14px 2px 8px; font-weight:800;
}
.adm-empty{
  padding:18px 12px; text-align:center; color:#8aa0bd; font-size:11.5px;
  line-height:1.7; border-radius:12px; background:rgba(255,255,255,.045);
  border:1px dashed rgba(150,180,240,.18);
}
.adm-card{
  display:flex; align-items:center; gap:10px;
  padding:11px 11px; border-radius:13px; margin-bottom:8px;
  background:rgba(255,255,255,.055); border:1px solid rgba(255,255,255,.1);
}
.adm-avatar{
  width:44px; height:44px; border-radius:50%; object-fit:cover; flex:0 0 auto;
  border:2px solid rgba(255,255,255,.3); background:#1b2233;
}
.adm-avatar-emoji{
  display:flex; align-items:center; justify-content:center; font-size:21px;
}
.adm-body{ flex:1 1 auto; min-width:0; }
.adm-name{ font-size:12.5px; font-weight:800; color:#fff; }
.adm-meta{ font-size:10px; color:#8fa6c4; margin-top:2px; line-height:1.5; }
.adm-meta b{ color:#cfe0f5; }
.adm-actions{ display:flex; gap:6px; flex:0 0 auto; }
.adm-btn{
  padding:8px 11px; border-radius:9px; border:1px solid rgba(255,255,255,.18);
  background:rgba(255,255,255,.08); color:#eaf1ff; cursor:pointer;
  font-family:inherit; font-size:10.5px; font-weight:800; letter-spacing:.3px;
}
.adm-btn:active{ transform:scale(.95); }
.adm-btn.ok{ background:rgba(34,197,94,.22); border-color:rgba(34,197,94,.5); color:#86efac; }
.adm-btn.no{ background:rgba(190,50,60,.22); border-color:rgba(190,50,60,.5); color:#fca5a5; }
.adm-btn:disabled{ opacity:.45; cursor:default; }
.adm-rename{ display:flex; align-items:center; gap:8px; }
.adm-rename .arrow{ color:#7f97ba; font-size:14px; }
.adm-rename .to{ color:#86efac; font-weight:800; }
.adm-refresh{
  width:100%; margin:4px 0 8px; padding:10px; border-radius:11px;
  border:1px solid rgba(150,180,240,.22); background:rgba(255,255,255,.06);
  color:#cfe0f5; font-family:inherit; font-size:11px; font-weight:800; cursor:pointer;
}
`;
    const st = document.createElement("style");
    st.id = STYLE_ID;
    st.textContent = css;
    document.head.appendChild(st);
  }

  /* ------------------------------------------------------------- DOM */
  function injectTab() {
    if (!isAdmin()) return false;
    if (document.querySelector('[data-pi-tab="admin"]')) return true;

    const tabs = document.querySelector(".pi-tabs");
    const panels = document.querySelector('[data-pi-panel="profile"]');
    if (!tabs || !panels) return false;

    const btn = document.createElement("button");
    btn.className = "pi-tab";
    btn.setAttribute("data-pi-tab", "admin");
    btn.textContent = "Admin";
    tabs.appendChild(btn);

    const panel = document.createElement("div");
    panel.className = "pi-tab-panel";
    panel.setAttribute("data-pi-panel", "admin");
    panel.id = PANEL_ID;
    panels.parentNode.appendChild(panel);

    // Self-contained switcher — the existing handler is bound once at boot and
    // would never see a tab injected afterwards.
    btn.addEventListener("click", () => {
      document.querySelectorAll(".pi-tab").forEach((t) => t.classList.remove("active"));
      document.querySelectorAll(".pi-tab-panel").forEach((p) => p.classList.remove("active"));
      btn.classList.add("active");
      panel.classList.add("active");
      refresh();
    });

    return true;
  }

  /* ---------------------------------------------------------- server */
  async function call(name, payload) {
    try {
      const fn = firebase.functions().httpsCallable(name);
      const res = await fn(payload || {});
      return (res && res.data) || null;
    } catch (e) {
      console.warn("[AdminPanel]", name, "failed:", e && e.message);
      return null;
    }
  }

  async function refresh() {
    const box = el(PANEL_ID);
    if (!box) return;
    box.innerHTML = `<div class="adm-empty">Loading pending approvals…</div>`;

    const d = await call("adminListApprovals", {});
    if (!d || !d.ok) {
      box.innerHTML = `<div class="adm-empty">⚠️ Could not load the approval queue. Check the console.</div>`;
      return;
    }
    lastLoad = Date.now();

    const avatars = Array.isArray(d.avatars) ? d.avatars : [];
    const names = Array.isArray(d.names) ? d.names : [];

    box.innerHTML = `
      <button class="adm-refresh" id="adm-refresh-btn">↻ Refresh queue</button>

      <div class="adm-sec-title">📷 Custom Avatar Requests (${avatars.length})</div>
      ${avatars.length ? avatars.map((r) => `
        <div class="adm-card" data-uid="${escapeHtml(r.userId || r.id)}">
          ${avatarHtml(r.avatarData)}
          <div class="adm-body">
            <div class="adm-name">${escapeHtml(r.userName || "Unknown")}</div>
            <div class="adm-meta">${escapeHtml(r.userId || r.id)} · submitted ${fmtAge(r.submittedAt)}</div>
          </div>
          <div class="adm-actions">
            <button class="adm-btn ok" data-act="avatar-approve" data-uid="${escapeHtml(r.userId || r.id)}">Approve</button>
            <button class="adm-btn no" data-act="avatar-reject" data-uid="${escapeHtml(r.userId || r.id)}">Reject</button>
          </div>
        </div>`).join("") : `<div class="adm-empty">No avatar requests waiting. 🎉</div>`}

      <div class="adm-sec-title">✏️ Name Change Requests (${names.length})</div>
      ${names.length ? names.map((r) => `
        <div class="adm-card" data-uid="${escapeHtml(r.userId || r.id)}">
          <div class="adm-body">
            <div class="adm-name adm-rename">
              <span>${escapeHtml(r.currentName || r.userName || "?")}</span>
              <span class="arrow">→</span>
              <span class="to">${escapeHtml(r.requestedName || "?")}</span>
            </div>
            <div class="adm-meta">${escapeHtml(r.userId || r.id)} · requested ${fmtAge(r.submittedAt || r.requestedAt)}</div>
          </div>
          <div class="adm-actions">
            <button class="adm-btn ok" data-act="name-approve" data-uid="${escapeHtml(r.userId || r.id)}">Approve</button>
            <button class="adm-btn no" data-act="name-reject" data-uid="${escapeHtml(r.userId || r.id)}">Reject</button>
          </div>
        </div>`).join("") : `<div class="adm-empty">No name change requests waiting. 🎉</div>`}
    `;

    box.querySelector("#adm-refresh-btn")?.addEventListener("click", refresh);
    box.querySelectorAll("[data-act]").forEach((b) => {
      b.addEventListener("click", () => act(b.getAttribute("data-act"), b.getAttribute("data-uid"), b));
    });
  }

  async function act(action, uid, btn) {
    if (!uid) return;
    if (btn) { btn.disabled = true; btn.textContent = "…"; }

    let res = null;
    if (action === "avatar-approve") {
      res = await call("adminApproveAvatar", { uid });
      toast(res && res.ok ? `✅ Avatar approved — ${uid.slice(0, 8)} updated everywhere` : "⚠️ Could not approve avatar");
    } else if (action === "avatar-reject") {
      const reason = window.prompt("Reason for rejecting this avatar (optional):", "") || "not_approved";
      res = await call("adminRejectAvatar", { uid, reason });
      toast(res && res.ok ? "🗑️ Avatar rejected" : "⚠️ Could not reject avatar");
    } else if (action === "name-approve") {
      res = await call("approveNameChange", { uid });
      toast(res && res.ok ? `✅ Name changed — ${uid.slice(0, 8)} updated everywhere` : "⚠️ Could not approve name");
    } else if (action === "name-reject") {
      res = await call("rejectNameChange", { uid, reason: "not_approved" });
      toast(res && res.ok ? "🗑️ Name change rejected" : "⚠️ Could not reject name");
    }

    refresh();
  }

  /* -------------------------------------------------------------- init */
  function init() {
    if (!isAdmin()) return;
    injectStyle();
    // The Player Info modal markup exists at boot, so the tab can go in now.
    injectTab();
    // Re-try a few times in case the modal is rendered late.
    let tries = 0;
    const t = setInterval(() => {
      tries++;
      if (injectTab() || tries > 20) clearInterval(t);
    }, 1500);
  }

  return { init, refresh, isAdmin };
})();

if (typeof window !== "undefined") window.AdminPanel = AdminPanel;
