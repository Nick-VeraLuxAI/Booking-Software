const http = require("http");

const {
  services,
  barbers,
  bookings,
  clients,
  users,
  theme,
  stripeConfig,
  nextBookingId,
  nextClientId
} = require("./shared/store");
const {
  validateBooking,
  buildAvailability,
  buildFullName,
  isSlotTaken,
  processPaymentStub,
  scheduleRemindersStub,
  generateWalletPassStub,
  upsertClientFromBooking,
  redactedBookings
} = require("./shared/utils");

const PORT = Number(process.env.EMPLOYEE_PORT) || 3002;
const HOST = "127.0.0.1";
const sessions = new Map(); // token -> userId

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (req.method === "OPTIONS") {
      return respondCors(res);
    }
    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url);
      return;
    }
    res.writeHead(404);
    res.end();
  } catch (err) {
    console.error(err);
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Internal server error" }));
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Employee service running at http://${HOST}:${PORT}`);
});

async function handleApi(req, res, url) {
  if (req.method === "POST" && url.pathname === "/api/login") {
    const payload = await readJsonBody(req, res);
    if (!payload) return;
    const { email, password, type } = payload;
    const user = users.find(
      (u) => u.email === email && u.password === password && u.roleType === "employee" && type === "employee"
    );
    if (!user) return badRequest(res, "Invalid credentials");
    const token = issueToken(user.id);
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

  if (req.method === "GET" && url.pathname === "/api/admin/state") {
    const user = userFromAuth(req);
    if (!requireEmployeeRole(user, res, "manager")) return;
    const payload = {
      services,
      barbers,
      bookings: user.employeeRole === "owner" || user.employeeRole === "manager" ? bookings : redactedBookings(bookings),
      clients,
      theme,
      stripeConfig: user.employeeRole === "owner" ? stripeConfig : undefined
    };
    return json(res, payload);
  }

  // Services CRUD (manager+)
  if (url.pathname === "/api/admin/services" && req.method === "POST") {
    const user = userFromAuth(req);
    if (!requireEmployeeRole(user, res, "manager")) return;
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

  if (url.pathname.startsWith("/api/admin/services/") && req.method === "PUT") {
    const user = userFromAuth(req);
    if (!requireEmployeeRole(user, res, "manager")) return;
    const resourceId = url.pathname.split("/").pop();
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

  if (url.pathname.startsWith("/api/admin/services/") && req.method === "DELETE") {
    const user = userFromAuth(req);
    if (!requireEmployeeRole(user, res, "manager")) return;
    const resourceId = url.pathname.split("/").pop();
    const idx = services.findIndex((s) => s.id === resourceId);
    if (idx === -1) return notFound(res);
    services.splice(idx, 1);
    const removed = removeBookingsByService(resourceId);
    return json(res, { removedBookings: removed });
  }

  // Bookings admin (manager+)
  if (url.pathname === "/api/admin/bookings" && req.method === "POST") {
    const user = userFromAuth(req);
    if (!requireEmployeeRole(user, res, "manager")) return;
    const payload = await readJsonBody(req, res);
    if (!payload) return;
    const validationError = validateBooking(payload, services, barbers);
    if (validationError) return badRequest(res, validationError);
    const service = services.find((s) => s.id === payload.serviceId);
    const barber = barbers.find((b) => b.id === payload.barberId);
    const fullName = buildFullName(payload);
    const booking = {
      id: nextBookingId(),
      serviceId: service.id,
      serviceName: service.name,
      barberId: barber.id,
      barberName: barber.name,
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
    if (isSlotTaken(bookings, booking)) return badRequest(res, "That time slot is no longer available.");
    bookings.push(booking);
    upsertClientFromBooking(clients, nextClientId, booking);
    const payment = processPaymentStub(booking, services);
    const reminders = scheduleRemindersStub(booking);
    const wallet = generateWalletPassStub(booking);
    return json(res, { booking, payment, reminders, wallet });
  }

  if (url.pathname.startsWith("/api/admin/bookings/") && req.method === "PUT") {
    const user = userFromAuth(req);
    if (!requireEmployeeRole(user, res, "manager")) return;
    const bookingId = url.pathname.split("/").pop();
    const booking = bookings.find((b) => b.id === bookingId);
    if (!booking) return notFound(res);
    const payload = await readJsonBody(req, res);
    if (!payload) return;
    const nextServiceId = payload.serviceId || booking.serviceId;
    const nextBarberId = payload.barberId || booking.barberId;
    const service = services.find((s) => s.id === nextServiceId);
    const barber = barbers.find((b) => b.id === nextBarberId);
    if (!service) return badRequest(res, "Unknown serviceId");
    if (!barber) return badRequest(res, "Unknown barberId");
    const nextFullName = buildFullName({
      customerName: payload.customerName || booking.customerName,
      firstName: payload.firstName || booking.firstName,
      lastName: payload.lastName || booking.lastName
    });
    const nextBooking = {
      ...booking,
      serviceId: nextServiceId,
      serviceName: service.name,
      barberId: barber.id,
      barberName: barber.name,
      date: payload.date || booking.date,
      time: payload.time || booking.time,
      customerName: nextFullName,
      firstName: payload.firstName !== undefined ? payload.firstName : booking.firstName || "",
      lastName: payload.lastName !== undefined ? payload.lastName : booking.lastName || "",
      email: payload.email || booking.email,
      phone: payload.phone !== undefined ? payload.phone : booking.phone,
      notes: payload.notes !== undefined ? payload.notes : booking.notes
    };
    const validationError = validateBooking(nextBooking, services, barbers);
    if (validationError) return badRequest(res, validationError);
    if (isSlotTaken(bookings, nextBooking, booking.id)) return badRequest(res, "That time slot is no longer available.");
    Object.assign(booking, nextBooking);
    upsertClientFromBooking(clients, nextClientId, booking);
    return json(res, { booking });
  }

  if (url.pathname.startsWith("/api/admin/bookings/") && req.method === "DELETE") {
    const user = userFromAuth(req);
    if (!requireEmployeeRole(user, res, "manager")) return;
    const bookingId = url.pathname.split("/").pop();
    const idx = bookings.findIndex((b) => b.id === bookingId);
    if (idx === -1) return notFound(res);
    bookings.splice(idx, 1);
    return json(res, { ok: true });
  }

  // Clients update (manager+)
  if (url.pathname.startsWith("/api/admin/clients/") && req.method === "PUT") {
    const user = userFromAuth(req);
    if (!requireEmployeeRole(user, res, "manager")) return;
    const clientId = url.pathname.split("/").pop();
    const client = clients.find((c) => c.id === clientId);
    if (!client) return notFound(res);
    const payload = await readJsonBody(req, res);
    if (!payload) return;
    if (payload.name) client.name = payload.name;
    if (payload.email) client.email = payload.email;
    if (payload.phone !== undefined) client.phone = payload.phone;
    return json(res, { client });
  }

  // Theme update (manager+)
  if (url.pathname === "/api/admin/theme" && req.method === "PUT") {
    const user = userFromAuth(req);
    if (!requireEmployeeRole(user, res, "manager")) return;
    const payload = await readJsonBody(req, res);
    if (!payload) return;
    const allowed = ["accent", "accent2", "ink", "card", "line"];
    for (const key of allowed) {
      if (payload[key]) theme[key] = payload[key];
    }
    return json(res, { theme });
  }

  if (url.pathname === "/api/admin/stripe" && req.method === "GET") {
    const user = userFromAuth(req);
    if (!requireEmployeeRole(user, res, "owner")) return;
    return json(res, { stripeConfig });
  }

  if (url.pathname === "/api/admin/stripe" && req.method === "PUT") {
    const user = userFromAuth(req);
    if (!requireEmployeeRole(user, res, "owner")) return;
    const payload = await readJsonBody(req, res);
    if (!payload) return;
    const allowed = ["publishableKey", "secretKey", "webhookSecret", "successUrl", "cancelUrl"];
    for (const key of allowed) {
      if (payload[key] !== undefined) stripeConfig[key] = payload[key];
    }
    return json(res, { stripeConfig });
  }

  // Availability helper for employee tools
  if (req.method === "GET" && url.pathname === "/api/availability") {
    const user = userFromAuth(req);
    if (!requireEmployeeRole(user, res, "employee")) return;
    const serviceId = url.searchParams.get("serviceId");
    const barberId = url.searchParams.get("barberId");
    const date = url.searchParams.get("date");
    if (!serviceId || !barberId || !date) {
      return badRequest(res, "serviceId, barberId, and date are required");
    }
    const slots = buildAvailability(services, bookings, serviceId, barberId, date);
    return json(res, { slots });
  }

  return notFound(res);
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

function readJsonBody(req, res) {
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

function issueToken(userId) {
  const token = `tok-${Math.random().toString(36).slice(2)}${Date.now()}`;
  sessions.set(token, userId);
  return token;
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
  return users.find((u) => u.id === userId && u.roleType === "employee") || null;
}

function publicUser(user) {
  if (!user) return null;
  const { password, ...safe } = user;
  return safe;
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
