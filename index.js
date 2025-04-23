import WebSocket, { WebSocketServer } from "ws";
import dotenv from "dotenv";

// Load environment variables
dotenv.config();

// Create WebSocket server on port 8080
const wss = new WebSocketServer({ port: 8080 }, () => {
  console.log("✅ WebSocket Server started on ws://localhost:8080");
});

// Listen for Twilio WebSocket connections
wss.on("connection", async (twilioWs, req) => {
  console.log(`✅ Twilio WebSocket connected from: ${req.socket.remoteAddress}`);
 
  // Buffer for audio data received before ElevenLabs connection is ready
  let audioBuffer = [];
  let elevenLabsReady = false;
 
  try {
    // Step 1: Connect to ElevenLabs WebSocket using agent_id
    console.log("⚙ Connecting to Eleven Labs WebSocket...");
    const elevenLabsWs = new WebSocket(
      `wss://api.elevenlabs.io/v1/convai/conversation?agent_id=${process.env.ELEVEN_LABS_AGENT_ID}`
    );
   
    // Step 2: Handle ElevenLabs WebSocket events
    elevenLabsWs.on("open", () => {
      console.log("✅ Connected to Eleven Labs WebSocket");
      elevenLabsReady = true;
     
      // Send any buffered audio
      if (audioBuffer.length > 0) {
        console.log(`🔄 Sending ${audioBuffer.length} buffered audio chunks`);
        audioBuffer.forEach(audio => {
          sendAudioToElevenLabs(elevenLabsWs, audio);
        });
        audioBuffer = [];
      }
    });
   
    elevenLabsWs.on("message", (data) => {
      try {
        console.log(`🗣 Eleven Labs response received (${data.length} bytes)`);
       
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
      console.error(`❌ Eleven Labs WebSocket closed. Code: ${code}, Reason: ${reason}`);
      if (twilioWs.readyState === WebSocket.OPEN) {
        twilioWs.close();
      }
    });
   
    elevenLabsWs.on("error", (err) => {
      console.error("❌ Eleven Labs WS Error:", err);
      if (twilioWs.readyState === WebSocket.OPEN) {
        twilioWs.close();
      }
    });
   
    // Step 3: Handle audio from Twilio
    twilioWs.on("message", (audioData) => {
      console.log(`🔊 Twilio audio received (${audioData.length} bytes)`);
     
      if (elevenLabsReady && elevenLabsWs.readyState === WebSocket.OPEN) {
        sendAudioToElevenLabs(elevenLabsWs, audioData);
      } else {
        console.log("⏳ ElevenLabs not ready, buffering audio");
        audioBuffer.push(audioData);
      }
    });
   
    // Step 4: Handle Twilio WebSocket close and errors
    twilioWs.on("close", (code, reason) => {
      console.warn(`❌ Twilio WebSocket closed. Code: ${code}, Reason: ${reason}`);
      if (elevenLabsWs.readyState === WebSocket.OPEN) {
        elevenLabsWs.close();
      }
    });
   
    twilioWs.on("error", (err) => {
      console.error("❌ Twilio WS Error:", err);
      if (elevenLabsWs.readyState === WebSocket.OPEN) {
        elevenLabsWs.close();
      }
    });
   
  } catch (err) {
    console.error("❌ Error during setup:", err);
    if (twilioWs.readyState === WebSocket.OPEN) {
      twilioWs.close();
    }
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
   
    ws.send(JSON.stringify(message));
  } catch (err) {
    console.error("❌ Error sending audio to ElevenLabs:", err);
  }
}