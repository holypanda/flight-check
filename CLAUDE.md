# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build and Run Commands

- **Install Dependencies**: `npm install`
- **Start Server**: `npm start` (Express on port 3000)
- **Run Tests**: `npm test` (Jest — no tests implemented yet)

## Architecture

Flight Price Monitor for HKG ↔ Tokyo weekend trips. Node.js/Express backend with vanilla JS frontend (Chinese-language UI).

### Data Flow

```
Frontend (public/) → Express API (server.js) → Services → External APIs
                                                  ├── flightSearch.js  → flightapi.js → FlightAPI.io REST API
                                                  ├── weather.js       → Open-Meteo API (no key needed)
                                                  └── storage.js       → data/prices.json, data/config.json
```

1. User enters FlightAPI.io key via web UI → validated and stored in `data/config.json`
2. Manual refresh triggers `flightSearch.searchWeekendFlights()` which generates Fri→Sun pairs for the next 30 days
3. For each weekend: searches 4 airport combos (HKG↔HND, HKG↔NRT, and mixed-airport returns), finds cheapest outbound+return pairing
4. Results enriched with Open-Meteo weather/snow data for Yuzawa (ski conditions)
5. Snapshot appended to `data/prices.json` (max 100 entries)
6. Frontend renders price chart (Chart.js) and flight table with copy-to-clipboard

### Key Services

- **flightSearch.js** — Orchestrates multi-airport weekend searches, filters by airline (UO/Hong Kong Express) and departure time (after 19:55), combines cheapest outbound+return
- **flightapi.js** — FlightAPI.io client; parses Skyscanner-format responses (legs, segments, places, carriers maps)
- **weather.js** — Open-Meteo integration with WMO weather code interpretation and 5-level snow condition rating
- **storage.js** — JSON file persistence for prices and config
- **scheduler.js** — Cron scheduler (currently disabled, manual trigger only)
- **ctrip.js / ctrip_crawler.py** — Legacy Ctrip Selenium crawler (disabled, replaced by FlightAPI.io)

### API Endpoints

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/prices` | All price history snapshots |
| DELETE | `/api/prices/:id` | Delete a snapshot |
| GET | `/api/config` | Check if API key is configured |
| POST | `/api/config` | Save and validate FlightAPI key |
| DELETE | `/api/config` | Remove API key |
| POST | `/api/refresh` | Trigger flight search |
| GET | `/api/weather?dates=YYYY-MM-DD,...` | Weather forecasts |
| POST | `/api/test-connection` | Validate API key |

### Search Constraints

- **Routes**: HKG ↔ HND, HKG ↔ NRT (including mixed-airport returns)
- **Schedule**: Friday departure, Sunday return
- **Range**: Next 30 days of weekends
- **Airline filter**: UO (Hong Kong Express)
- **Departure filter**: After 19:55
- **Currency**: HKD

## Code Patterns

- Async/await throughout with try/catch error handling
- Console logging with prefixes: `[FlightAPI]`, `[FlightSearch]`, `[Refresh]`
- Frontend uses vanilla JS with event listeners, no framework
- Clipboard API with `execCommand('copy')` fallback
- `isRefreshing` flag prevents duplicate search submissions
