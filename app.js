/*
  INTERNAL QR TOOL — THREAT MODEL / AUDIT NOTES
  --------------------------------------------
  Purpose: Generate QR codes locally in the browser without trusting any third-party websites.

  Data flow:
    1) Read user input from textarea (string).
    2) Pass string to local QR encoder library (vendor/qrcode.js).
    3) Render QR as SVG or PNG in the DOM.
    4) Optional download: create a Blob/data URL locally and trigger a download.

  Guarantees:
    - No external scripts, fonts, or API calls (CSP blocks connect-src).
    - No analytics.
    - No storage: we do not write to localStorage/sessionStorage/cookies.
*/

const el = (id) => document.getElementById(id);

const state = {
  lastSvgText: "",   // stored only in-memory for downloads
  lastPngDataUrl: "" // stored only in-memory for downloads
};

function generateQr() {
  const text = el("text").value ?? "";
  const ecc = el("ecc").value;              // 'L' | 'M' | 'Q' | 'H'
  const version = Number(el("version").value);  // 0=auto or 1..40
  const cellSize = Number(el("modulesize").value);
  const margin = Number(el("margin").value);
  const format = el("format").value;        // 'svg' | 'png'

  // Clear previous output.
  const out = el("out");
  out.innerHTML = "";
  state.lastSvgText = "";
  state.lastPngDataUrl = "";

  // IMPORTANT: Determinism/Auditability
  // We pass ONLY the user input string into the QR encoder. No transformation beyond using it as-is.
  // (If “payload helpers” like Wi-Fi/vCard are needed, do it explicitly and visibly.)
  const qr = qrcode(version, ecc);          // from qrcode-generator library
  qr.addData(text);                         // adds raw data
  qr.make();                                // computes matrix (masking, ECC, etc.)

  if (format === "svg") {
    // createSvgTag(cellSize, margin) returns a complete <svg>...</svg> string
    // The library handles module mapping & quiet zone; we control scale & margin explicitly.
    const svgText = qr.createSvgTag(cellSize, margin);
    state.lastSvgText = svgText;
    out.innerHTML = svgText;
	
  } else {
    // For PNG, we render to a canvas locally. We can derive module states via isDark(row,col).
    const count = qr.getModuleCount();
    const sizePx = (count + margin * 2) * cellSize;

    const canvas = document.createElement("canvas");
    canvas.width = sizePx;
    canvas.height = sizePx;

    const ctx = canvas.getContext("2d");
    // White background
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, sizePx, sizePx);

    // Draw black modules
    ctx.fillStyle = "#000000";
    for (let r = 0; r < count; r++) {
      for (let c = 0; c < count; c++) {
        if (qr.isDark(r, c)) {
          const x = (c + margin) * cellSize;
          const y = (r + margin) * cellSize;
          ctx.fillRect(x, y, cellSize, cellSize);
        }
      }
    }

    out.appendChild(canvas);
    state.lastPngDataUrl = canvas.toDataURL("image/png");
  }
}

function downloadQr() {
  const format = el("format").value;
  const text = el("text").value ?? "";

  // Create a safe filename derived from input length, not content (avoid weird characters).
  const safeName = `qr-${String(text.length).padStart(3, "0")}.${format}`;

  if (format === "svg") {
    if (!state.lastSvgText) return;

    const blob = new Blob([state.lastSvgText], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = safeName;
    a.click();

    URL.revokeObjectURL(url);
  } else {
    if (!state.lastPngDataUrl) return;

    const a = document.createElement("a");
    a.href = state.lastPngDataUrl;
    a.download = safeName.replace(".png", "") + ".png";
    a.click();
  }
}

// Wire up events
el("generate").addEventListener("click", generateQr);
el("download").addEventListener("click", downloadQr);

// Auto-generate on load for immediate feedback
generateQr();