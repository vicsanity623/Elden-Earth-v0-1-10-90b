# Play Console — Store Listing & Data Safety

Ready-to-paste copy for the Google Play submission. Everything here is written
to match the "free-to-play rewards program" positioning in `FINANCIALPLAN.md`.
Do not deviate toward earnings language — see §7 of that document for the banned
words.

---

## 1. Store listing

**App title**

    Elden Earth — Location Rewards Game

**Short description** (max 80 chars)

    Free to play. Claim land, build your realm, earn small rewards. No purchase.

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
| **Personal info — phone number** | Account management (verification), Fraud prevention | No | Yes | Yes |
| **Financial info — user payment info (PayPal address)** | App functionality (sending redemptions) | Yes — with PayPal to process payment | Optional | Yes |
| **Financial info — purchase history** (redemption history) | Account management, Fraud prevention | No | Yes | Yes |
| **App activity — in-app actions** | Analytics, App functionality | No | Yes | Yes |
| **App activity — other user-generated content (chat)** | App functionality | Yes — visible to other players in-game | Optional | Yes |
| **Device or other IDs** | Fraud prevention, Security | No | Yes | Yes |

### Data NOT collected

- Health and fitness
- Photos and video (avatars are optional and reviewed before display)
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

## 5. Pre-submission checklist

- [ ] Store listing contains "free to play" and "no purchase necessary"
- [ ] No listing copy or screenshot implies earnings potential
- [ ] No screenshot shows a large dollar balance
- [ ] "Jackpot", "prize", "winnings", "withdraw", "payout", "get paid" do not
      appear anywhere in listing copy
- [ ] Data Safety matches `privacy.html` line for line
- [ ] `rewards-terms.html` is reachable from the app and linked from the privacy
      policy
- [ ] Restricted-region account cannot reach PayPal redemption (tested)
- [ ] Account without a phone link cannot redeem (tested)
- [ ] Under-18 account cannot see the redeem UI (tested)
- [ ] Per-player and global caps demonstrably stop a request at the limit
- [ ] No chance mechanic awards anything redeemable (tested)
