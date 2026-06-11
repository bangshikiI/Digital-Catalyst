[README.md](https://github.com/user-attachments/files/28833956/README.md)
# Digital Catalyst — Production Tracker

A premium dark-mode dashboard for tracking video editing projects and revenue. Reads live from your Google Sheet — no backend, no API key, deploys directly to GitHub Pages.

---

## Features

- **Live data** from Google Sheets via published CSV (no API key needed)
- **Dashboard** with KPI cards, monthly summaries, client performance, and spotlight stats
- **Projects table** with search, filter by client/month/payment/status, sort, and pagination
- **Analytics** with revenue-by-month, videos-by-month, paid vs unpaid, and client breakdown charts
- **CSV export** of any filtered view
- Fully responsive — works on desktop, tablet, and mobile

---

## Google Sheet Setup

The tracker reads from your published Google Sheet.

### Step 1 — Publish the sheet to the web

In Google Sheets: **File → Share → Publish to web → Publish**

This is different from "Share with anyone" — the sheet must be published via **Publish to web** for the CSV export to work.

### Step 2 — Get your Sheet ID

After publishing, your sheet will have a URL like:

```
https://docs.google.com/spreadsheets/d/e/YOUR_SHEET_ID_HERE/pubhtml
```

Copy the long ID between `/e/` and `/pubhtml`.

### Step 3 — Update the config in `script.js`

```js
const CONFIG = {
  SHEET_ID: 'YOUR_SHEET_ID_HERE',   // the long ID from the /e/ URL
  TABS: ['DC', 'Jeya', 'L&S', ...], // must match your tab names exactly
  ROWS_PER_PAGE: 25,
  GID_MAP: {
    'DC': 0,       // gid = sheet index (0-based)
    'Jeya': 1,
    'L&S': 2,
    // add all tabs here
  },
};
```

> **Finding the gid for each tab:** Click a tab in Google Sheets — the URL will show `#gid=XXXXXXX`. Use that number in the `GID_MAP`. If tabs are in order with no deletions, they'll be 0, 1, 2, 3…

---

## Expected Column Layout (per tab)

| A    | B      | C            | D        | E            | F               | G    |
|------|--------|--------------|----------|--------------|-----------------|------|
| DATE | Amount | Project Name | *(empty)*| For Checking | Revised Version | Paid |

- **Date (A)** — any format containing a month name works (e.g. `Jan 5`, `January 2025`, `2025-01-05`)
- **Amount (B)** — numeric, with or without `$` or commas (e.g. `1500`, `$1,500.00`)
- **For Checking (E)** — any content marks the project as "In Review"
- **Revised Version (F)** — any content marks the project as "Completed / Exported"
- **Paid (G)** — any content (typically a date) marks the project as paid

Row 1 is treated as a header and skipped automatically.

---

## Configured Tabs

```
DC, Jeya, L&S, LHF, Boney, Aida, AMmarket, Chef, Goreng, Mavi, Saddam
```

To add, remove, or rename tabs, update both `TABS` and `GID_MAP` in `script.js`.

---

## GitHub Pages Deployment

1. **Create a new GitHub repository** (public), e.g. `username/production-tracker`
2. **Upload the three files:**
   - `index.html`
   - `style.css`
   - `script.js`
3. **Go to Settings → Pages**
4. **Under "Build and deployment":**
   Source → Deploy from a branch → `main` → `/ (root)` → Save
5. **Wait ~60 seconds**, then visit:
   `https://username.github.io/production-tracker`

---

## Local Development

No build step needed. Open `index.html` in a browser.

If the sheet fetch fails locally due to CORS, use a local server:

```bash
npx serve .
# or
python3 -m http.server 8000
```

---

## Status Logic

| Status        | Condition                          |
|---------------|------------------------------------|
| **Completed** | Revised Version column has content |
| **In Review** | For Checking column has content    |
| **Pending**   | Neither column has content         |
| **Paid**      | Paid column has any content        |
| **Unpaid**    | Paid column is empty               |

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| "Could not load sheet data" | Make sure you used **File → Publish to web**, not just "Share with anyone" |
| Data loads for some tabs but not others | Check each tab's `gid` in `GID_MAP` — click the tab in Sheets and read `#gid=` from the URL |
| Amounts show as `—` or `$0.00` | Ensure the Amount column (B) contains plain numbers — remove any text like "peso" or extra spaces |
| Month shows as "Unknown" | Date in column A must contain a recognizable month name or ISO date format |
| Tab name with `&` not loading | Make sure `TABS` and `GID_MAP` use the exact tab name, e.g. `'L&S'` |

---

## Tech Stack

- Vanilla HTML / CSS / JavaScript (no framework)
- [Chart.js 4](https://www.chartjs.org/) for analytics charts
- [Inter](https://fonts.google.com/specimen/Inter) from Google Fonts
- Google Sheets published CSV export (no API key required)
