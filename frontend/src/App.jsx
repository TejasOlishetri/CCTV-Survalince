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
  const [theme, setTheme] = useState(() => {
    return localStorage.getItem('deepcamera_theme') || 'dark';
  });
  const [status, setStatus] = useState(null);
  const [activeMode, setActiveMode] = useState('surveillance');
  const [source, setSource] = useState('0');
  const [isRecording, setIsRecording] = useState(false);
  const [isMuted, setIsMuted] = useState(true);
  const [privacyBlur, setPrivacyBlur] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [activeRightTab, setActiveRightTab] = useState('chat'); // 'chat' | 'missing' | 'faces' | 'events'
  const [recordings, setRecordings] = useState([]);
  const [snapshots, setSnapshots] = useState([]);

  // Theme Sync Effect
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('deepcamera_theme', theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'));
  };

  // Fetch CCTV Live Status every 1s
  const fetchStatus = async () => {
    try {
      const res = await fetch('/api/status');
      const data = await res.json();
      setStatus(data);
      if (data.active_mode) setActiveMode(data.active_mode);
      if (data.source) setSource(data.source);
      if (data.privacy_blur !== undefined) setPrivacyBlur(Boolean(data.privacy_blur));
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

  const handleTogglePrivacy = async () => {
    try {
      const res = await fetch('/api/privacy/toggle', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        setPrivacyBlur(Boolean(data.privacy_blur));
        fetchStatus();
      }
    } catch (e) {
      console.error('Failed to toggle privacy filter:', e);
    }
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
        theme={theme}
        toggleTheme={toggleTheme}
        privacyBlur={privacyBlur}
        onTogglePrivacy={handleTogglePrivacy}
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
            <div className="glass-panel event-timeline-panel">
              <div className="event-panel-header">
                <span className="event-panel-title">
                  <ShieldAlert size={16} color="var(--cyan)" />
                  Real-Time Incident & Event Timeline
                </span>
                <span className="font-mono event-count-badge">
                  {status?.recent_events?.length || 0} Events
                </span>
              </div>
              <div className="event-list-scroll">
                {(!status?.recent_events || status.recent_events.length === 0) ? (
                  <p className="event-empty-msg">No recent security events logged.</p>
                ) : (
                  status.recent_events.map((ev, idx) => (
                    <div key={idx} className="event-item-card">
                      <div>
                        <h5 className="event-title">{ev.title}</h5>
                        <p className="event-msg">{ev.msg}</p>
                      </div>
                      <span className="font-mono event-time-chip">
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
