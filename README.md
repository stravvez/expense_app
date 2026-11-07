# Paisa Tracker

Android app that tracks Google Pay spending **automatically**, with no imports. It reads the Union Bank
SMS alert and the Google Pay notification that arrive with every UPI payment, merges the two into one
transaction, assigns a category, and keeps everything on the phone in SQLite.

## How capture works

```
SMS_RECEIVED ─┐                                ┌─ live: onCaptured event → drain (app alive)
              ├─▶ native queue (SQLite, Kotlin)┼─ app resume → drain
GPay notif ───┤   modules/txn-capture
GPay screen ──┘   (accessibility, GPay only)          └─ background task (~15 min) → drain + alert
                                   drain → parse → merge (UPI ref / amount±5min) → categorize → save
```

- `modules/txn-capture/` is a local Expo module in Kotlin: an SMS receiver, a notification listener, an accessibility service that reads only GPay’s payment-successful and payment-details screens, a durable queue and an inbox reader
- `src/core/` holds the pure, unit-tested logic: parsers, merge, categorizer, splits/balances
- `src/capture/pipeline.ts` drains the queue, backfills from the inbox and is idempotent (re-runs are safe)
- `src/app/` holds the screens (expo-router)

## Build & install (needs a development build or APK, not Expo Go)

```sh
npm install
npx eas-cli@latest login                                     # free Expo account
npx eas-cli@latest build -p android --profile preview        # standalone APK, use this day to day
# or, for development with hot reload:
npx eas-cli@latest build -p android --profile development && npm start
```

Install the APK on your phone. On first launch the setup screen walks you through:
SMS permission → Notification access → GPay screen reading (Accessibility) → battery exemption → alert permission → importing past months.
On Xiaomi/Oppo/Vivo/Realme phones, also turn on **Autostart** for the app.

## Checks

```sh
npm test            # parser / merge / categorizer / split tests
npm run typecheck
npx expo lint
```

## Improving the SMS parser

Bank SMS formats change. Any bank message the app can't read shows up under **Settings → Needs review**.
Copy a few of these (mask the account number) into `src/core/__tests__/parsers.test.ts`, adjust
`src/core/parsers/bankSms.ts` until the tests pass, then rebuild.
