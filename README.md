# Camping Ground Booker

A **Chrome/Edge browser extension** that automatically books camping spots on **Alberta Parks** and **BC Parks** reservation websites the moment a booking window opens — without getting rate-limit blocked. It also integrates with **Google Calendar** so you always get a reminder before the window opens.

# This thing is ass, need to rework it to actually work, it don't need so much automation, just the ability to kinda spam the booking for you

---

## Features

| Feature | Description |
|---|---|
| **Auto-booking** | Fills and submits the booking form automatically when a site becomes available. |
| **Smart rate limiting** | Token-bucket algorithm + exponential backoff with jitter to stay under site limits. |
| **Booking-window scheduler** | Knows when Alberta (90 days ahead, midnight MST) and BC (4 months ahead, 07:00 PST) windows open. Starts checking minutes before they do. |
| **Google Calendar integration** | Creates a calendar event with 5 min, 30 min, and 1 hr reminders for every booking window. |
| **Desktop notifications** | Notifies you when a site is available or a booking succeeds/fails. |
| **Multi-booking queue** | Schedule as many campsites as you want simultaneously. |

---

## Supported websites

| Province | URL |
|---|---|
| Alberta Parks | `https://reservations.albertaparks.ca/` |
| BC Parks | `https://camping.bcparks.ca/` |

---

## Project structure

```
camping-ground-booker/
├── manifest.json               Chrome extension manifest (MV3)
├── src/
│   ├── background/
│   │   └── service-worker.js   Alarm scheduling & message orchestration
│   ├── content/
│   │   ├── common.js           Shared DOM utilities (banner, waitForEl, …)
│   │   ├── alberta.js          Alberta Parks booking flow
│   │   └── bc.js               BC Parks booking flow
│   ├── popup/
│   │   ├── popup.html          Extension popup UI
│   │   ├── popup.js
│   │   └── popup.css
│   ├── options/
│   │   ├── options.html        Settings page
│   │   ├── options.js
│   │   └── options.css
│   └── utils/
│       ├── rateLimiter.js      Token bucket + exponential backoff
│       ├── scheduler.js        Booking-window date calculations
│       ├── googleCalendar.js   Google Calendar API helper
│       └── storage.js          chrome.storage wrapper
└── tests/
    ├── rateLimiter.test.js
    ├── scheduler.test.js
    └── googleCalendar.test.js
```

---

## Installation (development)

1. **Clone** the repository and install dev dependencies:
   ```bash
   git clone https://github.com/korih/camping-ground-booker.git
   cd camping-ground-booker
   npm install
   ```

2. **Run the tests** to verify everything works:
   ```bash
   npm test
   ```

3. **Load in Chrome / Edge**:
   - Open `chrome://extensions` (or `edge://extensions`).
   - Enable **Developer mode**.
   - Click **Load unpacked** and select the repository root folder.

---

## Google Calendar setup

1. Open the extension's **Settings** page (⚙️ button in the popup).
2. Enable **Google Calendar reminders**.
3. Click **Connect Google Account** and grant calendar access.
4. Optionally enter a specific **Calendar ID** (default: your primary calendar).

> **Important**: Before the first use you must add your Google OAuth2 Client ID
> to `manifest.json` under `"oauth2" > "client_id"`.  Create a project at
> [console.cloud.google.com](https://console.cloud.google.com), enable the
> **Google Calendar API**, and create OAuth2 credentials of type
> *Chrome Extension*.

---

## How it works

1. **Add a booking** in the popup — campsite name, province, arrival date, number of nights, and party size.
2. The service worker calculates when the booking window opens and **schedules a Chrome alarm** for that time (minus 2 minutes).
3. If Google Calendar is connected, a **calendar event with reminders** is created automatically.
4. When the alarm fires the extension opens the correct reservation website, the content script **waits for the exact moment the window opens**, then begins checking for availability.
5. The built-in **rate limiter** ensures requests are spaced ≥ 2 seconds apart and backs off exponentially if the server returns HTTP 429.
6. Once a site is available the extension **notifies you** (and auto-books if you have that option enabled).

---

## Settings

| Setting | Default | Description |
|---|---|---|
| Auto-book | Off | Automatically fill and submit the booking form. |
| Notify on availability | On | Desktop notification when a site opens up. |
| Check interval | 5 s | How often to check availability once the window is open. |
| Max check duration | 30 min | Stop checking after this many minutes. |
| Google Calendar | Off | Create calendar reminders for booking windows. |

---

## Contributing

Selector maps in `src/content/alberta.js` and `src/content/bc.js` may need
updating if either reservation site changes its HTML structure.  Look for the
`SELECTORS` constant near the top of each file.

---

## License

MIT

