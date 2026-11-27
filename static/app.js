const LOCATIONS = {
  pub: "Pub",
  front_left: "Front Bar Left",
  front_right: "Front Bar Right",
  back_bar: "Back Bar"
};


const PIN_CODE = "999906";
let unlocked = sessionStorage.getItem("asc_unlocked") === "1";
let pendingAction = null; // "postmix" | "settings"

function requirePin(action) {
  if (unlocked) {
    runUnlockedAction(action);
    return;
  }
  pendingAction = action;
  const modal = document.getElementById("pinModal");
  const input = document.getElementById("pinInput");
  const err = document.getElementById("pinError");
  if (modal) {
    modal.style.display = "flex";
    if (err) err.style.display = "none";
    if (input) {
      input.value = "";
      setTimeout(() => input.focus(), 100);
    }
  }
}

function runUnlockedAction(action) {
  if (action === "postmix") {
    document.querySelectorAll(".primary-tab").forEach(t => t.classList.remove("active"));
    const tab = document.querySelector('.primary-tab[data-view="postmix"]');
    if (tab) tab.classList.add("active");
    currentView = "postmix";
    const sv = document.getElementById("stockView");
    if (sv) sv.style.display = "none";
    const pv = document.getElementById("postmixView");
    if (pv) {
      pv.style.display = "block";
      loadPostmix();
    }
  } else if (action === "settings") {
    window.location.href = "/settings";
  }
}

// Wire PIN modal
(function setupPin() {
  const modal = document.getElementById("pinModal");
  const input = document.getElementById("pinInput");
  const submit = document.getElementById("pinSubmit");
  const cancel = document.getElementById("pinCancel");
  const err = document.getElementById("pinError");
  if (!modal) return;

  function tryPin() {
    if (input && input.value === PIN_CODE) {
      unlocked = true;
      sessionStorage.setItem("asc_unlocked", "1");
      modal.style.display = "none";
      runUnlockedAction(pendingAction);
      pendingAction = null;
    } else {
      if (err) err.style.display = "block";
      if (input) {
        input.value = "";
        input.focus();
      }
    }
  }

  if (submit) submit.addEventListener("click", tryPin);
  if (cancel) cancel.addEventListener("click", () => {
    modal.style.display = "none";
    pendingAction = null;
  });
  if (input) input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") tryPin();
  });

  // Settings link
  const settingsLink = document.getElementById("settingsLink");
  if (settingsLink) {
    settingsLink.addEventListener("click", (e) => {
      e.preventDefault();
      requirePin("settings");
    });
  }
})();

let currentLocation = "dashboard";
let currentView = "stock";
let allItems = [];

const primaryTabs = document.querySelectorAll(".primary-tab");
const dashboardView = document.getElementById("dashboardView");
const stockView = document.getElementById("stockView");

const tabs = document.querySelectorAll(".tab");
const addSection = document.getElementById("addSection");
const formTitle = document.getElementById("formTitle");
const tableTitle = document.getElementById("tableTitle");
const tableHead = document.getElementById("tableHead");
const tableBody = document.getElementById("tableBody");
const emptyMsg = document.getElementById("emptyMsg");
const sortControls = document.getElementById("sortControls");
const sortSelect = document.getElementById("sortSelect");
const addForm = document.getElementById("addForm");
const itemInput = document.getElementById("itemInput");
const dateInput = document.getElementById("dateInput");

const editModal = document.getElementById("editModal");
const editForm = document.getElementById("editForm");
const editId = document.getElementById("editId");
const editItem = document.getElementById("editItem");
const editDate = document.getElementById("editDate");
const cancelEdit = document.getElementById("cancelEdit");

function parseDate(str) {
  if (!str) return null;
  str = str.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
  str = str.replace(/[-.]/g, "/");
  const parts = str.split("/").map(p => p.trim());
  if (parts.length !== 3) return null;
  let day, month, year;
  if (parts[0].length === 4) {
    year = parseInt(parts[0], 10);
    month = parseInt(parts[1], 10);
    day = parseInt(parts[2], 10);
  } else {
    day = parseInt(parts[0], 10);
    month = parseInt(parts[1], 10);
    year = parseInt(parts[2], 10);
  }
  if (isNaN(day) || isNaN(month) || isNaN(year)) return null;
  if (year >= 0 && year <= 99) year += 2000;
  if (year < 2000 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  return year + "-" + String(month).padStart(2,"0") + "-" + String(day).padStart(2,"0");
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

dateInput.value = new Date().toLocaleDateString("en-GB");

dateInput.addEventListener("blur", () => {
  const parsed = parseDate(dateInput.value);
  if (parsed) {
    const parts = parsed.split("-");
    dateInput.value = parts[2] + "/" + parts[1] + "/" + parts[0];
  }
});

editDate.addEventListener("blur", () => {
  const parsed = parseDate(editDate.value);
  if (parsed) {
    const parts = parsed.split("-");
    editDate.value = parts[2] + "/" + parts[1] + "/" + parts[0];
  }
});

const postmixView = document.getElementById("postmixView");

primaryTabs.forEach(tab => {
  tab.addEventListener("click", () => {
    const view = tab.dataset.view;
    if (view === "postmix") {
      requirePin("postmix");
      return;
    }
    primaryTabs.forEach(t => t.classList.remove("active"));
    tab.classList.add("active");
    currentView = view;
    if (postmixView) postmixView.style.display = "none";
    stockView.style.display = "block";
    // restore last stock sub-tab or dashboard
    updateStockView();
  });
});

tabs.forEach(tab => {
  tab.addEventListener("click", () => {
    tabs.forEach(t => t.classList.remove("active"));
    tab.classList.add("active");
    currentLocation = tab.dataset.location;
    updateStockView();
  });
});

sortSelect.addEventListener("change", () => renderTable(allItems));

addForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const item = itemInput.value.trim();
  const parsed = parseDate(dateInput.value);
  if (!item) return;
  if (!parsed) {
    alert("Please enter a valid date (e.g. 14/11/26 or 2026-11-14)");
    dateInput.focus();
    return;
  }
  const res = await fetch("/api/items", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ location: currentLocation, item, earliest_date: parsed })
  });
  if (res.ok) {
    itemInput.value = "";
    dateInput.value = new Date().toLocaleDateString("en-GB");
    itemInput.focus();
    loadItems();
  } else {
    const err = await res.json();
    alert(err.error || "Failed to add");
  }
});

cancelEdit.addEventListener("click", () => {
  editModal.style.display = "none";
});

editForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const id = editId.value;
  const item = editItem.value.trim();
  const parsed = parseDate(editDate.value);
  if (!item) return;
  if (!parsed) {
    alert("Please enter a valid date (e.g. 14/11/26 or 2026-11-14)");
    editDate.focus();
    return;
  }
  const res = await fetch("/api/items/" + id, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ item, earliest_date: parsed })
  });
  if (res.ok) {
    editModal.style.display = "none";
    loadItems();
  } else {
    alert("Failed to update");
  }
});

function updateStockView() {
  const dash = document.getElementById("dashboardView");
  const mainStock = stockView ? stockView.querySelector("main") : null;

  if (currentLocation === "dashboard") {
    if (dash) dash.style.display = "block";
    if (mainStock) mainStock.style.display = "none";
    loadDashboard();
    return;
  }

  if (dash) dash.style.display = "none";
  if (mainStock) mainStock.style.display = "block";

  if (currentLocation === "all") {
    addSection.style.display = "none";
    sortControls.style.display = "flex";
    tableTitle.textContent = "All Stock";
    tableHead.innerHTML = "<th>Location</th><th>Item</th><th>Earliest Date</th><th></th>";
  } else {
    addSection.style.display = "block";
    sortControls.style.display = "none";
    const name = LOCATIONS[currentLocation];
    formTitle.textContent = "Add to " + name;
    tableTitle.textContent = name;
    tableHead.innerHTML = "<th>Item</th><th>Earliest Date</th><th></th>";
  }
  loadItems();
}

async function loadItems() {
  const url = currentLocation === "all" ? "/api/items" : "/api/items?location=" + currentLocation;
  const res = await fetch(url);
  allItems = await res.json();
  renderTable(allItems);
}

function renderTable(items) {
  if (currentLocation === "all") {
    const sortBy = sortSelect.value;
    items = items.slice().sort((a, b) => {
      if (sortBy === "date") return a.earliest_date.localeCompare(b.earliest_date);
      if (sortBy === "item") return a.item.localeCompare(b.item);
      if (sortBy === "location") return a.location.localeCompare(b.location);
      return 0;
    });
  }
  tableBody.innerHTML = "";
  if (items.length === 0) {
    emptyMsg.style.display = "block";
    return;
  }
  emptyMsg.style.display = "none";
  const today = todayISO();
  items.forEach(row => {
    const tr = document.createElement("tr");
    const dateClass = getDateClass(row.earliest_date, today);
    if (currentLocation === "all") {
      tr.innerHTML = '<td><span class="loc-badge">' + (LOCATIONS[row.location] || row.location) + '</span></td><td>' + escapeHtml(row.item) + '</td><td class="date-cell ' + dateClass + '">' + formatDate(row.earliest_date) + '</td><td class="actions"><button class="btn-icon" onclick="openEdit(' + row.id + ', \'' + escapeAttr(row.item) + '\', \'' + row.earliest_date + '\')">Edit</button> <button class="btn-icon btn-delete" onclick="deleteItem(' + row.id + ')">Delete</button></td>';
    } else {
      tr.innerHTML = '<td>' + escapeHtml(row.item) + '</td><td class="date-cell ' + dateClass + '">' + formatDate(row.earliest_date) + '</td><td class="actions"><button class="btn-icon" onclick="openEdit(' + row.id + ', \'' + escapeAttr(row.item) + '\', \'' + row.earliest_date + '\')">Edit</button> <button class="btn-icon btn-delete" onclick="deleteItem(' + row.id + ')">Delete</button></td>';
    }
    tableBody.appendChild(tr);
  });
}

async function loadDashboard() {
  const res = await fetch("/api/items");
  const items = await res.json();
  const today = todayISO();
  const in14 = new Date();
  in14.setDate(in14.getDate() + 14);
  const in14str = in14.toISOString().slice(0, 10);

  const past = items.filter(i => i.earliest_date < today);
  const soon = items.filter(i => i.earliest_date >= today && i.earliest_date <= in14str);

  document.getElementById("dashTotal").textContent = items.length;
  document.getElementById("dashSoon").textContent = soon.length;
  document.getElementById("dashPast").textContent = past.length;

  const counts = { pub: 0, front_left: 0, front_right: 0, back_bar: 0 };
  items.forEach(i => { if (counts[i.location] !== undefined) counts[i.location]++; });
  document.getElementById("dashPub").textContent = counts.pub;
  document.getElementById("dashFrontLeft").textContent = counts.front_left;
  document.getElementById("dashFrontRight").textContent = counts.front_right;
  document.getElementById("dashBackBar").textContent = counts.back_bar;

  const upcoming = items
    .filter(i => i.earliest_date >= today)
    .sort((a, b) => a.earliest_date.localeCompare(b.earliest_date))
    .slice(0, 10);

  const body = document.getElementById("dashNextBody");
  const empty = document.getElementById("dashNextEmpty");
  body.innerHTML = "";
  if (upcoming.length === 0) {
    empty.style.display = "block";
    return;
  }
  empty.style.display = "none";
  upcoming.forEach(row => {
    const tr = document.createElement("tr");
    const dateClass = getDateClass(row.earliest_date, today);
    tr.innerHTML = '<td><span class="loc-badge">' + (LOCATIONS[row.location] || row.location) + '</span></td><td>' + escapeHtml(row.item) + '</td><td class="date-cell ' + dateClass + '">' + formatDate(row.earliest_date) + '</td>';
    body.appendChild(tr);
  });
}

function getDateClass(dateStr, today) {
  if (dateStr < today) return "date-past";
  const d = new Date(dateStr);
  const t = new Date(today);
  const diff = (d - t) / (1000 * 60 * 60 * 24);
  if (diff <= 3) return "date-soon";
  return "";
}

function formatDate(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

function escapeHtml(str) {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function escapeAttr(str) {
  return str.replace(/'/g, "\\'").replace(/"/g, "&quot;");
}

function openEdit(id, item, date) {
  editId.value = id;
  editItem.value = item;
  const parts = date.split("-");
  editDate.value = parts[2] + "/" + parts[1] + "/" + parts[0];
  editModal.style.display = "flex";
}

async function deleteItem(id) {
  if (!confirm("Delete this item?")) return;
  const res = await fetch("/api/items/" + id, { method: "DELETE" });
  if (res.ok) {
    if (currentLocation === "dashboard") loadDashboard();
    else loadItems();
  } else alert("Failed to delete");
}



// ---------- Postmix + Gas ----------
async function loadPostmix() {
  const res = await fetch("/api/postmix");
  const rows = await res.json();
  const body = document.getElementById("postmixBody");
  if (!body) return;
  body.innerHTML = "";
  rows.forEach(r => {
    const tr = document.createElement("tr");
    const toOrder = r.to_order;
    const toOrderDisplay = toOrder > 0 ? (toOrder === Math.floor(toOrder) ? toOrder : toOrder.toFixed(1)) : "–";
    tr.innerHTML = 
      "<td>" + escapeHtml(r.label) + "</td>" +
      "<td><input type=\"number\" min=\"0\" step=\"any\" class=\"pm-current\" data-key=\"" + r.key + "\" value=\"" + (r.current || 0) + "\" style=\"width:90px;text-align:right;\"></td>" +
      "<td style=\"color:var(--text-muted);\">" + (r.needed || 0) + "</td>" +
      "<td class=\"to-order-cell\" data-key=\"" + r.key + "\" style=\"font-weight:600;\">" + toOrderDisplay + "</td>";
    body.appendChild(tr);
  });

  // Live recalculate to-order when current changes
  body.querySelectorAll(".pm-current").forEach(inp => {
    inp.addEventListener("input", () => {
      const key = inp.dataset.key;
      const row = rows.find(r => r.key === key);
      if (!row) return;
      const current = parseFloat(inp.value) || 0;
      const needed = parseFloat(row.needed) || 0;
      const toOrder = Math.max(0, needed - current);
      const cell = body.querySelector(".to-order-cell[data-key=\"" + key + "\"]");
      if (cell) cell.textContent = toOrder > 0 ? (toOrder === Math.floor(toOrder) ? toOrder : toOrder.toFixed(1)) : "–";
    });
  });
}

const savePostmixBtn = document.getElementById("savePostmixBtn");
if (savePostmixBtn) {
  savePostmixBtn.addEventListener("click", async () => {
    // Need needed values too
    const res = await fetch("/api/postmix");
    const existing = await res.json();
    const neededMap = {};
    existing.forEach(r => neededMap[r.key] = r.needed);

    const payload = {};
    document.querySelectorAll(".pm-current").forEach(inp => {
      payload[inp.dataset.key] = {
        current: parseFloat(inp.value) || 0,
        needed: neededMap[inp.dataset.key] || 0
      };
    });
    const saveRes = await fetch("/api/postmix", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const status = document.getElementById("postmixStatus");
    if (status) {
      status.style.display = "block";
      status.className = "status " + (saveRes.ok ? "ok" : "err");
      status.textContent = saveRes.ok ? "Current stock saved." : "Failed to save.";
    }
    if (saveRes.ok) loadPostmix();
  });
}

const sendOrderBtn = document.getElementById("sendOrderBtn");
if (sendOrderBtn) {
  sendOrderBtn.addEventListener("click", async () => {
    // Save current values first
    if (savePostmixBtn) await savePostmixBtn.click();

    sendOrderBtn.disabled = true;
    sendOrderBtn.textContent = "Sending…";
    const res = await fetch("/api/send-order", { method: "POST" });
    sendOrderBtn.disabled = false;
    sendOrderBtn.textContent = "Email order to supplier";
    const status = document.getElementById("postmixStatus");
    if (status) {
      status.style.display = "block";
      if (res.ok) {
        const data = await res.json();
        status.className = "status ok";
        status.textContent = "Order emailed to " + data.sent_to + " (" + data.items + " items).";
      } else {
        const err = await res.json();
        status.className = "status err";
        status.textContent = err.error || "Failed to send.";
      }
    }
  });
}

updateStockView();
