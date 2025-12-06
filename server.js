const http = require("http");
const fs = require("fs/promises");
const path = require("path");

const DEFAULT_PORT = Number(process.env.PORT) || 3000;
const publicDir = path.join(__dirname, "public");

const services = [
  { id: "haircut", name: "Haircut", durationMinutes: 45, price: 45, description: "Standard cut and style." },
  { id: "massage", name: "Massage", durationMinutes: 60, price: 90, description: "Full body massage." },
  { id: "consult", name: "Consultation", durationMinutes: 30, price: 0, description: "Free intro consult." }
];

const bookings = [];
let bookingCounter = 1;

const clients = [];
let clientCounter = 1;

const users = [
  { id: "u-owner", email: "owner@example.com", password: "owner123", roleType: "employee", employeeRole: "owner", name: "Owner User" },
  { id: "u-manager", email: "manager@example.com", password: "manager123", roleType: "employee", employeeRole: "manager", name: "Manager User" },
  { id: "u-employee", email: "employee@example.com", password: "employee123", roleType: "employee", employeeRole: "employee", name: "Employee User" },
  { id: "u-client", email: "client@example.com", password: "client123", roleType: "client", name: "Client User" }
];

const sessions = new Map(); // token -> userId

const theme = {
  accent: "#ff7f50",
  accent2: "#2dd4bf",
  ink: "#0b1021",
  card: "#f7f8fb",
  line: "#dfe4f5"
};

const HOST = "127.0.0.1";
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (req.method === "OPTIONS") {
      return respondCors(res);
    }
    if (url.pathname.startsWith("/api/admin")) {
      await handleAdminApi(req, res, url);
      return;
    }
    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url);
      return;
    }
    await serveStatic(url.pathname, res);
  } catch (err) {
    console.error(err);
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Internal server error" }));
  }
});

server.on("error", (err) => {
  const canRetry = ["EADDRINUSE", "EACCES", "EPERM"].includes(err.code);
  if (canRetry && !server.retrying) {
    server.retrying = true;
    console.warn(`Port ${DEFAULT_PORT} unavailable (${err.code}), retrying on a random open port...`);
    server.listen(0, HOST);
    return;
  }
  console.error("Server failed to start:", err);
  process.exit(1);
});

server.on("listening", () => {
  const addr = server.address();
  if (addr && typeof addr === "object") {
    console.log(`Server running at http://${addr.address}:${addr.port}`);
  } else {
    console.log("Server running");
  }
});

server.listen(DEFAULT_PORT, HOST);

async function handleApi(req, res, url) {
  if (req.method === "POST" && url.pathname === "/api/login") {
    const payload = await readJsonBody(req, res);
    if (!payload) return;
    const { email, password, type } = payload;
    const user = users.find((u) => u.email === email && u.password === password && u.roleType === type);
    if (!user) return badRequest(res, "Invalid credentials");
    const token = `tok-${Math.random().toString(36).slice(2)}${Date.now()}`;
    sessions.set(token, user.id);
    return json(res, { token, user: publicUser(user) });
  }

  if (req.method === "POST" && url.pathname === "/api/logout") {
    const token = tokenFromAuth(req);
    if (token) sessions.delete(token);
    return json(res, { ok: true });
  }

  if (req.method === "GET" && url.pathname === "/api/me") {
    const user = userFromAuth(req);
    if (!user) return unauthorized(res);
    return json(res, { user: publicUser(user) });
  }

  if (req.method === "GET" && url.pathname === "/api/theme") {
    return json(res, theme);
  }

  if (req.method === "GET" && url.pathname === "/api/services") {
    return json(res, services);
  }

  if (req.method === "GET" && url.pathname === "/api/availability") {
    const serviceId = url.searchParams.get("serviceId");
    const date = url.searchParams.get("date");
    if (!serviceId || !date) {
      return badRequest(res, "serviceId and date are required");
    }
    const slots = buildAvailability(serviceId, date);
    return json(res, { slots });
  }

  if (req.method === "GET" && url.pathname === "/api/bookings") {
    const user = userFromAuth(req);
    const canSeeFull = user && user.roleType === "employee" && (user.employeeRole === "owner" || user.employeeRole === "manager");
    const payload = canSeeFull ? bookings : redactedBookings(bookings);
    return json(res, payload);
  }

  if (req.method === "GET" && url.pathname === "/api/calendar") {
    const user = userFromAuth(req);
    const canSeeFull = user && user.roleType === "employee" && (user.employeeRole === "owner" || user.employeeRole === "manager");
    return json(res, { bookings: canSeeFull ? bookings : redactedBookings(bookings) });
  }

  if (req.method === "POST" && url.pathname === "/api/bookings") {
    const payload = await readJsonBody(req, res);
    if (!payload) return;
    const validationError = validateBooking(payload);
    if (validationError) return badRequest(res, validationError);

    const service = services.find((s) => s.id === payload.serviceId);
    const fullName = buildFullName(payload);
    const booking = {
      id: `b-${bookingCounter++}`,
      serviceId: service.id,
      serviceName: service.name,
      date: payload.date,
      time: payload.time,
      customerName: fullName,
      firstName: payload.firstName || "",
      lastName: payload.lastName || "",
      email: payload.email,
      phone: payload.phone || null,
      notes: payload.notes || "",
      createdAt: new Date().toISOString()
    };

    if (isSlotTaken(booking)) {
      return badRequest(res, "That time slot is no longer available.");
    }

    bookings.push(booking);
    upsertClientFromBooking(booking);
    const payment = processPaymentStub(booking);
    const reminders = scheduleRemindersStub(booking);
    const wallet = generateWalletPassStub(booking);

    return json(res, { booking, payment, reminders, wallet });
  }

  return notFound(res);
}

async function handleAdminApi(req, res, url) {
  const user = userFromAuth(req);
  if (!requireEmployeeRole(user, res, "manager")) return;
  const segments = url.pathname.split("/").filter(Boolean); // ["api","admin",...]
  const resource = segments[2];
  const resourceId = segments[3];

  if (req.method === "GET" && url.pathname === "/api/admin/state") {
    const payload = {
      services,
      bookings: user.employeeRole === "owner" || user.employeeRole === "manager" ? bookings : redactedBookings(bookings),
      clients,
      theme
    };
    return json(res, payload);
  }

  if (resource === "services") {
    if (req.method === "POST") {
      const payload = await readJsonBody(req, res);
      if (!payload) return;
      const required = ["id", "name", "durationMinutes", "price"];
      for (const f of required) {
        if (payload[f] === undefined || payload[f] === null || payload[f] === "") {
          return badRequest(res, `${f} is required`);
        }
      }
      if (services.some((s) => s.id === payload.id)) return badRequest(res, "Service id must be unique");
      const newService = {
        id: String(payload.id),
        name: payload.name,
        durationMinutes: Number(payload.durationMinutes),
        price: Number(payload.price),
        description: payload.description || ""
      };
      services.push(newService);
      return json(res, { service: newService });
    }

    if (req.method === "PUT" && resourceId) {
      const service = services.find((s) => s.id === resourceId);
      if (!service) return notFound(res);
      const payload = await readJsonBody(req, res);
      if (!payload) return;
      if (payload.id && payload.id !== resourceId) {
        if (services.some((s) => s.id === payload.id)) return badRequest(res, "Service id must be unique");
        service.id = String(payload.id);
      }
      if (payload.name) service.name = payload.name;
      if (payload.durationMinutes !== undefined) service.durationMinutes = Number(payload.durationMinutes);
      if (payload.price !== undefined) service.price = Number(payload.price);
      if (payload.description !== undefined) service.description = payload.description;
      bookings.forEach((b) => {
        if (b.serviceId === resourceId) {
          b.serviceId = service.id;
          b.serviceName = service.name;
        }
      });
      return json(res, { service });
    }

    if (req.method === "DELETE" && resourceId) {
      const idx = services.findIndex((s) => s.id === resourceId);
      if (idx === -1) return notFound(res);
      services.splice(idx, 1);
      const removed = removeBookingsByService(resourceId);
      return json(res, { removedBookings: removed });
    }
  }

  if (resource === "bookings" && resourceId) {
    if (req.method === "PUT") {
      const booking = bookings.find((b) => b.id === resourceId);
      if (!booking) return notFound(res);
      const payload = await readJsonBody(req, res);
      if (!payload) return;
      const nextServiceId = payload.serviceId || booking.serviceId;
      const service = services.find((s) => s.id === nextServiceId);
      if (!service) return badRequest(res, "Unknown serviceId");
      const nextFullName = buildFullName({
        customerName: payload.customerName || booking.customerName,
        firstName: payload.firstName || booking.firstName,
        lastName: payload.lastName || booking.lastName
      });
      const nextBooking = {
        ...booking,
        serviceId: nextServiceId,
        serviceName: service.name,
        date: payload.date || booking.date,
        time: payload.time || booking.time,
        customerName: nextFullName,
        firstName: payload.firstName !== undefined ? payload.firstName : booking.firstName || "",
        lastName: payload.lastName !== undefined ? payload.lastName : booking.lastName || "",
        email: payload.email || booking.email,
        phone: payload.phone !== undefined ? payload.phone : booking.phone,
        notes: payload.notes !== undefined ? payload.notes : booking.notes
      };
      const validationError = validateBooking(nextBooking);
      if (validationError) return badRequest(res, validationError);
      if (isSlotTaken(nextBooking, booking.id)) return badRequest(res, "That time slot is no longer available.");
      Object.assign(booking, nextBooking);
      upsertClientFromBooking(booking);
      return json(res, { booking });
    }

    if (req.method === "DELETE") {
      const idx = bookings.findIndex((b) => b.id === resourceId);
      if (idx === -1) return notFound(res);
      bookings.splice(idx, 1);
      return json(res, { ok: true });
    }
  }

  if (resource === "clients" && resourceId && req.method === "PUT") {
    const client = clients.find((c) => c.id === resourceId);
    if (!client) return notFound(res);
    const payload = await readJsonBody(req, res);
    if (!payload) return;
    if (payload.name) client.name = payload.name;
    if (payload.email) client.email = payload.email;
    if (payload.phone !== undefined) client.phone = payload.phone;
    return json(res, { client });
  }

  if (resource === "theme" && req.method === "PUT") {
    const payload = await readJsonBody(req, res);
    if (!payload) return;
    const allowed = ["accent", "accent2", "ink", "card", "line"];
    for (const key of allowed) {
      if (payload[key]) theme[key] = payload[key];
    }
    return json(res, { theme });
  }

  return notFound(res);
}

function json(res, data) {
  res.writeHead(200, { "Content-Type": "application/json", ...corsHeaders() });
  res.end(JSON.stringify(data));
}

function badRequest(res, message) {
  res.writeHead(400, { "Content-Type": "application/json", ...corsHeaders() });
  res.end(JSON.stringify({ error: message }));
}

function notFound(res) {
  res.writeHead(404, { "Content-Type": "application/json", ...corsHeaders() });
  res.end(JSON.stringify({ error: "Not found" }));
}

function unauthorized(res) {
  res.writeHead(401, { "Content-Type": "application/json", ...corsHeaders() });
  res.end(JSON.stringify({ error: "Unauthorized" }));
}

async function readJsonBody(req, res) {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1e6) {
        res.writeHead(413);
        res.end();
        req.connection.destroy();
        resolve(null);
      }
    });
    req.on("end", () => {
      try {
        const parsed = JSON.parse(body || "{}");
        resolve(parsed);
      } catch (err) {
        badRequest(res, "Invalid JSON");
        resolve(null);
      }
    });
  });
}

function validateBooking(payload) {
  const required = ["serviceId", "date", "time", "email"];
  for (const field of required) {
    if (!payload[field]) return `${field} is required`;
  }
  const hasFullName = payload.customerName;
  const hasSplitName = payload.firstName && payload.lastName;
  if (!hasFullName && !hasSplitName) return "firstName and lastName are required";
  const service = services.find((s) => s.id === payload.serviceId);
  if (!service) return "Unknown serviceId";
  if (!/\d{4}-\d{2}-\d{2}/.test(payload.date)) return "date must be YYYY-MM-DD";
  if (!/\d{2}:\d{2}/.test(payload.time)) return "time must be HH:MM";
  return null;
}

function buildAvailability(serviceId, date) {
  const startHour = 9;
  const endHour = 17;
  const bookedSlots = bookings
    .filter((b) => b.serviceId === serviceId && b.date === date)
    .map((b) => b.time);
  const slots = [];
  for (let hour = startHour; hour <= endHour; hour++) {
    for (const minute of [0, 30]) {
      const slot = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
      if (!bookedSlots.includes(slot)) slots.push(slot);
    }
  }
  return slots;
}

function isSlotTaken(newBooking, ignoreId) {
  return bookings.some(
    (b) =>
      b.id !== ignoreId &&
      b.serviceId === newBooking.serviceId &&
      b.date === newBooking.date &&
      b.time === newBooking.time
  );
}

function buildFullName(payload) {
  if (payload.customerName) return payload.customerName.trim();
  const first = (payload.firstName || "").trim();
  const last = (payload.lastName || "").trim();
  return [first, last].filter(Boolean).join(" ").trim();
}

function processPaymentStub(booking) {
  return {
    status: "pending",
    provider: "stripe",
    note: "Replace with Stripe PaymentIntent creation and client secret handshake.",
    amount: services.find((s) => s.id === booking.serviceId)?.price ?? 0,
    currency: "USD"
  };
}

function scheduleRemindersStub(booking) {
  return {
    sms: {
      enabled: true,
      note: "Integrate with Twilio/MessageBird/etc. to send SMS reminders."
    },
    email: {
      enabled: true,
      note: "Hook up SendGrid/SES/etc. to send confirmation and reminder emails."
    },
    sendAt: reminderScheduleFromBooking(booking)
  };
}

function reminderScheduleFromBooking(booking) {
  const bookingDateTime = new Date(`${booking.date}T${booking.time}:00`);
  const oneDayBefore = new Date(bookingDateTime.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const oneHourBefore = new Date(bookingDateTime.getTime() - 60 * 60 * 1000).toISOString();
  return { oneDayBefore, oneHourBefore };
}

function generateWalletPassStub(booking) {
  return {
    appleWallet: {
      note: "Generate PKPass and return .pkpass URL for iPhone wallet.",
      downloadUrl: null
    },
    googleWallet: {
      note: "Create Google Wallet pass and return save link/JSON JWT.",
      saveUrl: null
    }
  };
}

function upsertClientFromBooking(booking) {
  if (!booking.email) return null;
  const existing = clients.find((c) => c.email === booking.email);
  if (existing) {
    existing.name = booking.customerName;
    existing.phone = booking.phone;
    existing.lastBookingId = booking.id;
    existing.lastServiceName = booking.serviceName;
    return existing;
  }
  const client = {
    id: `c-${clientCounter++}`,
    name: booking.customerName,
    email: booking.email,
    phone: booking.phone || null,
    lastBookingId: booking.id,
    lastServiceName: booking.serviceName
  };
  clients.push(client);
  return client;
}

function removeBookingsByService(serviceId) {
  let removed = 0;
  for (let i = bookings.length - 1; i >= 0; i--) {
    if (bookings[i].serviceId === serviceId) {
      bookings.splice(i, 1);
      removed++;
    }
  }
  return removed;
}

function redactedBookings(list) {
  return list.map((b) => ({
    id: b.id,
    serviceId: b.serviceId,
    serviceName: b.serviceName,
    date: b.date,
    time: b.time,
    // Contact details intentionally removed for client-facing calendar.
    customerName: b.customerName ? `${b.customerName}` : "Booked"
  }));
}

function publicUser(user) {
  if (!user) return null;
  const { password, ...safe } = user;
  return safe;
}

function tokenFromAuth(req) {
  const header = req.headers["authorization"];
  if (!header) return null;
  const [type, token] = header.split(" ");
  if (type !== "Bearer") return null;
  return token;
}

function userFromAuth(req) {
  const token = tokenFromAuth(req);
  if (!token) return null;
  const userId = sessions.get(token);
  if (!userId) return null;
  return users.find((u) => u.id === userId) || null;
}

function requireEmployeeRole(user, res, minRole) {
  if (!user || user.roleType !== "employee") {
    res.writeHead(403, { "Content-Type": "application/json", ...corsHeaders() });
    res.end(JSON.stringify({ error: "Forbidden: employee role required" }));
    return false;
  }
  const order = ["employee", "manager", "owner"];
  const userRank = order.indexOf(user.employeeRole || "employee");
  const minRank = order.indexOf(minRole);
  if (userRank < minRank) {
    res.writeHead(403, { "Content-Type": "application/json", ...corsHeaders() });
    res.end(JSON.stringify({ error: "Forbidden: insufficient role" }));
    return false;
  }
  return true;
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Authorization"
  };
}

function respondCors(res) {
  res.writeHead(200, corsHeaders());
  res.end();
}

async function serveStatic(pathname, res) {
  const safePath = path.normalize(pathname).replace(/^\/+/, "");
  const targetPath = path.join(publicDir, safePath || "index.html");
  if (!targetPath.startsWith(publicDir)) {
    res.writeHead(403);
    res.end();
    return;
  }

  let stat;
  try {
    stat = await fs.stat(targetPath);
  } catch (err) {
    res.writeHead(404);
    res.end();
    return;
  }

  const filePath = stat.isDirectory() ? path.join(targetPath, "index.html") : targetPath;

  try {
    const data = await fs.readFile(filePath);
    res.writeHead(200, { "Content-Type": contentType(filePath) });
    res.end(data);
  } catch (err) {
    res.writeHead(404);
    res.end();
  }
}

function contentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".js":
      return "text/javascript; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    default:
      return "application/octet-stream";
  }
}
