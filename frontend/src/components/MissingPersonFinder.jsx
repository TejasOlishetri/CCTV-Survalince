import React, { useState, useEffect } from 'react';
import { 
  UserSearch, 
  Upload, 
  Trash2, 
  CheckCircle, 
  AlertTriangle, 
  Phone
} from 'lucide-react';

export default function MissingPersonFinder({ matches }) {
  const [profiles, setProfiles] = useState({});
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [contact, setContact] = useState('');
  const [lastSeen, setLastSeen] = useState('');
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [msg, setMsg] = useState(null);

  const fetchProfiles = async () => {
    try {
      const res = await fetch('/api/missing_persons');
      const data = await res.json();
      setProfiles(data || {});
    } catch (e) {}
  };

  useEffect(() => {
    fetchProfiles();
  }, []);

  const handleFileChange = (e) => {
    const f = e.target.files[0];
    if (f) {
      setFile(f);
      setPreview(URL.createObjectURL(f));
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!name || !file) {
      setMsg({ type: 'error', text: 'Name and Photo are required!' });
      return;
    }

    setIsSubmitting(true);
    setMsg(null);

    const formData = new FormData();
    formData.append('name', name);
    formData.append('photo', file);
    formData.append('description', description);
    formData.append('contact', contact);
    formData.append('last_seen', lastSeen);

    try {
      const res = await fetch('/api/add_missing_person', {
        method: 'POST',
        body: formData
      });
      const data = await res.json();
      if (data.success) {
        setMsg({ type: 'success', text: `Target profile for ${name} registered!` });
        setName('');
        setDescription('');
        setContact('');
        setLastSeen('');
        setFile(null);
        setPreview(null);
        fetchProfiles();
      } else {
        setMsg({ type: 'error', text: data.error || 'Failed to add missing person.' });
      }
    } catch (err) {
      setMsg({ type: 'error', text: 'Network error uploading profile.' });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async (targetName) => {
    if (!window.confirm(`Delete search profile for ${targetName}?`)) return;
    try {
      await fetch('/api/delete_missing_person', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: targetName })
      });
      fetchProfiles();
    } catch (e) {}
  };

  const profileList = Object.entries(profiles);

  return (
    <div className="missing-panel">
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 28, height: 28, borderRadius: 8, background: 'rgba(244,63,94,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <UserSearch style={{ width: 16, height: 16, color: '#f43f5e' }} />
          </div>
          <span style={{ fontWeight: 700, fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            Missing Person Search Registry
          </span>
        </div>
        <span style={{ fontSize: 11, fontFamily: 'monospace', padding: '2px 8px', borderRadius: 4, background: 'rgba(244,63,94,0.15)', color: '#fda4af', border: '1px solid rgba(244,63,94,0.3)' }}>
          {profileList.length} Active
        </span>
      </div>

      {msg && (
        <div style={{ padding: '8px 12px', borderRadius: 8, fontSize: 11, display: 'flex', alignItems: 'center', gap: 8, background: msg.type === 'success' ? 'rgba(16,185,129,0.15)' : 'rgba(244,63,94,0.15)', color: msg.type === 'success' ? '#6ee7b7' : '#fda4af', border: `1px solid ${msg.type === 'success' ? 'rgba(16,185,129,0.3)' : 'rgba(244,63,94,0.3)'}` }}>
          {msg.type === 'success' ? <CheckCircle style={{ width: 14, height: 14 }} /> : <AlertTriangle style={{ width: 14, height: 14 }} />}
          <span>{msg.text}</span>
        </div>
      )}

      {/* Upload Form */}
      <form onSubmit={handleSubmit} className="upload-form-grid">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div>
            <label style={{ fontSize: 10, color: '#94a3b8', display: 'block', marginBottom: 3 }}>Target Name *</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Tejas / Rahul Sharma"
              className="form-input"
              required
            />
          </div>

          <div>
            <label style={{ fontSize: 10, color: '#94a3b8', display: 'block', marginBottom: 3 }}>Contact Phone</label>
            <input
              type="text"
              value={contact}
              onChange={(e) => setContact(e.target.value)}
              placeholder="e.g. +91 98765 43210"
              className="form-input"
            />
          </div>

          <div>
            <label style={{ fontSize: 10, color: '#94a3b8', display: 'block', marginBottom: 3 }}>Appearance Details</label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g. Dark jacket, glasses"
              className="form-input"
            />
          </div>
        </div>

        {/* Photo Box */}
        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', gap: 8 }}>
          <div className="photo-drop-box">
            <input
              type="file"
              accept="image/*"
              onChange={handleFileChange}
              style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer' }}
              required={!preview}
            />
            {preview ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <img src={preview} alt="Preview" style={{ width: 50, height: 50, borderRadius: 8, objectFit: 'cover' }} />
                <span style={{ fontSize: 11, color: '#e2e8f0' }}>Click to change photo</span>
              </div>
            ) : (
              <>
                <Upload style={{ width: 20, height: 20, color: '#94a3b8' }} />
                <span style={{ fontSize: 11, color: '#94a3b8' }}>Upload Headshot Photo</span>
              </>
            )}
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            style={{ padding: '8px 12px', borderRadius: 8, background: 'linear-gradient(135deg, #e11d48, #f43f5e)', color: '#fff', fontWeight: 600, fontSize: 12, cursor: 'pointer' }}
          >
            {isSubmitting ? 'Registering...' : 'Deploy Search to CCTV'}
          </button>
        </div>
      </form>

      {/* Target Cards Grid */}
      <div>
        <h4 style={{ fontSize: 11, textTransform: 'uppercase', color: '#94a3b8', fontWeight: 700, marginBottom: 8 }}>
          Active Missing Persons Being Tracked
        </h4>
        {profileList.length === 0 ? (
          <p style={{ color: '#64748b', fontStyle: 'italic', padding: 12, background: 'rgba(255,255,255,0.02)', borderRadius: 8, textAlign: 'center' }}>
            No missing persons registered right now.
          </p>
        ) : (
          <div className="targets-cards-grid">
            {profileList.map(([pName, pInfo]) => (
              <div key={pName} className="target-card">
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <img
                    src={`/missing_persons/${pInfo.photo}`}
                    alt={pName}
                    className="target-card-thumb"
                  />
                  <div>
                    <h5 style={{ fontWeight: 700, color: '#f8fafc', fontSize: 13 }}>{pName}</h5>
                    <p style={{ fontSize: 10, color: '#94a3b8' }}>{pInfo.description || 'No notes'}</p>
                    {pInfo.contact && (
                      <p style={{ fontSize: 10, color: '#fda4af', fontFamily: 'monospace' }}>
                        📞 {pInfo.contact}
                      </p>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => handleDelete(pName)}
                  style={{ background: 'transparent', color: '#64748b', padding: 6, borderRadius: 6 }}
                  title="Remove"
                >
                  <Trash2 style={{ width: 14, height: 14 }} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Real-time Match Sightings */}
      {matches && matches.length > 0 && (
        <div style={{ borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: 10 }}>
          <h4 style={{ fontSize: 11, color: '#f59e0b', fontWeight: 700, marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
            <AlertTriangle style={{ width: 14, height: 14 }} />
            Live Facial ReID Match Sightings
          </h4>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 120, overflowY: 'auto' }}>
            {matches.map((m, idx) => (
              <div key={idx} style={{ padding: '6px 10px', borderRadius: 6, background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.25)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <strong style={{ color: '#fcd34d' }}>{m.name}</strong>
                  <span style={{ color: '#94a3b8', marginLeft: 8 }}>Match: {Math.round(m.similarity * 100)}%</span>
                </div>
                <span style={{ fontSize: 10, fontFamily: 'monospace', color: '#94a3b8' }}>{m.time}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
