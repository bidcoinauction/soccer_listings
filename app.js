(() => {
  const $ = (id) => document.getElementById(id);

  const els = {
    grid: $("cardGrid"),
    status: $("resultCount"),
    empty: $("emptyState"),

    search: $("searchInput"),
    set: $("setFilter"),
    team: $("teamFilter"),
    league: $("leagueFilter"),
    autoOnly: $("autoOnly"),
    numberedOnly: $("numberedOnly"),
    clear: $("clearFilters"),

    modal: $("detailsModal"),
    backdrop: $("modalBackdrop"),
    close: $("closeModal"),

    mTitle: $("modalTitle"),
    mSet: $("modalSet"),
    mCard: $("modalCardNumber"),
    mFeat: $("modalFeatures"),
    mSeason: $("modalSeason"),
    mBrand: $("modalBrand"),
    mCond: $("modalCondition"),

    copyTitle: $("copyTitleBtn"),
    copyDesc: $("copyDescBtn"),

    toast: $("toast"),
  };

  let inventory = [];
  let filtered = [];
  let selected = null;

  function setModalOpen(open) {
    els.modal.hidden = !open;
    els.backdrop.hidden = !open;
    document.body.style.overflow = open ? "hidden" : "";
  }

  function showToast(msg) {
    els.toast.textContent = msg;
    els.toast.hidden = false;
    setTimeout(() => (els.toast.hidden = true), 1200);
  }

  function render() {
    els.grid.innerHTML = "";

    if (!filtered.length) {
      els.empty.hidden = false;
      return;
    }

    els.empty.hidden = true;
    els.status.textContent = `${filtered.length} cards`;

    filtered.forEach((row) => {
      const el = document.createElement("div");
      el.className = "card";
      el.textContent = row["Card Name"] || "Card";
      el.onclick = () => openModal(row);
      els.grid.appendChild(el);
    });
  }

  function openModal(row) {
    selected = row;
    els.mTitle.textContent = row["Card Name"] || "—";
    els.mSet.textContent = row["Card Set"] || "—";
    els.mCard.textContent = row["Card Number"] || "—";
    els.mFeat.textContent = row["Features"] || "—";
    els.mSeason.textContent = row["Season"] || "—";
    els.mBrand.textContent = row["Brand"] || "—";
    els.mCond.textContent = row["Condition"] || "—";
    setModalOpen(true);
  }

  function closeModal() {
    selected = null;
    setModalOpen(false);
  }

  function applyFilters() {
    const q = els.search.value.toLowerCase();
    filtered = inventory.filter((r) =>
      JSON.stringify(r).toLowerCase().includes(q)
    );
    render();
  }

  async function load() {
    const tsv = await fetch("./full_card_inventory.tsv").then((r) => r.text());
    const lines = tsv.split("\n");
    const headers = lines[0].split("\t");
    inventory = lines.slice(1).map((l) => {
      const obj = {};
      l.split("\t").forEach((v, i) => (obj[headers[i]] = v));
      return obj;
    });
    filtered = inventory;
    render();
  }

  els.search.oninput = applyFilters;
  els.clear.onclick = () => {
    els.search.value = "";
    applyFilters();
  };

  els.close.onclick = closeModal;
  els.backdrop.onclick = closeModal;
  window.onkeydown = (e) => e.key === "Escape" && closeModal();

  els.copyTitle.onclick = () => {
    navigator.clipboard.writeText(els.mTitle.textContent);
    showToast("Title copied");
  };

  els.copyDesc.onclick = () => {
    navigator.clipboard.writeText(JSON.stringify(selected, null, 2));
    showToast("Description copied");
  };

  load();
})();

