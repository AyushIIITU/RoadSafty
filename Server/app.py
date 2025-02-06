import logging
import queue
import threading
from pathlib import Path
from typing import List, NamedTuple

import cv2
import numpy as np
from flask import Flask, render_template, Response, request, jsonify
from ultralytics import YOLO

app = Flask(__name__)

# Load YOLO model
MODEL_PATH = "./models/YOLOv8_Small_RDD.pt"
model = YOLO(MODEL_PATH)

# Class labels
CLASSES = ["Longitudinal Crack", "Transverse Crack", "Alligator Crack", "Potholes"]

detection_queue = queue.Queue()

def get_video_frames(conf_threshold=0.5):
    cap = cv2.VideoCapture(0)
    while True:
        ret, frame = cap.read()
        if not ret:
            break
        
        h_ori, w_ori, _ = frame.shape
        image_resized = cv2.resize(frame, (640, 640))
        results = model.predict(image_resized, conf=conf_threshold)
        detections = []
        
        for result in results:
            boxes = result.boxes.cpu().numpy()
            for _box in boxes:
                x1, y1, x2, y2 = map(int, _box.xyxy[0])
                label = CLASSES[int(_box.cls)]
                conf = float(_box.conf)
                cv2.rectangle(frame, (x1, y1), (x2, y2), (0, 255, 0), 2)
                cv2.putText(frame, f"{label} ({conf:.2f})", (x1, y1 - 10), 
                            cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 255, 0), 2)
                detections.append({"label": label, "confidence": conf, "box": [x1, y1, x2, y2]})
        
        detection_queue.put(detections)
        
        ret, buffer = cv2.imencode(".jpg", frame)
        frame_bytes = buffer.tobytes()
        yield (b'--frame\r\n' b'Content-Type: image/jpeg\r\n\r\n' + frame_bytes + b'\r\n')
    cap.release()

@app.route('/')
def index():
    return render_template("index.html")

@app.route('/video_feed')
def video_feed():
    conf_threshold = float(request.args.get("conf", 0.5))
    return Response(get_video_frames(conf_threshold), mimetype='multipart/x-mixed-replace; boundary=frame')

@app.route('/detections')
def detections():
    if not detection_queue.empty():
        latest_detections = detection_queue.get()
    else:
        latest_detections = []
    return jsonify(latest_detections)

if __name__ == "__main__":
    app.run(host='0.0.0.0', port=5000, debug=True)
