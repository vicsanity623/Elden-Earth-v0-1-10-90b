/* ==========================================================================
   Elden Earth — Buddy Engine
   Pure rules/math layer for the buddy system: instance creation, RNG stat
   rolls (IVs + nature + model hue), level/XP progression, the damage formula
   and the wild-buddy AI move picker.

   Deliberately DOM-free and stateless so buddy.js (world/spawns) and
   buddy-battle.js (combat) can both drive it without coordination.
   ========================================================================== */
const BuddyEngine = (() => {
  "use strict";

  const IV_MAX = 15;          // classic 0-15 individual values
  const STAT_STAGE_MAX = 6;   // -6..+6 in-battle stat stages
  const STAT_STAGE_MIN = -6;
  // HP divisor. Lower = larger HP pools = longer fights. 40 lands wild
  // battles around 4-8 turns, which is the "weaken it, then decide" rhythm
  // the encounter flow is built around.
  const HP_DIVISOR = 30;

  /* ------------------------------------------------------------- Random */
  function ri(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
  function rf(min, max) { return Math.random() * (max - min) + min; }
  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

  function newId(prefix) {
    return (prefix || "b") + "_" + Date.now().toString(36) + "_" +
      Math.random().toString(36).slice(2, 8);
  }

  /* ---------------------------------------------------------- RNG rolls */
  function rollIvs() {
    return {
      hp:  ri(0, IV_MAX),
      atk: ri(0, IV_MAX),
      def: ri(0, IV_MAX),
      spd: ri(0, IV_MAX),
    };
  }

  function rollNature() {
    return pick(BuddyData.NATURES).id;
  }

  // Every wild buddy gets a slightly different color hue on its model.
  //
  // We pick a named COLORWAY first and then jitter its HSL slightly, rather
  // than rolling an arbitrary hue and reverse-lookup-ing a name. That keeps
  // the label and the paint on the model locked together ("Ivory" is always
  // ivory) while still making every individual buddy visually unique.
  function rollColorway(rarityId) {
    const rarity = BuddyData.getRarity(rarityId || "common");
    const jitter = rarity.hueJitter || 0.05;
    const list = BuddyData.COLORWAYS;
    const entry = list[Math.floor(Math.random() * list.length)];
    const h = entry.h + rf(-jitter, jitter);
    return {
      name: entry.name,
      h: h - Math.floor(h),
      s: clamp01(entry.s + rf(-0.07, 0.07)),
      l: clamp01(entry.l + rf(-0.05, 0.05)),
    };
  }

  function clamp01(v) { return Math.max(0.03, Math.min(0.97, v)); }

  // Legacy/compat: a raw rolled hue.
  function rollHue(rarityId) {
    return rollColorway(rarityId).h;
  }

  // Nearest named colorway to a rolled hue. Returns the FULL HSL the tint uses,
  // so the label ("Ivory") and the paint on the model always agree.
  function colorwayForHue(hue) {
    const list = BuddyData.COLORWAYS;
    const h = ((hue % 1) + 1) % 1;
    let best = list[0];
    let bestDist = Infinity;
    for (let i = 0; i < list.length; i++) {
      // Circular distance around the hue wheel.
      let d = Math.abs(list[i].h - h);
      if (d > 0.5) d = 1 - d;
      if (d < bestDist) { bestDist = d; best = list[i]; }
    }
    return best;
  }

  // Convenience for renderers: just the paint triple.
  function hslForHue(hue) {
    const c = colorwayForHue(hue);
    return { h: c.h, s: c.s, l: c.l };
  }

  // Total IV quality 0..1 — drives the A/S/B/C grade shown on the tame screen.
  function ivPercent(ivs) {
    const total = (ivs.hp + ivs.atk + ivs.def + ivs.spd) / (IV_MAX * 4);
    return Math.round(total * 100);
  }

  function ivGrade(pct) {
    if (pct >= 95) return { letter: "S", color: "#fbbf24" };
    if (pct >= 82) return { letter: "A", color: "#c084fc" };
    if (pct >= 65) return { letter: "B", color: "#60a5fa" };
    if (pct >= 45) return { letter: "C", color: "#4ade80" };
    return { letter: "D", color: "#9ca3af" };
  }

  /* ------------------------------------------------------- Stat formula */
  // Pokemon-shaped: HP is its own curve, the rest scale linearly with level.
  function computeStats(speciesId, level, ivs, natureId) {
    const sp = BuddyData.getSpecies(speciesId);
    const base = sp ? sp.base : { hp: 50, atk: 50, def: 50, spd: 50 };
    const nature = BuddyData.getNature(natureId).mul;
    const L = Math.max(1, level | 0);

    const hp = Math.floor(((2 * base.hp + ivs.hp) * L) / HP_DIVISOR) + L + 10;
    const atk = Math.floor((((2 * base.atk + ivs.atk) * L) / 100) + 5) * nature.atk;
    const def = Math.floor((((2 * base.def + ivs.def) * L) / 100) + 5) * nature.def;
    const spd = Math.floor((((2 * base.spd + ivs.spd) * L) / 100) + 5) * nature.spd;

    return {
      hp: Math.max(1, Math.floor(hp)),
      atk: Math.max(1, Math.floor(atk)),
      def: Math.max(1, Math.floor(def)),
      spd: Math.max(1, Math.floor(spd)),
    };
  }

  /* ---------------------------------------------------- Instance factory */
  /**
   * Build a complete buddy instance.
   * @param {string} speciesId
   * @param {number} level
   * @param {object} [opts] { ivs, natureId, hue, nickname, source, uid }
   */
  function makeInstance(speciesId, level, opts) {
    const o = opts || {};
    const sp = BuddyData.getSpecies(speciesId);
    if (!sp) throw new Error("Unknown buddy species: " + speciesId);

    const lvl = Math.max(1, Math.min(BuddyData.BUDDY_MAX_LEVEL, level | 0));
    const ivs = o.ivs || rollIvs();
    const natureId = o.natureId || rollNature();
    // Colour is resolved as ONE unit (name + HSL) so a buddy labelled "Ivory"
    // is always painted ivory. Precedence: explicit paint > explicit name >
    // freshly rolled colorway.
    let cw;
    if (o.colorHsl && typeof o.colorHsl === "object") {
      const named = colorwayForHue(o.colorHsl.h);
      cw = {
        name: o.colorway || named.name,
        h: o.colorHsl.h,
        s: o.colorHsl.s,
        l: o.colorHsl.l,
      };
    } else if (o.colorway) {
      const entry = BuddyData.COLORWAYS.find(c => c.name === o.colorway) || BuddyData.COLORWAYS[0];
      cw = { name: entry.name, h: entry.h, s: entry.s, l: entry.l };
    } else {
      cw = rollColorway(sp.rarity);
    }

    const hue = (typeof o.hue === "number") ? o.hue : cw.h;
    const stats = computeStats(speciesId, lvl, ivs, natureId);
    const moves = o.moves || BuddyData.movesAtLevel(speciesId, lvl);

    return {
      uid: o.uid || newId("bd"),
      speciesId,
      nickname: o.nickname || sp.name,
      level: lvl,
      xp: o.xp || 0,
      ivs,
      natureId,
      hue,
      colorway: cw.name,
      // The exact paint used on the 3D model — kept alongside the name so a
      // buddy labelled "Ivory" is always rendered ivory.
      colorHsl: { h: cw.h, s: cw.s, l: cw.l },
      moves: moves.slice(0, 4),
      happiness: (typeof o.happiness === "number") ? o.happiness : 50,
      stats,
      currentHp: (typeof o.currentHp === "number") ? o.currentHp : stats.hp,
      customization: Object.assign({
        eyes: null, aura: null, trail: null, hat: null,
        pattern: null, wings: null, crown: null,
      }, o.customization || {}),
      caughtAt: o.caughtAt || Date.now(),
      source: o.source || "wild",
      battlesWon: o.battlesWon || 0,
      feasts: o.feasts || 0,
    };
  }

  // Recompute derived stats after a level-up, preserving HP fraction.
  function refreshStats(inst) {
    const before = inst.stats;
    const hpFrac = before.hp > 0 ? (inst.currentHp / before.hp) : 1;
    inst.stats = computeStats(inst.speciesId, inst.level, inst.ivs, inst.natureId);
    inst.currentHp = Math.max(1, Math.min(inst.stats.hp, Math.round(inst.stats.hp * hpFrac)));
    // Learn any newly qualified moves (keep the newest 4).
    const learned = BuddyData.movesAtLevel(inst.speciesId, inst.level);
    learned.forEach(m => {
      if (!inst.moves.includes(m)) inst.moves.push(m);
    });
    inst.moves = inst.moves.slice(-4);
    return inst;
  }

  /* ---------------------------------------------------------- XP / Level */
  /**
   * Add XP to a buddy. Returns a summary of what happened so the caller can
   * toast level-ups and learned moves.
   */
  function addXp(inst, amount) {
    const out = { leveled: 0, fromLevel: inst.level, learned: [], capped: false };
    if (!inst || !amount || amount <= 0) return out;

    inst.xp += Math.floor(amount);
    const max = BuddyData.BUDDY_MAX_LEVEL;

    while (inst.level < max) {
      const need = BuddyData.buddyXpToNext(inst.level);
      if (inst.xp < need) break;
      inst.xp -= need;
      inst.level += 1;
      out.leveled += 1;
    }

    if (inst.level >= max) {
      inst.xp = 0;
      out.capped = true;
    }

    if (out.leveled > 0) {
      const beforeMoves = inst.moves.slice();
      refreshStats(inst);
      inst.currentHp = inst.stats.hp; // level-up restores to full
      out.learned = inst.moves.filter(m => !beforeMoves.includes(m));
    }
    return out;
  }

  function xpProgress(inst) {
    const need = BuddyData.buddyXpToNext(inst.level);
    return {
      current: inst.xp,
      need,
      pct: Math.min(100, Math.round((inst.xp / need) * 100)),
      maxed: inst.level >= BuddyData.BUDDY_MAX_LEVEL,
    };
  }

  /* -------------------------------------------------- Battle math helpers */
  // Multiplier for a stat stage: 2/(2-stage) up, (2-stage)/2 down — classic.
  function stageMultiplier(stage) {
    const s = Math.max(STAT_STAGE_MIN, Math.min(STAT_STAGE_MAX, stage | 0));
    return s >= 0 ? (2 + s) / 2 : 2 / (2 - s);
  }

  function makeBattleSide(inst) {
    return {
      inst,
      name: inst.nickname || BuddyData.getSpecies(inst.speciesId)?.name || "Buddy",
      species: BuddyData.getSpecies(inst.speciesId),
      maxHp: inst.stats.hp,
      hp: inst.currentHp != null ? inst.currentHp : inst.stats.hp,
      stages: { atk: 0, def: 0, spd: 0 },
      status: null,       // "burn" | "poison" | "stun"
      statusTurns: 0,
      critBoost: 0,
      moves: inst.moves.map(id => {
        const m = BuddyData.getMove(id);
        return m ? { def: m, pp: m.pp, maxPp: m.pp } : null;
      }).filter(Boolean),
      fainted: false,
    };
  }

  function effectiveStat(side, key) {
    const raw = side.inst.stats[key] || 1;
    return Math.max(1, Math.floor(raw * stageMultiplier(side.stages[key] || 0)));
  }

  /**
   * Full damage resolution for one move.
   * Returns { missed, damage, crit, effectiveness, message, effect, effectLanded, healed }
   */
  function resolveMove(attacker, defender, moveDef) {
    const result = {
      missed: false, damage: 0, crit: false, effectiveness: 1,
      effect: null, effectLanded: false, healed: 0, message: "",
    };

    // Accuracy roll (accuracy 100 = never misses).
    const acc = moveDef.accuracy == null ? 100 : moveDef.accuracy;
    if (acc < 100 && Math.random() * 100 > acc) {
      result.missed = true;
      result.message = `${attacker.name}'s ${moveDef.name} missed!`;
      return result;
    }

    // Status moves: no damage, just the effect.
    if (moveDef.category === "status") {
      result.effect = moveDef.effect;
      result.effectLanded = applyStatusEffect(attacker, defender, moveDef);
      result.message = `${attacker.name} used ${moveDef.name}!`;
      return result;
    }

    // Gen-0 runs a single offensive/defensive stat pair (Atk/Def) — physical
    // and special moves share them, which keeps the 4-stat HUD honest.
    const atk = effectiveStat(attacker, "atk");
    const def = effectiveStat(defender, "def");

    // STAB
    const stab = (attacker.species && attacker.species.types.includes(moveDef.type)) ? 1.5 : 1;
    // Type effectiveness vs each defending type
    const eff = BuddyData.typeEffectiveness(moveDef.type, defender.species ? defender.species.types : []);
    result.effectiveness = eff;

    if (eff === 0) {
      result.damage = 0;
      result.message = `It has no effect on ${defender.name}...`;
      return result;
    }

    // Crit: base 1/16, boosted by critUp stages.
    const critChance = 6.25 + (attacker.critBoost || 0) * 12.5;
    const crit = Math.random() * 100 < critChance;
    result.crit = crit;

    // Core Gen-3-ish formula.
    const level = attacker.inst.level || 1;
    let dmg = (((2 * level) / 5 + 2) * (moveDef.power || 40) * (atk / Math.max(1, def))) / 50 + 2;
    dmg *= stab * eff * (crit ? 1.5 : 1);
    dmg *= rf(0.85, 1.0); // damage roll

    // Burn cuts physical damage.
    if (attacker.status === "burn" && moveDef.category === "physical") dmg *= 0.75;

    result.damage = Math.max(1, Math.floor(dmg));

    // Secondary effect chance.
    if (moveDef.effect && moveDef.effectChance > 0 && Math.random() * 100 < moveDef.effectChance) {
      result.effect = moveDef.effect;
      result.effectLanded = applyStatusEffect(attacker, defender, moveDef);
    }

    // Drain heals the attacker for half the damage dealt.
    if (moveDef.effect === "drain") {
      const heal = Math.max(1, Math.floor(result.damage / 2));
      attacker.hp = Math.min(attacker.maxHp, attacker.hp + heal);
      result.healed = heal;
    }

    const effText = eff > 1 ? " It's super effective!" : (eff < 1 ? " It's not very effective..." : "");
    const critText = crit ? " Critical hit!" : "";
    result.message = `${attacker.name} used ${moveDef.name}!${critText}${effText}`;
    return result;
  }

  // Apply a secondary/status effect. Returns true if it stuck.
  function applyStatusEffect(attacker, defender, moveDef) {
    const eff = moveDef.effect;
    if (!eff) return false;

    switch (eff) {
      case "burn":
        if (defender.status) return false;
        defender.status = "burn"; defender.statusTurns = 3;
        return true;
      case "poison":
        if (defender.status) return false;
        defender.status = "poison"; defender.statusTurns = 4;
        return true;
      case "stun":
        if (defender.status === "stun") return false;
        defender.status = "stun"; defender.statusTurns = 1;
        return true;
      case "atkDown":
        if (defender.stages.atk <= STAT_STAGE_MIN) return false;
        defender.stages.atk -= 1; return true;
      case "defDown":
        if (defender.stages.def <= STAT_STAGE_MIN) return false;
        defender.stages.def -= 1; return true;
      case "atkUp":
        if (attacker.stages.atk >= STAT_STAGE_MAX) return false;
        attacker.stages.atk += 1; return true;
      case "defUp":
        if (attacker.stages.def >= STAT_STAGE_MAX) return false;
        attacker.stages.def += 1; return true;
      case "spdUp":
        if (attacker.stages.spd >= STAT_STAGE_MAX) return false;
        attacker.stages.spd += 1; return true;
      case "critUp":
        attacker.critBoost = Math.min(3, (attacker.critBoost || 0) + 1);
        return true;
      case "heal": {
        const heal = Math.floor(attacker.maxHp * 0.35);
        attacker.hp = Math.min(attacker.maxHp, attacker.hp + heal);
        return true;
      }
      case "drain":
        return true; // handled in resolveMove
      default:
        return false;
    }
  }

  // End-of-turn status ticks (burn/poison chip damage).
  function tickStatus(side) {
    if (!side.status) return { damage: 0, message: "" };
    if (side.status === "burn" || side.status === "poison") {
      const chip = Math.max(1, Math.floor(side.maxHp * (side.status === "burn" ? 0.08 : 0.06)));
      side.hp = Math.max(0, side.hp - chip);
      side.statusTurns -= 1;
      if (side.statusTurns <= 0) side.status = null;
      return {
        damage: chip,
        message: `${side.name} is hurt by its ${side.status === "burn" ? "burn" : "poison"}!`,
      };
    }
    if (side.status === "stun") {
      side.statusTurns -= 1;
      if (side.statusTurns <= 0) side.status = null;
    }
    return { damage: 0, message: "" };
  }

  // Does the side lose its turn to stun?
  function isStunned(side) {
    return side.status === "stun" && Math.random() < 0.5;
  }

  /* --------------------------------------------------------- Wild AI */
  // Scores every usable move and picks one. Wild buddies prefer super
  // effective damage but will fish for status when badly hurt.
  function pickWildMove(wild, player) {
    const usable = wild.moves.filter(m => m.pp > 0);
    if (!usable.length) return null;

    // Desperate: heal if a heal move exists and we're under 35%.
    if (wild.hp / wild.maxHp < 0.35) {
      const heal = usable.find(m => m.def.effect === "heal");
      if (heal) return heal;
    }

    let best = usable[0];
    let bestScore = -Infinity;

    usable.forEach(slot => {
      const mv = slot.def;
      let score = (mv.power || 25) * 0.9;
      const eff = BuddyData.typeEffectiveness(mv.type, player.species ? player.species.types : []);
      score *= eff;
      if (mv.category === "status") score *= 0.55;
      if (mv.effect === "drain") score *= 1.15;
      if (mv.effect === "heal") score *= 1.1;
      score *= (mv.accuracy || 100) / 100;
      score *= 0.85 + Math.random() * 0.3; // AI variance
      if (score > bestScore) { bestScore = score; best = slot; }
    });

    return best;
  }

  /* ------------------------------------------------- Encounter helpers */
  // Wild encounter level is bracketed by the player's strongest buddy level so
  // early players never get one-shot and late players still find challenges.
  function rollWildLevel(playerTopLevel, rarityId) {
    const top = Math.max(1, playerTopLevel | 0);
    const spread = rarityId === "legendary" ? 4 : (rarityId === "rare" ? 3 : 5);
    const min = Math.max(1, top - spread);
    const max = Math.min(BuddyData.BUDDY_MAX_LEVEL, top + 2);
    return ri(min, Math.max(min, max));
  }

  // XP awarded for winning a wild battle, scaled by opponent strength.
  function battleXpReward(wildInst, outcome) {
    const rarity = BuddyData.getRarity(wildInst.rarity || (BuddyData.getSpecies(wildInst.speciesId) || {}).rarity || "common");
    const base = 18 + wildInst.level * 7;
    const mult = outcome === "win" ? rarity.xpMul : 0.25;
    return Math.max(1, Math.floor(base * mult));
  }

  return {
    IV_MAX,
    ri, rf, pick, newId,
    rollIvs, rollNature, rollHue, rollColorway, colorwayForHue, hslForHue, ivPercent, ivGrade,
    computeStats, makeInstance, refreshStats,
    addXp, xpProgress,
    stageMultiplier, makeBattleSide, effectiveStat,
    resolveMove, tickStatus, isStunned, applyStatusEffect,
    pickWildMove, rollWildLevel, battleXpReward,
  };
})();
