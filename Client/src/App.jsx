import React, { useState, useRef, useEffect } from 'react';
import { Camera } from 'lucide-react';
import axios from 'axios';

function App() {
  const [detections, setDetections] = useState([]);
  const [threshold, setThreshold] = useState(0.5);
  const [latitude, setLatitude] = useState(null);
  const [longitude, setLongitude] = useState(null);
  const [frame, setFrame] = useState(null);  // Add state for the frame
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const ws = useRef(null);

  useEffect(() => {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLatitude(position.coords.latitude);
        setLongitude(position.coords.longitude);
      },
      (error) => console.error('Error getting location:', error)
    );
  }, []);

  const captureFrameAndSend = async () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const frameData = canvas.toDataURL('image/jpeg');

    try {
      const formData = new FormData();
      formData.append('file', await (await fetch(frameData)).blob());
      formData.append('threshold', threshold);
      formData.append('latitude', latitude);
      formData.append('longitude', longitude);
      const response = await axios.post('http://localhost:8000/upload_frame/', formData);
      setDetections(response.data.detections);
    } catch (error) {
      console.error('Error uploading frame:', error);
    }
  };

  const handleStartWebSocket = () => {
    ws.current = new WebSocket('ws://localhost:8000/ws');

    ws.current.onopen = () => {
      console.log('WebSocket connected');
    };

    ws.current.onmessage = (event) => {
      const data = JSON.parse(event.data);
      setDetections(data.detections);
      setFrame(data.frame);  // Set the received frame
    };

    ws.current.onerror = (error) => {
      console.error('WebSocket error:', error);
    };
  };

  const handleStopWebSocket = () => {
    if (ws.current) {
      ws.current.close();
      console.log('WebSocket disconnected');
    }
  };

  return (
    <div className="flex flex-col items-center p-4">
      <h1 className="text-2xl font-bold mb-4">Road Damage Detection</h1>

      {/* Custom Card */}
      <div className="w-full max-w-xl bg-white shadow-md rounded-lg p-4">
        <video ref={videoRef} autoPlay playsInline muted className="rounded-lg w-full" />
        <canvas ref={canvasRef} hidden />

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

      {/* Detections */}
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

      {/* Display the detected frame */}
      {frame && (
        <div className="mt-4">
          <h2 className="text-xl font-bold mb-2">Detected Frame</h2>
          <img src={`data:image/jpeg;base64,${frame}`} alt="Detected Frame" className="max-w-full rounded-lg" />
        </div>
      )}

      {/* WebSocket Buttons */}
      <div className="mt-6 space-x-4">
        <button
          onClick={handleStartWebSocket}
          className="bg-gray-600 text-white px-4 py-2 rounded-lg hover:bg-gray-700 transition"
        >
          Start WebSocket
        </button>
        <button
          onClick={handleStopWebSocket}
          className="bg-red-600 text-white px-4 py-2 rounded-lg hover:bg-red-700 transition"
        >
          Stop WebSocket
        </button>
      </div>
    </div>
  );
}

export default App;
