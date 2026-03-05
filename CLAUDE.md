# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build, Lint, and Test Commands

This is a Node.js project with Python crawler:

- **Install Node Dependencies**: `npm install`
- **Install Python Dependencies**: `pip install selenium-wire selenium pandas`
- **Start Server**: `npm start` or `node server.js`
- **Run Tests**: `npm test` (if configured)

## Architecture and Structure

This is a Flight Price Monitor System that tracks flight prices using Ctrip (携程) web crawler.

### Directory Structure

```
flight-check/
├── server.js              # Express main server, API routes
├── services/
│   ├── ctrip.js           # Ctrip crawler integration
│   ├── ctrip_crawler.py   # Python crawler script (Selenium-based)
│   ├── scheduler.js       # Cron job for hourly price updates
│   └── storage.js         # JSON file persistence
├── public/                # Static frontend files
│   ├── index.html         # Main UI
│   ├── script.js          # Frontend logic, Chart.js visualization
│   └── style.css          # Styling
└── data/                  # Data storage (JSON files)
    ├── config.json        # Crawler configuration
    └── prices.json        # Price history snapshots
```

### Key Features

- **Route**: HKG (Hong Kong) ↔ HND (Tokyo Haneda)
- **Schedule**: Friday departure, Sunday return (weekend trips)
- **Range**: Next 3 months of weekends
- **Airline**: Hong Kong Airlines (香港航空) only
- **Departure Time**: After 10:00 AM only
- **Currency**: HKD (converted from CNY)
- **Update Frequency**: Every hour
- **Data Source**: Ctrip (携程) web scraping via Selenium

### Python Crawler Requirements

The crawler requires Python 3.6+ with the following packages:

```bash
pip install selenium-wire selenium pandas
```

Also requires Chrome/Chromium browser and ChromeDriver installed.

### API Endpoints

- `GET /api/prices` - Get all price snapshots
- `DELETE /api/prices/:id` - Delete a specific snapshot
- `GET /api/config` - Get crawler status
- `POST /api/config` - Enable crawler and trigger search
- `DELETE /api/config` - Disable crawler
- `POST /api/refresh` - Manual price refresh

### Data Model

Price snapshot:
```json
{
  "id": "unique-id",
  "timestamp": "2026-03-04T06:28:19.293Z",
  "prices": [
    {
      "route": "HKG-HND",
      "from": "HKG",
      "to": "HND",
      "price": 301.52,
      "currency": "HKD",
      "date": "2026-03-06",
      "returnDate": "2026-03-08",
      "airline": "国泰航空",
      "flightNumber": "CX500",
      "returnFlightNumber": "CX501",
      "departureTime": "08:30",
      "arrivalTime": "12:45",
      "duration": "4h 15m",
      "bookingUrl": "https://flights.ctrip.com/online/list/roundtrip-香港-东京?depdate=2026-03-06_2026-03-08",
      "outboundBookingUrl": "https://flights.ctrip.com/online/list/oneway-香港-东京?depdate=2026-03-06",
      "returnBookingUrl": "https://flights.ctrip.com/online/list/oneway-东京-香港?depdate=2026-03-08",
      "source": "ctrip"
    }
  ]
}
```

### New Fields

- `flightNumber`: 去程航班号
- `returnFlightNumber`: 返程航班号
- `departureTime`: 出发时间
- `arrivalTime`: 到达时间
- `duration`: 飞行时长
- `bookingUrl`: 往返组合购票链接
- `outboundBookingUrl`: 去程购票链接
- `returnBookingUrl`: 返程购票链接

### Crawler Fallback

If the Python crawler fails (e.g., due to missing dependencies or Ctrip blocking), it automatically falls back to mock data for demonstration purposes.

## Code Style Guidelines

- Use async/await for asynchronous operations
- Use try/catch for error handling
- Console.log for operational logging
- Return consistent JSON responses from APIs
- Python crawler outputs JSON to stdout for Node.js parsing
