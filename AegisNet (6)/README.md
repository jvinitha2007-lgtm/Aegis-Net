# AegisNet — A Protective Network

Community safety coordination prototype built with React + Vite, Express, and SQLite.

## Features
- Responsive desktop/tablet/mobile dashboard and sidebar
- Registration and login with bcrypt password hashing and SQLite-backed sessions
- Profile updates saved in the database
- Role-based incident reports, volunteer assignment and claiming, and protected case chat
- Admin incident analytics, volunteer management, and database-backed notifications
- Interactive OpenStreetMap incident picker and optional browser geolocation
- Private photo and video evidence uploads (JPEG, PNG, WebP, MP4, WebM; up to 25 MB)
- Optional SMTP email alerts and HMAC-signed webhook alerts for newly created incidents
- REST API health endpoint

## Requirements
- Node.js 20+ (Node.js 24 should also work)
- npm

## Run in VS Code
Open this root folder (the one containing `package.json`, `frontend`, and `backend`) in VS Code. Open Terminal and run:

```bash
npm install
npm install --prefix frontend
npm install --prefix backend
npm run dev
```

Open `http://127.0.0.1:5175`. The API runs at `http://127.0.0.1:4000`; health check: `http://127.0.0.1:4000/api/health`.

The first backend start creates `backend/data/aegisnet.sqlite`. Uploads are stored under `backend/uploads` and are served only to the reporting user, assigned volunteer, or admin. Back up the database and uploads together.

### External incident alerts

External services are opt-in and do not send until configured. Copy the values from `backend/.env.example` into the local `backend/.env` and restart the backend.

- SMTP email requires `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`, and `ALERT_EMAIL_TO`; optional values are `SMTP_PORT`, `SMTP_SECURE`, and `SMTP_FROM`.
- Webhook alerts require `ALERT_WEBHOOK_URL` and a long random `ALERT_WEBHOOK_SECRET`. The JSON body is signed using HMAC-SHA256 and sent in `X-AegisNet-Signature`.
- If both channels are configured, both receive a minimal incident summary. Provider credentials are never included in the dashboard response.
- Delivery attempts are recorded in SQLite and shown in the admin dashboard. Failed deliveries are logged and do not undo incident creation.

The interactive map uses OpenStreetMap tiles and therefore needs an internet connection. Browser location access requires the user's permission. Do not treat this prototype as an emergency dispatch service.

## Deploy to Render

The root `render.yaml` deploys the built frontend and API together as one Node web service. SQLite, sessions, and evidence files use `/var/data`, backed by a persistent Render disk. This configuration intentionally uses one paid `starter` instance because local SQLite and uploaded files are not safe across multiple instances or ephemeral filesystems.

1. Push this project to a GitHub repository. Do not commit `.env` files, `backend/data`, `backend/uploads`, or `node_modules`; the root `.gitignore` excludes these.
2. In Render, choose **New → Blueprint**, connect the repository, and apply `render.yaml`.
3. Let Render generate `SESSION_SECRET` and wait for the health check at `/api/health`.
4. Visit the Render service URL and initialize the owner admin account. Use a unique strong password.
5. Configure SMTP or webhook environment variables in Render only if external alerts are required; never commit provider secrets.

The deployment serves the frontend and `/api` from the same HTTPS origin, sets secure session cookies, and keeps uploads and SQLite data on the persistent disk. Back up the disk regularly. SQLite on a single persistent disk is intended for this prototype; use a managed database and object storage before scaling to multiple instances.

## Main API routes
- `POST /api/auth/register`
- `POST /api/auth/login`
- `GET /api/auth/me`
- `POST /api/auth/logout`
- `GET /api/dashboard`
- `PUT /api/profile`
- `POST /api/incidents` (multipart form; optional `evidence` file)
- `GET /api/incidents/:id/evidence` (authorized session required)
- `POST /api/incidents/:id/claim` (volunteer)
- `GET /api/chat/:incidentId`, `POST /api/chat/:incidentId`

## Important safety note
This is a local prototype, not an emergency dispatch service. Use HTTPS, strong unique session secrets, protected environment variables, rate limiting, CSRF protections, upload retention controls, and production session storage before deployment. Configure and verify alert providers before relying on delivery.
