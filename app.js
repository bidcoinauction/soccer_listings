/* Soccer eBay Lister
   - Loads ./full_card_inventory.tsv and ./ebay_listing.csv
   - Shows thumbnails from IMAGE URL
   - Generates File Exchange “Add” row aligned to your existing ebay_listing.csv columns
   - Appends and downloads updated ebay_listing.csv
*/

(() => {
  const $ = (sel) => document.querySelector(sel);

  const els = {
    status: $("#statusText"),
    grid: $("#cardsGrid"),
    search: $("#searchInput"),
    set: $("#setSelect"),
    team: $("#teamSelect"),
    league: $("#leagueSelect"),
    autoOnly: $("#autoOnly"),
    numberedOnly: $("#numberedOnly"),
    clearBtn: $("#clearBtn"),

    backdrop: $("#modalBackdrop"),
    closeModalBtn: $("#closeModalBtn"),

    mTitle: $("#modalTitle"),
    mSet: $("#mSet"),
    mCardNo: $("#mCardNo"),
    mFeatures: $("#mFeatures"),
    mSeason: $("#mSeason"),
    mBrand: $("#mBrand"),
    mCondition: $("#mCondition"),

    mImage: $("#mImage"),
    openImageBtn: $("#openImageBtn"),
    copyImageBtn: $("#copyImageBtn"),

    mName: $("#mName"),
    mTitlePreview: $("#mTitlePreview"),
    mDescPreview: $("#mDescPreview"),
    mCsvRowPreview: $("#mCsvRowPreview"),

    copyTitleBtn: $("#copyTitleBtn"),
    copyDescBtn: $("#copyDescBtn"),
    appendEbayBtn: $("#appendEbayBtn"),

    toast: $("#toast"),
  };

  /** @type {Array<Record<string,string>>} */
  let inventory = [];
  /** @type {Array<Record<string,string>>} */
  let filtered = [];
  /** @type {Record<string,string> | null} */
  let selected = null;

  // eBay template CSV in raw rows (array-of-arrays)
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

  // ===== Inventory field mapping (matches your TSV exactly) =====
  function inv(row, key) {
    return String(row?.[key] ?? "").trim();
  }

  function invTeam(row) {
    // your header is "Team " (with trailing space)
    return (row["Team "] ?? row["Team"] ?? "").toString().trim();
  }

  function firstYearFromText(s) {
    const m = String(s || "").match(/\b(19|20)\d{2}\b/);
    return m ? m[0] : "";
  }

  function normalizeSeason(s) {
    // convert "2023-2024" -> "2023-24"
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
    const lines = tsvText.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n").filter((l) => l.trim() !== "");
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

  // ===== CSV (File Exchange template) =====
  function parseCSV(text) {
    // minimal CSV parser that handles quoted fields and commas/newlines in quotes
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

      if (ch === '"') {
        inQuotes = true;
        i++;
        continue;
      }
      if (ch === ",") {
        row.push(cur);
        cur = "";
        i++;
        continue;
      }
      if (ch === "\n") {
        row.push(cur);
        rows.push(row);
        row = [];
        cur = "";
        i++;
        continue;
      }
      if (ch === "\r") {
        i++;
        continue;
      }

      cur += ch;
      i++;
    }

    row.push(cur);
    rows.push(row);

    // normalize row lengths later
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
    // Your inventory's Card Name is already a strong title; clamp to 80.
    const t = inv(row, "Card Name") || "Soccer Card";
    return clampTitle(t);
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
    ]
      .filter(Boolean)
      .join("");
  }

  // ===== File Exchange row builder (matches your ebay_listing.csv header row) =====
  function headerIndex(name) {
    // exact match first
    const idx = ebayHeader.findIndex((h) => (h ?? "").trim() === name);
    if (idx >= 0) return idx;

    // soft match for safety
    const n = (name ?? "").trim().toLowerCase();
    return ebayHeader.findIndex((h) => (h ?? "").trim().toLowerCase() === n);
  }

  function deriveSetShort(setFull) {
    // Example: "2024 Topps Finest MLS" -> "Topps Finest"
    const s = String(setFull || "").trim();
    if (!s) return "";
    // remove leading year
    const noYear = s.replace(/^\d{4}\s+/, "").trim(); // "Topps Finest MLS"
    // remove trailing league words (MLS, EPL, UEFA, etc.) conservatively: drop last token if all caps
    const parts = noYear.split(/\s+/);
    if (parts.length >= 3 && /^[A-Z0-9]{2,}$/.test(parts[parts.length - 1])) parts.pop();
    // keep first two words usually is set name
    return parts.slice(0, 2).join(" ");
  }

  function buildEbayAddRowFromInventory(row) {
    // Create row aligned to ebayHeader length
    const out = new Array(ebayHeader.length).fill("");

    // Required / common fields based on your existing template header row
    const colAction = 2; // your file uses "Add" in column 2
    out[colAction] = "Add";

    // Category (your existing rows use 261328)
    const catIdx = headerIndex("*Category");
    if (catIdx >= 0) out[catIdx] = "261328";

    // Title
    const titleIdx = headerIndex("*Title");
    if (titleIdx >= 0) out[titleIdx] = buildEbayTitle(row);

    // PicURL (File Exchange supports pipe separated urls)
    const picIdx = headerIndex("PicURL");
    const img = inv(row, "IMAGE URL");
    if (picIdx >= 0) out[picIdx] = img;

    // Basics
    const playerIdx = headerIndex("C:Player/Athlete");
    if (playerIdx >= 0) out[playerIdx] = inv(row, "Player Name");

    const teamIdx = headerIndex("C:Team");
    if (teamIdx >= 0) out[teamIdx] = invTeam(row);

    const leagueIdx = headerIndex("C:League");
    if (leagueIdx >= 0) out[leagueIdx] = inv(row, "League");

    const parallelIdx = headerIndex("C:Parallel/Variety");
    if (parallelIdx >= 0) out[parallelIdx] = inv(row, "Features"); // you already use features like Aqua Refractor

    const cardNoIdx = headerIndex("C:Card Number");
    if (cardNoIdx >= 0) out[cardNoIdx] = inv(row, "Card Number");

    // ConditionID: your existing file uses 4000 (Near Mint or Better)
    const condIdx = headerIndex("*ConditionID");
    if (condIdx >= 0) out[condIdx] = "4000";

    // Autographed (Yes/No) - your template expects C:Autographed
    const autoIdx = headerIndex("C:Autographed");
    if (autoIdx >= 0) out[autoIdx] = isAuto(row) ? "Yes" : "No";

    // C:Features (optional) - keep blank unless you want duplication
    const featIdx = headerIndex("C:Features");
    if (featIdx >= 0) out[featIdx] = ""; // keep as-is (your current rows keep blank)

    // Year Manufactured from Card Set (e.g., 2024 Topps...)
    const yearIdx = headerIndex("C:Year Manufactured");
    if (yearIdx >= 0) out[yearIdx] = firstYearFromText(inv(row, "Card Set")) || firstYearFromText(inv(row, "Card Name"));

    // Season format: "2023-24"
    const seasonIdx = headerIndex("C:Season");
    if (seasonIdx >= 0) out[seasonIdx] = normalizeSeason(inv(row, "Season"));

    // Manufacturer and Set
    const manuIdx = headerIndex("C:Manufacturer");
    if (manuIdx >= 0) out[manuIdx] = inv(row, "Brand");

    const setIdx = headerIndex("C:Set");
    if (setIdx >= 0) out[setIdx] = deriveSetShort(inv(row, "Card Set")) || inv(row, "Brand");

    const cardNameIdx = headerIndex("C:Card Name");
    if (cardNameIdx >= 0) out[cardNameIdx] = inv(row, "Card Name");

    // Sport
    const sportIdx = headerIndex("*C:Sport");
    if (sportIdx >= 0) out[sportIdx] = inv(row, "Sport") || "Soccer";

    // If your template has a Description column, fill it with our HTML
    const descIdx = headerIndex("Description");
    if (descIdx >= 0) out[descIdx] = buildEbayDescriptionHTML(row);

    return out;
  }

  // ===== Download helper =====
  function csvEscapeCell(s) {
    const v = String(s ?? "");
    if (/["\n\r,]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
    return v;
  }

  function toCSV(rows) {
    return rows
      .map((r) => r.map(csvEscapeCell).join(","))
      .join("\n");
  }

  function downloadText(filename, text) {
    const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  // ===== UI rendering =====
  function renderCard(row) {
    const name = inv(row, "Card Name") || "Unnamed card";
    const set = inv(row, "Card Set");
    const team = invTeam(row);
    const league = inv(row, "League");
    const cardNo = inv(row, "Card Number");
    const season = inv(row, "Season");
    const features = inv(row, "Features");
    const img = inv(row, "IMAGE URL");

    const badges = [];
    if (season) badges.push(season);
    if (cardNo) badges.push(`#${cardNo}`);
    if (isAuto(row)) badges.push("AUTO");
    if (isNumbered(row)) badges.push("NUM");
    if (features && /rookie|\brc\b/i.test(features)) badges.push("RC");

    const subBits = [set, team, league].filter(Boolean);
    const sub = subBits.length ? subBits.join(" • ") : "—";

    const el = document.createElement("button");
    el.type = "button";
    el.className = "card";
    el.innerHTML = `
      <div class="thumb">
        ${
          img
            ? `<img src="${escapeHtml(img)}" alt="" loading="lazy" onerror="this.closest('.thumb').innerHTML='<div class=&quot;thumb-fallback&quot;>No image</div>';">`
            : `<div class="thumb-fallback">No image</div>`
        }
      </div>
      <div class="card-main">
        <div class="card-title">${escapeHtml(name)}</div>
        <div class="card-sub">${escapeHtml(sub)}</div>
        <div class="badges">
          ${badges.slice(0, 6).map((b) => `<span class="badge">${escapeHtml(b)}</span>`).join("")}
        </div>
      </div>
    `;
    el.addEventListener("click", () => openModal(row));
    return el;
  }

  function populateSelect(selectEl, values) {
    const current = selectEl.value;
    selectEl.innerHTML = `<option value="">All</option>` + values.map((v) => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join("");
    if (values.includes(current)) selectEl.value = current;
  }

  function syncFilterOptions() {
    populateSelect(els.set, uniqSorted(inventory.map((r) => inv(r, "Card Set"))));
    populateSelect(els.team, uniqSorted(inventory.map((r) => invTeam(r))));
    populateSelect(els.league, uniqSorted(inventory.map((r) => inv(r, "League"))));
  }

  function applyFilters() {
    const q = state.q.trim().toLowerCase();

    filtered = inventory.filter((row) => {
      const set = inv(row, "Card Set");
      const team = invTeam(row);
      const league = inv(row, "League");

      if (state.set && set !== state.set) return false;
      if (state.team && team !== state.team) return false;
      if (state.league && league !== state.league) return false;

      if (state.autoOnly && !isAuto(row)) return false;
      if (state.numberedOnly && !isNumbered(row)) return false;

      if (q) {
        const hay = [
          inv(row, "Card Name"),
          inv(row, "Player Name"),
          set,
          team,
          league,
          inv(row, "Card Number"),
          inv(row, "Features"),
          inv(row, "Season"),
          inv(row, "Brand"),
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }

      return true;
    });

    renderGrid();
    els.status.textContent = `${filtered.length} card${filtered.length === 1 ? "" : "s"} shown`;
  }

  function renderGrid() {
    els.grid.innerHTML = "";
    if (!filtered.length) {
      const empty = document.createElement("div");
      empty.className = "status";
      empty.textContent = "No results. Try clearing filters.";
      els.grid.appendChild(empty);
      return;
    }
    const frag = document.createDocumentFragment();
    filtered.forEach((row) => frag.appendChild(renderCard(row)));
    els.grid.appendChild(frag);
  }

  async function copyToClipboard(text) {
    const t = String(text ?? "");
    try {
      await navigator.clipboard.writeText(t);
      return true;
    } catch {
      const ta = document.createElement("textarea");
      ta.value = t;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      try {
        const ok = document.execCommand("copy");
        document.body.removeChild(ta);
        return ok;
      } catch {
        document.body.removeChild(ta);
        return false;
      }
    }
  }

  let toastTimer = null;
  function showToast(msg = "Copied") {
    els.toast.textContent = msg;
    els.toast.hidden = false;
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => {
      els.toast.hidden = true;
    }, 1200);
  }

  function openModal(row) {
    selected = row;

    const name = inv(row, "Card Name") || "—";
    const set = inv(row, "Card Set") || "—";
    const cardNo = inv(row, "Card Number") || "—";
    const features = inv(row, "Features") || "—";
    const season = inv(row, "Season") || "—";
    const brand = inv(row, "Brand") || "—";
    const condition = inv(row, "Condition") || "—";
    const img = inv(row, "IMAGE URL");

    const ebayTitle = buildEbayTitle(row);
    const descHtml = buildEbayDescriptionHTML(row);

    els.mTitle.textContent = name;
    els.mSet.textContent = set;
    els.mCardNo.textContent = cardNo;
    els.mFeatures.textContent = features;
    els.mSeason.textContent = season;
    els.mBrand.textContent = brand;
    els.mCondition.textContent = condition;

    els.mName.textContent = name;
    els.mTitlePreview.textContent = ebayTitle;
    els.mDescPreview.textContent = descHtml;

    // image
    els.mImage.src = img || "";
    els.mImage.alt = name;
    els.openImageBtn.disabled = !img;
    els.copyImageBtn.disabled = !img;

    // eBay CSV row preview (human readable)
    if (ebayHeader.length) {
      const r = buildEbayAddRowFromInventory(row);
      const previewPairs = [
        ["Action(col2)", r[2]],
        ["*Category", r[headerIndex("*Category")] ?? ""],
        ["*Title", r[headerIndex("*Title")] ?? ""],
        ["PicURL", r[headerIndex("PicURL")] ?? ""],
        ["Player", r[headerIndex("C:Player/Athlete")] ?? ""],
        ["Team", r[headerIndex("C:Team")] ?? ""],
        ["League", r[headerIndex("C:League")] ?? ""],
        ["Parallel/Variety", r[headerIndex("C:Parallel/Variety")] ?? ""],
        ["Card #", r[headerIndex("C:Card Number")] ?? ""],
        ["*ConditionID", r[headerIndex("*ConditionID")] ?? ""],
        ["Autographed", r[headerIndex("C:Autographed")] ?? ""],
        ["Year Manufactured", r[headerIndex("C:Year Manufactured")] ?? ""],
        ["Season", r[headerIndex("C:Season")] ?? ""],
        ["Manufacturer", r[headerIndex("C:Manufacturer")] ?? ""],
        ["Set", r[headerIndex("C:Set")] ?? ""],
        ["Card Name", r[headerIndex("C:Card Name")] ?? ""],
        ["Sport", r[headerIndex("*C:Sport")] ?? ""],
      ];
      els.mCsvRowPreview.textContent = previewPairs.map(([k, v]) => `${k}: ${v || ""}`).join("\n");
    } else {
      els.mCsvRowPreview.textContent = "eBay template not loaded.";
    }

    els.backdrop.hidden = false;
    document.body.style.overflow = "hidden";
    els.closeModalBtn.focus();
  }

  function closeModal() {
    selected = null;
    els.backdrop.hidden = true;
    document.body.style.overflow = "";
  }

  function wireEvents() {
    els.search.addEventListener("input", (e) => {
      state.q = e.target.value || "";
      applyFilters();
    });

    els.set.addEventListener("change", (e) => {
      state.set

