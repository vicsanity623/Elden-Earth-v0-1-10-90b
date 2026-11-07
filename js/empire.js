// ============================================================
// Elden Earth — "My Empire" command screen 🧩
//
// The endgame land dashboard: empire overview (total land, net passive
// income, rank title), the interactive Merge Tool (eligible 2×2 clusters
// highlighted green on the map → selection modal → plotStartMerge), the
// active construction queue (live progress → ✨ Claim & Finalize), and a
// 3D tilting-card showcase of merged T1–T3 monuments.
//
// Merging rules (mirrors functions/plot-merge.js — server is authoritative):
//   · 4 same-tier same-rarity plots in a strict 2×2 square → 1 plot T+1
//   · rate = base × 4.2^tier  (🍀 only when ALL FOUR are lucky)
//   · T1: 24h @ Lv30 · T2: 3d @ Lv50 · T3: 10d @ Lv65 (T3 = CAP)
//   · constituents stop earning the moment the merge starts (opportunity
//     cost); no speedups, no cancellation; merged plots are immobile.
// ============================================================
const Empire = (() => {
  const el = (id) => document.getElementById(id);
  const MODAL_ID = "empire-modal";
  const STYLE_ID = "empire-style";

  let state = null; // last computed view model
  let mergeMode = false;
  // 🎥 Cluster focus: tapping a cluster in the list flies the camera to it on
  // the map (players are often nowhere near their land), with a floating
  // confirm card. Beginning/claiming a merge snaps the camera home to the
  // player.
  let focusCluster = null;
  let savedView = null;

  /* ------------------------------------------------------ plumbing */
  async function call(name, payload) {
    try {
      if (typeof firebase === "undefined" || !firebase.functions) return null;
      const fn = firebase.functions().httpsCallable(name);
      const res = await fn(payload || {});
      return (res && res.data) || null;
    } catch (e) {
      console.warn("[Empire]", name, "failed:", e && e.message);
      return null;
    }
  }

  const toast = (msg, ms) => (window.showToast || alert)(msg, ms);

  function fmtRate(rate) {
    // Plots accrue REALM COINS (RC) per SECOND — the game's canonical unit
    // (land income lands in state.cash, the RC wallet, once per tick).
    // Rates are tiny fractions, so exponential notation is the honest display.
    const perSec = rate >= 0.01 ? rate.toFixed(2) : rate.toExponential(2);
    return { perSec, text: `${perSec} RC / sec` };
  }
  function fmtDuration(ms) {
    const s = Math.ceil(ms / 1000);
    const d = Math.floor(s / 86400);
    const h = Math.floor((s % 86400) / 3600);
    const m = Math.floor((s % 3600) / 60);
    if (d > 0) return `${d}d ${h}h`;
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m ${s % 60}s`;
  }

  /* ---------------------------------------------- data / detection */
  // Group the player's tiles into blocks (a plain plot is a 1×1 block).
  // Returns [{ instanceId, tier, rarity, lucky, anchorTx, anchorTy, size, tiles }].
  function ownedBlocks() {
    const s = Store.get();
    const plots = (s && s.plots) || {};
    const byInstance = new Map();
    for (const tid of Object.keys(plots)) {
      const p = plots[tid];
      if (!p || p.satelliteOf) continue; // satellites belong to their anchor
      const iid = String(p.instanceId || tid);
      const tier = Number(p.tier) || 0;
      byInstance.set(iid, {
        instanceId: iid,
        tier,
        rarity: String(p.rarity?.key || p.rarity || "common"),
        lucky: p.lucky === true,
        anchorTx: Number(p.tx),
        anchorTy: Number(p.ty),
        size: Math.pow(2, tier),
        status: p.status || "map",
        rate: CONFIG.plotTileRate(tid, p),
      });
    }
    return [...byInstance.values()].filter((b) => b.status === "map");
  }

  // Strict 2×2 cluster detection (client-side preview of the server's
  // validateMergeSelection). Each cluster is anchored at its NW block.
  function eligibleClusters() {
    const blocks = ownedBlocks();
    const at = new Map(blocks.map((b) => [`${b.anchorTx}_${b.anchorTy}`, b]));
    const clusters = [];
    for (const b of blocks) {
      if (b.tier >= CONFIG.PLOT_MERGE.MAX_TIER) continue;
      const S = b.size;
      const ne = at.get(`${b.anchorTx + S}_${b.anchorTy}`);
      const sw = at.get(`${b.anchorTx}_${b.anchorTy + S}`);
      const se = at.get(`${b.anchorTx + S}_${b.anchorTy + S}`);
      if (!ne || !sw || !se) continue;
      if (ne.tier !== b.tier || sw.tier !== b.tier || se.tier !== b.tier) continue;
      if (ne.rarity !== b.rarity || sw.rarity !== b.rarity || se.rarity !== b.rarity) continue;
      const members = [b, ne, sw, se];
      if (new Set(members.map((m) => m.instanceId)).size !== 4) continue;
      const lucky = members.every((m) => m.lucky);
      clusters.push({
        tier: b.tier,
        targetTier: b.tier + 1,
        rarity: b.rarity,
        lucky,
        anchorTx: b.anchorTx,
        anchorTy: b.anchorTy,
        size: S * 2,
        plotIds: members.map((m) => m.instanceId),
        newRate: CONFIG.plotRate(b.rarity, lucky, b.tier + 1),
        def: CONFIG.PLOT_MERGE.TIERS[b.tier + 1],
      });
    }
    return clusters;
  }

  function trainerLevel() {
    const s = Store.get();
    return Math.max(1, Number(s && s.playerXP && s.playerXP.level) || 1);
  }

  function empireTitle(blocks) {
    const maxTier = blocks.reduce((m, b) => Math.max(m, b.tier), 0);
    if (maxTier >= 3) return "High Lord";
    if (maxTier >= 2) return "Baron";
    if (maxTier >= 1) return "Landholder";
    return "Landowner";
  }

  // GeoJSON for the green merge-mode highlight (whole 2×2 square per cluster).
  function clusterGeoJSON(clusters) {
    return clusters.map((c) => {
      const S = c.size; // tiles per side of the merged square
      const ts = CONFIG.TILE_SIZE_METERS;
      const b1 = Geo.tileBounds(c.anchorTx, c.anchorTy, ts);
      const b2 = Geo.tileBounds(c.anchorTx + S - 1, c.anchorTy + S - 1, ts);
      const lats = b1.concat(b2).map((p) => p[0]);
      const lons = b1.concat(b2).map((p) => p[1]);
      const rect = [
        [Math.min(...lons), Math.min(...lats)],
        [Math.max(...lons), Math.min(...lats)],
        [Math.max(...lons), Math.max(...lats)],
        [Math.min(...lons), Math.max(...lats)],
        [Math.min(...lons), Math.min(...lats)],
      ];
      return { type: "Feature", properties: { tier: c.targetTier }, geometry: { type: "Polygon", coordinates: [rect] } };
    });
  }

  /* --------------------------------------------------------- styles */
  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const css = `
#empire-modal .bd-card{ width:min(520px,96vw); max-height:92vh; overflow-y:auto; }
.em-head{ text-align:center; margin:2px 0 12px; }
.em-title{ font-size:11px; letter-spacing:2px; text-transform:uppercase; color:#9db8dd; }
.em-rank{ font-size:23px; font-weight:900; color:#f5d67b; margin:2px 0; }
.em-stats{ display:flex; gap:8px; margin:10px 0 4px; }
.em-stat{
  flex:1 1 0; padding:10px 8px; border-radius:13px; text-align:center;
  background:rgba(255,255,255,.055); border:1px solid rgba(255,255,255,.1);
}
.em-stat b{ display:block; font-size:15px; color:#fff; font-variant-numeric:tabular-nums; }
.em-stat span{ display:block; font-size:9.5px; letter-spacing:.8px; text-transform:uppercase; color:#93a4c0; margin-top:3px; }
.em-section{
  margin:16px 2px 8px; font-size:10.5px; font-weight:900; letter-spacing:1.5px;
  text-transform:uppercase; color:#9db8dd;
}
/* 🧩 Glassmorphism cards — real backdrop blur on the showcase */
.em-glass{
  position:relative; border-radius:16px; padding:14px; margin:8px 0;
  background:linear-gradient(160deg, rgba(255,255,255,.10), rgba(255,255,255,.03));
  border:1px solid rgba(255,255,255,.18);
  backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px);
  box-shadow:0 12px 34px rgba(0,0,0,.35);
  overflow:hidden;
}
.em-glass.t2{ border-color:rgba(219,228,240,.45); }
.em-glass.t3{
  border-color:rgba(255,215,112,.65);
  background:linear-gradient(160deg, rgba(255,215,112,.14), rgba(255,255,255,.03));
}
.em-glass.merging{ border-style:dashed; border-color:rgba(251,191,36,.7); }
.em-shimmer{
  position:absolute; inset:0; pointer-events:none; opacity:.5;
  background:linear-gradient(115deg, transparent 30%, rgba(255,255,255,.22) 48%, transparent 62%);
  background-size:260% 100%;
  animation:emShimmer 4.2s linear infinite;
}
.em-glass.t3 .em-shimmer{
  background:linear-gradient(115deg, transparent 28%, rgba(255,225,140,.30) 46%, rgba(160,220,255,.22) 55%, transparent 68%);
  background-size:240% 100%;
}
@keyframes emShimmer{ from{ background-position:170% 0; } to{ background-position:-70% 0; } }
.em-card-3d{ transform-style:preserve-3d; transition:transform .25s ease; }
.em-card-3d:hover{ transform:perspective(700px) rotateX(6deg) rotateY(-7deg) translateY(-3px); }
.em-row{ display:flex; justify-content:space-between; align-items:center; gap:8px; }
.em-big{ font-size:17px; font-weight:900; color:#fff; }
.em-sub{ font-size:10.5px; color:#a9bede; line-height:1.55; }
.em-progress{ height:10px; border-radius:7px; background:rgba(255,255,255,.12); overflow:hidden; margin:9px 0 5px; }
.em-progress i{ display:block; height:100%; border-radius:7px; background:linear-gradient(90deg,#2ee59d,#0ea5e9); transition:width .5s ease; }
.em-btn{
  width:100%; padding:12px 10px; border-radius:12px; border:none; cursor:pointer;
  font-family:inherit; font-size:13.5px; font-weight:900; color:#06210f;
  background:linear-gradient(135deg,#2ee59d,#14b8a6);
}
.em-btn:disabled{ opacity:.45; cursor:default; }
.em-btn.gold{ background:linear-gradient(135deg,#ffd770,#f59e0b); color:#3a2a04; }
.em-btn.ghost{ background:rgba(255,255,255,.09); color:#dbe4f0; border:1px solid rgba(255,255,255,.18); }
.em-warn{ color:#fca5a5; font-size:10.5px; margin-top:6px; }
.em-ok{ color:#86efac; font-size:10.5px; margin-top:6px; }
/* 🎥 Cluster focus card — floats over the map while the camera is out on
   the land. The cluster itself glows green behind it. */
#em-focus{
  position:fixed; left:12px; right:12px;
  /* Sits above the MORE/BUY tab bar but UNDER every .modal (z 58) — the
     merge confirm sheet must cover this card, not the other way round. */
  bottom:calc(96px + env(safe-area-inset-bottom,0px));
  z-index:57; border-radius:18px; padding:16px;
  background:linear-gradient(165deg, rgba(24,32,56,.93), rgba(14,18,34,.95));
  border:1px solid rgba(46,229,157,.45);
  backdrop-filter:blur(10px); -webkit-backdrop-filter:blur(10px);
  box-shadow:0 18px 50px rgba(0,0,0,.5);
  animation:emFocusIn .3s cubic-bezier(.22,1,.36,1);
}
@keyframes emFocusIn{ from{ opacity:0; transform:translateY(18px); } to{ opacity:1; transform:none; } }
#em-focus .em-big{ display:flex; align-items:center; gap:7px; }
#em-focus .em-big::before{
  content:""; width:9px; height:9px; border-radius:50%;
  background:#2ee59d; box-shadow:0 0 12px #2ee59d;
  animation:emPulse 1.6s ease-in-out infinite;
}
@keyframes emPulse{ 0%,100%{ opacity:1; transform:scale(1); } 50%{ opacity:.55; transform:scale(.8); } }
`;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = css;
    document.head.appendChild(style);
  }

  /* ----------------------------------------------------------- view */
  function tierBadge(tier) {
    return tier >= 1 ? `T${tier}` : "T0";
  }

  function render() {
    const box = el("empire-body");
    if (!box) return;
    const s = Store.get();
    const blocks = ownedBlocks();
    const totalTiles = blocks.reduce((n, b) => n + b.size * b.size, 0);
    const rate = blocks.reduce((sum, b) => sum + b.rate, 0);
    const income = fmtRate(rate);
    const merges = (s && s.plotMerges && typeof s.plotMerges === "object") ? s.plotMerges : {};
    const mergeList = Object.entries(merges);
    const clusters = eligibleClusters();
    const level = trainerLevel();

    // ---- overview ----
    const overview = `
      <div class="em-head">
        <div class="em-title">👑 My Empire</div>
        <div class="em-rank">${empireTitle(blocks)}</div>
      </div>
      <div class="em-stats">
        <div class="em-stat"><b>${blocks.length}</b><span>Land Holdings</span></div>
        <div class="em-stat"><b>${totalTiles.toLocaleString()}</b><span>Tiles Owned</span></div>
        <div class="em-stat"><b>${income.perSec}</b><span>RC / Sec</span></div>
      </div>
      <div class="em-sub" style="text-align:center">Passive income: +${income.text} · Trainer Lv ${level}</div>
    `;

    // ---- construction queue ----
    const queue = mergeList.length ? `
      <div class="em-section">🏗 Active Construction</div>
      ${mergeList.map(([iid, m]) => {
        const total = Number(m.mergeCompleteAt) - Number(m.startedAt);
        const left = Number(m.mergeCompleteAt) - Date.now();
        const done = left <= 0;
        const pct = Math.max(0, Math.min(100, ((total - Math.max(0, left)) / Math.max(1, total)) * 100));
        return `
        <div class="em-glass em-card-3d ${done ? "t2" : "merging"}">
          ${Number(m.tier) >= 3 ? `<div class="em-shimmer"></div>` : ""}
          <div class="em-row">
            <div>
              <div class="em-big">${tierBadge(m.tier)} ${String(m.rarity || "").toUpperCase()}${m.lucky ? " 🍀" : ""}</div>
              <div class="em-sub">Building at [${m.anchorTx}, ${m.anchorTy}]</div>
            </div>
            <div style="text-align:right">
              <div class="em-big">${done ? "✅ Ready" : fmtDuration(left)}</div>
              <div class="em-sub">${done ? "construction complete" : "remaining"}</div>
            </div>
          </div>
          <div class="em-progress"><i style="width:${pct.toFixed(1)}%"></i></div>
          ${done
            ? `<button class="em-btn gold" data-claim="${iid}">✨ Claim &amp; Finalize</button>`
            : `<button class="em-btn" disabled>🔨 Constructing…</button>`}
        </div>`;
      }).join("")}
    ` : "";

    // ---- merge tool ----
    const mergeTool = `
      <div class="em-section">🧩 Merge Tool</div>
      ${clusters.length ? `
        <div class="em-sub" style="margin-bottom:8px">${clusters.length} eligible 2×2 cluster${clusters.length > 1 ? "s" : ""} on your land${mergeMode ? " — highlighted in green on the map" : ""}.</div>
        ${clusters.map((c, i) => {
          const locked = level < (c.def ? c.def.level : 99);
          return `
          <div class="em-glass ${c.targetTier >= 3 ? "t3" : "t2"}" data-focus="${i}" style="cursor:pointer" title="Tap to fly the camera to this cluster">
            ${c.targetTier >= 3 ? `<div class="em-shimmer"></div>` : ""}
            <div class="em-row">
              <div>
                <div class="em-big">T${c.tier} → T${c.targetTier} · ${String(c.rarity).toUpperCase()}${c.lucky ? " 🍀" : ""}</div>
                <div class="em-sub">Square at [${c.anchorTx}, ${c.anchorTy}] · ${c.size}×${c.size} tiles after merge</div>
              </div>
              <div style="text-align:right">
                <div class="em-big" style="color:#86efac">+5%</div>
                <div class="em-sub">vs unmerged<br>${CONFIG.plotRate(c.rarity, c.lucky, c.tier + 1).toExponential(2)} RC/sec</div>
              </div>
            </div>
            ${locked
              ? `<div class="em-warn">⛔ Requires Trainer Level ${c.def.level} (you are Lv ${level})</div>`
              : `<div class="em-ok">⏱ ${fmtDuration(c.def.durationMs)} construction · earns nothing while building</div>`}
            <button class="em-btn" data-merge="${i}" ${locked ? "disabled" : ""}>
              🔨 Begin Merge (${fmtDuration(c.def.durationMs)})
            </button>
          </div>`;
        }).join("")}
        <button class="em-btn ghost" id="em-merge-mode">${mergeMode ? "✓ Merge Mode ON — tap to clear highlights" : "Show eligible clusters on the map"}</button>
      ` : `
        <div class="em-glass">
          <div class="em-sub">No mergeable clusters yet. A merge needs <b>4 same-rarity plots of the same tier arranged in a tight 2×2 square</b> — expand your land into blocks and they'll appear here.</div>
        </div>
      `}
    `;

    // ---- showcase ----
    const merged = blocks.filter((b) => b.tier >= 1);
    const showcase = merged.length ? `
      <div class="em-section">🏛 Monuments</div>
      ${merged.map((b) => `
        <div class="em-glass em-card-3d ${b.tier >= 3 ? "t3" : "t2"}">
          <div class="em-shimmer"></div>
          <div class="em-row">
            <div>
              <div class="em-big">${tierBadge(b.tier)} ${b.rarity.toUpperCase()}${b.lucky ? " 🍀" : ""}</div>
              <div class="em-sub">${b.size}×${b.size} tiles · at [${b.anchorTx}, ${b.anchorTy}]</div>
            </div>
            <div style="text-align:right">
              <div class="em-big">${b.rate.toExponential(2)}</div>
              <div class="em-sub">RC / sec</div>
            </div>
          </div>
        </div>
      `).join("")}
    ` : "";

    box.innerHTML = overview + queue + mergeTool + showcase;

    // ---- wiring ----
    box.querySelectorAll("[data-claim]").forEach((btn) => {
      btn.addEventListener("click", () => claimMerge(btn.getAttribute("data-claim")));
    });
    // 🎥 Tapping a cluster card flies the camera to it on the map.
    box.querySelectorAll("[data-focus]").forEach((card) => {
      card.addEventListener("click", () => flyToCluster(clusters[Number(card.getAttribute("data-focus"))]));
    });
    box.querySelectorAll("[data-merge]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        if (e && e.stopPropagation) e.stopPropagation(); // don't also fly
        confirmMerge(clusters[Number(btn.getAttribute("data-merge"))]);
      });
    });
    const mm = el("em-merge-mode");
    if (mm) mm.addEventListener("click", () => {
      mergeMode = !mergeMode;
      if (typeof Grid !== "undefined") {
        if (mergeMode) Grid.showMergeClusters(clusterGeoJSON(clusters));
        else Grid.clearMergeClusters();
      }
      render();
    });
  }

  /* ------------------------------------------------- 🎥 camera focus */
  function clusterBounds(c) {
    const ts = CONFIG.TILE_SIZE_METERS;
    const b1 = Geo.tileBounds(c.anchorTx, c.anchorTy, ts);
    const b2 = Geo.tileBounds(c.anchorTx + c.size - 1, c.anchorTy + c.size - 1, ts);
    const lats = b1.concat(b2).map((p) => p[0]);
    const lons = b1.concat(b2).map((p) => p[1]);
    return [
      [Math.min(...lons), Math.min(...lats)],
      [Math.max(...lons), Math.max(...lats)],
    ];
  }

  function flyToCluster(c) {
    if (!c || typeof Grid === "undefined" || !Grid.getMap) return;
    const map = Grid.getMap();
    if (!map) return;
    savedView = { center: map.getCenter(), zoom: map.getZoom() };
    focusCluster = c;

    // The list hides while the camera is out on the land.
    const m = el(MODAL_ID);
    if (m) m.classList.add("hidden");

    // This one cluster glows green on the map — the visual anchor for the
    // floating confirm card.
    if (Grid.showMergeClusters) Grid.showMergeClusters(clusterGeoJSON([c]));

    try {
      map.fitBounds(clusterBounds(c), {
        padding: { top: 120, bottom: 300, left: 56, right: 56 },
        maxZoom: 19,
        duration: 1600,
        essential: true,
      });
    } catch (e) {
      console.warn("[Empire] camera flight failed:", e && e.message);
    }
    renderFocusOverlay(c);
  }

  function renderFocusOverlay(c) {
    let ov = el("em-focus");
    if (!ov) {
      ov = document.createElement("div");
      ov.id = "em-focus";
      document.body.appendChild(ov);
    }
    ov.innerHTML = `
      <div class="em-row">
        <div>
          <div class="em-big">T${c.tier} → T${c.targetTier} · ${String(c.rarity).toUpperCase()}${c.lucky ? " 🍀" : ""}</div>
          <div class="em-sub">Cluster at [${c.anchorTx}, ${c.anchorTy}] · ${c.size}×${c.size} tiles after merge · ${c.newRate.toExponential(2)} RC/sec</div>
        </div>
      </div>
      <div style="display:flex; gap:9px; margin-top:12px">
        <button class="em-btn" id="em-focus-merge">🧩 Merge This Cluster</button>
        <button class="em-btn ghost" id="em-focus-back" style="flex:0 0 auto; width:130px">↩ My Empire</button>
      </div>`;
    ov.querySelector("#em-focus-merge").addEventListener("click", () => confirmMerge(c));
    ov.querySelector("#em-focus-back").addEventListener("click", () => {
      flyPlayerBack();
      open();
    });
  }

  // Snap the camera home to the player — called after a merge begins or a
  // monument is claimed ("complete/begin merge flies camera back").
  function flyPlayerBack() {
    const map = (typeof Grid !== "undefined" && Grid.getMap) ? Grid.getMap() : null;
    if (map) {
      const pos = (typeof Grid !== "undefined" && Grid.getPlayerPosition) ? Grid.getPlayerPosition() : null;
      const target = pos && Number.isFinite(pos.lat) && Number.isFinite(pos.lon)
        ? [pos.lon, pos.lat]
        : (savedView ? [savedView.center.lng, savedView.center.lat] : null);
      try {
        if (target) {
          map.flyTo({
            center: target,
            zoom: savedView ? savedView.zoom : map.getZoom(),
            duration: 1500,
            essential: true,
          });
        }
      } catch (e) {}
    }
    focusCluster = null;
    savedView = null;
    if (typeof Grid !== "undefined" && Grid.clearMergeClusters) Grid.clearMergeClusters();
    const ov = el("em-focus");
    if (ov) ov.remove();
  }

  /* -------------------------------------------------------- actions */
  function confirmMerge(c) {
    if (!c) return;
    const old = document.getElementById("em-confirm");
    if (old) old.remove();
    const overlay = document.createElement("div");
    overlay.id = "em-confirm";
    overlay.className = "modal";
    overlay.innerHTML = `
      <div class="bd-card" style="width:min(360px,92vw)">
        <button class="bd-close">✕</button>
        <div class="em-title" style="margin-top:4px">Confirm Merge</div>
        <div class="em-big" style="text-align:center;margin:8px 0">
          4 × T${c.tier} ${c.rarity.toUpperCase()}${c.lucky ? " 🍀" : ""} → 1 × T${c.targetTier}
        </div>
        <div class="em-sub" style="text-align:center">
          New yield: <b style="color:#86efac">${c.newRate.toExponential(2)} RC / sec</b> (+5% vs the 4 plots unmerged)<br>
          ⏱ Construction takes <b>${fmtDuration(c.def.durationMs)}</b> — the 4 plots stop earning immediately and cannot be cancelled.
          ${c.lucky ? "<br>🍀 All four are lucky — the merged plot keeps 🍀." : ""}
        </div>
        <div style="margin-top:12px"><button class="em-btn" id="em-confirm-go">🔨 Begin Merge</button></div>
      </div>`;
    document.body.appendChild(overlay);
    overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });
    overlay.querySelector(".bd-close").addEventListener("click", () => overlay.remove());
    overlay.querySelector("#em-confirm-go").addEventListener("click", async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      btn.textContent = "Starting…";
      const d = await call("plotStartMerge", { plotIds: c.plotIds });
      if (d && d.ok) {
        overlay.remove();
        toast(`🔨 Merge started! Your T${d.targetTier} ${c.rarity} plot will be ready in ${fmtDuration(d.durationMs)}.`, 5000);
        // 🎥 Begin merge → the camera snaps home to the player; the site is
        // now a dashed amber construction block on the map.
        flyPlayerBack();
        await refreshFromServer();
      } else {
        const why = {
          level_too_low: "⛔ Your trainer level is too low for this tier.",
          not_on_map: "⚠️ One of the plots is no longer on your map.",
          max_tier: "T3 is the highest tier.",
          mixed_rarity: "All four plots must share a rarity.",
          mixed_tiers: "All four plots must share a tier.",
          not_a_square: "The four plots must form a tight 2×2 square.",
          footprint_incomplete: "⚠️ Part of the footprint is missing — try again.",
          too_soon: "Hold on a moment…",
        }[d && d.reason] || "⚠️ Merge could not start — try again.";
        toast(why, 4500);
        btn.disabled = false;
        btn.textContent = "🔨 Begin Merge";
      }
    });
  }

  async function claimMerge(mergeInstanceId) {
    const d = await call("plotClaimMerge", { mergeInstanceId });
    if (d && d.ok) {
      toast(`🏛 ${d.plot.rarity.toUpperCase()} T${d.plot.tier} monument complete! It's earning ${d.plot.rate.toExponential(2)} RC / sec now.`, 5500);
      // 🎥 Claim → camera snaps home to the player as the monument lights up.
      close();
      flyPlayerBack();
      await refreshFromServer();
    } else {
      toast(d && d.reason === "not_ready"
        ? `⏱ Still building — ${fmtDuration(d.retryAfterMs)} left.`
        : "⚠️ Could not claim — try again.", 4500);
    }
  }

  // Pull the authoritative state after a mutation (the sync mirror carries
  // plots + plotMerges back), then repaint the screen and the map.
  async function refreshFromServer() {
    try {
      if (typeof Store !== "undefined" && Store.syncSafeStateToCloud) {
        await Store.syncSafeStateToCloud();
      }
    } catch (e) {}
    render();
    if (typeof Grid !== "undefined" && Grid.render) Grid.render();
  }

  /* --------------------------------------------------------- open */
  function open() {
    injectStyle();
    let modal = el(MODAL_ID);
    if (!modal) {
      modal = document.createElement("div");
      modal.id = MODAL_ID;
      modal.className = "modal hidden bd-modal";
      modal.innerHTML = `
        <div class="bd-card">
          <button class="bd-close">✕</button>
          <div id="empire-body"></div>
        </div>`;
      modal.addEventListener("click", (e) => { if (e.target === modal) close(); });
      document.body.appendChild(modal);
      modal.querySelector(".bd-close").addEventListener("click", close);
    }
    modal.classList.remove("hidden");
    render();
  }

  function close() {
    const m = el(MODAL_ID);
    if (m) m.classList.add("hidden");
    if (mergeMode) {
      mergeMode = false;
      if (typeof Grid !== "undefined") Grid.clearMergeClusters();
    }
    const overlay = document.getElementById("em-confirm");
    if (overlay) overlay.remove();
    // A stray focus card must never linger over the map.
    const focus = el("em-focus");
    if (focus) focus.remove();
  }

  // Entry wiring — delegated so script order never matters. The Home tab of
  // the Realm Menu (#menu-empire-btn) opens the command screen.
  function init() {
    document.addEventListener("click", (e) => {
      const t = e.target && e.target.closest ? e.target.closest("#menu-empire-btn") : null;
      if (t) {
        const menu = document.getElementById("menu-modal");
        if (menu) menu.classList.add("hidden");
        open();
      }
    });
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  return { init, open, close, render, ownedBlocks, eligibleClusters };
})();

window.Empire = Empire;
