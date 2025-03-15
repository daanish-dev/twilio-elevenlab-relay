import express from "express";
import WebSocket, { WebSocketServer } from "ws";

// SETUP
const app = express();
const PORT = process.env.PORT || 8080;

// === STEP 6: Twilio voice endpoint (THIS IS WHAT YOU PUT IN TWILIO) ===
app.post("/voice", (req, res) => {
  console.log("📞 Incoming call! Sending TwiML to start WebSocket stream...");
  const twimlResponse = `
    <Response>
      <Start>
        <Stream url="wss://twilio-elevenlab-relay.onrender.com" />
      </Start>
      <Say>Connecting you to our AI assistant now.</Say>
    </Response>
  `;
  res.set("Content-Type", "text/xml");
  res.send(twimlResponse.trim());
});

// Start Express server
app.listen(PORT, () => {
  console.log(`✅ Express server running on port ${PORT}`);
});

// === WEBSOCKET RELAY SERVER (for Twilio and ElevenLabs) ===
const wss = new WebSocketServer({ port: 8080 }, () => {
  console.log("✅ WebSocket Server started on ws://localhost:8080");
});

wss.on("connection", (twilioWs) => {
  console.log("✅ Twilio WebSocket connected!");

  // Connect to Eleven Labs WebSocket
  console.log("⚙ Connecting to Eleven Labs WebSocket...");
  const elevenLabsWs = new WebSocket("wss://api.elevenlabs.io/v1/conversational/stream", {
    headers: {
      "xi-api-key": "sk_e57b39b41f200e61f3cfc9c737836af80113b261bcf094ba",
      "xi-agent-id": "JzzWYXNl2EgI01Z0OTvR",
      "xi-voice-id": "OZsc5tqry7P6ThvAXm1Y",
      "Content-Type": "application/json",
    },
  });

  // Generate background noise to prevent Twilio timeout
  const generateNoise = () => Buffer.from([0xF8, 0xFF, 0xFE]);

  // Send noise to Twilio every 500ms
  const keepAliveInterval = setInterval(() => {
    if (twilioWs.readyState === WebSocket.OPEN) {
      twilioWs.send(generateNoise());
    }
  }, 500);

  // Keep-alive ping to Eleven Labs every 5 seconds
  const keepAlivePing = setInterval(() => {
    if (elevenLabsWs.readyState === WebSocket.OPEN) {
      elevenLabsWs.send(JSON.stringify({ type: "ping" }));
    }
  }, 5000);

  // Twilio audio to Eleven Labs
  twilioWs.on("message", (audioData) => {
    console.log(`🔊 Twilio audio received (${audioData.length} bytes)`);
    if (elevenLabsWs.readyState === WebSocket.OPEN) {
      elevenLabsWs.send(audioData);
    } else {
      console.warn("⚠ Eleven Labs WebSocket not open. Skipping forwarding.");
    }
  });

  // Eleven Labs audio to Twilio
  elevenLabsWs.on("message", (aiAudio) => {
    console.log(`🗣 Eleven Labs AI audio received (${aiAudio.length} bytes)`);
    if (twilioWs.readyState === WebSocket.OPEN) {
      twilioWs.send(aiAudio);
    } else {
      console.warn("⚠ Twilio WebSocket not open. Skipping forwarding.");
    }
  });

  // Handle WebSocket closures and errors
  const cleanup = (who) => {
    console.log(`❌ Closing connections: ${who}`);
    clearInterval(keepAliveInterval);
    clearInterval(keepAlivePing);
    if (twilioWs.readyState !== WebSocket.CLOSED) twilioWs.close();
    if (elevenLabsWs.readyState !== WebSocket.CLOSED) elevenLabsWs.close();
  };

  twilioWs.on("close", () => cleanup("Twilio closed"));
  elevenLabsWs.on("close", () => cleanup("Eleven Labs closed"));

  twilioWs.on("error", (err) => {
    console.error("❌ Twilio WS Error:", err);
    cleanup("Twilio error");
  });

  elevenLabsWs.on("error", (err) => {
    console.error("❌ Eleven Labs WS Error:", err);
    cleanup("Eleven Labs error");
  });
});