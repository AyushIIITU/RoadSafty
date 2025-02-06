import logging
import queue
from pathlib import Path
from typing import List, NamedTuple

import cv2
import numpy as np
import torch
from ultralytics import YOLO

# Set logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Load YOLOv8 Model
MODEL_PATH = "./models/YOLOv8_Small_RDD.pt"
if not Path(MODEL_PATH).exists():
    logger.error(f"Model file not found at {MODEL_PATH}. Download or place the file in the correct location.")
    exit(1)

net = YOLO(MODEL_PATH)

CLASSES = [
    "Longitudinal Crack",
    "Transverse Crack",
    "Alligator Crack",
    "Potholes"
]

class Detection(NamedTuple):
    class_id: int
    label: str
    score: float
    box: np.ndarray

# Confidence threshold slider (can be adjusted dynamically)
score_threshold = 0.5

# OpenCV Video Capture
cap = cv2.VideoCapture(0)  # Change to 1 or another number if the webcam is not detected

if not cap.isOpened():
    logger.error("Error: Could not open webcam.")
    exit(1)

logger.info("Press 'q' to exit.")

while True:
    ret, frame = cap.read()
    if not ret:
        logger.warning("Failed to grab frame.")
        break

    h_ori, w_ori, _ = frame.shape
    image_resized = cv2.resize(frame, (640, 640), interpolation=cv2.INTER_AREA)
    
    # Run YOLO inference
    results = net.predict(image_resized, conf=score_threshold)

    # Process detection results
    if results:
        for result in results:
            boxes = result.boxes.cpu().numpy()
            for _box in boxes:
                class_id = int(_box.cls)
                label = CLASSES[class_id]
                score = float(_box.conf)
                x1, y1, x2, y2 = map(int, _box.xyxy[0])
                
                # Draw bounding box and label
                color = (0, 255, 0)  # Green for bounding boxes
                cv2.rectangle(frame, (x1, y1), (x2, y2), color, 2)
                text = f"{label}: {score:.2f}"
                cv2.putText(frame, text, (x1, y1 - 10), cv2.FONT_HERSHEY_SIMPLEX, 0.5, color, 2)

    # Show the processed frame
    cv2.imshow("Road Damage Detection", frame)

    # Exit condition
    if cv2.waitKey(1) & 0xFF == ord('q'):
        break

# Release resources
cap.release()
cv2.destroyAllWindows()
