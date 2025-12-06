function buildFullName(payload) {
  if (payload.customerName) return payload.customerName.trim();
  const first = (payload.firstName || "").trim();
  const last = (payload.lastName || "").trim();
  return [first, last].filter(Boolean).join(" ").trim();
}

function validateBooking(payload, services, barbers) {
  const required = ["serviceId", "barberId", "date", "time", "email"];
  for (const field of required) {
    if (!payload[field]) return `${field} is required`;
  }
  const hasFullName = payload.customerName;
  const hasSplitName = payload.firstName && payload.lastName;
  if (!hasFullName && !hasSplitName) return "firstName and lastName are required";
  const service = services.find((s) => s.id === payload.serviceId);
  if (!service) return "Unknown serviceId";
  const barber = barbers.find((b) => b.id === payload.barberId);
  if (!barber) return "Unknown barberId";
  if (!/\d{4}-\d{2}-\d{2}/.test(payload.date)) return "date must be YYYY-MM-DD";
  if (!/\d{2}:\d{2}/.test(payload.time)) return "time must be HH:MM";
  return null;
}

function buildAvailability(services, bookings, serviceId, barberId, date) {
  const service = services.find((s) => s.id === serviceId);
  if (!service) return [];
  const startHour = 9;
  const endHour = 17;
  const bookedSlots = bookings
    .filter((b) => b.serviceId === serviceId && b.barberId === barberId && b.date === date)
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

function isSlotTaken(bookings, newBooking, ignoreId) {
  return bookings.some(
    (b) =>
      b.id !== ignoreId &&
      b.serviceId === newBooking.serviceId &&
      b.date === newBooking.date &&
      b.time === newBooking.time
  );
}

function processPaymentStub(booking, services) {
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

function generateWalletPassStub() {
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

function upsertClientFromBooking(clients, nextClientId, booking) {
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
    id: nextClientId(),
    name: booking.customerName,
    email: booking.email,
    phone: booking.phone || null,
    lastBookingId: booking.id,
    lastServiceName: booking.serviceName
  };
  clients.push(client);
  return client;
}

function redactedBookings(list) {
  return list.map((b) => ({
    id: b.id,
    serviceId: b.serviceId,
    serviceName: b.serviceName,
    barberId: b.barberId,
    barberName: b.barberName,
    date: b.date,
    time: b.time,
    customerName: b.customerName ? `${b.customerName}` : "Booked"
  }));
}

module.exports = {
  buildFullName,
  validateBooking,
  buildAvailability,
  isSlotTaken,
  processPaymentStub,
  scheduleRemindersStub,
  reminderScheduleFromBooking,
  generateWalletPassStub,
  upsertClientFromBooking,
  redactedBookings
};
