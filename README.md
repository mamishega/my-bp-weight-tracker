# My BP & Weight Tracker

A private, local-first, installable web app for recording blood pressure (before medication, after medication and evening), morning medication doses and supply, weight, symptoms, lifestyle context and habit goals. It also produces weekly reviews and printable appointment reports.

Built with React, TypeScript, Tailwind CSS, Recharts and IndexedDB (via `idb`).

> This app records personal information. It does not diagnose conditions, replace medical care or provide continuous monitoring. It cannot contact emergency services. **For urgent symptoms call Triple Zero (000).**

## Setup

You need Node.js 20 or later.

```bash
npm install
npm run dev        # development server at http://localhost:5173 (service worker disabled in dev)
npm test           # unit + component tests (Vitest, fake IndexedDB, Testing Library)
npm run typecheck  # TypeScript strict check
npm run build      # production build in dist/ (includes generated service worker)
npm run preview    # serve the production build at http://localhost:4173
npm run icons      # regenerate PNG app icons (already committed in public/icons)
npm run theme      # regenerate src/theme-dark.css from the Tailwind palette
npm run check:a11y # real-browser accessibility check (needs `npm run preview` running and Chrome)
```

### Deploying

`dist/` is a static site with relative paths, so it can be hosted from any HTTPS static host or sub-folder (Netlify, GitHub Pages, Cloudflare Pages, or your own server). **The service worker, installability and offline use need HTTPS** (or `localhost`). The app makes no network requests apart from loading its own files. It has no server, accounts or analytics. A Content-Security-Policy in `index.html` restricts connections to the app's own origin.

### Install on a phone

- **iPhone/iPad (Safari):** Share → *Add to Home Screen*.
- **Android (Chrome):** ⋮ menu → *Install app* / *Add to Home screen*.
- **Desktop (Chrome/Edge):** install icon in the address bar.

On some platforms (notably iOS) the installed app and the browser keep **separate storage**. Back up before switching.

## Pages

| Page | What it does |
|---|---|
| Dashboard | Today's date. Cards for morning before-med, morning after-med, evening and weight (large numbers, completion badges, quick entry). A medication card showing **Not recorded / Taken / Skipped**, today's habits, supply warnings, last backup and **Back up now**. |
| Add Reading | Session type (always your choice, never auto-relabelled by clock time), date and actual time, two readings one minute apart or a clearly labelled single reading, live session average, optional 5-min rest and 1-min interval timers. Arm/monitor with saved defaults, measurement-condition flags, symptoms and notes (collapsed), dose linking with actual elapsed time, unusual-value confirmation, duplicate warning, and a "session day" for readings after midnight. |
| Medication & Supply | Multiple medicines, dose/time/instructions, prescription history kept on every change, taken/skipped records with actual time (or *Medication time unknown*), 14-day record grid, after-medication reminder interval (you enter it from your clinician; never suggested). Estimated supply with manual counts and refills. |
| Weight | kg or lb (original entry preserved), start, current, goal, optional target date, change since start, remaining to goal, 7-day moving average with contributing-day counts, milestones, history, chart. |
| Symptoms & Lifestyle | Urgent guidance shown **above** the form. Symptoms diary (severity, duration, related reading/dose, actions taken). Optional daily context (sleep, stress, activity, caffeine, alcohol, salty meals, illness, tags). Habit goals that celebrate completed actions. |
| Trends & Weekly Review | 7/30/90-day and custom ranges. Systolic, diastolic and weight charts on a shared date axis, with colours, symbols and labels per session type. Separate summary statistics per session type with sample counts. Before/after **observed differences**, medication recording history, lifestyle context, table alternative. Weekly review. |
| History & Reports | Editable history filtered by date, record type and session type, plus a data-quality filter. CSV exports. Report builder with optional-content checkboxes → printable preview → *Print / Save as PDF*. |
| Appointments | Upcoming/past appointments, questions for your doctor (mark as discussed), *Prepare report*. |
| Settings & Backups | JSON backup, validated restore with preview and merge/replace, time zone, units, personal targets from your clinician, monitors/cuffs, reminders and notifications, privacy and storage, demo mode, delete all data, install instructions. |

## Design decisions on health and safety

### Sources (checked 1 November 2026, review due 1 May 2027)

Defined in `src/lib/guidance.ts` and shown in the app with links:

- healthdirect, *Blood pressure monitoring at home* (reviewed Dec 2024): rest 5 minutes; avoid caffeine and smoking for 30 minutes; bare upper arm at heart level; validated upper-arm monitor; **two readings one minute apart, record both**; morning and evening for 7 days (at least 5); measure before taking medicine; helpline 1800 022 222.
- healthdirect, *High blood pressure (hypertension)* (reviewed Nov 2024): symptoms of very high blood pressure that need emergency care (headache at the back of the head, vomiting, eyesight problems, confusion, seizures, chest pain, shortness of breath). Go to ED or call 000.
- Heart Foundation, *Heart attack warning signs* (reviewed Jan 2024, updated Sep 2026).
- Stroke Foundation, *Signs of stroke* (F.A.S.T.; call 000 even if signs go away).
- RACGP *Australian Family Physician* 2016, *How to measure home blood pressure*.

### No number-based emergency alarm

None of the Australian consumer sources above gives a blood pressure number that, on its own, means "call 000". So the app **does not raise emergency alerts from numbers**. Urgent guidance is based on symptoms, is always visible (dashboard, symptoms page, reading form) and does not depend on your personal targets. Personal targets and "contact my clinician above X" levels are only what **you** enter from your clinician's advice. No default target is assumed.

### Wording rules

- The app never advises delaying, repeating, skipping, stopping or changing a dose.
- Unrecorded doses are always *Not recorded*, never "missed". Nothing is marked as taken automatically.
- Before/after comparisons are labelled *observed differences*. Charts state that changes occurring together don't show cause and effect. Lifestyle tags are shown as context only.
- Weekly reviews don't label weeks good or bad. Habits celebrate completed actions, not lower readings or weight.
- No calorie advice, rates of weight loss, fasting rewards or encouragement to measure more often.

## Data model and calculations

- Typed models in `src/types.ts`. Every timed record stores a UTC instant, its **IANA time zone** and **UTC offset**, plus a separate user-assigned calendar `date`. Grouping uses that `date`, so an evening reading at 00:20 can belong to the previous day without its real time changing.
- Time-zone conversion (`src/lib/time.ts`) uses `Intl` and handles DST gaps (flagged and shown to you) and repeated hours (earliest instant chosen and flagged).
- **Session average** = mean of that session's original readings (both originals always kept). **Period average** = mean of session averages, per session type, with each session weighted equally. Session types are never combined. Missing days are skipped, never treated as zero.
- **Weight moving average** = mean of daily values over the calendar window [day−6, day], using only days with a measurement. The contributing-day count is shown.
- **Supply estimate** = latest manual count + refills since − units of doses **recorded as taken** after the count. It is recalculated from current records every time, so edits and deletions can't double count. It is labelled as an estimate and kept separate from dose history.
- **Duplicates** are flagged (same session type, same first reading within 15 min, or identical time) and never removed.

## Storage, privacy and backups

- IndexedDB, in this browser only. No sync between devices. Clearing site data deletes records. The app can ask the browser for persistent storage, which is not a guarantee.
- **Optional passcode lock (Settings → Passcode lock).** When on, every record and the settings are encrypted in IndexedDB with AES-256-GCM. The key is derived from your passcode with PBKDF2-SHA-256 (310,000 iterations) and held only in memory while unlocked. The app locks on reload and after 5 minutes in the background. The lock screen keeps urgent guidance visible. **A forgotten passcode can't be recovered.** The only option is to erase and restore from a backup. Without the lock, storage is not encrypted. Exported JSON, CSV, calendar and PDF files are never encrypted and contain sensitive health information.
- **Backup** is one JSON file with every record (IDs, timestamps, time zones), settings and medication history. *Last successful backup* only updates when the file is confirmed saved. With the File System Access API (Chrome/Edge desktop), save and cancel are detected. Elsewhere, the browser download can't report success, so the app asks you to confirm the file saved.
- **Restore** validates the file and shows a per-type preview (new / identical / same-ID conflicts / possible duplicates). **Merge** (choose how to handle conflicts, duplicates and settings) or **Replace** (type REPLACE to confirm).
- **Demo mode** uses a separate IndexedDB database (`my-bp-weight-tracker-DEMO`). All sample content is labelled SAMPLE. Demo backups are refused by personal restore, and vice versa.
- **Delete all data** requires typing DELETE.

## Offline and updates

The build generates `sw.js`, which precaches the full app shell on first load. After that the app opens, records, edits and reviews offline (records are in IndexedDB, not the network). An offline banner is shown. App updates are never applied automatically: a banner offers **Update now**, and if a form has unsaved changes you're warned first. Forms also warn before the page is closed with unsaved changes.

## Reminders: what needs extra infrastructure

In-app reminders (morning before-med, medication, after-medication timed from the **actual recorded dose time** + your clinician's interval, evening, optional weight days, refills/renewal, backups, appointments) appear while the app is open. Snooze and dismiss never mark anything as done. Browser notifications are requested **only** when you turn them on, and fire only while the app is open or running in a tab.

**Reminders while the app is closed:** *Settings → Reminders → Add reminders to my calendar (.ics)* exports your fixed-time reminders (morning reading, medication, evening, weight days) as repeating calendar events with alerts. Your phone's calendar then alerts you reliably even when the app is closed. Event titles are generic (no medication names or readings), because calendars often sync online. Reminders that depend on your records (after-medication timing, refills, backups, appointments) stay in-app. True push notifications from a closed web app would need **extra infrastructure** (a Web Push server, and on iOS an installed home-screen app). That is not implemented.

## Appearance and accessibility

- Light, dark, or match-device appearance (*Settings → General*). The dark theme is generated by mirroring the Tailwind palette (`scripts/gen-dark-theme.mjs`) and uses dark-tuned chart colours. Printing always uses the light theme.
- Unsaved-changes guard: leaving a page with a half-filled form asks before discarding it.
- `npm test` runs axe-core on every page with sample data. `npm run check:a11y` runs axe-core, including colour contrast, in real Chrome in light and dark mode at desktop and phone widths. Both run in the GitHub Actions workflow, and a violation stops the deploy.
- Secondary pages and the chart library are loaded on demand (main bundle 302 KB, 94 KB gzipped). The service worker still precaches every chunk, so offline use is unchanged.

## Testing

`npm test` runs 177 tests (all passing). Main areas:

| Area | File |
|---|---|
| Time zones, DST gap/repeat (Australia/Sydney 2026), midnight, grouping, week start | `src/test/time.test.ts` |
| Session averages, edits, validation (never alters or rejects high values), per-type statistics, before/after | `src/test/bp.test.ts` |
| Medication timing (elapsed, unknown, before-dose), history versions, supply after edits/deletes/corrections | `src/test/medication.test.ts` |
| Moving average without zero-filling, unit conversion, duplicates, quality flags | `src/test/weight-quality.test.ts` |
| Backup round-trip (IDs, timestamps, zones, settings, history), validation, merge/replace, demo/real refusal, CSV, IndexedDB persistence, demo separation, snooze/dismiss, after-dose reminder timing | `src/test/backup-storage.test.ts` |
| Accessible navigation, labelled form fields, error messages and focus, unusual-value confirmation, urgent guidance before the form, unsaved-changes guard, number inputs, lock screen | `src/test/ui.test.tsx` |
| Passcode lock: nothing readable at rest, wrong passcode rejected, decrypt on disable, erase | `src/test/crypto.test.ts` |
| Calendar export: time zone, repeat rules, alarms, no health details | `src/test/ics.test.ts` |
| axe-core on every page (plus a check that axe really detects violations) | `src/test/a11y.test.tsx`, `src/test/axe-sanity.test.tsx` |
| Guidance review date and source links | `src/test/guidance.test.ts` |

These were also checked against the production build in headless Chrome (1 Nov 2026): service worker control, **offline reload + saving a reading offline + persistence after reload**, demo data not appearing in personal history, no requests to any host other than the app's own, no console errors, and mobile and print layouts.

Manual checks still worth doing on your own devices: installing to the home screen, notification permission behaviour per browser, and the save/confirm backup flow on iOS.
