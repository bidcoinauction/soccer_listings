/* Soccer eBay Lister
   - Loads ./full_card_inventory.tsv and ./ebay_listing.csv
   - Shows thumbnails from IMAGE URL
   - Generates File Exchange “Add” row aligned to your existing ebay_listing.csv columns
   - Appends and downloads updated ebay_listing.csv
*/

(() => {
  const qs = (sel, root = document) => root.querySelector(sel);

  // Grab element by trying multiple selectors (supports old + new markup)
  const pick = (...sels) => {
    for (const s of sels) {
      const el = qs(s);
      if (el) return el;
    }
    return null;
  };

  const els = {
    // status / grid
    status: pick("#statusText", "#resultCount"),
    activeFilters: pick("#activeFilters"),
    grid: pick("#cardsGrid", "#cardGrid"),
    emptyState: pick("#emptyState"),

    // filters
    search: pick("#searchInput"),
    set: pick("#setSelect", "#setFilter"),
    team: pick("#teamSelect", "#teamFilter"),
    league: pick("#leagueSelect", "#leagueFilter"),
    autoOnly: pick("#autoOnly"),
    numberedOnly: pick("#numberedOnly"),
    clearBtn: pick("#clearBtn", "#clearFilters"),

    // modal
    backdrop: pick("#modalBackdrop"),
    modal: pick("#detailsModal"),
    closeModalBtn: pick("#closeModalBtn", "#closeModal"),

    mTitle: pick("#modalTitle"),
    mSet: pick("#mSet", "#modalSet"),
    mCardNo: pick("#mCardNo", "#modalCardNumber"),
    mFeatures: pick("#mFeatures", "#modalFeatures"),
    mSeason: pick("#mSeason", "#modalSeason"),
    mBrand: pick("#mBrand", "#modalBrand"),
    mCondition: pick("#mCondition", "#modalCondition"),

    mImage: pick("#mImage"),
    openImageBtn: pick("#openImageBtn"),
    copyImageBtn: pick("#copyImageBtn"),

    mName: pick("#mName", "#modalCardName"),
    mTitlePreview: pick("#mTitlePreview"),
    mDescPreview: pick("#mDescPreview"),
    mCsvRowPreview: pick("#mCsvRowPreview"),

    copyTitleBtn: pick("#copyTitleBtn"),
    copyDescBtn: pick("#copyDescBtn"),
    appendEbayBtn: pick("#appendEbayBtn"),

    // toast
    toast: pick("#toast"),
    toastText: pick("#toastText"),
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

    const parallelIdx = headerIndex("C:Parallel/Variety");
    if (parallelIdx >= 0) out[parallelIdx] = inv(row, "Features");

    const cardNoIdx = headerIndex("C:Card Number");
    if (cardNoIdx >= 0) out[cardNoIdx] = inv(row, "Card Number");

    const condIdx = headerIndex("*ConditionID");
    if (condIdx >= 0) out[condIdx] = "4000";

    const autoIdx = headerIndex("C:Autographed");
    if (autoIdx >= 0) out[autoIdx] = isAuto(row) ? "Yes" : "No";

    const featIdx = headerIndex("C:Features");
    if (featIdx >= 0) out[featIdx] = "";

    const yearIdx = headerIndex("C:Year Manufactured");
    if (yearIdx >= 0) out[yearIdx] = firstYearFromText(inv(row, "Card Set")) || firstYearFromText(inv(row, "Card Name"));

    const seasonIdx = headerIndex("C:Season");
    if (seasonIdx >= 0) out[seasonIdx] = normalizeSeason(inv(row, "Season"));

    const manuIdx = headerIndex("C:Manufacturer");
    if (manuIdx >= 0) out[manuIdx] = inv(row, "Brand");

    const setIdx = headerIndex("C:Set");
    if (setIdx >= 0) out[setIdx] = deriveSetShort(inv(row, "Card Set")) || inv(row, "Brand");

    const cardNameIdx = headerIndex("C:Card Name");
    if (cardNameIdx >= 0) out[cardNameIdx] = inv(row, "Card Name");

    const sportIdx = headerIndex("*C:Sport");
    if (sportIdx >= 0) out[sportIdx] = inv(row, "Sport") || "Soccer";

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
    return rows.map((r) => r.map(csvEscapeCell).join(",")).join("\n");
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
            ? `<img src="${escapeHtml(img)}" alt="" loading="lazy"
                 onerror="this.closest('.thumb').innerHTML='<div class=&quot;thumb-fallback&quot;>No image</div>';">`
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
    if (!selectEl) return;
    const current = selectEl.value;
    selectEl.innerHTML =
      `<option value="">All</option>` + values.map((v) => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join("");
    if (values.includes(current)) selectEl.value = current;
  }

  function syncFilterOptions() {
    populateSelect(els.set, uniqSorted(inventory.map((r) => inv(r, "Card Set"))));
    populateSelect(els.team, uniqSorted(inventory.map((r) => invTeam(r))));
    populateSelect(els.league, uniqSorted(inventory.map((r) => inv(r, "League"))));
  }

  function updateActiveFilters() {
    if (!els.activeFilters) return;
    const parts = [];
    if (state.set) parts.push(`Set: ${state.set}`);
    if (state.team) parts.push(`Team: ${state.team}`);
    if (state.league) parts.push(`League: ${state.league}`);
    if (state.autoOnly) parts.push(`Auto only`);
    if (state.numberedOnly) parts.push(`Numbered only`);
    if (state.q.trim()) parts.push(`Search: “${safeText(state.q)}”`);
    els.activeFilters.textContent = parts.length ? parts.join(" • ") : "";
  }

  function toggleEmptyState(isEmpty) {
    if (els.emptyState) els.emptyState.hidden = !isEmpty;
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
    if (els.status) els.status.textContent = `${filtered.length} card${filtered.length === 1 ? "" : "s"} shown`;
    updateActiveFilters();
    toggleEmptyState(filtered.length === 0);
  }

  function renderGrid() {
    if (!els.grid) return;
    els.grid.innerHTML = "";

    if (!filtered.length) return;

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
    if (!els.toast) return;
    if (els.toastText) els.toastText.textContent = msg;
    else els.toast.textContent = msg;

    els.toast.hidden = false;
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => {
      els.toast.hidden = true;
    }, 1200);
  }

  // ===== Modal open/close =====
  let lastFocus = null;

  function setModalOpen(open) {
    const modal = els.modal;
    const backdrop = els.backdrop;

    if (backdrop) backdrop.hidden = !open;
    if (modal) modal.hidden = !open;

    document.body.style.overflow = open ? "hidden" : "";

    if (open) {
      lastFocus = document.activeElement;
      (els.closeModalBtn || modal)?.focus?.();
    } else {
      if (lastFocus && lastFocus.focus) lastFocus.focus();
      lastFocus = null;
    }
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

    if (els.mTitle) els.mTitle.textContent = name;
    if (els.mSet) els.mSet.textContent = set;
    if (els.mCardNo) els.mCardNo.textContent = cardNo;
    if (els.mFeatures) els.mFeatures.textContent = features;
    if (els.mSeason) els.mSeason.textContent = season;
    if (els.mBrand) els.mBrand.textContent = brand;
    if (els.mCondition) els.mCondition.textContent = condition;

    if (els.mName) els.mName.textContent = name;
    if (els.mTitlePreview) els.mTitlePreview.textContent = ebayTitle;

    // Show the HTML string as text (preview), not rendered HTML:
    if (els.mDescPreview) els.mDescPreview.textContent = descHtml;

    // image (optional in your new drawer)
    if (els.mImage) {
      els.mImage.src = img || "";
      els.mImage.alt = name;
    }
    if (els.openImageBtn) els.openImageBtn.disabled = !img;
    if (els.copyImageBtn) els.copyImageBtn.disabled = !img;

    // eBay CSV row preview (human readable)
    if (els.mCsvRowPreview) {
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
    }

    setModalOpen(true);
  }

  function closeModal() {
    selected = null;
    setModalOpen(false);
  }

  // ===== Events =====
  function wireEvents() {
    if (els.search) {
      els.search.addEventListener("input", (e) => {
        state.q = e.target.value || "";
        applyFilters();
      });
    }

    if (els.set) {
      els.set.addEventListener("change", (e) => {
        state.set = e.target.value || "";
        applyFilters();
      });
    }

    if (els.team) {
      els.team.addEventListener("change", (e) => {
        state.team = e.target.value || "";
        applyFilters();
      });
    }

    if (els.league) {
      els.league.addEventListener("change", (e) => {
        state.league = e.target.value || "";
        applyFilters();
      });
    }

    if (els.autoOnly) {
      els.autoOnly.addEventListener("change", (e) => {
        state.autoOnly = !!e.target.checked;
        applyFilters();
      });
    }

    if (els.numberedOnly) {
      els.numberedOnly.addEventListener("change", (e) => {
        state.numberedOnly = !!e.target.checked;
        applyFilters();
      });
    }

    if (els.clearBtn) {
      els.clearBtn.addEventListener("click", () => {
        state.q = "";
        state.set = "";
        state.team = "";
        state.league = "";
        state.autoOnly = false;
        state.numberedOnly = false;

        if (els.search) els.search.value = "";
        if (els.set) els.set.value = "";
        if (els.team) els.team.value = "";
        if (els.league) els.league.value = "";
        if (els.autoOnly) els.autoOnly.checked = false;
        if (els.numberedOnly) els.numberedOnly.checked = false;

        applyFilters();
      });
    }

    // modal close
    if (els.closeModalBtn) els.closeModalBtn.addEventListener("click", closeModal);

    // click backdrop to close
    if (els.backdrop) {
      els.backdrop.addEventListener("click", (e) => {
        // only close if clicking directly on backdrop, not on modal itself
        if (e.target === els.backdrop) closeModal();
      });
    }

    // esc to close
    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        const open = (els.backdrop && !els.backdrop.hidden) || (els.modal && !els.modal.hidden);
        if (open) closeModal();
      }
    });

    // Copy title/desc
    if (els.copyTitleBtn) {
      els.copyTitleBtn.addEventListener("click", async () => {
        if (!selected) return;
        const ok = await copyToClipboard(buildEbayTitle(selected));
        showToast(ok ? "Title copied" : "Copy failed");
      });
    }

    if (els.copyDescBtn) {
      els.copyDescBtn.addEventListener("click", async () => {
        if (!selected) return;
        const ok = await copyToClipboard(buildEbayDescriptionHTML(selected));
        showToast(ok ? "Description copied" : "Copy failed");
      });
    }

    // Open image in new tab
    if (els.openImageBtn) {
      els.openImageBtn.addEventListener("click", () => {
        if (!selected) return;
        const img = inv(selected, "IMAGE URL");
        if (!img) return;
        window.open(img, "_blank", "noopener,noreferrer");
      });
    }

    // Copy image URL
    if (els.copyImageBtn) {
      els.copyImageBtn.addEventListener("click", async () => {
        if (!selected) return;
        const img = inv(selected, "IMAGE URL");
        if (!img) return;
        const ok = await copyToClipboard(img);
        showToast(ok ? "Image URL copied" : "Copy failed");
      });
    }

    // Append eBay row + download updated CSV
    if (els.appendEbayBtn) {
      els.appendEbayBtn.addEventListener("click", () => {
        if (!selected) return;
        if (!ebayRows.length || !ebayHeader.length) {
          showToast("eBay CSV not loaded");
          return;
        }

        const addRow = buildEbayAddRowFromInventory(selected);

        // Ensure same length as header row
        const targetLen = ebayHeader.length;
        while (addRow.length < targetLen) addRow.push("");
        if (addRow.length > targetLen) addRow.length = targetLen;

        ebayRows.push(addRow);

        const updated = toCSV(ebayRows);
        downloadText("ebay_listing_UPDATED.csv", updated);
        showToast("Downloaded updated CSV");
      });
    }
  }

  // ===== Data load =====
  async function loadAll() {
    try {
      if (els.status) els.status.textContent = "Loading inventory…";

      const [tsvRes, csvRes] = await Promise.all([
        fetch("./full_card_inventory.tsv", { cache: "no-store" }),
        fetch("./ebay_listing.csv", { cache: "no-store" }),
      ]);

      if (!tsvRes.ok) throw new Error(`TSV load failed: ${tsvRes.status}`);
      if (!csvRes.ok) throw new Error(`CSV load failed: ${csvRes.status}`);

      const [tsvText, csvText] = await Promise.all([tsvRes.text(), csvRes.text()]);

      inventory = parseTSV(tsvText);

      ebayRows = parseCSV(csvText);

      // Your File Exchange template often has a preface row,
      // and the header row is row index 1 (your comment).
      ebayHeader = (ebayRows[1] || []).map((x) => String(x ?? "").trim());

      syncFilterOptions();

      // initial render
      filtered = inventory.slice();
      applyFilters();

      if (els.status) els.status.textContent = `${filtered.length} cards shown`;
    } catch (err) {
      console.error(err);
      if (els.status) els.status.textContent = "Error loading inventory files.";
      if (els.grid) {
        els.grid.innerHTML = `<div class="status">Failed to load data. Check that full_card_inventory.tsv and ebay_listing.csv exist at repo root.</div>`;
      }
    }
  }

  // Boot
  wireEvents();
  loadAll();
})();

