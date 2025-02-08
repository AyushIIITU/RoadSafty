import os
import json
import logging
import tempfile
from pathlib import Path
from typing import NamedTuple
import asyncio
from fastapi import FastAPI, File, Form, UploadFile, WebSocket
from fastapi.responses import JSONResponse, FileResponse
from sqlalchemy import create_engine, Table, Column, Float, MetaData, String
from sqlalchemy.orm import sessionmaker
import numpy as np
import cv2
from ultralytics import YOLO
from sqlalchemy import select
from fastapi.websockets import WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware



# Replace asyncio.to_thread() with this function for backward compatibility
import concurrent.futures

async def run_in_threadpool(func, *args):
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, func, *args)


# Initialize app and logger
app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
logger = logging.getLogger("RoadDamageServer")
logger.setLevel(logging.INFO)

# Database setup
database_url = "sqlite:///./detections.db"
engine = create_engine(database_url, connect_args={"check_same_thread": False})
metadata = MetaData()
detection_table = Table(
    "detections", metadata,
    Column("threshold", Float),
    Column("damage_type", String),
    Column("latitude", Float),
    Column("longitude", Float)
)
metadata.create_all(engine)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# Model setup
MODEL_LOCAL_PATH = "./models/YOLOv8_Small_RDD.pt"
net = YOLO(MODEL_LOCAL_PATH)

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
    box: list  # Changed from np.ndarray to list
    latitude: float = None
    longitude: float = None

@app.post("/process")
async def handle_processing(video: UploadFile, confidence_threshold: float = Form(0.5)):
    if not video.filename:
        return JSONResponse({"error": "No video file provided"}, status_code=400)

    # Create temp directories
    with tempfile.TemporaryDirectory() as temp_dir:
        input_path = os.path.join(temp_dir, "input.mp4")
        output_path = os.path.join(temp_dir, "output.mp4")
        
        # Save uploaded file
        with open(input_path, "wb") as f:
            f.write(await video.read())
        
        try:
            process_video(input_path, output_path, confidence_threshold)
        except Exception as e:
            return JSONResponse({"error": str(e)}, status_code=500)
        
        return FileResponse(output_path, media_type="video/mp4", filename="processed_video.mp4")


def process_video(input_path, output_path, score_threshold):
    videoCapture = cv2.VideoCapture(input_path)
    if not videoCapture.isOpened():
        raise ValueError("Error opening video file")
    
    width = int(videoCapture.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(videoCapture.get(cv2.CAP_PROP_FRAME_HEIGHT))
    fps = videoCapture.get(cv2.CAP_PROP_FPS)

    fourcc = cv2.VideoWriter_fourcc(*'mp4v')
    cv2writer = cv2.VideoWriter(output_path, fourcc, fps, (width, height))

    while videoCapture.isOpened():
        ret, frame = videoCapture.read()
        if not ret:
            break

        frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        image_resized = cv2.resize(frame, (640, 640), interpolation=cv2.INTER_AREA)
        
        results = net.predict(image_resized, conf=score_threshold)
        annotated_frame = results[0].plot()
        
        out_frame = cv2.resize(annotated_frame, (width, height), interpolation=cv2.INTER_AREA)
        out_frame = cv2.cvtColor(out_frame, cv2.COLOR_RGB2BGR)
        cv2writer.write(out_frame)

    videoCapture.release()
    cv2writer.release()

@app.get("/detections/")
async def get_detections():
    db = SessionLocal()
    try:
        query = select(detection_table)
        results = db.execute(query).fetchall()
        detections = [{"threshold": row.threshold, "damage_type": row.damage_type, 
                        "latitude": row.latitude, "longitude": row.longitude} for row in results]
        return {"detections": detections}
    except Exception as e:
        return {"error": f"Failed to retrieve detections: {str(e)}"}
    finally:
        db.close()

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    # await websocket.accept()
    # logger.info("WebSocket connection accepted")
    try:
        await websocket.accept()
        logger.info("WebSocket connection accepted")
    except Exception as e:
        logger.error(f"Failed to accept WebSocket connection: {e}")
        return
    try:
        while True:
            try:
                metadata_text = await websocket.receive_text()
                metadata = json.loads(metadata_text)
                threshold = metadata.get("threshold", 0.5)
            except json.JSONDecodeError:
                await websocket.send_json({"error": "Invalid metadata format"})
                continue

            try:
                frame_data = await websocket.receive_bytes()
                if not frame_data:
                    await websocket.send_json({"error": "No image data received"})
                    continue
                image = cv2.imdecode(np.frombuffer(frame_data, dtype=np.uint8), cv2.IMREAD_COLOR)
                if image is None:
                    await websocket.send_json({"error": "Invalid image data"})
                    continue
            except Exception as e:
                logger.error(f"Error receiving image: {e}")
                await websocket.send_json({"error": "Image receiving error"})
                continue

            try:
                image_resized = cv2.resize(image, (640, 640), interpolation=cv2.INTER_AREA)
                results = await run_in_threadpool(net.predict, image_resized, threshold)

            except Exception as e:
                logger.error(f"Prediction error: {e}")
                await websocket.send_json({"error": "Prediction error"})
                continue
             

            response_data = []
            for result in results:
                boxes_np = result.boxes.xyxy.cpu().numpy()
                scores_np = result.boxes.conf.cpu().numpy()  # Get confidence scores
                classes_np = result.boxes.cls.cpu().numpy()  # Get class IDs

                for i in range(len(boxes_np)):
                    x1, y1, x2, y2 = boxes_np[i]
                    conf = scores_np[i]
                    cls = classes_np[i]
                    response_data.append({
                        "class_id": int(cls),
                        "label": CLASSES[int(cls)],
                        "score": float(conf),
                        "box": [int(x1), int(y1), int(x2), int(y2)],
                    })

            '''for result in results:
                boxes_np = result.boxes.xyxy.cpu().numpy()
                for det in boxes_np:
                    if det.shape[0] == 6:  # Full detection with conf and class
                        x1, y1, x2, y2, conf, cls = det
                        response_data.append({
                        "class_id": int(cls),
                        "label": CLASSES[int(cls)],
                        "score": float(conf),
                        "box": [int(x1), int(y1), int(x2), int(y2)],
                    })
                    elif det.shape[0] == 4:  # Detection without conf and class
                        x1, y1, x2, y2 = det
                        response_data.append({
                        "box": [int(x1), int(y1), int(x2), int(y2)],
                        "label": "Unknown",
                        "score": 0.0,
                        "class_id": -1,
                    })'''
            '''for result in results:
                boxes_np = result.boxes.xyxy.cpu().numpy()
                for det in boxes_np:
                    x1, y1, x2, y2, conf, cls = det
                    response_data.append({
                        "class_id": int(cls),
                        "label": CLASSES[int(cls)],
                        "score": float(conf),
                        "box": [int(x1), int(y1), int(x2), int(y2)],
                    })
'''
            await websocket.send_json(response_data)
    except WebSocketDisconnect:
        logger.info("WebSocket disconnected")
    except Exception as e:
        logger.error(f"Unexpected error: {e}")
    finally:
        await websocket.close()
        logger.info("WebSocket connection closed")
