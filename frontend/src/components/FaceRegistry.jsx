import React, { useState, useEffect } from 'react';
import { UserCheck, Camera, Check, AlertCircle } from 'lucide-react';

export default function FaceRegistry() {
  const [faces, setFaces] = useState({});
  const [name, setName] = useState('');
  const [isEnrolling, setIsEnrolling] = useState(false);
  const [msg, setMsg] = useState(null);

  const fetchFaces = async () => {
    try {
      const res = await fetch('/api/faces');
      const data = await res.json();
      setFaces(data || {});
    } catch (e) {}
  };

  useEffect(() => {
    fetchFaces();
  }, []);

  const handleEnroll = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;

    setIsEnrolling(true);
    setMsg(null);

    try {
      const res = await fetch('/api/enroll_face', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim() })
      });
      const data = await res.json();
      if (data.success) {
        setMsg({ type: 'success', text: `Face profile for '${name}' enrolled from live camera!` });
        setName('');
        fetchFaces();
      } else {
        setMsg({ type: 'error', text: data.error || 'Failed to enroll face.' });
      }
    } catch (err) {
      setMsg({ type: 'error', text: 'Network error enrolling face.' });
    } finally {
      setIsEnrolling(false);
    }
  };

  const faceList = Object.entries(faces);

  return (
    <div className="missing-panel">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 28, height: 28, borderRadius: 8, background: 'rgba(16,185,129,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <UserCheck style={{ width: 16, height: 16, color: '#10b981' }} />
          </div>
          <span style={{ fontWeight: 700, fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            Authorized Residents & Face ID
          </span>
        </div>
        <span style={{ fontSize: 11, fontFamily: 'monospace', padding: '2px 8px', borderRadius: 4, background: 'rgba(16,185,129,0.15)', color: '#6ee7b7', border: '1px solid rgba(16,185,129,0.3)' }}>
          {faceList.length} Profiles
        </span>
      </div>

      {msg && (
        <div style={{ padding: '8px 12px', borderRadius: 8, fontSize: 11, display: 'flex', alignItems: 'center', gap: 8, background: msg.type === 'success' ? 'rgba(16,185,129,0.15)' : 'rgba(244,63,94,0.15)', color: msg.type === 'success' ? '#6ee7b7' : '#fda4af', border: `1px solid ${msg.type === 'success' ? 'rgba(16,185,129,0.3)' : 'rgba(244,63,94,0.3)'}` }}>
          {msg.type === 'success' ? <Check style={{ width: 14, height: 14 }} /> : <AlertCircle style={{ width: 14, height: 14 }} />}
          <span>{msg.text}</span>
        </div>
      )}

      {/* Enroll Form */}
      <form onSubmit={handleEnroll} style={{ display: 'flex', gap: 8, background: 'rgba(4,7,13,0.6)', padding: 10, borderRadius: 10, border: '1px solid rgba(255,255,255,0.08)' }}>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Enter resident / authorized name..."
          className="form-input"
          style={{ flex: 1 }}
          required
        />
        <button
          type="submit"
          disabled={isEnrolling || !name.trim()}
          style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 8, background: '#059669', color: '#fff', fontWeight: 600, fontSize: 11, whiteSpace: 'nowrap' }}
        >
          <Camera style={{ width: 14, height: 14 }} />
          <span>{isEnrolling ? 'Enrolling...' : 'Enroll From Live Cam'}</span>
        </button>
      </form>

      {/* Faces Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 8 }}>
        {faceList.map(([fName, fInfo]) => (
          <div key={fName} style={{ padding: 8, borderRadius: 8, background: 'rgba(4,7,13,0.6)', border: '1px solid rgba(255,255,255,0.08)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <img
              src={`/enrolled_faces/${fInfo.photo}`}
              alt={fName}
              style={{ width: 36, height: 36, borderRadius: 6, objectFit: 'cover', border: '1px solid rgba(16,185,129,0.4)' }}
            />
            <div style={{ overflow: 'hidden' }}>
              <h5 style={{ fontWeight: 700, color: '#f8fafc', fontSize: 12, textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>{fName}</h5>
              <span style={{ fontSize: 9, color: '#34d399', fontFamily: 'monospace' }}>Verified Resident</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
