/* ==========================================================================
   Elden Earth — Buddy Data (Gen 0)
   Static catalogue: element types + effectiveness chart, move list, the 28
   starter Gen-0 buddy species, XP curves, natures and the progressive
   customization unlock ladder.

   Pure data + pure lookup helpers. No DOM, no game state, no side effects so
   it can be loaded first and depended on by buddy-engine / buddy-battle /
   buddy without any ordering hazards.
   ========================================================================== */
const BuddyData = (() => {
  "use strict";

  /* ---------------------------------------------------------------- Types */
  const TYPES = {
    ember:   { id: "ember",   name: "Ember",   color: "#ff6b35", icon: "🔥" },
    aqua:    { id: "aqua",    name: "Aqua",    color: "#38bdf8", icon: "💧" },
    terra:   { id: "terra",   name: "Terra",   color: "#a3754a", icon: "⛰️" },
    volt:    { id: "volt",    name: "Volt",    color: "#facc15", icon: "⚡" },
    frost:   { id: "frost",   name: "Frost",   color: "#7dd3fc", icon: "❄️" },
    spirit:  { id: "spirit",  name: "Spirit",  color: "#c084fc", icon: "👻" },
    toxic:   { id: "toxic",   name: "Toxic",   color: "#84cc16", icon: "☠️" },
    mystic:  { id: "mystic",  name: "Mystic",  color: "#f472b6", icon: "🔮" },
    metal:   { id: "metal",   name: "Metal",   color: "#94a3b8", icon: "⚙️" },
    nature:  { id: "nature",  name: "Nature",  color: "#4ade80", icon: "🌿" },
    wind:    { id: "wind",    name: "Wind",    color: "#a5f3fc", icon: "🌪️" },
    shade:   { id: "shade",   name: "Shade",   color: "#6b7280", icon: "🌑" },
  };

  // Attacker -> { defender: multiplier }. Anything omitted is 1x.
  // Only 2x / 0.5x / 0x entries are listed to keep the table readable.
  const TYPE_CHART = {
    ember:  { nature: 2, frost: 2, metal: 2, aqua: 0.5, terra: 0.5, ember: 0.5 },
    aqua:   { ember: 2, terra: 2, aqua: 0.5, nature: 0.5, frost: 0.5 },
    terra:  { volt: 2, metal: 2, ember: 2, aqua: 0.5, nature: 0.5, wind: 0 },
    volt:   { aqua: 2, wind: 2, terra: 0.5, nature: 0.5, volt: 0.5 },
    frost:  { nature: 2, wind: 2, terra: 2, ember: 0.5, metal: 0.5, frost: 0.5 },
    spirit: { spirit: 2, mystic: 2, shade: 0.5, metal: 0.5 },
    toxic:  { nature: 2, spirit: 2, terra: 0.5, metal: 0.5, toxic: 0.5 },
    mystic: { spirit: 2, shade: 2, metal: 0.5, mystic: 0.5 },
    metal:  { frost: 2, mystic: 2, ember: 0.5, terra: 0.5, metal: 0.5 },
    nature: { aqua: 2, terra: 2, metal: 2, ember: 0.5, frost: 0.5, toxic: 0.5, wind: 0.5 },
    wind:   { nature: 2, toxic: 2, volt: 0.5, frost: 0.5, wind: 0.5 },
    shade:  { mystic: 2, spirit: 2, shade: 0.5 },
  };

  /* ---------------------------------------------------------------- Moves */
  // category: "physical" | "special" | "status"
  // effect:   null | "burn" | "poison" | "stun" | "defDown" | "atkDown"
  //           | "atkUp" | "defUp" | "spdUp" | "heal" | "drain" | "critUp"
  const MOVES = {
    // --- Ember ---
    ember_spark:     { id: "ember_spark",     name: "Ember Spark",     type: "ember",  category: "special",  power: 40, accuracy: 100, pp: 30, effect: "burn",     effectChance: 12 },
    flame_claw:      { id: "flame_claw",      name: "Flame Claw",      type: "ember",  category: "physical", power: 55, accuracy: 95,  pp: 25, effect: null,       effectChance: 0  },
    inferno_rush:    { id: "inferno_rush",    name: "Inferno Rush",    type: "ember",  category: "physical", power: 85, accuracy: 85,  pp: 10, effect: "burn",     effectChance: 25 },
    cinder_veil:     { id: "cinder_veil",     name: "Cinder Veil",     type: "ember",  category: "status",   power: 0,  accuracy: 100, pp: 20, effect: "atkUp",    effectChance: 100 },
    // --- Aqua ---
    ripple_shot:     { id: "ripple_shot",     name: "Ripple Shot",     type: "aqua",   category: "special",  power: 40, accuracy: 100, pp: 30, effect: null,       effectChance: 0  },
    tide_crash:      { id: "tide_crash",      name: "Tide Crash",      type: "aqua",   category: "physical", power: 60, accuracy: 95,  pp: 25, effect: null,       effectChance: 0  },
    abyssal_surge:   { id: "abyssal_surge",   name: "Abyssal Surge",   type: "aqua",   category: "special",  power: 90, accuracy: 85,  pp: 10, effect: "defDown",  effectChance: 20 },
    mending_tide:    { id: "mending_tide",    name: "Mending Tide",    type: "aqua",   category: "status",   power: 0,  accuracy: 100, pp: 15, effect: "heal",     effectChance: 100 },
    // --- Terra ---
    pebble_toss:     { id: "pebble_toss",     name: "Pebble Toss",     type: "terra",  category: "physical", power: 40, accuracy: 100, pp: 30, effect: null,       effectChance: 0  },
    fissure_slam:    { id: "fissure_slam",    name: "Fissure Slam",    type: "terra",  category: "physical", power: 65, accuracy: 95,  pp: 20, effect: "defDown",  effectChance: 18 },
    quake_bellow:    { id: "quake_bellow",    name: "Quake Bellow",    type: "terra",  category: "special",  power: 90, accuracy: 85,  pp: 10, effect: "stun",     effectChance: 15 },
    stone_bulwark:   { id: "stone_bulwark",   name: "Stone Bulwark",   type: "terra",  category: "status",   power: 0,  accuracy: 100, pp: 15, effect: "defUp",    effectChance: 100 },
    // --- Volt ---
    static_jab:      { id: "static_jab",      name: "Static Jab",      type: "volt",   category: "physical", power: 40, accuracy: 100, pp: 30, effect: "stun",     effectChance: 10 },
    arc_bolt:        { id: "arc_bolt",        name: "Arc Bolt",        type: "volt",   category: "special",  power: 60, accuracy: 95,  pp: 25, effect: null,       effectChance: 0  },
    thunder_collapse:{ id: "thunder_collapse",name: "Thunder Collapse",type: "volt",   category: "special",  power: 95, accuracy: 80,  pp: 10, effect: "stun",     effectChance: 22 },
    charge_up:       { id: "charge_up",       name: "Charge Up",       type: "volt",   category: "status",   power: 0,  accuracy: 100, pp: 20, effect: "spdUp",    effectChance: 100 },
    // --- Frost ---
    ice_shard:       { id: "ice_shard",       name: "Ice Shard",       type: "frost",  category: "special",  power: 40, accuracy: 100, pp: 30, effect: null,       effectChance: 0  },
    glacial_lash:    { id: "glacial_lash",    name: "Glacial Lash",    type: "frost",  category: "physical", power: 60, accuracy: 95,  pp: 25, effect: "atkDown",  effectChance: 18 },
    blizzard_howl:   { id: "blizzard_howl",   name: "Blizzard Howl",   type: "frost",  category: "special",  power: 90, accuracy: 85,  pp: 10, effect: "stun",     effectChance: 15 },
    frost_ward:      { id: "frost_ward",      name: "Frost Ward",      type: "frost",  category: "status",   power: 0,  accuracy: 100, pp: 15, effect: "defUp",    effectChance: 100 },
    // --- Spirit ---
    spirit_lash:     { id: "spirit_lash",     name: "Spirit Lash",     type: "spirit", category: "special",  power: 45, accuracy: 100, pp: 30, effect: null,       effectChance: 0  },
    soul_siphon:     { id: "soul_siphon",     name: "Soul Siphon",     type: "spirit", category: "special",  power: 55, accuracy: 95,  pp: 20, effect: "drain",    effectChance: 100 },
    wail_of_ages:    { id: "wail_of_ages",    name: "Wail of Ages",    type: "spirit", category: "special",  power: 85, accuracy: 85,  pp: 10, effect: "atkDown",  effectChance: 25 },
    ethereal_guard:  { id: "ethereal_guard",  name: "Ethereal Guard",  type: "spirit", category: "status",   power: 0,  accuracy: 100, pp: 15, effect: "defUp",    effectChance: 100 },
    // --- Toxic ---
    venom_fang:      { id: "venom_fang",      name: "Venom Fang",      type: "toxic",  category: "physical", power: 45, accuracy: 100, pp: 30, effect: "poison",   effectChance: 22 },
    spore_burst:     { id: "spore_burst",     name: "Spore Burst",     type: "toxic",  category: "special",  power: 55, accuracy: 95,  pp: 25, effect: "poison",   effectChance: 18 },
    blight_storm:    { id: "blight_storm",    name: "Blight Storm",    type: "toxic",  category: "special",  power: 85, accuracy: 85,  pp: 10, effect: "defDown",  effectChance: 20 },
    toxic_cloud:     { id: "toxic_cloud",     name: "Toxic Cloud",     type: "toxic",  category: "status",   power: 0,  accuracy: 100, pp: 20, effect: "atkDown",  effectChance: 100 },
    // --- Mystic ---
    rune_bolt:       { id: "rune_bolt",       name: "Rune Bolt",       type: "mystic", category: "special",  power: 45, accuracy: 100, pp: 30, effect: null,       effectChance: 0  },
    hex_breaker:     { id: "hex_breaker",     name: "Hex Breaker",     type: "mystic", category: "special",  power: 65, accuracy: 95,  pp: 20, effect: "critUp",   effectChance: 100 },
    astral_rupture:  { id: "astral_rupture",  name: "Astral Rupture",  type: "mystic", category: "special",  power: 90, accuracy: 85,  pp: 10, effect: null,       effectChance: 0  },
    mystic_ward:     { id: "mystic_ward",     name: "Mystic Ward",     type: "mystic", category: "status",   power: 0,  accuracy: 100, pp: 15, effect: "defUp",    effectChance: 100 },
    // --- Metal ---
    iron_jab:        { id: "iron_jab",        name: "Iron Jab",        type: "metal",  category: "physical", power: 45, accuracy: 100, pp: 30, effect: null,       effectChance: 0  },
    gear_grind:      { id: "gear_grind",      name: "Gear Grind",      type: "metal",  category: "physical", power: 65, accuracy: 95,  pp: 20, effect: "defDown",  effectChance: 15 },
    alloy_annihilate:{ id: "alloy_annihilate",name: "Alloy Annihilate",type: "metal",  category: "physical", power: 95, accuracy: 80,  pp: 10, effect: null,       effectChance: 0  },
    plating_up:      { id: "plating_up",      name: "Plating Up",      type: "metal",  category: "status",   power: 0,  accuracy: 100, pp: 20, effect: "defUp",    effectChance: 100 },
    // --- Nature ---
    vine_whip:       { id: "vine_whip",       name: "Vine Whip",       type: "nature", category: "physical", power: 45, accuracy: 100, pp: 30, effect: null,       effectChance: 0  },
    spore_cloud:     { id: "spore_cloud",     name: "Spore Cloud",     type: "nature", category: "status",   power: 0,  accuracy: 90,  pp: 20, effect: "poison",   effectChance: 100 },
    thorn_barrage:   { id: "thorn_barrage",   name: "Thorn Barrage",   type: "nature", category: "physical", power: 75, accuracy: 90,  pp: 15, effect: null,       effectChance: 0  },
    bloom_surge:     { id: "bloom_surge",     name: "Bloom Surge",     type: "nature", category: "special",  power: 90, accuracy: 85,  pp: 10, effect: "heal",     effectChance: 30 },
    // --- Wind ---
    gust_slice:      { id: "gust_slice",      name: "Gust Slice",      type: "wind",   category: "special",  power: 45, accuracy: 100, pp: 30, effect: null,       effectChance: 0  },
    cyclone_whip:    { id: "cyclone_whip",    name: "Cyclone Whip",    type: "wind",   category: "physical", power: 65, accuracy: 95,  pp: 20, effect: "spdUp",    effectChance: 25 },
    tempest_fall:    { id: "tempest_fall",    name: "Tempest Fall",    type: "wind",   category: "special",  power: 90, accuracy: 85,  pp: 10, effect: "stun",     effectChance: 12 },
    slipstream:      { id: "slipstream",      name: "Slipstream",      type: "wind",   category: "status",   power: 0,  accuracy: 100, pp: 20, effect: "spdUp",    effectChance: 100 },
    // --- Shade ---
    shadow_nip:      { id: "shadow_nip",      name: "Shadow Nip",      type: "shade",  category: "physical", power: 45, accuracy: 100, pp: 30, effect: null,       effectChance: 0  },
    dusk_fang:       { id: "dusk_fang",       name: "Dusk Fang",       type: "shade",  category: "physical", power: 65, accuracy: 95,  pp: 20, effect: "atkDown",  effectChance: 18 },
    nightfall:       { id: "nightfall",       name: "Nightfall",       type: "shade",  category: "special",  power: 90, accuracy: 85,  pp: 10, effect: "drain",    effectChance: 25 },
    umbral_shroud:   { id: "umbral_shroud",   name: "Umbral Shroud",   type: "shade",  category: "status",   power: 0,  accuracy: 100, pp: 15, effect: "atkUp",    effectChance: 100 },
    // --- Neutral fallback (any buddy can hold it) ---
    tackle:          { id: "tackle",          name: "Tackle",          type: "metal",  category: "physical", power: 35, accuracy: 100, pp: 35, effect: null,       effectChance: 0  },
    brace:           { id: "brace",           name: "Brace",           type: "terra",  category: "status",   power: 0,  accuracy: 100, pp: 20, effect: "defUp",    effectChance: 100 },
  };

  /* ------------------------------------------------------------- Species */
  // model: "voodoo" -> models/Voodoo-Dool-Animated.glb | "robot" -> models/RobotExpressive.glb
  // rarity drives spawn weight + battle XP payout.
  // learnset: [ [level, moveId], ... ] ascending.
  const SPECIES = [
    { id: "emberling",   name: "Emberling",   types: ["ember"],            rarity: "common",    model: "robot",  base: { hp: 45, atk: 52, def: 43, spd: 55 }, flavor: "A spark that refused to go out.",           learnset: [[1,"ember_spark"],[1,"tackle"],[6,"flame_claw"],[12,"cinder_veil"],[20,"inferno_rush"]] },
    { id: "cindercub",   name: "Cindercub",   types: ["ember"],            rarity: "uncommon",    model: "voodoo", base: { hp: 50, atk: 55, def: 48, spd: 45 }, flavor: "Sewn from ash and stubbornness.",            learnset: [[1,"ember_spark"],[1,"brace"],[6,"flame_claw"],[12,"cinder_veil"],[20,"inferno_rush"]] },
    { id: "pyroth",      name: "Pyroth",      types: ["ember","shade"],    rarity: "rare",      model: "robot",  base: { hp: 58, atk: 68, def: 52, spd: 62 }, flavor: "Burns brighter where the light dies.",      learnset: [[1,"ember_spark"],[1,"shadow_nip"],[8,"flame_claw"],[14,"dusk_fang"],[22,"inferno_rush"],[30,"nightfall"]] },

    { id: "aqualit",     name: "Aqualit",     types: ["aqua"],             rarity: "common",    model: "voodoo", base: { hp: 48, atk: 46, def: 50, spd: 52 }, flavor: "Carries the tide in a thimble.",             learnset: [[1,"ripple_shot"],[1,"tackle"],[6,"tide_crash"],[12,"mending_tide"],[20,"abyssal_surge"]] },
    { id: "tidepup",     name: "Tidepup",     types: ["aqua"],             rarity: "uncommon",    model: "robot",  base: { hp: 52, atk: 50, def: 48, spd: 56 }, flavor: "Chases its own wake.",                       learnset: [[1,"ripple_shot"],[1,"brace"],[6,"tide_crash"],[12,"mending_tide"],[20,"abyssal_surge"]] },
    { id: "marrowhale",  name: "Marrowhale",  types: ["aqua","spirit"],    rarity: "rare",      model: "voodoo", base: { hp: 62, atk: 60, def: 58, spd: 54 }, flavor: "Drowned once. Declined the offer.",         learnset: [[1,"ripple_shot"],[1,"spirit_lash"],[8,"tide_crash"],[14,"soul_siphon"],[22,"abyssal_surge"],[30,"wail_of_ages"]] },

    { id: "terrapod",    name: "Terrapod",    types: ["terra"],            rarity: "common",    model: "robot",  base: { hp: 55, atk: 54, def: 60, spd: 38 }, flavor: "Walks slow. Lands hard.",                    learnset: [[1,"pebble_toss"],[1,"brace"],[6,"fissure_slam"],[12,"stone_bulwark"],[20,"quake_bellow"]] },
    { id: "boulderp",    name: "Boulderp",    types: ["terra"],            rarity: "uncommon",    model: "voodoo", base: { hp: 58, atk: 56, def: 62, spd: 34 }, flavor: "Stuffed with gravel and grudges.",           learnset: [[1,"pebble_toss"],[1,"tackle"],[6,"fissure_slam"],[12,"stone_bulwark"],[20,"quake_bellow"]] },
    { id: "quakor",      name: "Quakor",      types: ["terra","metal"],    rarity: "rare",      model: "robot",  base: { hp: 70, atk: 72, def: 74, spd: 42 }, flavor: "The ground apologizes when it arrives.",    learnset: [[1,"pebble_toss"],[1,"iron_jab"],[8,"fissure_slam"],[14,"gear_grind"],[22,"quake_bellow"],[30,"alloy_annihilate"]] },

    { id: "voltkit",     name: "Voltkit",     types: ["volt"],             rarity: "common",    model: "robot",  base: { hp: 42, atk: 54, def: 40, spd: 68 }, flavor: "Static cling with a heartbeat.",             learnset: [[1,"static_jab"],[1,"tackle"],[6,"arc_bolt"],[12,"charge_up"],[20,"thunder_collapse"]] },
    { id: "sparko",      name: "Sparko",      types: ["volt"],             rarity: "uncommon",    model: "voodoo", base: { hp: 46, atk: 56, def: 44, spd: 64 }, flavor: "Bites the hand that grounds it.",            learnset: [[1,"static_jab"],[1,"brace"],[6,"arc_bolt"],[12,"charge_up"],[20,"thunder_collapse"]] },
    { id: "thundroo",    name: "Thundroo",    types: ["volt","wind"],      rarity: "rare",      model: "robot",  base: { hp: 58, atk: 70, def: 52, spd: 80 }, flavor: "Arrives before its own sound.",              learnset: [[1,"static_jab"],[1,"gust_slice"],[8,"arc_bolt"],[14,"cyclone_whip"],[22,"thunder_collapse"],[30,"tempest_fall"]] },

    { id: "frostbit",    name: "Frostbit",    types: ["frost"],            rarity: "common",    model: "voodoo", base: { hp: 48, atk: 50, def: 52, spd: 50 }, flavor: "Numb to everything. Especially fear.",       learnset: [[1,"ice_shard"],[1,"tackle"],[6,"glacial_lash"],[12,"frost_ward"],[20,"blizzard_howl"]] },
    { id: "glaciette",   name: "Glaciette",   types: ["frost"],            rarity: "uncommon",    model: "robot",  base: { hp: 50, atk: 52, def: 54, spd: 52 }, flavor: "Polished by a thousand winters.",            learnset: [[1,"ice_shard"],[1,"brace"],[6,"glacial_lash"],[12,"frost_ward"],[20,"blizzard_howl"]] },
    { id: "polarnox",    name: "Polarnox",    types: ["frost","shade"],    rarity: "rare",      model: "voodoo", base: { hp: 64, atk: 66, def: 62, spd: 50 }, flavor: "The long dark, given teeth.",                learnset: [[1,"ice_shard"],[1,"shadow_nip"],[8,"glacial_lash"],[14,"dusk_fang"],[22,"blizzard_howl"],[30,"nightfall"]] },

    { id: "wispurr",     name: "Wispurr",     types: ["spirit"],           rarity: "common",    model: "voodoo", base: { hp: 46, atk: 48, def: 46, spd: 60 }, flavor: "Follows anyone who forgets it.",             learnset: [[1,"spirit_lash"],[1,"brace"],[6,"soul_siphon"],[12,"ethereal_guard"],[20,"wail_of_ages"]] },
    { id: "soulshade",   name: "Soulshade",   types: ["spirit","shade"],   rarity: "rare",      model: "voodoo", base: { hp: 62, atk: 70, def: 58, spd: 62 }, flavor: "Wears the names of the lost.",               learnset: [[1,"spirit_lash"],[1,"shadow_nip"],[8,"soul_siphon"],[14,"dusk_fang"],[22,"wail_of_ages"],[30,"nightfall"]] },

    { id: "hexling",     name: "Hexling",     types: ["toxic"],            rarity: "common",    model: "voodoo", base: { hp: 50, atk: 52, def: 48, spd: 54 }, flavor: "Stitched with bad intentions.",              learnset: [[1,"venom_fang"],[1,"tackle"],[6,"spore_burst"],[12,"toxic_cloud"],[20,"blight_storm"]] },
    { id: "venomite",    name: "Venomite",    types: ["toxic","metal"],    rarity: "rare",      model: "robot",  base: { hp: 62, atk: 68, def: 60, spd: 52 }, flavor: "Corrodes from the inside, on purpose.",     learnset: [[1,"venom_fang"],[1,"iron_jab"],[8,"spore_burst"],[14,"gear_grind"],[22,"blight_storm"],[30,"alloy_annihilate"]] },

    { id: "mystix",      name: "Mystix",      types: ["mystic"],           rarity: "common",    model: "voodoo", base: { hp: 48, atk: 50, def: 48, spd: 58 }, flavor: "Reads futures that haven't agreed to it.",  learnset: [[1,"rune_bolt"],[1,"brace"],[6,"hex_breaker"],[12,"mystic_ward"],[20,"astral_rupture"]] },
    { id: "runefable",   name: "Runefable",   types: ["mystic","spirit"],  rarity: "rare",      model: "robot",  base: { hp: 62, atk: 66, def: 60, spd: 60 }, flavor: "Every scar is a spell it survived.",         learnset: [[1,"rune_bolt"],[1,"spirit_lash"],[8,"hex_breaker"],[14,"soul_siphon"],[22,"astral_rupture"],[30,"wail_of_ages"]] },

    { id: "ferradon",    name: "Ferradon",    types: ["metal"],            rarity: "common",    model: "robot",  base: { hp: 56, atk: 58, def: 62, spd: 40 }, flavor: "Rust is just patience winning.",             learnset: [[1,"iron_jab"],[1,"tackle"],[6,"gear_grind"],[12,"plating_up"],[20,"alloy_annihilate"]] },
    { id: "coglin",      name: "Coglin",      types: ["metal","volt"],     rarity: "rare",      model: "robot",  base: { hp: 60, atk: 70, def: 66, spd: 58 }, flavor: "Runs on spite and spare parts.",             learnset: [[1,"iron_jab"],[1,"static_jab"],[8,"gear_grind"],[14,"arc_bolt"],[22,"alloy_annihilate"],[30,"thunder_collapse"]] },

    { id: "thornkit",    name: "Thornkit",    types: ["nature"],           rarity: "common",    model: "voodoo", base: { hp: 52, atk: 52, def: 52, spd: 52 }, flavor: "Grows back meaner after pruning.",           learnset: [[1,"vine_whip"],[1,"brace"],[6,"spore_cloud"],[12,"thorn_barrage"],[20,"bloom_surge"]] },
    { id: "bloomaw",     name: "Bloomaw",     types: ["nature","toxic"],   rarity: "rare",      model: "voodoo", base: { hp: 66, atk: 68, def: 60, spd: 50 }, flavor: "Beautiful. Do not smell it.",                learnset: [[1,"vine_whip"],[1,"venom_fang"],[8,"spore_cloud"],[14,"toxic_cloud"],[22,"bloom_surge"],[30,"blight_storm"]] },

    { id: "zephyroo",    name: "Zephyroo",    types: ["wind"],             rarity: "common",    model: "robot",  base: { hp: 46, atk: 50, def: 44, spd: 70 }, flavor: "Never where it was a second ago.",           learnset: [[1,"gust_slice"],[1,"tackle"],[6,"cyclone_whip"],[12,"slipstream"],[20,"tempest_fall"]] },
    { id: "gloomoth",    name: "Gloomoth",    types: ["shade"],            rarity: "uncommon",    model: "voodoo", base: { hp: 50, atk: 54, def: 48, spd: 58 }, flavor: "Drawn to the last light you'll ever see.",  learnset: [[1,"shadow_nip"],[1,"brace"],[6,"dusk_fang"],[12,"umbral_shroud"],[20,"nightfall"]] },
    { id: "umbrix",      name: "Umbrix",      types: ["shade","mystic"],   rarity: "legendary", model: "robot",  base: { hp: 74, atk: 82, def: 70, spd: 72 }, flavor: "It was here before the map was drawn.",      learnset: [[1,"shadow_nip"],[1,"rune_bolt"],[10,"dusk_fang"],[16,"hex_breaker"],[24,"nightfall"],[32,"astral_rupture"]] },
  ];

  const RARITY = {
    common:    { id: "common",    name: "Common",    color: "#9ca3af", weight: 58, xpMul: 1.0,   hueJitter: 0.045 },
    uncommon:  { id: "uncommon",  name: "Uncommon",  color: "#4ade80", weight: 22, xpMul: 1.25,  hueJitter: 0.06  },
    rare:      { id: "rare",      name: "Rare",      color: "#60a5fa", weight: 15, xpMul: 1.6,   hueJitter: 0.08  },
    legendary: { id: "legendary", name: "Legendary", color: "#fbbf24", weight: 5,  xpMul: 2.4,   hueJitter: 0.1   },
  };

  /* -------------------------------------------------------------- Natures */
  // mul: stat multipliers (0.9 / 1.0 / 1.1 style), matching the classic feel.
  const NATURES = [
    { id: "hardy",   name: "Hardy",   mul: { hp: 1, atk: 1,   def: 1,   spd: 1   }, desc: "No stat leans." },
    { id: "bold",    name: "Bold",    mul: { hp: 1, atk: 0.9, def: 1.1, spd: 1   }, desc: "+Defense, −Attack" },
    { id: "timid",   name: "Timid",   mul: { hp: 1, atk: 0.9, def: 1,   spd: 1.1 }, desc: "+Speed, −Attack" },
    { id: "adamant", name: "Adamant", mul: { hp: 1, atk: 1.1, def: 1,   spd: 0.9 }, desc: "+Attack, −Speed" },
    { id: "calm",    name: "Calm",    mul: { hp: 1, atk: 1,   def: 1.1, spd: 0.9 }, desc: "+Defense, −Speed" },
    { id: "hasty",   name: "Hasty",   mul: { hp: 1, atk: 1.1, def: 0.9, spd: 1   }, desc: "+Attack, −Defense" },
    { id: "sturdy",  name: "Sturdy",  mul: { hp: 1.1, atk: 1, def: 1,   spd: 0.9 }, desc: "+HP, −Speed" },
    { id: "nimble",  name: "Nimble",  mul: { hp: 0.9, atk: 1, def: 1,   spd: 1.1 }, desc: "+Speed, −HP" },
    { id: "mystic",  name: "Mystic",  mul: { hp: 1.1, atk: 1, def: 0.9, spd: 1   }, desc: "+HP, −Defense" },
    { id: "brutal",  name: "Brutal",  mul: { hp: 0.9, atk: 1.1, def: 1, spd: 1   }, desc: "+Attack, −HP" },
  ];

  /* ------------------------------------------------------- Colorway names */
  // Cosmetic label for the rolled model hue. Each entry is the ACTUAL HSL the
  // tint is painted with, so "Ivory" really looks ivory and "Jade" really
  // looks green — the name and the render can never drift apart.
  const COLORWAYS = [
    { name: "Crimson",      h: 0.000, s: 0.72, l: 0.52 },
    { name: "Ember",        h: 0.030, s: 0.75, l: 0.53 },
    { name: "Rust",         h: 0.052, s: 0.62, l: 0.46 },
    { name: "Copper",       h: 0.072, s: 0.58, l: 0.50 },
    { name: "Bronze",       h: 0.092, s: 0.52, l: 0.48 },
    { name: "Amber",        h: 0.112, s: 0.78, l: 0.56 },
    { name: "Gold",         h: 0.135, s: 0.72, l: 0.56 },
    { name: "Sand",         h: 0.158, s: 0.32, l: 0.68 },
    { name: "Sunbleached",  h: 0.182, s: 0.28, l: 0.74 },
    { name: "Pearl",        h: 0.205, s: 0.16, l: 0.82 },
    { name: "Ivory",        h: 0.125, s: 0.22, l: 0.84 },
    { name: "Moss",         h: 0.230, s: 0.48, l: 0.44 },
    { name: "Jade",         h: 0.270, s: 0.52, l: 0.50 },
    { name: "Seafoam",      h: 0.330, s: 0.48, l: 0.62 },
    { name: "Teal",         h: 0.380, s: 0.58, l: 0.48 },
    { name: "Glacier",      h: 0.430, s: 0.42, l: 0.72 },
    { name: "Azure",        h: 0.475, s: 0.68, l: 0.56 },
    { name: "Cobalt",       h: 0.515, s: 0.70, l: 0.50 },
    { name: "Slate",        h: 0.555, s: 0.18, l: 0.50 },
    { name: "Silver",       h: 0.590, s: 0.12, l: 0.72 },
    { name: "Ashen",        h: 0.620, s: 0.10, l: 0.62 },
    { name: "Onyx",         h: 0.655, s: 0.12, l: 0.24 },
    { name: "Voidtouched",  h: 0.690, s: 0.55, l: 0.38 },
    { name: "Violet",       h: 0.725, s: 0.58, l: 0.54 },
    { name: "Lilac",        h: 0.760, s: 0.46, l: 0.70 },
    { name: "Orchid",       h: 0.795, s: 0.52, l: 0.62 },
    { name: "Rose",         h: 0.900, s: 0.62, l: 0.64 },
    { name: "Bloodmoon",    h: 0.955, s: 0.58, l: 0.44 },
  ];


  /* ------------------------------------------------ Customization ladder */
  // Progressive growth: unlocking by buddy level. `slot` is the equip slot
  // the piece writes into on the instance's `customization` object.
  const CUSTOMIZATION_TIERS = [
    { level: 1,  id: "hue",       slot: "hue",      name: "Wild Hue",        desc: "Every buddy is born with its own colorway." },
    { level: 3,  id: "eyes_glow", slot: "eyes",     name: "Glowing Eyes",    desc: "Eye shine pulses when the buddy acts." },
    { level: 5,  id: "aura_a",    slot: "aura",     name: "Lesser Aura",     desc: "A soft halo of your element." },
    { level: 8,  id: "trail_a",   slot: "trail",    name: "Dust Trail",      desc: "Leaves motes behind when it moves." },
    { level: 12, id: "hat_a",     slot: "hat",      name: "Scout Cap",       desc: "First headpiece unlocked." },
    { level: 16, id: "eyes_reaper",slot: "eyes",    name: "Reaper Eyes",     desc: "Sharper, brighter eye shine." },
    { level: 20, id: "aura_b",    slot: "aura",     name: "Greater Aura",    desc: "The halo widens and intensifies." },
    { level: 24, id: "pattern",   slot: "pattern",  name: "Runed Pattern",   desc: "Glowing runes crawl across the body." },
    { level: 28, id: "hat_b",     slot: "hat",      name: "Warden Helm",     desc: "A proper helm for a proven fighter." },
    { level: 32, id: "trail_b",   slot: "trail",    name: "Ember Trail",     desc: "Trail upgrades to sparks and smoke." },
    { level: 36, id: "aura_c",    slot: "aura",     name: "War Aura",        desc: "Elemental storm orbiting the body." },
    { level: 40, id: "wings",     slot: "wings",    name: "Void Wings",      desc: "Wings of condensed shade unfurl." },
    { level: 45, id: "crown",     slot: "crown",    name: "Ascendant Crown", desc: "The mark of a maxed companion." },
    { level: 50, id: "ascendant", slot: "aura",     name: "Ascendant Form",  desc: "Full cosmetic evolution. Nothing left to unlock." },
  ];

  /* ------------------------------------------------------------- Curves */
  const BUDDY_MAX_LEVEL = 50;
  const PLAYER_MAX_LEVEL = 100;

  // Buddy XP required to advance FROM `level` to `level + 1`.
  // Gentle cubic ramp — 50 levels should feel like a season, not a weekend.
  function buddyXpToNext(level) {
    const l = Math.max(1, Math.min(BUDDY_MAX_LEVEL, level));
    return Math.floor(18 + Math.pow(l, 2.35) * 1.6);
  }

  // Player XP required to advance FROM `level` to `level + 1`.
  function playerXpToNext(level) {
    const l = Math.max(1, Math.min(PLAYER_MAX_LEVEL, level));
    return Math.floor(80 + Math.pow(l, 1.72) * 22);
  }

  const PLAYER_LEVEL_TITLES = [
    [1, "Wanderer"], [5, "Strider"], [10, "Tracker"], [15, "Handler"],
    [20, "Warden"], [25, "Vanguard"], [30, "Champion"], [40, "Mythkeeper"],
    [50, "Eldenborn"], [65, "Realmwalker"], [80, "Legend"], [100, "Elden Earth"],
  ];

  /* --------------------------------------------------------- Animations */
  // Clip names vary by model: RobotExpressive ships 14 named clips, while the
  // voodoo doll exports from Mixamo with everything called "mixamo.com" (we
  // rename them to "idle" / "running" at merge time). Callers ask for a
  // semantic name ("walk", "punch") and this maps it onto whatever actually
  // exists on the loaded model.
  const ANIM_ALIAS = {
    // locomotion
    walk: "running", walking: "running", run: "running", running: "running",
    move: "running", chase: "running",
    // resting
    idle: "idle", stand: "idle", standing: "idle", wait: "idle",
    // actions — fall back to a sensible clip when the model has no dedicated
    // one for it (the voodoo doll only has idle + running).
    punch: "running", attack: "running", hit: "running", bite: "running",
    wave: "idle", dance: "running", jump: "running", cheer: "running",
    thumbsup: "idle", yes: "idle", no: "idle",
    sitting: "idle", sit: "idle",
    // emotion / defeat — the voodoo doll's slow "sad" clip reads perfectly as
    // a faint or a loss, so those route here instead of freezing the model.
    death: "sad", dead: "sad", faint: "sad", hurt: "sad", lose: "sad", lost: "sad",
    sad: "sad", mad: "sad", angry: "sad", upset: "sad", grief: "sad",
    walkjump: "running",
  };

  /**
   * Pick the best available clip name for a requested animation.
   * @param {string}   name       requested semantic name ("walk", "punch")
   * @param {string[]} available  clip names actually on the loaded model
   * @returns {string|null}
   */
  function resolveAnim(name, available) {
    if (!available || !available.length) return null;
    const want = String(name || "idle").toLowerCase();

    let hit = available.find((n) => n.toLowerCase() === want);
    if (hit) return hit;

    // Substring next, so "walk" finds the robot's "walking" clip before the
    // alias table routes it to "running".
    hit = available.find((n) => n.toLowerCase().includes(want) || want.includes(n.toLowerCase()));
    if (hit) return hit;

    const aliased = ANIM_ALIAS[want];
    if (aliased) {
      hit = available.find((n) => n.toLowerCase() === aliased);
      if (hit) return hit;
      hit = available.find((n) => n.toLowerCase().includes(aliased));
      if (hit) return hit;
    }

    hit = available.find((n) => n.toLowerCase().includes("idle"))
      || available.find((n) => n.toLowerCase().includes("stand"));
    return hit || available[0];
  }

  /* --------------------------------------------------- Trainer rewards */
  // What every trainer level-up is worth. MIRRORED in functions/buddy.js
  // (buddyClaimLevelRewards) — the server is what actually grants EB /
  // diamonds / RP because those are server-owned currencies, so the two
  // copies must always agree.
  //
  //   every level  ->  berries (scales with level)
  //   every 2 lvl  ->  10 EB
  //   every 5 lvl  ->  25 diamonds
  //   every 10 lvl ->  5 RP
  function trainerLevelRewards(fromLevel, toLevel) {
    let berries = 0, eb = 0, diamonds = 0, rp = 0;
    const from = Math.max(0, fromLevel | 0);
    const to = Math.max(from, toLevel | 0);
    for (let l = from + 1; l <= to; l++) {
      berries += 5 + l;
      if (l % 2 === 0) eb += 10;
      if (l % 5 === 0) diamonds += 25;
      if (l % 10 === 0) rp += 5;
    }
    return { berries, eb, diamonds, rp };
  }

  // What a single level-up pays — used for the "next reward" preview.
  function trainerLevelRewardAt(level) {
    return trainerLevelRewards(level - 1, level);
  }

  // The milestones the player can look forward to past `level`.
  function upcomingTrainerRewards(level, count) {
    const out = [];
    for (let l = level + 1; out.length < (count || 4) && l <= PLAYER_MAX_LEVEL; l++) {
      const r = trainerLevelRewardAt(l);
      const bits = [];
      if (r.eb) bits.push(r.eb + " EB");
      if (r.diamonds) bits.push(r.diamonds + " 💎");
      if (r.rp) bits.push(r.rp + " RP");
      if (bits.length) out.push({ level: l, rewards: r, label: bits.join(" + ") });
    }
    return out;
  }

  /* ------------------------------------------------------------ Lookups */
  function getSpecies(id) { return SPECIES.find(s => s.id === id) || null; }
  function getMove(id) { return MOVES[id] || null; }
  function getNature(id) { return NATURES.find(n => n.id === id) || NATURES[0]; }
  function getRarity(id) { return RARITY[id] || RARITY.common; }
  function getType(id) { return TYPES[id] || null; }
  function allSpecies() { return SPECIES.slice(); }
  function allMoves() { return Object.keys(MOVES).map(k => MOVES[k]); }

  function typeEffectiveness(moveType, defenderTypes) {
    const row = TYPE_CHART[moveType];
    if (!row) return 1;
    let mult = 1;
    (defenderTypes || []).forEach(t => {
      if (row[t] !== undefined) mult *= row[t];
    });
    return mult;
  }

  // Moves a species knows at `level` (last 4 learnset entries that qualify).
  function movesAtLevel(speciesId, level) {
    const sp = getSpecies(speciesId);
    if (!sp) return ["tackle"];
    const learned = sp.learnset
      .filter(entry => entry[0] <= level)
      .map(entry => entry[1]);
    const unique = [];
    learned.forEach(id => { if (!unique.includes(id)) unique.push(id); });
    return unique.slice(-4);
  }

  // Cosmetic piece ids unlocked at `level` (all tiers up to that level).
  function unlockedCosmetics(level) {
    return CUSTOMIZATION_TIERS.filter(t => t.level <= level);
  }

  function playerTitle(level) {
    let title = PLAYER_LEVEL_TITLES[0][1];
    PLAYER_LEVEL_TITLES.forEach(([lvl, name]) => { if (level >= lvl) title = name; });
    return title;
  }

  /* --------------------------------------------------- Rarity roll (wild) */
  // Weighted pick. Legendary is rare on purpose — 5 in 100 wild spawns.
  function rollRarity(rng) {
    const r = rng || Math.random;
    const entries = Object.keys(RARITY).map(k => RARITY[k]);
    const total = entries.reduce((s, e) => s + e.weight, 0);
    let roll = r() * total;
    for (const e of entries) {
      roll -= e.weight;
      if (roll <= 0) return e.id;
    }
    return "common";
  }

  // Weighted species pick inside a rarity band.
  function rollSpecies(rng) {
    const r = rng || Math.random;
    const rarity = rollRarity(r);
    const pool = SPECIES.filter(s => s.rarity === rarity);
    const list = pool.length ? pool : SPECIES;
    return list[Math.floor(r() * list.length) % list.length].id;
  }

  return {
    TYPES,
    TYPE_CHART,
    MOVES,
    SPECIES,
    RARITY,
    NATURES,
    COLORWAYS,
    CUSTOMIZATION_TIERS,
    BUDDY_MAX_LEVEL,
    PLAYER_MAX_LEVEL,
    PLAYER_LEVEL_TITLES,
    buddyXpToNext,
    playerXpToNext,
    trainerLevelRewards,
    trainerLevelRewardAt,
    upcomingTrainerRewards,
    ANIM_ALIAS,
    resolveAnim,
    getSpecies,
    getMove,
    getNature,
    getRarity,
    getType,
    allSpecies,
    allMoves,
    typeEffectiveness,
    movesAtLevel,
    unlockedCosmetics,
    playerTitle,
    rollRarity,
    rollSpecies,
  };
})();
