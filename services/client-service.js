const http = require("http");
const fs = require("fs/promises");
const path = require("path");

const { services, barbers, bookings, clients, theme, users, nextBookingId, nextClientId } = require("./shared/store");
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

const PORT = Number(process.env.CLIENT_PORT) || 3001;
const HOST = "127.0.0.1";
const publicDir = path.join(__dirname, "..", "public");
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
    console.warn(`Client port ${PORT} unavailable (${err.code}), retrying on a random open port...`);
    server.listen(0, HOST);
    return;
  }
  console.error("Client service failed to start:", err);
  process.exit(1);
});

server.on("listening", () => {
  const addr = server.address();
  if (addr && typeof addr === "object") {
    console.log(`Client service running at http://${addr.address}:${addr.port}`);
  } else {
    console.log("Client service running");
  }
});

server.listen(PORT, HOST);

async function handleApi(req, res, url) {
  if (req.method === "POST" && url.pathname === "/api/login") {
    const payload = await readJsonBody(req, res);
    if (!payload) return;
    const { email, password, type } = payload;
    const user = users.find((u) => u.email === email && u.password === password && u.roleType === "client" && type === "client");
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

  if (req.method === "GET" && url.pathname === "/api/theme") {
    return json(res, theme);
  }

  if (req.method === "GET" && url.pathname === "/api/services") {
    return json(res, services);
  }

  if (req.method === "GET" && url.pathname === "/api/barbers") {
    return json(res, barbers);
  }

  if (req.method === "GET" && url.pathname === "/api/availability") {
    const serviceId = url.searchParams.get("serviceId");
    const barberId = url.searchParams.get("barberId");
    const date = url.searchParams.get("date");
    if (!serviceId || !barberId || !date) {
      return badRequest(res, "serviceId, barberId, and date are required");
    }
    const slots = buildAvailability(services, bookings, serviceId, barberId, date);
    return json(res, { slots });
  }

  if (req.method === "GET" && url.pathname === "/api/bookings") {
    return json(res, redactedBookings(bookings));
  }

  if (req.method === "GET" && url.pathname === "/api/calendar") {
    return json(res, { bookings: redactedBookings(bookings) });
  }

  if (req.method === "POST" && url.pathname === "/api/bookings") {
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

    if (isSlotTaken(bookings, booking)) {
      return badRequest(res, "That time slot is no longer available.");
    }

    bookings.push(booking);
    upsertClientFromBooking(clients, nextClientId, booking);
    const payment = processPaymentStub(booking, services);
    const reminders = scheduleRemindersStub(booking);
    const wallet = generateWalletPassStub(booking);

    return json(res, { booking, payment, reminders, wallet });
  }

  return notFound(res);
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
  return users.find((u) => u.id === userId && u.roleType === "client") || null;
}

function publicUser(user) {
  if (!user) return null;
  const { password, ...safe } = user;
  return safe;
}
