# Play Console — Store Listing & Data Safety

Ready-to-paste copy for the Google Play submission. Everything here is written
to match the "free-to-play rewards program" positioning in `FINANCIALPLAN.md`.
Do not deviate toward earnings language — see §7 of that document for the banned
words.

---

## 1. Store listing

**App title** (max 30 chars — this is 29)

    Elden Earth: Location Rewards

**Short description** (max 80 chars — this is 76)

    Free to play. Claim land, build your realm, earn Reward Points. No purchase.

**Full description**

    Elden Earth is a free-to-play location-based game. No purchase is necessary,
    and nothing can be bought, staked or wagered.

    EXPLORE AND CLAIM
    Walk your city, claim land plots, and watch your territory grow on a live
    world map. Plots generate passive in-game income while you play.

    BUILD YOUR REALM
    Upgrade plots, plant Elden Stop beacons, take and hold citadels, and climb
    the ranks from Mayor to Governor to President.

    PLAY WITH OTHERS
    Trade plots, gift friends, join the weekly Realm Treasury, and take part in
    global community challenges.

    SMALL REWARDS, EARNED BY PLAYING
    Earn Reward Points through activity — daily logins, quests, exploring and
    building. Reward Points are a loyalty thank-you, not earnings, and are never
    awarded for chance outcomes. Redeem them for small PayPal rewards subject to
    eligibility, verification and monthly limits. 100 Reward Points = $1.00.

    EARNED, NOT WON
    The Earn Wheel and other randomised extras award in-game items only. Nothing
    determined by chance can ever be redeemed for real value.

    Free to play. No purchase necessary. Rewards availability varies by region.
    Redemptions are subject to age verification (18+), phone verification,
    account age, and monthly and global program limits. See the Rewards Program
    Terms in-game for full details.

**Notes for whoever writes the screenshots**

- Show gameplay and the map. Do **not** screenshot balances or the rewards
  screen with a dollar figure on it.
- One panel is worth a plain "Free to play · No purchase necessary" card.
- If the rewards screen is shown at all, show the Reward Points balance and the
  progress bar — not a cash amount.
- **Compose against the current chrome.** The game now has a five-tab bottom bar
  (Land · Earn · Map · Events · Chat) and an Events hub listing the Global
  Challenge, Daily Progress and Weekly Treasury Pool. The cleanest shot is the
  map with the tab bar visible — it reads as a finished product and makes the
  navigation legible at thumbnail size.
- Avoid screenshots of the map at extreme zoom, where tile colours dominate and
  the HUD looks cluttered.

---

## 2. Content rating questionnaire

| Question | Answer |
|---|---|
| Violence | None / cartoon |
| Sexual content | None |
| Language | User-generated chat is present — declare unmoderated user text |
| Controlled substances | None |
| Gambling | **No** — there is no wagering of real money or real-money's worth. In-game randomised items have no monetary value and cannot be redeemed |
| Real-money gambling | **No** |
| Contests / sweepstakes | **No purchase necessary** loyalty rewards program |
| Share / buy digital goods | None purchasable |
| Location | Yes — the game is location-based |
| User interaction | Chat, gifting, trading — declare user-generated content and social features |

Expect **Teen** or above. The chat contains unmoderated user text, so declare it
and note that a profanity filter and a report feature exist.

---

## 3. Real-money declaration


> The app is a free-to-play location game with a loyalty rewards program.
> Players cannot deposit, purchase, stake or wager anything. Reward Points are
> earned through gameplay activity only and are never awarded for chance
> outcomes. Redemptions are small (capped at $5 per player per month and subject
> to a global monthly and yearly program limit), gated behind age (18+), phone
> and regional verification, and require no purchase at any point.


---

## 4. Data Safety section

Fill this in exactly. Inconsistency between this and the privacy policy is one
of the most common causes of rejection.

### Data collected

| Data type | Purpose | Shared? | Required? | Deletable? |
|---|---|---|---|---|
| **Location — precise (GPS)** | App functionality (land claiming, territory), Fraud prevention, Security | No | Yes | Yes |
| **Location — approximate (derived country/state)** | App functionality, Compliance | No | Yes | Yes |
| **Personal info — name (display name)** | App functionality | Yes — visible to other players in-game | Yes | Yes |
| **Personal info — email address** | Account management, Fraud prevention | No | Yes | Yes |
| **Personal info — date of birth** | Account management (age verification) | No | Yes | Yes |
| **Personal info — phone number** | Account management (verification), Fraud prevention | No | Optional — only needed to redeem | Yes |
| **Financial info — user payment info (PayPal address)** | App functionality (sending redemptions) | Yes — with PayPal to process payment | Optional | Yes |
| **Financial info — purchase history** (redemption history) | Account management, Fraud prevention | No | Yes | Yes |
| **App activity — in-app actions** | Analytics, App functionality | No | Yes | Yes |
| **App activity — other user-generated content (chat)** | App functionality | Yes — visible to other players in-game | Optional | Yes |
| **Photos and videos — user photos (avatars)** | App functionality | Yes — visible to other players in-game | Optional | Yes |
| **Device or other IDs** | Fraud prevention, Security | No | Yes | Yes |

### Data NOT collected

- Health and fitness
- Audio
- Files and documents
- Calendar
- Contacts

### Security practices

- Data is encrypted in transit (**Yes**)
- Data is encrypted at rest (**Yes** — Google Cloud / Firebase default)
- Users can request data deletion (**Yes**)
- Independent security review (**No**)

### Important consistency check

The following must be declared and must match `privacy.html` and
`rewards-terms.html`:

- Date of birth is collected and used for age gating
- Phone number is collected via Firebase Auth for redemption verification
- Location is used for redemption-region compliance, not just gameplay
- PayPal address is collected only if the player redeems, and is shared with
  PayPal solely to process the payment

---

## 4b. Graphics assets (generated — ready to upload)

| Asset | File | Status |
|---|---|---|
| App icon 512×512 (32-bit PNG) | `play-store/icon-512.png` | Ready |
| Feature graphic 1024×500 | `play-store/feature-graphic-1024x500.png` | Ready |
| Phone screenshots (min 2) | `play-store/screenshots/phone/` | **You must capture** — shot list in §4c |
| Tablet screenshots | only if you claim tablet support in the console | optional |

Launcher/adaptive icons for the APK itself are already generated into
`android/app/src/main/res/mipmap-*/` (replaces the old placeholder star).

### 4c. Screenshot shot list (capture on a 1080×1920+ phone)

Take these five, in this order, after signing in as a mid-level player.
Compose against the current five-tab chrome (Land · Earn · Map · Events · Chat).
Hide real names if you want, but keep it looking live.

1. **Map view** — you on the map, territory tiles visible, tab bar in shot.
2. **Land panel** — plot list / upgrades, no dollar figures anywhere.
3. **Events hub** — Global Challenge, Daily Progress, Weekly Treasury Pool cards.
4. **"Free to play · No purchase necessary" card** — can be a simple brand panel.
5. **Rewards screen** — Reward Points balance + progress bar ONLY. No cash amount.

Rules: never screenshot balances with a dollar figure, never show the redeem
form filled with an amount, no extreme zoom on the map, no debug/test screens.

## 5. Pre-submission checklist

Copy/policy items verified against the app on 2026-10-16 (in-app renames from
`FINANCIALPLAN.md` §7.3 are applied: the page is titled REWARDS, buttons say
Redeem Rewards / Redemption Amount, treasury bar says Redemptions Open/Locked).

- [x] Store listing contains "free to play" and "no purchase necessary"
- [x] No listing copy or screenshot implies earnings potential
- [x] No screenshot shows a large dollar balance
- [x] "Jackpot", "prize", "winnings", "withdraw", "payout", "get paid" do not
      appear anywhere in listing copy
- [x] In-app visible copy follows §7.3 renames
- [ ] Data Safety matches `privacy.html` line for line
- [ ] `rewards-terms.html` is reachable from the app and linked from the privacy
      policy
- [ ] Restricted-region account cannot reach PayPal redemption (tested)
- [ ] Account without a phone link cannot redeem (tested)
- [ ] Under-18 account cannot see the redeem UI (tested)
- [ ] Per-player and global caps demonstrably stop a request at the limit
- [ ] No chance mechanic awards anything redeemable (tested)
