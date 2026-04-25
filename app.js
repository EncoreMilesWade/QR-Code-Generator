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

const placeholders = {
  raw: "Exactly what you type will be encoded.",
  text: "Enter any text...",
  url: "example.com/path  (https:// will be added if missing)",
  phone: "+1 (800) 555-1212",
  email: "name@company.com",
  sms: "+1 800 555 1212",
  geo: "41.8781,-87.6298"
};

function updateHints() {
  const type = el("type").value;
  el("text").placeholder = placeholders[type] || "";
}

// Update when dropdown changes
el("type").addEventListener("change", () => {
  updateHints();
  generateQr();
});


function populateVersionDropdown() {
  const versionSelect = el("version");
  if (!versionSelect) return;

  // Avoid duplicating options if this function runs more than once.
  // Keep the first option (Auto) and remove everything else.
  while (versionSelect.options.length > 1) {
    versionSelect.remove(1);
  }

  // QR versions are 1..40.
  for (let v = 1; v <= 40; v++) {
    const opt = document.createElement("option");
    opt.value = String(v);
    opt.textContent = `Version ${v}`;
    versionSelect.appendChild(opt);
  }
}

function buildPayload(type, input) {
  // We keep transformations simple and predictable.
  // If the user selects "raw", we return exactly what they typed.
  const s = (input ?? "").trim();

  switch (type) {
    case "raw":
      return input ?? ""; // preserve whitespace exactly as typed

    case "text":
      return s;

    case "url": {
      // If user omitted a scheme, assume https://
      // Keep it minimal: don't do DNS lookups or any external validation.
      if (!s) return "";
      if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(s)) return s; // already has a scheme
      return "https://" + s;
    }

    case "phone": {
      // Minimal normalization: remove spaces, parentheses, hyphens.
      // Keep leading + if present.
      if (!s) return "";
      const normalized = s.replace(/[^\d+]/g, "");
      return "tel:" + normalized;
    }

    case "email": {
      // Minimal: just mailto: + trimmed address.
      if (!s) return "";
      return "mailto:" + s;
    }

    case "sms": {
      // Number only; message body would be multi-field, so not included here.
      if (!s) return "";
      const normalized = s.replace(/[^\d+]/g, "");
      return "sms:" + normalized;
    }

    case "geo": {
      // Expect "lat,lon" as a single string.
      // Keep it strict-ish but simple: allow decimals and optional spaces.
      if (!s) return "";
      const m = s.match(/^(-?\d+(\.\d+)?)[,\s]+(-?\d+(\.\d+)?)$/);
      if (!m) return "geo:" + s; // still encode what user gave (transparent)
      const lat = m[1];
      const lon = m[3];
      return `geo:${lat},${lon}`;
    }

    default:
      return s;
  }
}

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

	const type = el("type").value;
	const input = el("text").value ?? "";

	// Build the exact string that will be encoded.
	const payload = buildPayload(type, input);

	// Display it so users/auditors can verify what's being encoded.
	el("payload").value = payload;

	// Encode ONLY this payload string into the QR.
	qr.addData(payload);

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

// Populate QR Version drop-down list
populateVersionDropdown();

// Auto-generate on load for immediate feedback
generateQr();