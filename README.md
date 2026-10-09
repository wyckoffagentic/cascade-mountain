# Cascade Mountain

Standalone demo page for a DMF (no-demand → upthrust → confirmation) short bot on futures: Gold (sim) and Nasdaq (sim).

**Everything here is simulated.** Bars are generated in the browser, prices are on a demo scale, there is no data provider and no broker. P&L is a replay tally only.

## Run

    cd site
    python3 -m http.server 8892 --bind 127.0.0.1
    # open http://127.0.0.1:8892/

No build step and no CDN: fonts (Manrope, Geist Mono, SIL OFL 1.1) are vendored in `assets/fonts/`.

## URL options

| Flag | Effect |
|---|---|
| (none) | Default "boosted" look: on the phone the orbit grows by up to 22% as the rings tighten (full size from step 6, normal size when scanning); the overseer shell is denser (×1.6 photons desktop, ×2 phone) and 25% brighter; the trade-fire shockwave is denser, larger, brighter and lasts 1.9 s (was 1.5 s) with a second inner shell; the green settle runs on a faster spring (6.5 vs 3.4). |
| `?boost=0` | The earlier look (option A in `shots/c-live/compare-*.mp4`). |
| `?look=mountain` / `vortex` / `aurora` | Stage theme (also the LOOK switcher in the stage's top-right corner; the choice is remembered in `localStorage` as `cm.look`). Mountain is the default. |
| `?nogl` | CPU fallback renderer (the same simple orbit for every look). |
| `?capture` | Fixed-timestep frame loop driven by `__DMF.tick(n, ms)`, for deterministic frame capture. |

## Risk rules

- Per trade: at most the risk setting (default 0.75%, slider capped at 1.00%) of realized equity. Size is floored to whole contracts, so the real risk is at or below the setting.
- Total: open risk across both books never exceeds 1.00% of realized equity (`TOTAL_RISK_CAP` in `assets/engine.js`). When a second short would breach it, it is sized down to the remaining headroom. If the headroom is under 0.25% (`MIN_TRADE_RISK`), or one micro doesn't fit, the trade is skipped and logged as "risk cap".
- Gold is filled before Nasdaq on the same bar, so on a tie Nasdaq gets the headroom.
- The P&L panel's "% at risk" uses the same realized-equity basis.

## Layout

| File | Role |
|---|---|
| `index.html` | Page shell, SIMULATED banner, panels |
| `assets/engine.js` | Synthetic bars, timeframe aggregation, DMF state machine, sizing, trail, replay |
| `assets/chart.js` | HLC charts (close tick as thick as the bar), EMAs, overlays, VSA glyphs |
| `assets/swarm.js` | Orbital field: timeframe lanes, evidence lines, rings, signal merge, deep-zone bristle, VSA overseer halo |
| `assets/vsa-watcher.js` | Advisory VSA module. Subscribes to closed bars, publishes findings, never touches the trade |
| `assets/bg.js` | Low-contrast star field (static with reduced motion) |
| `assets/headsky.js` | Shared header sky: live aurora behind the title and ridgeline, an occasional snow gust and wordmark glint |
| `assets/app.js` | Wiring, DOM, replay controls, `window.__DMF` test hooks |
| `data/custom/` | Drop-in real bars later (see `SCHEMA.md`). Off until files exist |

## Timeframe colours

4H `#b18cff` · 2H `#4fa8ff` · 30m `#45f0c0` · 15m `#ff66e0` · 5m `#ff8f8f` · aligned signal `#d4ff4f` · VSA overseer `#eeeaff` · VSA warning `#ffb020`

## Ring tightening and weakness energy
- Alignment step (app.js `alignStep`): 0 scanning, 1 HTF ND, 2 HTF UT/HUT, 3 30m, 4 15m, 5 5m, 6 trigger, 7 trade fire.
  Swarm orbit radius (×R): 0.300, 0.272, 0.246, 0.222, 0.200, 0.180, 0.162, 0.140. Photon bands (×R): 0.400, 0.362, 0.328, 0.296, 0.268, 0.243, 0.220, 0.196.
  Eased at rate 4.2/s between steps; the overseer halo stays fixed at 0.45R.
- Weakness energy (app.js `weaknessEnergy`), 0–100, from closed bars on the confirmed timeframes only. See the comment above `tfEnergy`.
  It drives particle speed, active count, jitter, trail length, ring spin, packet rate and core pulse. All of these are frozen under reduced motion.

## Photon-only orbit
The orbital canvas (`assets/swarm.js`) draws no stroked lines or outlines. Every element is an additive radial-gradient photon sprite, cached per quantised colour. The swarm, bristle beads, ripples and burst shells go through the fade buffer, so they leave short luminous trails. The bands, evidence streams, overseer cloud, eye and nucleus are drawn without trails, so they read as distinct points. The state text and the ladder labels stay crisp, with a soft dark well behind them and no glow.
Photon budget: swarm 480 / 170 (phone) / 60 (reduced motion). Band beads 192 / 144 / 96. Overseer 130 / 70 / 50. Nucleus 54 / 28 / 18. Stream cap 220 / 90.

## 3D orbit (WebGL)
`assets/swarm.js` gives every photon a real 3D position. WebGL draws them as additive `gl.POINTS` sprites: perspective size, depth falloff and fog are done in the vertex shader, and a radial falloff in the fragment shader. A ping-pong-free FBO gives short, soft trails: each frame it multiplies down, subtracts a small constant (so no 8-bit ghosts remain), then adds the new photons.
- The bands, streams, overseer, eye and nucleus are drawn without trails. No line primitives are used anywhere.
- Without WebGL (or with `?nogl`), the same photon list is projected on the CPU and drawn as 2D sprites.
- The text sits on the 2D overlay canvas: crisp, no glow, anchored to the projected 3D points.
- Lane planes are tilted (inclinations 64, -48, 30, -72, 14 degrees). Each alignment step tightens their radius and rotates them toward the shared disc; they lie flat at fire. An invalidation tumbles them.
- Camera: a slow idle drift of about 4 degrees. Drag to orbit (with inertia), double-click to reset, wheel or pinch to zoom 0.8 to 1.35. On touch, one-finger vertical drags still scroll the page. Reduced motion means no drift and no inertia.

## Look: snow-capped peaks, quant chrome
Dark slate peaks with white snow caps, layered with haze; the chrome is flat, hairline-ruled and numbers-first.
- Stage backdrop (`assets/swarm.js`, composite shader): three snow-capped ranges (far hazed, middle, near dark slate) with faceted light and caps whose depth grows with height. Soft filled shapes only; the orbit itself stays photons only. Evaluated only below the tallest summit.
- Header horizon: `assets/peaks-ridge.svg`, a full-bleed snow-capped ridgeline over a ruled elevation scale. Footer range: `assets/peaks-foot.svg`. Both are generated, faceted, static SVGs.
- Panels are flat slate slabs with hairline borders; headers carry a small summit marker and a rule. Section dividers are labelled elevation scales.
- Weakness energy is drawn as an elevation profile that the fill climbs (CSS `clip-path`, no script change).
- Selected controls are white on dark. Alpenglow orange is kept for the SIMULATED marks and the top of the energy profile.
- Fonts: Manrope (display and UI) and Geist Mono (figures, tabular). Both are vendored as WOFF subsets under the OFL; see `assets/fonts/LICENSES.md`.
- Performance: the chrome sits on its own compositor layers (`will-change`) so the animated stage never forces it to repaint.

Palette:

| Role | Hex |
|---|---|
| Background | #060a10 → #0a131b → #0f2128 |
| Snow | #f3f8fb |
| Ice | #e8f4fb |
| Glacier | #9fd3ee |
| Alpenglow accent (rare) | #ff8a4c |
| VSA warning amber | #ffcc33 |
| 4H | #8c9aff |
| 2H | #3fb8ff |
| 30m | #2fdccb |
| 15m | #d68cff |
| 5m | #ff8fa8 |
| Signal | #6dff9e |
| Overseer pearl | #edf6ff |
| HLC up | #d9eef8 |
| HLC down | #ff9c86 |

## Looks (LOOK switcher)

Three stage themes over identical logic and an identical page shell: the engine, sim, VSA watcher, risk, P&L, header, panels and colours are shared; only the stage renderer and its in-stage backdrop change. Switching is live (the old renderer releases its GL context and a fresh one is built).

- **Mountain** (`assets/swarm.js`, default): the orbit swarm over snow-capped peaks, a still lake, and layered conifers (a hazy far treeline, a mid row, and tall snow-dusted foreground pines on snowbanks at the sides, keeping the centre clear for the orbit). Drifting snow in the air.
- **Vortex** (`assets/look-vortex.js`): five timeframe tiers as a vertical funnel (4H wide at the top, 5m at the core). Loose tiers tilt and precess, with a scan-head knot running round each one. Aligned tiers level, lock and pour photon streams down. VSA is a separate advisory ring.
- **Aurora** (`assets/look-aurora.js`): one aurora curtain per timeframe (4H highest, then 2H, 30m, 15m, 5m, in the legend colours) over stars, hills and a lake that reflects them. VSA is a pearl photon ring lying on the lake.

**Intensity arc (all looks):** intensity builds through confirming and trigger armed, peaks at fire, and stays high for the whole trade, scaled by weakness energy. It unwinds at exit or invalidation (`arcTarget` in `swarm.js`).
- Mountain: a faster, brighter swarm, a pulsing core and bloom, snow whipping up, pines swaying harder, and an alpenglow surge on the peaks.
- Vortex: faster rotation, a rising green photon column, and pulse waves running down the rings.
- Aurora: brighter, quicker curtains and a surge with signal green leading at fire. For the whole trade the curtains themselves blaze: brighter, taller and denser, faster ripple and shimmer, colour flowing through green, violet and pink, pulsing surges across more of the sky, and sparks streaming up the curtains. Hue-preserving compression keeps it readable (no white-out), and the timeframe labels stay on their curtains. It calms back down at exit. There is no spiral or swirl.

Under reduced motion every look shows a static frame at the same intensity.

## Timeframe labels (no chip rail)
The old left timeframe chip rail is gone in every look. Its alignment state now shows on the labels: a tick and a brighter label when aligned, and an outline on the current tier in the legend. Phone Mountain shows a compact timeframe legend, because Vortex and Aurora already label their tiers in the stage. The chart timeframe is picked with the small buttons in the chart legend.

## Replay pace and the TEMP speed tool
- 1× = 340 ms per bar, held 2.5× longer while any instrument is confirming or in a trade (visual timing only; it never changes which bars are computed).
- One full cycle (scanning → confirming → fire → trailing → exit) takes about 70 s at 1× and about 7 s at 10×.
- The floating speed tool, tagged **temp**, sits in the stage: top right on desktop, bottom left on phone. It has play/pause, 0.5×, 1×, 2×, 5×, 10× and 30×, and **Next setup**. Next setup looks ahead on a private copy of the replay, then fast-forwards the live replay to just before the next confirming phase.
- The tool stays in sync with the speed buttons in the controls bar. Tapes are identical at every speed and after a jump.

## Header sky (shared, every look)
- One low-res canvas paints a living aurora (green, violet and pink curtains, slowly drifting and breathing) behind the title and the snow-capped ridgeline.
- A front canvas draws only during events:
  - a snow gust across the ridge every 45–90 s (random, a few seconds long);
  - a glint on the snow caps every 20–40 s, alongside a specular sweep across the "Cascade Mountain" wordmark.
- The sky pauses when the header is off-screen (IntersectionObserver) or the tab is hidden.
- Reduced motion: one static aurora frame, with no gust and no glint.
