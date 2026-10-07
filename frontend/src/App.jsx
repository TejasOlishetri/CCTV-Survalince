import React, { useState, useEffect } from 'react';
import Header from './components/Header';
import VideoPlayer from './components/VideoPlayer';
import AiGuardChat from './components/AiGuardChat';
import MissingPersonFinder from './components/MissingPersonFinder';
import FaceRegistry from './components/FaceRegistry';
import SettingsModal from './components/SettingsModal';
import { 
  Bot, 
  UserSearch, 
  UserCheck, 
  ListFilter, 
  ShieldAlert, 
  Camera, 
  CheckCircle2,
  Clock
} from 'lucide-react';

export default function App() {
  const [status, setStatus] = useState(null);
  const [activeMode, setActiveMode] = useState('surveillance');
  const [source, setSource] = useState('0');
  const [isRecording, setIsRecording] = useState(false);
  const [isMuted, setIsMuted] = useState(true);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [activeRightTab, setActiveRightTab] = useState('chat'); // 'chat' | 'missing' | 'faces' | 'events'
  const [recordings, setRecordings] = useState([]);
  const [snapshots, setSnapshots] = useState([]);

  // Fetch CCTV Live Status every 1s
  const fetchStatus = async () => {
    try {
      const res = await fetch('/api/status');
      const data = await res.json();
      setStatus(data);
      if (data.active_mode) setActiveMode(data.active_mode);
      if (data.source) setSource(data.source);
      setIsRecording(Boolean(data.is_recording));
    } catch (e) {}
  };

  // Fetch Recordings List
  const fetchRecordings = async () => {
    try {
      const res = await fetch('/api/recordings_list');
      const list = await res.json();
      setRecordings(list || []);
    } catch (e) {}
  };

  // Fetch Recent Snapshots
  const fetchSnapshots = async () => {
    try {
      const res = await fetch('/api/snapshots_list');
      const list = await res.json();
      setSnapshots(list || []);
    } catch (e) {}
  };

  useEffect(() => {
    fetchStatus();
    fetchRecordings();
    fetchSnapshots();

    const interval = setInterval(fetchStatus, 1000);
    return () => clearInterval(interval);
  }, []);

  // Handlers
  const handleSetMode = async (mode) => {
    setActiveMode(mode);
    try {
      await fetch('/api/set_mode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode })
      });
      fetchStatus();
    } catch (e) {}
  };

  const handleSetSource = async (newSource) => {
    setSource(newSource);
    try {
      await fetch('/api/set_source', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: newSource })
      });
      fetchStatus();
    } catch (e) {}
  };

  const handleToggleRecording = async () => {
    try {
      const res = await fetch('/api/recording/toggle', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        setIsRecording(Boolean(data.recording));
        fetchRecordings();
        fetchStatus();
      }
    } catch (e) {}
  };

  const handleTakeSnapshot = async () => {
    try {
      const res = await fetch('/api/snapshot', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        fetchSnapshots();
        alert('Forensic snapshot saved!');
      }
    } catch (e) {}
  };

  const tabs = [
    { id: 'chat', label: 'AI Guard (Gemini)', icon: Bot },
    { id: 'missing', label: 'Missing Persons', icon: UserSearch },
    { id: 'faces', label: 'Face Registry', icon: UserCheck },
    { id: 'events', label: 'Event Logs', icon: ListFilter },
  ];

  return (
    <div className="app-container">
      {/* Top Header */}
      <Header
        status={status}
        activeMode={activeMode}
        onSetMode={handleSetMode}
        source={source}
        onSetSource={handleSetSource}
        isRecording={isRecording}
        onToggleRecording={handleToggleRecording}
        onTakeSnapshot={handleTakeSnapshot}
        isMuted={isMuted}
        onToggleMute={() => setIsMuted(!isMuted)}
        onOpenSettings={() => setIsSettingsOpen(true)}
      />

      {/* Main Grid: Video Player (Left/Center) + Smart Panels (Right) */}
      <div className="main-grid">
        {/* Left: Video Player Monitor & Snapshots */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <VideoPlayer status={status} activeMode={activeMode} />

          {/* Recent Snapshots Bar */}
          {snapshots.length > 0 && (
            <div className="snapshots-tray">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--cyan-light)', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Camera size={14} color="var(--cyan)" />
                  Recent CCTV Forensic Snapshots
                </span>
                <span className="font-mono" style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                  {snapshots.length} Captured
                </span>
              </div>
              <div className="snapshots-row">
                {snapshots.slice(0, 10).map((snap, idx) => (
                  <img
                    key={idx}
                    src={`/snapshots/${snap}`}
                    alt="Snapshot"
                    onClick={() => window.open(`/snapshots/${snap}`, '_blank')}
                    className="snapshot-thumb"
                  />
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right: Tabbed Feature Panels */}
        <div className="right-panel-group">
          {/* Panel Tab Buttons */}
          <div className="panel-tabs-bar">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeRightTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveRightTab(tab.id)}
                  className={`panel-tab-btn ${isActive ? 'active' : ''}`}
                >
                  <Icon size={14} />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </div>

          {/* Active Tab Component */}
          {activeRightTab === 'chat' && (
            <AiGuardChat 
              recordings={recordings} 
              onRefreshRecordings={fetchRecordings} 
            />
          )}

          {activeRightTab === 'missing' && (
            <MissingPersonFinder 
              matches={status?.missing_person_matches} 
            />
          )}

          {activeRightTab === 'faces' && (
            <FaceRegistry />
          )}

          {activeRightTab === 'events' && (
            <div className="glass-panel" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12, height: 580 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--border-subtle)', paddingBottom: 10 }}>
                <span style={{ fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', color: '#fff', display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
                  <ShieldAlert size={16} color="var(--cyan)" />
                  Real-Time Incident & Event Timeline
                </span>
                <span className="font-mono" style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                  {status?.recent_events?.length || 0} Events
                </span>
              </div>
              <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
                {(!status?.recent_events || status.recent_events.length === 0) ? (
                  <p style={{ color: 'var(--text-dark)', fontStyle: 'italic', textAlign: 'center', padding: 20 }}>No recent security events logged.</p>
                ) : (
                  status.recent_events.map((ev, idx) => (
                    <div 
                      key={idx} 
                      style={{ padding: '10px 12px', borderRadius: 10, background: 'rgba(4, 7, 13, 0.6)', border: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}
                    >
                      <div>
                        <h5 style={{ fontWeight: 700, color: '#f1f5f9', fontSize: 12 }}>{ev.title}</h5>
                        <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{ev.msg}</p>
                      </div>
                      <span className="font-mono" style={{ fontSize: 10, color: 'var(--cyan-light)', display: 'flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}>
                        <Clock size={12} /> {ev.time}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Settings Modal */}
      <SettingsModal 
        isOpen={isSettingsOpen} 
        onClose={() => setIsSettingsOpen(false)} 
      />
    </div>
  );
}
