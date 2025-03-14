import WebSocket, { WebSocketServer } from "ws";
import dotenv from "dotenv";

// Load environment variables from .env file
dotenv.config();

// Retrieve values from environment variables
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const ELEVENLABS_AGENT_ID = process.env.ELEVENLABS_AGENT_ID;
const ELEVENLABS_VOICE_ID = process.env.ELEVENLABS_VOICE_ID; // ✅ Voice ID added
const PORT = process.env.PORT || 8080; // Default to 8080 if not set

// Start WebSocket server
const wss = new WebSocketServer({ port: PORT }, () => {
  console.log(`✅ WebSocket Server started on ws://localhost:${PORT}`);
});

wss.on("connection", (twilioWs, req) => {
  console.log("✅ Twilio WebSocket connected from:", req.socket.remoteAddress);

  // Connect to Eleven Labs WebSocket with API key and agent ID from .env
  console.log("⚙ Connecting to Eleven Labs WebSocket...");
  const elevenLabsWs = new WebSocket("wss://api.elevenlabs.io/v1/conversational/stream", {
    headers: {
      "xi-api-key": ELEVENLABS_API_KEY,
      "xi-agent-id": ELEVENLABS_AGENT_ID,
      "Content-Type": "application/json"
    }
  });

  // Once Eleven Labs WebSocket is open, send configuration with the voice ID
  elevenLabsWs.on("open", () => {
    console.log("✅ Connected to Eleven Labs WebSocket");

    // Send initial configuration with voice ID
    const initMessage = JSON.stringify({
      type: "config",
      voice_id: ELEVENLABS_VOICE_ID, // ✅ Voice ID loaded from .env
      language: "en-US", // Adjust as needed
      sample_rate: 24000 // Ensure compatibility with Twilio
    });

    elevenLabsWs.send(initMessage);
    console.log("🎤 Sent voice configuration to Eleven Labs:", initMessage);
  });

  // Keep-Alive Ping to Eleven Labs every 5 seconds
  const keepAlivePing = setInterval(() => {
    if (elevenLabsWs.readyState === WebSocket.OPEN) {
      console.log("🛠 Sending Keep-Alive Ping to Eleven Labs...");
      elevenLabsWs.send(JSON.stringify({ type: "ping" }));
    }
  }, 5000);

  // Forward audio from Twilio to Eleven Labs
  twilioWs.on("message", (audioData) => {
    console.log(`🔊 Twilio audio received (${audioData.length} bytes)`);
    if (elevenLabsWs.readyState === WebSocket.OPEN) {
      elevenLabsWs.send(audioData);
    } else {
      console.warn("⚠ Eleven Labs WebSocket not open. Skipping forwarding.");
    }
  });

  // Forward AI-generated audio from Eleven Labs to Twilio
  elevenLabsWs.on("message", (aiAudio) => {
    console.log(`🗣 Eleven Labs AI audio received (${aiAudio.length} bytes)`);
    if (twilioWs.readyState === WebSocket.OPEN) {
      twilioWs.send(aiAudio);
    } else {
      console.warn("🚨 Twilio WebSocket is closed. Cannot forward AI audio.");
    }
  });

  // Handle WebSocket Closures and Errors
  const closeAll = (reason) => {
    console.log("❌ Closing connections:", reason);
    clearInterval(keepAlivePing);
    if (twilioWs.readyState !== WebSocket.CLOSED) twilioWs.close();
    if (elevenLabsWs.readyState !== WebSocket.CLOSED) elevenLabsWs.close();
  };

  // Handle Eleven Labs events
  elevenLabsWs.on("close", (code, reason) => {
    console.error(`❌ Eleven Labs WebSocket closed. Code: ${code}, Reason: ${reason}`);
    closeAll("Eleven Labs closed");
  });
  elevenLabsWs.on("error", (err) => {
    console.error("❌ Eleven Labs WS Error:", err);
    closeAll("Eleven Labs error");
  });

  // Handle Twilio events
  twilioWs.on("close", (code, reason) => {
    console.log(`❌ Twilio WebSocket closed. Code: ${code}, Reason: ${reason}`);
    closeAll("Twilio closed");
  });
  twilioWs.on("error", (err) => {
    console.error("❌ Twilio WS Error:", err);
    closeAll("Twilio error");
  });
});
