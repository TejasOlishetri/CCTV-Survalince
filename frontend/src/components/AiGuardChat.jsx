import React, { useState, useEffect, useRef } from 'react';
import { 
  Bot, 
  Send, 
  Sparkles, 
  Film, 
  Camera, 
  ShieldCheck 
} from 'lucide-react';

export default function AiGuardChat({ recordings }) {
  const [target, setTarget] = useState('live');
  const [messages, setMessages] = useState([
    {
      id: 1,
      sender: 'bot',
      text: "👋 **Hello! I am your DeepCamera AI Security Guard Assistant.**\n\nI monitor the live CCTV feed and recorded footage using Gemini AI. Ask me what is happening, who is sitting at the PC, or select a recorded video above to investigate past events!",
      photoUrl: null,
      ts: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    }
  ]);
  const [input, setInput] = useState('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const messagesEndRef = useRef(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isAnalyzing]);

  const handleTargetChange = (newTarget) => {
    setTarget(newTarget);
    const ts = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    if (newTarget === 'live') {
      setMessages((prev) => [
        ...prev,
        {
          id: Date.now(),
          sender: 'bot',
          text: "📡 **Switched to Live CCTV Stream.**\nAsk me about what is happening right now, workstation ergonomics, or occupancy.",
          ts
        }
      ]);
    } else {
      setMessages((prev) => [
        ...prev,
        {
          id: Date.now(),
          sender: 'bot',
          text: `📼 **Selected Recording: \`${newTarget}.mp4\`**\nForensic Gemini investigator ready. Ask:\n• *"Did anyone fall in this video?"*\n• *"Was the missing person spotted?"*\n• *"Summary of all events in this recording"*`,
          ts
        }
      ]);
    }
  };

  const handleSend = async (textToSend) => {
    const msg = (textToSend || input).trim();
    if (!msg || isAnalyzing) return;

    const userTs = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const userMsgObj = {
      id: Date.now(),
      sender: 'user',
      text: msg,
      ts: userTs
    };

    setMessages((prev) => [...prev, userMsgObj]);
    setInput('');
    setIsAnalyzing(true);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: msg, video_id: target })
      });
      const data = await res.json();
      const botTs = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

      setMessages((prev) => [
        ...prev,
        {
          id: Date.now() + 1,
          sender: 'bot',
          text: data.reply || 'No response received from AI Guard.',
          photoUrl: data.photo_url || null,
          ts: botTs
        }
      ]);
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          id: Date.now() + 1,
          sender: 'bot',
          text: '❌ Network error communicating with DeepCamera backend.',
          ts: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        }
      ]);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const liveChips = [
    "What is happening right now?",
    "Is someone sitting at PC?",
    "Who is in the room?",
    "Safety check",
    "Photo snapshot"
  ];

  const recordingChips = [
    "Did anyone fall in this video?",
    "Was the missing person seen?",
    "What happened in this video?",
    "Were any strangers detected?"
  ];

  const activeChips = target === 'live' ? liveChips : recordingChips;

  const renderFormattedText = (text) => {
    if (!text) return null;
    const parts = text.split('\n');
    return parts.map((line, idx) => {
      let formatted = line
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.*?)\*/g, '<em>$1</em>')
        .replace(/`([^`]+)`/g, '<code style="background:var(--bg-pill);padding:2px 6px;border-radius:4px;color:var(--cyan);font-family:monospace;border:1px solid var(--border-subtle);">$1</code>');
      return (
        <span 
          key={idx} 
          dangerouslySetInnerHTML={{ __html: formatted }} 
          style={{ display: 'block', minHeight: '1.2em' }}
        />
      );
    });
  };

  return (
    <div className="chat-card">
      {/* Chat Header */}
      <div className="chat-card-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div style={{ width: 26, height: 26, borderRadius: 8, background: 'rgba(6,182,212,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Sparkles style={{ width: 15, height: 15, color: '#22d3ee' }} />
          </div>
          <span style={{ fontWeight: 700, fontSize: 12, letterSpacing: '0.5px', textTransform: 'uppercase' }}>
            AI Guard Chatbot
          </span>
        </div>

        {/* Video Target Select */}
        <div className="chat-target-select">
          <Film style={{ width: 14, height: 14, color: '#22d3ee' }} />
          <select
            value={target}
            onChange={(e) => handleTargetChange(e.target.value)}
          >
            <option value="live">Live CCTV Camera</option>
            {recordings?.map((rec) => (
              <option key={rec} value={rec}>
                📼 {rec}.mp4
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Quick Prompt Chips */}
      <div className="chat-chips-tray">
        {activeChips.map((chip, idx) => (
          <button
            key={idx}
            onClick={() => handleSend(chip)}
            className="chat-chip"
          >
            {chip}
          </button>
        ))}
      </div>

      {/* Chat Messages */}
      <div className="chat-body">
        {messages.map((m) => (
          <div
            key={m.id}
            className={`chat-msg-wrapper ${m.sender}`}
          >
            <div className={`chat-bubble ${m.sender}`}>
              <div>{renderFormattedText(m.text)}</div>
              {m.photoUrl && (
                <div 
                  style={{ marginTop: 8, borderRadius: 8, overflow: 'hidden', border: '1px solid var(--border-medium)', cursor: 'pointer' }}
                  onClick={() => window.open(m.photoUrl, '_blank')}
                >
                  <img src={m.photoUrl} alt="CCTV Snapshot" style={{ maxHeight: 180, width: '100%', objectFit: 'cover' }} />
                  <span style={{ display: 'block', fontSize: 10, textAlign: 'center', background: 'rgba(0,0,0,0.5)', padding: '3px 0', color: '#22d3ee' }}>
                    Click to view full photo
                  </span>
                </div>
              )}
            </div>
            <span className="chat-ts">{m.ts}</span>
          </div>
        ))}

        {isAnalyzing && (
          <div className="chat-thinking">
            <Sparkles style={{ width: 14, height: 14 }} />
            <span>⚡ Gemini AI is analyzing {target === 'live' ? 'live camera feed' : 'recorded footage'}...</span>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input Bar */}
      <form 
        onSubmit={(e) => { e.preventDefault(); handleSend(); }}
        className="chat-input-form"
      >
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={target === 'live' ? "Ask AI Guard about live CCTV feed..." : "Ask questions about this recording..."}
          className="chat-input-box"
        />
        <button
          type="submit"
          disabled={!input.trim() || isAnalyzing}
          className="chat-send-action"
        >
          <Send style={{ width: 15, height: 15 }} />
        </button>
      </form>
    </div>
  );
}
