const services = [
  { id: "haircut", name: "Haircut", durationMinutes: 45, price: 45, description: "Standard cut and style." },
  { id: "massage", name: "Massage", durationMinutes: 60, price: 90, description: "Full body massage." },
  { id: "consult", name: "Consultation", durationMinutes: 30, price: 0, description: "Free intro consult." }
];

const barbers = [
  { id: "brynn", name: "Brynn Carter" },
  { id: "kai", name: "Kai Johnson" },
  { id: "morgan", name: "Morgan Lee" }
];

const bookings = [];
let bookingCounter = 1;

const clients = [];
let clientCounter = 1;

const stripeConfig = {
  publishableKey: "",
  secretKey: "",
  webhookSecret: "",
  successUrl: "",
  cancelUrl: ""
};

const users = [
  { id: "u-owner", email: "owner@example.com", password: "owner123", roleType: "employee", employeeRole: "owner", name: "Owner User" },
  { id: "u-manager", email: "manager@example.com", password: "manager123", roleType: "employee", employeeRole: "manager", name: "Manager User" },
  { id: "u-employee", email: "employee@example.com", password: "employee123", roleType: "employee", employeeRole: "employee", name: "Employee User" },
  { id: "u-client", email: "client@example.com", password: "client123", roleType: "client", name: "Client User" }
];

const theme = {
  accent: "#ff7f50",
  accent2: "#2dd4bf",
  ink: "#0b1021",
  card: "#f7f8fb",
  line: "#dfe4f5"
};

function nextBookingId() {
  return `b-${bookingCounter++}`;
}

function nextClientId() {
  return `c-${clientCounter++}`;
}

module.exports = {
  services,
  barbers,
  bookings,
  clients,
  users,
  theme,
  stripeConfig,
  nextBookingId,
  nextClientId
};
