# Custom futures bars

The Cascade Mountains page ships in **DEMO / REPLAY** on synthetic bars. Real mode stays off until files exist here and you choose to drive the tape with them. Nothing in this folder is fetched from a vendor. Do not commit live account data.

## Files

```
data/custom/{SYMBOL}_{TF}.json
data/custom/{SYMBOL}_{TF}.csv
```

- `SYMBOL`: `GC`, `MGC`, `NQ`, `MNQ` (futures only — the bot does not trade anything else)
- `TF`: `5m` is the one the loader probes. Optional siblings: `15m`, `30m`, `2h`, `4h`. If you only drop 5-minute bars, the page can aggregate them (clock-aligned, 08:00–16:00 America/New_York in this demo's session model — change the bucket if your feed is full Globex).

`loadBars(symbol, tf)` in `assets/app.js` tries the JSON URL, then the CSV URL, and returns `null` when both are missing. That `null` is why the badge stays `DEMO / REPLAY`.

## JSON

```json
[
  {"t": "2026-10-08T09:30:00-04:00", "o": 1800.0, "h": 1801.2, "l": 1799.4, "c": 1799.8, "v": 1200}
]
```

`t` may be an ISO-8601 string or epoch milliseconds. Prices are unrounded contract prices; volume is the bar's traded size (or contracts — be consistent). A wrapper object `{"bars":[...]}` is also accepted.

## CSV

```
t,o,h,l,c,v
2026-10-08T09:30:00-04:00,1800.0,1801.2,1799.4,1799.8,1200
```

## Contract math already in the page

| Product | Tick | $ / tick | $ / 1.00 price |
|---|---|---|---|
| GC | 0.10 | 10 | 100 |
| MGC | 0.10 | 1 | 10 |
| NQ | 0.25 | 5 | 20 |
| MNQ | 0.25 | 0.50 | 2 |

Sizing uses whole contracts, micros when a mini does not fit inside the risk budget (default 0.75% of account, hard cap 1% on the slider).
