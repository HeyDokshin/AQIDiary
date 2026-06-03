# AQ Diary

A local web platform for writing diary entries tied to the air you breathe.

You type. You send. The text melts — more or less — depending on the air quality index at your location at the moment of writing.

---

## How it works

**Input** (`/`) — a full-screen writing canvas. The browser asks for your location, fetches the live AQI, and applies a real-time melt/drip shader to the text as you type. Press **Enter** to submit. The entry is timestamped and stored with your city and AQI value. Submission is blocked until location is resolved.

**Output** (`/output`) — a scrollable display of all submitted entries. Each message is rendered independently with its own shader intensity, set by the AQI that was recorded when it was written. High pollution = more distortion. New entries appear at the top. The page polls every 3 seconds.

The visual effect is a UV-displacement GLSL shader with chromatic aberration and noise-driven drip columns. Built with [p5.js](https://p5js.org) and [Shox](https://github.com/nicktindall/shox). AQI data from [WAQI](https://waqi.info).

---

## Setup

**Requirements:** Node.js 18+

```bash
git clone https://github.com/yourname/aq-diary.git
cd aq-diary
npm install
```

Copy the example env file and add your [WAQI API token](https://aqicn.org/data-platform/token/):

```bash
cp .env.example .env
# open .env and set WAQI_TOKEN=your_token_here
```

Start the server:

```bash
npm start
```

Then open:

| URL | Page |
|-----|------|
| `http://localhost:3000` | Input — write an entry |
| `http://localhost:3000/output` | Output — display all entries |

---

## Project structure

```
├── server.js        — Express backend, AQI proxy, message storage
├── sketch.js        — Input page (p5.js WEBGL, melt shader, geolocation)
├── output.js        — Output page (p5.js instance mode, one shader per entry)
├── index.html       — Input page shell
├── output.html      — Output page shell
├── style.css        — Shared base styles
├── messages.json    — Stored entries (auto-created, gitignored)
├── .env             — Your WAQI token (gitignored)
└── .env.example     — Token template
```

---

## Notes

- All data stays local. `messages.json` is written to disk and never leaves the machine.
- The AQI fetch is proxied through the server so the API token is never exposed to the browser.
- To run on a LAN (e.g. two screens in the same space), find your local IP (`ifconfig | grep "inet "`) and open both URLs from any device on the network.
