# Booking Service (Demo)

A minimal full-stack booking app with separate client/employee services. The client flow walks through service → barber → date/time → client info. Bookings return stub payloads for payments, reminders, and wallet passes so you can wire real providers later.

## Quick start (microservices)
1. Install Node (18+). No external deps required.
2. Start the client-facing service (serves the UI and public APIs):
   ```bash
   npm run start:client   # defaults to http://127.0.0.1:3001
   ```
3. Start the employee service (admin APIs):
   ```bash
   npm run start:employee # defaults to http://127.0.0.1:3002
   ```
4. Open the UI from the client service: <http://127.0.0.1:3001>
5. You can override ports with `CLIENT_PORT` and `EMPLOYEE_PORT`.

## API overview
### Client service (defaults to :3001)
- `GET /api/services` — list available services.
- `GET /api/barbers` — list barbers.
- `GET /api/availability?serviceId=ID&barberId=ID&date=YYYY-MM-DD` — returns open half-hour slots (09:00–17:00) excluding existing bookings for that service + barber.
- `POST /api/bookings` — body: `{ serviceId, barberId, date, time, firstName, lastName, email, phone?, notes? }` (accepts legacy `customerName`)  
  Returns `{ booking, payment, reminders, wallet }`.
- `GET /api/bookings` — list redacted bookings.
- `GET /api/calendar` — redacted bookings for the client-facing calendar.
- `GET /api/theme` — current theme values.
- Auth: `POST /api/login` (type=client), `POST /api/logout`, `GET /api/me`.

### Employee service (defaults to :3002)
- Auth: `POST /api/login` (type=employee; owner/manager/employee roles), `POST /api/logout`, `GET /api/me`.
- `GET /api/admin/state` — services, barbers, bookings (full for owner/manager, redacted for lower roles), clients, theme, stripeConfig (owners only). Requires manager+.
- Services CRUD: `POST /api/admin/services`, `PUT /api/admin/services/:id`, `DELETE /api/admin/services/:id` (manager+).
- Bookings admin: `POST /api/admin/bookings`, `PUT /api/admin/bookings/:id`, `DELETE /api/admin/bookings/:id` (manager+).
- Clients update: `PUT /api/admin/clients/:id` (manager+).
- Theme update: `PUT /api/admin/theme` (manager+).
- Stripe settings (owner only): `GET /api/admin/stripe`, `PUT /api/admin/stripe`.
- Availability helper for employees: `GET /api/availability?serviceId=ID&barberId=ID&date=YYYY-MM-DD` (employee+).

## Where to integrate
- `processPaymentStub` (server.js): replace with Stripe PaymentIntent creation; surface `client_secret` to the client. Owner settings let you store Stripe keys/webhook URLs in-memory (`/api/admin/stripe`).
- `scheduleRemindersStub` (server.js): hook up SMS (Twilio/MessageBird/etc.) and email (SES/SendGrid/etc.) and schedule jobs.
- `generateWalletPassStub` (server.js): create Apple Wallet `.pkpass` and Google Wallet pass and set download/save URLs.
- Services/barbers live in `services/shared/store.js`; adjust pricing/durations and staff there.

## Editing settings in the UI
- Use the role toggle (Client vs Employee) at the top. Employee unlocks editing.
- The "Control center" panel (Employee view) lets you edit services, reschedule/delete appointments, update client info, and tweak theme colors. Owner users also see a Stripe settings block (keys + webhook/signing secrets). All changes persist in memory for the current server run.
- API guard: employee routes require Bearer token; owner has full access, manager has full access minus financials (financial data not yet implemented), employee gets redacted data only.
- Sample logins:  
  - Owner: `owner@example.com` / `owner123`  
  - Manager: `manager@example.com` / `manager123`  
  - Employee: `employee@example.com` / `employee123`  
  - Client: `client@example.com` / `client123`

## Frontend flow
- Client-side booking uses dedicated windows: Step 1 service → Step 2 barber → Step 3 date/time → Step 4 client info → book (creates client profile + booking).
- Calendars: client calendar is redacted; barber calendar (Employee view) supports inline add/edit/delete via modal.

## CI/CD
- GitHub Actions workflow at `.github/workflows/ci.yml` installs deps and runs `npm test` (wire in lint/typecheck/tests as you add them).

## Notes and defaults
- Data is in-memory only; restart clears bookings. Swap for a real DB if needed.
- Availability is generated in 30-minute increments between 09:00–17:00.
- Frontend assets live in `public/` (`index.html`, `app.js`, `styles.css`).

## Troubleshooting
- If 3001/3002 are busy, set `CLIENT_PORT`/`EMPLOYEE_PORT` or note the auto-picked port logged at startup (services retry on a random open port).
- Services bind to `127.0.0.1` by default.
