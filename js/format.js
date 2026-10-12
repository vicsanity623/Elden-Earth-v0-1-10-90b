/**
 * Shared number formatting for every currency readout in the game.
 *
 * Why this exists: the HUD, the treasury modal and the cashout screen were each
 * rolling their own toFixed() calls, so the same balance rendered as
 * "RC.955369559209686", "RC 0.00000743270/S" and "RC 2.610426" on one screen.
 * One formatter = one look = the game reads as finished.
 *
 * Conventions (match these everywhere):
 *   - "RC " prefix with a space, never "RC." glued to the digits.
 *   - Thousands separators on the whole part (955,369.55 not 955369.55).
 *   - Trailing precision shrinks as the number grows; use rcPrecise() when the
 *     exact figure genuinely matters (payout ledgers, cashout confirmations).
 *   - Rates use significant digits so the first real digit is always visible
 *     without printing eleven meaningless zeros.
 */
(function (global) {
  "use strict";

  var NF = typeof Intl !== "undefined" ? Intl.NumberFormat : null;

  function group(whole) {
    var s = String(whole);
    return s.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  }

  // Split into grouped whole + fixed decimals without going through Number
  // first, so values beyond 2^53 stay accurate as a string.
  function splitFixed(value, decimals) {
    var n = Number(value);
    if (!isFinite(n)) n = 0;
    var neg = n < 0;
    var abs = Math.abs(n);
    var fixed = abs.toFixed(decimals);
    var parts = fixed.split(".");
    return {
      neg: neg,
      whole: group(parts[0]),
      frac: parts[1] || "",
    };
  }

  // Trim trailing zeros. Keeps at least `minFrac` decimals, and never returns
  // an empty fraction (so a currency figure never collapses to a bare integer).
  function trimFrac(frac, minFrac) {
    var out = frac.replace(/0+$/, "");
    while (out.length < minFrac) out += "0";
    return out;
  }

  /**
   * Realm Coins. Default precision steps down as the balance grows so a HUD
   * readout stays on one line:
   *     < 1      -> 6 dp   (0.000412)
   *     < 1,000  -> 4 dp   (2.6104)
   *     >= 1,000 -> 2 dp   (12,345.68)
   * Trailing zeros are trimmed, so 0.05 renders as "0.05", not "0.0500".
   */
  function rc(value, opts) {
    opts = opts || {};
    var n = Number(value);
    if (!isFinite(n)) n = 0;
    var abs = Math.abs(n);

    var decimals;
    if (opts.decimals != null) decimals = opts.decimals;
    else if (abs >= 1000) decimals = 2;
    else if (abs >= 1) decimals = 4;
    else if (abs >= 0.01) decimals = 4;
    else decimals = 6;

    var p = splitFixed(n, decimals);
    // Whole numbers read better with no fraction at all ("RC 1,000").
    var frac = trimFrac(p.frac, 0);
    var body = frac ? p.whole + "." + frac : p.whole;
    // Sign goes after the prefix: "RC -3.5", never "-RC 3.5".
    return (opts.bare ? "" : "RC ") + (p.neg ? "-" : "") + body;
  }

  /** Full-precision RC — payout ledgers and confirmations only. */
  function rcPrecise(value, decimals) {
    return rc(value, { decimals: decimals == null ? 6 : decimals });
  }

  /** Compact RC for tight HUD chips: 1.2M, 955.4K, 0.000412. */
  function rcCompact(value) {
    var n = Number(value);
    if (!isFinite(n)) n = 0;
    var abs = Math.abs(n);
    if (abs >= 1e9) return "RC " + (n / 1e9).toFixed(2) + "B";
    if (abs >= 1e6) return "RC " + (n / 1e6).toFixed(2) + "M";
    if (abs >= 1e4) return "RC " + (n / 1e3).toFixed(1) + "K";
    return rc(n);
  }

  /**
   * Per-second rates. Uses significant digits instead of a fixed decimal count
   * so "0.0000007433" reads cleanly rather than "0.0000007432700000/s".
   */
  function rate(value, opts) {
    opts = opts || {};
    var n = Number(value);
    if (!isFinite(n)) n = 0;
    var abs = Math.abs(n);

    var text;
    if (abs === 0) {
      text = "0";
    } else if (abs >= 1) {
      // Rates at or above 1 RC/s always show 2 dp — stable width, no jitter.
      text = n.toFixed(2);
    } else {
      // Keep 4 significant digits, capped at 12 dp so tiny rates stay readable,
      // then drop the trailing zeros (0.05, not 0.05000).
      var exp = Math.floor(Math.log10(abs));
      var dp = Math.min(12, Math.max(0, 3 - exp));
      var parts = abs.toFixed(dp).split(".");
      var frac = trimFrac(parts[1] || "", 1);
      text = (n < 0 ? "-" : "") + parts[0] + "." + frac;
    }
    return (opts.bare ? "" : "RC ") + text + (opts.perSec === false ? "" : "/s");
  }

  /** US dollars, always 2 dp, for the redemption screen only. */
  function usd(value) {
    var n = Number(value);
    if (!isFinite(n)) n = 0;
    return "$" + Math.abs(n).toFixed(2);
  }

  /** Plain grouped integer — plots, diamonds, EB. */
  function int(value) {
    var n = Math.floor(Number(value) || 0);
    return group(n);
  }

  /** Percent with at most 2 dp and no trailing zeros: "25%", "7.14%". */
  function pct(value) {
    var n = Number(value) || 0;
    return n.toFixed(2).replace(/\.?0+$/, "") + "%";
  }

  var api = {
    rc: rc,
    rcPrecise: rcPrecise,
    rcCompact: rcCompact,
    rate: rate,
    usd: usd,
    int: int,
    pct: pct,
    group: group,
  };

  global.Fmt = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : this);
