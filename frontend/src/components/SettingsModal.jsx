import React, { useState, useEffect } from 'react';
import { X, Key, Send, Bell, Sliders, Check, Save } from 'lucide-react';

export default function SettingsModal({ isOpen, onClose }) {
  const [config, setConfig] = useState({});
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  useEffect(() => {
    if (isOpen) {
      fetch('/api/config')
        .then((r) => r.json())
        .then((data) => setConfig(data || {}))
        .catch(() => {});
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleChange = (field, value) => {
    setConfig((prev) => ({ ...prev, [field]: value }));
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setIsSaving(true);
    setSaveSuccess(false);

    try {
      const res = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config)
      });
      const data = await res.json();
      if (data.success) {
        setSaveSuccess(true);
        setTimeout(() => setSaveSuccess(false), 2500);
      }
    } catch (e) {
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="modal-overlay">
      <div className="modal-dialog">
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--border-subtle)', paddingBottom: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 34, height: 34, borderRadius: 10, background: 'rgba(6,182,212,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Sliders style={{ width: 18, height: 18, color: 'var(--cyan)' }} />
            </div>
            <div>
              <h3 style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-main)' }}>System & AI Configuration</h3>
              <p style={{ fontSize: 11, color: 'var(--text-muted)' }}>Gemini Intelligence & CCTV Notifications</p>
            </div>
          </div>
          <button 
            onClick={onClose}
            style={{ background: 'transparent', color: 'var(--text-muted)', padding: 6, borderRadius: 6 }}
          >
            <X style={{ width: 18, height: 18 }} />
          </button>
        </div>

        <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* Gemini AI Key */}
          <div style={{ padding: 12, borderRadius: 10, background: 'var(--bg-pill)', border: '1px solid var(--border-cyan)', display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--cyan)', fontWeight: 600 }}>
              <Key style={{ width: 15, height: 15 }} />
              <span>Google Gemini AI API Key</span>
            </div>
            <p style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              Used by AI Guard Chatbot to analyze live feed & recordings.
            </p>
            <input
              type="password"
              value={config.gemini_api_key || ''}
              onChange={(e) => handleChange('gemini_api_key', e.target.value)}
              placeholder="AIzaSy..."
              className="form-input"
              style={{ fontFamily: 'monospace' }}
            />
          </div>

          {/* Telegram Alerts */}
          <div style={{ padding: 12, borderRadius: 10, background: 'var(--bg-pill)', border: '1px solid var(--border-subtle)', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--text-main)', fontWeight: 600 }}>
                <Send style={{ width: 15, height: 15, color: 'var(--cyan)' }} />
                <span>Telegram Alerts</span>
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 11, color: 'var(--text-muted)' }}>
                <input
                  type="checkbox"
                  checked={config.telegram_enabled || false}
                  onChange={(e) => handleChange('telegram_enabled', e.target.checked)}
                />
                <span>Enable</span>
              </label>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <input
                type="text"
                value={config.telegram_token || ''}
                onChange={(e) => handleChange('telegram_token', e.target.value)}
                placeholder="Bot Token"
                className="form-input"
              />
              <input
                type="text"
                value={config.telegram_chat_id || ''}
                onChange={(e) => handleChange('telegram_chat_id', e.target.value)}
                placeholder="Chat ID"
                className="form-input"
              />
            </div>
          </div>

          {/* Webhooks */}
          <div style={{ padding: 12, borderRadius: 10, background: 'var(--bg-pill)', border: '1px solid var(--border-subtle)', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--text-main)', fontWeight: 600 }}>
              <Bell style={{ width: 15, height: 15, color: 'var(--indigo)' }} />
              <span>Webhooks (Discord & Slack)</span>
            </div>
            <input
              type="text"
              value={config.discord_webhook_url || ''}
              onChange={(e) => handleChange('discord_webhook_url', e.target.value)}
              placeholder="Discord Webhook URL"
              className="form-input"
            />
            <input
              type="text"
              value={config.slack_webhook_url || ''}
              onChange={(e) => handleChange('slack_webhook_url', e.target.value)}
              placeholder="Slack Webhook URL"
              className="form-input"
            />
          </div>

          {/* Sliders */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <div style={{ padding: 10, borderRadius: 8, background: 'var(--bg-pill)', border: '1px solid var(--border-subtle)' }}>
              <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>
                Confidence: {Math.round((config.confidence || 0.5) * 100)}%
              </label>
              <input
                type="range"
                min="0.2"
                max="0.85"
                step="0.05"
                value={config.confidence || 0.5}
                onChange={(e) => handleChange('confidence', parseFloat(e.target.value))}
                style={{ width: '100%' }}
              />
            </div>

            <div style={{ padding: 10, borderRadius: 8, background: 'var(--bg-pill)', border: '1px solid var(--border-subtle)' }}>
              <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>
                Privacy Blur Style
              </label>
              <select
                value={config.privacy_style || 'blur'}
                onChange={(e) => handleChange('privacy_style', e.target.value)}
                className="form-input"
              >
                <option value="blur">Gaussian Blur</option>
                <option value="silhouette">Silhouette</option>
                <option value="depth">Depth ColorMap</option>
              </select>
            </div>
          </div>

          {/* Save Button */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: 6 }}>
            {saveSuccess ? (
              <span style={{ color: 'var(--emerald)', fontSize: 11, display: 'flex', alignItems: 'center', gap: 6 }}>
                <Check style={{ width: 14, height: 14 }} /> Saved!
              </span>
            ) : <span />}

            <div style={{ display: 'flex', gap: 8 }}>
              <button
                type="button"
                onClick={onClose}
                style={{ padding: '8px 14px', borderRadius: 8, background: 'var(--bg-pill)', color: 'var(--text-muted)', border: '1px solid var(--border-subtle)' }}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSaving}
                style={{ padding: '8px 18px', borderRadius: 8, background: 'linear-gradient(135deg, #06b6d4, #0891b2)', color: '#ffffff', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}
              >
                <Save style={{ width: 14, height: 14 }} />
                <span>{isSaving ? 'Saving...' : 'Save Settings'}</span>
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
