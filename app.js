/* Soccer eBay Lister â€” Inventory UX App
   - Loads ./full_card_inventory.tsv and ./ebay_listing.csv
   - Shows inventory grid with search + filters + selection
   - Exports eBay File Exchange â€œAddâ€ rows as CSV

   Notes:
   - This is a static frontend app. Run via a local server (not file://) so fetch() works.
*/

(() => {
  const $ = (sel) => document.querySelector(sel);

  const els = {
    status: $("#statusText"),
    subTitle: $("#subTitle"),
    grid: $("#cardsGrid"),
    empty: $("#emptyState"),

    sidebar: $("#sidebar"),
    sidebarToggle: $("#sidebarToggle"),
    sidebarClose: $("#sidebarClose"),
    backdrop: $("#backdrop"),

    search: $("#searchInput"),
    clearSearch: $("#clearSearch"),

    set: $("#setSelect"),
    team: $("#teamSelect"),
    league: $("#leagueSelect"),
    year: $("#yearSelect"),
    statusSelect: $("#statusSelect"),
    minPrice: $("#minPrice"),
    maxPrice: $("#maxPrice"),
    hideNoImage: $("#hideNoImage"),
    sort: $("#sortSelect"),
    reset: $("#resetFiltersBtn"),

    kpiTotal: $("#kpiTotal"),
    kpiShown: $("#kpiShown"),
    kpiSelected: $("#kpiSelected"),

    selectAllShown: $("#selectAllShown"),
    clearSelected: $("#clearSelected"),

    exportSelected: $("#exportSelectedBtn"),
    exportAll: $("#exportAllBtn"),

    modal: $("#modal"),
    modalClose: $("#modalClose"),
    modalTitle: $("#modalTitle"),
    modalImg: $("#modalImg"),
    modalSku: $("#modalSku"),
    modalPlayer: $("#modalPlayer"),
    modalSet: $("#modalSet"),
    modalYear: $("#modalYear"),
    modalTeam: $("#modalTeam"),
    modalParallel: $("#modalParallel"),
    modalCondition: $("#modalCondition"),
    modalPrice: $("#modalPrice"),
    modalRaw: $("#modalRaw"),
    toggleSelectBtn: $("#toggleSelectBtn"),
    exportThisBtn: $("#exportThisBtn"),
  };

  const FILES = {
    inventory: "./full_card_inventory.tsv",
    ebay: "./ebay_listing.csv",
  };

  const state = {
    inventoryRaw: [],
    inventoryNorm: [],
    ebayRows: [],
    ebaySkus: new Set(),
    ebayTitles: new Set(),

    filtered: [],
    selectedSkus: new Set(),
    activeModalSku: null,
  };

  // ---------- Helpers ----------
  function setStatus(msg, ok = true) {
    els.status.textContent = msg;
    const dot = document.querySelector(".dot");
    if (dot) {
      dot.style.background = ok ? "rgba(65,226,154,.9)" : "rgba(255,92,122,.9)";
      dot.style.boxShadow = ok ? "0 0 0 4px rgba(65,226,154,.15)" : "0 0 0 4px rgba(255,92,122,.15)";
    }
  }

  function safeStr(v) {
    if (v === null || v === undefined) return "";
    return String(v).trim();
  }

  function toNumber(v) {
    const s = safeStr(v).replace(/[$,]/g, "");
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }

  function uniqSorted(arr) {
    const out = Array.from(new Set(arr.filter(Boolean)));
    out.sort((a, b) => String(a).localeCompare(String(b)));
    return out;
  }


  function slugify(s) {
    return safeStr(s)
      .toLowerCase()
      .replace(/['"]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60);
  }

  function makeSkuFromInventory(raw) {
    // Inventory TSV has no SKU column. Create a stable SKU from key fields.
    const season = safeStr(pick(raw, ["Season", "season"]));
    const player = safeStr(pick(raw, ["Player Name", "Player", "player_name", "Name"]));
    const cardNo = safeStr(pick(raw, ["Card Number", "Card#", "No", "Number", "#"]));
    const features = safeStr(pick(raw, ["Features", "Parallel", "Insert", "Variant"]));
    const set = safeStr(pick(raw, ["Card Set", "Set", "Card Set ", "Set Name", "Product", "Program"]));
    const base = [season, set, player, cardNo, features].filter(Boolean).join(" ");
    return slugify(base) || "";
  }


  function pick(obj, candidates) {
    // return first matching key in obj (case-insensitive)
    const keys = Object.keys(obj || {});
    const lowerMap = new Map(keys.map(k => [k.toLowerCase(), k]));
    for (const c of candidates) {
      const found = lowerMap.get(String(c).toLowerCase());
      if (found) return obj[found];
    }
    return "";
  }

  function downloadText(filename, text, mime = "text/plain;charset=utf-8") {
    const blob = new Blob([text], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  // Robust CSV parse (handles quoted commas/newlines)
  function parseCSV(text) {
    const rows = [];
    let row = [];
    let cur = "";
    let inQuotes = false;

    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      const next = text[i + 1];

      if (ch === '"' && inQuotes && next === '"') {
        cur += '"';
        i++;
        continue;
      }
      if (ch === '"') {
        inQuotes = !inQuotes;
        continue;
      }
      if (!inQuotes && (ch === ",")) {
        row.push(cur);
        cur = "";
        continue;
      }
      if (!inQuotes && (ch === "\n")) {
        row.push(cur);
        rows.push(row);
        row = [];
        cur = "";
        continue;
      }
      if (!inQuotes && (ch === "\r")) continue;

      cur += ch;
    }
    if (cur.length || row.length) {
      row.push(cur);
      rows.push(row);
    }
    return rows;
  }

  function rowsToObjects(rows) {
    // skip info/comment lines if present
    const trimmed = rows.filter(r => r.some(c => safeStr(c) !== ""));
    let headerIdx = 0;
    while (headerIdx < trimmed.length && safeStr(trimmed[headerIdx][0]).startsWith("#")) headerIdx++;

    const header = trimmed[headerIdx] || [];
    const out = [];
    for (let i = headerIdx + 1; i < trimmed.length; i++) {
      const r = trimmed[i];
      const obj = {};
      for (let j = 0; j < header.length; j++) {
        const key = safeStr(header[j]) || `col_${j}`;
        obj[key] = r[j] ?? "";
      }
      out.push(obj);
    }
    return { header, out };
  }

  function parseTSV(text) {
    const lines = text.split(/\r?\n/).filter(l => l.trim().length);
    const rows = lines.map(l => l.split("\t"));
    const header = rows[0] || [];
    const out = [];
    for (let i = 1; i < rows.length; i++) {
      const obj = {};
      for (let j = 0; j < header.length; j++) {
        const key = safeStr(header[j]) || `col_${j}`;
        obj[key] = rows[i][j] ?? "";
      }
      out.push(obj);
    }
    return { header, out };
  }

    function normalizeCard(raw) {
    // Inventory TSV schema (your file): Card Name, Player Name, Sport, Card Number, Features,
    // IMAGE URL, League, Team, Season, Condition, Brand, Card Set, Quanitity
    const sku =
      safeStr(pick(raw, ["Custom label (SKU)", "SKU", "CustomLabel"])) ||
      makeSkuFromInventory(raw);

    const player = safeStr(pick(raw, ["Player Name", "Player", "player_name", "Name", "Athlete", "Subject"]));
    const set = safeStr(pick(raw, ["Card Set", "Card Set ", "Set", "Product", "Program", "Collection", "Brand", "Set Name"]));
    const team = safeStr(pick(raw, ["Team", "Team ", "Club", "team_name"]));
    const league = safeStr(pick(raw, ["League", "competition", "League/Competition"]));
    const season = safeStr(pick(raw, ["Season", "season"]));
    const year = safeStr(pick(raw, ["Year", "Release Year"])) || (season ? season.split("-")[0] : "");
    const cardNo = safeStr(pick(raw, ["Card Number", "Card#", "No", "Number", "#"]));

    const features = safeStr(pick(raw, ["Features"]));
    const parallel = safeStr(pick(raw, ["Parallel", "Parallels", "Variant", "Color", "Refractor"])) || features;
    const insert = safeStr(pick(raw, ["Insert", "Insert Set", "Subset"]));

    const condition = safeStr(pick(raw, ["Condition", "Condition ID", "Grade", "Grading", "Raw/Graded"])) || "New";
    const price = toNumber(pick(raw, ["Price", "List Price", "Your Price", "Asking", "Value"]));
    const qty = toNumber(pick(raw, ["Quantity", "Qty", "Count", "Quanitity", "Quanitity "])) ?? 1;

    const imageUrl = safeStr(
      pick(raw, [
        "IMAGE URL",
        "Image",
        "Image URL",
        "ImageURL",
        "Photo",
        "Photo URL",
        "Item photo URL",
        "Front Image",
        "Front",
        "img",
        "thumbnail",
      ])
    );

    const titleHint = safeStr(pick(raw, ["Card Name"])) || [
      year, set, player, insert || parallel, cardNo ? `#${cardNo}` : ""
    ].filter(Boolean).join(" ");

    return {
      sku,
      player,
      set,
      team,
      league,
      year,
      season,
      cardNo,
      parallel,
      insert,
      features,
      condition,
      price,
      qty,
      imageUrl,
      titleHint,
      raw,
    };
  }

  function buildDisplayTitle(c) {
    // Prefer the inventory-provided Card Name (titleHint) when available
    if (c.titleHint) return String(c.titleHint).trim() || "Card";
    const chunks = [];
    if (c.year) chunks.push(c.year);
    if (c.set) chunks.push(c.set);
    if (c.player) chunks.push(c.player);
    const detail = [c.insert, c.parallel].filter(Boolean).join(" â€¢ ");
    if (detail) chunks.push(detail);
    if (c.cardNo) chunks.push(`#${c.cardNo}`);
    return chunks.join(" â€” ").trim() || "Card";
  }

  function buildSublineLeft(c) {
    const left = [c.team, c.league].filter(Boolean).join(" â€¢ ");
    return left || (c.set ? c.set : "â€”");
  }

  function isListedBySku(sku, cardTitle = "") {
    // Prefer SKU match (if your eBay CSV uses CustomLabel). Otherwise fallback to title match.
    if (sku && state.ebaySkus.has(String(sku).trim())) return true;
    const t = safeStr(cardTitle).toLowerCase();
    if (t && state.ebayTitles.has(t)) return true;
    return false;
  }

  function cardMatchesSearch(c, q) {
    if (!q) return true;
    const hay = [
      c.sku, c.player, c.team, c.league, c.set, c.year, c.parallel, c.insert, c.serial, c.cardNo
    ].filter(Boolean).join(" ").toLowerCase();
    return hay.includes(q.toLowerCase());
  }

  // ---------- UI: sidebar & modal ----------
  function setSidebarOpen(open) {
    const isMobile = window.matchMedia("(max-width: 900px)").matches;
    if (!isMobile) return;
    els.sidebar.classList.toggle("open", open);
    els.backdrop.hidden = !open;
    document.body.style.overflow = open ? "hidden" : "";
  }

  function setModalOpen(open) {
    els.modal.hidden = !open;
    els.backdrop.hidden = !open;
    document.body.style.overflow = open ? "hidden" : "";
  }

  function openModal(card) {
    state.activeModalSku = card.sku || null;

    els.modalTitle.textContent = buildDisplayTitle(card);
    els.modalImg.src = card.imageUrl || "";
    els.modalImg.alt = buildDisplayTitle(card);

    els.modalSku.textContent = card.sku || "â€”";
    els.modalPlayer.textContent = card.player || "â€”";
    els.modalSet.textContent = card.set || "â€”";
    els.modalYear.textContent = card.year || "â€”";
    els.modalTeam.textContent = [card.team, card.league].filter(Boolean).join(" â€¢ ") || "â€”";
    els.modalParallel.textContent = [card.insert, card.parallel, card.auto, card.serial].filter(Boolean).join(" â€¢ ") || "â€”";
    els.modalCondition.textContent = card.condition || "â€”";
    els.modalPrice.textContent = (card.price != null ? `$${card.price}` : "â€”");

    els.modalRaw.textContent = JSON.stringify(card.raw, null, 2);

    const selected = card.sku && state.selectedSkus.has(card.sku);
    els.toggleSelectBtn.textContent = selected ? "Unselect" : "Select";

    setModalOpen(true);
  }

  // ---------- Filters ----------
  function populateSelect(selectEl, values) {
    const cur = selectEl.value;
    selectEl.innerHTML = `<option value="">All</option>` + values.map(v => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join("");
    // try to keep current selection if still present
    if (values.includes(cur)) selectEl.value = cur;
  }

  function escapeHtml(s) {
    return String(s ?? "")
      .replaceAll("&","&amp;")
      .replaceAll("<","&lt;")
      .replaceAll(">","&gt;")
      .replaceAll('"',"&quot;")
      .replaceAll("'","&#039;");
  }

  function refreshFilterOptions(cards) {
    populateSelect(els.set, uniqSorted(cards.map(c => c.set)));
    populateSelect(els.team, uniqSorted(cards.map(c => c.team)));
    populateSelect(els.league, uniqSorted(cards.map(c => c.league)));
    // year should sort numerically when possible
    const years = uniqSorted(cards.map(c => c.year));
    years.sort((a,b) => (Number(b) || 0) - (Number(a) || 0));
    populateSelect(els.year, years);
  }

  function getFilters() {
    return {
      q: safeStr(els.search.value),
      set: safeStr(els.set.value),
      team: safeStr(els.team.value),
      league: safeStr(els.league.value),
      year: safeStr(els.year.value),
      status: safeStr(els.statusSelect.value),
      minPrice: toNumber(els.minPrice.value),
      maxPrice: toNumber(els.maxPrice.value),
      hideNoImage: !!els.hideNoImage.checked,
      sort: safeStr(els.sort.value),
    };
  }

  function applyFilters() {
    const f = getFilters();
    const out = [];

    for (const c of state.inventoryNorm) {
      if (f.set && c.set !== f.set) continue;
      if (f.team && c.team !== f.team) continue;
      if (f.league && c.league !== f.league) continue;
      if (f.year && c.year !== f.year) continue;

      const listed = isListedBySku(c.sku, buildDisplayTitle(c));
      if (f.status === "listed" && !listed) continue;
      if (f.status === "unlisted" && listed) continue;

      if (f.hideNoImage && !c.imageUrl) continue;

      if (f.minPrice != null && (c.price == null || c.price < f.minPrice)) continue;
      if (f.maxPrice != null && (c.price == null || c.price > f.maxPrice)) continue;

      if (!cardMatchesSearch(c, f.q)) continue;

      out.push(c);
    }

    // Sorting
    out.sort((a, b) => {
      switch (f.sort) {
        case "player": return (a.player || "").localeCompare(b.player || "");
        case "year_desc": return (Number(b.year) || 0) - (Number(a.year) || 0);
        case "year_asc": return (Number(a.year) || 0) - (Number(b.year) || 0);
        case "price_desc": return (Number(b.price) || 0) - (Number(a.price) || 0);
        case "price_asc": return (Number(a.price) || 0) - (Number(b.price) || 0);
        default: return 0;
      }
    });

    state.filtered = out;
    render();
  }

  // ---------- Render ----------
  function render() {
    const cards = state.filtered;

    els.kpiTotal.textContent = `Total: ${state.inventoryNorm.length}`;
    els.kpiShown.textContent = `Shown: ${cards.length}`;
    els.kpiSelected.textContent = `Selected: ${state.selectedSkus.size}`;

    els.exportSelected.disabled = state.selectedSkus.size === 0;

    els.grid.innerHTML = "";

    if (!cards.length) {
      els.empty.hidden = false;
      return;
    }
    els.empty.hidden = true;

    const frag = document.createDocumentFragment();

    for (const c of cards) {
      const listed = isListedBySku(c.sku, buildDisplayTitle(c));
      const selected = c.sku && state.selectedSkus.has(c.sku);

      const el = document.createElement("article");
      el.className = "card" + (selected ? " selected" : "");
      el.tabIndex = 0;

      const title = buildDisplayTitle(c);
      const subLeft = buildSublineLeft(c);
      const priceStr = c.price != null ? `$${c.price}` : "â€”";

      el.innerHTML = `
        <div class="thumb">
          ${c.imageUrl
            ? `<img loading="lazy" referrerpolicy="no-referrer" src="${escapeHtml(c.imageUrl)}" alt="${escapeHtml(title)}">`
            : `<div style="color: rgba(255,255,255,.45); font-size: 12px;">No image</div>`
          }
          <div class="badgeRow">
            <span class="badge ${listed ? "ok" : "warn"}">${listed ? "Listed" : "Unlisted"}</span>
            <span class="badge">${escapeHtml(c.sku || "No SKU")}</span>
          </div>
        </div>
        <div class="cardBody">
          <div class="titleLine">${escapeHtml(title)}</div>
          <div class="subLine">
            <div class="subLeft">${escapeHtml(subLeft || "â€”")}</div>
            <div class="subRight">${escapeHtml(priceStr)}</div>
          </div>
        </div>
      `;

      el.addEventListener("click", () => openModal(c));
      el.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          openModal(c);
        }
      });

      frag.appendChild(el);
    }

    els.grid.appendChild(frag);
  }

  // ---------- eBay export ----------
  function buildEbayAddRowFromCard(c) {
    // We will produce a conservative â€œAddâ€ row aligned to common eBay File Exchange headers.
    // If your ebay_listing.csv has a different header set, weâ€™ll map into it when exporting.

    const title = buildDisplayTitle(c).slice(0, 80); // keep a safe-ish title length
    const description = [
      c.player ? `<b>Player:</b> ${escapeHtml(c.player)}` : "",
      c.set ? `<b>Set:</b> ${escapeHtml(c.set)}` : "",
      c.team ? `<b>Team:</b> ${escapeHtml(c.team)}` : "",
      c.league ? `<b>League:</b> ${escapeHtml(c.league)}` : "",
      c.year ? `<b>Year:</b> ${escapeHtml(c.year)}` : "",
      c.insert ? `<b>Insert:</b> ${escapeHtml(c.insert)}` : "",
      c.parallel ? `<b>Parallel:</b> ${escapeHtml(c.parallel)}` : "",
      c.serial ? `<b>Serial:</b> ${escapeHtml(c.serial)}` : "",
      c.cardNo ? `<b>Card #:</b> ${escapeHtml(c.cardNo)}` : "",
      c.condition ? `<b>Condition:</b> ${escapeHtml(c.condition)}` : "",
    ].filter(Boolean).join("<br>");

    return {
      // Generic headers (some templates use these)
      "Action": "Add",
      "Custom label (SKU)": c.sku || "",
      "Title": title,
      "Price": c.price != null ? String(c.price) : "",
      "Quantity": String(c.qty ?? 1),
      "Item photo URL": c.imageUrl || "",
      "Description": description || "",

      // eBay fx_category_template_EBAY_US headers (your ebay_listing.csv)
      "*Action(SiteID=US|Country=US|Currency=USD|Version=1193|CC=UTF-8)": "Add",
      "CustomLabel": c.sku || "",
      "*Category": "261328",
      "*Title": title,
      "PicURL": c.imageUrl || "",
      "C:Player/Athlete": c.player || "",
      "C:Team": c.team || "",
      "C:League": c.league || "",
      "C:Parallel/Variety": c.parallel || c.features || "",
      "C:Card Number": c.cardNo || "",
      "*ConditionID": "4000",
      "C:Features": c.features || "",
      "C:Year Manufactured": c.year || "",
      "C:Season": c.season || "",
      "C:Set": c.set || "",
      "C:Card Name": title,
    };
  }

  function csvEscape(v) {
    const s = safeStr(v);
    if (/[,"\n\r]/.test(s)) return `"${s.replaceAll('"','""')}"`;
    return s;
  }

  function exportCards(cards, modeLabel) {
    if (!cards.length) {
      setStatus("Nothing to export.", false);
      return;
    }

    // If we can detect an existing ebay_listing.csv header, we will align to it.
    let header = null;
    if (state.ebayRows && state.ebayRows.header && state.ebayRows.header.length) {
      header = state.ebayRows.header;
    }

    const addRows = cards.map(buildEbayAddRowFromCard);

    // If no header found, use a sane default.
    const defaultHeader = [
      "Action",
      "Custom label (SKU)",
      "Title",
      "Price",
      "Quantity",
      "Item photo URL",
      "Description"
    ];

    const outHeader = header && header.length ? header : defaultHeader;

    const lines = [];
    lines.push(outHeader.map(csvEscape).join(","));

    for (const r of addRows) {
      const line = outHeader.map(h => csvEscape(r[h] ?? ""));
      lines.push(line.join(","));
    }

    const ts = new Date().toISOString().slice(0,19).replaceAll(":","-");
    downloadText(`ebay_add_${modeLabel}_${ts}.csv`, lines.join("\n"), "text/csv;charset=utf-8");
    setStatus(`Exported ${cards.length} row(s) to CSV.`);
  }

  // ---------- Load data ----------
  async function loadText(url) {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`${url} â†’ ${res.status}`);
    return await res.text();
  }

  async function boot() {
    try {
      setStatus("Loading inventory + eBay listingsâ€¦");

      const [tsvText, csvText] = await Promise.all([
        loadText(FILES.inventory),
        loadText(FILES.ebay),
      ]);

      // Parse inventory TSV
      const inv = parseTSV(tsvText);
      state.inventoryRaw = inv.out;
      state.inventoryNorm = inv.out.map(normalizeCard);

      // Parse ebay CSV (your file may have HTML appended after the CSV section)
      const lines = csvText.split(/\r?\n/);
      const csvOnly = takeWhileLines(lines, (l) => {
        const t = l.trimStart();
        return !(t.startsWith("<") || t.startsWith("<!--"));
      }).join("\n");

      const csvRows = parseCSV(csvOnly);
      const ebay = rowsToObjects(csvRows);
      state.ebayRows = ebay;

      // Build SKU + Title sets from ebay csv.
      // Your template uses "CustomLabel" (and sometimes leaves it blank),
      // so we also index titles to detect "listed" status.
      const skus = new Set();
      const titles = new Set();

      for (const row of ebay.out) {
        const sku = safeStr(pick(row, ["Custom label (SKU)", "SKU", "Custom label", "CustomLabel"]));
        if (sku) skus.add(sku);

        const title =
          safeStr(pick(row, ["*Title", "Title", "StoreCategory"])) ||
          ""; // (some exports shift title into StoreCategory)
        if (title) titles.add(title.toLowerCase());
      }

      state.ebaySkus = skus;
      state.ebayTitles = titles;

      // Subtitle
      els.subTitle.textContent = `${state.inventoryNorm.length} cards â€¢ ${state.ebaySkus.size} SKU matches â€¢ ${state.ebayTitles.size} title matches`;

      // Filters
      refreshFilterOptions(state.inventoryNorm);

      // Initial filtered set
      state.filtered = [...state.inventoryNorm];
      applyFilters();

      setStatus("Ready.");
    } catch (err) {
      console.error(err);
      els.subTitle.textContent = "Load failed";
      setStatus(`Error loading files. Are you running via http server? (${err.message})`, false);
    }
  }

  // ---------- Events ----------
  function wireEvents() {
    // Sidebar
    els.sidebarToggle.addEventListener("click", () => setSidebarOpen(true));
    els.sidebarClose.addEventListener("click", () => setSidebarOpen(false));
    els.backdrop.addEventListener("click", () => {
      // close sidebar on mobile OR close modal
      if (!els.modal.hidden) setModalOpen(false);
      setSidebarOpen(false);
    });

    // Search
    els.search.addEventListener("input", debounce(applyFilters, 120));
    els.clearSearch.addEventListener("click", () => {
      els.search.value = "";
      applyFilters();
      els.search.focus();
    });

    // Filters
    [els.set, els.team, els.league, els.year, els.statusSelect, els.hideNoImage, els.sort].forEach(el => {
      el.addEventListener("change", applyFilters);
    });
    [els.minPrice, els.maxPrice].forEach(el => el.addEventListener("input", debounce(applyFilters, 180)));

    els.reset.addEventListener("click", () => {
      els.search.value = "";
      els.set.value = "";
      els.team.value = "";
      els.league.value = "";
      els.year.value = "";
      els.statusSelect.value = "";
      els.minPrice.value = "";
      els.maxPrice.value = "";
      els.hideNoImage.checked = false;
      els.sort.value = "recent";
      applyFilters();
    });

    // Selection controls
    els.selectAllShown.addEventListener("click", () => {
      for (const c of state.filtered) {
        if (c.sku) state.selectedSkus.add(c.sku);
      }
      applyFilters(); // will rerender + update KPIs
    });

    els.clearSelected.addEventListener("click", () => {
      state.selectedSkus.clear();
      applyFilters();
    });

    // Export buttons
    els.exportSelected.addEventListener("click", () => {
      const cards = state.inventoryNorm.filter(c => c.sku && state.selectedSkus.has(c.sku));
      exportCards(cards, "selected");
    });

    els.exportAll.addEventListener("click", () => {
      exportCards(state.filtered, "filtered");
    });

    // Modal controls
    els.modalClose.addEventListener("click", () => setModalOpen(false));
    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        if (!els.modal.hidden) setModalOpen(false);
        setSidebarOpen(false);
      }
    });

    els.toggleSelectBtn.addEventListener("click", () => {
      const sku = state.activeModalSku;
      if (!sku) return;
      if (state.selectedSkus.has(sku)) state.selectedSkus.delete(sku);
      else state.selectedSkus.add(sku);

      els.toggleSelectBtn.textContent = state.selectedSkus.has(sku) ? "Unselect" : "Select";
      applyFilters();
    });

    els.exportThisBtn.addEventListener("click", () => {
      const sku = state.activeModalSku;
      if (!sku) return;
      const card = state.inventoryNorm.find(c => c.sku === sku);
      if (card) exportCards([card], "single");
    });

    // Resize behavior
    window.addEventListener("resize", () => {
      // if desktop, ensure sidebar/backdrop arenâ€™t in mobile state
      const isMobile = window.matchMedia("(max-width: 900px)").matches;
      if (!isMobile) {
        els.sidebar.classList.remove("open");
        els.backdrop.hidden = true;
        document.body.style.overflow = "";
      }
    });
  }

  function takeWhileLines(lines, predicate) {
    const out = [];
    for (const l of lines) {
      if (!predicate(l)) break;
      out.push(l);
    }
    return out;
  }

  function debounce(fn, ms) {
    let t = null;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), ms);
    };
  }

  // ---------- Start ----------
  wireEvents();
  boot();
})();

