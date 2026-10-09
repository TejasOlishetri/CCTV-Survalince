import React, { useState, useEffect } from 'react';
import { 
  Users, 
  UserX, 
  UserCheck, 
  Car, 
  Activity, 
  Clock,
  ShieldAlert,
  Search
} from 'lucide-react';

export default function VideoPlayer({ status, activeMode }) {
  const [currentTime, setCurrentTime] = useState('');

  const [dismissedMissing, setDismissedMissing] = useState(null);

  useEffect(() => {
    const timer = setInterval(() => {
      const now = new Date();
      setCurrentTime(now.toLocaleTimeString() + '.' + String(now.getMilliseconds()).padStart(3, '0').slice(0, 2));
    }, 100);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!status?.missing_person_found) {
      setDismissedMissing(null);
    }
  }, [status?.missing_person_found]);

  const fallDetected = Boolean(status?.fall_detected);
  const missingFound = Boolean(status?.missing_person_found && status?.missing_person_matches?.length > 0);
  const missingName = status?.missing_person_matches?.[0]?.name;
  const showMissingAlert = missingFound && !fallDetected && dismissedMissing !== missingName;

  return (
    <div className="monitor-box">
      {/* CCTV Screen Viewport */}
      <div className="cctv-screen">
        <img
          src="/video_feed"
          alt="DeepCamera AI Live Stream"
          onError={(e) => {
            e.target.style.display = 'none';
          }}
        />

        {/* Top HUD */}
        <div className="hud-overlay">
          <div style={{ display: 'flex', gap: '8px' }}>
            <span className="hud-pill">
              <span className="status-dot-green"></span>
              CAM {status?.source ?? '0'} • {activeMode?.toUpperCase()}
              {Boolean(status?.privacy_blur) && (
                <span style={{ color: '#10b981', marginLeft: 6, fontWeight: 700, letterSpacing: '0.5px' }}>
                  • PRIVACY ON
                </span>
              )}
            </span>
            <span className="hud-pill" style={{ color: '#cbd5e1' }}>
              {status?.fps || 0} FPS | {status?.latency_ms || 0}ms
            </span>
          </div>

          <div className="hud-time">
            <Clock style={{ width: 13, height: 13, color: '#94a3b8' }} />
            <span>{currentTime || '00:00:00'}</span>
          </div>
        </div>

        {/* Emergency Alert Banner: Fall Detected */}
        {fallDetected && (
          <div className="alert-banner-emergency">
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <ShieldAlert style={{ width: 18, height: 18 }} />
              <span>EMERGENCY: PERSON FALL DETECTED!</span>
            </div>
            <span style={{ fontSize: 10, fontFamily: 'monospace', textTransform: 'uppercase', background: 'rgba(0,0,0,0.3)', padding: '2px 8px', borderRadius: 4 }}>
              Immediate Physical Assistance Required
            </span>
          </div>
        )}

        {/* Missing Person Alert Banner */}
        {showMissingAlert && (
          <div className="alert-banner-target">
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Search style={{ width: 18, height: 18 }} />
              <span>TARGET FOUND: {missingName?.toUpperCase() || 'MISSING PERSON'} IDENTIFIED!</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: 10, fontFamily: 'monospace', textTransform: 'uppercase', background: 'rgba(0,0,0,0.3)', padding: '2px 8px', borderRadius: 4 }}>
                Active Match
              </span>
              <button
                type="button"
                onClick={() => setDismissedMissing(missingName)}
                style={{
                  background: 'rgba(0,0,0,0.35)',
                  color: '#fff',
                  border: '1px solid rgba(255,255,255,0.25)',
                  borderRadius: 4,
                  padding: '2px 7px',
                  cursor: 'pointer',
                  fontSize: 10,
                  fontWeight: 700
                }}
                title="Dismiss Banner"
              >
                ✕
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Telemetry Stats Bar Underneath */}
      <div className="telemetry-grid">
        {/* Detected Objects */}
        <div className="stat-item">
          <div className="stat-icon cyan">
            <Users style={{ width: 16, height: 16 }} />
          </div>
          <div className="stat-meta">
            <p>Objects Count</p>
            <h4>{status?.objects_count || 0}</h4>
          </div>
        </div>

        {/* Strangers */}
        <div className="stat-item">
          <div className="stat-icon amber">
            <UserX style={{ width: 16, height: 16 }} />
          </div>
          <div className="stat-meta">
            <p>Strangers / Visitors</p>
            <h4>{status?.intruders_count || 0}</h4>
          </div>
        </div>

        {/* Known Members */}
        <div className="stat-item">
          <div className="stat-icon emerald">
            <UserCheck style={{ width: 16, height: 16 }} />
          </div>
          <div className="stat-meta">
            <p>Known Members</p>
            <h4>{status?.known_count || 0}</h4>
          </div>
        </div>

        {/* Mode-specific status */}
        <div className="stat-item">
          <div className="stat-icon indigo">
            {activeMode === 'parking' ? <Car style={{ width: 16, height: 16 }} /> : <Activity style={{ width: 16, height: 16 }} />}
          </div>
          <div className="stat-meta">
            <p>{activeMode === 'parking' ? 'Parking Slots' : 'Safety Posture'}</p>
            <h4>
              {activeMode === 'parking' 
                ? `${status?.parking?.occupied || 0}/${status?.parking?.total || 4} Busy` 
                : fallDetected ? 'EMERGENCY' : 'Safe / Upright'}
            </h4>
          </div>
        </div>
      </div>
    </div>
  );
}
