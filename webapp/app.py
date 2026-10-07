import os
import sys
import time
import json
import threading
import base64
from datetime import datetime
from pathlib import Path

import cv2
import numpy as np
import requests
from flask import Flask, Response, render_template, request, jsonify, send_file
from werkzeug.utils import secure_filename
from ultralytics import YOLO
from PIL import Image
import google.generativeai as genai

app = Flask(__name__, static_folder='static', template_folder='templates')

@app.after_request
def add_cors_headers(response):
    response.headers['Access-Control-Allow-Origin'] = '*'
    response.headers['Access-Control-Allow-Headers'] = 'Content-Type,Authorization'
    response.headers['Access-Control-Allow-Methods'] = 'GET,PUT,POST,DELETE,OPTIONS'
    return response

BASE_DIR = Path(__file__).resolve().parent
SNAPSHOTS_DIR = BASE_DIR / "snapshots"
FACES_DIR = BASE_DIR / "enrolled_faces"
MISSING_DIR = BASE_DIR / "missing_persons"
RECORDINGS_DIR = BASE_DIR / "recordings"
CONFIG_FILE = BASE_DIR / "config.json"

SNAPSHOTS_DIR.mkdir(exist_ok=True)
FACES_DIR.mkdir(exist_ok=True)
MISSING_DIR.mkdir(exist_ok=True)
RECORDINGS_DIR.mkdir(exist_ok=True)

# Default Persistent Config
DEFAULT_CONFIG = {
    "telegram_token": "",
    "telegram_chat_id": "",
    "telegram_enabled": False,
    "discord_webhook_url": "",
    "discord_enabled": False,
    "slack_webhook_url": "",
    "slack_enabled": False,
    "ha_webhook_url": "",
    "ha_enabled": False,
    "gemini_api_key": "",
    "alarm_sound_enabled": True,
    "confidence": 0.5,
    "active_mode": "surveillance",  # surveillance | fall_detection | parking | privacy
    "selected_classes": ["person", "car", "motorcycle", "bicycle", "dog", "cat"],
    "privacy_blur": False,
    "privacy_style": "depth",
    "telegram_clear_evidence": True,
    "parking_slots": [
        {"id": 1, "name": "Slot A-1", "box": [40, 180, 180, 420]},
        {"id": 2, "name": "Slot A-2", "box": [190, 180, 330, 420]},
        {"id": 3, "name": "Slot A-3", "box": [340, 180, 480, 420]},
        {"id": 4, "name": "Slot A-4", "box": [490, 180, 630, 420]},
    ]
}

def load_config():
    if CONFIG_FILE.exists():
        try:
            with open(CONFIG_FILE, "r") as f:
                return {**DEFAULT_CONFIG, **json.load(f)}
        except Exception:
            pass
    return DEFAULT_CONFIG.copy()

def save_config(cfg):
    try:
        with open(CONFIG_FILE, "w") as f:
            json.dump(cfg, f, indent=2)
    except Exception as e:
        print(f"Error saving config: {e}")

system_config = load_config()

# Helper for Face Recognition Feature Embedding
def extract_face_feature(crop_img):
    if crop_img is None or crop_img.size == 0:
        return None
    try:
        resized = cv2.resize(crop_img, (64, 64))
        hsv = cv2.cvtColor(resized, cv2.COLOR_BGR2HSV)
        hist = cv2.calcHist([hsv], [0, 1, 2], None, [8, 8, 8], [0, 180, 0, 256, 0, 256])
        hist = cv2.normalize(hist, hist).flatten()
        return hist
    except Exception:
        return None

def compute_similarity(feat1, feat2):
    if feat1 is None or feat2 is None:
        return 0.0
    try:
        return max(0.0, float(cv2.compareHist(feat1, feat2, cv2.HISTCMP_CORREL)))
    except Exception:
        return 0.0

class DeepCameraCore:
    def __init__(self):
        self.source = 0
        self.cap = None
        self.is_running = False
        self.lock = threading.Lock()
        
        # Frames
        self.current_frame = None
        self.current_raw_frame = None
        
        # Models
        self.detect_model = None
        self.pose_model = None
        self.init_models()
        
        # Enrolled Faces Database
        self.enrolled_faces = {}  # name -> {"feat": np.array, "img_path": str}
        self.load_enrolled_faces()
        
        # Missing Persons Database
        self.missing_persons = {}  # name -> {"feat": np.array, "filename": str, ...}
        self.missing_person_matches = []  # recent matches
        self.load_missing_persons()
        
        # Telemetry & Status
        self.fps = 0.0
        self.latency_ms = 0.0
        self.detected_objects_count = 0
        self.intruders_count = 0
        self.known_persons_count = 0
        self.fall_detected = False
        self.missing_person_found = False
        self.parking_status = {"occupied": 0, "total": 4, "slots": []}
        
        # Recording state
        self.is_recording = False
        self.video_writer = None
        self.record_id = None
        self.recording_log = []
        self.last_log_time = 0
        
        self.status = "Initializing DeepCamera..."
        self.recent_events = []
        self.last_alert_time = 0
        self.last_missing_alert_time = 0
        
        # Thread
        self.thread = None

    def init_models(self):
        try:
            print("Loading YOLOv8 Detection model...")
            self.detect_model = YOLO("yolov8n.pt")
            print("Loading YOLOv8 Pose model for Fall Detection...")
            self.pose_model = YOLO("yolov8n-pose.pt")
            self.status = "AI Models Ready"
        except Exception as e:
            print(f"Model Init Error: {e}")
            self.status = f"Model load error: {e}"

    def load_enrolled_faces(self):
        self.enrolled_faces = {}
        meta_file = FACES_DIR / "faces.json"
        if meta_file.exists():
            try:
                with open(meta_file, "r") as f:
                    meta = json.load(f)
                for name, info in meta.items():
                    img_path = FACES_DIR / info["filename"]
                    if img_path.exists():
                        img = cv2.imread(str(img_path))
                        feat = extract_face_feature(img)
                        if feat is not None:
                            self.enrolled_faces[name] = {
                                "feat": feat,
                                "filename": info["filename"],
                                "enrolled_at": info.get("enrolled_at", "")
                            }
                print(f"Loaded {len(self.enrolled_faces)} enrolled faces.")
            except Exception as e:
                print(f"Error loading enrolled faces: {e}")

    def enroll_face(self, name, crop_img):
        feat = extract_face_feature(crop_img)
        if feat is None:
            return False, "Could not extract face features from image"
        
        safe_name = "".join([c for c in name if c.isalnum() or c in (' ', '_')]).strip()
        if not safe_name:
            return False, "Invalid name"

        filename = f"face_{safe_name.lower().replace(' ', '_')}_{int(time.time())}.jpg"
        save_path = FACES_DIR / filename
        cv2.imwrite(str(save_path), crop_img)

        # Update metadata
        meta_file = FACES_DIR / "faces.json"
        meta = {}
        if meta_file.exists():
            try:
                with open(meta_file, "r") as f:
                    meta = json.load(f)
            except Exception:
                pass
        
        meta[safe_name] = {
            "filename": filename,
            "enrolled_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        }
        with open(meta_file, "w") as f:
            json.dump(meta, f, indent=2)

        self.enrolled_faces[safe_name] = {
            "feat": feat,
            "filename": filename,
            "enrolled_at": meta[safe_name]["enrolled_at"]
        }
        return True, f"Successfully enrolled face for '{safe_name}'"

    def delete_face(self, name):
        meta_file = FACES_DIR / "faces.json"
        if meta_file.exists():
            try:
                with open(meta_file, "r") as f:
                    meta = json.load(f)
                if name in meta:
                    fn = meta[name]["filename"]
                    del meta[name]
                    with open(meta_file, "w") as f:
                        json.dump(meta, f, indent=2)
                    if (FACES_DIR / fn).exists():
                        (FACES_DIR / fn).unlink()
                    if name in self.enrolled_faces:
                        del self.enrolled_faces[name]
                    return True
            except Exception as e:
                print(f"Error deleting face: {e}")
        return False

    # ==========================================
    # MISSING PERSON FINDER
    # ==========================================
    def load_missing_persons(self):
        self.missing_persons = {}
        meta_file = MISSING_DIR / "missing.json"
        if meta_file.exists():
            try:
                with open(meta_file, "r") as f:
                    meta = json.load(f)
                for name, info in meta.items():
                    img_path = MISSING_DIR / info["filename"]
                    if img_path.exists():
                        img = cv2.imread(str(img_path))
                        # The image on disk is already the head crop we saved during add_missing_person
                        feat = extract_face_feature(img)
                        if feat is not None:
                            self.missing_persons[name] = {
                                "feat": feat,
                                "filename": info["filename"],
                                "description": info.get("description", ""),
                                "reported_at": info.get("reported_at", ""),
                                "contact": info.get("contact", ""),
                                "last_seen": info.get("last_seen", ""),
                                "status": info.get("status", "searching")
                            }
                print(f"Loaded {len(self.missing_persons)} missing person profile(s).")
            except Exception as e:
                print(f"Error loading missing persons: {e}")
        
        if not self.missing_persons:
            self.missing_person_found = False
            self.missing_person_matches = []

    def add_missing_person(self, name, photo_img, description="", contact="", last_seen=""):
        head_crop = photo_img
        if self.detect_model is not None:
            try:
                results = self.detect_model(photo_img, conf=0.25, verbose=False)
                for r in results:
                    for b in r.boxes:
                        if self.detect_model.names[int(b.cls[0])] == "person":
                            x1, y1, x2, y2 = map(int, b.xyxy[0].tolist())
                            ph = y2 - y1
                            head_h = int(ph * 0.35)
                            head_crop = photo_img[max(0, y1):y1 + head_h, max(0, x1):x2]
                            break
                    if head_crop is not photo_img:
                        break
            except Exception as e:
                print("Error extracting head from uploaded photo:", e)

        feat = extract_face_feature(head_crop)
        if feat is None:
            return False, "Could not extract face features from uploaded photo"
        
        safe_name = "".join([c for c in name if c.isalnum() or c in (' ', '_')]).strip()
        if not safe_name:
            return False, "Invalid name"

        filename = f"missing_{safe_name.lower().replace(' ', '_')}_{int(time.time())}.jpg"
        save_path = MISSING_DIR / filename
        cv2.imwrite(str(save_path), head_crop)

        meta_file = MISSING_DIR / "missing.json"
        meta = {}
        if meta_file.exists():
            try:
                with open(meta_file, "r") as f:
                    meta = json.load(f)
            except Exception:
                pass
        
        meta[safe_name] = {
            "filename": filename,
            "description": description,
            "contact": contact,
            "last_seen": last_seen,
            "reported_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "status": "searching"
        }
        with open(meta_file, "w") as f:
            json.dump(meta, f, indent=2)

        self.missing_persons[safe_name] = {
            "feat": feat,
            "filename": filename,
            "description": description,
            "contact": contact,
            "last_seen": last_seen,
            "reported_at": meta[safe_name]["reported_at"],
            "status": "searching"
        }
        return True, f"Missing person '{safe_name}' registered for CCTV scanning"

    def delete_missing_person(self, name):
        meta_file = MISSING_DIR / "missing.json"
        if meta_file.exists():
            try:
                with open(meta_file, "r") as f:
                    meta = json.load(f)
                if name in meta:
                    fn = meta[name]["filename"]
                    del meta[name]
                    with open(meta_file, "w") as f:
                        json.dump(meta, f, indent=2)
                    if (MISSING_DIR / fn).exists():
                        (MISSING_DIR / fn).unlink()
                    with self.lock:
                        if name in self.missing_persons:
                            del self.missing_persons[name]
                        self.missing_person_matches = [m for m in self.missing_person_matches if m.get("name") != name]
                        if not self.missing_persons:
                            self.missing_person_found = False
                            self.missing_person_matches = []
                    return True
            except Exception as e:
                print(f"Error deleting missing person: {e}")
        return False

    def _check_missing_persons(self, raw_frame, person_boxes):
        """Check detected persons against missing persons database. Returns True if target actively spotted."""
        found = False
        
        if not self.missing_persons or not person_boxes:
            return False
        
        for p_box in person_boxes:
            x1, y1, x2, y2 = p_box
            ph = y2 - y1
            head_h = int(ph * 0.35)
            head_crop = raw_frame[y1:y1 + head_h, x1:x2]
            head_feat = extract_face_feature(head_crop)
            
            if head_feat is not None:
                for name, info in self.missing_persons.items():
                    if info.get("status") == "found":
                        continue
                    sim = compute_similarity(head_feat, info["feat"])
                    if sim >= 0.60:  # High confidence missing person threshold
                        found = True
                        now = time.time()
                        
                        # Rate-limited timeline event logging
                        if now - self.last_missing_alert_time > 8.0:
                            self._log_event(
                                f"MISSING PERSON SPOTTED: {name}",
                                f"Match confidence: {int(sim * 100)}% — Contact: {info.get('contact', 'N/A')}",
                                "missing"
                            )
                        
                        # Add to matches
                        match_entry = {
                            "name": name,
                            "confidence": int(sim * 100),
                            "time": datetime.now().strftime("%H:%M:%S"),
                            "contact": info.get("contact", ""),
                            "description": info.get("description", "")
                        }
                        if not self.missing_person_matches or self.missing_person_matches[0].get("name") != name:
                            self.missing_person_matches.insert(0, match_entry)
                            if len(self.missing_person_matches) > 20:
                                self.missing_person_matches.pop()
                        
                        # Trigger alert (rate limited separately)
                        if now - self.last_missing_alert_time > 15.0:
                            self.last_missing_alert_time = now
                            alert_frame = raw_frame.copy()
                            cv2.rectangle(alert_frame, (x1, y1), (x2, y2), (0, 255, 255), 3)
                            cv2.putText(alert_frame, f"MISSING: {name} ({int(sim*100)}%)",
                                        (x1, y1 - 10), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 255), 2)
                            self._trigger_alert(
                                "missing_person",
                                f"MISSING PERSON DETECTED: {name} (Confidence: {int(sim * 100)}%). Contact: {info.get('contact', 'N/A')}",
                                alert_frame
                            )
        return found

    def set_source(self, new_source):
        with self.lock:
            if isinstance(new_source, str) and new_source.isdigit():
                self.source = int(new_source)
            else:
                self.source = new_source

            if self.cap is not None:
                self.cap.release()
                self.cap = None

            self.status = f"Switching to source: {self.source}..."

    def start(self):
        if not self.is_running:
            self.is_running = True
            self.thread = threading.Thread(target=self._processing_loop, daemon=True)
            self.thread.start()

    def stop(self):
        self.is_running = False
        if self.thread and self.thread.is_alive():
            self.thread.join(timeout=2)
        if self.cap:
            self.cap.release()

    def _generate_synthetic_feed(self, t):
        h, w = 480, 640
        frame = np.zeros((h, w, 3), dtype=np.uint8)
        # Gradient background
        for y in range(h):
            val = int(18 + 18 * (y / h))
            frame[y, :] = [val, val + 8, val + 14]

        # CCTV gridlines
        for x in range(0, w, 40):
            cv2.line(frame, (x, 0), (x, h), (26, 36, 46), 1)
        for y in range(0, h, 40):
            cv2.line(frame, (0, y), (w, y), (26, 36, 46), 1)

        # Moving Target
        cx = int(w / 2 + 180 * np.sin(t * 1.5))
        cy = int(h / 2 + 80 * np.cos(t * 1.5))
        cv2.circle(frame, (cx, cy), 32, (0, 210, 255), 2)
        cv2.putText(frame, "SIMULATED PATROL FEED", (cx - 75, cy - 42),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.45, (0, 255, 255), 1)
        cv2.line(frame, (cx - 15, cy), (cx + 15, cy), (0, 255, 200), 1)
        cv2.line(frame, (cx, cy - 15), (cx, cy + 15), (0, 255, 200), 1)

        # Mode Stamp
        mode_str = system_config.get("active_mode", "surveillance").upper()
        cv2.putText(frame, f"[CCTV CHANNEL - {mode_str} ACTIVE]", (20, 36),
                    cv2.FONT_HERSHEY_DUPLEX, 0.55, (0, 255, 180), 1)
        cv2.putText(frame, f"Source: {self.source} (Waiting for camera link...)", (20, 62),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.42, (150, 175, 195), 1)
        cv2.putText(frame, "Switch to Webcam (0) or enter valid RTSP URL in sidebar", (20, 85),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.4, (120, 145, 165), 1)

        ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S.%f")[:-3]
        cv2.putText(frame, ts, (w - 230, h - 18), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (0, 255, 200), 1)
        return frame

    def _trigger_alert(self, event_type, details, annotated_frame):
        now = time.time()
        # Rate limit external alerts to once per 8 seconds
        if now - self.last_alert_time < 8.0:
            return
        self.last_alert_time = now

        # Save snapshot for alert
        snap_name = f"alert_{event_type}_{int(now)}.jpg"
        snap_path = SNAPSHOTS_DIR / snap_name
        cv2.imwrite(str(snap_path), annotated_frame)

        # 1. Telegram Alert
        if system_config.get("telegram_enabled") and system_config.get("telegram_token"):
            token = system_config["telegram_token"]
            chat_id = system_config.get("telegram_chat_id")
            caption = f"🚨 DeepCamera Alert: {event_type.upper()}!\nTime: {datetime.now().strftime('%H:%M:%S')}\nDetails: {details}"
            threading.Thread(target=self._send_telegram, args=(token, chat_id, caption, str(snap_path)), daemon=True).start()

        # 2. Discord Webhook Alert
        if system_config.get("discord_enabled") and system_config.get("discord_webhook_url"):
            d_url = system_config["discord_webhook_url"]
            d_msg = f"🛡️ **DeepCamera AI Incident Report**\n**Event:** `{event_type.upper()}`\n**Time:** `{datetime.now().strftime('%H:%M:%S')}`\n**Analysis:** {details}"
            threading.Thread(target=self._send_discord, args=(d_url, d_msg, str(snap_path)), daemon=True).start()

        # 3. Slack Webhook Alert
        if system_config.get("slack_enabled") and system_config.get("slack_webhook_url"):
            s_url = system_config["slack_webhook_url"]
            s_msg = f"🛡️ *DeepCamera Alert: {event_type.upper()}*\nTime: {datetime.now().strftime('%H:%M:%S')}\nDetails: {details}"
            threading.Thread(target=self._send_slack, args=(s_url, s_msg), daemon=True).start()

        # 4. Home Assistant Webhook
        if system_config.get("ha_enabled") and system_config.get("ha_webhook_url"):
            ha_url = system_config["ha_webhook_url"]
            payload = {
                "event": event_type,
                "timestamp": datetime.now().isoformat(),
                "details": details,
                "camera_source": str(self.source)
            }
            threading.Thread(target=self._send_ha, args=(ha_url, payload), daemon=True).start()

    def _send_telegram(self, token, chat_id, caption, photo_path):
        try:
            with open(photo_path, "rb") as f:
                requests.post(
                    f"https://api.telegram.org/bot{token}/sendPhoto",
                    data={"chat_id": chat_id, "caption": caption},
                    files={"photo": f},
                    timeout=6
                )
        except Exception as e:
            print(f"Telegram alert error: {e}")

    def _send_discord(self, url, message, photo_path):
        try:
            if photo_path and os.path.exists(photo_path):
                with open(photo_path, "rb") as f:
                    requests.post(url, data={"content": message}, files={"file": f}, timeout=6)
            else:
                requests.post(url, json={"content": message}, timeout=5)
        except Exception as e:
            print(f"Discord alert error: {e}")

    def _send_slack(self, url, message):
        try:
            requests.post(url, json={"text": message}, timeout=5)
        except Exception as e:
            print(f"Slack alert error: {e}")

    def _send_ha(self, url, payload):
        try:
            requests.post(url, json=payload, timeout=5)
        except Exception as e:
            print(f"Home Assistant alert error: {e}")

    def _processing_loop(self):
        fps_timer = time.time()
        frame_counter = 0

        while self.is_running:
            raw_frame = None
            use_synthetic = False

            # Capture frame
            try:
                if self.cap is None or not self.cap.isOpened():
                    self.cap = cv2.VideoCapture(self.source)
                    self.cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)

                if self.cap.isOpened():
                    ret, frame = self.cap.read()
                    if ret and frame is not None:
                        raw_frame = frame
                        self.status = "Live Stream Active"
                    else:
                        use_synthetic = True
                        self.status = f"Source '{self.source}' no signal — test feed"
                else:
                    use_synthetic = True
                    self.status = f"Cannot connect to '{self.source}' — test feed"
            except Exception as e:
                use_synthetic = True
                self.status = f"Feed Error: {e}"

            if use_synthetic or raw_frame is None:
                raw_frame = self._generate_synthetic_feed(time.time())
                time.sleep(0.04)

            annotated_frame = raw_frame.copy()
            active_mode = system_config.get("active_mode", "surveillance")
            confidence = system_config.get("confidence", 0.5)
            selected_classes = system_config.get("selected_classes", [])
            t_start = time.perf_counter()

            detected_objects = []
            current_intruders = 0
            current_known = 0
            current_fall = False
            current_missing = False

            # Prepare unblurred evidence frame specifically for Telegram & Forensics
            clean_evidence_frame = raw_frame.copy()

            # Check Privacy Transformation Style for Live Display
            privacy_style = system_config.get("privacy_style", "blur")
            if active_mode == "privacy" and privacy_style == "depth":
                gray = cv2.cvtColor(raw_frame, cv2.COLOR_BGR2GRAY)
                annotated_frame = cv2.applyColorMap(gray, cv2.COLORMAP_TURBO)

            # ==========================================================
            # MODE 1 & 4: Surveillance / Face ID / Privacy Masking
            # ==========================================================
            if active_mode in ["surveillance", "privacy"] and self.detect_model is not None and not use_synthetic:
                try:
                    results = self.detect_model(raw_frame, conf=confidence, verbose=False)
                    for r in results:
                        for box in r.boxes:
                            cls_id = int(box.cls[0])
                            cls_name = self.detect_model.names[cls_id]
                            conf = float(box.conf[0])

                            if not selected_classes or cls_name in selected_classes:
                                x1, y1, x2, y2 = map(int, box.xyxy[0].tolist())
                                h_frame, w_frame, _ = annotated_frame.shape
                                x1, y1 = max(0, x1), max(0, y1)
                                x2, y2 = min(w_frame, x2), min(h_frame, y2)

                                is_known_face = False
                                recognized_person_name = ""

                                # If Person detected, run Face ID / ReID Matching & Fall Check
                                if cls_name == "person" and (y2 - y1) > 30 and (x2 - x1) > 20:
                                    # ALWAYS-ON Fall Detection Check (even in Surveillance mode)
                                    aspect_ratio = (x2 - x1) / max(1, (y2 - y1))
                                    if aspect_ratio >= 1.25 and (y2 - y1) < (h_frame * 0.5):
                                        current_fall = True

                                    # Face Matching
                                    head_h = int((y2 - y1) * 0.35)
                                    head_crop = raw_frame[y1:y1 + head_h, x1:x2]
                                    head_feat = extract_face_feature(head_crop)

                                    if head_feat is not None and self.enrolled_faces:
                                        best_match = None
                                        best_sim = 0.0
                                        for name, info in self.enrolled_faces.items():
                                            sim = compute_similarity(head_feat, info["feat"])
                                            if sim > best_sim:
                                                best_sim = sim
                                                best_match = name
                                        
                                        if best_sim >= 0.65:
                                            is_known_face = True
                                            recognized_person_name = f"{best_match} ({int(best_sim * 100)}%)"
                                            current_known += 1

                                    if not is_known_face and not current_fall:
                                        current_intruders += 1

                                    # Privacy Masking on LIVE MONITOR FEED only (Not on Telegram evidence)
                                    if active_mode == "privacy" or system_config.get("privacy_blur", False):
                                        roi = annotated_frame[y1:y2, x1:x2]
                                        if roi.size > 0:
                                            if privacy_style == "silhouette":
                                                annotated_frame[y1:y2, x1:x2] = (25, 25, 35)
                                            else:
                                                blurred = cv2.GaussianBlur(roi, (51, 51), 35)
                                                annotated_frame[y1:y2, x1:x2] = blurred

                                # Colors & Annotations
                                if current_fall:
                                    color = (0, 0, 255)
                                    label = "EMERGENCY: FALL DETECTED!"
                                elif is_known_face:
                                    color = (0, 255, 128)
                                    label = f"KNOWN: {recognized_person_name}"
                                elif cls_name == "person":
                                    color = (0, 80, 255)
                                    label = f"PERSON [STRANGER] {int(conf * 100)}%"
                                else:
                                    color = (255, 190, 0)
                                    label = f"{cls_name.upper()} {int(conf * 100)}%"

                                # Draw on Live Monitor Frame
                                cv2.rectangle(annotated_frame, (x1, y1), (x2, y2), color, 2)
                                (tw, th), _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.48, 1)
                                cv2.rectangle(annotated_frame, (x1, y1 - 22), (x1 + tw + 6, y1), color, -1)
                                cv2.putText(annotated_frame, label, (x1 + 3, y1 - 6),
                                            cv2.FONT_HERSHEY_SIMPLEX, 0.48, (0, 0, 0), 1, cv2.LINE_AA)

                                # Draw on CLEAR Evidence Frame (UNBLURRED for Telegram!)
                                cv2.rectangle(clean_evidence_frame, (x1, y1), (x2, y2), color, 2)
                                cv2.rectangle(clean_evidence_frame, (x1, y1 - 22), (x1 + tw + 6, y1), color, -1)
                                cv2.putText(clean_evidence_frame, label, (x1 + 3, y1 - 6),
                                            cv2.FONT_HERSHEY_SIMPLEX, 0.48, (0, 0, 0), 1, cv2.LINE_AA)

                                detected_objects.append({"class": cls_name, "label": label, "conf": conf})

                    # Missing Person Scan — active when targets are registered in database
                    if self.missing_persons:
                        person_box_list = [(int(b.xyxy[0][0]), int(b.xyxy[0][1]), int(b.xyxy[0][2]), int(b.xyxy[0][3]))
                                          for r in results for b in r.boxes
                                          if self.detect_model.names[int(b.cls[0])] == "person"]
                        current_missing = self._check_missing_persons(raw_frame, person_box_list)
                    else:
                        current_missing = False

                    # -----------------------

                    # Evidence selection: send CLEAR UNBLURRED photo to Telegram
                    evidence_to_send = clean_evidence_frame if system_config.get("telegram_clear_evidence", True) else annotated_frame

                    if current_fall:
                        self._trigger_alert("fall", "Emergency: Person fall detected!", evidence_to_send)
                        self._log_event("FALL EMERGENCY", "Person fall posture confirmed", "fall")
                    elif current_intruders > 0:
                        self._trigger_alert("intruder", f"{current_intruders} stranger(s) detected", evidence_to_send)
                        self._log_event("Intruder Alert", f"{current_intruders} person(s) in view", "person")
                    elif current_known > 0:
                        self._log_event("Face ID Verified", f"Recognized known member", "face")

                except Exception as e:
                    print(f"Surveillance Inference Error: {e}")

            # ==========================================================
            # MODE 2: Fall Detection (Pose Estimation for Elderly/Safety)
            # ==========================================================
            elif active_mode == "fall_detection" and self.pose_model is not None and not use_synthetic:
                try:
                    results = self.pose_model(raw_frame, conf=confidence, verbose=False)
                    for r in results:
                        for box, kpts in zip(r.boxes, r.keypoints):
                            x1, y1, x2, y2 = map(int, box.xyxy[0].tolist())
                            w_box = x2 - x1
                            h_box = y2 - y1

                            # Fall detection logic:
                            # 1. Aspect ratio: width significantly greater than height (person lying horizontal)
                            # 2. Keypoints: head and hips are at roughly equal vertical height or near floor
                            aspect_ratio = w_box / max(1, h_box)
                            is_fallen = False

                            if aspect_ratio >= 1.25 and h_box < (raw_frame.shape[0] * 0.45):
                                is_fallen = True

                            # Also verify keypoints if available
                            if hasattr(kpts, 'xy') and len(kpts.xy[0]) >= 17:
                                pts = kpts.xy[0].cpu().numpy()
                                nose = pts[0]
                                l_hip, r_hip = pts[11], pts[12]
                                if nose[1] > 0 and l_hip[1] > 0:
                                    # If head is near hip height and angle is horizontal
                                    dy = abs(nose[1] - l_hip[1])
                                    dx = abs(nose[0] - l_hip[0])
                                    if dx > dy * 1.3:
                                        is_fallen = True

                            # Draw skeleton & Status
                            if is_fallen:
                                current_fall = True
                                color = (0, 0, 255)  # Bright Red
                                label = "EMERGENCY: FALL DETECTED!"
                                # Draw emergency banner
                                cv2.rectangle(annotated_frame, (0, 0), (annotated_frame.shape[1], 50), (0, 0, 200), -1)
                                cv2.putText(annotated_frame, "!!! EMERGENCY: PERSON FALL DETECTED !!!", (40, 35),
                                            cv2.FONT_HERSHEY_DUPLEX, 0.8, (255, 255, 255), 2)
                                self._trigger_alert("fall", "Emergency: Person fall detected!", clean_evidence_frame)
                                self._log_event("FALL EMERGENCY", "Person fall posture confirmed", "fall")
                            else:
                                color = (0, 255, 128)
                                label = "PERSON: UPRIGHT / NORMAL"

                            cv2.rectangle(annotated_frame, (x1, y1), (x2, y2), color, 3)
                            cv2.putText(annotated_frame, label, (x1, y1 - 10),
                                        cv2.FONT_HERSHEY_SIMPLEX, 0.55, color, 2)
                            detected_objects.append({"class": "fall_monitor", "label": label})

                except Exception as e:
                    print(f"Fall Detection Error: {e}")

            # ==========================================================
            # MODE 3: Smart Parking Lot Monitoring
            # ==========================================================
            elif active_mode == "parking" and self.detect_model is not None and not use_synthetic:
                try:
                    results = self.detect_model(raw_frame, conf=confidence, verbose=False)
                    vehicle_boxes = []
                    for r in results:
                        for box in r.boxes:
                            cls_id = int(box.cls[0])
                            cls_name = self.detect_model.names[cls_id]
                            if cls_name in ["car", "truck", "bus", "motorcycle", "van"]:
                                vx1, vy1, vx2, vy2 = map(int, box.xyxy[0].tolist())
                                vehicle_boxes.append((vx1, vy1, vx2, vy2, cls_name))
                                cv2.rectangle(annotated_frame, (vx1, vy1), (vx2, vy2), (255, 200, 0), 2)

                    slots = system_config.get("parking_slots", [])
                    occupied_count = 0
                    slot_reports = []

                    for s in slots:
                        sx1, sy1, sx2, sy2 = s["box"]
                        s_name = s["name"]
                        s_center = ((sx1 + sx2) // 2, (sy1 + sy2) // 2)

                        # Check if any vehicle box overlaps center of slot
                        is_occ = False
                        occupant_type = ""
                        for vx1, vy1, vx2, vy2, vtype in vehicle_boxes:
                            if vx1 < s_center[0] < vx2 and vy1 < s_center[1] < vy2:
                                is_occ = True
                                occupant_type = vtype
                                break

                        if is_occ:
                            occupied_count += 1
                            s_color = (0, 0, 255)  # Red for occupied
                            status_text = f"{s_name}: OCCUPIED ({occupant_type})"
                        else:
                            s_color = (0, 255, 128)  # Green for vacant
                            status_text = f"{s_name}: VACANT"

                        cv2.rectangle(annotated_frame, (sx1, sy1), (sx2, sy2), s_color, 2)
                        cv2.putText(annotated_frame, status_text, (sx1 + 5, sy1 + 22),
                                    cv2.FONT_HERSHEY_SIMPLEX, 0.48, s_color, 1)
                        slot_reports.append({"id": s["id"], "name": s_name, "occupied": is_occ, "type": occupant_type})

                    self.parking_status = {
                        "occupied": occupied_count,
                        "total": len(slots),
                        "slots": slot_reports
                    }

                    # Parking Summary Header on frame
                    cv2.rectangle(annotated_frame, (10, 10), (320, 45), (15, 20, 30), -1)
                    cv2.putText(annotated_frame, f"PARKING: {occupied_count}/{len(slots)} OCCUPIED", (20, 34),
                                cv2.FONT_HERSHEY_DUPLEX, 0.55, (0, 255, 200), 1)

                except Exception as e:
                    print(f"Parking Inference Error: {e}")

            # Latency & FPS calculation
            self.latency_ms = round((time.perf_counter() - t_start) * 1000, 1)
            frame_counter += 1
            if time.time() - fps_timer >= 1.0:
                self.fps = round(frame_counter / (time.time() - fps_timer), 1)
                frame_counter = 0
                fps_timer = time.time()

            # --- Universal CCTV Video & Forensic Timeline Recorder ---
            if self.is_recording and self.record_id is not None:
                try:
                    h_frame, w_frame = annotated_frame.shape[:2]
                    if self.video_writer is None:
                        fourcc = cv2.VideoWriter_fourcc(*'mp4v')
                        path = str(RECORDINGS_DIR / f"{self.record_id}.mp4")
                        self.video_writer = cv2.VideoWriter(path, fourcc, 10.0, (w_frame, h_frame))

                    if self.video_writer is not None and self.video_writer.isOpened():
                        self.video_writer.write(annotated_frame)

                    now = time.time()
                    if now - self.last_log_time >= 1.0 or not self.recording_log:
                        self.last_log_time = now
                        match_name = self.missing_person_matches[0]["name"] if (self.missing_person_found and self.missing_person_matches) else None
                        obj_names = []
                        for o in detected_objects:
                            if isinstance(o, dict) and "class" in o:
                                obj_names.append(o["class"])
                        if active_mode == "parking" and hasattr(self, "parking_status"):
                            obj_names.append(f"parking_{self.parking_status.get('occupied', 0)}_occupied")
                        self.recording_log.append({
                            "sec": len(self.recording_log) + 1,
                            "time": datetime.now().strftime("%H:%M:%S"),
                            "mode": active_mode,
                            "fall": current_fall,
                            "missing": self.missing_person_found,
                            "missing_name": match_name,
                            "intruders": current_intruders,
                            "known_persons": current_known,
                            "objects": list(set(obj_names))
                        })
                except Exception as rec_err:
                    print(f"Recording frame error: {rec_err}")

            with self.lock:
                self.current_raw_frame = raw_frame
                self.current_frame = annotated_frame
                self.detected_objects_count = len(detected_objects)
                self.intruders_count = current_intruders
                self.known_persons_count = current_known
                self.fall_detected = current_fall
                self.missing_person_found = current_missing

            time.sleep(0.01)

    def _log_event(self, title, msg, category):
        now_str = datetime.now().strftime("%H:%M:%S")
        if not self.recent_events or (now_str != self.recent_events[0]["time"]):
            self.recent_events.insert(0, {
                "time": now_str,
                "title": title,
                "msg": msg,
                "category": category
            })
            if len(self.recent_events) > 60:
                self.recent_events.pop()

    def get_jpeg_frame(self):
        with self.lock:
            if self.current_frame is None:
                return None
            ret, jpeg = cv2.imencode('.jpg', self.current_frame, [cv2.IMWRITE_JPEG_QUALITY, 85])
            if ret:
                return jpeg.tobytes()
        return None

    def capture_snapshot(self):
        with self.lock:
            if self.current_frame is None:
                return None
            filename = f"snapshot_{datetime.now().strftime('%Y%m%d_%H%M%S')}.jpg"
            filepath = SNAPSHOTS_DIR / filename
            cv2.imwrite(str(filepath), self.current_frame)
            return filename

deep_camera = DeepCameraCore()
deep_camera.start()

# ==========================================================
# FLASK WEB ROUTES & APIS
# ==========================================================

REACT_DIST = BASE_DIR.parent / "frontend" / "dist"

@app.route('/')
def index():
    if (REACT_DIST / "index.html").exists():
        return send_file(REACT_DIST / "index.html")
    return render_template('index.html')

@app.route('/assets/<path:filename>')
def get_react_asset(filename):
    asset_file = REACT_DIST / "assets" / filename
    if asset_file.exists():
        return send_file(asset_file)
    return "Not found", 404

def gen_frames():
    while True:
        frame_bytes = deep_camera.get_jpeg_frame()
        if frame_bytes is not None:
            yield (b'--frame\r\n'
                   b'Content-Type: image/jpeg\r\n\r\n' + frame_bytes + b'\r\n')
        else:
            time.sleep(0.05)

@app.route('/video_feed')
def video_feed():
    return Response(gen_frames(), mimetype='multipart/x-mixed-replace; boundary=frame')

@app.route('/api/status')
def get_status():
    return jsonify({
        "status": deep_camera.status,
        "fps": deep_camera.fps,
        "latency_ms": deep_camera.latency_ms,
        "source": str(deep_camera.source),
        "objects_count": deep_camera.detected_objects_count,
        "intruders_count": deep_camera.intruders_count,
        "known_count": deep_camera.known_persons_count,
        "fall_detected": deep_camera.fall_detected,
        "missing_person_found": deep_camera.missing_person_found,
        "missing_person_matches": deep_camera.missing_person_matches[:5],
        "parking": deep_camera.parking_status,
        "is_recording": deep_camera.is_recording,
        "record_id": deep_camera.record_id,
        "active_mode": system_config.get("active_mode", "surveillance"),
        "confidence": system_config.get("confidence", 0.5),
        "recent_events": deep_camera.recent_events[:15]
    })

@app.route('/api/config', methods=['GET', 'POST'])
def manage_config():
    global system_config
    if request.method == 'POST':
        data = request.get_json() or {}
        system_config.update(data)
        save_config(system_config)
        return jsonify({"success": True, "config": system_config})
    return jsonify(system_config)

@app.route('/api/set_source', methods=['POST'])
def set_source():
    data = request.get_json() or {}
    source = data.get('source', '0')
    deep_camera.set_source(source)
    return jsonify({"success": True, "source": str(deep_camera.source)})

@app.route('/api/set_mode', methods=['POST'])
def set_mode():
    data = request.get_json() or {}
    mode = data.get('mode', 'surveillance')
    system_config['active_mode'] = mode
    save_config(system_config)
    return jsonify({"success": True, "mode": mode})

@app.route('/api/snapshot', methods=['POST'])
def snapshot():
    filename = deep_camera.capture_snapshot()
    if filename:
        return jsonify({"success": True, "filename": filename, "url": f"/snapshots/{filename}"})
    return jsonify({"success": False, "error": "No frame"}), 500

@app.route('/snapshots/<path:filename>')
def get_snapshot(filename):
    return send_file(SNAPSHOTS_DIR / filename)

@app.route('/enrolled_faces/<path:filename>')
def get_enrolled_face(filename):
    return send_file(FACES_DIR / filename)

@app.route('/missing_persons/<path:filename>')
def get_missing_person_photo(filename):
    return send_file(MISSING_DIR / filename)

# ==========================================
# MISSING PERSON FINDER API
# ==========================================

@app.route('/api/missing_persons', methods=['GET'])
def list_missing_persons():
    meta_file = MISSING_DIR / "missing.json"
    if meta_file.exists():
        try:
            with open(meta_file, "r") as f:
                return jsonify(json.load(f))
        except Exception:
            pass
    return jsonify({})

@app.route('/api/missing_persons/matches', methods=['GET'])
def get_missing_matches():
    return jsonify(deep_camera.missing_person_matches[:20])

@app.route('/api/add_missing_person', methods=['POST'])
def add_missing_person():
    # Accept multipart form data with photo file
    if 'photo' not in request.files:
        return jsonify({"success": False, "error": "No photo file uploaded"}), 400
    
    photo_file = request.files['photo']
    name = request.form.get('name', '').strip()
    description = request.form.get('description', '').strip()
    contact = request.form.get('contact', '').strip()
    last_seen = request.form.get('last_seen', '').strip()
    
    if not name:
        return jsonify({"success": False, "error": "Name is required"}), 400
    if not photo_file.filename:
        return jsonify({"success": False, "error": "Empty photo file"}), 400
    
    # Read image from file upload
    file_bytes = np.frombuffer(photo_file.read(), np.uint8)
    img = cv2.imdecode(file_bytes, cv2.IMREAD_COLOR)
    if img is None:
        return jsonify({"success": False, "error": "Invalid image file"}), 400
    
    ok, msg = deep_camera.add_missing_person(name, img, description, contact, last_seen)
    return jsonify({"success": ok, "message": msg})

@app.route('/api/delete_missing_person', methods=['POST'])
def delete_missing_person():
    data = request.get_json() or {}
    name = data.get("name", "")
    ok = deep_camera.delete_missing_person(name)
    return jsonify({"success": ok})

# ==========================================
# RECORDING API
# ==========================================
@app.route('/api/recording/toggle', methods=['POST'])
def toggle_recording():
    if deep_camera.is_recording:
        # Stop
        deep_camera.is_recording = False
        time.sleep(0.05)
        if deep_camera.video_writer:
            try:
                deep_camera.video_writer.release()
            except Exception:
                pass
            deep_camera.video_writer = None

        if not deep_camera.recording_log:
            deep_camera.recording_log.append({
                "sec": 1,
                "time": datetime.now().strftime("%H:%M:%S"),
                "mode": system_config.get("active_mode", "surveillance"),
                "fall": False,
                "missing": False,
                "missing_name": None,
                "intruders": 0,
                "known_persons": 0,
                "objects": []
            })

        if deep_camera.record_id:
            try:
                with open(RECORDINGS_DIR / f"{deep_camera.record_id}.json", "w") as f:
                    json.dump(deep_camera.recording_log, f, indent=2)
            except Exception as e:
                print(f"Error saving recording json: {e}")

        rec_id = deep_camera.record_id
        deep_camera.record_id = None
        deep_camera.recording_log = []
        return jsonify({"success": True, "recording": False, "saved_id": rec_id})
    else:
        # Start
        deep_camera.record_id = f"rec_{int(time.time())}"
        deep_camera.recording_log = []
        deep_camera.last_log_time = time.time()
        deep_camera.is_recording = True
        return jsonify({"success": True, "recording": True, "record_id": deep_camera.record_id})

@app.route('/api/recordings_list', methods=['GET'])
def list_recordings():
    stems = set()
    for f in RECORDINGS_DIR.glob("*.mp4"):
        stems.add(f.stem)
    for f in RECORDINGS_DIR.glob("*.json"):
        stems.add(f.stem)

    def get_mtime(stem):
        p_mp4 = RECORDINGS_DIR / f"{stem}.mp4"
        if p_mp4.exists():
            return os.path.getmtime(p_mp4)
        p_json = RECORDINGS_DIR / f"{stem}.json"
        if p_json.exists():
            return os.path.getmtime(p_json)
        return 0

    sorted_stems = sorted(list(stems), key=get_mtime, reverse=True)
    return jsonify(sorted_stems)

@app.route('/recordings/<path:filename>')
def get_recording(filename):
    return send_file(RECORDINGS_DIR / filename)

@app.route('/api/snapshots_list')
def list_snapshots():
    files = sorted(SNAPSHOTS_DIR.glob("*.jpg"), key=os.path.getmtime, reverse=True)
    return jsonify([f.name for f in files[:24]])

# Face Enrollment Routes
@app.route('/api/faces', methods=['GET'])
def get_faces():
    meta_file = FACES_DIR / "faces.json"
    if meta_file.exists():
        try:
            with open(meta_file, "r") as f:
                return jsonify(json.load(f))
        except Exception:
            pass
    return jsonify({})

@app.route('/api/enroll_face', methods=['POST'])
def enroll_face():
    data = request.get_json() or {}
    name = data.get("name", "").strip()
    if not name:
        return jsonify({"success": False, "error": "Name is required"}), 400

    # Grab current raw frame
    with deep_camera.lock:
        if deep_camera.current_raw_frame is None:
            return jsonify({"success": False, "error": "No camera frame available"}), 500
        frame_copy = deep_camera.current_raw_frame.copy()

    # Detect face or crop central region
    h, w, _ = frame_copy.shape
    crop = frame_copy[int(h*0.2):int(h*0.8), int(w*0.3):int(w*0.7)]

    ok, msg = deep_camera.enroll_face(name, crop)
    return jsonify({"success": ok, "message": msg})

@app.route('/api/delete_face', methods=['POST'])
def delete_face():
    data = request.get_json() or {}
    name = data.get("name", "")
    ok = deep_camera.delete_face(name)
    return jsonify({"success": ok})

@app.route('/api/test_telegram', methods=['POST'])
def test_telegram():
    data = request.get_json() or {}
    token = (data.get("token") or system_config.get("telegram_token", "")).replace(" ", "").strip()
    chat_id = (data.get("chat_id") or system_config.get("telegram_chat_id", "")).strip()
    if not token or not chat_id:
        return jsonify({"success": False, "error": "Telegram Token & Chat ID both required"}), 400
    try:
        r = requests.post(
            f"https://api.telegram.org/bot{token}/sendMessage",
            json={"chat_id": chat_id, "text": "🔔 DeepCamera AI Studio: Telegram Notification Test Successful!"},
            timeout=5
        )
        return jsonify({"success": r.status_code == 200, "telegram_response": r.text})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

@app.route('/api/detect_telegram_chat_id', methods=['POST'])
def detect_telegram_chat_id():
    token = system_config.get("telegram_token", "").replace(" ", "").strip()
    if not token:
        return jsonify({"success": False, "error": "Bot Token not set"}), 400
    try:
        r = requests.get(f"https://api.telegram.org/bot{token}/getUpdates", timeout=5).json()
        if r.get("ok") and r.get("result"):
            last_msg = r["result"][-1]
            chat = last_msg.get("message", {}).get("chat", {}) or last_msg.get("my_chat_member", {}).get("chat", {})
            chat_id = str(chat.get("id", ""))
            user_name = chat.get("first_name", "") or chat.get("username", "")
            if chat_id:
                system_config["telegram_chat_id"] = chat_id
                save_config(system_config)
                return jsonify({"success": True, "chat_id": chat_id, "user_name": user_name})
        return jsonify({
            "success": False, 
            "error": "No message received yet! Please open Telegram, search for your bot '@MY_CCTV_CAMERA_ALERT_bot', and click 'START' or send a message."
        })
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

@app.route('/api/test_discord', methods=['POST'])
def test_discord():
    data = request.get_json() or {}
    url = (data.get("url") or system_config.get("discord_webhook_url", "")).strip()
    if not url:
        return jsonify({"success": False, "error": "Missing Discord Webhook URL"}), 400
    try:
        msg = f"🛡️ **DeepCamera Aegis Test Alert**\n✅ Discord notification operational at `{datetime.now().strftime('%H:%M:%S')}`!\nSystem: Local YOLOv8 AI Surveillance Suite"
        r = requests.post(url, json={"content": msg}, timeout=6)
        if r.status_code in [200, 204]:
            return jsonify({"success": True})
        return jsonify({"success": False, "error": f"Discord returned HTTP {r.status_code}: {r.text[:120]}"}), 400
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

@app.route('/api/test_slack', methods=['POST'])
def test_slack():
    data = request.get_json() or {}
    url = (data.get("url") or system_config.get("slack_webhook_url", "")).strip()
    if not url:
        return jsonify({"success": False, "error": "Missing Slack Webhook URL"}), 400
    try:
        msg = f"🛡️ *DeepCamera Aegis Test Alert*\n✅ Slack notification operational at `{datetime.now().strftime('%H:%M:%S')}`!\nSystem: Local YOLOv8 AI Surveillance Suite"
        r = requests.post(url, json={"text": msg}, timeout=6)
        if r.status_code == 200:
            return jsonify({"success": True})
        return jsonify({"success": False, "error": f"Slack returned HTTP {r.status_code}: {r.text[:120]}"}), 400
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

# ==========================================================
# VISION-LANGUAGE SCENE PERCEPTION & REASONING ENGINE (VLM)
# ==========================================================

def get_gemini_response(prompt, system_instruction="You are DeepCamera AI Guard, an advanced security assistant.", image=None):
    api_key = system_config.get("gemini_api_key", "").strip()
    if not api_key:
        return None
    try:
        genai.configure(api_key=api_key)
        model = genai.GenerativeModel("gemini-2.5-flash", system_instruction=system_instruction)
        contents = [image, prompt] if image is not None else prompt
        response = model.generate_content(contents, request_options={"timeout": 6})
        if response and response.text:
            return response.text.strip()
    except Exception as e:
        print(f"Gemini API Notice: {e}")
    return None

def analyze_live_scene_vlm(deep_camera, prompt_text=""):
    """
    Real-Time Vision-Language Scene Perception Engine.
    Combines YOLOv8 multi-class object detection, Pose ergonomics, Face ID,
    and spatial geometry reasoning to produce rich, human-grade scene narratives
    (e.g., 'One person sitting on PC in living area working on a laptop').
    """
    now_str = datetime.now().strftime("%H:%M:%S")
    with deep_camera.lock:
        if deep_camera.current_raw_frame is not None:
            frame = deep_camera.current_raw_frame.copy()
        elif deep_camera.current_frame is not None:
            frame = deep_camera.current_frame.copy()
        else:
            frame = None

    if frame is None:
        return {
            "timestamp": now_str,
            "scene_zone": "Camera Standby",
            "ambient": "No camera signal",
            "occupants": [],
            "is_on_pc": False,
            "is_fallen": False,
            "detected_summary": "No objects",
            "primary_activity": "Camera feed is currently offline or connecting.",
            "posture": "N/A",
            "threat_level": "🟢 Standby",
            "threat_notes": "Awaiting active camera frame."
        }

    h_frame, w_frame, _ = frame.shape

    # 1. Ambient Lighting Assessment
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    mean_lum = float(np.mean(gray))
    if mean_lum < 42:
        ambient_str = "Dim / Low-light indoor conditions"
    elif mean_lum < 160:
        ambient_str = "Normal indoor ambient lighting"
    else:
        ambient_str = "Bright daylight / Well-illuminated room"

    # 2. Multi-class YOLOv8 Detection Pass across all COCO categories
    detected_items = []
    person_boxes = []
    screen_boxes = []     # laptop, tv, monitor
    chair_boxes = []      # chair, couch
    device_boxes = []     # keyboard, mouse, cell phone, remote
    misc_boxes = []

    if deep_camera.detect_model is not None:
        try:
            results = deep_camera.detect_model(frame, conf=0.25, verbose=False)
            for r in results:
                for b in r.boxes:
                    cls_id = int(b.cls[0])
                    cls_name = deep_camera.detect_model.names.get(cls_id, f"obj_{cls_id}")
                    conf = float(b.conf[0])
                    x1, y1, x2, y2 = map(int, b.xyxy[0].tolist())
                    x1, y1 = max(0, x1), max(0, y1)
                    x2, y2 = min(w_frame, x2), min(h_frame, y2)
                    box_info = {"box": (x1, y1, x2, y2), "class": cls_name, "conf": conf}
                    detected_items.append(cls_name)

                    if cls_name == "person":
                        person_boxes.append(box_info)
                    elif cls_name in ["laptop", "tv"]:
                        screen_boxes.append(box_info)
                    elif cls_name in ["chair", "couch"]:
                        chair_boxes.append(box_info)
                    elif cls_name in ["keyboard", "mouse", "cell phone", "remote"]:
                        device_boxes.append(box_info)
                    else:
                        misc_boxes.append(box_info)
        except Exception as e:
            print(f"VLM Detection error: {e}")

    # 3. Environment & Room Classification
    has_workstation_clues = any(k in detected_items for k in ["laptop", "keyboard", "mouse", "tv", "chair"])
    has_living_clues = any(k in detected_items for k in ["couch", "tv", "remote", "potted plant"])
    has_bedroom_clues = "bed" in detected_items
    has_vehicle_clues = any(k in detected_items for k in ["car", "motorcycle", "truck"])

    if has_workstation_clues:
        scene_zone = "Living Room / Workstation Desk Area"
    elif has_living_clues:
        scene_zone = "Living Area / Lounge Space"
    elif has_bedroom_clues:
        scene_zone = "Bedroom Area"
    elif has_vehicle_clues:
        scene_zone = "Driveway / Parking Zone"
    else:
        scene_zone = "Indoor Living / Surveillance Zone"

    # 4. Pose keypoints inference if available
    pose_results = None
    if deep_camera.pose_model is not None and person_boxes:
        try:
            pose_results = deep_camera.pose_model(frame, conf=0.35, verbose=False)
        except Exception:
            pose_results = None

    occupants = []
    is_anybody_on_pc = False
    is_anybody_fallen = False

    for idx, p_info in enumerate(person_boxes):
        px1, py1, px2, py2 = p_info["box"]
        pw = px2 - px1
        ph = py2 - py1
        p_aspect = pw / max(1, ph)

        # A) Face recognition matching
        head_h = int(ph * 0.35)
        head_crop = frame[py1:py1 + head_h, px1:px2]
        head_feat = extract_face_feature(head_crop)
        matched_name = None
        match_sim = 0.0

        if head_feat is not None and deep_camera.enrolled_faces:
            for en_name, en_info in deep_camera.enrolled_faces.items():
                s = compute_similarity(head_feat, en_info["feat"])
                if s > match_sim:
                    match_sim = s
                    matched_name = en_name

        if match_sim >= 0.65 and matched_name:
            person_name = matched_name
            person_status = f"Recognized Resident: {matched_name} ({int(match_sim * 100)}% match)"
            is_known = True
        else:
            person_name = f"Unregistered Person #{idx + 1}"
            person_status = "Unregistered Individual / Visitor"
            is_known = False

        # B) Posture & Spatial Reasoning
        is_fallen = False
        is_seated = False
        is_working_on_pc = False
        uses_phone = False

        # Check pose keypoints
        if pose_results:
            for pr in pose_results:
                if pr.keypoints is not None and len(pr.keypoints.xy) > 0:
                    for kpts in pr.keypoints.xy:
                        kpts_np = kpts.cpu().numpy()
                        if len(kpts_np) >= 17:
                            nose = kpts_np[0]
                            l_hip, r_hip = kpts_np[11], kpts_np[12]
                            l_knee, r_knee = kpts_np[13], kpts_np[14]
                            if nose[1] > 0 and l_hip[1] > 0:
                                dx = abs(nose[0] - l_hip[0])
                                dy = abs(nose[1] - l_hip[1])
                                if dx > dy * 1.3:
                                    is_fallen = True
                            if l_hip[1] > 0 and l_knee[1] > 0:
                                if abs(l_hip[1] - l_knee[1]) < ph * 0.3:
                                    is_seated = True

        # Fallback bounding box aspect checks
        if not is_fallen and p_aspect >= 1.25 and ph < (h_frame * 0.5):
            is_fallen = True

        # Chair/Couch overlap check
        for c_box in chair_boxes:
            cx1, cy1, cx2, cy2 = c_box["box"]
            if not (px2 < cx1 or px1 > cx2 or py2 < cy1 or py1 > cy2):
                is_seated = True
                break

        # PC / Laptop proximity check
        for s_box in screen_boxes:
            sx1, sy1, sx2, sy2 = s_box["box"]
            p_cx = (px1 + px2) / 2
            s_cx = (sx1 + sx2) / 2
            if abs(p_cx - s_cx) < pw * 1.5:
                if sy1 >= py1 and sy2 <= py2 + 120:
                    is_working_on_pc = True
                    is_seated = True
                    break

        # Device checks (keyboard, mouse, phone)
        for d_box in device_boxes:
            dx1, dy1, dx2, dy2 = d_box["box"]
            d_cls = d_box["class"]
            if not (px2 < dx1 or px1 > dx2 or py2 < dy1 or py1 > dy2 + 60):
                if d_cls in ["keyboard", "mouse"]:
                    is_working_on_pc = True
                    is_seated = True
                elif d_cls == "cell phone":
                    uses_phone = True

        # Heuristic: If person is in workstation environment and seated upright
        if has_workstation_clues and not is_fallen and (is_seated or ph < h_frame * 0.88):
            is_working_on_pc = True
            is_seated = True

        if is_working_on_pc:
            is_anybody_on_pc = True
        if is_fallen:
            is_anybody_fallen = True

        # Formulate activity & ergonomics strings
        if is_fallen:
            act = "Fallen down / lying on floor in distress"
            pos = "Horizontal recumbent posture"
        elif is_working_on_pc:
            phone_part = " while also holding a smartphone" if uses_phone else ""
            act = f"Sitting in front of PC/laptop at computer desk, actively working{phone_part}"
            pos = "Upright seated posture facing display screen with hands engaged at desk"
        elif is_seated and has_living_clues:
            act = "Relaxing seated on the couch/sofa in living area"
            pos = "Comfortable upright seated posture"
        elif is_seated:
            act = "Seated on chair, observing surroundings"
            pos = "Upright seated posture"
        else:
            act = "Standing upright, monitoring or moving in the room"
            pos = "Upright standing posture"

        occupants.append({
            "name": person_name,
            "status": person_status,
            "is_known": is_known,
            "is_working_on_pc": is_working_on_pc,
            "is_fallen": is_fallen,
            "activity": act,
            "posture": pos
        })

    # Summary of detected objects
    obj_counts = {}
    for itm in detected_items:
        obj_counts[itm] = obj_counts.get(itm, 0) + 1
    detected_summary = ", ".join(f"{cnt} {cls_name.capitalize()}" for cls_name, cnt in obj_counts.items()) if obj_counts else "No prominent physical objects"

    # Overall primary activity narrative
    if occupants:
        p_names = [o["name"] for o in occupants]
        if is_anybody_on_pc:
            pc_occ = next(o for o in occupants if o["is_working_on_pc"])
            primary_activity_narrative = (
                f"One person [{pc_occ['name']}] is sitting on PC in the {scene_zone}, "
                f"actively working on the computer in an attentive upright posture."
            )
            posture_narrative = pc_occ["posture"]
        elif is_anybody_fallen:
            primary_activity_narrative = f"EMERGENCY: One person [{occupants[0]['name']}] is detected fallen on the floor!"
            posture_narrative = "Recumbent horizontal posture detected."
        else:
            primary_activity_narrative = f"{len(occupants)} person(s) present ({', '.join(p_names)}). Engaged in: {occupants[0]['activity']}."
            posture_narrative = occupants[0]["posture"]
    else:
        primary_activity_narrative = f"The {scene_zone} is currently unoccupied. No persons or human movement detected."
        posture_narrative = "N/A (Clear area)"

    # Threat & Security level
    if is_anybody_fallen:
        threat_level = "🚨 CRITICAL (Emergency Fall)"
        threat_notes = "Fall detected. Immediate physical check and assistance required!"
    elif any(not o["is_known"] for o in occupants):
        threat_level = "🟡 Moderate (Visitor Present)"
        threat_notes = "Unregistered individual observed. Normal benign behavior, no security breach."
    elif occupants:
        threat_level = "🟢 Safe (Normal Routine)"
        threat_notes = f"Verified resident activity in normal expected routine. No perimeter alerts."
    else:
        threat_level = "🟢 Safe (Perimeter Clear)"
        threat_notes = "No movement or unauthorized presence detected in monitored zone."

    return {
        "timestamp": now_str,
        "scene_zone": scene_zone,
        "ambient": ambient_str,
        "occupants": occupants,
        "is_on_pc": is_anybody_on_pc,
        "is_fallen": is_anybody_fallen,
        "detected_summary": detected_summary,
        "primary_activity": primary_activity_narrative,
        "posture": posture_narrative,
        "threat_level": threat_level,
        "threat_notes": threat_notes
    }


# ==========================================================
# AI SECURITY GUARD CHATBOT ENGINE
# ==========================================================

def process_ai_guard_query(text):
    text_clean = text.lower().strip()
    now_str = datetime.now().strftime("%H:%M:%S")

    # 1. Snapshot / Live Photo Command
    if any(k in text_clean for k in ["photo", "snapshot", "picture", "tasveer", "dikhao", "capture"]):
        filename = deep_camera.capture_snapshot()
        scene = analyze_live_scene_vlm(deep_camera, text)
        if filename:
            return {
                "reply": (
                    f"📸 **Live Snapshot Captured ({now_str})**\n\n"
                    f"• **Scene Analysis:** {scene['primary_activity']}\n"
                    f"• **Safety Status:** {scene['threat_level']}"
                ),
                "photo_url": f"/snapshots/{filename}",
                "filename": filename
            }
        return {"reply": "❌ Camera frame not ready for snapshot.", "photo_url": None}

    # 2. Privacy Commands
    elif "privacy on" in text_clean or "blind mode" in text_clean:
        system_config["active_mode"] = "privacy"
        system_config["privacy_blur"] = True
        save_config(system_config)
        return {"reply": "🛡️ Privacy Masking Mode activated on the camera feed.", "photo_url": None}

    elif "privacy off" in text_clean:
        system_config["active_mode"] = "surveillance"
        system_config["privacy_blur"] = False
        save_config(system_config)
        return {"reply": "🔓 Privacy Masking disabled. Standard clear surveillance active.", "photo_url": None}

    scene = analyze_live_scene_vlm(deep_camera, text)

    # 3. If Gemini is available, use Gemini Multimodal Vision AI!
    if system_config.get("gemini_api_key", "").strip():
        live_img = None
        with deep_camera.lock:
            if deep_camera.current_frame is not None:
                try:
                    rgb = cv2.cvtColor(deep_camera.current_frame, cv2.COLOR_BGR2RGB)
                    h_c, w_c = rgb.shape[:2]
                    if w_c > 640:
                        rgb = cv2.resize(rgb, (640, int(h_c * 640 / w_c)))
                    live_img = Image.fromarray(rgb)
                except Exception:
                    pass

        sys_prompt = (
            "You are DeepCamera AI Guard, an elite security officer and surveillance assistant. "
            "You are watching the live CCTV security camera feed and edge YOLO telemetry. "
            "Answer the user concisely, smartly, and accurately. "
            "If the user asks in Hindi or Hinglish, reply naturally in Hindi or Hinglish. "
            "Highlight security status, occupancy, what the person is doing, and safety."
        )

        prompt = (
            f"User Question: '{text}'\n\n"
            f"Real-Time CCTV Edge Telemetry:\n{json.dumps(scene, indent=2)}"
        )

        gemini_reply = get_gemini_response(prompt, system_instruction=sys_prompt, image=live_img)
        if gemini_reply:
            return {"reply": f"🤖 **DeepCamera AI Guard (Gemini AI)**:\n\n{gemini_reply}", "photo_url": None}

    # --- Local Offline Rule-Based Fallback ---
    # Greetings
    if any(k in text_clean for k in ["hi", "hello", "hey", "namaste", "pranam", "kya haal"]):
        return {
            "reply": (
                f"👋 Hello! I am your DeepCamera AI Security Guard Assistant.\n\n"
                f"Currently monitoring **{scene['scene_zone']}** at {now_str}.\n"
                f"• **Quick Glimpse:** {scene['primary_activity']}\n"
                f"• **Security Status:** {scene['threat_level']}\n\n"
                "Ask me about the live scene, who is at the PC, request photos, or check fall safety!"
            ),
            "photo_url": None
        }

    # PC / Laptop
    elif any(k in text_clean for k in ["pc", "computer", "laptop", "desk", "workstation", "baitha", "sitting"]):
        if scene["is_on_pc"]:
            pc_occ = next((o for o in scene["occupants"] if o["is_working_on_pc"]), scene["occupants"][0])
            reply = (
                f"🖥️ **Live Workstation Assessment** ({now_str}):\n\n"
                f"✅ **Yes, Confirmed:** One person (**{pc_occ['name']}**) is sitting in front of the PC/laptop in the {scene['scene_zone']}.\n\n"
                f"• **Current Activity:** {pc_occ['activity']}.\n"
                f"• **Posture & Ergonomics:** {pc_occ['posture']}. Upright alignment, no distress or fall detected.\n"
                f"• **Detected Objects:** {scene['detected_summary']}.\n"
                f"• **Atmosphere:** {scene['ambient']}.\n"
                f"• **Security Status:** {scene['threat_level']} — {scene['threat_notes']}"
            )
        elif scene["occupants"]:
            occ = scene["occupants"][0]
            reply = (
                f"🖥️ **Workstation Assessment** ({now_str}):\n\n"
                f"👀 A person (**{occ['name']}**) is present in the {scene['scene_zone']}, but they are not actively sitting at the PC right now.\n\n"
                f"• **Current Action:** {occ['activity']}.\n"
                f"• **Posture:** {occ['posture']}.\n"
                f"• **Security Status:** {scene['threat_level']}."
            )
        else:
            reply = (
                f"🖥️ **Workstation Assessment** ({now_str}):\n\n"
                f"❌ **No:** No one is currently sitting at the PC. The {scene['scene_zone']} is completely empty and clear.\n\n"
                f"• **Detected In Area:** {scene['detected_summary']}."
            )
        return {"reply": reply, "photo_url": None}

    # Scene
    elif any(k in text_clean for k in ["what is happening", "kya chal raha", "describe", "scene", "overview", "room", "details", "situation", "batao", "samjhao"]):
        reply = (
            f"📍 **DeepCamera Live Scene Perception & Activity Analysis**\n"
            f"*Zone: {scene['scene_zone']} | Time: {now_str} | Source: Camera {deep_camera.source}*\n\n"
            f"• **Primary Activity:** {scene['primary_activity']}\n"
            f"• **Posture & Ergonomics:** {scene['posture']}\n"
            f"• **Detected Entities:** {scene['detected_summary']}\n"
            f"• **Ambient Environment:** {scene['ambient']} (Edge throughput: {deep_camera.fps:.1f} FPS, {deep_camera.latency_ms:.0f}ms latency)\n"
            f"• **Threat & Safety Assessment:** {scene['threat_level']} — {scene['threat_notes']}"
        )
        return {"reply": reply, "photo_url": None}

    # Occupancy
    elif any(k in text_clean for k in ["who", "kon hai", "koi hai", "person", "intruder", "stranger", "face", "kaun"]):
        if not scene["occupants"]:
            reply = f"👀 The camera view ({scene['scene_zone']}) is completely clear right now. No persons detected at {now_str}."
        else:
            occ_lines = []
            for o in scene["occupants"]:
                occ_lines.append(f"• **{o['name']}** ({o['status']})\n  ↳ *Activity:* {o['activity']}\n  ↳ *Posture:* {o['posture']}")
            reply = (
                f"🔍 **Occupancy & Facial Recognition Report** ({now_str}):\n\n"
                + "\n\n".join(occ_lines) + "\n\n"
                f"• **Zone:** {scene['scene_zone']}\n"
                f"• **Security Status:** {scene['threat_level']} — {scene['threat_notes']}"
            )
        return {"reply": reply, "photo_url": None}

    # Fall Safety
    elif any(k in text_clean for k in ["fall", "gir gaya", "safety", "chot", "patient", "emergency"]):
        if scene["is_fallen"]:
            return {
                "reply": "🚨 **EMERGENCY: FALL DETECTED!** A person in the camera view is detected lying horizontally in distress! Immediate assistance required!",
                "photo_url": None
            }
        elif scene["occupants"]:
            return {
                "reply": f"✅ **Safety Verified:** All {len(scene['occupants'])} person(s) in view are upright and safe. {scene['posture']}. No fall postures detected.",
                "photo_url": None
            }
        else:
            return {
                "reply": f"✅ **Perimeter Clear:** No persons or emergency postures in the surveillance area at {now_str}.",
                "photo_url": None
            }

    # Telemetry
    elif any(k in text_clean for k in ["status", "halat", "update", "system", "health", "fps"]):
        reply = (
            f"🛡️ **DeepCamera Aegis System Telemetry** ({now_str}):\n"
            f"• **Stream:** {deep_camera.status} (Source: Camera {deep_camera.source})\n"
            f"• **Edge Performance:** {deep_camera.fps:.1f} FPS | {deep_camera.latency_ms:.0f}ms Latency\n"
            f"• **Active Mode:** {system_config.get('active_mode', 'surveillance').upper()}\n"
            f"• **Current Scene:** {scene['scene_zone']} ({scene['ambient']})\n"
            f"• **Primary Activity:** {scene['primary_activity']}\n"
            f"• **Threat Level:** {scene['threat_level']}\n"
            f"• **Enrolled Faces:** {len(deep_camera.enrolled_faces)} profile(s) active"
        )
        return {"reply": reply, "photo_url": None}

    # Parking
    elif any(k in text_clean for k in ["parking", "car", "gaadi", "slot", "vehicle"]):
        p = deep_camera.parking_status
        return {
            "reply": f"🅿️ **Parking Lot Report:** {p.get('occupied', 0)} out of {p.get('total', 4)} slots occupied.",
            "photo_url": None
        }

    return {
        "reply": (
            f"🤖 **DeepCamera AI Guard ({now_str})**:\n\n"
            f"• **Live Activity:** {scene['primary_activity']}\n"
            f"• **Zone & Lighting:** {scene['scene_zone']} ({scene['ambient']})\n"
            f"• **Security Status:** {scene['threat_level']}"
        ),
        "photo_url": None
    }

def process_recorded_video_query(text, log, video_id):
    text_clean = text.lower().strip()
    total_sec = len(log)
    
    missing_events = [ev for ev in log if ev.get("missing")]
    fall_events = [ev for ev in log if ev.get("fall")]
    intruder_events = [ev for ev in log if ev.get("intruders", 0) > 0]
    all_objects = set()
    for ev in log:
        if "objects" in ev:
            all_objects.update(ev["objects"])

    # Extract keyframe from recorded video if .mp4 exists
    video_path = RECORDINGS_DIR / f"{video_id}.mp4"
    keyframe_img = None
    if video_path.exists():
        try:
            vcap = cv2.VideoCapture(str(video_path))
            v_frames = int(vcap.get(cv2.CAP_PROP_FRAME_COUNT))
            if v_frames > 0:
                vcap.set(cv2.CAP_PROP_POS_FRAMES, min(15, max(0, v_frames // 2)))
                vret, vframe = vcap.read()
                if vret and vframe is not None:
                    rgb = cv2.cvtColor(vframe, cv2.COLOR_BGR2RGB)
                    h_v, w_v = rgb.shape[:2]
                    if w_v > 640:
                        rgb = cv2.resize(rgb, (640, int(h_v * 640 / w_v)))
                    keyframe_img = Image.fromarray(rgb)
            vcap.release()
        except Exception:
            pass

    # Gemini AI Forensic Analysis
    if system_config.get("gemini_api_key", "").strip():
        timeline_summary = {
            "recording_file": f"{video_id}.mp4",
            "duration_seconds": total_sec,
            "missing_person_detected": len(missing_events) > 0,
            "missing_person_details": missing_events[:5] if missing_events else "None",
            "fall_emergency_detected": len(fall_events) > 0,
            "fall_events": fall_events[:5] if fall_events else "None",
            "intruders_detected": len(intruder_events) > 0,
            "detected_objects": list(all_objects),
            "timeline_sample": log[:40]
        }

        sys_prompt = (
            "You are DeepCamera AI Guard, an expert forensic CCTV video investigator. "
            "You are given a recorded CCTV video keyframe and its second-by-second forensic event timeline log. "
            "Analyze the timeline and keyframe, and answer the user's question clearly, professionally, and accurately. "
            "If the user asks in Hindi or Hinglish, answer naturally in Hindi or Hinglish. "
            "Directly state whether a missing person was found, if someone fell, what objects were seen, or what happened."
        )

        prompt = (
            f"User Question: '{text}'\n\n"
            f"Recorded Video Telemetry Summary:\n{json.dumps(timeline_summary, indent=2)}\n\n"
            f"Full Timeline Log:\n{json.dumps(log, indent=2)}"
        )

        gemini_reply = get_gemini_response(prompt, system_instruction=sys_prompt, image=keyframe_img)
        if gemini_reply:
            return {"reply": f"📼 **Gemini Video Investigator ({video_id}.mp4)**:\n\n{gemini_reply}", "photo_url": None}

    # --- Rule-Based Fallback ---
    if any(k in text_clean for k in ["missing", "gum", "dhundo", "person", "lost"]):
        if not missing_events:
            return {"reply": f"🔍 **Video Investigation:** No missing persons were detected anywhere in the {total_sec} seconds of `{video_id}.mp4`.", "photo_url": None}
        times = [ev["time"] for ev in missing_events]
        name = missing_events[0].get("missing_name", "Target")
        return {"reply": f"🚨 **Missing Person Found in Recording!**\n\nTarget **{name}** was spotted in this video.\n• First spotted at: {times[0]}\n• Last spotted at: {times[-1]}\n\nThe missing person was successfully tracked during this recording session.", "photo_url": None}

    elif any(k in text_clean for k in ["fall", "gir gaya", "safety", "chot", "patient", "emergency", "gira"]):
        if not fall_events:
            return {"reply": f"✅ **Safety Verified:** No falls or emergency postures were detected in `{video_id}.mp4`.", "photo_url": None}
        return {"reply": f"🚨 **EMERGENCY (Recorded):** A fall was detected in this recording!\n\n• The incident occurred around {fall_events[0]['time']}.\nImmediate review of the footage is recommended.", "photo_url": None}

    elif any(k in text_clean for k in ["intruder", "stranger", "who", "kon hai", "koi hai", "unauthorized"]):
        if not intruder_events:
            return {"reply": f"🛡️ **Security Clear:** No strangers or unauthorized persons were detected during this recording.", "photo_url": None}
        max_intruders = max([ev["intruders"] for ev in intruder_events])
        return {"reply": f"⚠️ **Intruders Detected!**\n\nUp to {max_intruders} stranger(s) were observed in the recording `{video_id}.mp4`.\n• First seen at: {intruder_events[0]['time']}", "photo_url": None}

    obj_str = ", ".join(all_objects) if all_objects else "None"
    return {
        "reply": (
            f"📼 **Recorded Video Analysis ({video_id}.mp4)**:\n\n"
            f"• **Duration:** {total_sec} seconds\n"
            f"• **Objects Detected:** {obj_str}\n"
            f"• **Missing Person:** {'Yes! Found!' if missing_events else 'No'}\n"
            f"• **Fall/Emergency:** {'Yes! Fall detected!' if fall_events else 'No'}"
        ),
        "photo_url": None
    }


@app.route('/api/chat', methods=['POST'])
def api_chat():
    data = request.get_json() or {}
    user_msg = data.get("message", "").strip()
    target_video = data.get("video_id", "live")
    
    if not user_msg:
        return jsonify({"reply": "Please type a message."})
        
    if target_video != "live":
        json_path = RECORDINGS_DIR / f"{target_video}.json"
        if json_path.exists():
            try:
                with open(json_path) as f:
                    log = json.load(f)
                res = process_recorded_video_query(user_msg, log, target_video)
                return jsonify(res)
            except Exception as e:
                return jsonify({"reply": f"Error analyzing recording: {e}"})
        else:
            return jsonify({"reply": f"Could not find analysis data for recording {target_video}."})
            
    res = process_ai_guard_query(user_msg)
    return jsonify(res)

# Background Poller for Interactive Telegram Chatbot
def telegram_chatbot_poller():
    last_update_id = 0
    try:
        t = system_config.get("telegram_token", "").replace(" ", "").strip()
        if t:
            r = requests.get(f"https://api.telegram.org/bot{t}/getUpdates", timeout=5).json()
            if r.get("ok") and r.get("result"):
                last_update_id = r["result"][-1]["update_id"]
    except Exception:
        pass

    while True:
        token = system_config.get("telegram_token", "").replace(" ", "").strip()
        allowed_chat_id = str(system_config.get("telegram_chat_id", "")).strip()
        if token and allowed_chat_id and system_config.get("telegram_enabled"):
            try:
                url = f"https://api.telegram.org/bot{token}/getUpdates"
                params = {"offset": last_update_id + 1, "timeout": 3}
                r = requests.get(url, params=params, timeout=6).json()
                if r.get("ok") and r.get("result"):
                    for upd in r["result"]:
                        last_update_id = upd["update_id"]
                        msg = upd.get("message", {})
                        text = msg.get("text", "").strip()
                        sender_id = str(msg.get("chat", {}).get("id", ""))

                        if text and sender_id == allowed_chat_id:
                            if text == "/start":
                                continue
                            ans = process_ai_guard_query(text)
                            reply_text = ans.get("reply", "")
                            photo_fn = ans.get("filename")

                            if photo_fn and (SNAPSHOTS_DIR / photo_fn).exists():
                                with open(SNAPSHOTS_DIR / photo_fn, "rb") as pf:
                                    requests.post(
                                        f"https://api.telegram.org/bot{token}/sendPhoto",
                                        data={"chat_id": sender_id, "caption": reply_text},
                                        files={"photo": pf},
                                        timeout=6
                                    )
                            else:
                                requests.post(
                                    f"https://api.telegram.org/bot{token}/sendMessage",
                                    json={"chat_id": sender_id, "text": reply_text},
                                    timeout=5
                                )
            except Exception:
                pass
        time.sleep(1.5)

threading.Thread(target=telegram_chatbot_poller, daemon=True).start()


if __name__ == '__main__':
    print("=" * 65)
    print(" 🚀 DeepCamera Complete AI Studio started!")
    print(" Access at: http://127.0.0.1:5000")
    print("=" * 65)
    app.run(host='0.0.0.0', port=5000, debug=False, threaded=True)
