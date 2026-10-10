# Elden Earth

A real-world geo-location territory-claiming idle game. Walk the real world, collect diamonds, spin the fortune wheel, claim 20x20 ft tiles beneath your feet, and earn simulated passive rent.

Built with **pure static HTML5 / CSS3 / Vanilla JS** -- zero build step, 100% hosted on GitHub Pages as a **Progressive Web App (PWA)**. Backend powered by **Firebase Cloud Functions** and **Firestore**. Also ships as an **Android APK** (a WebView shell around the same web build) and includes a **Rewards Program** where Reward Points earned through play can be redeemed for small PayPal amounts.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Map Engine | MapLibre GL JS + OpenFreeMap (free, no token) |
| 3D Rendering | Three.js r128 (WebGL custom map layers) |
| Character Models | Mixamo / Khronos GLB skeletal animations |
| Backend | Firebase Cloud Functions (Node.js 22) |
| Database | Cloud Firestore (real-time snapshots) |
| Auth | Google Identity Services (OAuth 2.0) + Firebase Auth (phone for redemption) |
| Ads | Google AdSense (banner + fullscreen vignette) |
| Hosting | GitHub Pages (static) + Firebase (functions) |
| Android | WebView shell (`android/`), WorkManager for local notifications |
| Redemptions | PayPal (Rewards Program, see `rewards-terms.html`) |

---

## Repository Structure

```text
EE/
├── index.html              # Single-page app shell (2145 lines)
├── manifest.json           # PWA config & home screen icons
├── sw.js                   # Service worker (network-first caching)
├── firebase.json           # Firebase hosting/functions config
├── firestore.rules         # Firestore security rules
├── ads.txt                 # Ads.txt for AdSense
├── deploy-functions.sh     # Deploy helper — retries functions that fall out of a batch deploy
│
├── CHANGELOG.md            # Full change history
├── FINANCIALPLAN.md        # Play Store readiness: Rewards Program design & compliance
├── PLAY-LISTING.md         # Store listing copy + Data Safety answers
├── rewards-terms.html      # Rewards Program Terms
├── privacy.html            # Privacy Policy
│
├── android/                # WebView shell APK (Gradle project)
│
├── css/
│   └── style.css           # Cyberpunk dark theme, responsive, animations
│
├── js/                     # 33 IIFE singleton modules
│   ├── config.js           # Central tuning (rates, costs, Firebase keys)
│   ├── auth.js             # Google OAuth, session blocking, ban checks
│   ├── storage.js          # localStorage + Firestore cloud sync, session locks
│   ├── main.js             # Game loop, GPS, camera, UI wiring, boot (4513 lines)
│   ├── loading.js          # 3D cinematic loading stage & bootloader
│   ├── anticheat.js        # Client-side GPS spoof detection, rate limits
│   ├── server-anticheat.js # Server-authoritative validation bridge
│   ├── multiplier.js       # 20X/50X boost logic, +2EB claim loop
│   ├── character.js        # Three.js 3D avatar with idle/walk animation
│   ├── pet.js              # 3D companion pet (follow, fetch, mood, berries)
│   ├── grid.js             # 20x20 ft tile grid, land purchase, rarity rolls
│   ├── diamonds.js         # Diamond spawning, proximity detection, HUD particles
│   ├── elden-stops.js      # PokeStop-style POI beacons with disc spin rewards
│   ├── citadels.js         # 3D Dyson Sphere monuments, upgrade forge, siege combat
│   ├── plot-ascension.js   # Plot Ascension Forge (3 same-rarity -> 1 next-rarity)
│   ├── wheel.js            # CSPRNG spin wheel (Web Crypto API)
│   ├── trade.js            # Player-to-player plot trades
│   ├── feed.js             # Live 50-event activity feed with geocoding
│   ├── leaderboard.js      # 4-tier scoped leaderboards (global/country/state/city)
│   ├── chat.js             # Real-time global chat with profanity filter
│   ├── friends.js          # Friend requests, daily gifts, relationship tracking
│   ├── referrals.js        # Referral codes, claimable bonus ledger
│   ├── pool.js             # 1% weekly treasury dividend distribution
│   ├── global-event.js     # Global community challenge (contribution -> reward pool)
│   ├── cashout.js          # Rewards Program redemption screen
│   ├── treasury.js         # Revenue-goal gate shared by the pool + cashout screens
│   ├── achievements.js     # 100 lifetime milestones, generated badges, badge grid
│   ├── age.js              # One-time date-of-birth gate (13+ play, 18+ redeem)
│   ├── native-bridge.js    # Android WebView bridge wrapper
│   ├── foliage.js          # Procedural grass & mushroom map markers
│   ├── geo.js              # Web Mercator math, tile bounds, distance calc
│   ├── firebase-version-config.js  # App version / update channel config
│   └── profanity-filter.js # Shared word filter (client + server)
│
├── models/                 # GLB 3D character models
│   ├── Soldier.glb
│   ├── Xbot.glb
│   ├── Fox.glb
│   └── CesiumMan.glb
│
├── assets/                 # UI frame images, icons, QR codes
│
├── functions/              # Firebase Cloud Functions (Node.js)
│   ├── index.js            # Server anti-cheat, economy, purchases (8849 lines)
│   ├── ban-player.js
│   ├── cleanup-orphans.js
│   ├── detect-plot-exploit.js
│   ├── early-adopter-boost.js
│   ├── fix-saves.js
│   ├── restore-plots.js
│   ├── reward-all-players.js
│   ├── reward-showcase-players.js
│   └── wipe-firestore.js   # + other one-off admin/repair scripts
│
└── server/                 # Standalone access-control server
    └── access-control.js   # Email whitelist/banlist HTTP endpoint
```

---

## Architecture

### Client-Side Module System

All 33 JS modules are **IIFE singletons** loaded via `<script>` tags in `index.html`. They communicate through a shared `Store` state object and direct function calls. No bundler, no transpiler, no module loader.

```
Boot Sequence:
  config.js -> auth.js -> storage.js -> loading.js -> main.js
                                                        |
  [Google Sign-In] -> [GPS Permission] -> [Map Init] -> [Game Loop]
                                                        |
  Store.load() -> Store.syncFromCloud() ->收入 tick (1s interval)
```

### Data Flow

```
Player Action
    |
    v
Client Validation (AntiCheat.js)
    |
    v
Server Validation (ServerAntiCheat -> Cloud Functions)
    |
    v
Firestore Write (state document + plots collection)
    |
    v
Real-time Snapshot -> All Connected Clients
```

### Session Management

- **Single Active Session:** Only one tab/device can be active per account
- **Session Lock:** Stored in Firestore with 30-second heartbeat
- **Conflict Detection:** New tab shows "Account Locked" modal with Take Over option
- **Pause on Background:** Income loop stops when `document.hidden` is true

### Cloud Sync Strategy

- **Debounced Writes:** localStorage buffered to 10-second intervals
- **Cloud Save:** Every 20 seconds via `syncSafeState` callable function
- **Conflict Resolution:** Timestamp-based (`lastSavedAt`) -- newer state wins
- **Session Lock:** Stored in Firestore document, checked on every cloud read
- **Epoch Wipes:** `REALM_SERVER_EPOCH` timestamp for intentional database resets
- **Server-Owned Fields:** Reward Points, date of birth, achievement counters and
  citadel spoils live in `saves_private/{uid}`, which is **owner-only readable**
  and written exclusively by the Admin SDK. `saves/{uid}` stays world-readable
  (the leaderboard and player profile both read other players' saves) but is
  `allow update: if false` from the client, so nothing personal can leak and
  nothing economy-related can be forged.

### Anti-Cheat Layers

| Layer | Location | What It Checks |
|---|---|---|
| GPS Velocity | Client | Max 200 km/h, acceleration limits |
| Purchase Rate | Client | 5s cooldown, 5/min hard cap |
| Balance Sanity | Client | EB < 500K, Diamonds < 10K |
| Embargo Check | Client | Country-level block (DPRK) |
| Server Position | Cloud Functions | Re-validates GPS server-side |
| Server Economy | Cloud Functions | Authoritative reward calculation |
| Replay Protection | Cloud Functions | Idempotency keys on all actions |
| Bot Detection | Client | WebDriver, DevTools, headless UA |

### Performance Optimizations

| Feature | Implementation |
|---|---|
| 5km Horizon Culling | Removes 3D objects beyond 5,000m |
| Frame Throttling | 15 FPS idle, 60 FPS walking |
| Background Sleep | 0% GPU/CPU when screen locked |
| GPS Radio Sleep | 5s max age, 1.5m movement threshold |
| Flash Wear Reduction | Debounced localStorage writes |
| Low-Power WebGL | No MSAA, `powerPreference: "low-power"` |
| Map Culling | Below zoom 14, all 3D/DOM objects hidden |

---

## Game Features

For a complete guide to all in-game features, currencies, progression systems, and gameplay mechanics, see **[Game Guide](docs/game-guide.md)**.

### Core Systems (Implemented)

- **Land Claiming** -- 20x20 ft grid tiles with 4 rarity tiers (Common/Rare/Epic/Legendary)
- **Passive Rent** -- Earn simulated $/sec from owned land
- **Diamond Economy** -- Floating diamonds on map, 3-tier proximity spawning
- **Spin Wheel** -- Cryptographically fair 10-slice wheel (Web Crypto API)
- **20X/50X Boost** -- Time-limited multiplier with tier-based anti-whale scaling
  (base rebalanced 30X -> 20X on 2026-10-08)
- **+2EB Boost** -- 20-minute cooldown claim loop
- **Diamond Extractor** -- Automated mining (requires 5+ connected plots)
- **Realm Citadels** -- 3D Dyson Sphere monuments with upgrade forge & siege combat
- **Elden Stops** -- PokeStop-style POI beacons with disc spin rewards
- **Companion Pet** -- 3D pet that follows player, fetches items, mood system
- **Weekly Treasury Pool** -- 1% dividend to top 10 players every Monday
- **Political Titles** -- Mayor/Governor/President with stackable royalties
- **Friends System** -- Request/accept, daily gifts (+5 EB), max 50 friends
- **Referral System** -- Unique codes, +25 EB per referral
- **Global Chat** -- Real-time with profanity filter, anti-spam, plot-gated
- **Activity Feed** -- 50-event live ticker with geocoding & flag emojis
- **4-Tier Leaderboards** -- Global, Country, State, City scopes
- **90-Day Calendar** -- Daily login rewards on a UTC-day streak ladder, with a
  one-day grace for a single miss and a Cycle counter that wraps 90 -> 1
- **Daily Quests** -- 12 on the board each day (11 fixed + one rotating ascend
  quest chosen from the UTC date), including repeat-count quests with progress
  bars; all once per day
- **Achievements & Badges** -- 100 lifetime milestones across 7 categories with
  live progress tracking, claimable rewards and a generated badge per unlock
- **Reward Points (RP)** -- Loyalty currency, 100 RP = $1.00, earned only through
  activity (never chance) and the sole redemption path
- **Rewards Program** -- Small PayPal redemptions gated behind age (18+), phone
  and region verification, with per-player and global monthly/yearly caps
- **Treasury Gate** -- Redemptions unlock for everyone once the Realm's ad
  revenue covers the program budget; progress is shown on the cashout screen,
  the Weekly Treasury and the activity feed
- **Plot Ascension Forge** -- Sacrifice 3 same-rarity plots to upgrade one to the
  next rarity
- **Plot Trades** -- Player-to-player plot swaps with confirmation, expiry and a
  per-day quota
- **Global Challenge** -- Community-wide contribution event with a shared reward
  pool split by contribution share
- **Age Verification** -- One-time date-of-birth gate (13+ to play, 18+ to redeem),
  recorded server-side and immutable
- **3D Wardrobe** -- Hot-swap character models
- **50X Super Boost Events** -- 24h active / 72h cooldown cycle
- **Elden Stop Beacons** -- Public landmark POIs with construction timers
- **Bird's Eye View** -- 25-mile territory overview mode
- **Android APK** -- WebView shell with the same web build, boost-expiry
  notifications and a native bridge

### Server-Side Features

- **syncSafeState** -- Authoritative cloud save with field whitelisting
- **activateBoost** -- Server-validated boost activation
- **spinWheel** -- Server-rolled wheel outcome verification
- **claimBoost** -- 20-minute cooldown enforcement
- **citadelAction** -- Plant/relocate/upgrade validation
- **diamond collection** -- Position-verified pickup
- **chat moderation** -- Server-side message filtering
- **ban system** -- Player ban with reason tracking

#### Daily progression & achievements

- **claimDailyReward** -- UTC-day login ladder with a one-day grace, streak
  tracking and a Cycle counter (90-day wrap)
- **claimQuestReward** -- Per-quest EB + RP, each claimable once per UTC day
- **claimAchievement** -- One-time lifetime milestone claim; the unlock record is
  written in the same transaction that pays, so a tier can never be claimed twice
- **setDateOfBirth** -- Writes the DOB once; immutable afterwards
- **recordActivity** -- Rate-limited progress reports for the few actions with no
  server call site (gifts, surveys, chat)

#### Rewards Program & compliance

- **submitWithdrawalRequest** -- RP redemption. Enforces age 18+, phone
  verification, server-derived region, 90-day account age, per-player monthly
  cap, global monthly + yearly program caps, and the treasury gate
- **approveWithdrawal / rejectWithdrawal** -- Consume or refund the monthly and
  yearly budgets
- **getTreasuryStatus** -- Shared revenue-goal state for the cashout screen,
  Weekly Treasury and feed
- **treasuryMilestones** -- Firestore trigger that posts feed milestones at 50%,
  80% and unlocked
- **checkCountryAccess / resolvePlayerRegion** -- Region derived server-side from
  the validated GPS fix (Nominatim reverse geocode), cached 7 days. The client's
  claimed country is ignored.

#### Economy limits

- **recallCitadel / conquerCitadel** -- Spoils accrual capped at 24h of holding,
  30-minute minimum hold before recall, 30-minute re-station cooldown, and a
  per-player daily cap of 150 EB + 60 diamonds
- **ascendPlot** -- Plot Ascension Forge cost table
- **createTrade / confirmTrade / cancelTrade** -- Trade lifecycle with per-day
  quotas and distance checks

---

## Configuration

All gameplay tuning is in **`js/config.js`**:

| Parameter | Default | Description |
|---|---|---|
| `TILE_SIZE_METERS` | 6.096 | ~20x20 ft grid tiles |
| `SPIN_COST_DIAMONDS` | 2 | Cost per wheel spin |
| `PLOT_COST_EB` | 100 | Cost per land plot |
| `EXTRACTOR_BUILD_COST_EB` | 50 | Extractor construction cost |
| `DIAMOND_SPAWN_RADIUS_METERS` | 1000 | Max diamond spawn distance |
| `DIAMOND_COLLECT_RADIUS_METERS` | 75 | Player collection range |
| `DIAMOND_MAX_ACTIVE` | 11 | Simultaneous diamonds on map |
| `DIAMOND_LIFETIME_MS` | 30 min | Diamond despawn timer |
| `BOOST_DURATION_MS` | 1 hour | Per-activation boost length |
| `BOOST_MAX_BANK_MS` | 6 hours | Max banked boost time |
| `EVENT_50X_DURATION_MS` | 24 hours | 50X event window |
| `EVENT_50X_COOLDOWN_MS` | 72 hours | Time between 50X events |

### Plot Rarities

Rates below are the current values after the 2026-10-08 rebalance (all rates cut
to bring maximum payout liability under ad ARPU). Server mirror:
`functions/index.js` `PLOT_RARITY_RATE_MAP` -- the two must stay identical.

| Rarity | Drop % | Rent/Second | Color |
|---|---|---|---|
| Common | 50% | $0.0000000004/s | Slate Grey |
| Rare | 30% | $0.000000001214/s | Cyan Blue |
| Epic | 15% | $0.0000000036825/s | Royal Purple |
| Legendary | 5% | $0.000000011165/s | Radiant Gold |

### Boost Tier Scaling (Anti-Whale)

`tierFactor` is relative to the base multiplier, which is **20X** (or **50X**
during a Super Boost event) after the 2026-10-08 rebalance.

| Plots Owned | tierFactor | Effective (20X / 50X) |
|---|---|---|
| 0 -- 150 | 1.00 | 20X / 50X |
| 151 -- 220 | 0.67 | 13X / 33X |
| 221 -- 290 | 0.50 | 10X / 25X |
| 291 -- 365 | 0.40 | 8X / 20X |
| 366 -- 730 | 0.30 | 6X / 15X |
| 731 -- 1500 | 0.20 | 4X / 10X |
| 1501+ | 0.067 | 1.3X / 3.4X |

---

## Reward Points & the Rewards Program

Reward Points (**RP**) are the loyalty currency and the **only** thing redeemable
for real money. In-game `cash` is entertainment-only ("Realm Coins") and is no
longer a redemption path.

| Rule | Value |
|---|---|
| Exchange rate | **100 RP = $1.00** (1 RP = $0.01, integer points) |
| Earned from | Daily login ladder, daily quests, achievements |
| Never earned from | The Diamond Wheel, lucky plot drops, any chance outcome |
| Per-player cap | $5.00 per calendar month (500 RP) |
| Global program caps | Monthly and yearly budgets, enforced server-side |
| Eligibility | 18+, phone-verified, verified region, account 90+ days old |

The whole point of the split is that **a prize must not be reachable through
chance**. The Diamond Wheel pays EB and diamonds only; plots cost 100 EB and EB
comes from the wheel, so land purchases and plot ascension award **EB only**, no
RP. See `FINANCIALPLAN.md` for the full reasoning.

Redemptions are additionally gated behind a **Treasury Goal**: they unlock for
everyone only once the Realm's ad revenue covers the program's payout budget.
The unlock is decided once per calendar month and holds for the rest of that
month, so it cannot flap open and closed. Progress is shown on the cashout
screen, in the Weekly Realm Treasury, and as feed milestones at 50% / 80% /
unlocked.

Server-enforced limits live in `functions/index.js` (`WITHDRAWAL_*`,
`RP_DAILY_GLOBAL_CAP`, `RP_DAILY_SOURCE_CAPS`) and are mirrored in
`js/config.js`. Full policy text: **[Rewards Program Terms](rewards-terms.html)**.

## Citadel Hold Limits

Holding a citadel accrues EB and diamonds. Three limits keep that bounded --
all constants at the top of `functions/index.js`:

| Limit | Value | Why |
|---|---|---|
| Spoils accrual cap | 24h of holding | "Defend for a month" pays the same as "defend for a day" |
| Minimum hold before recall | 30 min | Blocks station/recall churn |
| Re-station cooldown after recall | 30 min | Blocks station -> recall -> station loops |
| Daily spoils cap | 150 EB + 60 diamonds | Holding many citadels cannot compound |

The conquest bounty draws from the same daily pool. Everything is enforced in
`recallCitadel` / `citadelAction` / `conquerCitadel`; the citadel modal shows the
rules and a live daily tally.

## Documentation

| File | What it covers |
|---|---|
| [CHANGELOG.md](CHANGELOG.md) | Full change history with rationale |
| [FINANCIALPLAN.md](FINANCIALPLAN.md) | Play Store readiness: Rewards Program design, compliance, and what to change |
| [PLAY-LISTING.md](PLAY-LISTING.md) | Store listing copy, content-rating answers, Data Safety table |
| [rewards-terms.html](rewards-terms.html) | Rewards Program Terms (player-facing) |
| [privacy.html](privacy.html) | Privacy Policy (player-facing) |
| [docs/game-guide.md](docs/game-guide.md) | In-game feature guide |

Deploying Cloud Functions: use **`./deploy-functions.sh`** rather than
`firebase deploy` directly. Any edit to `functions/index.js` redeploys all
functions at once and one usually falls out of the batch with a transient GCP
error; the script retries only the failures.

---

## 3D Assets & Attributions

- **Character Models:** Mixamo / Adobe (CC0 / Royalty Free)
- **CesiumMan & Xbot:** Khronos Group & Three.js Official Samples
- **Grass Yellowing:** Steve B [CC-BY] via Poly Pizza
- **White Dandelions:** Aeres Vistaas [CC-BY] via Poly Pizza
- **Pine Tree & Autumn Foliage:** Quaternius [CC0]
- **Mushrooms:** Jarlan Perez [CC-BY] via Poly Pizza
- **Twisted Tree & Bushes:** Quaternius [CC0]
- **RedMushroom:** arudira [CGTrader](https://www.cgtrader.com/designers/arudira?utm_source=credit)

---

## License

This is a personal, NOT open-source fan implementation of real-world grid collection games. Built from scratch with pure web standards for educational and entertainment purposes.
