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
      // `CONFIG` is declared with `const` in js/config.js, so it is a LEXICAL
      // global — window.CONFIG is undefined. Reading window.CONFIG silently
      // made isAdmin() always false and the Admin tab never appeared.
      const cfg = (typeof CONFIG !== "undefined" && CONFIG)
        || (typeof window !== "undefined" && window.CONFIG)
        || {};
      return !!(uid && (cfg.GAME_ADMIN_UIDS || []).includes(uid));
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

    // `pending` = never reviewed. `unapplied` = someone flipped status to
    // "approved" by hand in Firestore, but no code ever wrote it to the
    // player's save — so it still needs an Apply from here.
    const avatars = Array.isArray(d.avatars) ? d.avatars : [];
    const names = Array.isArray(d.names) ? d.names : [];

    box.innerHTML = `
      <button class="adm-refresh" id="adm-refresh-btn">↻ Refresh queue</button>

      <div class="adm-sec-title">🎫 Invite Codes (single-use, 2h)</div>
      <div class="adm-card" style="display:block;">
        <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;">
          <input id="adm-invite-email" type="text" placeholder="new player's email or phone"
            style="flex:1 1 160px;min-width:140px;padding:8px 10px;border-radius:8px;border:1px solid rgba(255,255,255,0.18);background:rgba(0,0,0,0.25);color:inherit;">
          <button class="adm-btn ok" id="adm-invite-gen">Generate</button>
        </div>
        <div class="adm-meta" id="adm-invite-out" style="margin-top:8px;word-break:break-all;"></div>
      </div>

      <div class="adm-sec-title">🏆 PvP Arena Payouts (weekly)</div>
      <div class="adm-card" style="display:block;">
        <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;">
          <input id="adm-arena-week" type="text" placeholder="week key (blank = latest settled)"
            style="flex:1 1 150px;min-width:130px;padding:8px 10px;border-radius:8px;border:1px solid rgba(255,255,255,0.18);background:rgba(0,0,0,0.25);color:inherit;">
          <button class="adm-btn" id="adm-arena-status">📊 Status</button>
          <button class="adm-btn ok" id="adm-arena-stage">✅ Approve &amp; Pay</button>
        </div>
        <div class="adm-meta" id="adm-arena-out" style="margin-top:8px;">Press 📊 Status to review the standings.</div>
      </div>

      <div class="adm-sec-title">📮 Global Mail — dev gifts &amp; announcements</div>
      <div class="adm-card" style="display:block;">
        <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:6px;">
          <select id="adm-mail-type" style="padding:8px 10px;border-radius:8px;border:1px solid rgba(255,255,255,0.18);background:rgba(0,0,0,0.25);color:inherit;">
            <option value="gift">🎁 Gift (claimable)</option>
            <option value="alert">🚨 Alert (announcement)</option>
          </select>
          <input id="adm-mail-title" type="text" placeholder="Title (required)"
            style="flex:1 1 160px;min-width:140px;padding:8px 10px;border-radius:8px;border:1px solid rgba(255,255,255,0.18);background:rgba(0,0,0,0.25);color:inherit;">
        </div>
        <textarea id="adm-mail-body" rows="3" placeholder="Message players will read…"
          style="width:100%;padding:8px 10px;border-radius:8px;border:1px solid rgba(255,255,255,0.18);background:rgba(0,0,0,0.25);color:inherit;resize:vertical;"></textarea>
        <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-top:6px;">
          <input id="adm-mail-eb" type="number" min="0" placeholder="EB" title="Elden Bucks"
            style="width:74px;padding:8px 10px;border-radius:8px;border:1px solid rgba(255,255,255,0.18);background:rgba(0,0,0,0.25);color:inherit;">
          <input id="adm-mail-diamonds" type="number" min="0" placeholder="💎" title="Diamonds"
            style="width:64px;padding:8px 10px;border-radius:8px;border:1px solid rgba(255,255,255,0.18);background:rgba(0,0,0,0.25);color:inherit;">
          <input id="adm-mail-berries" type="number" min="0" placeholder="🍓" title="Berries"
            style="width:64px;padding:8px 10px;border-radius:8px;border:1px solid rgba(255,255,255,0.18);background:rgba(0,0,0,0.25);color:inherit;">
          <input id="adm-mail-seeds" type="number" min="0" placeholder="🌱" title="Elden Stop Seeds"
            style="width:64px;padding:8px 10px;border-radius:8px;border:1px solid rgba(255,255,255,0.18);background:rgba(0,0,0,0.25);color:inherit;">
          <input id="adm-mail-rp" type="number" min="0" placeholder="⭐ RP" title="Reward Points"
            style="width:78px;padding:8px 10px;border-radius:8px;border:1px solid rgba(255,255,255,0.18);background:rgba(0,0,0,0.25);color:inherit;">
          <button class="adm-btn ok" id="adm-mail-send">📮 Send to everyone</button>
        </div>
        <div class="adm-meta" id="adm-mail-out" style="margin-top:8px;">Gifts are claimable once per player (server receipt). Alerts are read-only news.</div>
      </div>

      <div class="adm-sec-title">📷 Custom Avatar Requests (${avatars.length})</div>
      ${avatars.length ? avatars.map((r) => `
        <div class="adm-card" data-uid="${escapeHtml(r.userId || r.id)}">
          ${avatarHtml(r.avatarData)}
          <div class="adm-body">
            <div class="adm-name">${escapeHtml(r.userName || "Unknown")}</div>
            <div class="adm-meta">${escapeHtml(r.userId || r.id)} · submitted ${fmtAge(r.submittedAt)}</div>
          </div>
          <div class="adm-actions">
            <button class="adm-btn ok" data-act="avatar-approve" data-uid="${escapeHtml(r.userId || r.id)}">${r.status === "approved" ? "Apply" : "Approve"}</button>
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
    box.querySelector("#adm-invite-gen")?.addEventListener("click", async () => {
      const out = box.querySelector("#adm-invite-out");
      const input = box.querySelector("#adm-invite-email");
      const btn = box.querySelector("#adm-invite-gen");
      const identifier = String((input && input.value) || "").trim().toLowerCase();
      if (!identifier) { if (out) out.textContent = "Enter an email or phone first."; return; }
      if (btn) { btn.disabled = true; btn.textContent = "…"; }
      const res = await call("generateInviteCode", { identifier });
      if (res && res.ok && res.code) {
        const exp = new Date(res.expiresAt).toISOString().slice(11, 16);
        if (out) out.innerHTML = `Code for <b>${escapeHtml(res.identifier)}</b>: <b style="font-size:16px;letter-spacing:1px;">${escapeHtml(res.code)}</b> — expires ${exp} UTC. Shown once — copy it now.`;
        try { await navigator.clipboard.writeText(res.code); if (out) out.innerHTML += " <i>(copied)</i>"; } catch (e) {}
      } else if (out) {
        out.textContent = "⚠️ Could not issue code (server refused — check the identifier and the admin list).";
      }
      if (btn) { btn.disabled = false; btn.textContent = "Generate"; }
    });

    // 🏁 PvP Arena payout wire — the admin's "approve and distribute" flow.
    // arenaPayoutStatus reads the week's staged payouts (who claimed), and
    // arenaProcessPayouts stages rewards from the frozen end-of-week snapshot
    // so every ranked player can claim exactly once. Blank week key = the
    // newest SETTLED week.
    const arenaOut = box.querySelector("#adm-arena-out");
    const arenaWeekEl = box.querySelector("#adm-arena-week");
    const arenaWeek = () => String((arenaWeekEl && arenaWeekEl.value) || "").trim();

    async function arenaStatus() {
      if (!arenaOut) return null;
      arenaOut.textContent = "Loading…";
      const res = await call("arenaPayoutStatus", arenaWeek() ? { weekKey: arenaWeek() } : {});
      if (!res || !res.ok) {
        arenaOut.textContent = "⚠️ " + ((res && res.reason) || "could not load status");
        return null;
      }
      if (arenaWeekEl && !arenaWeekEl.value) arenaWeekEl.value = res.weekKey;
      const rows = (res.players || []).slice(0, 40).map((p) =>
        `#${p.rank} ${escapeHtml(p.name)} — ${p.diamonds}💎 ${p.rp}RP` +
        `${p.seeds ? " " + p.seeds + "🌱" : ""}${p.plots ? " " + p.plots + "🗺️" : ""} ${p.claimed ? "✅" : "⏳"}`)
        .join("<br/>");
      const more = (res.players || []).length > 40
        ? `<br/>…and ${res.players.length - 40} more` : "";
      arenaOut.innerHTML =
        `<b>${escapeHtml(res.weekLabel || res.weekKey)}</b>${res.live ? " &nbsp;⚠️ week still LIVE" : ""}<br/>` +
        `Staged: ${res.staged} · Claimed: ${res.claimedCount} · Pool: ${res.totalDiamonds}💎 + ${res.totalRp} RP` +
        (res.finalizedAt ? `<br/>Finalized ${new Date(res.finalizedAt).toISOString().slice(0, 16).replace("T", " ")}` : "") +
        `<div style="margin-top:8px;max-height:220px;overflow-y:auto;font-size:11px;line-height:1.8">${rows || "No payouts staged yet."}${more}</div>`;
      return res;
    }

    const arenaStatusBtn = box.querySelector("#adm-arena-status");
    if (arenaStatusBtn) arenaStatusBtn.addEventListener("click", () => { arenaStatus(); });

    // 📮 Global Mail — dev gifts & announcements (sendGlobalMail callable)
    box.querySelector("#adm-mail-send")?.addEventListener("click", async () => {
      const out = box.querySelector("#adm-mail-out");
      const btn = box.querySelector("#adm-mail-send");
      const title = box.querySelector("#adm-mail-title").value.trim();
      const body = box.querySelector("#adm-mail-body").value.trim();
      const type = box.querySelector("#adm-mail-type").value === "alert" ? "alert" : "gift";
      const rewards = {
        eb: Number(box.querySelector("#adm-mail-eb").value) || 0,
        diamonds: Number(box.querySelector("#adm-mail-diamonds").value) || 0,
        berries: Number(box.querySelector("#adm-mail-berries").value) || 0,
        eldenStopSeeds: Number(box.querySelector("#adm-mail-seeds").value) || 0,
        rp: Number(box.querySelector("#adm-mail-rp").value) || 0,
      };
      if (!title) { out.textContent = "⚠️ Title is required."; return; }
      if (type === "gift" && !Object.values(rewards).some((v) => v > 0)) {
        out.textContent = "⚠️ A gift needs at least one reward above zero.";
        return;
      }
      // Never destroy a gift on a mis-click — confirm first.
      const rewardLine = Object.entries(rewards).filter(([, v]) => v > 0)
        .map(([k, v]) => `${v} ${k}`).join(" · ") || "no rewards (announcement)";
      const q = `Send this ${type} to EVERY player?\n\n"${title}"\n${rewardLine}`;
      const ok = (typeof window.gameConfirm === "function")
        ? await window.gameConfirm(q, { okText: "Send to Everyone" })
        : window.confirm(q);
      if (!ok) return;
      btn.disabled = true;
      out.textContent = "Sending…";
      try {
        const res = await call("sendGlobalMail", { type, title, body, rewards });
        if (res && res.ok) {
          out.textContent = `✅ Sent "${res.title}" (${rewardLine}) — id ${res.id}`;
          box.querySelector("#adm-mail-title").value = "";
          box.querySelector("#adm-mail-body").value = "";
          ["eb", "diamonds", "berries", "seeds", "rp"].forEach((k) => {
            const input = box.querySelector("#adm-mail-" + k);
            if (input) input.value = "";
          });
        } else {
          out.textContent = "⚠️ Send failed.";
        }
      } catch (e) {
        out.textContent = "⚠️ " + (e && e.message ? e.message : "Send failed.");
      }
      btn.disabled = false;
    });

    const arenaStageBtn = box.querySelector("#adm-arena-stage");
    if (arenaStageBtn) arenaStageBtn.addEventListener("click", async () => {
      const wk = arenaWeek();
      const q = "Approve & stage PvP payouts " + (wk ? "for " + wk : "for the latest settled week") +
        "? Rewards become claimable by every ranked player immediately.";
      let go = false;
      try {
        go = (typeof window.gameConfirm === "function")
          ? await window.gameConfirm(q, { okText: "Approve & Pay" })
          : window.confirm(q);
      } catch (e) { go = false; }
      if (!go) return;
      arenaStageBtn.disabled = true;
      arenaStageBtn.textContent = "Staging…";
      const res = await call("arenaProcessPayouts", wk ? { weekKey: wk } : {});
      arenaStageBtn.disabled = false;
      arenaStageBtn.textContent = "✅ Approve & Pay";
      if (!res || !res.ok) {
        toast("⚠️ Payout failed: " + ((res && res.reason) || "unknown"));
        return;
      }
      toast(`🏁 Payouts staged for ${res.winners} players${res.live ? " (⚠️ week still LIVE)" : ""}`);
      arenaStatus();
    });
    arenaStatus();
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
