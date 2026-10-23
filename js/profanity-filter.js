// ============================================================
// Elden Earth — Profanity Filter
// Shared between client and server for name/chat validation.
//
// Canonical "dark words" list — mild words (ass, hell, shit, damn, crap,
// jerk…) are deliberately NOT listed. functions/index.js mirrors this file
// EXACTLY (chatfiltertest.js enforces both lists stay identical).
// ============================================================

const ProfanityFilter = (() => {
  // Dark profanity / slurs only (lowercase, deduped)
  const PROFANITY_LIST = [
    // Sexual/Anatomical
    "anal", "anus", "bitch", "boob", "boobs",
    "cock", "cunt", "dick", "dickhead", "dildo", "fag", "faggot",
    "fuck", "fucked", "fucker", "fuckers", "fucking", "fuckface", "fuckhead",
    "motherfucker", "motherfuckers",
    "pussy", "rape", "rapist", "sex", "sexual", "slut", "whore",

    // Racial/Ethnic Slurs
    "nigger", "nigga", "nigro", "negro", "kike", "spic", "wetback",
    "chink", "gook", "towelhead", "cracker", "honky",

    // Other Offensive
    "douche", "prick",

    // Violence/Abuse
    "abuse", "kill", "murder", "suicide",

    // Drugs
    "cocaine", "crack", "heroin", "meth"
  ];

  // Leetspeak character mapping
  const LEET_MAP = {
    '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '8': 'b',
    '@': 'a', '$': 's', '!': 'i', '+': 't'
  };

  // Convert leetspeak to normal text
  function decodeLeetspeak(text) {
    return text.toLowerCase().split('').map(char => LEET_MAP[char] || char).join('');
  }

  // Short, high-collision tokens (kill, meth, rape, sex…) need word boundaries
  // or they flag harmless words: "bypass" (ass), "grape" (rape), "method"
  // (meth), "class", "grass", "analysis", "hello" (hell). Longer, specific
  // tokens keep substring matching so compounds are still caught.
  function profanityPattern(word, flags) {
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(word.length <= 6 ? `\\b${escaped}\\b` : escaped, flags);
  }

  // Check if text contains profanity
  function containsProfanity(text) {
    if (!text || typeof text !== 'string') return false;

    const normalized = text.toLowerCase().trim();
    const decoded = decodeLeetspeak(normalized);

    for (const word of PROFANITY_LIST) {
      const re = profanityPattern(word, 'i');
      if (re.test(normalized) || re.test(decoded)) return true;
    }

    return false;
  }

  // Filter profanity from text (replace with ****)
  function filterProfanity(text) {
    if (!text || typeof text !== 'string') return text;

    let filtered = text;
    const normalized = text.toLowerCase();
    const decoded = decodeLeetspeak(normalized);

    for (const word of PROFANITY_LIST) {
      // Replace direct matches (word boundaries for short tokens)
      filtered = filtered.replace(profanityPattern(word, 'gi'), '****');
    }

    return filtered;
  }

  // Check if text is entirely profanity (should be blocked entirely)
  function isEntirelyProfanity(text) {
    if (!text || typeof text !== 'string') return false;

    const filtered = filterProfanity(text);
    // If after filtering, the text is mostly ****, it's entirely profanity
    const profanityRatio = (filtered.match(/\*\*\*\*/g) || []).length * 4 / text.length;
    return profanityRatio > 0.7;
  }

  return {
    containsProfanity,
    filterProfanity,
    isEntirelyProfanity,
    PROFANITY_LIST
  };
})();
