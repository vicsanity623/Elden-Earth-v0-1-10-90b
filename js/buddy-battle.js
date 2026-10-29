/* ==========================================================================
   Elden Earth — Buddy Battle
   Classic turn-based battle screen for wild buddy encounters.

   Flow:
     tap wild spawn -> encounter intro -> turn-based battle
       -> wild faints  -> CHOICE: Feast (consume) or Tame (3 berry feedings)
       -> ally faints  -> defeat
     -> capture/feast result screen with full buddy stats

   Nothing here writes game state directly: every outcome is reported back
   through the `onResult` callback so buddy.js owns persistence + the server
   call. That keeps this file a pure combat/UI module.
   ========================================================================== */
const BuddyBattle = (() => {
  "use strict";

  const ROOT_ID = "buddy-battle-root";
  const STYLE_ID = "buddy-battle-style";

  const FEED_TOTAL = 3;        // 3 feedings
  const FEED_BERRIES = 10;     // 10 berries each
  const FEED_INTERVAL_MS = 5000; // every 5 seconds

  let ctx = null;              // active battle context
  let previewPlayer = null;
  let previewWild = null;
  let tameTimer = null;

  /* ================================================================ CSS */
  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const css = `
#bb-root{
  position:fixed; inset:0; z-index:3600; display:flex; flex-direction:column;
  background:
    radial-gradient(120% 80% at 50% 0%, rgba(46,26,84,.96) 0%, rgba(10,14,26,.99) 58%),
    #080c16;
  color:#e8eefc; font-family:inherit; overflow:hidden;
  animation:bbIn .28s ease;
}
@keyframes bbIn{from{opacity:0; transform:scale(1.02);} to{opacity:1; transform:scale(1);}}
#bb-root.bb-out{animation:bbOut .26s ease forwards;}
@keyframes bbOut{to{opacity:0; transform:scale(.99);}}

.bb-stage{
  flex:1 1 auto; position:relative; display:flex; flex-direction:column;
  justify-content:space-between; padding:14px 14px 6px; min-height:0; overflow:hidden;
}
.bb-arena{position:absolute; inset:0; overflow:hidden;}
.bb-arena::before{
  content:""; position:absolute; left:50%; top:52%; width:150vw; height:70vh;
  transform:translate(-50%,-50%);
  background:radial-gradient(ellipse at center, rgba(120,80,220,.18), transparent 62%);
  pointer-events:none;
}

.bb-side{position:relative; z-index:2; display:flex; gap:12px; align-items:flex-end;}
.bb-side.bb-top{align-items:flex-start; flex-direction:row;}
.bb-side.bb-bottom{flex-direction:row-reverse; align-items:flex-end;}

.bb-model{
  width:132px; height:132px; flex:0 0 auto; border-radius:18px;
  background:rgba(255,255,255,.045); border:1px solid rgba(160,190,255,.16);
  overflow:hidden;
}
.bb-side.bb-bottom .bb-model{width:158px; height:158px;}

.bb-card{
  flex:1 1 auto; min-width:0; padding:10px 12px; border-radius:14px;
  background:rgba(14,20,34,.78); border:1px solid rgba(150,180,240,.18);
  backdrop-filter:blur(8px); -webkit-backdrop-filter:blur(8px);
}
.bb-head{display:flex; align-items:center; gap:8px; margin-bottom:6px;}
.bb-name{
  font-size:15px; font-weight:800; letter-spacing:.2px;
  white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
}
.bb-lv{font-size:11px; color:#9db8dd; font-weight:700; flex:0 0 auto;}
.bb-types{display:flex; gap:4px; margin-left:auto; flex:0 0 auto;}
.bb-type{
  font-size:9px; padding:2px 7px; border-radius:99px; font-weight:800;
  letter-spacing:.5px; text-transform:uppercase; color:#0b1020;
}
.bb-hpbar{
  height:11px; border-radius:99px; background:rgba(255,255,255,.12); overflow:hidden;
  position:relative;
}
.bb-hpfill{
  height:100%; width:100%; border-radius:99px;
  background:linear-gradient(90deg,#22c55e,#4ade80);
  transition:width .42s cubic-bezier(.22,1,.36,1);
}
.bb-hpfill.bb-mid{background:linear-gradient(90deg,#eab308,#facc15);}
.bb-hpfill.bb-low{background:linear-gradient(90deg,#dc2626,#f87171);}
.bb-hptext{
  display:flex; justify-content:space-between; margin-top:4px;
  font-size:10px; color:#a9bede; font-variant-numeric:tabular-nums;
}
.bb-status{
  display:inline-block; margin-left:6px; padding:1px 7px; border-radius:99px;
  font-size:9px; font-weight:800; letter-spacing:.6px; text-transform:uppercase;
}
.bb-status.burn{background:rgba(251,146,60,.22); color:#fdba74;}
.bb-status.poison{background:rgba(163,230,53,.2); color:#bef264;}
.bb-status.stun{background:rgba(250,204,21,.22); color:#fde047;}

.bb-log{
  position:relative; z-index:2; height:74px; overflow-y:auto; margin:8px 2px 0;
  padding:8px 10px; border-radius:12px; background:rgba(8,12,22,.6);
  border:1px solid rgba(140,170,230,.12); font-size:11.5px; line-height:1.55; color:#c9d8f0;
}
.bb-log .bb-line{margin:0 0 2px;}
.bb-log .bb-line.bb-strong{color:#fbbf24; font-weight:700;}
.bb-log .bb-line.bb-bad{color:#fca5a5;}
.bb-log .bb-line.bb-good{color:#86efac;}

.bb-controls{
  flex:0 0 auto; padding:10px 12px calc(12px + env(safe-area-inset-bottom,0px));
  background:rgba(10,15,26,.94); border-top:1px solid rgba(150,180,240,.16);
}
.bb-section-label{
  font-size:10px; letter-spacing:1.6px; text-transform:uppercase; color:#7f97ba;
  margin:0 0 7px;
}
.bb-moves{display:grid; grid-template-columns:1fr 1fr; gap:8px;}
.bb-move{
  position:relative; text-align:left; padding:11px 12px; border-radius:12px;
  border:1px solid rgba(150,180,240,.2); background:rgba(28,38,62,.85);
  color:#eaf1ff; cursor:pointer; font-family:inherit;
  transition:transform .12s ease, background .18s ease, border-color .18s ease;
}
.bb-move:active{transform:scale(.97);}
.bb-move:disabled{opacity:.42; cursor:not-allowed;}
.bb-move .bb-mv-name{font-size:13px; font-weight:800; display:block;}
.bb-move .bb-mv-meta{font-size:10px; color:#9db8dd; display:block; margin-top:3px;}
.bb-move .bb-mv-type{
  position:absolute; top:8px; right:8px; font-size:8.5px; font-weight:800;
  padding:2px 6px; border-radius:99px; color:#0b1020; letter-spacing:.4px;
}
.bb-move .bb-mv-pp{
  position:absolute; bottom:8px; right:8px; font-size:9px; color:#7f97ba;
  font-variant-numeric:tabular-nums;
}

.bb-actions{display:grid; grid-template-columns:repeat(3,1fr); gap:8px; margin-top:8px;}
.bb-btn{
  padding:11px 8px; border-radius:12px; border:1px solid rgba(150,180,240,.2);
  background:rgba(28,38,62,.85); color:#eaf1ff; font-family:inherit;
  font-size:12px; font-weight:700; cursor:pointer; letter-spacing:.3px;
  transition:transform .12s ease, background .18s ease;
}
.bb-btn:active{transform:scale(.97);}
.bb-btn:disabled{opacity:.42; cursor:not-allowed;}
.bb-btn.bb-primary{
  background:linear-gradient(135deg,#2b6cf0,#7c3aed); border-color:transparent;
}
.bb-btn.bb-danger{background:rgba(190,50,60,.28); border-color:rgba(248,113,113,.35);}
.bb-btn.bb-gold{background:linear-gradient(135deg,#b45309,#d97706); border-color:transparent;}

.bb-center{
  position:absolute; inset:0; z-index:6; display:flex; align-items:center;
  justify-content:center; padding:20px;
  background:rgba(6,10,18,.72); backdrop-filter:blur(5px); -webkit-backdrop-filter:blur(5px);
}
.bb-panel{
  width:100%; max-width:420px; max-height:88vh; overflow-y:auto;
  padding:20px 18px; border-radius:18px;
  background:linear-gradient(160deg,rgba(28,36,64,.98),rgba(18,22,40,.99));
  border:1px solid rgba(150,180,240,.26);
  box-shadow:0 24px 70px rgba(0,0,0,.6);
  animation:bbPop .3s cubic-bezier(.22,1,.36,1);
}
@keyframes bbPop{from{opacity:0; transform:translateY(14px) scale(.97);} to{opacity:1; transform:none;}}
.bb-panel h3{
  margin:0 0 6px; font-size:19px; font-weight:900; letter-spacing:.2px;
}
.bb-panel .bb-sub{margin:0 0 16px; font-size:12.5px; color:#a9bede; line-height:1.6;}
.bb-panel .bb-btns{display:flex; flex-direction:column; gap:9px; margin-top:16px;}

.bb-choice{
  display:flex; gap:10px; align-items:center; width:100%; text-align:left;
  padding:14px; border-radius:14px; cursor:pointer; font-family:inherit;
  border:1px solid rgba(150,180,240,.22); background:rgba(32,42,70,.9); color:#eaf1ff;
  transition:transform .12s ease, border-color .18s ease;
}
.bb-choice:active{transform:scale(.98);}
.bb-choice .bb-ch-icon{font-size:26px; flex:0 0 auto;}
.bb-choice .bb-ch-title{font-size:14px; font-weight:800; display:block;}
.bb-choice .bb-ch-desc{font-size:11px; color:#a9bede; display:block; margin-top:3px; line-height:1.5;}
.bb-choice.bb-ch-feast{border-color:rgba(248,113,113,.4);}
.bb-choice.bb-ch-tame{border-color:rgba(74,222,128,.4);}

.bb-feed-wrap{text-align:center;}
.bb-feed-orb{
  width:118px; height:118px; margin:6px auto 14px; border-radius:50%;
  background:radial-gradient(circle at 34% 30%, rgba(255,255,255,.24), rgba(120,60,220,.28) 62%, rgba(20,20,40,.5));
  border:2px solid rgba(196,181,253,.5); display:flex; align-items:center;
  justify-content:center; font-size:46px; position:relative;
}
.bb-feed-orb.bb-feeding{animation:bbFeedPulse 1.1s ease-in-out infinite;}
@keyframes bbFeedPulse{
  0%,100%{transform:scale(1); box-shadow:0 0 0 0 rgba(196,181,253,.5);}
  50%{transform:scale(1.05); box-shadow:0 0 0 18px rgba(196,181,253,0);}
}
.bb-feed-steps{display:flex; gap:8px; justify-content:center; margin:12px 0 6px;}
.bb-feed-dot{
  width:38px; height:8px; border-radius:99px; background:rgba(255,255,255,.14);
  transition:background .35s ease;
}
.bb-feed-dot.done{background:linear-gradient(90deg,#4ade80,#22c55e);}
.bb-feed-count{font-size:13px; color:#c9d8f0; margin-top:6px;}
.bb-countdown{
  font-size:28px; font-weight:900; color:#c4b5fd; margin:10px 0 2px;
  font-variant-numeric:tabular-nums;
}

.bb-stat-grid{
  display:grid; grid-template-columns:1fr 1fr; gap:8px; margin:14px 0;
}
.bb-stat{
  padding:10px 11px; border-radius:12px; background:rgba(255,255,255,.055);
  border:1px solid rgba(150,180,240,.14);
}
.bb-stat .bb-st-k{font-size:9.5px; letter-spacing:1.1px; text-transform:uppercase; color:#7f97ba;}
.bb-stat .bb-st-v{font-size:17px; font-weight:800; margin-top:2px; font-variant-numeric:tabular-nums;}
.bb-iv-row{display:flex; align-items:center; gap:8px; margin:4px 0;}
.bb-iv-row .bb-iv-k{width:42px; font-size:10px; color:#9db8dd; text-transform:uppercase; letter-spacing:.7px;}
.bb-iv-row .bb-iv-bar{flex:1 1 auto; height:7px; border-radius:99px; background:rgba(255,255,255,.11); overflow:hidden;}
.bb-iv-row .bb-iv-fill{height:100%; border-radius:99px; background:linear-gradient(90deg,#60a5fa,#c084fc);}
.bb-iv-row .bb-iv-n{width:26px; text-align:right; font-size:11px; font-weight:700; font-variant-numeric:tabular-nums;}
.bb-grade{
  display:inline-flex; align-items:center; justify-content:center;
  width:38px; height:38px; border-radius:12px; font-size:19px; font-weight:900;
  background:rgba(255,255,255,.08); border:1px solid rgba(150,180,240,.22);
}
.bb-preview-box{
  width:100%; height:190px; border-radius:16px; overflow:hidden;
  background:rgba(255,255,255,.04); border:1px solid rgba(150,180,240,.16);
  margin-bottom:4px;
}
.bb-move-chips{display:flex; flex-wrap:wrap; gap:6px; margin-top:10px;}
.bb-chip{
  font-size:10.5px; padding:5px 10px; border-radius:99px; font-weight:700;
  color:#0b1020; letter-spacing:.3px;
}
.bb-colorway{
  display:inline-block; margin-left:6px; padding:2px 9px; border-radius:99px;
  font-size:10px; font-weight:700; letter-spacing:.5px;
  background:rgba(255,255,255,.1); color:#dbe6fb; border:1px solid rgba(150,180,240,.2);
}
`;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = css;
    document.head.appendChild(style);
  }

  /* ================================================================ DOM */
  function el(id) { return document.getElementById(id); }

  function buildShell() {
    const root = document.createElement("div");
    root.id = ROOT_ID;
    root.innerHTML = `
      <div id="bb-root">
        <div class="bb-stage">
          <div class="bb-arena"></div>

          <div class="bb-side bb-top">
            <div class="bb-card">
              <div class="bb-head">
                <div class="bb-name" id="bb-wild-name">Wild Buddy</div>
                <div class="bb-lv" id="bb-wild-lv">Lv. 5</div>
                <div class="bb-types" id="bb-wild-types"></div>
              </div>
              <div class="bb-hpbar"><div class="bb-hpfill" id="bb-wild-hp"></div></div>
              <div class="bb-hptext">
                <span id="bb-wild-status-wrap"></span>
                <span id="bb-wild-hptext">-- / --</span>
              </div>
            </div>
            <div class="bb-model" id="bb-wild-model"></div>
          </div>

          <div class="bb-log" id="bb-log"></div>

          <div class="bb-side bb-bottom">
            <div class="bb-card">
              <div class="bb-head">
                <div class="bb-name" id="bb-ally-name">Buddy</div>
                <div class="bb-lv" id="bb-ally-lv">Lv. 5</div>
                <div class="bb-types" id="bb-ally-types"></div>
              </div>
              <div class="bb-hpbar"><div class="bb-hpfill" id="bb-ally-hp"></div></div>
              <div class="bb-hptext">
                <span id="bb-ally-status-wrap"></span>
                <span id="bb-ally-hptext">-- / --</span>
              </div>
            </div>
            <div class="bb-model" id="bb-ally-model"></div>
          </div>
        </div>

        <div class="bb-controls">
          <div class="bb-section-label" id="bb-controls-label">Choose a move</div>
          <div class="bb-moves" id="bb-moves"></div>
          <div class="bb-actions">
            <button class="bb-btn" id="bb-berry-btn">🍓 Berry</button>
            <button class="bb-btn" id="bb-switch-btn">🔄 Switch</button>
            <button class="bb-btn bb-danger" id="bb-flee-btn">🏃 Flee</button>
          </div>
        </div>

        <div class="bb-center hidden" id="bb-overlay"></div>
      </div>
    `;
    document.body.appendChild(root);
    return root;
  }

  /* ============================================================ helpers */
  function escapeHtml(str) {
    return String(str == null ? "" : str)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function typeChip(typeId) {
    const t = BuddyData.getType(typeId);
    if (!t) return "";
    return `<span class="bb-type" style="background:${t.color}">${t.icon} ${t.name}</span>`;
  }

  function hpClass(side) {
    const pct = side.hp / Math.max(1, side.maxHp);
    if (pct <= 0.25) return "bb-low";
    if (pct <= 0.55) return "bb-mid";
    return "";
  }

  function statusChip(side) {
    if (!side.status) return "";
    const map = { burn: "🔥 Burn", poison: "☠️ Poison", stun: "⚡ Stun" };
    return `<span class="bb-status ${side.status}">${map[side.status] || side.status}</span>`;
  }

  function log(message, kind) {
    const box = el("bb-log");
    if (!box) return;
    const line = document.createElement("div");
    line.className = "bb-line" + (kind ? " bb-" + kind : "");
    line.textContent = message;
    box.appendChild(line);
    box.scrollTop = box.scrollHeight;
    while (box.children.length > 60) box.removeChild(box.firstChild);
  }

  function sleep(ms) { return new Promise(res => setTimeout(res, ms)); }

  function refreshHud() {
    if (!ctx) return;
    const w = ctx.wild, a = ctx.ally;

    el("bb-wild-name").textContent = w.name;
    el("bb-wild-lv").textContent = "Lv. " + w.inst.level;
    el("bb-wild-types").innerHTML = (w.species ? w.species.types : []).map(typeChip).join("");
    el("bb-wild-hp").style.width = Math.max(0, (w.hp / w.maxHp) * 100) + "%";
    el("bb-wild-hp").className = "bb-hpfill " + hpClass(w);
    el("bb-wild-hptext").textContent = `${Math.max(0, w.hp)} / ${w.maxHp}`;
    el("bb-wild-status-wrap").innerHTML = statusChip(w);

    el("bb-ally-name").textContent = a.name;
    el("bb-ally-lv").textContent = "Lv. " + a.inst.level;
    el("bb-ally-types").innerHTML = (a.species ? a.species.types : []).map(typeChip).join("");
    el("bb-ally-hp").style.width = Math.max(0, (a.hp / a.maxHp) * 100) + "%";
    el("bb-ally-hp").className = "bb-hpfill " + hpClass(a);
    el("bb-ally-hptext").textContent = `${Math.max(0, a.hp)} / ${a.maxHp}`;
    el("bb-ally-status-wrap").innerHTML = statusChip(a);
  }

  function renderMoves() {
    const wrap = el("bb-moves");
    if (!wrap || !ctx) return;
    wrap.innerHTML = "";

    ctx.ally.moves.forEach((slot, i) => {
      const mv = slot.def;
      const t = BuddyData.getType(mv.type) || { color: "#94a3b8", name: "?" };
      const btn = document.createElement("button");
      btn.className = "bb-move";
      btn.disabled = slot.pp <= 0 || ctx.busy || ctx.ally.fainted;
      btn.innerHTML = `
        <span class="bb-mv-type" style="background:${t.color}">${t.name}</span>
        <span class="bb-mv-name">${mv.name}</span>
        <span class="bb-mv-meta">${mv.category === "status" ? "Status" : "Pow " + mv.power} · ${mv.accuracy}% acc</span>
        <span class="bb-mv-pp">${slot.pp}/${slot.maxPp} PP</span>
      `;
      btn.addEventListener("click", () => playerMove(i));
      wrap.appendChild(btn);
    });

    const berry = el("bb-berry-btn");
    const state = (typeof Store !== "undefined" && Store.get) ? Store.get() : null;
    const berries = state ? (state.berries || 0) : 0;
    if (berry) {
      berry.disabled = ctx.busy || berries <= 0;
      berry.textContent = `🍓 Berry (${berries})`;
    }
    const sw = el("bb-switch-btn");
    if (sw) {
      const bag = ctx.bag || [];
      sw.disabled = ctx.busy || bag.filter(b => b.uid !== ctx.ally.inst.uid && b.currentHp > 0).length === 0;
    }
    const flee = el("bb-flee-btn");
    if (flee) flee.disabled = ctx.busy;

    const label = el("bb-controls-label");
    if (label) label.textContent = ctx.busy ? "Resolving turn..." : "Choose a move";
  }

  function setBusy(b) {
    if (!ctx) return;
    ctx.busy = !!b;
    renderMoves();
  }

  function showOverlay(html) {
    const ov = el("bb-overlay");
    if (!ov) return;
    ov.innerHTML = `<div class="bb-panel">${html}</div>`;
    ov.classList.remove("hidden");
  }

  function hideOverlay() {
    const ov = el("bb-overlay");
    if (ov) { ov.classList.add("hidden"); ov.innerHTML = ""; }
  }

  /* ====================================================== battle engine */
  function startEncounter(options) {
    injectStyle();

    const o = options || {};
    if (!o.ally || !o.wild) {
      console.warn("[BuddyBattle] startEncounter requires ally + wild");
      return;
    }

    teardown();

    const root = buildShell();

    ctx = {
      ally: BuddyEngine.makeBattleSide(o.ally),
      wild: BuddyEngine.makeBattleSide(o.wild),
      spawn: o.spawn || null,
      bag: o.bag || [],
      onResult: o.onResult || function () {},
      mode: o.mode === "pvp" ? "pvp" : "wild",
      busy: true,
      turn: 0,
      over: false,
    };

    // Wild buddy flavour: label it as a wild encounter. In the arena the
    // opponent is another player's Defense Buddy, so it keeps its own name.
    if (ctx.mode !== "pvp") {
      ctx.wild.name = "Wild " + ctx.wild.name;
    }

    refreshHud();
    renderMoves();
    log(`A wild ${ctx.wild.name} (Lv. ${ctx.wild.inst.level}) appeared!`, "strong");
    log(`${ctx.ally.name} is ready to fight.`, "good");

    // Mount the two 3D previews with their unique hues.
    try {
      previewWild = BuddyPreview.create(el("bb-wild-model"), ctx.wild.inst, {
        animate: true,
        anim: "idle",
        onReady: () => {},
      });
      previewPlayer = BuddyPreview.create(el("bb-ally-model"), ctx.ally.inst, {
        animate: true,
        anim: "idle",
      });
    } catch (e) {
      console.warn("[BuddyBattle] preview init failed:", e);
    }

    el("bb-berry-btn").addEventListener("click", useBerry);
    el("bb-switch-btn").addEventListener("click", openSwitch);
    el("bb-flee-btn").addEventListener("click", fleeBattle);

    setTimeout(() => {
      setBusy(false);
    }, 550);
  }

  async function playerMove(index) {
    if (!ctx || ctx.busy || ctx.over) return;
    const slot = ctx.ally.moves[index];
    if (!slot || slot.pp <= 0) return;

    setBusy(true);
    slot.pp = Math.max(0, slot.pp - 1);
    ctx.turn += 1;

    const allyFirst = decideOrder();
    const sequence = allyFirst
      ? [{ side: ctx.ally, target: ctx.wild, slot }, { side: ctx.wild, target: ctx.ally, slot: null }]
      : [{ side: ctx.wild, target: ctx.ally, slot: null }, { side: ctx.ally, target: ctx.wild, slot }];

    for (const step of sequence) {
      if (ctx.over) break;
      if (step.side.fainted || step.target.fainted) continue;

      if (step.side === ctx.wild) {
        await wildTurn();
      } else {
        await executeMove(step.side, step.target, step.slot.def);
      }
      refreshHud();
      await sleep(430);
    }

    // End-of-turn status chips.
    if (!ctx.over) {
      await endOfTurn();
    }

    if (!ctx.over) {
      setBusy(false);
      refreshHud();
    }
  }

  function decideOrder() {
    const aSpd = BuddyEngine.effectiveStat(ctx.ally, "spd");
    const wSpd = BuddyEngine.effectiveStat(ctx.wild, "spd");
    if (aSpd === wSpd) return Math.random() < 0.5;
    return aSpd > wSpd;
  }

  async function executeMove(attacker, defender, moveDef) {
    if (attacker.fainted || defender.fainted) return;

    if (BuddyEngine.isStunned(attacker)) {
      log(`${attacker.name} is stunned and can't move!`, "bad");
      await sleep(520);
      return;
    }

    if (previewPlayer && attacker === ctx.ally) previewPlayer.playAnim(moveDef.category === "status" ? "wave" : "punch");
    if (previewWild && attacker === ctx.wild) previewWild.playAnim(moveDef.category === "status" ? "wave" : "punch");

    const res = BuddyEngine.resolveMove(attacker, defender, moveDef);
    log(res.message, res.damage > 0 ? (res.effectiveness > 1 ? "good" : (res.effectiveness < 1 ? "bad" : "")) : "");

    if (res.missed) {
      await sleep(480);
      return;
    }

    if (res.damage > 0) {
      defender.hp = Math.max(0, defender.hp - res.damage);
      refreshHud();
      await sleep(360);
      if (res.healed > 0) {
        log(`${attacker.name} drained ${res.healed} HP!`, "good");
        refreshHud();
      }
    }

    if (res.effectLanded && res.effect) {
      const msg = effectMessage(attacker, defender, res.effect);
      if (msg) log(msg, "strong");
      refreshHud();
      await sleep(320);
    }

    if (defender.hp <= 0) {
      defender.fainted = true;
      refreshHud();
      await onFaint(attacker, defender);
    }
  }

  function effectMessage(attacker, defender, effect) {
    switch (effect) {
      case "burn":     return `${defender.name} was burned!`;
      case "poison":   return `${defender.name} was poisoned!`;
      case "stun":     return `${defender.name} is stunned!`;
      case "atkDown":  return `${defender.name}'s Attack fell!`;
      case "defDown":  return `${defender.name}'s Defense fell!`;
      case "atkUp":    return `${attacker.name}'s Attack rose!`;
      case "defUp":    return `${attacker.name}'s Defense rose!`;
      case "spdUp":    return `${attacker.name}'s Speed rose!`;
      case "critUp":    return `${attacker.name} is getting fired up!`;
      case "heal":     return `${attacker.name} restored health!`;
      default:         return "";
    }
  }

  async function wildTurn() {
    const slot = BuddyEngine.pickWildMove(ctx.wild, ctx.ally);
    if (!slot) {
      log(`${ctx.wild.name} has no moves left!`, "bad");
      return;
    }
    slot.pp = Math.max(0, slot.pp - 1);
    await executeMove(ctx.wild, ctx.ally, slot.def);
  }

  async function endOfTurn() {
    for (const side of [ctx.ally, ctx.wild]) {
      if (side.fainted) continue;
      const tick = BuddyEngine.tickStatus(side);
      if (tick.damage > 0) {
        log(tick.message, "bad");
        refreshHud();
        await sleep(300);
        if (side.hp <= 0) {
          side.fainted = true;
          refreshHud();
          await onFaint(side === ctx.ally ? ctx.wild : ctx.ally, side);
          if (ctx.over) return;
        }
      }
    }
  }

  async function onFaint(winner, loser) {
    if (loser === ctx.wild) {
      log(`${ctx.wild.name} fainted!`, "strong");
      // Droop instead of floating — the voodoo doll is a static levitating
      // pose, so defeat is shown as a procedural slump rather than a clip.
      if (previewWild) {
        try { previewWild.playAnim("death"); } catch (e) {}
        try { if (previewWild.setSink) previewWild.setSink(1); } catch (e) {}
      }
      await sleep(620);
      ctx.over = true;
      showOutcomeChoice();
      return;
    }

    // Ally fainted — check for a replacement.
    const replacement = (ctx.bag || []).find(b =>
      b.uid !== ctx.ally.inst.uid && (b.currentHp == null ? b.stats.hp : b.currentHp) > 0
    );

    if (replacement) {
      log(`${ctx.ally.name} fainted!`, "bad");
      await sleep(520);
      showSwitchOverlay(true);
      return;
    }

    log(`${ctx.ally.name} fainted! You have no buddies left.`, "bad");
    await sleep(560);
    ctx.over = true;
    if (ctx.mode === "pvp") {
      showPvpResult(false);
      return;
    }
    showDefeat();
  }

  /* ------------------------------------------------------- PvP endings */
  function showPvpResult(won) {
    setBusy(true);
    const spawn = ctx.spawn || {};
    const title = spawn.opponentName ? `vs ${spawn.opponentName}` : "Arena Match";
    showOverlay(`
      <h3>${won ? "🏆 Victory!" : "💀 Defeat"}</h3>
      <p class="bb-sub">${escapeHtml(title)}</p>
      <div class="bb-stat-grid">
        <div class="bb-stat"><div class="bb-st-k">Result</div><div class="bb-st-v" style="color:${won ? "#4ade80" : "#f87171"}">${won ? "WIN" : "LOSS"}</div></div>
        <div class="bb-stat"><div class="bb-st-k">Turns</div><div class="bb-st-v">${ctx.turn}</div></div>
        <div class="bb-stat"><div class="bb-st-k">Arena Points</div><div class="bb-st-v">${won ? "+2" : "+0"}</div></div>
        <div class="bb-stat"><div class="bb-st-k">Rank Points</div><div class="bb-st-v">${won ? "+10" : "−5"}</div></div>
      </div>
      <div class="bb-btns">
        <button class="bb-btn bb-primary" id="bb-pvp-done">Continue</button>
      </div>
    `);
    el("bb-pvp-done").addEventListener("click", () => {
      finish(won ? "win" : "loss", {});
    });
  }

  /* ================================================== outcome: the choice */
  function showOutcomeChoice() {
    setBusy(true);
    hideOverlay();
    if (ctx.mode === "pvp") {
      showPvpResult(true);
      return;
    }

    showOverlay(`
      <h3>The wild ${ctx.wild.name} has fainted</h3>
      <p class="bb-sub">
        Victory is yours. What should <b>${ctx.ally.name}</b> do with the fallen
        wild buddy?
      </p>
      <div class="bb-btns">
        <button class="bb-choice bb-ch-feast" id="bb-feast-btn">
          <span class="bb-ch-icon">🍖</span>
          <span>
            <span class="bb-ch-title">Feast &mdash; Consume the Wild Buddy</span>
            <span class="bb-ch-desc">
              ${ctx.ally.name} devours the fainted buddy. Grants bonus XP and
              happiness to ${ctx.ally.name}. The wild buddy is gone forever.
            </span>
          </span>
        </button>
        <button class="bb-choice bb-ch-tame" id="bb-tame-btn">
          <span class="bb-ch-icon">🫴</span>
          <span>
            <span class="bb-ch-title">Tame &mdash; Befriend the Wild Buddy</span>
            <span class="bb-ch-desc">
              Feed it ${FEED_TOTAL * FEED_BERRIES} berries over ${FEED_TOTAL} feedings
              (${FEED_TOTAL * FEED_INTERVAL_MS / 1000} seconds) to win it over and
              add it to your Buddy Bag.
            </span>
          </span>
        </button>
        <button class="bb-btn" id="bb-release-btn">Let it go</button>
      </div>
    `);

    el("bb-feast-btn").addEventListener("click", () => resolveFeast());
    el("bb-tame-btn").addEventListener("click", () => startTame());
    el("bb-release-btn").addEventListener("click", () => finish("released", {}));
  }

  /* --------------------------------------------------------------- Feast */
  function resolveFeast() {
    hideOverlay();
    const xp = Math.floor(BuddyEngine.battleXpReward(ctx.wild.inst, "win") * 0.75) + 25;
    const happinessGain = 12;

    showOverlay(`
      <h3>${ctx.ally.name} feasts</h3>
      <p class="bb-sub">
        The wild buddy's energy is absorbed. ${ctx.ally.name} grows stronger.
      </p>
      <div class="bb-stat-grid">
        <div class="bb-stat"><div class="bb-st-k">Bonus XP</div><div class="bb-st-v">+${xp}</div></div>
        <div class="bb-stat"><div class="bb-st-k">Happiness</div><div class="bb-st-v">+${happinessGain}</div></div>
        <div class="bb-stat"><div class="bb-st-k">Feasts</div><div class="bb-st-v">${(ctx.ally.inst.feasts || 0) + 1}</div></div>
        <div class="bb-stat"><div class="bb-st-k">Consumed</div><div class="bb-st-v">${ctx.wild.name}</div></div>
      </div>
      <div class="bb-btns">
        <button class="bb-btn bb-primary" id="bb-feast-done">Continue</button>
      </div>
    `);

    el("bb-feast-done").addEventListener("click", () => {
      finish("feast", {
        bonusXp: xp,
        happinessGain,
        consumedSpecies: ctx.wild.inst.speciesId,
      });
    });
  }

  /* ---------------------------------------------------------------- Tame */
  function startTame() {
    const state = (typeof Store !== "undefined" && Store.get) ? Store.get() : null;
    const berries = state ? (state.berries || 0) : 0;
    const cost = FEED_TOTAL * FEED_BERRIES;

    if (berries < cost) {
      showOverlay(`
        <h3>Not enough berries</h3>
        <p class="bb-sub">
          Taming costs <b>${cost} berries</b> (${FEED_BERRIES} per feeding &times;
          ${FEED_TOTAL} feedings). You only have <b>${berries}</b>.
          Spin Elden Stops to gather more berries.
        </p>
        <div class="bb-btns">
          <button class="bb-btn bb-primary" id="bb-tame-back">Back</button>
        </div>
      `);
      el("bb-tame-back").addEventListener("click", () => showOutcomeChoice());
      return;
    }

    showOverlay(`
      <div class="bb-feed-wrap">
        <h3>Taming ${ctx.wild.name}</h3>
        <p class="bb-sub">
          Feed it gently. Each feeding takes <b>${FEED_BERRIES} berries</b> and
          the buddy needs a moment between feedings.
        </p>
        <div class="bb-feed-orb bb-feeding" id="bb-feed-orb">🫴</div>
        <div class="bb-feed-steps" id="bb-feed-steps">
          ${Array.from({ length: FEED_TOTAL }).map(() => '<div class="bb-feed-dot"></div>').join("")}
        </div>
        <div class="bb-countdown" id="bb-countdown">5</div>
        <div class="bb-feed-count" id="bb-feed-count">Feeding 1 of ${FEED_TOTAL} &middot; ${berries} berries</div>
        <div class="bb-btns">
          <button class="bb-btn bb-danger" id="bb-tame-cancel">Stop Taming</button>
        </div>
      </div>
    `);

    el("bb-tame-cancel").addEventListener("click", () => {
      clearInterval(tameTimer);
      tameTimer = null;
      showOutcomeChoice();
    });

    runTameFeed(0, berries);
  }

  function runTameFeed(feedIndex, berriesLeft) {
    const steps = el("bb-feed-steps");
    const countdownEl = el("bb-countdown");
    const countEl = el("bb-feed-count");
    const orb = el("bb-feed-orb");
    if (!steps) return;

    if (feedIndex >= FEED_TOTAL) {
      clearInterval(tameTimer);
      tameTimer = null;
      if (orb) orb.classList.remove("bb-feeding");
      if (countdownEl) countdownEl.textContent = "✓";
      if (countEl) countEl.textContent = `Tamed! ${ctx.wild.name} joins your Buddy Bag.`;
      setTimeout(() => showCaptureSuccess(), 780);
      return;
    }

    // Mark completed steps.
    Array.from(steps.children).forEach((dot, i) => {
      dot.classList.toggle("done", i < feedIndex);
    });

    const after = berriesLeft - FEED_BERRIES;
    if (countEl) countEl.textContent = `Feeding ${feedIndex + 1} of ${FEED_TOTAL} · ${after} berries left`;

    let remaining = Math.ceil(FEED_INTERVAL_MS / 1000);
    if (countdownEl) countdownEl.textContent = String(remaining);

    clearInterval(tameTimer);
    tameTimer = setInterval(() => {
      remaining -= 1;
      if (countdownEl) countdownEl.textContent = String(Math.max(0, remaining));
      if (remaining <= 0) {
        clearInterval(tameTimer);
        tameTimer = null;
        // Advance to the next feeding.
        runTameFeed(feedIndex + 1, after);
      }
    }, 1000);
  }

  /* --------------------------------------------------- capture result UI */
  function showCaptureSuccess() {
    const inst = ctx.wild.inst;
    const sp = BuddyData.getSpecies(inst.speciesId) || {};
    const pct = BuddyEngine.ivPercent(inst.ivs);
    const grade = BuddyEngine.ivGrade(pct);
    const nature = BuddyData.getNature(inst.natureId);
    const xp = BuddyEngine.battleXpReward(inst, "win");

    hideOverlay();
    showOverlay(`
      <h3>🎉 ${inst.nickname} was tamed!</h3>
      <p class="bb-sub">
        A new buddy has joined your collection.
      </p>

      <div class="bb-preview-box" id="bb-capture-preview"></div>

      <div class="bb-head" style="margin-top:10px">
        <div class="bb-name">${inst.nickname}</div>
        <div class="bb-lv">Lv. ${inst.level}</div>
        <div class="bb-types">${(sp.types || []).map(typeChip).join("")}</div>
      </div>
      <div style="margin:6px 0 2px">
        <span class="bb-colorway">${inst.colorway} hue</span>
        <span class="bb-colorway">${sp.rarity || "common"}</span>
        <span class="bb-colorway">${nature.name} nature</span>
      </div>

      <div class="bb-stat-grid">
        <div class="bb-stat"><div class="bb-st-k">HP</div><div class="bb-st-v">${inst.stats.hp}</div></div>
        <div class="bb-stat"><div class="bb-st-k">Attack</div><div class="bb-st-v">${inst.stats.atk}</div></div>
        <div class="bb-stat"><div class="bb-st-k">Defense</div><div class="bb-st-v">${inst.stats.def}</div></div>
        <div class="bb-stat"><div class="bb-st-k">Speed</div><div class="bb-st-v">${inst.stats.spd}</div></div>
      </div>

      <div style="display:flex; align-items:center; gap:12px; margin:8px 0 2px">
        <div class="bb-grade" style="border-color:${grade.color}; color:${grade.color}">${grade.letter}</div>
        <div style="flex:1 1 auto">
          <div style="font-size:11px; color:#9db8dd; letter-spacing:1px; text-transform:uppercase">
            IV Rating &middot; ${pct}%
          </div>
          ${ivRow("HP", inst.ivs.hp)}
          ${ivRow("ATK", inst.ivs.atk)}
          ${ivRow("DEF", inst.ivs.def)}
          ${ivRow("SPD", inst.ivs.spd)}
        </div>
      </div>

      <div style="font-size:11px; color:#9db8dd; letter-spacing:1px; text-transform:uppercase; margin-top:12px">
        Moves
      </div>
      <div class="bb-move-chips">
        ${inst.moves.map(id => {
          const mv = BuddyData.getMove(id);
          const t = mv ? BuddyData.getType(mv.type) : null;
          return `<span class="bb-chip" style="background:${t ? t.color : "#94a3b8"}">${mv ? mv.name : id}</span>`;
        }).join("")}
      </div>

      <div class="bb-btns">
        <button class="bb-btn bb-primary" id="bb-capture-done">Add to Buddy Bag</button>
      </div>
    `);

    // 3D of the newly tamed buddy, in its unique hue.
    try {
      const box = el("bb-capture-preview");
      if (box) {
        BuddyPreview.create(box, inst, { animate: true, anim: "wave" });
      }
    } catch (e) {}

    el("bb-capture-done").addEventListener("click", () => {
      finish("tame", {
        tamed: inst,
        xp,
      });
    });
  }

  function ivRow(label, value) {
    const pct = Math.round((value / BuddyEngine.IV_MAX) * 100);
    return `
      <div class="bb-iv-row">
        <div class="bb-iv-k">${label}</div>
        <div class="bb-iv-bar"><div class="bb-iv-fill" style="width:${pct}%"></div></div>
        <div class="bb-iv-n">${value}</div>
      </div>
    `;
  }

  /* --------------------------------------------------------------- Loss */
  function showDefeat() {
    setBusy(true);
    showOverlay(`
      <h3>Defeat</h3>
      <p class="bb-sub">
        Your buddy was too exhausted to continue. It still earned a little
        experience from the attempt.
      </p>
      <div class="bb-btns">
        <button class="bb-btn bb-primary" id="bb-defeat-done">Continue</button>
      </div>
    `);
    el("bb-defeat-done").addEventListener("click", () => {
      finish("lost", {});
    });
  }

  /* -------------------------------------------------------------- Flee */
  function fleeBattle() {
    if (!ctx || ctx.busy || ctx.over) return;
    setBusy(true);
    log("You fled from the battle.", "bad");
    setTimeout(() => {
      ctx.over = true;
      finish("fled", {});
    }, 320);
  }

  /* ------------------------------------------------------------- Switch */
  function openSwitch() {
    if (!ctx || ctx.busy) return;
    showSwitchOverlay(false);
  }

  function showSwitchOverlay(forced) {
    const options = (ctx.bag || []).filter(b =>
      b.uid !== ctx.ally.inst.uid && (b.currentHp == null ? b.stats.hp : b.currentHp) > 0
    );

    showOverlay(`
      <h3>${forced ? "Choose your next buddy" : "Switch buddy"}</h3>
      <p class="bb-sub">${forced ? "Your active buddy has fainted." : "Pick a buddy to send into battle."}</p>
      <div class="bb-btns">
        ${options.map((b, i) => {
          const sp = BuddyData.getSpecies(b.speciesId) || {};
          const hp = b.currentHp == null ? b.stats.hp : b.currentHp;
          return `
            <button class="bb-choice" data-switch-idx="${i}">
              <span class="bb-ch-icon">${sp.types && sp.types[0] ? (BuddyData.getType(sp.types[0]) || {}).icon || "🐾" : "🐾"}</span>
              <span>
                <span class="bb-ch-title">${b.nickname} · Lv. ${b.level}</span>
                <span class="bb-ch-desc">HP ${hp} / ${b.stats.hp} &middot; ${sp.name || b.speciesId}</span>
              </span>
            </button>
          `;
        }).join("")}
        ${forced ? "" : '<button class="bb-btn" id="bb-switch-cancel">Cancel</button>'}
      </div>
    `);

    Array.from(document.querySelectorAll("[data-switch-idx]")).forEach(btn => {
      btn.addEventListener("click", () => {
        const idx = parseInt(btn.dataset.switchIdx, 10);
        const chosen = options[idx];
        if (chosen) performSwitch(chosen, forced);
      });
    });

    const cancel = el("bb-switch-cancel");
    if (cancel) cancel.addEventListener("click", () => hideOverlay());
  }

  function performSwitch(nextInst, forced) {
    hideOverlay();
    const previous = ctx.ally.inst;
    // Persist the outgoing buddy's current HP back onto the bag copy.
    previous.currentHp = ctx.ally.hp;

    ctx.ally = BuddyEngine.makeBattleSide(nextInst);
    log(`Go, ${ctx.ally.name}!`, "good");

    try {
      if (previewPlayer) previewPlayer.dispose();
      previewPlayer = BuddyPreview.create(el("bb-ally-model"), ctx.ally.inst, { animate: true, anim: "idle" });
    } catch (e) {}

    refreshHud();
    renderMoves();

    if (forced) {
      setBusy(false);
    } else {
      // A manual switch costs the player their turn.
      setBusy(true);
      setTimeout(async () => {
        await wildTurn();
        refreshHud();
        if (!ctx.over) setBusy(false);
      }, 320);
    }
  }

  /* -------------------------------------------------------------- Berry */
  function useBerry() {
    if (!ctx || ctx.busy || ctx.over) return;
    const state = (typeof Store !== "undefined" && Store.get) ? Store.get() : null;
    if (!state || (state.berries || 0) <= 0) return;

    setBusy(true);
    state.berries = Math.max(0, (state.berries || 0) - 1);
    try { if (typeof Store !== "undefined" && Store.save) Store.save(false); } catch (e) {}

    const heal = Math.floor(ctx.ally.maxHp * 0.3);
    ctx.ally.hp = Math.min(ctx.ally.maxHp, ctx.ally.hp + heal);
    log(`${ctx.ally.name} ate a berry and recovered ${heal} HP!`, "good");
    refreshHud();

    setTimeout(async () => {
      await wildTurn();
      refreshHud();
      if (!ctx.over) setBusy(false);
    }, 380);
  }

  /* ------------------------------------------------------------- Finish */
  function finish(outcome, payload) {
    clearInterval(tameTimer);
    tameTimer = null;

    const summary = {
      outcome,
      spawnId: ctx && ctx.spawn ? ctx.spawn.id : null,
      turns: ctx ? ctx.turn : 0,
      allyUid: ctx ? ctx.ally.inst.uid : null,
      allyHp: ctx ? ctx.ally.hp : 0,
      allyMaxHp: ctx ? ctx.ally.maxHp : 1,
      wildSpecies: ctx ? ctx.wild.inst.speciesId : null,
      wildLevel: ctx ? ctx.wild.inst.level : 1,
      wildHue: ctx ? ctx.wild.inst.hue : 0,
      ...payload,
    };

    const cb = ctx ? ctx.onResult : null;

    // Animate out, then tear down and hand the result back to buddy.js.
    const root = el(ROOT_ID);
    if (root) {
      const inner = root.firstElementChild;
      if (inner) inner.classList.add("bb-out");
    }

    setTimeout(() => {
      teardown();
      if (typeof cb === "function") {
        try { cb(summary); } catch (e) { console.warn("[BuddyBattle] onResult error:", e); }
      }
    }, 260);
  }

  function teardown() {
    clearInterval(tameTimer);
    tameTimer = null;
    try { if (previewPlayer) previewPlayer.dispose(); } catch (e) {}
    try { if (previewWild) previewWild.dispose(); } catch (e) {}
    previewPlayer = null;
    previewWild = null;
    const root = el(ROOT_ID);
    if (root) root.remove();
    ctx = null;
    try { if (typeof PlayerXP !== "undefined") PlayerXP.setHidden(false); } catch (e) {}
  }

  return {
    startEncounter,
    FEED_TOTAL,
    FEED_BERRIES,
    FEED_INTERVAL_MS,
  };
})();
