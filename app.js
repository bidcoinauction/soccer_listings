/* Soccer eBay Lister
   - Loads ./full_card_inventory.tsv and ./ebay_listing.csv
   - Shows thumbnails from IMAGE URL
   - Generates File Exchange “Add” row aligned to your existing ebay_listing.csv columns
   - Appends and downloads updated ebay_listing.csv
*/

(() => {
  const $ = (id) => document.getElementById(id);

  const els = {
    // top-level UI
    status: $("resultCount"),
    activeFilters: $("activeFilters"),
    grid: $("cardGrid"),
    emptyState: $("emptyState"),

    // filters
    search: $("searchInput"),
    set: $("setFilter"),
    team: $("teamFilter"),
    league: $("leagueFilter"),
    autoOnly: $("autoOnly"),
    numberedOnly: $("numberedOnly"),
    clearBtn: $("clearFilters"),
    emptyClear: $("emptyClear"),

    // modal
    modal: $("detailsModal"),
    backdrop: $("modalBackdrop"),
    closeModalBtn: $("closeModal"),

    // modal fields
    mTitle: $("modalTitle"),
    mSet: $("modalSet"),
    mCardNo: $("modalCardNumber"),
    mFeatures: $("modalFeatures"),
    mSeason: $("modalSeason"),
    mBrand: $("modalBrand"),
    mCondition: $("modalCondition"),
    mPlayer: $("mPlayer"),
    mTeam: $("mTeam"),
    mLeague: $("mLeague"),

    mImage: $("mImage"),
    openImageBtn: $("openImageBtn"),
    copyImageBtn: $("copyImageBtn"),

    mTitlePreview: $("mTitlePreview"),
    mDescPreview: $("mDescPreview"),
    mCsvRowPreview: $("mCsvRowPreview"),

    copyTitleBtn: $("copyTitleBtn"),
    copyDescBtn: $("copyDescBtn"),
    appendEbayBtn: $("appendEbayBtn"),

    toast: $("toast"),
    toastText: $("toastText"),
  };

  /** @type {Array<Record<string,string>>} */
  let inventory = [];
  /** @type {Array<Record<string,string>>} */
  let filtered = [];
  /** @type {Record<string,string> | null} */
  let selected = null;

  /** @type {string[][]} */
  let ebayRows = [];
  /** @type {string[]} */
  let ebayHeader = []; // row1 in your file (index 1)

  const state = {
    q: "",
    set: "",
    team: "",
    league: "",
    autoOnly: false,
    numberedOnly: false,
  };

  // ===== Inventory field mapping =====
  function inv(row, key) {
    return String(row?.[key] ?? "").trim();
  }

  function invTeam(row) {
    return (row["Team "] ?? row["Team"] ?? "").toString().trim();
  }

  function firstYearFromText(s) {
    const m = String(s || "").match(/\b(19|20)\d{2}\b/);
    return m ? m[0] : "";
  }

  function normalizeSeason(s) {
    const m = String(s || "").match(/^(\d{4})\s*[-/]\s*(\d{4})$/);
    if (!m) return String(s || "").trim();
    const y1 = m[1];
    const y2 = m[2].slice(2);
    return `${y1}-${y2}`;
  }

  function isAuto(row) {
    const f = inv(row, "Features").toLowerCase();
    return /\bauto\b|autograph|signed/.test(f);
  }

  function isNumbered(row) {
    const f = inv(row, "Features");
    return /\/\s*\d+/.test(f) || /\b\d+\s*\/\s*\d+\b/.test(f) || /\bnumbered\b|\bserial\b/i.test(f);
  }

  // ===== TSV =====
  function parseTSV(tsvText) {
    const lines = tsvText
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n")
      .split("\n")
      .filter((l) => l.trim() !== "");
    if (lines.length < 2) return [];

    const headers = lines[0].split("\t").map((h) => h.trim());
    const rows = [];

    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split("\t");
      const row = {};
      for (let c = 0; c < headers.length; c++) row[headers[c]] = (cols[c] ?? "").trim();
      rows.push(row);
    }
    return rows;
  }

  // ===== CSV parser =====
  function parseCSV(text) {
    const rows = [];
    let row = [];
    let cur = "";
    let i = 0;
    let inQuotes = false;

    while (i < text.length) {
      const ch = text[i];

      if (inQuotes) {
        if (ch === '"') {
          const next = text[i + 1];
          if (next === '"') {
            cur += '"';
            i += 2;
            continue;
          }
          inQuotes = false;
          i++;
          continue;
        }
        cur += ch;
        i++;
        continue;
      }

      if (ch === '"') { inQuotes = true; i++; continue; }
      if (ch === ",") { row.push(cur); cur = ""; i++; continue; }
      if (ch === "\n") { row.push(cur); rows.push(row); row = []; cur = ""; i++; continue; }
      if (ch === "\r") { i++; continue; }

      cur += ch;
      i++;
    }

    row.push(cur);
    rows.push(row);
    return rows;
  }

  function escapeHtml(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function uniqSorted(arr) {
    return Array.from(new Set(arr.map((x) => (x ?? "").trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b));
  }

  function safeText(s) {
    return String(s ?? "").replace(/\s+/g, " ").trim();
  }

  function clampTitle(s, max = 80) {
    const t = safeText(s);
    if (t.length <= max) return t;
    return t.slice(0, max - 1).trimEnd() + "…";
  }

  function buildEbayTitle(row) {
    return clampTitle(inv(row, "Card Name") || "Soccer Card");
  }

  function buildEbayDescriptionHTML(row) {
    const cardName = inv(row, "Card Name") || "Soccer Card";
    const player = inv(row, "Player Name");
    const setFull = inv(row, "Card Set");
    const brand = inv(row, "Brand");
    const league = inv(row, "League");
    const team = invTeam(row);
    const cardNo = inv(row, "Card Number");
    const features = inv(row, "Features");
    const season = inv(row, "Season");
    const condition = inv(row, "Condition") || "See photos";

    const bullets = [
      ["Card", cardName],
      ["Player", player],
      ["Set", setFull],
      ["Brand", brand],
      ["League", league],
      ["Team", team],
      ["Card #", cardNo],
      ["Features", features],
      ["Season", season],
      ["Condition", condition],
    ].filter(([, v]) => safeText(v) !== "");

    const li = bullets.map(([k, v]) => `<li><b>${escapeHtml(k)}:</b> ${escapeHtml(v)}</li>`).join("");
    const autoLine = isAuto(row) ? `<p><b>Autograph:</b> Yes</p>` : "";
    const numberedLine = isNumbered(row) ? `<p><b>Serial numbered:</b> Yes</p>` : "";

    return [
      `<div>`,
      `<p><b>${escapeHtml(cardName)}</b></p>`,
      `<ul>${li}</ul>`,
      autoLine,
      numberedLine,
      `<p>Shipped with care. Please review photos for exact condition.</p>`,
      `</div>`,
    ].filter(Boolean).join("");
  }

  // ===== File Exchange row builder =====
  function headerIndex(name) {
    const idx = ebayHeader.findIndex((h) => (h ?? "").trim() === name);
    if (idx >= 0) return idx;
    const n = (name ?? "").trim().toLowerCase();
    return ebayHeader.findIndex((h) => (h ?? "").trim().toLowerCase() === n);
  }

  function deriveSetShort(setFull) {
    const s = String(setFull || "").trim();
    if (!s) return "";
    const noYear = s.replace(/^\d{4}\s+/, "").trim();
    const parts = noYear.split(/\s+/);
    if (parts.length >= 3 && /^[A-Z0-9]{2,}$/.test(parts[parts.length - 1])) parts.pop();
    return parts.slice(0, 2).join(" ");
  }

  function buildEbayAddRowFromInventory(row) {
    const out = new Array(ebayHeader.length).fill("");

    // Your template uses "Add" in column 2 (index 2)
    out[2] = "Add";

    const catIdx = headerIndex("*Category");
    if (catIdx >= 0) out[catIdx] = "261328";

    const titleIdx = headerIndex("*Title");
    if (titleIdx >= 0) out[titleIdx] = buildEbayTitle(row);

    const picIdx = headerIndex("PicURL");
    const img = inv(row, "IMAGE URL");
    if (picIdx >= 0) out[picIdx] = img;

    const playerIdx = headerIndex("C:Player/Athlete");
    if (playerIdx >= 0) out[playerIdx] = inv(row, "Player Name");

    const teamIdx = headerIndex("C:Team");
    if (teamIdx >= 0) out[teamIdx] = invTeam(row);

    const leagueIdx = headerIndex("C:League");
    if (leagueIdx >= 0) out[leagueIdx] = inv(row, "League");

    const parallelIdx = headerIndex("C
