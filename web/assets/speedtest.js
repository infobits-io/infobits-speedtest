(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const NO_STORE = { cache: "no-store" };
  const SVG_NS = "http://www.w3.org/2000/svg";

  // ─── Tunables ─────────────────────────────────────────────
  const PING_SAMPLES = 20;
  const PING_TIMEOUT_MS = 2000;
  const PING_MIN_MS = 1600;
  const CONNECTING_MS = 900;
  const POST_DL_PAUSE_MS = 500;
  const UI_TICK_MS = 100;
  const UPLOAD_CHUNK_BYTES = 1 << 20;
  const DOWNLOAD_REQUEST_BYTES = 250 * (1 << 20);
  const LOADED_PING_WARMUP_MS = 500;
  const LOADED_PING_INTERVAL_MS = 250;

  // ─── Dial geometry ────────────────────────────────────────
  const CX = 210;
  const CY = 260.4;
  const R = 176.4;
  const IR = 162.4;
  const A0 = -90;
  const A1 = 90;
  const TICK_VALUES = [0, 1, 5, 10, 25, 50, 100, 250, 500, 1000];
  const MINOR_TICKS = 60;

  // ─── Phase labels ─────────────────────────────────────────
  const PILL_LABELS = {
    idle: "Ready",
    connecting: "Connecting",
    ping: "Latency",
    download: "Download",
    upload: "Upload",
    results: "Complete",
  };
  // Suffix appended after "Mbps · ". Empty key → just "Mbps".
  const SUB_SUFFIX = {
    connecting: "finding server",
    ping: "measuring latency",
    download: "download",
    upload: "upload",
    results: "download · complete",
  };

  // ─── Tile config ──────────────────────────────────────────
  const TILE_KEYS = ["download", "upload", "ping", "jitter", "loss", "bufferbloat"];
  const TILE_FMTS = {
    download: fmtSpeed,
    upload: fmtSpeed,
    ping: fmtMs,
    jitter: fmtMs,
    loss: fmtMs,
    bufferbloat: fmtMs,
  };
  const PING_ACTIVE_TILES = new Set(["ping", "jitter", "loss"]);

  // ─── DOM refs ─────────────────────────────────────────────
  const tileNodes = {};
  const tileNums = {};
  for (const k of TILE_KEYS) {
    tileNodes[k] = document.querySelector(`[data-key="${k}"]`);
    tileNums[k] = $(`t-${k}`);
  }
  const el = {
    phasePill: $("phase-pill"),
    phaseLabel: $("phase-label"),
    server: $("server"),
    dialWrap: $("dial-wrap"),
    dialTrack: $("dial-track"),
    dialActive: $("dial-active"),
    dialTicks: $("dial-ticks"),
    dialLabels: $("dial-labels"),
    dialNeedleLine: $("dial-needle-line"),
    headlineWrap: $("headline-wrap"),
    headlineNum: $("headline-num"),
    headlineSub: $("headline-sub"),
    tiles: $("tiles"),
    footerIdle: $("footer-idle"),
    footerRunning: $("footer-running"),
    footerSummary: $("footer-summary"),
    btnStart: $("btn-start"),
    btnCancel: $("btn-cancel"),
    btnAgain: $("btn-again"),
    mServer: $("m-server"),
    mNetLabel: $("m-net-label"),
  };
  // All four IP display targets (desktop idle/running/summary + mobile).
  const ipNodes = ["ip-idle", "ip-running", "ip-summary", "m-ip"].map($);

  // ─── State ────────────────────────────────────────────────
  const state = {
    phase: "idle",
    current: 0,
    download: 0,
    upload: 0,
    ping: 0,
    jitter: 0,
    loss: 0,
    bufferbloat: 0,
    loadedPings: [],
    ip: null,
  };

  let runAbort = null;
  let needleTarget = A0;
  let needleCurrent = A0;
  let needleVel = 0;

  // ─── Math / SVG helpers ───────────────────────────────────
  function polar(r, deg) {
    const rad = ((deg - 90) * Math.PI) / 180;
    return [CX + r * Math.cos(rad), CY + r * Math.sin(rad)];
  }

  function arcPath(r, a, b) {
    const [x1, y1] = polar(r, a);
    const [x2, y2] = polar(r, b);
    return `M ${x1} ${y1} A ${r} ${r} 0 0 ${b > a ? 1 : 0} ${x2} ${y2}`;
  }

  function speedToAngle(s) {
    const a = -90 + (180 * Math.log10(Math.max(0, s) + 1)) / Math.log10(1001);
    return Math.max(-90, Math.min(90, a));
  }

  function svgEl(name, attrs) {
    const node = document.createElementNS(SVG_NS, name);
    for (const k in attrs) node.setAttribute(k, attrs[k]);
    return node;
  }

  function median(arr) {
    if (!arr.length) return 0;
    const s = [...arr].sort((x, y) => x - y);
    return s[s.length >> 1];
  }

  // ─── Dial render + spring ─────────────────────────────────
  function renderDialStatic() {
    el.dialTrack.setAttribute("d", arcPath(R, A0, A1));
    el.dialTicks.replaceChildren();
    el.dialLabels.replaceChildren();

    for (let i = 0; i <= MINOR_TICKS; i++) {
      const isMajor = i % 6 === 0;
      const deg = A0 + ((A1 - A0) * i) / MINOR_TICKS;
      const [x1, y1] = polar(IR, deg);
      const [x2, y2] = polar(IR - (isMajor ? 10 : 5), deg);
      el.dialTicks.appendChild(
        svgEl("line", {
          x1, y1, x2, y2,
          stroke: "#1a1d24",
          "stroke-opacity": isMajor ? 0.45 : 0.15,
          "stroke-width": isMajor ? 1.2 : 1,
          "stroke-linecap": "round",
        }),
      );
    }

    for (const v of TICK_VALUES) {
      const [lx, ly] = polar(R + 22, speedToAngle(v));
      const t = svgEl("text", {
        x: lx, y: ly,
        "font-size": 11,
        fill: "#6b7280",
        "font-family": "'JetBrains Mono', ui-monospace, monospace",
        "text-anchor": "middle",
        "dominant-baseline": "middle",
      });
      t.textContent = v;
      el.dialLabels.appendChild(t);
    }

    updateNeedleSVG();
  }

  function updateNeedleSVG() {
    const [nx, ny] = polar(R - 4, needleCurrent);
    const [bx, by] = polar(8, needleCurrent + 180);
    const n = el.dialNeedleLine;
    n.setAttribute("x1", bx);
    n.setAttribute("y1", by);
    n.setAttribute("x2", nx);
    n.setAttribute("y2", ny);
    el.dialActive.setAttribute("d", arcPath(R, A0, Math.max(A0 + 0.01, needleCurrent)));
  }

  function springTick() {
    const dx = needleTarget - needleCurrent;
    needleVel = needleVel * 0.78 + dx * 0.12;
    if (Math.abs(dx) < 0.01 && Math.abs(needleVel) < 0.01) {
      needleCurrent = needleTarget;
      needleVel = 0;
    } else {
      needleCurrent += needleVel;
    }
    updateNeedleSVG();
    requestAnimationFrame(springTick);
  }

  // ─── Formatting ───────────────────────────────────────────
  function fmtSpeed(v) {
    if (!isFinite(v) || v <= 0) return "0.00";
    return v.toFixed(v >= 100 ? 1 : 2);
  }

  function fmtMs(v) {
    return isFinite(v) ? v.toFixed(1) : "0.0";
  }

  // ─── DOM updates ──────────────────────────────────────────
  function setPhase(phase) {
    state.phase = phase;
    const isResults = phase === "results";
    const isIdle = phase === "idle";
    const isRunning = !isIdle && !isResults;
    const isTransfer = phase === "ping" || phase === "download" || phase === "upload";

    el.phaseLabel.textContent = PILL_LABELS[phase] || "";
    el.phasePill.dataset.state = isResults ? "results" : isRunning ? "running" : "idle";

    const suffix = SUB_SUFFIX[phase];
    el.headlineSub.textContent = suffix ? `Mbps · ${suffix}` : "Mbps";
    el.headlineWrap.dataset.state = isIdle ? "idle" : isResults ? "results" : "active";

    el.dialWrap.dataset.active = isIdle ? "false" : "true";
    el.dialWrap.dataset.arcActive = isTransfer ? "true" : "false";

    el.tiles.dataset.visible = isIdle ? "false" : "true";

    for (const k of TILE_KEYS) {
      const isActive = phase === "ping" ? PING_ACTIVE_TILES.has(k) : phase === k;
      tileNodes[k].dataset.active = isActive ? "true" : "false";
    }

    setFooter(phase);
  }

  function setFooter(phase) {
    el.footerIdle.hidden = phase !== "idle";
    el.footerRunning.hidden = phase === "idle" || phase === "results";
    el.footerSummary.hidden = phase !== "results";
    if (state.ip) writeIp(state.ip);
  }

  function writeIp(ip) {
    const shown = displayIp(ip);
    for (const n of ipNodes) n.textContent = shown;
  }

  function setMobileServer(v) {
    el.mServer.textContent = v || "—";
  }

  function setServer(loc) {
    if (!loc) {
      setMobileServer("—");
      return;
    }
    el.server.textContent = loc;
    el.server.dataset.visible = "true";
    setMobileServer(loc);
  }

  function detectConnectionLabel() {
    const c = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    if (!c) return "Wi-Fi";
    if (c.type === "cellular") {
      return c.effectiveType ? c.effectiveType.toUpperCase() : "Cellular";
    }
    return { wifi: "Wi-Fi", ethernet: "Ethernet", none: "Offline", bluetooth: "Bluetooth" }[c.type] || "Wi-Fi";
  }

  const setHeadline = (v) => (el.headlineNum.textContent = fmtSpeed(v));
  const setTile = (k, v) => (tileNums[k].textContent = TILE_FMTS[k](v));
  const setDialValue = (v) => (needleTarget = speedToAngle(v));

  function resetMetrics() {
    state.current = state.download = state.upload = 0;
    state.ping = state.jitter = state.loss = state.bufferbloat = 0;
    state.loadedPings = [];
    setHeadline(0);
    setDialValue(0);
    for (const k of TILE_KEYS) setTile(k, 0);
  }

  // ─── Networking ───────────────────────────────────────────
  async function fetchJSON(url, fallback) {
    try {
      const res = await fetch(url, NO_STORE);
      return res.ok ? await res.json() : fallback;
    } catch {
      return fallback;
    }
  }

  const fetchConfig = () =>
    fetchJSON("/config", { test_duration_sec: 10, parallel_streams: 4, server_location: "" });

  const fetchWhoami = async () => (await fetchJSON("/whoami", null))?.ip || null;

  function displayIp(ip) {
    if (!ip) return "—";
    return ip === "::1" || ip.startsWith("127.") ? "localhost" : ip;
  }

  // Linked-abort helper: fires onAbort when the parent signal aborts.
  function linkAbort(parent) {
    const ctrl = new AbortController();
    const onAbort = () => ctrl.abort();
    parent.addEventListener("abort", onAbort, { once: true });
    return {
      signal: ctrl.signal,
      abort: () => ctrl.abort(),
      cleanup: () => parent.removeEventListener("abort", onAbort),
    };
  }

  // Single ping with timeout; resolves with RTT in ms, rejects on error/abort/timeout.
  async function pingOnce(parentSignal) {
    const t0 = performance.now();
    const link = linkAbort(parentSignal);
    const timer = setTimeout(link.abort, PING_TIMEOUT_MS);
    try {
      const res = await fetch("/ping", { cache: "no-store", signal: link.signal });
      await res.text();
      return performance.now() - t0;
    } finally {
      clearTimeout(timer);
      link.cleanup();
    }
  }

  // ─── Phase: connecting ────────────────────────────────────
  async function phaseConnecting() {
    const start = performance.now();
    const [cfg, ip] = await Promise.all([fetchConfig(), fetchWhoami()]);

    state.ip = ip;
    if (ip) setFooter(state.phase);
    setServer(cfg.server_location);

    const remaining = CONNECTING_MS - (performance.now() - start);
    if (remaining > 0) await sleep(remaining);
    return cfg;
  }

  // ─── Phase: ping ──────────────────────────────────────────
  async function phasePing(signal) {
    const start = performance.now();
    const samples = [];
    let lost = 0;

    for (let i = 0; i < PING_SAMPLES; i++) {
      if (signal.aborted) return;
      try {
        samples.push(await pingOnce(signal));
      } catch {
        lost++;
      }

      const stats = computePing(samples, lost, i + 1);
      state.ping = stats.median;
      state.jitter = stats.jitter;
      state.loss = stats.loss;
      setTile("ping", state.ping);
      setTile("jitter", state.jitter);
      setTile("loss", state.loss);
      setHeadline(state.ping);
    }

    const remaining = PING_MIN_MS - (performance.now() - start);
    if (remaining > 0) await sleep(remaining);
  }

  function computePing(samples, lost, sent) {
    if (!samples.length) return { median: 0, jitter: 0, loss: 100 };
    const m = median(samples);
    const mean = samples.reduce((s, v) => s + v, 0) / samples.length;
    const jitter = samples.reduce((s, v) => s + Math.abs(v - mean), 0) / samples.length;
    return { median: m, jitter, loss: (lost / sent) * 100 };
  }

  // ─── Phases: download / upload ────────────────────────────
  async function phaseTransfer({ direction, streams, durationMs, signal, onMbps }) {
    const startedAt = performance.now();
    const counters = { bytes: 0 };
    const inner = linkAbort(signal);
    const stopAt = startedAt + durationMs;

    let lastUiAt = 0;
    const interval = setInterval(() => {
      const now = performance.now();
      if (now - lastUiAt >= UI_TICK_MS) {
        const sec = (now - startedAt) / 1000;
        if (sec > 0) onMbps(bytesToMbps(counters.bytes, sec));
        lastUiAt = now;
      }
      if (now >= stopAt) inner.abort();
    }, UI_TICK_MS);

    const workers = [];
    const fn = direction === "download" ? downloadStream : uploadStream;
    for (let i = 0; i < streams; i++) {
      workers.push(fn(counters, stopAt, inner.signal));
    }
    const loadedPinger = sampleLoadedPings(inner.signal, state.loadedPings, stopAt);

    try {
      await Promise.allSettled([...workers, loadedPinger]);
    } finally {
      clearInterval(interval);
      inner.cleanup();
    }

    return bytesToMbps(counters.bytes, (performance.now() - startedAt) / 1000);
  }

  async function sampleLoadedPings(signal, sink, stopAt) {
    await sleep(LOADED_PING_WARMUP_MS);
    while (performance.now() < stopAt && !signal.aborted) {
      try {
        sink.push(await pingOnce(signal));
        state.bufferbloat = computeBufferbloat(sink, state.ping);
        setTile("bufferbloat", state.bufferbloat);
      } catch {
        /* drop sample */
      }
      await sleep(LOADED_PING_INTERVAL_MS);
    }
  }

  function computeBufferbloat(pings, idle) {
    return pings.length && idle > 0 ? Math.max(0, median(pings) - idle) : 0;
  }

  async function downloadStream(counters, stopAt, signal) {
    while (performance.now() < stopAt && !signal.aborted) {
      try {
        const res = await fetch(`/download?bytes=${DOWNLOAD_REQUEST_BYTES}`, { cache: "no-store", signal });
        if (!res.ok || !res.body) return;
        const reader = res.body.getReader();
        for (;;) {
          if (performance.now() >= stopAt || signal.aborted) {
            try { reader.cancel(); } catch { /* ignore */ }
            return;
          }
          const { done, value } = await reader.read();
          if (done) break;
          if (value) counters.bytes += value.byteLength;
        }
      } catch {
        if (signal.aborted) return;
      }
    }
  }

  async function uploadStream(counters, stopAt, signal) {
    const chunk = new Uint8Array(UPLOAD_CHUNK_BYTES);
    crypto.getRandomValues(chunk.subarray(0, Math.min(65536, UPLOAD_CHUNK_BYTES)));

    // XHR is used here (not fetch) so we can count bytes via upload.progress
    // events as they leave the client. With fetch we'd only know a chunk
    // succeeded after the whole response came back — so any chunk that was
    // in flight when the test window closed would be discarded, even though
    // those bytes really were sent. That under-counting is most visible at
    // low bandwidths (e.g. 10 Mbps), where a single 1 MiB chunk takes ~3.4s
    // per worker and a partially-sent final chunk costs ~33% of the result.
    while (performance.now() < stopAt && !signal.aborted) {
      await uploadOneXHR(chunk, counters, signal);
    }
  }

  function uploadOneXHR(chunk, counters, signal) {
    return new Promise((resolve) => {
      const xhr = new XMLHttpRequest();
      let lastReported = 0;
      const onAbort = () => xhr.abort();
      signal.addEventListener("abort", onAbort, { once: true });

      xhr.upload.addEventListener("progress", (e) => {
        const delta = e.loaded - lastReported;
        if (delta > 0) {
          counters.bytes += delta;
          lastReported = e.loaded;
        }
      });
      xhr.upload.addEventListener("load", () => {
        // Top up in case the final progress event didn't reach the chunk size
        // (some browsers don't emit a 100% progress before "load").
        const remaining = chunk.byteLength - lastReported;
        if (remaining > 0) {
          counters.bytes += remaining;
          lastReported = chunk.byteLength;
        }
      });
      xhr.addEventListener("loadend", () => {
        signal.removeEventListener("abort", onAbort);
        resolve();
      });

      xhr.open("POST", "/upload");
      xhr.setRequestHeader("Content-Type", "application/octet-stream");
      xhr.send(chunk);
    });
  }

  function bytesToMbps(bytes, sec) {
    return sec > 0 ? (bytes * 8) / sec / 1e6 : 0;
  }

  // ─── Orchestrator ─────────────────────────────────────────
  async function runTest() {
    if (runAbort) runAbort.abort();
    runAbort = new AbortController();
    const { signal } = runAbort;

    resetMetrics();

    setPhase("connecting");
    const cfg = await phaseConnecting();
    if (signal.aborted) return;

    setPhase("ping");
    await phasePing(signal);
    if (signal.aborted) return;

    const durationMs = cfg.test_duration_sec * 1000;
    const streams = cfg.parallel_streams;

    state.download = await runDirection("download", streams, durationMs, signal);
    if (signal.aborted) return;

    setDialValue(0);
    await sleep(POST_DL_PAUSE_MS);
    if (signal.aborted) return;

    state.upload = await runDirection("upload", streams, durationMs, signal);
    if (signal.aborted) return;

    state.bufferbloat = computeBufferbloat(state.loadedPings, state.ping);
    setTile("bufferbloat", state.bufferbloat);

    setPhase("results");
    setHeadline(state.download);
    setDialValue(state.download);
  }

  async function runDirection(direction, streams, durationMs, signal) {
    setPhase(direction);
    setHeadline(0);
    setDialValue(0);

    const final = await phaseTransfer({
      direction,
      streams,
      durationMs,
      signal,
      onMbps: (mbps) => {
        state.current = mbps;
        state[direction] = mbps;
        setHeadline(mbps);
        setDialValue(mbps);
        setTile(direction, mbps);
      },
    });

    state[direction] = final;
    setHeadline(final);
    setDialValue(final);
    setTile(direction, final);
    return final;
  }

  function cancelTest() {
    if (runAbort) {
      runAbort.abort();
      runAbort = null;
    }
    setDialValue(0);
    setPhase("idle");
    state.current = 0;
    setHeadline(0);
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // ─── Boot ─────────────────────────────────────────────────
  async function boot() {
    renderDialStatic();
    requestAnimationFrame(springTick);

    const start = () => runTest().catch((e) => console.error(e));
    el.btnStart.addEventListener("click", start);
    el.btnAgain.addEventListener("click", start);
    el.btnCancel.addEventListener("click", cancelTest);

    setPhase("idle");
    setHeadline(0);
    el.mNetLabel.textContent = detectConnectionLabel();

    const ip = await fetchWhoami();
    if (ip) {
      state.ip = ip;
      writeIp(ip);
    }

    const cfg = await fetchConfig();
    setServer(cfg.server_location);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
