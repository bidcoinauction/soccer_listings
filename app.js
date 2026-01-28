const $ = (id) => document.getElementById(id);

let ALL = [];
let FILTERED = [];
let SELECTED = null;

function clean(s) {
  return (s ?? "").toString().trim().replace(/\s+/g, " ");
}

function inferYear(text) {
  const m = (text || "").match(/\b(19\d{2}|20\d{2})\b/);
  return m ? m[1] : "";
}

function inferSerial(text) {
  const m = (text || "").match(/\/\s*(\d{1,4})\b/);
  return m ? m[1] : "";
}

function inferAuto(text) {
  return /\b(auto|autograph)\b/i.test(text || "");
}

function parseTSV(tsv) {
  const lines = tsv.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];

  const header = lines[0].split("\t").map(clean);
  const idx = (name) => header.findIndex((h) => h === name);

  const get = (row, names) => {
    for (const n of names) {
      const i = idx(n);
      if (i >= 0) return clean(row[i] ?? "");
    }
    return "";
  };

  const out = [];
  for (let i = 1; i < lines.length; i++) {
    const row = lines[i].split("\t");

    const cardName = get(row, ["Card Name"]);
    const playerName = get(row, ["Player Name"]);
    const team = get(row, ["Team", "Team "]);
    const league = get(row, ["League"]);
    const cardSet = get(row, ["Card Set"]);
    const features = get(row, ["Features"]);
    const imageUrl = get(row, ["IMAGE URL", "Image URL", "IMAGE_URL"]);
    const cardNumber = get(row, ["Card Number"]);

    const year = inferYear(cardName) || inferYear(cardSet);
    const serial = inferSerial(features) || inferSerial(cardName);
    const isAuto = inferAuto(`${features} ${cardName}`);

    out.push({
      cardName,
      playerName,
      sport: get(row, ["Sport"]),
      cardNumber,
      features,
      imageUrl,
      league,
      team,
      season: get(row, ["Season"]),
      condition: get(row, ["Condition"]),
      brand: get(row, ["Brand"]),
      cardSet,
      year,
      serial,
      isAuto,
    });
  }
  return out;
}

function uniq(vals) {
  return Array.from(new Set(vals.filter(Boolean))).sort((a, b) => a.localeCompare(b));
}

function buildEbayTitle(c) {
  const parts = [c.year, c.cardSet, c.playerName, c.features, c.serial ? `/${c.serial}` : "", c.isAuto ? "AUTO" : ""]
    .map(clean)
    .filter(Boolean);

  if (parts.length >= 2 && parts[0] && parts[1].startsWith(parts[0])) parts.shift();
  return clean(parts.join(" ")).slice(0, 80);
}

function buildEbayDescription(c) {
  const autoStr = c.isAuto ? "Yes" : "No";
  const serialStr = c.serial ? `/${c.serial}` : "";
  return (
    `<p><b>Player:</b> ${clean(c.playerName)}</p>` +
    `<p><b>Team:</b> ${clean(c.team)}</p>` +
    `<p><b>League:</b> ${clean(c.league)}</p>` +
    `<p><b>Set:</b> ${clean(c.year)} ${clean(c.cardSet)}</p>` +
    `<p><b>Card Number:</b> ${clean(c.cardNumber)}</p>` +
    `<p><b>Insert / Parallel:</b> ${clean(c.features)}</p>` +
    `<p><b>Serial Number:</b> ${clean(serialStr)}</p>` +
    `<p><b>Autograph:</b> ${autoStr}</p>` +
    `<hr>` +
    `<p>Ships next business day. Securely packed (sleeve + top loader + team bag).</p>` +
    `<p>Card shown is the exact card you will receive.</p>`
  );
}

function fillSelect(selectEl, options) {
  const keepFirst = selectEl.options[0];
  selectEl.innerHTML = "";
  selectEl.appendChild(keepFirst);
  options.forEach((o) => {
    const opt = document.createElement("option");
    opt.value = o;
    opt.textContent = o;
    selectEl.appendChild(opt);
  });
}

function applyFilters() {
  const q = $("search").value.trim().toLowerCase();
  const setVal = $("setFilter").value;
  const teamVal = $("teamFilter").value;
  const leagueVal = $("leagueFilter").value;
  const autoOnly = $("autoOnly").checked;
  const numberedOnly = $("numberedOnly").checked;

  FILTERED = ALL.filter((c) => {
    if (setVal !== "ALL" && c.cardSet !== setVal) return false;
    if (teamVal !== "ALL" && c.team !== teamVal) return false;
    if (leagueVal !== "ALL" && c.league !== leagueVal) return false;
    if (autoOnly && !c.isAuto) return false;
    if (numberedOnly && !c.serial) return false;

    if (!q) return true;
    const hay = `${c.playerName} ${c.team} ${c.league} ${c.cardSet} ${c.features} ${c.cardNumber}`.toLowerCase();
    return hay.includes(q);
  });

  renderGrid();
}

function renderGrid() {
  const grid = $("grid");
  const status = $("status");

  if (!FILTERED.length) {
    grid.hidden = true;
    status.textContent = "No cards match your filters.";
    status.hidden = false;
    return;
  }

  status.hidden = true;
  grid.hidden = false;
  grid.innerHTML = "";

  FILTERED.forEach((c) => {
    const btn = document.createElement("button");
    btn.className = "tile";
    btn.onclick = () => openModal(c);

    const thumb = document.createElement("div");
    thumb.className = "thumb";

    const img = document.createElement("img");
    img.loading = "lazy";
    img.alt = c.playerName || "card";
    img.src = c.imageUrl || "";
    thumb.appendChild(img);

    const badges = document.createElement("div");
    badges.className = "badges";
    if (c.isAuto) {
      const b = document.createElement("span");
      b.className = "badge auto";
      b.textContent = "AUTO";
      badges.appendChild(b);
    }
    if (c.serial) {
      const b = document.createElement("span");
      b.className = "badge";
      b.textContent = `/${c.serial}`;
      badges.appendChild(b);
    }
    thumb.appendChild(badges);

    const body = document.createElement("div");
    body.className = "tilebody";

    const t = document.createElement("p");
    t.className = "tTitle";
    t.textContent = c.playerName || "—";

    const m1 = document.createElement("div");
    m1.className = "tMeta";
    m1.textContent = `${c.team ? c.team + " • " : ""}${c.league || ""}`;

    const m2 = document.createElement("div");
    m2.className = "tMeta2";
    m2.textContent = `${c.year} ${c.cardSet}`.trim();

    const m3 = document.createElement("div");
    m3.className = "tMeta3";
    m3.textContent = c.features || "—";

    body.appendChild(t);
    body.appendChild(m1);
    body.appendChild(m2);
    body.appendChild(m3);

    btn.appendChild(thumb);
    btn.appendChild(body);
    grid.appendChild(btn);
  });
}

function openModal(c) {
  SELECTED = c;

  $("modalTitle").textContent = c.playerName || "—";
  $("modalImg").src = c.imageUrl || "";
  $("mSet").textContent = `${c.year} ${c.cardSet}`.trim();
  $("mNum").textContent = c.cardNumber || "—";
  $("mFeat").textContent = c.features || "—";
  $("mSeason").textContent = c.season || "—";
  $("mBrand").textContent = c.brand || "—";
  $("mCond").textContent = c.condition || "—";
  $("mCardName").textContent = c.cardName || "—";

  const pills = $("pills");
  pills.innerHTML = "";
  if (c.isAuto) pills.appendChild(pill("Auto"));
  if (c.serial) pills.appendChild(pill(`/${c.serial}`));
  if (c.team) pills.appendChild(pill(c.team));
  if (c.league) pills.appendChild(pill(c.league));

  $("modalOverlay").hidden = false;
}

function pill(text) {
  const el = document.createElement("span");
  el.className = "pill";
  el.textContent = text;
  return el;
}

function closeModal() {
  $("modalOverlay").hidden = true;
  SELECTED = null;
}

function toast(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.hidden = false;
  setTimeout(() => (t.hidden = true), 1400);
}

async function init() {
  $("status").textContent = "Loading inventory…";
  $("grid").hidden = true;

  try {
    const res = await fetch("/data/inventory.tsv", { cache: "no-store" });
    if (!res.ok) throw new Error(`Failed to load inventory.tsv (${res.status})`);
    const text = await res.text();
    ALL = parseTSV(text);

    fillSelect($("setFilter"), uniq(ALL.map((c) => c.cardSet)));
    fillSelect($("teamFilter"), uniq(ALL.map((c) => c.team)));
    fillSelect($("leagueFilter"), uniq(ALL.map((c) => c.league)));

    FILTERED = ALL.slice();
    renderGrid();

    ["search", "setFilter", "teamFilter", "leagueFilter", "autoOnly", "numberedOnly"].forEach((id) => {
      $(id).addEventListener("input", applyFilters);
      $(id).addEventListener("change", applyFilters);
    });

    $("clear").onclick = () => {
      $("search").value = "";
      $("setFilter").value = "ALL";
      $("teamFilter").value = "ALL";
      $("leagueFilter").value = "ALL";
      $("autoOnly").checked = false;
      $("numberedOnly").checked = false;
      applyFilters();
    };

    $("closeModal").onclick = closeModal;
    $("modalOverlay").addEventListener("click", (e) => {
      if (e.target === $("modalOverlay")) closeModal();
    });

    $("copyTitle").onclick = () => {
      if (!SELECTED) return;
      navigator.clipboard.writeText(buildEbayTitle(SELECTED));
      toast("Copied title");
    };

    $("copyDesc").onclick = () => {
      if (!SELECTED) return;
      navigator.clipboard.writeText(buildEbayDescription(SELECTED));
      toast("Copied description (HTML)");
    };
  } catch (e) {
    $("status").textContent = e.message || "Failed to load inventory.";
  }
}

init();
