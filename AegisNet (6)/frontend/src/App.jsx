import { useEffect, useState } from 'react';
import { CircleMarker, MapContainer, TileLayer, useMap, useMapEvents } from 'react-leaflet';
import {
  Activity,
  AlertTriangle,
  Bell,
  CheckCircle2,
  Clock3,
  FileText,
  ImagePlus,
  LayoutDashboard,
  LogOut,
  MapPin,
  Navigation,
  Shield,
  ShieldCheck,
  Sparkles,
  UserRound,
  Users,
  Zap
} from 'lucide-react';

const API_BASES = import.meta.env.PROD
  ? ['/api']
  : [
      import.meta.env.VITE_API_URL || 'http://localhost:4000/api',
      'http://localhost:4001/api',
      'http://localhost:4002/api',
      'http://localhost:4003/api'
    ];

async function request(path, options = {}) {
  let lastError = null;

  for (const baseUrl of API_BASES) {
    let response;
    try {
      response = await fetch(`${baseUrl}${path}`, {
        credentials: 'include',
        ...options,
        headers: {
          ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
          ...(options.headers || {})
        }
      });
    } catch (error) {
      lastError = error;
      continue;
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Request failed');
    return data;
  }
  throw lastError || new Error('Request failed');
}

async function fetchEvidence(incidentId, signal) {
    let lastError;
    for (const baseUrl of API_BASES) {
      try {
        const response = await fetch(`${baseUrl}/incidents/${incidentId}/evidence`, { credentials: 'include', signal });
        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          throw new Error(data.error || 'Could not load evidence.');
        }
        return URL.createObjectURL(await response.blob());
      } catch (error) {
        if (signal.aborted) throw error;
        if (error.name !== 'TypeError') throw error;
        lastError = error;
      }
    }
    throw lastError || new Error('Could not load evidence.');
  }

function MapClickPicker({ onSelect }) {
    useMapEvents({
      click(event) {
        onSelect(event.latlng.lat, event.latlng.lng);
      }
    });
    return null;
  }

function MapCenterUpdater({ latitude, longitude }) {
    const map = useMap();
    useEffect(() => {
      if (latitude != null && longitude != null) map.flyTo([latitude, longitude], Math.max(map.getZoom(), 13));
    }, [map, latitude, longitude]);
    return null;
  }

function IncidentMapPicker({ latitude, longitude, onSelect }) {
    const hasCoordinates = latitude !== '' && longitude !== '';
    const center = hasCoordinates ? [Number(latitude), Number(longitude)] : [20, 0];
    return (
      <div className="report-map-wrap">
        <p className="map-instructions">Select the incident location on the map, or use your current location. Location sharing is optional.</p>
        <MapContainer center={center} zoom={hasCoordinates ? 13 : 2} scrollWheelZoom className="report-map">
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <MapClickPicker onSelect={onSelect} />
          <MapCenterUpdater latitude={hasCoordinates ? Number(latitude) : null} longitude={hasCoordinates ? Number(longitude) : null} />
          {hasCoordinates && <CircleMarker center={center} radius={9} pathOptions={{ color: '#f1d77a', fillColor: '#d4af37', fillOpacity: 0.9 }} />}
        </MapContainer>
        {hasCoordinates && <span className="coordinate-readout">{Number(latitude).toFixed(5)}, {Number(longitude).toFixed(5)}</span>}
      </div>
    );
  }

function EvidenceMedia({ incident }) {
    const [mediaUrl, setMediaUrl] = useState('');
    const [error, setError] = useState('');
    useEffect(() => {
      if (!incident.evidence_filename) return undefined;
      const controller = new AbortController();
      let objectUrl = '';
      fetchEvidence(incident.id, controller.signal)
        .then(url => {
          objectUrl = url;
          setMediaUrl(url);
          setError('');
        })
        .catch(loadError => {
          if (!controller.signal.aborted) setError(loadError.message);
        });
      return () => {
        controller.abort();
        if (objectUrl) URL.revokeObjectURL(objectUrl);
      };
    }, [incident.id, incident.evidence_filename]);
    if (error) return <span className="muted-inline">{error}</span>;
    if (!mediaUrl) return <span className="muted-inline">Loading evidence…</span>;
    if ((incident.evidence_mime || '').startsWith('video/')) {
      return <video className="evidence-preview" src={mediaUrl} controls preload="metadata">Video playback is unavailable in this browser.</video>;
    }
    return <a className="evidence-image-link" href={mediaUrl} target="_blank" rel="noreferrer"><img className="evidence-preview" src={mediaUrl} alt={`Evidence for ${incident.title}`} /></a>;
  }

function LandingPage({ adminRequired, onAuth, onInitializeAdmin }) {
  const [mode, setMode] = useState('login');
  const [role, setRole] = useState('user');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const endpoint = mode === 'login' ? '/auth/login' : '/auth/register';
      const payload = mode === 'login' ? { email, password } : { name, email, password, role };
      const result = await request(endpoint, { method: 'POST', body: JSON.stringify(payload) });
      onAuth(result.user);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="landing-shell">
      <header className="landing-header">
        <div className="brand-block">
          <div className="brand-mark"><ShieldCheck size={18} /></div>
          <div>
            <strong>AegisNet</strong>
            <small>Protective Network</small>
          </div>
        </div>
        <nav>
          <a href="#features">Features</a>
          <a href="#how-it-works">How it works</a>
          <button className="text-button" onClick={() => setMode('login')}>Sign in</button>
        </nav>
      </header>

      <main className="landing-content">
        <section className="hero">
          <div className="hero-copy">
            <p className="kicker">COMMUNITY SAFETY COORDINATION</p>
            <h1>When every minute matters, AegisNet keeps help connected.</h1>
            <p className="subtext">Report incidents quickly, coordinate trusted volunteers, and keep your community safer through verified information and clear follow-up.</p>
            <div className="hero-actions">
              <button className="primary-btn" onClick={() => setMode('register')}>Create account</button>
              <button className="secondary-btn" onClick={() => setMode('login')}>Member sign in</button>
            </div>
            {adminRequired && (
              <button className="link-btn" onClick={onInitializeAdmin}>Initialize owner admin</button>
            )}
          </div>

          <div className="auth-panel">
            <div className="auth-tabs">
              <button className={mode === 'login' ? 'active' : ''} onClick={() => setMode('login')}>Login</button>
              <button className={mode === 'register' ? 'active' : ''} onClick={() => setMode('register')}>Register</button>
            </div>

            <form onSubmit={submit} className="auth-form">
              {mode === 'register' && (
                <label>
                  Full name
                  <input value={name} onChange={e => setName(e.target.value)} placeholder="Your name" required />
                </label>
              )}
              <label>
                Email address
                <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" required />
              </label>
              <label>
                Password
                <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="At least 8 characters" minLength={8} required />
              </label>
              {mode === 'register' && (
                <div className="role-picker">
                  <button type="button" className={role === 'user' ? 'selected' : ''} onClick={() => setRole('user')}>User</button>
                  <button type="button" className={role === 'volunteer' ? 'selected' : ''} onClick={() => setRole('volunteer')}>Volunteer</button>
                </div>
              )}
              {error && <div className="error-box">{error}</div>}
              <button className="primary-btn full" disabled={busy}>
                {busy ? 'Please wait...' : mode === 'login' ? 'Sign in' : 'Create account'}
              </button>
            </form>
          </div>
        </section>

        <section id="features" className="feature-grid">
          <FeatureCard icon={Shield} title="Emergency response" description="User-first reporting with clear, trusted coordination and permissions." />
          <FeatureCard icon={Users} title="Verified volunteers" description="Assign volunteers by skills, location, and availability with accountable follow-up." />
          <FeatureCard icon={Sparkles} title="AI assistant" description="Get guided support for reporting, triage, and next steps without unsafe automation." />
        </section>

        <section id="how-it-works" className="info-section">
          <div className="section-header">
            <p className="kicker">HOW IT WORKS</p>
            <h2>Simple, transparent coordination for safer communities.</h2>
          </div>
          <div className="steps">
            <Step step="01" title="Report" text="Share the incident, severity, and any evidence you consent to provide." />
            <Step step="02" title="Coordinate" text="Verified volunteers and the admin review and assign the best response." />
            <Step step="03" title="Resolve" text="Track updates, chat privately, and close the case with a clear summary." />
          </div>
        </section>
      </main>
    </div>
  );
}

function AdminSetup({ onCreated, onCancel }) {
  const [name, setName] = useState('Owner Admin');
  const [email, setEmail] = useState('admin@aegisnet.local');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const result = await request('/admin/initialize', {
        method: 'POST',
        body: JSON.stringify({ name, email, password })
      });
      onCreated(result.user);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="setup-shell">
      <div className="setup-card">
        <p className="kicker">OWNER ADMIN SETUP</p>
        <h1>Initialize the single administrator account</h1>
        <p className="subtext">This creates the only authorized Owner Admin. Public registration remains limited to users and volunteers.</p>
        <form onSubmit={submit} className="auth-form">
          <label>Full name<input value={name} onChange={e => setName(e.target.value)} required /></label>
          <label>Email<input type="email" value={email} onChange={e => setEmail(e.target.value)} required /></label>
          <label>Password<input type="password" value={password} onChange={e => setPassword(e.target.value)} minLength={8} required /></label>
          {error && <div className="error-box">{error}</div>}
          <div className="inline-actions">
            <button className="primary-btn" type="submit" disabled={busy}>{busy ? 'Creating...' : 'Create admin'}</button>
            <button className="secondary-btn" type="button" onClick={onCancel}>Back</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function App() {
  const [user, setUser] = useState(null);
  const [adminRequired, setAdminRequired] = useState(false);
  const [checking, setChecking] = useState(true);
  const [dashboard, setDashboard] = useState({ role: 'user', metrics: {}, incidents: [], volunteers: [], offers: [] });
  const [notice, setNotice] = useState('');
  const [incidentForm, setIncidentForm] = useState({
    title: '',
    category: 'Personal safety concern',
    description: '',
    severity: 'Medium',
    locationText: '',
    latitude: '',
    longitude: '',
    evidenceSummary: '',
    consent: true
  });
  const [chatMessages, setChatMessages] = useState([]);
  const [selectedIncidentId, setSelectedIncidentId] = useState(null);
  const [chatDraft, setChatDraft] = useState('');
  const [matchMap, setMatchMap] = useState({});
  const [incidentEvidence, setIncidentEvidence] = useState(null);
  const [capturingLocation, setCapturingLocation] = useState(false);

  function flashNotice(message) {
    setNotice(message);
    window.clearTimeout(flashNotice.timeoutId);
    flashNotice.timeoutId = setTimeout(() => setNotice(''), 3500);
  }

  async function loadDashboard() {
    try {
      const result = await request('/dashboard');
      setDashboard(result);
    } catch (error) {
      flashNotice(error.message);
    }
  }

  async function bootstrap() {
    try {
      const status = await request('/admin/status');
      setAdminRequired(!status.initialized);
      const me = await request('/auth/me').catch(() => null);
      if (me && me.user) {
        setUser(me.user);
        await loadDashboard();
      }
    } catch (error) {
      console.error(error);
    } finally {
      setChecking(false);
    }
  }

  useEffect(() => { bootstrap(); }, []);

  async function handleAuth(userData) {
    setUser(userData);
    setAdminRequired(false);
    await loadDashboard();
  }

  async function handleLogout() {
    try {
      await request('/auth/logout', { method: 'POST', body: JSON.stringify({}) });
    } catch (error) {
      console.error(error);
    }
    setUser(null);
    setDashboard({ role: 'user', metrics: {}, incidents: [], volunteers: [], offers: [] });
  }

  async function saveProfile(e) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const payload = {
      name: form.get('name'),
      email: form.get('email'),
      phone: form.get('phone') || '',
      bio: form.get('bio') || '',
      availability: form.get('availability') || '',
      skills: form.get('skills') || '',
      location: form.get('location') || ''
    };
    try {
      const result = await request('/profile', { method: 'PUT', body: JSON.stringify(payload) });
      setUser(result.user);
      flashNotice('Profile updated successfully.');
    } catch (error) {
      flashNotice(error.message);
    }
  }

  async function updateIncidentStatus(incidentId, status) {
    try {
      await request(`/incidents/${incidentId}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status })
      });
      flashNotice('Incident status updated.');
      await loadDashboard();
    } catch (error) {
      flashNotice(error.message);
    }
  }

  async function createIncident(e) {
    e.preventDefault();
    if (incidentEvidence && incidentEvidence.size > 25 * 1024 * 1024) {
      flashNotice('Evidence files must be 25 MB or smaller.');
      return;
    }
    try {
      const payload = new FormData();
      Object.entries({
        ...incidentForm,
        consent: incidentForm.consent ? 1 : 0
      }).forEach(([key, value]) => payload.append(key, String(value)));
      if (incidentEvidence) payload.append('evidence', incidentEvidence);
      await request('/incidents', { method: 'POST', body: payload });
      setIncidentForm({
        title: '',
        category: 'Personal safety concern',
        description: '',
        severity: 'Medium',
        locationText: '',
        latitude: '',
        longitude: '',
        evidenceSummary: '',
        consent: true
      });
      setIncidentEvidence(null);
      flashNotice('Incident submitted to the community response queue.');
      loadDashboard();
    } catch (error) {
      flashNotice(error.message);
    }
  }

  function captureLocation() {
    if (!navigator.geolocation) {
      flashNotice('Location sharing is not supported by this browser.');
      return;
    }
    setCapturingLocation(true);
    navigator.geolocation.getCurrentPosition(
      position => {
        setIncidentForm(current => ({
          ...current,
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          locationText: current.locationText || 'Current location'
        }));
        flashNotice('Location added. It will only be shared with the incident response team.');
        setCapturingLocation(false);
      },
      error => {
        flashNotice(error.code === error.PERMISSION_DENIED ? 'Location permission was not granted.' : 'Could not retrieve your location.');
        setCapturingLocation(false);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    );
  }

  async function loadVolunteerMatches(incidentId) {
    try {
      const result = await request(`/volunteers/matches/${incidentId}`);
      setMatchMap(prev => ({ ...prev, [incidentId]: result.matches || [] }));
    } catch (error) {
      flashNotice(error.message);
    }
  }

  async function openChat(incidentId) {
    try {
      setSelectedIncidentId(incidentId);
      const result = await request(`/chat/${incidentId}`);
      setChatMessages(result.messages || []);
    } catch (error) {
      flashNotice(error.message);
    }
  }

  async function sendChatMessage() {
    if (!chatDraft.trim() || !selectedIncidentId) return;
    try {
      await request(`/chat/${selectedIncidentId}`, {
        method: 'POST',
        body: JSON.stringify({ body: chatDraft })
      });
      setChatDraft('');
      openChat(selectedIncidentId);
    } catch (error) {
      flashNotice(error.message);
    }
  }

  async function assignVolunteer(incidentId, volunteerId) {
    try {
      await request(`/incidents/${incidentId}/assign`, {
        method: 'POST',
        body: JSON.stringify({ volunteerId })
      });
      flashNotice('Volunteer assigned successfully.');
      loadDashboard();
    } catch (error) {
      flashNotice(error.message);
    }
  }

  async function claimIncident(incidentId) {
    try {
      await request(`/incidents/${incidentId}/claim`, { method: 'POST', body: JSON.stringify({}) });
      flashNotice('Incident accepted. You can now coordinate in chat.');
      await loadDashboard();
    } catch (error) {
      flashNotice(error.message);
    }
  }

  async function updateVolunteerStatus(volunteerId, status) {
    try {
      await request(`/admin/volunteers/${volunteerId}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status })
      });
      flashNotice(`Volunteer ${status === 'active' ? 'activated' : 'suspended'}.`);
      await loadDashboard();
    } catch (error) {
      flashNotice(error.message);
    }
  }

  if (checking) return <div className="loading-screen"><ShieldCheck size={28} /> Loading AegisNet...</div>;
  if (!user) {
    return adminRequired
      ? <AdminSetup onCreated={userData => handleAuth(userData)} onCancel={() => setAdminRequired(false)} />
      : <LandingPage adminRequired={adminRequired} onAuth={handleAuth} onInitializeAdmin={() => setAdminRequired(true)} />;
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-block sidebar-brand">
          <div className="brand-mark"><ShieldCheck size={18} /></div>
          <div>
            <strong>AegisNet</strong>
            <small>PROTECTIVE NETWORK</small>
          </div>
        </div>

        <nav className="nav-list">
          <button className="nav-button selected"><LayoutDashboard size={17} /> Dashboard</button>
          <button className="nav-button"><Bell size={17} /> Alerts</button>
          <button className="nav-button"><FileText size={17} /> Reports</button>
        </nav>

        <div className="user-card">
          <div className="avatar-badge">{(user.name || 'A').charAt(0).toUpperCase()}</div>
          <div>
            <strong>{user.name}</strong>
            <span>{user.role}</span>
          </div>
        </div>

        <button className="nav-button logout" onClick={handleLogout}><LogOut size={17} /> Sign out</button>
      </aside>

      <main className="workspace-panel">
        <header className="workspace-header">
          <div>
            <p className="kicker">Safety command center</p>
            <h1>{user.role === 'admin' ? 'Owner Admin Control Center' : user.role === 'volunteer' ? 'Volunteer Portal' : 'User Dashboard'}</h1>
          </div>
          <div className="status-pill"><span /> Live</div>
        </header>

        {notice && <div className="toast"><CheckCircle2 size={16} /> {notice}</div>}

        {user.role === 'user' && (
          <>
            <div className="stat-grid">
              <StatCard icon={Shield} label="Reports" value={dashboard.metrics.incidentCount || 0} sub="Saved in database" />
              <StatCard icon={Activity} label="Status" value={dashboard.metrics.currentStatus || 'No active report'} sub="Latest incident" />
              <StatCard icon={MapPin} label="Safety" value="Enabled" sub="Location sharing ready" />
              <StatCard icon={Bell} label="Alerts" value={dashboard.incidents?.length || 0} sub="Active and resolved" />
            </div>

            <div className="content-grid">
              <section className="panel">
                <div className="panel-header"><h2>New incident</h2><span className="chip">Trusted workflow</span></div>
                <form className="stack-form" onSubmit={createIncident}>
                  <div className="form-row inline">
                    <input placeholder="Incident title" value={incidentForm.title} onChange={e => setIncidentForm({ ...incidentForm, title: e.target.value })} required />
                    <select value={incidentForm.category} onChange={e => setIncidentForm({ ...incidentForm, category: e.target.value })}>
                      <option>Personal safety concern</option>
                      <option>Medical assistance request</option>
                      <option>Road accident</option>
                      <option>Fire or environmental hazard</option>
                      <option>Flooding</option>
                      <option>Missing-person concern</option>
                      <option>Unsafe public area</option>
                      <option>Broken streetlight</option>
                      <option>Blocked road</option>
                      <option>Animal-related emergency</option>
                      <option>Infrastructure damage</option>
                      <option>Suspicious or dangerous situation</option>
                      <option>Other community concern</option>
                    </select>
                  </div>
                  <textarea placeholder="Describe what happened, what help you need, and any relevant details." value={incidentForm.description} onChange={e => setIncidentForm({ ...incidentForm, description: e.target.value })} required />
                  <div className="form-row inline">
                    <select value={incidentForm.severity} onChange={e => setIncidentForm({ ...incidentForm, severity: e.target.value })}>
                      <option>Critical</option>
                      <option>Medium</option>
                      <option>Low</option>
                    </select>
                    <div className="location-entry">
                      <input placeholder="Location or landmark" value={incidentForm.locationText} onChange={e => setIncidentForm({ ...incidentForm, locationText: e.target.value })} />
                      <button type="button" className="small-btn" onClick={captureLocation} disabled={capturingLocation}>
                        <Navigation size={15} /> {capturingLocation ? 'Locating...' : incidentForm.latitude ? 'Location added' : 'Use my location'}
                      </button>
                    </div>
                  </div>
                  <IncidentMapPicker
                    latitude={incidentForm.latitude}
                    longitude={incidentForm.longitude}
                    onSelect={(latitude, longitude) => setIncidentForm(current => ({
                      ...current,
                      latitude,
                      longitude,
                      locationText: current.locationText || 'Selected map location'
                    }))}
                  />
                  <textarea placeholder="Evidence summary or screenshots/notes you want to share." value={incidentForm.evidenceSummary} onChange={e => setIncidentForm({ ...incidentForm, evidenceSummary: e.target.value })} />
                  <label className="upload-control">
                    <ImagePlus size={17} /> Add a photo or video (JPEG, PNG, WebP, MP4, WebM · up to 25 MB)
                    <input type="file" accept="image/jpeg,image/png,image/webp,video/mp4,video/webm" onChange={e => setIncidentEvidence(e.target.files?.[0] || null)} />
                    {incidentEvidence && <span className="upload-name">{incidentEvidence.name} · {(incidentEvidence.size / (1024 * 1024)).toFixed(1)} MB</span>}
                  </label>
                  <label className="check-row"><input type="checkbox" checked={incidentForm.consent} onChange={e => setIncidentForm({ ...incidentForm, consent: e.target.checked })} /> I consent to share relevant location and incident details with the assigned volunteer.</label>
                  <button className="primary-btn" type="submit">Submit incident</button>
                </form>
              </section>

              <section className="panel">
                <div className="panel-header"><h2>Profile</h2><span className="chip">Secure</span></div>
                <form className="stack-form tiny" onSubmit={saveProfile}>
                  <input name="name" defaultValue={user.name} />
                  <input name="email" type="email" defaultValue={user.email} />
                  <input name="phone" placeholder="Phone number" defaultValue={user.phone || ''} />
                  <input name="location" placeholder="Service area or neighborhood" defaultValue={user.location || ''} />
                  <input name="availability" placeholder="Availability (evenings, weekends, etc.)" defaultValue={user.availability || ''} />
                  <textarea name="bio" placeholder="Tell volunteers about your needs or accessibility requirements." defaultValue={user.bio || ''} />
                  <textarea name="skills" placeholder="Skills, support expertise, or check-in preferences." defaultValue={user.skills || ''} />
                  <button className="primary-btn" type="submit">Save profile</button>
                </form>
              </section>
            </div>

            <section className="panel">
              <div className="panel-header"><h2>Incident history</h2><span className="chip">{dashboard.incidents.length} records</span></div>
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Title</th><th>Category</th><th>Severity</th><th>Status</th><th>Location</th><th>Evidence</th><th>Action</th></tr></thead>
                  <tbody>
                    {dashboard.incidents.length ? dashboard.incidents.map(incident => (
                      <tr key={incident.id}>
                        <td>{incident.title}</td>
                        <td>{incident.category}</td>
                        <td><span className={`badge ${incident.severity.toLowerCase()}`}>{incident.severity}</span></td>
                        <td>
                          <select className="tiny-select" value={incident.status || 'New'} onChange={e => updateIncidentStatus(incident.id, e.target.value)}>
                            <option>New</option>
                            <option>Assigned</option>
                            <option>In Progress</option>
                            <option>Awaiting Info</option>
                            <option>Resolved</option>
                            <option>Closed</option>
                          </select>
                        </td>
                        <td><IncidentMapLink incident={incident} /></td>
                        <td>{incident.evidence_filename ? <EvidenceMedia incident={incident} /> : '—'}</td>
                        <td><button className="small-btn" onClick={() => openChat(incident.id)}>Chat</button></td>
                      </tr>
                    )) : <tr><td colSpan={7} className="empty-cell">No incidents yet. Submit your first report above.</td></tr>}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}

        {user.role === 'volunteer' && (
          <>
            <div className="stat-grid">
              <StatCard icon={Users} label="Assigned" value={dashboard.metrics.assignedCount || 0} sub="Open assignments" />
              <StatCard icon={Bell} label="Available" value={dashboard.metrics.availableCount || 0} sub="Volunteer offers" />
              <StatCard icon={Clock3} label="Status" value="Online" sub="Ready to respond" />
              <StatCard icon={Sparkles} label="AI helper" value="Enabled" sub="Task guidance" />
            </div>

            <div className="content-grid">
              <section className="panel">
                <div className="panel-header"><h2>Assigned incidents</h2><span className="chip">Live queue</span></div>
                <div className="list-stack">
                  {dashboard.incidents.length ? dashboard.incidents.map(incident => (
                    <div className="list-card" key={incident.id}>
                      <div>
                        <strong>{incident.title}</strong>
                        <p>{incident.category} • {incident.severity}</p>
                      </div>
                      <button className="small-btn" onClick={() => openChat(incident.id)}>Open chat</button>
                    </div>
                  )) : <p className="empty-state">No assignments yet. Check for new volunteer offers below.</p>}
                </div>
              </section>

              <section className="panel">
                <div className="panel-header"><h2>Volunteer offers</h2><span className="chip">Fresh</span></div>
                <div className="list-stack">
                  {dashboard.offers?.length ? dashboard.offers.map(incident => (
                    <div className="list-card" key={incident.id}>
                      <div>
                        <strong>{incident.title}</strong>
                        <p>{incident.category} • {incident.location_text || 'Location shared on request'}</p>
                        <IncidentMapLink incident={incident} />
                      </div>
                      <button className="primary-btn compact-btn" onClick={() => claimIncident(incident.id)}>Accept case</button>
                    </div>
                  )) : <p className="empty-state">No new offers at the moment.</p>}
                </div>
              </section>
            </div>
            <section className="panel profile-panel">
              <div className="panel-header"><h2>Volunteer profile</h2><span className="chip">Matching preferences</span></div>
              <form className="profile-fields" onSubmit={saveProfile}>
                <input name="name" aria-label="Full name" defaultValue={user.name} placeholder="Full name" required />
                <input name="email" aria-label="Email" type="email" defaultValue={user.email} placeholder="Email" required />
                <input name="phone" aria-label="Phone" defaultValue={user.phone || ''} placeholder="Phone" />
                <input name="location" aria-label="Service area" defaultValue={user.location || ''} placeholder="Service area / neighborhood" />
                <input name="availability" aria-label="Availability" defaultValue={user.availability || ''} placeholder="Availability" />
                <input name="skills" aria-label="Skills" defaultValue={user.skills || ''} placeholder="Skills, separated by commas" />
                <textarea name="bio" aria-label="About you" defaultValue={user.bio || ''} placeholder="Short introduction for the response team" />
                <button className="primary-btn" type="submit">Save volunteer profile</button>
              </form>
            </section>
          </>
        )}

        {user.role === 'admin' && (
          <>
            <div className="stat-grid">
              <StatCard icon={Users} label="Registered users" value={dashboard.metrics.totalUsers || 0} sub="Community members" />
              <StatCard icon={ShieldCheck} label="Volunteers" value={dashboard.metrics.totalVolunteers || 0} sub="Verified and active" />
              <StatCard icon={AlertTriangle} label="Open incidents" value={dashboard.metrics.openIncidents || 0} sub="Needs response" />
              <StatCard icon={Zap} label="Critical" value={dashboard.metrics.criticalIncidents || 0} sub="Priority queue" />
            </div>

            <div className="content-grid admin-content">
              <section className="panel">
                <div className="panel-header"><h2>Incident queue</h2><span className="chip">{dashboard.incidents.length} active</span></div>
                <div className="list-stack">
                  {dashboard.incidents.length ? dashboard.incidents.map(incident => (
                    <div className="list-card admin-card" key={incident.id}>
                      <div>
                        <strong>{incident.title}</strong>
                        <p>{incident.category} • {incident.severity} • {incident.status}</p>
                        <p>{incident.description}</p>
                        <div className="incident-links">
                          <IncidentMapLink incident={incident} />
                          {incident.evidence_filename && <EvidenceMedia incident={incident} />}
                        </div>
                        {(matchMap[incident.id] || []).length > 0 && (
                          <div className="match-list">
                            {(matchMap[incident.id] || []).map(match => (
                              <div className="match-item" key={match.id}>
                                <strong>{match.name}</strong>
                                <span>{match.match_score}% match</span>
                                <small>{match.match_reasons.join(' • ')}</small>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                      <div className="admin-actions">
                        <button className="small-btn" onClick={() => loadVolunteerMatches(incident.id)}>Match</button>
                        <button className="small-btn" onClick={() => openChat(incident.id)}>Chat</button>
                        <select aria-label={`Update status for ${incident.title}`} value={incident.status} onChange={e => updateIncidentStatus(incident.id, e.target.value)}>
                          <option>New</option><option>Assigned</option><option>In Progress</option><option>Awaiting Info</option><option>Resolved</option><option>Closed</option>
                        </select>
                        <select defaultValue="" onChange={e => { if (e.target.value) assignVolunteer(incident.id, Number(e.target.value)); e.target.value = ''; }}>
                          <option value="">Assign volunteer</option>
                          {(dashboard.volunteers || []).filter(volunteer => volunteer.status === 'active').map(volunteer => (
                            <option key={volunteer.id} value={volunteer.id}>{volunteer.name}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                  )) : <p className="empty-state">No incidents reported yet.</p>}
                </div>
              </section>

              <section className="panel">
                <div className="panel-header"><h2>Volunteer roster</h2><span className="chip">{dashboard.volunteers?.length || 0}</span></div>
                <div className="list-stack compact-list">
                  {(dashboard.volunteers || []).map(volunteer => (
                    <div className="list-card" key={volunteer.id}>
                      <div>
                        <strong>{volunteer.name}</strong>
                        <p>{volunteer.email} {volunteer.location ? `• ${volunteer.location}` : ''}</p>
                      </div>
                      <div className="roster-actions">
                        <span className={`badge ${volunteer.status === 'active' ? 'success' : 'critical'}`}>{volunteer.status}</span>
                        <button className="small-btn" onClick={() => updateVolunteerStatus(volunteer.id, volunteer.status === 'active' ? 'suspended' : 'active')}>
                          {volunteer.status === 'active' ? 'Suspend' : 'Activate'}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            </div>
            <section className="panel analytics-panel">
              <div className="panel-header"><h2>Incident analytics</h2><span className="chip">Live database totals</span></div>
              <div className="analytics-grid">
                <AnalyticsGroup title="By status" rows={dashboard.analytics?.status || []} />
                <AnalyticsGroup title="By severity" rows={dashboard.analytics?.severity || []} />
              </div>
              <p className="analytics-footnote">Counts reflect all incident records currently stored in the local database.</p>
            </section>
            <section className="panel analytics-panel">
              <div className="panel-header"><h2>External alert services</h2><span className="chip">Configuration status</span></div>
              <div className="alert-channel-grid">
                <div className={`alert-channel ${dashboard.alertChannels?.email ? 'configured' : ''}`}>
                  <strong>Email alerts</strong>
                  <span>{dashboard.alertChannels?.email ? 'Configured' : 'Not configured'}</span>
                  <small>SMTP delivery to the configured operations mailbox</small>
                </div>
                <div className={`alert-channel ${dashboard.alertChannels?.webhook ? 'configured' : ''}`}>
                  <strong>Signed webhook</strong>
                  <span>{dashboard.alertChannels?.webhook ? 'Configured' : 'Not configured'}</span>
                  <small>HMAC-signed incident-created event</small>
                </div>
              </div>
              <div className="delivery-list">
                <h3>Recent delivery attempts</h3>
                {dashboard.alertDeliveries?.length ? dashboard.alertDeliveries.map((delivery, index) => (
                  <div className="delivery-row" key={`${delivery.incident_id}-${delivery.provider}-${delivery.created_at}-${index}`}>
                    <span>Incident #{delivery.incident_id} · {delivery.provider}</span>
                    <span className={`delivery-status ${delivery.status}`}>{delivery.status}</span>
                    <small>{delivery.created_at}{delivery.details ? ` · ${delivery.details}` : ''}</small>
                  </div>
                )) : <p className="empty-state">No external alert deliveries yet. Configure SMTP or the signed webhook in backend/.env to enable them.</p>}
              </div>
            </section>
          </>
        )}

        {(selectedIncidentId || chatMessages.length > 0) && (
          <section className="panel chat-panel">
            <div className="panel-header"><h2>Incident conversation</h2><span className="chip">Protected</span></div>
            <div className="chat-box">
              {chatMessages.length ? chatMessages.map(message => (
                <div key={message.id} className={`chat-bubble ${message.sender_id === user.id ? 'mine' : ''}`}>
                  <strong>{message.sender_name || 'System'}</strong>
                  <p>{message.body}</p>
                </div>
              )) : <p className="empty-state">No messages yet.</p>}
            </div>
            <div className="chat-controls">
              <input value={chatDraft} onChange={e => setChatDraft(e.target.value)} placeholder="Type a message..." />
              <button className="primary-btn" onClick={sendChatMessage}>Send</button>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}

function StatCard({ icon: Icon, label, value, sub }) {
  return (
    <div className="stat-card">
      <div className="stat-icon"><Icon size={18} /></div>
      <p>{label}</p>
      <h3>{value}</h3>
      <span>{sub}</span>
    </div>
  );
}

function FeatureCard({ icon: Icon, title, description }) {
  return (
    <div className="feature-card">
      <div className="feature-icon"><Icon size={20} /></div>
      <h3>{title}</h3>
      <p>{description}</p>
    </div>
  );
}

function Step({ step, title, text }) {
  return (
    <div className="step-card">
      <span>{step}</span>
      <h3>{title}</h3>
      <p>{text}</p>
    </div>
  );
}

function IncidentMapLink({ incident }) {
  const hasCoordinates = incident.latitude != null && incident.longitude != null &&
    Number.isFinite(Number(incident.latitude)) && Number.isFinite(Number(incident.longitude));
  const query = hasCoordinates
    ? `${incident.latitude},${incident.longitude}`
    : incident.location_text;
  if (!query) return <span className="muted-inline">No location shared</span>;
  const mapUrl = hasCoordinates
    ? `https://www.openstreetmap.org/?mlat=${encodeURIComponent(incident.latitude)}&mlon=${encodeURIComponent(incident.longitude)}#map=16/${encodeURIComponent(incident.latitude)}/${encodeURIComponent(incident.longitude)}`
    : `https://www.openstreetmap.org/search?query=${encodeURIComponent(query)}`;
  return <a className="inline-link" href={mapUrl} target="_blank" rel="noreferrer"><MapPin size={14} /> Map</a>;
}

function AnalyticsGroup({ title, rows }) {
  const maximum = Math.max(1, ...rows.map(row => Number(row.count) || 0));
  return (
    <div className="analytics-group">
      <h3>{title}</h3>
      {rows.length ? rows.map(row => (
        <div className="analytics-row" key={row.label}>
          <div className="analytics-label"><span>{row.label}</span><strong>{row.count}</strong></div>
          <div className="analytics-track"><span style={{ width: `${Math.max(4, (Number(row.count) / maximum) * 100)}%` }} /></div>
        </div>
      )) : <p className="empty-state">No incident data yet.</p>}
    </div>
  );
}

export default App;
