require('dotenv').config();
const express = require('express');
const cors = require('cors');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const fs = require('fs');
const multer = require('multer');
const nodemailer = require('nodemailer');
const path = require('path');
const { run, get, all, init } = require('./db');

const app = express();
const DEFAULT_PORT = Number(process.env.PORT || 4000);
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || 'http://localhost:5173';
const HOST = process.env.HOST || (process.env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1');
const dataDir = path.resolve(process.env.AEGIS_DATA_DIR || path.join(__dirname, 'data'));
const frontendDistDir = path.resolve(__dirname, '..', 'frontend', 'dist');
const uploadDir = path.join(dataDir, 'uploads');
fs.mkdirSync(uploadDir, { recursive: true });
const evidenceTypes = {
  'image/jpeg': { extension: '.jpg', kind: 'image' },
  'image/png': { extension: '.png', kind: 'image' },
  'image/webp': { extension: '.webp', kind: 'image' },
  'video/mp4': { extension: '.mp4', kind: 'video' },
  'video/webm': { extension: '.webm', kind: 'video' }
};
const incidentUpload = multer({
  storage: multer.diskStorage({
    destination: uploadDir,
    filename: (_req, file, callback) => callback(null, `${crypto.randomUUID()}${evidenceTypes[file.mimetype]?.extension || '.upload'}`)
  }),
  limits: { fileSize: 25 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, callback) => {
    if (!evidenceTypes[file.mimetype]) return callback(new Error('Attach a JPEG, PNG, WebP, MP4, or WebM file.'));
    callback(null, true);
  }
});
const publicUser = user => ({
  id: user.id,
  name: user.name,
  email: user.email,
  role: user.role || 'user',
  phone: user.phone || '',
  avatar_url: user.avatar_url || '',
  bio: user.bio || '',
  availability: user.availability || '',
  skills: user.skills || '',
  location: user.location || '',
  status: user.status || 'active',
  created_at: user.created_at
});
const cleanEmail = email => String(email || '').trim().toLowerCase();
const cleanName = name => String(name || '').trim();
const cleanRole = role => (['user', 'volunteer', 'admin'].includes(String(role || '').toLowerCase()) ? String(role).toLowerCase() : 'user');

function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Please sign in to continue.' });
  next();
}
function requireRole(allowedRoles = []) {
  return async function roleGuard(req, res, next) {
    const user = await get('SELECT role, status FROM users WHERE id = ?', [req.session.userId]);
    if (!user || !allowedRoles.includes(user.role) || user.status === 'suspended') {
      return res.status(403).json({ error: 'You are not authorized for this action.' });
    }
    next();
  };
}
function parseIncidentUpload(req, res, next) {
  incidentUpload.single('evidence')(req, res, error => {
    if (error) return res.status(400).json({ error: error.message });
    next();
  });
}
function handleError(res, error) {
  console.error(error);
  res.status(500).json({ error: 'Server error. Check the VS Code backend terminal.' });
}
function configuredAlertChannels() {
  const smtpReady = Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS && process.env.ALERT_EMAIL_TO);
  const webhookReady = Boolean(process.env.ALERT_WEBHOOK_URL && process.env.ALERT_WEBHOOK_SECRET);
  return { email: smtpReady, webhook: webhookReady };
}
async function deliverIncidentAlerts(incident) {
  const channels = configuredAlertChannels();
  const payload = {
    event: 'incident.created',
    incident: {
      id: incident.id,
      title: incident.title,
      category: incident.category,
      severity: incident.severity,
      status: incident.status,
      location: incident.location_text || '',
      created_at: incident.created_at
    }
  };

  if (channels.email) {
    try {
      const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT || 587),
        secure: String(process.env.SMTP_SECURE || '').toLowerCase() === 'true',
        auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
      });
      await transporter.sendMail({
        from: process.env.SMTP_FROM || process.env.SMTP_USER,
        to: process.env.ALERT_EMAIL_TO,
        subject: `[AegisNet] ${incident.severity} incident reported`,
        text: `${incident.title}\nCategory: ${incident.category}\nSeverity: ${incident.severity}\nStatus: ${incident.status}\nLocation: ${incident.location_text || 'Not provided'}\nIncident ID: ${incident.id}\n\nSign in to AegisNet to review the report.`
      });
      await run('INSERT INTO alert_deliveries (incident_id, provider, status) VALUES (?, ?, ?)', [incident.id, 'smtp', 'sent']);
    } catch (error) {
      console.error('SMTP incident alert failed:', error);
      await run('INSERT INTO alert_deliveries (incident_id, provider, status, details) VALUES (?, ?, ?, ?)', [incident.id, 'smtp', 'failed', String(error.message).slice(0, 300)]);
    }
  }

  if (channels.webhook) {
    try {
      const body = JSON.stringify(payload);
      const signature = crypto.createHmac('sha256', process.env.ALERT_WEBHOOK_SECRET).update(body).digest('hex');
      const response = await fetch(process.env.ALERT_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-AegisNet-Signature': `sha256=${signature}` },
        body,
        signal: AbortSignal.timeout(8000)
      });
      if (!response.ok) throw new Error(`Webhook returned HTTP ${response.status}.`);
      await run('INSERT INTO alert_deliveries (incident_id, provider, status) VALUES (?, ?, ?)', [incident.id, 'webhook', 'sent']);
    } catch (error) {
      console.error('Webhook incident alert failed:', error);
      await run('INSERT INTO alert_deliveries (incident_id, provider, status, details) VALUES (?, ?, ?, ?)', [incident.id, 'webhook', 'failed', String(error.message).slice(0, 300)]);
    }
  }
}
async function adminExists() {
  const row = await get("SELECT id FROM users WHERE role = 'admin' LIMIT 1");
  return Boolean(row);
}

function normalizeSearchTerms(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(term => term.length > 2);
}

function scoreVolunteerMatch(volunteer, incident) {
  const candidateTerms = normalizeSearchTerms(`${incident.title} ${incident.category} ${incident.description}`);
  const volunteerText = [
    volunteer.skills,
    volunteer.location,
    volunteer.availability,
    volunteer.bio,
    volunteer.name
  ].join(' ').toLowerCase();

  let score = volunteer.status === 'active' ? 10 : 0;
  const reasons = [];

  const skillMatches = [...new Set(candidateTerms.filter(term => volunteerText.includes(term)))];
  if (skillMatches.length) {
    score += skillMatches.length * 14;
    reasons.push(`skills: ${skillMatches.slice(0, 2).join(', ')}`);
  }

  const incidentLocation = String(incident.location_text || '').toLowerCase();
  if (incidentLocation && volunteer.location) {
    const volunteerLocation = volunteer.location.toLowerCase();
    if (volunteerLocation.includes(incidentLocation) || incidentLocation.includes(volunteerLocation)) {
      score += 30;
      reasons.push('location match');
    }
  }

  if (volunteer.availability && /evenings?|weekends?|mornings?|nights?|days?/i.test(volunteer.availability)) {
    score += 8;
    reasons.push('availability');
  }

  if (!reasons.length) reasons.push('community responder');

  return { score: Math.min(score, 99), reasons: reasons.slice(0, 3) };
}

app.use(cors({ origin: process.env.NODE_ENV === 'production' ? false : true, credentials: true }));
app.use(express.json({ limit: '1mb' }));
app.use(session({
  store: new SQLiteStore({ db: 'sessions.sqlite', dir: dataDir }),
  name: 'aegisnet.sid',
  secret: process.env.SESSION_SECRET || 'development-only-change-me-before-deployment',
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 1000 * 60 * 60 * 8 }
}));
if (process.env.NODE_ENV === 'production') app.set('trust proxy', 1);

app.get('/api/health', (_req, res) => res.json({ ok: true, app: 'AegisNet API' }));
app.get('/api/admin/status', async (_req, res) => {
  res.json({ initialized: await adminExists() });
});
app.post('/api/admin/initialize', async (req, res) => {
  try {
    if (await adminExists()) {
      return res.status(409).json({ error: 'Owner admin is already initialized.' });
    }
    const name = cleanName(req.body.name || 'Owner Admin');
    const email = cleanEmail(req.body.email || process.env.OWNER_ADMIN_EMAIL || 'admin@aegisnet.local');
    const password = String(req.body.password || process.env.OWNER_ADMIN_PASSWORD || '');
    if (name.length < 2) return res.status(400).json({ error: 'Admin name must contain at least 2 characters.' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Enter a valid admin email.' });
    if (password.length < 8) return res.status(400).json({ error: 'Admin password must be at least 8 characters.' });
    const existing = await get('SELECT id FROM users WHERE email = ?', [email]);
    if (existing) return res.status(409).json({ error: 'This admin email is already in use.' });
    const password_hash = await bcrypt.hash(password, 12);
    const result = await run('INSERT INTO users (name, email, password_hash, role, status) VALUES (?, ?, ?, ?, ?)', [name, email, password_hash, 'admin', 'active']);
    const user = await get('SELECT * FROM users WHERE id = ?', [result.id]);
    req.session.userId = user.id;
    res.status(201).json({ user: publicUser(user), message: 'Owner admin initialized successfully.' });
  } catch (error) {
    handleError(res, error);
  }
});

app.post('/api/auth/register', async (req, res) => {
  try {
    const name = cleanName(req.body.name);
    const email = cleanEmail(req.body.email);
    const password = String(req.body.password || '');
    const role = cleanRole(req.body.role);
    if (name.length < 2) return res.status(400).json({ error: 'Name must be at least 2 characters.' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Enter a valid email address.' });
    if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    if (role === 'admin') return res.status(400).json({ error: 'Public registration does not allow administrator accounts.' });
    const existing = await get('SELECT id FROM users WHERE email = ?', [email]);
    if (existing) return res.status(409).json({ error: 'An account with this email already exists. Please sign in.' });
    const password_hash = await bcrypt.hash(password, 12);
    const result = await run('INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)', [name, email, password_hash, role]);
    const user = await get('SELECT * FROM users WHERE id = ?', [result.id]);
    req.session.userId = user.id;
    res.status(201).json({ user: publicUser(user) });
  } catch (error) {
    handleError(res, error);
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const email = cleanEmail(req.body.email);
    const password = String(req.body.password || '');
    const user = await get('SELECT * FROM users WHERE email = ?', [email]);
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ error: 'Incorrect email or password.' });
    }
    if (user.status === 'suspended') {
      return res.status(403).json({ error: 'This account is suspended.' });
    }
    req.session.userId = user.id;
    res.json({ user: publicUser(user) });
  } catch (error) {
    handleError(res, error);
  }
});

app.get('/api/auth/me', async (req, res) => {
  try {
    if (!req.session.userId) return res.status(401).json({ error: 'Not signed in.' });
    const user = await get('SELECT * FROM users WHERE id = ?', [req.session.userId]);
    if (!user) return res.status(401).json({ error: 'Account not found.' });
    res.json({ user: publicUser(user) });
  } catch (error) {
    handleError(res, error);
  }
});

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy(err => {
    if (err) return res.status(500).json({ error: 'Could not sign out.' });
    res.clearCookie('aegisnet.sid');
    res.json({ ok: true });
  });
});

app.put('/api/profile', requireAuth, async (req, res) => {
  try {
    const name = cleanName(req.body.name);
    const email = cleanEmail(req.body.email);
    const phone = String(req.body.phone || '').trim();
    const bio = String(req.body.bio || '').trim().slice(0, 400);
    const availability = String(req.body.availability || '').trim().slice(0, 200);
    const skills = String(req.body.skills || '').trim().slice(0, 300);
    const location = String(req.body.location || '').trim().slice(0, 200);
    if (name.length < 2) return res.status(400).json({ error: 'Name must be at least 2 characters.' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Enter a valid email address.' });
    const existing = await get('SELECT id FROM users WHERE email = ? AND id != ?', [email, req.session.userId]);
    if (existing) return res.status(409).json({ error: 'That email is already used by another account.' });
    await run(
      'UPDATE users SET name = ?, email = ?, phone = ?, bio = ?, availability = ?, skills = ?, location = ? WHERE id = ?',
      [name, email, phone, bio, availability, skills, location, req.session.userId]
    );
    const user = await get('SELECT * FROM users WHERE id = ?', [req.session.userId]);
    res.json({ user: publicUser(user) });
  } catch (error) {
    handleError(res, error);
  }
});

app.get('/api/dashboard', requireAuth, async (req, res) => {
  try {
    const user = await get('SELECT * FROM users WHERE id = ?', [req.session.userId]);
    if (!user) return res.status(404).json({ error: 'User not found.' });

    if (user.role === 'admin') {
      const totalUsers = await get('SELECT COUNT(*) AS count FROM users WHERE role IN ("user","volunteer")', []);
      const totalVolunteers = await get('SELECT COUNT(*) AS count FROM users WHERE role = "volunteer"', []);
      const openIncidents = await get('SELECT COUNT(*) AS count FROM incidents WHERE status NOT IN ("Resolved", "Closed")', []);
      const criticalIncidents = await get('SELECT COUNT(*) AS count FROM incidents WHERE severity = "Critical"', []);
      const unassignedIncidents = await get('SELECT COUNT(*) AS count FROM incidents WHERE volunteer_id IS NULL', []);
      const statusBreakdown = await all('SELECT status AS label, COUNT(*) AS count FROM incidents GROUP BY status ORDER BY count DESC');
      const severityBreakdown = await all('SELECT severity AS label, COUNT(*) AS count FROM incidents GROUP BY severity ORDER BY count DESC');
      const recentIncidents = await all('SELECT * FROM incidents ORDER BY created_at DESC LIMIT 8', []);
      const volunteers = await all('SELECT * FROM users WHERE role = "volunteer" ORDER BY created_at DESC', []);
      const alertDeliveries = await all(
        'SELECT incident_id, provider, status, details, created_at FROM alert_deliveries ORDER BY created_at DESC LIMIT 10'
      );
      return res.json({
        role: 'admin',
        metrics: {
          totalUsers: totalUsers.count,
          totalVolunteers: totalVolunteers.count,
          openIncidents: openIncidents.count,
          criticalIncidents: criticalIncidents.count,
          unassignedIncidents: unassignedIncidents.count
        },
        incidents: recentIncidents,
        volunteers,
        analytics: { status: statusBreakdown, severity: severityBreakdown },
        alertChannels: configuredAlertChannels(),
        alertDeliveries
      });
    }

    if (user.role === 'volunteer') {
      const assignedIncidents = await all('SELECT * FROM incidents WHERE volunteer_id = ? ORDER BY created_at DESC', [user.id]);
      const openAssignments = await all('SELECT * FROM incidents WHERE volunteer_id IS NULL AND consent = 1 AND status IN ("New", "Awaiting Volunteer") ORDER BY created_at DESC LIMIT 8', []);
      return res.json({
        role: 'volunteer',
        metrics: {
          assignedCount: assignedIncidents.length,
          availableCount: openAssignments.length
        },
        incidents: assignedIncidents,
        offers: openAssignments
      });
    }

    const userIncidents = await all('SELECT * FROM incidents WHERE user_id = ? ORDER BY created_at DESC', [user.id]);
    const latest = userIncidents[0] || null;
    return res.json({
      role: 'user',
      metrics: {
        incidentCount: userIncidents.length,
        currentStatus: latest ? latest.status : 'No active report'
      },
      incidents: userIncidents
    });
  } catch (error) {
    handleError(res, error);
  }
});

app.get('/api/incidents', requireAuth, async (req, res) => {
  try {
    const user = await get('SELECT role FROM users WHERE id = ?', [req.session.userId]);
    if (!user) return res.status(404).json({ error: 'User not found.' });
    if (user.role === 'admin') {
      const incidents = await all('SELECT i.*, u.name AS user_name, v.name AS volunteer_name FROM incidents i LEFT JOIN users u ON u.id = i.user_id LEFT JOIN users v ON v.id = i.volunteer_id ORDER BY i.created_at DESC');
      return res.json({ incidents });
    }
    if (user.role === 'volunteer') {
      const incidents = await all('SELECT i.*, u.name AS user_name FROM incidents i LEFT JOIN users u ON u.id = i.user_id WHERE i.volunteer_id = ? OR (i.volunteer_id IS NULL AND i.consent = 1) ORDER BY i.created_at DESC', [req.session.userId]);
      return res.json({ incidents });
    }
    const incidents = await all('SELECT * FROM incidents WHERE user_id = ? ORDER BY created_at DESC', [req.session.userId]);
    res.json({ incidents });
  } catch (error) {
    handleError(res, error);
  }
});

app.post('/api/incidents', requireAuth, requireRole(['user']), parseIncidentUpload, async (req, res) => {
  try {
    const user = await get('SELECT role FROM users WHERE id = ?', [req.session.userId]);
    if (!user || user.role !== 'user') {
      return res.status(403).json({ error: 'Only users can create incidents.' });
    }
    const title = cleanName(req.body.title || '').slice(0, 120);
    const description = String(req.body.description || '').trim().slice(0, 2000);
    const category = String(req.body.category || 'Other community concern').trim();
    const severity = ['Critical', 'Medium', 'Low'].includes(String(req.body.severity || '')) ? String(req.body.severity) : 'Medium';
    const locationText = String(req.body.locationText || '').trim().slice(0, 200);
    const evidenceSummary = String(req.body.evidenceSummary || '').trim().slice(0, 1000);
    const consent = Number(req.body.consent || 0) ? 1 : 0;
    const latitude = req.body.latitude === '' || req.body.latitude == null ? null : Number(req.body.latitude);
    const longitude = req.body.longitude === '' || req.body.longitude == null ? null : Number(req.body.longitude);
    const imagePath = req.file ? path.join(uploadDir, req.file.filename) : null;
    const discardUpload = () => imagePath && fs.existsSync(imagePath) && fs.unlinkSync(imagePath);
    if (!title || !description) {
      discardUpload();
      return res.status(400).json({ error: 'Title and description are required.' });
    }
    if ((latitude !== null && (!Number.isFinite(latitude) || latitude < -90 || latitude > 90)) ||
      (longitude !== null && (!Number.isFinite(longitude) || longitude < -180 || longitude > 180))) {
      discardUpload();
      return res.status(400).json({ error: 'Location coordinates are invalid.' });
    }
    if (req.file) {
      const header = fs.readFileSync(imagePath).subarray(0, 12);
      const isJpeg = header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff;
      const isPng = header.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
      const isWebp = header.toString('ascii', 0, 4) === 'RIFF' && header.toString('ascii', 8, 12) === 'WEBP';
      const isMp4 = req.file.mimetype === 'video/mp4' && header.toString('ascii', 4, 8) === 'ftyp';
      const isWebm = req.file.mimetype === 'video/webm' && header.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
      const validMime = evidenceTypes[req.file.mimetype];
      const validSignature = validMime?.kind === 'image'
        ? (isJpeg || isPng || isWebp)
        : (isMp4 || isWebm);
      if (!validSignature) {
        discardUpload();
        return res.status(400).json({ error: 'The uploaded file does not match its supported media type.' });
      }
    }
    const result = await run(
      'INSERT INTO incidents (user_id, title, category, description, severity, status, location_text, latitude, longitude, evidence_summary, evidence_filename, evidence_mime, consent) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [req.session.userId, title, category, description, severity, 'New', locationText, latitude, longitude, evidenceSummary, req.file ? req.file.filename : null, req.file?.mimetype || null, consent]
    );
    const incident = await get('SELECT * FROM incidents WHERE id = ?', [result.id]);
    await run('INSERT INTO audit_logs (actor_id, action, details) VALUES (?, ?, ?)', [req.session.userId, 'incident_created', JSON.stringify({ incidentId: result.id, title })]);
    const admins = await all('SELECT id FROM users WHERE role = "admin"');
    for (const admin of admins) {
      await run('INSERT INTO alerts (user_id, title, severity, status) VALUES (?, ?, ?, ?)', [admin.id, `New incident: ${title}`, severity, 'Open']);
    }
    void deliverIncidentAlerts(incident).catch(error => console.error('Incident alert processing failed:', error));
    res.status(201).json({ incident });
  } catch (error) {
    handleError(res, error);
  }
});

app.get('/api/incidents/:id/evidence', requireAuth, async (req, res) => {
  try {
    const incident = await get('SELECT id, user_id, volunteer_id, evidence_filename, evidence_mime FROM incidents WHERE id = ?', [Number(req.params.id)]);
    if (!incident || !incident.evidence_filename) return res.status(404).json({ error: 'Evidence not found.' });
    const viewer = await get('SELECT role FROM users WHERE id = ?', [req.session.userId]);
    if (viewer.role !== 'admin' && Number(incident.user_id) !== Number(req.session.userId) && Number(incident.volunteer_id) !== Number(req.session.userId)) {
      return res.status(403).json({ error: 'You are not authorized to view this evidence.' });
    }
    const filePath = path.join(uploadDir, path.basename(incident.evidence_filename));
    res.type(incident.evidence_mime || 'application/octet-stream');
    res.sendFile(filePath, { headers: { 'Cache-Control': 'private, max-age=300', 'X-Content-Type-Options': 'nosniff' } }, error => {
      if (error && !res.headersSent) res.status(error.statusCode || 404).json({ error: 'Evidence file is unavailable.' });
    });
  } catch (error) {
    handleError(res, error);
  }
});

app.patch('/api/admin/volunteers/:id/status', requireAuth, requireRole(['admin']), async (req, res) => {
  try {
    const status = String(req.body.status || '');
    if (!['active', 'suspended'].includes(status)) return res.status(400).json({ error: 'Volunteer status is invalid.' });
    const result = await run('UPDATE users SET status = ? WHERE id = ? AND role = "volunteer"', [status, Number(req.params.id)]);
    if (!result.changes) return res.status(404).json({ error: 'Volunteer not found.' });
    const volunteer = await get('SELECT id, name, email, status FROM users WHERE id = ?', [Number(req.params.id)]);
    res.json({ volunteer });
  } catch (error) {
    handleError(res, error);
  }
});

app.patch('/api/incidents/:id/status', requireAuth, async (req, res) => {
  try {
    const incidentId = Number(req.params.id);
    const nextStatus = String(req.body.status || '').trim();
    const validStatuses = ['New', 'Assigned', 'In Progress', 'Awaiting Info', 'Resolved', 'Closed'];
    if (!validStatuses.includes(nextStatus)) {
      return res.status(400).json({ error: 'Status is invalid.' });
    }

    const incident = await get('SELECT * FROM incidents WHERE id = ?', [incidentId]);
    if (!incident) return res.status(404).json({ error: 'Incident not found.' });

    const user = await get('SELECT role FROM users WHERE id = ?', [req.session.userId]);
    const canManage = user && user.role === 'admin';
    const isAssignedVolunteer = Number(req.session.userId) === Number(incident.volunteer_id);
    const isReportingUser = Number(req.session.userId) === Number(incident.user_id);
    if (!canManage && !isAssignedVolunteer && !isReportingUser) {
      return res.status(403).json({ error: 'You do not have permission to update this incident.' });
    }

    await run('UPDATE incidents SET status = ? WHERE id = ?', [nextStatus, incidentId]);
    const updatedIncident = await get('SELECT * FROM incidents WHERE id = ?', [incidentId]);
    await run('INSERT INTO audit_logs (actor_id, action, details) VALUES (?, ?, ?)', [req.session.userId, 'incident_status_updated', JSON.stringify({ incidentId, status: nextStatus })]);
    res.json({ incident: updatedIncident });
  } catch (error) {
    handleError(res, error);
  }
});

app.post('/api/incidents/:id/assign', requireAuth, requireRole(['admin']), async (req, res) => {
  try {
    const volunteerId = Number(req.body.volunteerId);
    const incidentId = Number(req.params.id);
    if (!volunteerId) return res.status(400).json({ error: 'Volunteer selection is required.' });
    const volunteer = await get('SELECT id, role FROM users WHERE id = ? AND role = ? AND status = "active"', [volunteerId, 'volunteer']);
    if (!volunteer) return res.status(404).json({ error: 'Active volunteer not found.' });
    const existingIncident = await get('SELECT id, consent FROM incidents WHERE id = ?', [incidentId]);
    if (!existingIncident) return res.status(404).json({ error: 'Incident not found.' });
    if (!existingIncident.consent) return res.status(403).json({ error: 'The reporter has not consented to share this incident with a volunteer.' });
    await run('UPDATE incidents SET volunteer_id = ?, status = ? WHERE id = ?', [volunteerId, 'Assigned', incidentId]);
    const incident = await get('SELECT * FROM incidents WHERE id = ?', [incidentId]);
    await run('INSERT INTO messages (incident_id, sender_id, receiver_id, body) VALUES (?, ?, ?, ?)', [incidentId, req.session.userId, volunteerId, 'AegisNet assigned this incident to your care.']);
    res.json({ incident });
  } catch (error) {
    handleError(res, error);
  }
});

app.post('/api/incidents/:id/claim', requireAuth, requireRole(['volunteer']), async (req, res) => {
  try {
    const incidentId = Number(req.params.id);
    const result = await run(
      'UPDATE incidents SET volunteer_id = ?, status = ? WHERE id = ? AND volunteer_id IS NULL AND consent = 1 AND status IN ("New", "Awaiting Volunteer")',
      [req.session.userId, 'Assigned', incidentId]
    );
    if (!result.changes) return res.status(409).json({ error: 'This incident is no longer available to claim.' });
    await run('INSERT INTO messages (incident_id, sender_id, receiver_id, body) VALUES (?, ?, ?, ?)', [incidentId, req.session.userId, null, 'A volunteer accepted this incident and will follow up.']);
    const incident = await get('SELECT * FROM incidents WHERE id = ?', [incidentId]);
    res.json({ incident });
  } catch (error) {
    handleError(res, error);
  }
});

app.get('/api/chat/:incidentId', requireAuth, async (req, res) => {
  try {
    const incidentId = Number(req.params.incidentId);
    const user = await get('SELECT role FROM users WHERE id = ?', [req.session.userId]);
    const incident = await get('SELECT * FROM incidents WHERE id = ?', [incidentId]);
    if (!incident) return res.status(404).json({ error: 'Incident not found.' });
    if (user.role !== 'admin' && incident.user_id !== req.session.userId && incident.volunteer_id !== req.session.userId) {
      return res.status(403).json({ error: 'You do not have access to this conversation.' });
    }
    const messages = await all('SELECT m.*, u.name AS sender_name FROM messages m JOIN users u ON u.id = m.sender_id WHERE m.incident_id = ? ORDER BY m.created_at ASC', [incidentId]);
    res.json({ messages });
  } catch (error) {
    handleError(res, error);
  }
});

app.post('/api/chat/:incidentId', requireAuth, async (req, res) => {
  try {
    const incidentId = Number(req.params.incidentId);
    const incident = await get('SELECT * FROM incidents WHERE id = ?', [incidentId]);
    if (!incident) return res.status(404).json({ error: 'Incident not found.' });
    if (req.session.userId !== incident.user_id && req.session.userId !== incident.volunteer_id) {
      const user = await get('SELECT role FROM users WHERE id = ?', [req.session.userId]);
      if (user.role !== 'admin') return res.status(403).json({ error: 'You are not part of this conversation.' });
    }
    const body = String(req.body.body || '').trim();
    if (!body) return res.status(400).json({ error: 'Message text is required.' });
    const receiverId = req.session.userId === incident.user_id ? incident.volunteer_id : incident.user_id;
    const result = await run('INSERT INTO messages (incident_id, sender_id, receiver_id, body) VALUES (?, ?, ?, ?)', [incidentId, req.session.userId, receiverId, body]);
    const message = await get('SELECT * FROM messages WHERE id = ?', [result.id]);
    res.status(201).json({ message });
  } catch (error) {
    handleError(res, error);
  }
});

app.get('/api/volunteers', requireAuth, async (req, res) => {
  try {
    const volunteers = await all('SELECT id, name, email, phone, role, status, bio, availability, skills, location FROM users WHERE role = "volunteer" ORDER BY created_at DESC', []);
    res.json({ volunteers });
  } catch (error) {
    handleError(res, error);
  }
});

app.get('/api/volunteers/matches/:incidentId', requireAuth, async (req, res) => {
  try {
    const incidentId = Number(req.params.incidentId);
    const viewer = await get('SELECT role FROM users WHERE id = ?', [req.session.userId]);
    const incident = await get('SELECT * FROM incidents WHERE id = ?', [incidentId]);
    if (!incident) return res.status(404).json({ error: 'Incident not found.' });
    if (viewer.role !== 'admin' && incident.user_id !== req.session.userId && incident.volunteer_id !== req.session.userId) {
      return res.status(403).json({ error: 'You do not have access to volunteer matching.' });
    }

    const volunteers = await all('SELECT id, name, email, phone, role, status, bio, availability, skills, location FROM users WHERE role = "volunteer" ORDER BY created_at DESC', []);
    const matches = volunteers
      .map(volunteer => {
        const match = scoreVolunteerMatch(volunteer, incident);
        return { ...volunteer, match_score: match.score, match_reasons: match.reasons };
      })
      .filter(volunteer => volunteer.match_score >= 20)
      .sort((a, b) => b.match_score - a.match_score)
      .slice(0, 5);

    res.json({ incident, matches });
  } catch (error) {
    handleError(res, error);
  }
});

app.use('/api', (_req, res) => res.status(404).json({ error: 'API route not found.' }));
app.use(express.static(frontendDistDir, { index: false }));
app.get('*', (_req, res, next) => {
  res.sendFile(path.join(frontendDistDir, 'index.html'), error => {
    if (error) next(error);
  });
});

function startServer(port = DEFAULT_PORT) {
  const server = app.listen(port, HOST, () => {
    console.log(`AegisNet server running on ${HOST}:${port}`);
  });

  server.on('error', error => {
    if (error.code === 'EADDRINUSE') {
      const fallbackPort = port === DEFAULT_PORT ? 4001 : port + 1;
      console.warn(`Port ${port} is already in use; switching to a free fallback port (${fallbackPort}).`);
      startServer(fallbackPort);
      return;
    }
    throw error;
  });
}

init().then(() => {
  const port = Number(process.env.PORT || 4000);
  startServer(port);
}).catch(err => {
  console.error('Database initialization failed:', err);
  process.exit(1);
});
