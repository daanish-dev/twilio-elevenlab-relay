import WebSocket, { WebSocketServer } from "ws";
import dotenv from "dotenv";

// Load environment variables
dotenv.config();

// Create WebSocket server on port 8080
const wss = new WebSocketServer({ port: 8080 }, () => {
  console.log("✅ WebSocket Server started on ws://localhost:8080");
});

// Keep track of activity times
let lastElevenLabsActivity = null;
let lastTwilioActivity = null;

// Connection monitoring intervals
const HEARTBEAT_INTERVAL = 30000; // 30 seconds
const INACTIVITY_TIMEOUT = 60000; // 60 seconds

// Listen for Twilio WebSocket connections
wss.on("connection", async (twilioWs, req) => {
  console.log(`✅ Twilio WebSocket connected from: ${req.socket.remoteAddress}`);
 
  // Buffer for audio data received before ElevenLabs connection is ready
  let audioBuffer = [];
  let connectionAttemptCount = 0;
  let maxConnectionAttempts = 3;
 
  // Track if we're already trying to connect to avoid duplicate connections
  let connectingToElevenLabs = false;
  let elevenLabsWs = null;
 
  // Set up heartbeat and monitoring intervals
  let heartbeatInterval = null;
  let monitoringInterval = null;
 
  // Function to establish connection to ElevenLabs
  function connectToElevenLabs() {
    if (connectingToElevenLabs) {
      console.log("⚠️ Already attempting to connect to ElevenLabs. Skipping duplicate connection attempt.");
      return null;
    }
   
    connectingToElevenLabs = true;
    connectionAttemptCount++;
   
    console.log(`⚙ Connecting to Eleven Labs WebSocket... (Attempt ${connectionAttemptCount}/${maxConnectionAttempts})`);
   
    try {
      const ws = new WebSocket(
        `wss://api.elevenlabs.io/v1/convai/conversation?agent_id=${process.env.ELEVEN_LABS_AGENT_ID}`
      );
     
      // Set a connection timeout
      const connectionTimeout = setTimeout(() => {
        if (ws.readyState !== WebSocket.OPEN) {
          console.error("⏱️ ElevenLabs connection timed out after 10 seconds");
          ws.terminate();
          connectingToElevenLabs = false;
         
          // Try to reconnect if not at maximum attempts
          if (connectionAttemptCount < maxConnectionAttempts) {
            connectToElevenLabs();
          }
        }
      }, 10000); // 10 second timeout
     
      ws.on("open", () => {
        clearTimeout(connectionTimeout);
        console.log("✅ Connected to Eleven Labs WebSocket");
        lastElevenLabsActivity = Date.now();
        connectingToElevenLabs = false;
       
        // Send any buffered audio
        if (audioBuffer.length > 0) {
          console.log(`🔄 Sending ${audioBuffer.length} buffered audio chunks`);
          audioBuffer.forEach(audio => {
            sendAudioToElevenLabs(ws, audio);
          });
          audioBuffer = [];
        }
       
        // Set up heartbeat to keep connection alive
        if (heartbeatInterval) {
          clearInterval(heartbeatInterval);
        }
        heartbeatInterval = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            console.log("💓 Sending heartbeat to ElevenLabs");
            ws.send(JSON.stringify({ type: "ping" }));
          }
        }, HEARTBEAT_INTERVAL);
       
        // Set up monitoring for inactivity
        if (monitoringInterval) {
          clearInterval(monitoringInterval);
        }
        monitoringInterval = setInterval(() => {
          const now = Date.now();
          console.log(`🔍 Monitoring - Last ElevenLabs activity: ${lastElevenLabsActivity ? (now - lastElevenLabsActivity) / 1000 : 'never'} seconds ago`);
          console.log(`🔍 Monitoring - Last Twilio activity: ${lastTwilioActivity ? (now - lastTwilioActivity) / 1000 : 'never'} seconds ago`);
         
          // Check for inactivity that might indicate issues
          if (lastElevenLabsActivity && now - lastElevenLabsActivity > INACTIVITY_TIMEOUT) {
            console.warn("⚠️ No activity from ElevenLabs for too long, sending ping");
            ws.send(JSON.stringify({ type: "ping" }));
          }
        }, 15000); // Check every 15 seconds
      });
     
      return ws;
    } catch (err) {
      console.error("❌ Error creating ElevenLabs WebSocket:", err);
      connectingToElevenLabs = false;
      return null;
    }
  }
 
  function cleanup() {
    // Clear intervals
    if (heartbeatInterval) {
      clearInterval(heartbeatInterval);
      heartbeatInterval = null;
    }
    if (monitoringInterval) {
      clearInterval(monitoringInterval);
      monitoringInterval = null;
    }
   
    // Close connections if needed
    if (elevenLabsWs && elevenLabsWs.readyState === WebSocket.OPEN) {
      console.log("🔄 Closing ElevenLabs WebSocket connection");
      elevenLabsWs.close();
    }
    if (twilioWs.readyState === WebSocket.OPEN) {
      console.log("🔄 Closing Twilio WebSocket connection");
      twilioWs.close();
    }
  }
 
  try {
    // Step 1: Connect to ElevenLabs WebSocket
    elevenLabsWs = connectToElevenLabs();
    if (!elevenLabsWs) {
      console.error("❌ Failed to initialize ElevenLabs connection");
      twilioWs.close();
      return;
    }
   
    // Step 2: Handle ElevenLabs WebSocket events
    elevenLabsWs.on("message", (data) => {
      try {
        lastElevenLabsActivity = Date.now();
        console.log(`🗣 Eleven Labs response received (${data.length} bytes)`);
       
        // Log first few bytes to help with debugging
        try {
          const responsePreview = data.slice(0, Math.min(100, data.length));
          console.log(`📄 Response preview: ${responsePreview.toString('hex').substring(0, 50)}...`);
        } catch (err) {
          console.error("❌ Error logging response preview:", err);
        }
       
        // Forward the audio to Twilio
        if (twilioWs.readyState === WebSocket.OPEN) {
          twilioWs.send(data);
          console.log("🔄 Forwarded AI audio to Twilio.");
        }
      } catch (err) {
        console.error("❌ Error handling ElevenLabs message:", err);
      }
    });
   
    elevenLabsWs.on("close", (code, reason) => {
      console.error(`❌ Eleven Labs WebSocket closed. Code: ${code}, Reason: ${reason || "No reason provided"}`);
      connectingToElevenLabs = false;
     
      // Detailed diagnostics about the state at closure
      console.log(`📊 Diagnostics at close:
        - Last ElevenLabs activity: ${lastElevenLabsActivity ? new Date(lastElevenLabsActivity).toISOString() : 'never'}
        - Last Twilio activity: ${lastTwilioActivity ? new Date(lastTwilioActivity).toISOString() : 'never'}
        - Buffer size: ${audioBuffer.length}
        - Connection attempts: ${connectionAttemptCount}
      `);
     
      // Try to reconnect if not at maximum attempts
      if (connectionAttemptCount < maxConnectionAttempts && twilioWs.readyState === WebSocket.OPEN) {
        console.log("🔄 Attempting to reconnect to ElevenLabs...");
        elevenLabsWs = connectToElevenLabs();
      } else if (twilioWs.readyState === WebSocket.OPEN) {
        console.log("❌ Maximum reconnection attempts reached or Twilio disconnected");
        cleanup();
      }
    });
   
    elevenLabsWs.on("error", (err) => {
      console.error("❌ Eleven Labs WS Error:", err);
      connectingToElevenLabs = false;
     
      if (twilioWs.readyState === WebSocket.OPEN) {
        twilioWs.close();
      }
    });
   
    // Step 3: Handle audio from Twilio
    twilioWs.on("message", (audioData) => {
      lastTwilioActivity = Date.now();
      console.log(`🔊 Twilio audio received (${audioData.length} bytes)`);
     
      // Log first few bytes for debugging
      try {
        const audioPreview = audioData.slice(0, Math.min(20, audioData.length));
        console.log(`📄 Audio preview: ${audioPreview.toString('hex')}`);
      } catch (err) {
        console.error("❌ Error logging audio preview:", err);
      }
     
      if (elevenLabsWs && elevenLabsWs.readyState === WebSocket.OPEN) {
        sendAudioToElevenLabs(elevenLabsWs, audioData);
      } else {
        console.log("⏳ ElevenLabs connection not open, buffering audio");
       
        // Limit buffer size to prevent memory issues
        if (audioBuffer.length < 100) {
          audioBuffer.push(audioData);
        } else {
          console.warn("⚠️ Audio buffer full, dropping oldest chunk");
          audioBuffer.shift(); // Remove oldest
          audioBuffer.push(audioData);
        }
      }
    });
   
    // Step 4: Handle Twilio WebSocket close and errors
    twilioWs.on("close", (code, reason) => {
      console.warn(`❌ Twilio WebSocket closed. Code: ${code}, Reason: ${reason || "No reason provided"}`);
      cleanup();
    });
   
    twilioWs.on("error", (err) => {
      console.error("❌ Twilio WS Error:", err);
      cleanup();
    });
   
  } catch (err) {
    console.error("❌ Error during setup:", err);
    connectingToElevenLabs = false;
    cleanup();
  }
});

// Function to properly format and send audio data to ElevenLabs
function sendAudioToElevenLabs(ws, audioData) {
  try {
    // Format the message as JSON with audio data as base64
    const message = {
      audio: {
        data: audioData.toString('base64')
      },
      type: "audio"
    };
   
    console.log(`📤 Sending audio to ElevenLabs (${JSON.stringify(message).length} bytes)`);


    ws.send(JSON.stringify(message));
  } catch (err) {
    console.error("❌ Error sending audio to ElevenLabs:", err);
  }
}

