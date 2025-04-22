import WebSocket, { WebSocketServer } from "ws";
import dotenv from "dotenv";

// Load environment variables (e.g., ELEVEN_LABS_AGENT_ID)
dotenv.config();

// Create WebSocket server on port 8080
const wss = new WebSocketServer({ port: 8080 }, () => {
  console.log("✅ WebSocket Server started on ws://localhost:8080");
});

// Listen for Twilio WebSocket connections
wss.on("connection", async (twilioWs, req) => {
  console.log(`✅ Twilio WebSocket connected from: ${req.socket.remoteAddress}`);

  try {
    // Step 1: Connect directly to ElevenLabs WebSocket using agent_id
    console.log("⚙ Connecting to Eleven Labs WebSocket...");

    const elevenLabsWs = new WebSocket(
      `wss://api.elevenlabs.io/v1/convai/conversation?agent_id=${process.env.ELEVEN_LABS_AGENT_ID}`
    );

    // Step 2: Handle ElevenLabs WebSocket events
    elevenLabsWs.on("open", () => console.log("✅ Connected to Eleven Labs WebSocket"));

    elevenLabsWs.on("message", (aiAudio) => {
      console.log(`🗣 Eleven Labs AI audio received (${aiAudio.length} bytes)`);
      if (twilioWs.readyState === WebSocket.OPEN) {
        twilioWs.send(aiAudio);
        console.log("🔄 Forwarded AI audio to Twilio.");
      }
    });

    elevenLabsWs.on("close", (code, reason) => {
      console.error(`❌ Eleven Labs WebSocket closed. Code: ${code}, Reason: ${reason}`);
      twilioWs.close();
    });

    elevenLabsWs.on("error", (err) => {
      console.error("❌ Eleven Labs WS Error:", err);
      twilioWs.close();
    });

    // Step 3: Forward audio from Twilio to ElevenLabs
    twilioWs.on("message", (audioData) => {
      console.log(`🔊 Twilio audio received (${audioData.length} bytes)`);
      if (elevenLabsWs.readyState === WebSocket.OPEN) {
        elevenLabsWs.send(audioData);
      } else {
        console.warn("⚠ Eleven Labs WebSocket not open. Skipping forwarding.");
      }
    });

    // Step 4: Handle Twilio WebSocket close and errors
    twilioWs.on("close", (code, reason) => {
      console.warn(`❌ Twilio WebSocket closed. Code: ${code}, Reason: ${reason}`);
      elevenLabsWs.close();
    });

    twilioWs.on("error", (err) => console.error("❌ Twilio WS Error:", err));

  } catch (err) {
    console.error("❌ Error during setup:", err);
    twilioWs.close();
  }
});
