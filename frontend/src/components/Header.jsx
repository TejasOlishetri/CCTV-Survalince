import { 
  Shield, 
  Video, 
  Circle, 
  Camera, 
  Volume2, 
  VolumeX, 
  Sliders, 
  AlertTriangle,
  Car,
  EyeOff,
  Sun,
  Moon
} from 'lucide-react';

export default function Header({ 
  status, 
  activeMode, 
  onSetMode, 
  source, 
  onSetSource, 
  isRecording, 
  onToggleRecording, 
  onTakeSnapshot, 
  isMuted, 
  onToggleMute, 
  onOpenSettings,
  theme,
  toggleTheme
}) {
  const modes = [
    { id: 'surveillance', label: 'Surveillance', icon: Shield, color: '#22d3ee' },
    { id: 'fall_detection', label: 'Fall Safety', icon: AlertTriangle, color: '#f43f5e' },
    { id: 'parking', label: 'Smart Parking', icon: Car, color: '#f59e0b' },
    { id: 'privacy', label: 'Privacy Mask', icon: EyeOff, color: '#10b981' },
  ];

  return (
    <header className="header-bar">
      {/* Brand & Live Indicator */}
      <div className="brand-group">
        <div className="brand-icon">
          <Shield style={{ width: 22, height: 22, color: '#22d3ee' }} />
        </div>
        <div className="brand-text">
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <h1>DEEPCAMERA</h1>
            <span className="brand-badge">AEGIS AI</span>
          </div>
          <div className="brand-sub">
            <span className="status-dot-green"></span>
            <span className="font-mono">
              {status?.status || 'Live Stream Active'} • {status?.fps || 0} FPS
            </span>
          </div>
        </div>
      </div>

      {/* Mode Switcher Tabs */}
      <div className="mode-tabs">
        {modes.map((m) => {
          const Icon = m.icon;
          const isActive = activeMode === m.id;
          return (
            <button
              key={m.id}
              onClick={() => onSetMode(m.id)}
              className={`mode-tab-btn ${isActive ? 'active' : ''}`}
            >
              <Icon style={{ width: 14, height: 14, color: m.color }} />
              <span>{m.label}</span>
            </button>
          );
        })}
      </div>

      {/* Header Action Buttons */}
      <div className="header-actions">
        {/* Source Dropdown */}
        <div className="source-select-box">
          <Video style={{ width: 14, height: 14, color: '#94a3b8' }} />
          <select 
            value={source} 
            onChange={(e) => onSetSource(e.target.value)}
          >
            <option value="0">Webcam 0</option>
            <option value="1">Webcam 1</option>
            <option value="simulated">Simulated Feed</option>
          </select>
        </div>

        {/* REC Button */}
        <button
          onClick={onToggleRecording}
          className={`rec-btn ${isRecording ? 'recording' : ''}`}
        >
          <Circle style={{ width: 10, height: 10, fill: isRecording ? '#f43f5e' : '#94a3b8' }} />
          <span>{isRecording ? 'REC STOP' : 'REC'}</span>
        </button>

        {/* Snapshot Button */}
        <button
          onClick={onTakeSnapshot}
          className="btn-icon-square"
          title="Take Forensic Snapshot"
        >
          <Camera style={{ width: 15, height: 15 }} />
        </button>

        {/* Siren Mute Toggle */}
        <button
          onClick={onToggleMute}
          className={`btn-icon-square ${!isMuted ? 'active-warning' : ''}`}
          title={isMuted ? 'Alarm Siren Muted' : 'Alarm Siren Active'}
        >
          {isMuted ? <VolumeX style={{ width: 15, height: 15 }} /> : <Volume2 style={{ width: 15, height: 15 }} />}
        </button>

        {/* Theme Switcher Toggle */}
        <button
          onClick={toggleTheme}
          className="btn-icon-square theme-toggle-btn"
          title={`Switch to ${theme === 'dark' ? 'Light' : 'Dark'} Mode`}
          aria-label="Toggle Theme"
        >
          {theme === 'dark' ? (
            <Sun style={{ width: 16, height: 16, color: '#f59e0b' }} />
          ) : (
            <Moon style={{ width: 16, height: 16, color: '#4f46e5' }} />
          )}
        </button>

        {/* Settings Button */}
        <button
          onClick={onOpenSettings}
          className="btn-icon-square"
          title="System Settings & Gemini API"
        >
          <Sliders style={{ width: 15, height: 15 }} />
        </button>
      </div>
    </header>
  );
}
