import React, { useState, useEffect } from 'react';
import { 
  UserCheck, 
  Camera, 
  Check, 
  AlertCircle, 
  Trash2, 
  Upload, 
  User, 
  Clock 
} from 'lucide-react';

export default function FaceRegistry() {
  const [faces, setFaces] = useState({});
  const [name, setName] = useState('');
  const [enrollMode, setEnrollMode] = useState('camera'); // 'camera' | 'upload'
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
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

  const handleFileChange = (e) => {
    const f = e.target.files[0];
    if (f) {
      setFile(f);
      setPreview(URL.createObjectURL(f));
    }
  };

  const handleEnroll = async (e) => {
    e.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) {
      setMsg({ type: 'error', text: 'Resident name is required.' });
      return;
    }

    if (enrollMode === 'upload' && !file) {
      setMsg({ type: 'error', text: 'Please select a headshot photo to upload.' });
      return;
    }

    setIsEnrolling(true);
    setMsg(null);

    try {
      let res;
      if (enrollMode === 'upload' && file) {
        const formData = new FormData();
        formData.append('name', trimmedName);
        formData.append('photo', file);
        res = await fetch('/api/enroll_face', {
          method: 'POST',
          body: formData
        });
      } else {
        res = await fetch('/api/enroll_face', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: trimmedName })
        });
      }

      const data = await res.json();
      if (data.success) {
        setMsg({ type: 'success', text: `Face ID for '${trimmedName}' successfully enrolled!` });
        setName('');
        setFile(null);
        setPreview(null);
        fetchFaces();
      } else {
        setMsg({ type: 'error', text: data.error || data.message || 'Failed to enroll face.' });
      }
    } catch (err) {
      setMsg({ type: 'error', text: 'Network error communicating with CCTV backend.' });
    } finally {
      setIsEnrolling(false);
    }
  };

  const handleDelete = async (targetName) => {
    if (!window.confirm(`Are you sure you want to delete Face ID for '${targetName}'?`)) return;

    try {
      const res = await fetch('/api/delete_face', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: targetName })
      });
      const data = await res.json();
      if (data.success) {
        setMsg({ type: 'success', text: `Face ID for '${targetName}' deleted successfully.` });
        fetchFaces();
      } else {
        setMsg({ type: 'error', text: data.error || 'Failed to delete face.' });
      }
    } catch (err) {
      setMsg({ type: 'error', text: 'Network error deleting face.' });
    }
  };

  const faceList = Object.entries(faces);

  return (
    <div className="missing-panel">
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--border-subtle)', paddingBottom: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 28, height: 28, borderRadius: 8, background: 'rgba(16,185,129,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <UserCheck style={{ width: 16, height: 16, color: 'var(--emerald)' }} />
          </div>
          <div>
            <span style={{ fontWeight: 700, fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-main)', display: 'block' }}>
              Authorized Residents & Face ID
            </span>
          </div>
        </div>
        <span style={{ fontSize: 11, fontFamily: 'monospace', padding: '2px 8px', borderRadius: 4, background: 'rgba(16,185,129,0.15)', color: 'var(--emerald)', border: '1px solid rgba(16,185,129,0.3)' }}>
          {faceList.length} Active
        </span>
      </div>

      {/* Status Alert Banner */}
      {msg && (
        <div style={{ padding: '8px 12px', borderRadius: 8, fontSize: 11, display: 'flex', alignItems: 'center', gap: 8, background: msg.type === 'success' ? 'rgba(16,185,129,0.15)' : 'rgba(244,63,94,0.15)', color: msg.type === 'success' ? 'var(--emerald)' : 'var(--rose)', border: `1px solid ${msg.type === 'success' ? 'rgba(16,185,129,0.3)' : 'rgba(244,63,94,0.3)'}` }}>
          {msg.type === 'success' ? <Check style={{ width: 14, height: 14 }} /> : <AlertCircle style={{ width: 14, height: 14 }} />}
          <span>{msg.text}</span>
        </div>
      )}

      {/* Enrollment Form */}
      <div style={{ background: 'var(--bg-pill)', padding: 12, borderRadius: 12, border: '1px solid var(--border-subtle)', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {/* Method Switcher Tabs */}
        <div style={{ display: 'flex', gap: 6, padding: 3, background: 'var(--bg-card-solid)', borderRadius: 8, border: '1px solid var(--border-subtle)' }}>
          <button
            type="button"
            onClick={() => setEnrollMode('camera')}
            style={{
              flex: 1,
              padding: '6px 10px',
              borderRadius: 6,
              fontSize: 11,
              fontWeight: 600,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              background: enrollMode === 'camera' ? 'rgba(16,185,129,0.18)' : 'transparent',
              color: enrollMode === 'camera' ? 'var(--emerald)' : 'var(--text-muted)',
              border: enrollMode === 'camera' ? '1px solid rgba(16,185,129,0.4)' : '1px solid transparent'
            }}
          >
            <Camera style={{ width: 13, height: 13 }} />
            <span>Enroll via Live Camera</span>
          </button>

          <button
            type="button"
            onClick={() => setEnrollMode('upload')}
            style={{
              flex: 1,
              padding: '6px 10px',
              borderRadius: 6,
              fontSize: 11,
              fontWeight: 600,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              background: enrollMode === 'upload' ? 'rgba(16,185,129,0.18)' : 'transparent',
              color: enrollMode === 'upload' ? 'var(--emerald)' : 'var(--text-muted)',
              border: enrollMode === 'upload' ? '1px solid rgba(16,185,129,0.4)' : '1px solid transparent'
            }}
          >
            <Upload style={{ width: 13, height: 13 }} />
            <span>Upload Photo</span>
          </button>
        </div>

        {/* Input Form */}
        <form onSubmit={handleEnroll} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Resident Name (e.g., Tejas, Rahul)..."
              className="form-input"
              style={{ flex: 1 }}
              required
            />
            {enrollMode === 'camera' && (
              <button
                type="submit"
                disabled={isEnrolling || !name.trim()}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '8px 14px',
                  borderRadius: 8,
                  background: 'var(--emerald)',
                  color: '#fff',
                  fontWeight: 600,
                  fontSize: 11,
                  whiteSpace: 'nowrap',
                  cursor: isEnrolling || !name.trim() ? 'not-allowed' : 'pointer',
                  opacity: isEnrolling || !name.trim() ? 0.6 : 1
                }}
              >
                <Camera style={{ width: 14, height: 14 }} />
                <span>{isEnrolling ? 'Scanning...' : 'Capture & Enroll'}</span>
              </button>
            )}
          </div>

          {enrollMode === 'upload' && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <div style={{ flex: 1, position: 'relative' }}>
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleFileChange}
                  style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer', zIndex: 2 }}
                  required
                />
                <div style={{ padding: '7px 12px', background: 'var(--bg-input)', border: '1px dashed var(--border-medium)', borderRadius: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
                  {preview ? (
                    <>
                      <img src={preview} alt="Preview" style={{ width: 28, height: 28, borderRadius: 6, objectFit: 'cover' }} />
                      <span style={{ fontSize: 11, color: 'var(--text-main)' }}>Photo selected (click to change)</span>
                    </>
                  ) : (
                    <>
                      <Upload style={{ width: 14, height: 14, color: 'var(--text-muted)' }} />
                      <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Choose headshot image file...</span>
                    </>
                  )}
                </div>
              </div>

              <button
                type="submit"
                disabled={isEnrolling || !name.trim() || !file}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '8px 14px',
                  borderRadius: 8,
                  background: 'var(--emerald)',
                  color: '#fff',
                  fontWeight: 600,
                  fontSize: 11,
                  whiteSpace: 'nowrap',
                  cursor: isEnrolling || !name.trim() || !file ? 'not-allowed' : 'pointer',
                  opacity: isEnrolling || !name.trim() || !file ? 0.6 : 1
                }}
              >
                <Check style={{ width: 14, height: 14 }} />
                <span>{isEnrolling ? 'Uploading...' : 'Save Face ID'}</span>
              </button>
            </div>
          )}
        </form>
      </div>

      {/* Enrolled Faces List */}
      <div>
        <h4 style={{ fontSize: 11, textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: 700, marginBottom: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span>Registered Authorized Faces</span>
          <span style={{ fontSize: 10, fontWeight: 500 }}>{faceList.length} Registered</span>
        </h4>

        {faceList.length === 0 ? (
          <div style={{ color: 'var(--text-dark)', fontStyle: 'italic', padding: 20, background: 'var(--bg-pill)', borderRadius: 10, textAlign: 'center' }}>
            No authorized residents enrolled yet. Enroll your face to prevent false intruder alerts!
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))', gap: 10 }}>
            {faceList.map(([fName, fInfo]) => {
              const filename = fInfo?.filename || fInfo?.photo;
              const photoUrl = filename ? `/enrolled_faces/${filename}` : null;

              return (
                <div 
                  key={fName} 
                  style={{
                    padding: 10,
                    borderRadius: 10,
                    background: 'var(--bg-pill)',
                    border: '1px solid var(--border-subtle)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 10,
                    transition: 'all 0.2s'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                    {/* Headshot Photo Preview */}
                    <div style={{ width: 44, height: 44, borderRadius: 8, overflow: 'hidden', flexShrink: 0, position: 'relative', background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      {photoUrl ? (
                        <img
                          src={photoUrl}
                          alt={fName}
                          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                          onError={(e) => {
                            e.target.style.display = 'none';
                            if (e.target.nextSibling) e.target.nextSibling.style.display = 'flex';
                          }}
                        />
                      ) : null}
                      <div 
                        style={{ 
                          display: photoUrl ? 'none' : 'flex', 
                          width: '100%', 
                          height: '100%', 
                          alignItems: 'center', 
                          justifyContent: 'center',
                          color: 'var(--emerald)',
                          fontWeight: 700,
                          fontSize: 16
                        }}
                      >
                        {fName.charAt(0).toUpperCase()}
                      </div>
                    </div>

                    {/* Metadata */}
                    <div style={{ minWidth: 0 }}>
                      <h5 style={{ fontWeight: 700, color: 'var(--text-main)', fontSize: 13, textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                        {fName}
                      </h5>
                      <span style={{ fontSize: 10, color: 'var(--emerald)', fontFamily: 'monospace', display: 'block' }}>
                        ✓ Verified Resident
                      </span>
                      {fInfo?.enrolled_at && (
                        <span style={{ fontSize: 9, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 3, marginTop: 2 }}>
                          <Clock style={{ width: 10, height: 10 }} />
                          {fInfo.enrolled_at.split(' ')[0]}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Delete Face ID Button */}
                  <button
                    type="button"
                    onClick={() => handleDelete(fName)}
                    style={{
                      background: 'transparent',
                      color: 'var(--text-dark)',
                      padding: 6,
                      borderRadius: 6,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      cursor: 'pointer',
                      border: '1px solid transparent',
                      transition: 'all 0.15s ease'
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.color = 'var(--rose)';
                      e.currentTarget.style.background = 'rgba(244, 63, 94, 0.15)';
                      e.currentTarget.style.borderColor = 'rgba(244, 63, 94, 0.3)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.color = 'var(--text-dark)';
                      e.currentTarget.style.background = 'transparent';
                      e.currentTarget.style.borderColor = 'transparent';
                    }}
                    title={`Delete Face ID for ${fName}`}
                  >
                    <Trash2 style={{ width: 15, height: 15 }} />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
