import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";

function RealtimeDetectionScreen() {
    const [detections, setDetections] = useState([]);
    const [threshold, setThreshold] = useState(0.5);
    const [latitude, setLatitude] = useState(null);
    const [longitude, setLongitude] = useState(null);
    const videoRef = useRef(null);
    const canvasRef = useRef(null);
    const ws = useRef(null);
    const runningRef = useRef(true); // used to stop our frame loop on unmount
  
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
  
    // Start the camera automatically on mount
    useEffect(() => {
      navigator.mediaDevices.getUserMedia({ video: true }).then((stream) => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
      });
    }, []);
    const messageQueue = [];
    // Open WebSocket connection when component mounts
    useEffect(() => {
      ws.current = new WebSocket('ws://localhost:8000/ws');
  
      ws.current.onopen = async() => {
        console.log('WebSocket connected');
        // Start the continuous frame processing loop
        await processFrames();
      };
  
      ws.current.onerror = (error) => {
        console.error('WebSocket error:', error);
      };
      ws.current.onmessage = (event) => {
        console.log('Received message from server:', event.data);
        // Push the incoming message to the queue
        messageQueue.push(event.data);
      };
      ws.current.onclose = () => {
        console.log('WebSocket disconnected');
        runningRef.current = false;
      };
  
      // Clean up on unmount
      return () => {
        runningRef.current = false;
        if (ws.current) ws.current.close();
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
  
    // The loop that continuously captures and sends frames
    const processFrames = async () => {
      // console.log(runningRef.current, ws.current?.readyState, WebSocket.OPEN);
      runningRef.current = true;
      try {
        while (runningRef.current && ws.current?.readyState === WebSocket.OPEN) {
          
      
          const video = videoRef.current;
          const canvas = canvasRef.current;
      
          if (video && canvas) {
            // Set canvas dimensions to match the video
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            const ctx = canvas.getContext('2d');
      
            console.log(
              'Drawing frame on canvas. Video dimensions:',
              video.videoWidth,
              'x',
              video.videoHeight
            );
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      
            // Convert the canvas content to a JPEG blob
            const blob = await new Promise((resolve) => {
              canvas.toBlob((result) => {
                if (result) {
                  console.log('Canvas converted to blob successfully.');
                } else {
                  console.error('Failed to convert canvas to blob.');
                }
                resolve(result);
              }, 'image/jpeg');
            });
      
            if (blob) {
              // console.log('Blob size (bytes):', blob.size);
      
              // Convert blob to an ArrayBuffer
              const arrayBuffer = await blob.arrayBuffer();
              // console.log('Converted blob to arrayBuffer. Byte length:', arrayBuffer.byteLength);
      
              // Prepare and send metadata as JSON text
              const metadata = { threshold, latitude, longitude };
              // console.log('Sending metadata:', metadata);
              ws.current.send(JSON.stringify(metadata));
      
              // Send the binary frame data
              // console.log('Sending binary frame data...');
              ws.current.send(arrayBuffer);
              console.log('Waiting for detection response from server...');
              const messageData = await waitForMessage();
      
              // Wait for the detection response from the server
              // const messageData = await new Promise((resolve) => {
              //   ws.current.onmessage = (event) => {
              //     console.log('Received message from server.');
              //     resolve(event.data);
              //   };
              // });
      
              try {
                const data = JSON.parse(messageData);
                console.log('Received detections:', data);
      
                // Update detections state and draw them on the canvas
                setDetections(data);
                drawDetections(ctx, data);
              } catch (err) {
                console.error('Error parsing detection data:', err);
              }
            } else {
              console.error('Blob conversion failed, skipping this frame.');
            }
          } else {
            if (!video) {
              console.error('Video reference is not available.');
            }
            if (!canvas) {
              console.error('Canvas reference is not available.');
            }
          }
      
          // Wait a short time before processing the next frame (e.g., 200ms)
          await new Promise((resolve) => setTimeout(resolve, 200));
        }
      } catch (error) {
        console.error('Error processing frames:', error);
        
      }
    };
    
    const waitForMessage = async () => {
      // Simple polling implementation (adjust as needed)
      while (messageQueue.length === 0) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      return messageQueue.shift();
    };
    // Helper to draw detection boxes on the canvas
    const drawDetections = (ctx, detections) => {
      // First, clear any existing overlay (note: the video frame is already drawn)
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
  
    return (
      <div className="flex flex-col items-center p-4">
        <h1 className="text-2xl font-bold mb-4">Realtime Detection</h1>
        <div className="w-full max-w-xl bg-white shadow-md rounded-lg p-4">
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="rounded-lg w-full"
          />
          <canvas ref={canvasRef} className="w-full rounded-lg mt-2" />
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
      
          <Link to="/capture" className="text-blue-600 underline">
            Go to Capture & Detect
          </Link>
        </div>
      </div>
    );
  }
  export default RealtimeDetectionScreen;