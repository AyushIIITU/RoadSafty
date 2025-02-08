import React, { useState, useRef, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Link } from 'react-router-dom';
import { Camera } from 'lucide-react';
import axios from 'axios';

// ============================================
// Capture & Detect Screen (REST based detection)
// ============================================
function CaptureDetectionScreen() {
  const [detections, setDetections] = useState([]);
  const [threshold, setThreshold] = useState(0.5);
  const [latitude, setLatitude] = useState(null);
  const [longitude, setLongitude] = useState(null);
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const fileInputRef = useRef(null);

  // Get geolocation on mount
  useEffect(() => {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLatitude(position.coords.latitude);
        setLongitude(position.coords.longitude);
      },
      (error) => console.error('Error getting location:', error)
    );
  }, []);

  // Capture a frame from the video feed and send to backend
  const captureFrameAndSend = async () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    const ctx = canvas.getContext('2d');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    // Convert canvas content to data URL then to Blob
    const frameData = canvas.toDataURL('image/jpeg');
    try {
      const blob = await (await fetch(frameData)).blob();
      const formData = new FormData();
      formData.append('file', blob, 'frame.jpg');
      formData.append('threshold', threshold);
      formData.append('latitude', latitude);
      formData.append('longitude', longitude);

      const response = await axios.post('http://localhost:8000/upload_frame/', formData);
      console.log(response.data);
      setDetections(response.data.detections);
    } catch (error) {
      console.error('Error uploading frame:', error);
    }
  };

  // Handle file upload from disk
  const handleFileUpload = async (event) => {
    const file = event.target.files[0];
    if (file) {
      try {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('threshold', threshold);
        formData.append('latitude', latitude);
        formData.append('longitude', longitude);
        const response = await axios.post('http://localhost:8000/upload_frame/', formData);
        console.log(response.data);
        setDetections(response.data.detections);
      } catch (error) {
        console.error('Error uploading file:', error);
      }
    }
  };

  // Draw detection boxes over the video image
  const drawDetections = () => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!canvas || !ctx || !videoRef.current) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    // Draw current video frame as background
    ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);

    detections.forEach((detection) => {
      const [x1, y1, x2, y2] = detection.box;
      ctx.strokeStyle = 'red';
      ctx.lineWidth = 2;
      ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
      ctx.fillStyle = 'red';
      ctx.font = '12px Arial';
      ctx.fillText(
        `${detection.label} (${(detection.score * 100).toFixed(1)}%)`,
        x1,
        y1 - 5
      );
    });
  };

  // Redraw overlay when detections change
  useEffect(() => {
    if (detections.length > 0) {
      drawDetections();
    }
  }, [detections]);

  return (
    <div className="flex flex-col items-center p-4">
      <h1 className="text-2xl font-bold mb-4">Capture & Detect</h1>
      <div className="w-full max-w-xl bg-white shadow-md rounded-lg p-4">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="rounded-lg w-full"
        />
        <canvas ref={canvasRef} className="w-full rounded-lg mt-2" />
        <div className="mt-4 flex items-center space-x-4">
          <button
            onClick={() =>
              navigator.mediaDevices.getUserMedia({ video: true }).then((stream) => {
                videoRef.current.srcObject = stream;
              })
            }
            className="flex items-center bg-blue-500 text-white px-4 py-2 rounded-lg hover:bg-blue-600 transition"
          >
            <Camera className="mr-2" /> Start Camera
          </button>
          <button
            onClick={captureFrameAndSend}
            className="bg-gray-600 text-white px-4 py-2 rounded-lg hover:bg-gray-700 transition"
          >
            Capture & Detect
          </button>
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileUpload}
            className="bg-gray-200 text-black px-4 py-2 rounded-lg transition"
          />
        </div>
        <div className="mt-4">
          <label htmlFor="threshold" className="block text-sm font-medium">
            Confidence Threshold
          </label>
          <input
            id="threshold"
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={threshold}
            onChange={(e) => setThreshold(Number(e.target.value))}
            className="w-full mt-2"
          />
          <span>{threshold}</span>
        </div>
      </div>
      {detections.length > 0 && (
        <div className="w-full max-w-xl mt-4 bg-white shadow-md rounded-lg p-4">
          <h2 className="text-xl font-bold mb-2">Detections</h2>
          <ul>
            {detections.map((detection, index) => (
              <li key={index} className="mb-2">
                {detection.label} ({detection.score.toFixed(2)} confidence)
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="mt-6">
        <Link to="/realtime" className="text-blue-600 underline">
          Go to Realtime Detection
        </Link>
      </div>
    </div>
  );
}
export default CaptureDetectionScreen;