const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const dataDir = path.resolve(process.env.AEGIS_DATA_DIR || path.join(__dirname, 'data'));
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
const db = new sqlite3.Database(path.join(dataDir, 'aegisnet.sqlite'));

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve({ id: this.lastID, changes: this.changes });
    });
  });
}
function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => err ? reject(err) : resolve(row));
  });
}
function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows));
  });
}
async function tableExists(name) {
  const row = await get("SELECT name FROM sqlite_master WHERE type='table' AND name = ?", [name]);
  return Boolean(row);
}
async function addColumnIfMissing(table, column, definition) {
  const info = await all(`PRAGMA table_info(${table})`);
  if (!info.some(row => row.name === column)) {
    await run(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}
async function init() {
  await run(`CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  await run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user',
    phone TEXT,
    avatar_url TEXT,
    bio TEXT,
    availability TEXT,
    skills TEXT,
    location TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  await run(`CREATE TABLE IF NOT EXISTS incidents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    volunteer_id INTEGER,
    title TEXT NOT NULL,
    category TEXT NOT NULL,
    description TEXT NOT NULL,
    severity TEXT NOT NULL DEFAULT 'Medium',
    status TEXT NOT NULL DEFAULT 'New',
    location_text TEXT,
    latitude REAL,
    longitude REAL,
    evidence_summary TEXT,
    consent INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id),
    FOREIGN KEY(volunteer_id) REFERENCES users(id)
  )`);
  await run(`CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    incident_id INTEGER NOT NULL,
    sender_id INTEGER NOT NULL,
    receiver_id INTEGER,
    body TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(incident_id) REFERENCES incidents(id),
    FOREIGN KEY(sender_id) REFERENCES users(id),
    FOREIGN KEY(receiver_id) REFERENCES users(id)
  )`);
  await run(`CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    actor_id INTEGER,
    action TEXT NOT NULL,
    details TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(actor_id) REFERENCES users(id)
  )`);

  await addColumnIfMissing('users', 'role', 'TEXT NOT NULL DEFAULT "user"');
  await addColumnIfMissing('users', 'phone', 'TEXT');
  await addColumnIfMissing('users', 'avatar_url', 'TEXT');
  await addColumnIfMissing('users', 'bio', 'TEXT');
  await addColumnIfMissing('users', 'availability', 'TEXT');
  await addColumnIfMissing('users', 'skills', 'TEXT');
  await addColumnIfMissing('users', 'location', 'TEXT');
  await addColumnIfMissing('users', 'status', 'TEXT NOT NULL DEFAULT "active"');
  await addColumnIfMissing('incidents', 'evidence_summary', 'TEXT');
  await addColumnIfMissing('incidents', 'evidence_filename', 'TEXT');
  await addColumnIfMissing('incidents', 'evidence_mime', 'TEXT');
  await addColumnIfMissing('incidents', 'latitude', 'REAL');
  await addColumnIfMissing('incidents', 'longitude', 'REAL');

  if (!(await tableExists('alerts'))) {
    await run(`CREATE TABLE IF NOT EXISTS alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      severity TEXT NOT NULL DEFAULT 'Medium',
      status TEXT NOT NULL DEFAULT 'Open',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(user_id) REFERENCES users(id)
    )`);
  }
  await run(`CREATE TABLE IF NOT EXISTS alert_deliveries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    incident_id INTEGER NOT NULL,
    provider TEXT NOT NULL,
    status TEXT NOT NULL,
    details TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(incident_id) REFERENCES incidents(id)
  )`);
  if (!(await tableExists('scans'))) {
    await run(`CREATE TABLE IF NOT EXISTS scans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      status TEXT NOT NULL,
      score INTEGER NOT NULL,
      findings INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(user_id) REFERENCES users(id)
    )`);
  }
  if (!(await tableExists('threat_events'))) {
    await run(`CREATE TABLE IF NOT EXISTS threat_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_code TEXT NOT NULL,
      event_type TEXT NOT NULL,
      source_ip TEXT NOT NULL,
      destination TEXT NOT NULL,
      severity TEXT NOT NULL,
      status TEXT NOT NULL,
      description TEXT NOT NULL,
      created_at TEXT NOT NULL
    )`);
    await run('CREATE INDEX IF NOT EXISTS idx_threat_events_severity ON threat_events(severity)');
    await run('CREATE INDEX IF NOT EXISTS idx_threat_events_type ON threat_events(event_type)');
    const count = await get('SELECT COUNT(*) AS count FROM threat_events');
    if (count.count < 15500) {
      await run('BEGIN TRANSACTION');
      const types = ['Suspicious Login', 'Malware Signature', 'Port Scan Pattern', 'Unusual Data Transfer', 'Policy Violation', 'Failed Authentication', 'Phishing Indicator', 'Firewall Rule Match', 'DNS Anomaly', 'Endpoint Warning'];
      const severities = ['Low', 'Medium', 'High', 'Critical'];
      const statuses = ['Open', 'Investigating', 'Resolved'];
      const destinations = ['Gateway-01', 'Workstation-02', 'Database-01', 'Endpoint-04', 'Cloud-Service-01', 'Mail-Server-01'];
      const insert = db.prepare('INSERT INTO threat_events (event_code,event_type,source_ip,destination,severity,status,description,created_at) VALUES (?,?,?,?,?,?,?,?)');
      for (let i = count.count; i < 15500; i++) {
        const type = types[i % types.length];
        const sev = severities[(i * 7 + Math.floor(i / 13)) % severities.length];
        const status = statuses[(i * 3) % statuses.length];
        const ip = `10.${(i % 240) + 1}.${(Math.floor(i / 240) % 250) + 1}.${(i % 253) + 1}`;
        const date = new Date(Date.UTC(2025, 0, 1) + i * 60000).toISOString();
        insert.run([`EVT-${String(i + 1).padStart(6, '0')}`, type, ip, destinations[i % destinations.length], sev, status, `Synthetic training/demo event: ${type.toLowerCase()} detected for review.`, date]);
      }
      await new Promise((resolve, reject) => insert.finalize(err => err ? reject(err) : resolve()));
      await run('COMMIT');
    }
  }

  const existingSeed = await get('SELECT value FROM settings WHERE key = ?', ['seed_demo_data']);
  if (!existingSeed) {
    await run('INSERT INTO settings (key, value) VALUES (?, ?)', ['seed_demo_data', 'true']);
  }
}

module.exports = { db, run, get, all, init };