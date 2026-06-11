[README.md](https://github.com/user-attachments/files/28831449/README.md)
# Digital Catalyst — Production Tracker

A premium dark-mode dashboard for tracking video editing projects and revenue. Automatically reads from your Google Sheet — no backend, no API key, deploys directly to GitHub Pages.

---

## Features

- **Live data** from Google Sheets via the Visualization API (public sheet, no key needed)
- **Dashboard** with KPI cards, monthly summaries, client performance, and spotlight stats
- **Projects table** with search, filter by client/month/payment/status, sort, and pagination
- **Analytics** with revenue-by-month, videos-by-month, paid vs unpaid, and client breakdown charts
- **CSV export** of any filtered view
- Fully responsive — works on desktop, tablet, and mobile

---

## Google Sheet Setup

The tracker reads from this sheet:
`https://docs.google.com/spreadsheets/d/1mqll7u7E03w_cbUTb6lKR1EjoepupjjFrHxHLNltUBk`

**The sheet must be publicly readable.**  
Go to: Share → Anyone with the link → Viewer.

### Expected column layout (per tab):
| A | B | C | D | E | F | G |
|---|---|---|---|---|---|---|
| DATE | Amount | Project Name | *(empty)* | For Checking | Revised Version | Paid |

### Configured tabs:
`DC`, `Jeya`, `L&S`, `LHF`, `Boney`, `Aida`, `AMmarket`, `Chef`, `Goreng`, `Mavi`, `Saddam`

To change the sheet or tabs, edit `script.js`:
```js
const CONFIG = {
  SHEET_ID: 'YOUR_SHEET_ID_HERE',
  TABS: ['Tab1', 'Tab2', ...],
  ROWS_PER_PAGE: 25,
};
```

---

## GitHub Pages Deployment

1. **Create a new GitHub repository** (public)  
   e.g. `username/production-tracker`

2. **Upload the three files:**
   - `index.html`
   - `style.css`
   - `script.js`

3. **Go to Settings → Pages**

4. **Under "Build and deployment":**  
   Source → Deploy from a branch  
   Branch → `main` → `/ (root)` → Save

5. **Wait ~60 seconds**, then visit:  
   `https://username.github.io/production-tracker`

---

## Local Development

No build step needed. Just open `index.html` in a browser.  
Note: If the sheet fetch fails locally due to CORS, use a local server:

```bash
npx serve .
# or
python3 -m http.server 8000
```

---

## Status Logic

| Status | Condition |
|--------|-----------|
| **Completed** | Revised Version column has content |
| **In Review** | For Checking column has content |
| **Pending** | Neither column has content |
| **Paid** | Paid column has a date |
| **Unpaid** | Paid column is empty |

---

## Tech Stack

- Vanilla HTML / CSS / JavaScript (no framework)
- [Chart.js 4](https://www.chartjs.org/) for analytics
- [Inter](https://fonts.google.com/specimen/Inter) from Google Fonts
- Google Sheets Visualization API (JSONP, no API key)
