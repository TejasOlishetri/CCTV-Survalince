document.addEventListener('DOMContentLoaded', () => {

    // ==============================
    // Audio Siren
    // ==============================
    let audioCtx = null;
    let sirenPlaying = false;
    let sirenInterval = null;
    let alarmMuted = true;

    function playBuzzerTone(freq, dur) {
        if (alarmMuted) return;
        try {
            if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            if (audioCtx.state === 'suspended') audioCtx.resume();
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            osc.type = 'sawtooth';
            osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
            gain.gain.setValueAtTime(0.08, audioCtx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + dur);
            osc.connect(gain);
            gain.connect(audioCtx.destination);
            osc.start();
            osc.stop(audioCtx.currentTime + dur);
        } catch (e) {}
    }

    function triggerEmergencyAlarm() {
        if (sirenPlaying || alarmMuted) return;
        sirenPlaying = true;
        let toggle = false;
        playBuzzerTone(880, 0.25);
        sirenInterval = setInterval(() => {
            playBuzzerTone(toggle ? 980 : 750, 0.25);
            toggle = !toggle;
        }, 320);
        setTimeout(() => { clearInterval(sirenInterval); sirenPlaying = false; }, 2200);
    }

    // Alarm toggle
    const btnAudioAlarm = document.getElementById('btn-audio-alarm');
    const audioAlarmLabel = document.getElementById('audio-alarm-label');
    if (btnAudioAlarm) {
        btnAudioAlarm.addEventListener('click', () => {
            alarmMuted = !alarmMuted;
            if (audioAlarmLabel) audioAlarmLabel.textContent = alarmMuted ? 'Muted' : 'Siren';
        });
    }

    // ==============================
    // DOM References
    // ==============================
    const fpsVal = document.getElementById('fps-val');
    const latencyVal = document.getElementById('latency-val');
    const intruderVal = document.getElementById('intruder-val');
    const currentSourceLabel = document.getElementById('current-source-label');
    const hudModeBadge = document.getElementById('hud-mode-badge');
    const hudClock = document.getElementById('hud-clock');
    const emergencyBanner = document.getElementById('emergency-banner');
    const missingBanner = document.getElementById('missing-banner');
    const missingBannerDetail = document.getElementById('missing-banner-detail');

    const parkingSummaryBar = document.getElementById('parking-summary-bar');
    const parkingMetricVal = document.getElementById('parking-metric-val');
    const parkingSlotsGrid = document.getElementById('parking-slots-grid');

    // ==============================
    // Sidebar Tab System
    // ==============================
    const sidebarTabs = document.querySelectorAll('.sidebar-tab');
    const panels = document.querySelectorAll('.panel');

    function activateSidebarTab(panelId) {
        sidebarTabs.forEach(t => t.classList.toggle('active', t.dataset.target === panelId));
        panels.forEach(p => p.classList.toggle('active', p.id === panelId));
    }

    sidebarTabs.forEach(tab => {
        tab.addEventListener('click', () => activateSidebarTab(tab.dataset.target));
    });

    // ==============================
    // Mode Tabs
    // ==============================
    const modeButtons = document.querySelectorAll('.mode-tab');
    modeButtons.forEach(btn => {
        btn.addEventListener('click', async () => {
            const mode = btn.dataset.mode;
            modeButtons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            const labels = {
                surveillance: 'Surveillance',
                fall_detection: 'Fall Guard',
                parking: 'Parking',
                privacy: 'Privacy'
            };
            hudModeBadge.textContent = labels[mode] || mode;

            if (mode === 'privacy') activateSidebarTab('panel-privacy');
            else if (mode === 'surveillance') activateSidebarTab('panel-camera');
            else if (mode === 'fall_detection') activateSidebarTab('panel-timeline');

            parkingSummaryBar.style.display = mode === 'parking' ? 'flex' : 'none';

            await fetch('/api/set_mode', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ mode })
            });
            document.getElementById('live-feed').src = `/video_feed?t=${Date.now()}`;
        });
    });

    // ==============================
    // Privacy Controls
    // ==============================
    document.querySelectorAll('input[name="privacy-style"]').forEach(r => {
        r.addEventListener('change', async () => {
            await fetch('/api/config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ privacy_style: r.value, active_mode: 'privacy', privacy_blur: true })
            });
            document.getElementById('live-feed').src = `/video_feed?t=${Date.now()}`;
        });
    });

    const btnActivatePrivacy = document.getElementById('btn-activate-privacy');
    if (btnActivatePrivacy) {
        btnActivatePrivacy.addEventListener('click', async () => {
            const style = document.querySelector('input[name="privacy-style"]:checked')?.value || 'depth';
            await fetch('/api/config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ privacy_style: style, active_mode: 'privacy', privacy_blur: true })
            });
            modeButtons.forEach(b => b.classList.toggle('active', b.dataset.mode === 'privacy'));
            hudModeBadge.textContent = 'Privacy';
            document.getElementById('live-feed').src = `/video_feed?t=${Date.now()}`;
        });
    }

    const toggleClearTelegram = document.getElementById('toggle-clear-telegram');
    if (toggleClearTelegram) {
        toggleClearTelegram.addEventListener('change', async () => {
            await fetch('/api/config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ telegram_clear_evidence: toggleClearTelegram.checked })
            });
        });
    }

    // ==============================
    // Clock HUD
    // ==============================
    setInterval(() => {
        const now = new Date();
        hudClock.textContent = now.toTimeString().split(' ')[0];
    }, 1000);

    // ==============================
    // Source Switcher
    // ==============================
    const sourceTypeSelect = document.getElementById('source-type-select');
    const customUrlGroup = document.getElementById('custom-url-group');
    const customSourceInput = document.getElementById('custom-source-input');
    const btnApplySource = document.getElementById('btn-apply-source');

    sourceTypeSelect.addEventListener('change', () => {
        const v = sourceTypeSelect.value;
        customUrlGroup.style.display = (v === 'rtsp' || v === 'http') ? 'block' : 'none';
    });

    btnApplySource.addEventListener('click', async () => {
        let chosen = sourceTypeSelect.value;
        if (chosen === 'rtsp' || chosen === 'http') {
            chosen = customSourceInput.value.trim();
            if (!chosen) { alert('Enter a valid URL'); return; }
        }
        btnApplySource.disabled = true;
        btnApplySource.textContent = 'Connecting...';
        try {
            const res = await fetch('/api/set_source', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ source: chosen })
            });
            const data = await res.json();
            if (data.success) {
                currentSourceLabel.textContent = data.source;
                document.getElementById('live-feed').src = `/video_feed?t=${Date.now()}`;
            }
        } catch (e) { console.error(e); }
        finally { btnApplySource.disabled = false; btnApplySource.textContent = 'Connect'; }
    });

    const btnResetWebcam = document.getElementById('btn-reset-webcam');
    if (btnResetWebcam) {
        btnResetWebcam.addEventListener('click', async () => {
            sourceTypeSelect.value = '0';
            customUrlGroup.style.display = 'none';
            try {
                const res = await fetch('/api/set_source', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ source: 0 })
                });
                const data = await res.json();
                if (data.success) {
                    currentSourceLabel.textContent = 'Webcam (0)';
                    document.getElementById('live-feed').src = `/video_feed?t=${Date.now()}`;
                }
            } catch (e) { console.error(e); }
        });
    }

    // Confidence Slider
    const confSlider = document.getElementById('conf-slider');
    const confValLabel = document.getElementById('conf-val-label');
    confSlider.addEventListener('input', () => confValLabel.textContent = `${Math.round(confSlider.value * 100)}%`);
    confSlider.addEventListener('change', async () => {
        await fetch('/api/config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ confidence: parseFloat(confSlider.value) })
        });
    });

    // Target Class Chips
    document.querySelectorAll('.chip').forEach(chip => {
        chip.addEventListener('click', async () => {
            chip.classList.toggle('active');
            const active = Array.from(document.querySelectorAll('.chip.active')).map(c => c.dataset.class);
            await fetch('/api/config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ selected_classes: active })
            });
        });
    });

    // ==============================
    // Face ID
    // ==============================
    const enrollNameInput = document.getElementById('enroll-name-input');
    const btnEnrollFace = document.getElementById('btn-enroll-face');
    const enrolledFacesList = document.getElementById('enrolled-faces-list');
    const facesCount = document.getElementById('faces-count');

    async function loadFaces() {
        try {
            const res = await fetch('/api/faces');
            const data = await res.json();
            const names = Object.keys(data);
            facesCount.textContent = names.length;

            if (names.length === 0) {
                enrolledFacesList.innerHTML = '<span class="empty-msg">No faces enrolled yet</span>';
                return;
            }

            enrolledFacesList.innerHTML = '';
            names.forEach(name => {
                const info = data[name];
                const item = document.createElement('div');
                item.className = 'face-item';
                item.innerHTML = `
                    <div class="face-item-info">
                        <img src="/enrolled_faces/${info.filename}" class="face-avatar" alt="${name}">
                        <div>
                            <span class="face-name">${name}</span>
                            <small style="font-size:10px;color:var(--text-3)">${info.enrolled_at || ''}</small>
                        </div>
                    </div>
                    <button class="btn-del" data-name="${name}">Remove</button>
                `;
                item.querySelector('.btn-del').addEventListener('click', async () => {
                    if (confirm(`Remove '${name}'?`)) {
                        await fetch('/api/delete_face', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ name })
                        });
                        loadFaces();
                    }
                });
                enrolledFacesList.appendChild(item);
            });
        } catch (e) { console.error(e); }
    }
    loadFaces();

    btnEnrollFace.addEventListener('click', async () => {
        const name = enrollNameInput.value.trim();
        if (!name) { alert('Enter a name'); enrollNameInput.focus(); return; }
        btnEnrollFace.disabled = true;
        btnEnrollFace.textContent = 'Enrolling...';
        try {
            const res = await fetch('/api/enroll_face', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name })
            });
            const data = await res.json();
            if (data.success) {
                alert(`Face for '${name}' enrolled!`);
                enrollNameInput.value = '';
                loadFaces();
            } else {
                alert(`Failed: ${data.error || data.message}`);
            }
        } catch (e) { alert(`Error: ${e.message}`); }
        finally { btnEnrollFace.disabled = false; btnEnrollFace.textContent = 'Enroll From Camera'; }
    });

    // ==============================
    // Missing Person Finder
    // ==============================
    const missingForm = document.getElementById('missing-person-form');
    const uploadZone = document.getElementById('upload-zone');
    const missingPhotoInput = document.getElementById('missing-photo');
    const uploadPlaceholder = document.getElementById('upload-placeholder');
    const uploadPreview = document.getElementById('upload-preview');
    const missingPersonsList = document.getElementById('missing-persons-list');
    const missingCount = document.getElementById('missing-count');
    const matchesList = document.getElementById('matches-list');
    const matchesSection = document.getElementById('matches-section');

    // Photo upload handling
    uploadZone.addEventListener('click', () => missingPhotoInput.click());
    uploadZone.addEventListener('dragover', (e) => { e.preventDefault(); uploadZone.classList.add('has-file'); });
    uploadZone.addEventListener('dragleave', () => { if (!missingPhotoInput.files.length) uploadZone.classList.remove('has-file'); });
    uploadZone.addEventListener('drop', (e) => {
        e.preventDefault();
        if (e.dataTransfer.files.length) {
            missingPhotoInput.files = e.dataTransfer.files;
            showPhotoPreview(e.dataTransfer.files[0]);
        }
    });

    missingPhotoInput.addEventListener('change', () => {
        if (missingPhotoInput.files.length) showPhotoPreview(missingPhotoInput.files[0]);
    });

    function showPhotoPreview(file) {
        const reader = new FileReader();
        reader.onload = (e) => {
            uploadPreview.src = e.target.result;
            uploadPreview.style.display = 'block';
            uploadPlaceholder.style.display = 'none';
            uploadZone.classList.add('has-file');
        };
        reader.readAsDataURL(file);
    }

    // Submit missing person
    missingForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = document.getElementById('missing-name').value.trim();
        const photo = missingPhotoInput.files[0];
        if (!name) { alert('Enter the person\'s name'); return; }
        if (!photo) { alert('Upload a photo'); return; }

        const formData = new FormData();
        formData.append('photo', photo);
        formData.append('name', name);
        formData.append('description', document.getElementById('missing-desc').value.trim());
        formData.append('contact', document.getElementById('missing-contact').value.trim());
        formData.append('last_seen', document.getElementById('missing-lastseen').value.trim());

        const btn = document.getElementById('btn-report-missing');
        btn.disabled = true;
        btn.textContent = 'Registering...';

        try {
            const res = await fetch('/api/add_missing_person', { method: 'POST', body: formData });
            const data = await res.json();
            if (data.success) {
                alert(`${name} registered! CCTV scanning activated.`);
                missingForm.reset();
                uploadPreview.style.display = 'none';
                uploadPlaceholder.style.display = 'flex';
                uploadZone.classList.remove('has-file');
                loadMissingPersons();
            } else {
                alert(`Failed: ${data.error || data.message}`);
            }
        } catch (e) { alert(`Error: ${e.message}`); }
        finally { btn.disabled = false; btn.textContent = 'Start CCTV Search'; }
    });

    async function loadMissingPersons() {
        try {
            const res = await fetch('/api/missing_persons');
            const data = await res.json();
            const names = Object.keys(data);
            missingCount.textContent = names.length;

            if (names.length === 0) {
                missingPersonsList.innerHTML = '<span class="empty-msg">No active searches</span>';
                return;
            }

            missingPersonsList.innerHTML = '';
            names.forEach(name => {
                const info = data[name];
                const item = document.createElement('div');
                item.className = 'missing-item';
                item.innerHTML = `
                    <div class="missing-item-info">
                        <img src="/missing_persons/${info.filename}" class="missing-item-photo" alt="${name}">
                        <div class="missing-item-details">
                            <div class="missing-item-name">${name}</div>
                            <div class="missing-item-meta">${info.description || info.last_seen || info.reported_at}</div>
                        </div>
                    </div>
                    <span class="missing-status ${info.status || 'searching'}">${(info.status || 'searching').toUpperCase()}</span>
                    <button class="btn-del" data-name="${name}" title="Remove">✕</button>
                `;
                item.querySelector('.btn-del').addEventListener('click', async () => {
                    if (confirm(`Remove missing person '${name}'?`)) {
                        await fetch('/api/delete_missing_person', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ name })
                        });
                        loadMissingPersons();
                    }
                });
                missingPersonsList.appendChild(item);
            });
        } catch (e) { console.error(e); }
    }
    loadMissingPersons();

    // ==============================
    // Alerts Configuration
    // ==============================
    const toggleTelegram = document.getElementById('toggle-telegram');
    const telegramTokenInput = document.getElementById('telegram-token-input');
    const telegramChatInput = document.getElementById('telegram-chat-input');

    async function loadConfig() {
        try {
            const res = await fetch('/api/config');
            const cfg = await res.json();
            if (toggleTelegram) toggleTelegram.checked = cfg.telegram_enabled || false;
            if (telegramTokenInput) telegramTokenInput.value = cfg.telegram_token || '';
            if (telegramChatInput) telegramChatInput.value = cfg.telegram_chat_id || '';

            const toggleDiscord = document.getElementById('toggle-discord');
            const discordWebhookInput = document.getElementById('discord-webhook-input');
            if (toggleDiscord) toggleDiscord.checked = cfg.discord_enabled || false;
            if (discordWebhookInput) discordWebhookInput.value = cfg.discord_webhook_url || '';

            const toggleSlack = document.getElementById('toggle-slack');
            const slackWebhookInput = document.getElementById('slack-webhook-input');
            if (toggleSlack) toggleSlack.checked = cfg.slack_enabled || false;
            if (slackWebhookInput) slackWebhookInput.value = cfg.slack_webhook_url || '';

            const toggleHa = document.getElementById('toggle-ha');
            const haWebhookInput = document.getElementById('ha-webhook-input');
            if (toggleHa) toggleHa.checked = cfg.ha_enabled || false;
            if (haWebhookInput) haWebhookInput.value = cfg.ha_webhook_url || '';

            const geminiApiInput = document.getElementById('gemini-api-input');
            if (geminiApiInput) geminiApiInput.value = cfg.gemini_api_key || '';
        } catch (e) {}
    }
    loadConfig();

    // Auto-detect chat ID
    const btnDetectChatId = document.getElementById('btn-detect-chat-id');
    if (btnDetectChatId) {
        btnDetectChatId.addEventListener('click', async () => {
            btnDetectChatId.disabled = true;
            btnDetectChatId.textContent = 'Checking...';
            try {
                const tokenVal = telegramTokenInput.value.trim();
                if (tokenVal) {
                    await fetch('/api/config', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ telegram_token: tokenVal })
                    });
                }
                const res = await fetch('/api/detect_telegram_chat_id', { method: 'POST' });
                const data = await res.json();
                if (data.success && data.chat_id) {
                    telegramChatInput.value = data.chat_id;
                    alert(`Found Chat ID: ${data.chat_id}`);
                } else {
                    alert(data.error || 'Could not detect. Send a message to the bot first.');
                }
            } catch (e) { alert('Error: ' + e.message); }
            finally { btnDetectChatId.disabled = false; btnDetectChatId.textContent = 'Auto-Detect'; }
        });
    }

    // Save/test handlers for all channels
    function setupAlertChannel(saveId, testId, getPayload) {
        const saveBtn = document.getElementById(saveId);
        const testBtn = document.getElementById(testId);
        if (saveBtn) {
            saveBtn.addEventListener('click', async () => {
                await fetch('/api/config', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(getPayload())
                });
                alert('Settings saved!');
            });
        }
        if (testBtn) {
            testBtn.addEventListener('click', async () => {
                testBtn.disabled = true;
                testBtn.textContent = 'Testing...';
                try {
                    const endpoint = testId.includes('telegram') ? '/api/test_telegram' :
                                     testId.includes('discord') ? '/api/test_discord' : '/api/test_slack';
                    const body = testId.includes('telegram')
                        ? { token: telegramTokenInput.value.trim(), chat_id: telegramChatInput.value.trim() }
                        : { url: (document.getElementById(testId.replace('btn-test-', '') + '-webhook-input') || {}).value?.trim() };
                    const res = await fetch(endpoint, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(body)
                    });
                    const data = await res.json();
                    alert(data.success ? 'Test sent!' : `Failed: ${data.error}`);
                } catch (e) { alert('Error: ' + e.message); }
                finally { testBtn.disabled = false; testBtn.textContent = 'Test'; }
            });
        }
    }

    setupAlertChannel('btn-save-telegram', 'btn-test-telegram', () => ({
        telegram_enabled: toggleTelegram.checked,
        telegram_token: telegramTokenInput.value.trim(),
        telegram_chat_id: telegramChatInput.value.trim()
    }));

    setupAlertChannel('btn-save-discord', 'btn-test-discord', () => ({
        discord_enabled: document.getElementById('toggle-discord').checked,
        discord_webhook_url: document.getElementById('discord-webhook-input').value.trim()
    }));

    setupAlertChannel('btn-save-slack', 'btn-test-slack', () => ({
        slack_enabled: document.getElementById('toggle-slack').checked,
        slack_webhook_url: document.getElementById('slack-webhook-input').value.trim()
    }));

    const btnSaveHa = document.getElementById('btn-save-ha');
    if (btnSaveHa) {
        btnSaveHa.addEventListener('click', async () => {
            await fetch('/api/config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    ha_enabled: document.getElementById('toggle-ha').checked,
                    ha_webhook_url: document.getElementById('ha-webhook-input').value.trim()
                })
            });
            alert('Home Assistant saved!');
        });
    }

    const btnSaveGemini = document.getElementById('btn-save-gemini');
    if (btnSaveGemini) {
        btnSaveGemini.addEventListener('click', async () => {
            await fetch('/api/config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    gemini_api_key: document.getElementById('gemini-api-input').value.trim()
                })
            });
            alert('Gemini API Key saved!');
        });
    }

    // Channel pill switcher
    const channelTabs = document.querySelectorAll('.channel-tab');
    const channelPanes = {
        tg: document.getElementById('pane-channel-tg'),
        dc: document.getElementById('pane-channel-dc'),
        sl: document.getElementById('pane-channel-sl'),
        ha: document.getElementById('pane-channel-ha'),
        gemini: document.getElementById('pane-channel-gemini')
    };
    channelTabs.forEach(tab => {
        tab.addEventListener('click', () => {
            channelTabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            const target = tab.dataset.channel;
            Object.keys(channelPanes).forEach(k => {
                if (channelPanes[k]) channelPanes[k].style.display = k === target ? 'flex' : 'none';
                if (channelPanes[k] && k === target) channelPanes[k].classList.add('active');
                else if (channelPanes[k]) channelPanes[k].classList.remove('active');
            });
        });
    });

    // ==============================
    // Recordings & Snapshots
    // ==============================
    const btnSnapshot = document.getElementById('btn-snapshot');
    const snapshotTray = document.getElementById('snapshot-tray');
    
    const btnRecord = document.getElementById('btn-record');
    const recordLabel = document.getElementById('record-label');
    const chatVideoTarget = document.getElementById('chat-video-target');

    async function loadRecordings() {
        if (!chatVideoTarget) return;
        const currentVal = chatVideoTarget.value;
        try {
            const res = await fetch('/api/recordings_list');
            const files = await res.json();
            
            chatVideoTarget.innerHTML = '<option value="live">Live CCTV Feed</option>';
            files.forEach(f => {
                const opt = document.createElement('option');
                opt.value = f;
                opt.textContent = `📼 Recording: ${f}.mp4`;
                chatVideoTarget.appendChild(opt);
            });
            if (currentVal && Array.from(chatVideoTarget.options).some(o => o.value === currentVal)) {
                chatVideoTarget.value = currentVal;
            }
        } catch (e) {}
    }
    loadRecordings();

    if (chatVideoTarget) {
        chatVideoTarget.addEventListener('change', () => {
            const val = chatVideoTarget.value;
            if (val === 'live') {
                appendMsg('bot', '📡 **Switched to Live Camera Stream**.\nAsk me about what is happening, who is at the PC, or request snapshots.');
            } else {
                appendMsg('bot', `📼 **Selected Recording: \`${val}.mp4\`**.\nForensic Gemini investigator ready. Ask:\n• *"Did anyone fall in this video?"*\n• *"Was the missing person seen?"*\n• *"What happened during this recording?"*`);
            }
        });
    }

    if (btnRecord) {
        btnRecord.addEventListener('click', async () => {
            btnRecord.disabled = true;
            try {
                const res = await fetch('/api/recording/toggle', { method: 'POST' });
                const data = await res.json();
                if (data.success) {
                    if (data.recording) {
                        btnRecord.style.background = 'rgba(239,68,68,0.1)';
                        btnRecord.style.borderColor = 'rgba(239,68,68,0.3)';
                        recordLabel.textContent = 'STOP';
                    } else {
                        btnRecord.style.background = '';
                        btnRecord.style.borderColor = '';
                        recordLabel.textContent = 'REC';
                        loadRecordings();
                    }
                }
            } catch(e) {}
            finally { btnRecord.disabled = false; }
        });
    }

    async function loadSnapshots() {
        try {
            const res = await fetch('/api/snapshots_list');
            const files = await res.json();
            if (files && files.length > 0) {
                snapshotTray.innerHTML = '';
                files.forEach(f => {
                    const img = document.createElement('img');
                    img.src = `/snapshots/${f}`;
                    img.className = 'snapshot-thumb';
                    img.title = f;
                    img.addEventListener('click', () => window.open(`/snapshots/${f}`, '_blank'));
                    snapshotTray.appendChild(img);
                });
            }
        } catch (e) {}
    }
    loadSnapshots();

    btnSnapshot.addEventListener('click', async () => {
        btnSnapshot.disabled = true;
        try {
            const res = await fetch('/api/snapshot', { method: 'POST' });
            const data = await res.json();
            if (data.success) loadSnapshots();
        } catch (e) { console.error(e); }
        finally { btnSnapshot.disabled = false; }
    });

    // Fullscreen
    const btnFullscreen = document.getElementById('btn-fullscreen');
    btnFullscreen.addEventListener('click', () => {
        const wrap = document.getElementById('video-wrapper');
        if (!document.fullscreenElement) wrap.requestFullscreen().catch(() => {});
        else document.exitFullscreen();
    });

    // ==============================
    // Status Polling
    // ==============================
    const eventStream = document.getElementById('event-stream');

    async function pollStatus() {
        try {
            const res = await fetch('/api/status');
            if (!res.ok) return;
            const data = await res.json();

            fpsVal.textContent = data.fps.toFixed(1);
            latencyVal.textContent = data.latency_ms;
            intruderVal.textContent = data.intruders_count;

            // Emergency fall
            emergencyBanner.style.display = data.fall_detected ? 'flex' : 'none';
            if (data.fall_detected) triggerEmergencyAlarm();

            // Missing person found
            if (data.missing_person_found && data.missing_person_matches && data.missing_person_matches.length > 0) {
                missingBanner.style.display = 'flex';
                const match = data.missing_person_matches[0];
                missingBannerDetail.textContent = `${match.name} — ${match.confidence}% match`;
                triggerEmergencyAlarm();
            } else {
                missingBanner.style.display = 'none';
            }

            // Show matches in sidebar
            if (data.missing_person_matches && data.missing_person_matches.length > 0) {
                matchesSection.style.display = 'block';
                matchesList.innerHTML = '';
                data.missing_person_matches.forEach(m => {
                    const el = document.createElement('div');
                    el.className = 'match-item';
                    el.innerHTML = `
                        <div class="match-info"><strong>${m.name}</strong> — ${m.confidence}% match</div>
                        <span class="match-time">${m.time}</span>
                    `;
                    matchesList.appendChild(el);
                });
            }

            // Siren for intruders
            if (data.intruders_count > 0 && data.active_mode === 'surveillance') {
                triggerEmergencyAlarm();
            }

            // Parking
            if (data.parking && data.active_mode === 'parking') {
                parkingMetricVal.textContent = `${data.parking.occupied} / ${data.parking.total}`;
                if (data.parking.slots && data.parking.slots.length > 0) {
                    parkingSlotsGrid.innerHTML = '';
                    data.parking.slots.forEach(s => {
                        const badge = document.createElement('div');
                        badge.className = `slot-badge ${s.occupied ? 'occupied' : 'vacant'}`;
                        badge.textContent = `${s.name}: ${s.occupied ? s.type : 'Free'}`;
                        parkingSlotsGrid.appendChild(badge);
                    });
                }
            }

            // Status handling (optional logic for recording state if needed)
            if (data.is_recording) {
                if (recordLabel && recordLabel.textContent !== 'STOP') {
                    btnRecord.style.background = 'rgba(239,68,68,0.1)';
                    btnRecord.style.borderColor = 'rgba(239,68,68,0.3)';
                    recordLabel.textContent = 'STOP';
                }
            } else {
                if (recordLabel && recordLabel.textContent === 'STOP') {
                    btnRecord.style.background = '';
                    btnRecord.style.borderColor = '';
                    recordLabel.textContent = 'REC';
                }
            }

            // Event Timeline
            if (data.recent_events && data.recent_events.length > 0) {
                eventStream.innerHTML = '';
                data.recent_events.forEach(ev => {
                    const el = document.createElement('div');
                    el.className = `event-item ${ev.category || 'person'}`;
                    el.innerHTML = `
                        <div>
                            <strong>${ev.title}</strong>
                            <div style="font-size:11px;color:var(--text-3)">${ev.msg}</div>
                        </div>
                        <span class="event-time">${ev.time}</span>
                    `;
                    eventStream.appendChild(el);
                });
            }
        } catch (e) {}
    }
    setInterval(pollStatus, 600);

    // ==============================
    // AI Guard Chat
    // ==============================
    const chatForm = document.getElementById('chat-form');
    const chatInput = document.getElementById('chat-input');
    const chatMessages = document.getElementById('chat-messages');
    const chatChips = document.querySelectorAll('.chat-chip');

    function appendMsg(sender, text, photoUrl = null) {
        if (!chatMessages) return;
        const div = document.createElement('div');
        div.className = `msg msg-${sender}`;
        const ts = new Date().toTimeString().split(' ')[0].slice(0, 5);

        function fmt(str) {
            if (!str) return '';
            return str
                .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
                .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
                .replace(/\*(.*?)\*/g, '<em>$1</em>')
                .replace(/`([^`]+)`/g, '<code style="background:rgba(255,255,255,.06);padding:1px 4px;border-radius:3px;">$1</code>')
                .replace(/\n/g, '<br>');
        }

        let html = `<div class="msg-content">${fmt(text)}</div>`;
        if (photoUrl) html += `<img src="${photoUrl}" class="chat-photo-preview" alt="Snapshot" onclick="window.open('${photoUrl}','_blank')">`;
        html += `<span class="msg-ts">${ts}</span>`;

        div.innerHTML = html;
        chatMessages.appendChild(div);
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }

    async function sendChat(msg) {
        if (!msg.trim()) return;
        appendMsg('user', msg);
        chatInput.value = '';
        
        const targetEl = document.getElementById('chat-video-target');
        const target = targetEl ? targetEl.value : 'live';
        
        // Show subtle analyzing indicator
        const thinkingDiv = document.createElement('div');
        thinkingDiv.className = 'chat-msg bot msg-thinking';
        thinkingDiv.style.opacity = '0.85';
        thinkingDiv.innerHTML = `<div class="msg-content"><em style="color:#38bdf8;">⚡ Gemini AI is analyzing ${target === 'live' ? 'live CCTV camera stream' : 'recorded video footage'}...</em></div>`;
        chatMessages.appendChild(thinkingDiv);
        chatMessages.scrollTop = chatMessages.scrollHeight;
        
        try {
            const res = await fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: msg, video_id: target })
            });
            const data = await res.json();
            if (thinkingDiv.parentNode) thinkingDiv.parentNode.removeChild(thinkingDiv);
            appendMsg('bot', data.reply || 'No response', data.photo_url);
        } catch (e) {
            if (thinkingDiv.parentNode) thinkingDiv.parentNode.removeChild(thinkingDiv);
            appendMsg('bot', 'Error contacting AI Guard.');
        }
    }

    if (chatForm) chatForm.addEventListener('submit', (e) => { e.preventDefault(); sendChat(chatInput.value); });
    chatChips.forEach(btn => btn.addEventListener('click', () => sendChat(btn.dataset.msg)));
});
