const serviceSelect = document.getElementById("service");
const barberSelect = document.getElementById("barber");
const dateInput = document.getElementById("date");
const timeSelect = document.getElementById("time");
const statusEl = document.getElementById("status");
const confirmationEl = document.getElementById("confirmation");
const bookingListEl = document.getElementById("booking-list");
const serviceGridEl = document.getElementById("service-grid");
const refreshBookingsBtn = document.getElementById("refresh-bookings");
const adminServicesEl = document.getElementById("admin-services");
const adminClientsEl = document.getElementById("admin-clients");
const adminBookingsEl = document.getElementById("admin-bookings");
const addServiceForm = document.getElementById("add-service-form");
const themeForm = document.getElementById("theme-form");
const clientCalendarEl = document.getElementById("client-calendar");
const clientMonthLabel = document.getElementById("client-month-label");
const clientMonthPrev = document.getElementById("client-month-prev");
const clientMonthNext = document.getElementById("client-month-next");
const barberCalendarEl = document.getElementById("barber-calendar");
const barberMonthLabel = document.getElementById("barber-month-label");
const barberMonthPrev = document.getElementById("barber-month-prev");
const barberMonthNext = document.getElementById("barber-month-next");
const roleClientBtn = document.getElementById("role-client");
const roleEmployeeBtn = document.getElementById("role-employee");
const settingsPanel = document.getElementById("settings-panel");
const clientScheduleCol = document.getElementById("client-schedule-col");
const barberScheduleCol = document.getElementById("barber-schedule-col");
const modal = document.getElementById("modal");
const modalContent = document.getElementById("modal-content");
const modalClose = document.getElementById("modal-close");
const modalBackdrop = document.getElementById("modal-backdrop");
const clientLoginForm = document.getElementById("client-login");
const employeeLoginForm = document.getElementById("employee-login");
const logoutBtn = document.getElementById("logout-btn");
const stepService = document.getElementById("step-service");
const stepBarber = document.getElementById("step-barber");
const stepSchedule = document.getElementById("step-schedule");
const stepDetails = document.getElementById("step-details");
const step1Next = document.getElementById("step1-next");
const step2Next = document.getElementById("step2-next");
const step2Back = document.getElementById("step2-back");
const step3Next = document.getElementById("step3-next");
const step3Back = document.getElementById("step3-back");
const step4Back = document.getElementById("step4-back");

const CLIENT_API_BASE = window.CLIENT_API_BASE || "";
const EMPLOYEE_API_BASE = window.EMPLOYEE_API_BASE || "http://127.0.0.1:3002";

let authToken = sessionStorage.getItem("authToken") || null;
let authUser = null;
try {
  const storedUser = sessionStorage.getItem("authUser");
  authUser = storedUser ? JSON.parse(storedUser) : null;
} catch (err) {
  authUser = null;
}

let servicesCache = [];
let barbersCache = [];
let adminState = { services: [], bookings: [], clients: [], theme: {} };
let clientMonth = startOfMonth(new Date());
let barberMonth = startOfMonth(new Date());
let clientSelectedDate = todayISO();
let barberSelectedDate = todayISO();
let currentRole = "client";
let clientStep = 1;
let stripeConfig = null;

init();

function init() {
  dateInput.value = todayISO();
  if (authUser) {
    currentRole = authUser.roleType === "employee" ? "employee" : "client";
  }
  setRole(currentRole);
  updateFlowState();
  dateInput.addEventListener("change", updateAvailability);
  serviceSelect.addEventListener("change", updateAvailability);
  barberSelect.addEventListener("change", updateAvailability);
  document.getElementById("booking-form").addEventListener("submit", handleSubmit);
  refreshBookingsBtn.addEventListener("click", loadState);
  addServiceForm.addEventListener("submit", handleAddService);
  themeForm.addEventListener("submit", handleThemeSubmit);
  clientMonthPrev.addEventListener("click", () => changeMonth("client", -1));
  clientMonthNext.addEventListener("click", () => changeMonth("client", 1));
  barberMonthPrev.addEventListener("click", () => changeMonth("barber", -1));
  barberMonthNext.addEventListener("click", () => changeMonth("barber", 1));
  roleClientBtn.addEventListener("click", () => setRole("client"));
  roleEmployeeBtn.addEventListener("click", () => setRole("employee"));
  modalClose.addEventListener("click", closeModal);
  modalBackdrop.addEventListener("click", closeModal);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeModal();
  });
  clientLoginForm.addEventListener("submit", (e) => {
    e.preventDefault();
    handleLogin("client", new FormData(clientLoginForm));
  });
  employeeLoginForm.addEventListener("submit", (e) => {
    e.preventDefault();
    handleLogin("employee", new FormData(employeeLoginForm));
  });
  logoutBtn.addEventListener("click", () => logout());
  step1Next.addEventListener("click", () => goToStep(2));
  step2Next.addEventListener("click", () => goToStep(3));
  step2Back.addEventListener("click", () => goToStep(1));
  step3Next.addEventListener("click", () => goToStep(4));
  step3Back.addEventListener("click", () => goToStep(2));
  step4Back.addEventListener("click", () => goToStep(3));
  document.getElementById("stripe-form")?.addEventListener("submit", handleStripeSave);
}

function todayISO() {
  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  return now.toISOString().split("T")[0];
}

function setRole(role) {
  if (role === "employee" && (!authUser || authUser.roleType !== "employee")) {
    setStatus("Sign in as employee to access that view.", true);
    currentRole = "client";
  } else {
    currentRole = role;
  }
  updateRoleUI();
  loadState();
}

function updateRoleUI() {
  roleClientBtn.classList.toggle("active", currentRole === "client");
  roleEmployeeBtn.classList.toggle("active", currentRole === "employee");
  const canEdit = currentRole === "employee" && authUser && authUser.roleType === "employee" && isManagerOrOwner(authUser);
  settingsPanel.classList.toggle("hidden", !canEdit);
  setAdminDisabled(!canEdit);
  clientScheduleCol.classList.toggle("hidden", currentRole !== "client");
  barberScheduleCol.classList.toggle("hidden", currentRole !== "employee");
  const ownerSettings = document.getElementById("owner-settings");
  if (ownerSettings) ownerSettings.classList.toggle("hidden", !(authUser && isOwner(authUser)));
}

function setAdminDisabled(disabled) {
  settingsPanel.querySelectorAll("input, select, textarea, button").forEach((el) => {
    el.disabled = disabled;
  });
}

function goToStep(step) {
  if (currentRole !== "client") {
    setStatus("Client flow only available in Client view.", true);
    return;
  }
  if (step === 2 && !serviceSelect.value) {
    setStatus("Pick a service first.", true);
    return;
  }
  if (step === 3 && (!serviceSelect.value || !barberSelect.value)) {
    setStatus("Pick a service and barber first.", true);
    return;
  }
  if (step === 4 && (!serviceSelect.value || !barberSelect.value || !timeSelect.value)) {
    setStatus("Pick a time before entering details.", true);
    return;
  }
  clientStep = step;
  updateFlowState();
}

async function loadState() {
  try {
    let data = { services: [], bookings: [], clients: [], theme: {} };
    barbersCache = [];
    if (currentRole === "employee" && authUser && authUser.roleType === "employee") {
      if (isManagerOrOwner(authUser)) {
        const res = await fetch(employeeApi("/api/admin/state"), { headers: authHeaders() });
        if (!res.ok) throw new Error("Admin data unavailable");
        data = await res.json();
        barbersCache = data.barbers || [];
      } else {
        const [servicesRes, barbersRes, themeRes, calendarRes] = await Promise.all([
          fetch(clientApi("/api/services")),
          fetch(clientApi("/api/barbers")),
          fetch(clientApi("/api/theme")),
          fetch(clientApi("/api/calendar"), { headers: authHeaders() })
        ]);
        if (!servicesRes.ok) throw new Error("Services unavailable");
        data.services = await servicesRes.json();
        if (barbersRes.ok) barbersCache = await barbersRes.json();
        if (themeRes.ok) data.theme = await themeRes.json();
        if (calendarRes.ok) {
          const c = await calendarRes.json();
          data.bookings = c.bookings || [];
        }
      }
    } else {
      const [servicesRes, barbersRes, themeRes, calendarRes] = await Promise.all([
        fetch(clientApi("/api/services")),
        fetch(clientApi("/api/barbers")),
        fetch(clientApi("/api/theme")),
        fetch(clientApi("/api/calendar"))
      ]);
      if (!servicesRes.ok) throw new Error("Services unavailable");
      data.services = await servicesRes.json();
      if (barbersRes.ok) barbersCache = await barbersRes.json();
      if (themeRes.ok) data.theme = await themeRes.json();
      if (calendarRes.ok) {
        const c = await calendarRes.json();
        data.bookings = c.bookings || [];
      }
    }
    adminState = data;
    servicesCache = data.services || [];
    stripeConfig = data.stripeConfig || null;
    applyTheme(data.theme || {});
    prefillThemeForm(data.theme || {});
    renderServiceOptions(servicesCache);
    renderBarberOptions(barbersCache);
    renderServiceCards(servicesCache);
    renderBookings(data.bookings || []);
    if (currentRole === "employee" && isManagerOrOwner(authUser || {})) {
      renderAdminServices(servicesCache);
      renderAdminClients(data.clients || []);
      renderAdminBookings(data.bookings || [], servicesCache);
    } else {
      adminServicesEl.innerHTML = `<div class="inline-note">Employee view required to edit services.</div>`;
      adminClientsEl.innerHTML = `<div class="inline-note">Employee view required to edit clients.</div>`;
      adminBookingsEl.innerHTML = `<div class="inline-note">Employee view required to edit appointments.</div>`;
    }
    renderClientCalendar();
    renderBarberCalendar();
    if (servicesCache.length) updateAvailability();
  } catch (err) {
    setStatus(err.message || "Could not load data. Check server.", true);
  }
}

function applyTheme(theme) {
  const root = document.documentElement.style;
  if (theme.accent) root.setProperty("--accent", theme.accent);
  if (theme.accent2) root.setProperty("--accent-2", theme.accent2);
  if (theme.ink) root.setProperty("--ink", theme.ink);
  if (theme.card) root.setProperty("--card", theme.card);
  if (theme.line) root.setProperty("--line", theme.line);
}

function prefillThemeForm(theme) {
  themeForm.accent.value = theme.accent || "#ff7f50";
  themeForm.accent2.value = theme.accent2 || "#2dd4bf";
  themeForm.ink.value = theme.ink || "#0b1021";
  themeForm.card.value = theme.card || "#f7f8fb";
  themeForm.line.value = theme.line || "#dfe4f5";
}

function renderServiceOptions(services) {
  serviceSelect.innerHTML = "";
  for (const service of services) {
    const opt = document.createElement("option");
    opt.value = service.id;
    opt.textContent = `${service.name} (${service.durationMinutes} min)`;
    serviceSelect.appendChild(opt);
  }
  updateFlowState();
}

function renderBarberOptions(barbers) {
  barberSelect.innerHTML = "";
  for (const barber of barbers) {
    const opt = document.createElement("option");
    opt.value = barber.id;
    opt.textContent = barber.name;
    barberSelect.appendChild(opt);
  }
  updateFlowState();
}

function renderServiceCards(services) {
  serviceGridEl.innerHTML = "";
  services.forEach((service) => {
    const card = document.createElement("div");
    card.className = "service-card";
    card.innerHTML = `
      <h3>${escapeHtml(service.name)}</h3>
      <div class="meta">${escapeHtml(service.description)}</div>
      <div class="meta">Duration: ${service.durationMinutes} min</div>
      <div class="meta">Price: $${service.price}</div>
    `;
    serviceGridEl.appendChild(card);
  });
}

async function updateAvailability() {
  const serviceId = serviceSelect.value;
  const barberId = barberSelect.value;
  const date = dateInput.value;
  if (!serviceId || !barberId || !date) {
    setTimePlaceholder("Pick date/service/barber");
    updateFlowState();
    return;
  }
  setTimePlaceholder("Loading...");
  try {
    const res = await fetch(
      clientApi(
        `/api/availability?serviceId=${encodeURIComponent(serviceId)}&barberId=${encodeURIComponent(
          barberId
        )}&date=${encodeURIComponent(date)}`
      )
    );
    if (!res.ok) throw new Error("bad response");
    const data = await res.json();
    renderTimeOptions(data.slots);
  } catch (err) {
    setTimePlaceholder("Could not load slots");
    setStatus("Could not fetch availability. Try again.", true);
  } finally {
    updateFlowState();
  }
}

function setTimePlaceholder(text) {
  timeSelect.innerHTML = `<option value="">${text}</option>`;
}

function renderTimeOptions(slots) {
  if (!slots || slots.length === 0) {
    setTimePlaceholder("No slots left for this date");
    updateFlowState();
    return;
  }
  timeSelect.innerHTML = "";
  for (const slot of slots) {
    const opt = document.createElement("option");
    opt.value = slot;
    opt.textContent = to12h(slot);
    timeSelect.appendChild(opt);
  }
  updateFlowState();
}

async function handleSubmit(event) {
  event.preventDefault();
  setStatus("Creating booking...", false);
  confirmationEl.classList.add("hidden");
  const payload = {
    serviceId: serviceSelect.value,
    barberId: barberSelect.value,
    date: dateInput.value,
    time: timeSelect.value,
    firstName: document.getElementById("firstName").value,
    lastName: document.getElementById("lastName").value,
    email: document.getElementById("email").value,
    phone: document.getElementById("phone").value,
    notes: document.getElementById("notes").value
  };

  try {
    const res = await fetch(clientApi("/api/bookings"), {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Unable to create booking");
    setStatus("Booked. Payment + reminders are stubbed below.", false);
    renderConfirmation(data);
    await loadState();
    event.target.reset();
    dateInput.value = todayISO();
  } catch (err) {
    setStatus(err.message, true);
  }
}

function renderConfirmation(data) {
  const { booking, payment, reminders, wallet } = data;
  confirmationEl.classList.remove("hidden");
  confirmationEl.innerHTML = `
    <h3>Booking created</h3>
    <p><strong>${escapeHtml(booking.customerName)}</strong> booked <strong>${escapeHtml(booking.serviceName)}</strong> on <strong>${escapeHtml(booking.date)}</strong> at <strong>${escapeHtml(to12h(booking.time))}</strong>.</p>
    <p class="inline-note">Payment stub: ${payment.provider} (${payment.status}). Amount: $${payment.amount} ${payment.currency}.</p>
    <p class="inline-note">Reminders stub: SMS + email enabled. Suggested send times: ${reminders.sendAt.oneDayBefore} and ${reminders.sendAt.oneHourBefore}.</p>
    <p class="inline-note">Wallet stub: Generate Apple Wallet (.pkpass) and Google Wallet links, then set <code>wallet.appleWallet.downloadUrl</code> and <code>wallet.googleWallet.saveUrl</code>.</p>
  `;
}

function renderBookings(bookings) {
  if (!bookings.length) {
    bookingListEl.innerHTML = `<div class="inline-note">No bookings yet.</div>`;
    return;
  }
  bookingListEl.innerHTML = "";
  bookings.slice(-5).reverse().forEach((b) => {
    const row = document.createElement("div");
    row.className = "booking-item";
    row.innerHTML = `
      <div>
        <div class="who">${escapeHtml(b.customerName)}</div>
        <div class="meta">${escapeHtml(b.serviceName)} with ${escapeHtml(b.barberName || b.barberId || "barber")} · ${escapeHtml(b.date)} ${escapeHtml(to12h(b.time))}</div>
      </div>
      <div class="chip">ID ${escapeHtml(b.id)}</div>
    `;
    bookingListEl.appendChild(row);
  });
}

function changeMonth(who, delta) {
  if (who === "client") {
    clientMonth = shiftMonth(clientMonth, delta);
    renderClientCalendar();
  } else {
    barberMonth = shiftMonth(barberMonth, delta);
    renderBarberCalendar();
  }
}

function renderClientCalendar() {
  renderCalendar({
    gridEl: clientCalendarEl,
    labelEl: clientMonthLabel,
    month: clientMonth,
    bookings: adminState.bookings || [],
    selectedDate: clientSelectedDate,
    onSelect: (dateStr) => {
      clientSelectedDate = dateStr;
      renderClientCalendar();
      openClientDayModal(dateStr);
    }
  });
}

function renderBarberCalendar() {
  renderCalendar({
    gridEl: barberCalendarEl,
    labelEl: barberMonthLabel,
    month: barberMonth,
    bookings: adminState.bookings || [],
    selectedDate: barberSelectedDate,
    onSelect: (dateStr) => {
      barberSelectedDate = dateStr;
      renderBarberCalendar();
      openBarberDayModal(dateStr);
    }
  });
}

function renderCalendar({ gridEl, labelEl, month, bookings, selectedDate, onSelect }) {
  const days = buildMonthDays(month);
  labelEl.textContent = monthLabel(month);
  gridEl.innerHTML = "";
  days.forEach((day) => {
    const dateStr = day.toISOString().split("T")[0];
    const inMonth = day.getMonth() === month.getMonth();
    const dayBookings = bookings.filter((b) => b.date === dateStr);
    const el = document.createElement("div");
    el.className = "calendar-day";
    if (!inMonth) el.classList.add("muted");
    if (dateStr === selectedDate) el.classList.add("selected");
    el.innerHTML = `
      <div class="date-num">${day.getDate()}</div>
      ${dayBookings.length ? `<div class="badge">${dayBookings.length} booked</div>` : ""}
    `;
    el.addEventListener("click", () => onSelect(dateStr));
    gridEl.appendChild(el);
  });
}

async function openClientDayModal(dateStr) {
  const bookings = (adminState.bookings || []).filter((b) => b.date === dateStr);
  const serviceId = serviceSelect.value;
  let availability = [];
  if (serviceId) {
    try {
      const res = await fetch(
        clientApi(`/api/availability?serviceId=${encodeURIComponent(serviceId)}&date=${encodeURIComponent(dateStr)}`)
      );
      if (res.ok) {
        const json = await res.json();
        availability = json.slots || [];
      }
    } catch (err) {
      // ignore availability errors
    }
  }
  const bookingsHtml = bookings.map(renderDayBooking).join("") || `<div class="inline-note">No bookings yet.</div>`;
  const availabilityHtml = availability.length
    ? availability.map((s) => `<span class="availability-chip">${to12h(s)}</span>`).join("")
    : '<span class="availability-chip">No open slots</span>';
  openModal(`
    <h3>${formatDateNice(dateStr)}</h3>
    <div class="meta">${bookings.length} booking${bookings.length === 1 ? "" : "s"}</div>
    ${bookingsHtml}
    <div class="inline-note" style="margin-top:8px;">Available slots for selected service:</div>
    <div class="availability-list">${availabilityHtml}</div>
  `);
}

function openBarberDayModal(dateStr) {
  const bookings = (adminState.bookings || []).filter((b) => b.date === dateStr);
  let html = `
    <h3>${formatDateNice(dateStr)}</h3>
    <div class="meta">${bookings.length} booking${bookings.length === 1 ? "" : "s"}</div>
    <div class="admin-card">
      <form id="modal-add-form" class="mini-form">
        <div class="meta">Add appointment</div>
        ${buildServiceSelectHtml("serviceId", servicesCache, servicesCache[0]?.id)}
        ${buildBarberSelectHtml("barberId", barbersCache, barbersCache[0]?.id)}
        <input type="date" name="date" value="${escapeHtml(dateStr)}" required>
        <input type="time" name="time" value="09:00" required>
        <input type="text" name="firstName" placeholder="First name" required>
        <input type="text" name="lastName" placeholder="Last name" required>
        <input type="email" name="email" placeholder="Email" required>
        <input type="tel" name="phone" placeholder="Phone">
        <input type="text" name="notes" placeholder="Notes">
        <button class="primary small" type="submit">Add</button>
      </form>
    </div>
  `;

  if (!bookings.length) {
    html += `<div class="inline-note">No bookings yet.</div>`;
  } else {
    html += bookings
      .map((b) => {
        const names = splitName(b.customerName || "");
        return `
        <div class="admin-card">
          <form class="mini-form modal-edit-form" data-booking-id="${escapeHtml(b.id)}">
            <div class="meta">Edit ${escapeHtml(b.customerName)} @ ${escapeHtml(to12h(b.time))} (ID ${escapeHtml(b.id)})</div>
            ${buildServiceSelectHtml("serviceId", servicesCache, b.serviceId)}
            ${buildBarberSelectHtml("barberId", barbersCache, b.barberId)}
            <input type="date" name="date" value="${escapeHtml(b.date)}" required>
            <input type="time" name="time" value="${escapeHtml(b.time)}" required>
            <input type="text" name="firstName" value="${escapeHtml(b.firstName || names.first)}" placeholder="First name" required>
            <input type="text" name="lastName" value="${escapeHtml(b.lastName || names.last)}" placeholder="Last name" required>
            <input type="email" name="email" value="${escapeHtml(b.email || "")}" required>
            <input type="tel" name="phone" value="${escapeHtml(b.phone || "")}">
            <input type="text" name="notes" value="${escapeHtml(b.notes || "")}">
            <div class="admin-actions">
              <button class="primary small" type="submit">Save</button>
              <button class="ghost danger small" data-action="delete" type="button">Delete</button>
            </div>
          </form>
        </div>
      `;
      })
      .join("");
  }

  openModal(html);

  const addForm = modalContent.querySelector("#modal-add-form");
  if (addForm) {
    addForm.addEventListener("submit", (e) => {
      e.preventDefault();
      handleDayCreateBooking(dateStr, new FormData(addForm));
    });
  }

  modalContent.querySelectorAll(".modal-edit-form").forEach((form) => {
    const id = form.dataset.bookingId;
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      handleDayUpdateBooking(id, new FormData(form));
    });
    const del = form.querySelector("[data-action='delete']");
    del.addEventListener("click", () => handleDayDeleteBooking(id));
  });
}

function renderDayBooking(b) {
  const contactParts = [];
  if (b.email) contactParts.push(b.email);
  if (b.phone) contactParts.push(b.phone);
  const contact = contactParts.length ? ` • ${escapeHtml(contactParts.join(" • "))}` : "";
  return `
    <div class="day-booking">
      <div class="who">${escapeHtml(b.customerName)} @ ${escapeHtml(to12h(b.time))}</div>
      <div class="meta">${escapeHtml(b.serviceName)} with ${escapeHtml(b.barberName || b.barberId || "barber")}${contact}</div>
    </div>
  `;
}

function buildMonthDays(monthDate) {
  const start = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
  const end = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0);
  const days = [];
  const leading = start.getDay(); // 0-6
  for (let i = leading - 1; i >= 0; i--) {
    const d = new Date(start);
    d.setDate(start.getDate() - (i + 1));
    days.push(d);
  }
  for (let i = 0; i < end.getDate(); i++) {
    const d = new Date(start);
    d.setDate(1 + i);
    days.push(d);
  }
  const trailing = 42 - days.length; // 6 weeks grid
  for (let i = 0; i < trailing; i++) {
    const d = new Date(end);
    d.setDate(end.getDate() + (i + 1));
    days.push(d);
  }
  return days;
}

function monthLabel(monthDate) {
  return monthDate.toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

function shiftMonth(monthDate, delta) {
  const next = new Date(monthDate);
  next.setMonth(next.getMonth() + delta);
  return startOfMonth(next);
}

function startOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function formatDateNice(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" });
}

function splitName(full) {
  const parts = (full || "").trim().split(/\s+/);
  const first = parts.shift() || "";
  const last = parts.join(" ");
  return { first, last };
}

function to12h(timeStr) {
  if (!timeStr) return "";
  const [hRaw, mRaw = "00"] = timeStr.split(":");
  let h = Number(hRaw);
  const m = mRaw.slice(0, 2).padStart(2, "0");
  const suffix = h >= 12 ? "PM" : "AM";
  h = h % 12;
  if (h === 0) h = 12;
  return `${h}:${m} ${suffix}`;
}

function buildServiceSelectHtml(name, services, selected) {
  const options = services
    .map((s) => `<option value="${s.id}" ${s.id === selected ? "selected" : ""}>${escapeHtml(s.name)}</option>`)
    .join("");
  return `<select name="${name}">${options}</select>`;
}

function buildBarberSelectHtml(name, barbers, selected) {
  const options = barbers
    .map((b) => `<option value="${b.id}" ${b.id === selected ? "selected" : ""}>${escapeHtml(b.name)}</option>`)
    .join("");
  return `<select name="${name}">${options}</select>`;
}

async function handleDayCreateBooking(dateStr, formData) {
  if (!employeeAction()) return;
  const payload = Object.fromEntries(formData.entries());
  payload.date = dateStr;
  try {
    const res = await fetch(employeeApi("/api/admin/bookings"), {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify(payload)
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || "Unable to add booking");
    setStatus("Appointment added.", false);
    await loadState();
  } catch (err) {
    setStatus(err.message, true);
  }
}

async function handleDayUpdateBooking(id, formData) {
  if (!employeeAction()) return;
  const payload = Object.fromEntries(formData.entries());
  try {
    const res = await fetch(employeeApi(`/api/admin/bookings/${encodeURIComponent(id)}`), {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify(payload)
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || "Unable to update booking");
    setStatus("Appointment updated.", false);
    await loadState();
  } catch (err) {
    setStatus(err.message, true);
  }
}

async function handleDayDeleteBooking(id) {
  if (!employeeAction()) return;
  if (!confirm("Delete this appointment?")) return;
  try {
    const res = await fetch(employeeApi(`/api/admin/bookings/${encodeURIComponent(id)}`), {
      method: "DELETE",
      headers: authHeaders()
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || "Unable to delete booking");
    setStatus("Appointment deleted.", false);
    await loadState();
  } catch (err) {
    setStatus(err.message, true);
  }
}

function renderAdminServices(services) {
  adminServicesEl.innerHTML = "";
  if (!services.length) {
    adminServicesEl.innerHTML = `<div class="inline-note">No services yet.</div>`;
    return;
  }
  const list = document.createElement("div");
  list.className = "admin-list";
  services.forEach((service) => {
    const card = document.createElement("div");
    card.className = "admin-card";
    const form = document.createElement("form");
    form.dataset.serviceId = service.id;
    form.innerHTML = `
      <input type="text" name="id" value="${escapeHtml(service.id)}" placeholder="id" required>
      <input type="text" name="name" value="${escapeHtml(service.name)}" placeholder="Name" required>
      <input type="number" name="durationMinutes" value="${service.durationMinutes}" placeholder="Duration" required>
      <input type="number" name="price" value="${service.price}" placeholder="Price" required>
      <input type="text" name="description" value="${escapeHtml(service.description)}" placeholder="Description">
      <div class="admin-actions">
        <button class="primary small" type="submit">Save</button>
        <button class="ghost danger small" data-action="delete" type="button">Delete</button>
      </div>
    `;
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      handleServiceUpdate(service.id, new FormData(form));
    });
    form.querySelector("[data-action='delete']").addEventListener("click", () => handleServiceDelete(service.id));
    card.appendChild(form);
    list.appendChild(card);
  });
  adminServicesEl.appendChild(list);
}

function renderAdminClients(clients) {
  adminClientsEl.innerHTML = "";
  if (!clients.length) {
    adminClientsEl.innerHTML = `<div class="inline-note">No clients yet.</div>`;
    return;
  }
  const list = document.createElement("div");
  list.className = "admin-list";
  clients.forEach((client) => {
    const card = document.createElement("div");
    card.className = "admin-card";
    const form = document.createElement("form");
    form.dataset.clientId = client.id;
    form.innerHTML = `
      <input type="text" name="name" value="${escapeHtml(client.name || "")}" placeholder="Name">
      <input type="email" name="email" value="${escapeHtml(client.email || "")}" placeholder="Email">
      <input type="tel" name="phone" value="${escapeHtml(client.phone || "")}" placeholder="Phone">
      <div class="meta">Last: ${escapeHtml(client.lastServiceName || "n/a")} (${escapeHtml(client.lastBookingId || "–")})</div>
      <div class="admin-actions">
        <button class="primary small" type="submit">Save</button>
      </div>
    `;
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      handleClientUpdate(client.id, new FormData(form));
    });
    card.appendChild(form);
    list.appendChild(card);
  });
  adminClientsEl.appendChild(list);
}

function renderAdminBookings(bookings, services) {
  adminBookingsEl.innerHTML = "";
  if (!bookings.length) {
    adminBookingsEl.innerHTML = `<div class="inline-note">No appointments yet.</div>`;
    return;
  }
  const list = document.createElement("div");
  list.className = "admin-list";
  bookings.slice().reverse().forEach((booking) => {
    const names = splitName(booking.customerName || "");
    const card = document.createElement("div");
    card.className = "admin-card";
    const form = document.createElement("form");
    form.dataset.bookingId = booking.id;
    const options = services
      .map((s) => `<option value="${s.id}" ${s.id === booking.serviceId ? "selected" : ""}>${escapeHtml(s.name)}</option>`)
      .join("");
    form.innerHTML = `
      <select name="serviceId">${options}</select>
      <input type="date" name="date" value="${escapeHtml(booking.date)}" required>
      <input type="time" name="time" value="${escapeHtml(booking.time)}" required>
      <input type="text" name="firstName" value="${escapeHtml(booking.firstName || names.first)}" placeholder="First name" required>
      <input type="text" name="lastName" value="${escapeHtml(booking.lastName || names.last)}" placeholder="Last name" required>
      <input type="email" name="email" value="${escapeHtml(booking.email)}" placeholder="Email" required>
      <input type="tel" name="phone" value="${escapeHtml(booking.phone || "")}" placeholder="Phone">
      <input type="text" name="notes" value="${escapeHtml(booking.notes || "")}" placeholder="Notes">
      <div class="admin-actions">
        <button class="primary small" type="submit">Update</button>
        <button class="ghost danger small" data-action="delete" type="button">Delete</button>
        <span class="meta">ID ${escapeHtml(booking.id)}</span>
      </div>
    `;
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      handleBookingUpdate(booking.id, new FormData(form));
    });
    form.querySelector("[data-action='delete']").addEventListener("click", () => handleBookingDelete(booking.id));
    card.appendChild(form);
    list.appendChild(card);
  });
  adminBookingsEl.appendChild(list);
}

async function handleAddService(event) {
  event.preventDefault();
  if (!employeeAction()) return;
  const data = new FormData(addServiceForm);
  const payload = Object.fromEntries(data.entries());
  payload.durationMinutes = Number(payload.durationMinutes);
  payload.price = Number(payload.price);
  try {
    const res = await fetch(employeeApi("/api/admin/services"), {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify(payload)
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || "Unable to add service");
    addServiceForm.reset();
    setStatus("Service added.", false);
    await loadState();
  } catch (err) {
    setStatus(err.message, true);
  }
}

async function handleServiceUpdate(id, formData) {
  if (!employeeAction()) return;
  const payload = Object.fromEntries(formData.entries());
  payload.durationMinutes = Number(payload.durationMinutes);
  payload.price = Number(payload.price);
  try {
    const res = await fetch(employeeApi(`/api/admin/services/${encodeURIComponent(id)}`), {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify(payload)
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || "Unable to update service");
    setStatus("Service updated.", false);
    await loadState();
  } catch (err) {
    setStatus(err.message, true);
  }
}

async function handleServiceDelete(id) {
  if (!employeeAction()) return;
  if (!confirm("Delete this service and its bookings?")) return;
  try {
    const res = await fetch(employeeApi(`/api/admin/services/${encodeURIComponent(id)}`), {
      method: "DELETE",
      headers: authHeaders()
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || "Unable to delete service");
    setStatus(`Service removed. Bookings removed: ${json.removedBookings || 0}.`, false);
    await loadState();
  } catch (err) {
    setStatus(err.message, true);
  }
}

async function handleClientUpdate(id, formData) {
  if (!employeeAction()) return;
  const payload = Object.fromEntries(formData.entries());
  try {
    const res = await fetch(employeeApi(`/api/admin/clients/${encodeURIComponent(id)}`), {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify(payload)
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || "Unable to update client");
    setStatus("Client updated.", false);
    await loadState();
  } catch (err) {
    setStatus(err.message, true);
  }
}

async function handleBookingUpdate(id, formData) {
  if (!employeeAction()) return;
  const payload = Object.fromEntries(formData.entries());
  try {
    const res = await fetch(employeeApi(`/api/admin/bookings/${encodeURIComponent(id)}`), {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify(payload)
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || "Unable to update booking");
    setStatus("Appointment updated.", false);
    await loadState();
  } catch (err) {
    setStatus(err.message, true);
  }
}

async function handleBookingDelete(id) {
  if (!employeeAction()) return;
  if (!confirm("Delete this appointment?")) return;
  try {
    const res = await fetch(employeeApi(`/api/admin/bookings/${encodeURIComponent(id)}`), {
      method: "DELETE",
      headers: authHeaders()
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || "Unable to delete booking");
    setStatus("Appointment deleted.", false);
    await loadState();
  } catch (err) {
    setStatus(err.message, true);
  }
}

async function handleThemeSubmit(event) {
  event.preventDefault();
  if (!employeeAction()) return;
  const payload = Object.fromEntries(new FormData(themeForm).entries());
  applyTheme(payload); // immediate
  try {
    const res = await fetch(employeeApi("/api/admin/theme"), {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify(payload)
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || "Unable to save theme");
    setStatus("Theme saved.", false);
  } catch (err) {
    setStatus(err.message, true);
  }
}

function openModal(html) {
  modalContent.innerHTML = html;
  modal.classList.remove("hidden");
}

function closeModal() {
  modal.classList.add("hidden");
  modalContent.innerHTML = "";
}

function setStatus(message, isError) {
  statusEl.textContent = message;
  statusEl.classList.toggle("hidden", !message);
  statusEl.classList.toggle("error", Boolean(isError));
}

function updateFlowState() {
  const hasService = Boolean(serviceSelect.value);
  const hasBarber = Boolean(barberSelect.value);
  const hasDate = Boolean(dateInput.value);
  const hasTime = Boolean(timeSelect.value);
  timeSelect.disabled = !(hasService && hasBarber && hasDate);

  // Step visibility
  stepService.classList.toggle("hidden", clientStep !== 1);
  stepBarber.classList.toggle("hidden", clientStep !== 2);
  stepSchedule.classList.toggle("hidden", clientStep !== 3);
  stepDetails.classList.toggle("hidden", clientStep !== 4);

  // Next buttons gating
  step1Next.disabled = !hasService;
  step2Next.disabled = !(hasService && hasBarber);
  step3Next.disabled = !(hasService && hasBarber && hasTime);

  const formInputs = document.querySelectorAll("#booking-form input, #booking-form textarea, #booking-form button[type='submit']");
  formInputs.forEach((el) => {
    const shouldDisable = !(hasService && hasBarber && hasDate && hasTime && clientStep === 4);
    if (["firstName", "lastName", "email", "phone", "notes"].includes(el.id) || el.type === "submit") {
      el.disabled = shouldDisable;
    }
  });
  if (stripeConfig && isOwner(authUser || {})) {
    const stripeForm = document.getElementById("stripe-form");
    if (stripeForm) {
      stripeForm.publishableKey.value = stripeConfig.publishableKey || "";
      stripeForm.secretKey.value = stripeConfig.secretKey || "";
      stripeForm.webhookSecret.value = stripeConfig.webhookSecret || "";
      stripeForm.successUrl.value = stripeConfig.successUrl || "";
      stripeForm.cancelUrl.value = stripeConfig.cancelUrl || "";
    }
  }
}

function employeeAction() {
  if (currentRole !== "employee") {
    setStatus("Switch to Employee view to manage settings.", true);
    return false;
  }
  return true;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function clientApi(path) {
  return `${CLIENT_API_BASE}${path}`;
}

function employeeApi(path) {
  return `${EMPLOYEE_API_BASE}${path}`;
}

function authHeaders() {
  return authToken ? { Authorization: `Bearer ${authToken}` } : {};
}

async function handleLogin(type, formData) {
  const payload = Object.fromEntries(formData.entries());
  payload.type = type;
  try {
    const base = type === "employee" ? employeeApi("/api/login") : clientApi("/api/login");
    const res = await fetch(base, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || "Unable to login");
    authToken = json.token;
    authUser = json.user;
    sessionStorage.setItem("authToken", authToken);
    sessionStorage.setItem("authUser", JSON.stringify(authUser));
    setStatus(`Signed in as ${authUser.email}`, false);
    setRole(authUser.roleType === "employee" ? "employee" : "client");
  } catch (err) {
    setStatus(err.message, true);
  }
}

function logout() {
  fetch(clientApi("/api/logout"), { method: "POST", headers: authHeaders() }).catch(() => {});
  fetch(employeeApi("/api/logout"), { method: "POST", headers: authHeaders() }).catch(() => {});
  authToken = null;
  authUser = null;
  sessionStorage.removeItem("authToken");
  sessionStorage.removeItem("authUser");
  setRole("client");
  setStatus("Signed out.", false);
}

function isManagerOrOwner(user) {
  return user && user.roleType === "employee" && (user.employeeRole === "manager" || user.employeeRole === "owner");
}

function isOwner(user) {
  return user && user.roleType === "employee" && user.employeeRole === "owner";
}

async function handleStripeSave(event) {
  event.preventDefault();
  if (!isOwner(authUser)) {
    setStatus("Only owners can update Stripe settings.", true);
    return;
  }
  const form = event.target;
  const payload = Object.fromEntries(new FormData(form).entries());
  try {
    const res = await fetch(employeeApi("/api/admin/stripe"), {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify(payload)
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || "Unable to save Stripe settings");
    stripeConfig = json.stripeConfig || stripeConfig;
    setStatus("Stripe settings saved (stub — wire PaymentIntents/webhooks).", false);
  } catch (err) {
    setStatus(err.message, true);
  }
}
