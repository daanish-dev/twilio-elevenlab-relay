import WebSocket, { WebSocketServer } from "ws";

// Set port (Render will use this, defaults to 8080)
const port = process.env.PORT || 8080;
const wss = new WebSocketServer({ port }, () => {
  console.log(`✅ WebSocket Server running on port ${port}`);
});

wss.on("connection", (twilioWs) => {
  console.log("✅ Twilio connected to our WebSocket");

  // Connect to Eleven Labs WebSocket
  const elevenLabsWs = new WebSocket("wss://api.elevenlabs.io/v1/conversational/stream", {
    headers: {
      "xi-api-key": "sk_2de7a2463796ce0b9588f3d92507cc1631b0d957f06078ab",
      "xi-agent-id": "JzzWYXNl2EgI01Z0OTvR", // Ensure the correct AI agent ID is used
    },
  });

  elevenLabsWs.on("open", () => console.log("✅ Connected to Eleven Labs"));

  // Track connection states
  let isTwilioConnected = true;
  let isElevenLabsConnected = true;

  // Send silent audio packets to Twilio to keep the connection alive
  const sendSilence = () => {
    if (twilioWs.readyState === WebSocket.OPEN) {
      console.log("🔈 Sending silence to prevent Twilio timeout...");
      twilioWs.send(Buffer.from([0xF8, 0xFF, 0xFE])); // Silent Opus frame
    }
  };

  // Keep-alive interval to send silent packets every 2 seconds
  const silenceInterval = setInterval(sendSilence, 2000);

  // Forward audio from Twilio to Eleven Labs
  twilioWs.on("message", (audioData) => {
    console.log(`🔊 Twilio audio received (${audioData.length} bytes)`);

    if (elevenLabsWs.readyState === WebSocket.OPEN) {
      elevenLabsWs.send(audioData);
    } else {
      console.warn("⚠️ Eleven Labs WebSocket is not open. Skipping audio forwarding.");
    }
  });

  // Forward AI-generated audio from Eleven Labs to Twilio
  elevenLabsWs.on("message", (aiAudio) => {
    console.log(`🗣 Eleven Labs AI audio received (${aiAudio.length} bytes)`);

    if (aiAudio.length === 0) {
      console.error("⚠️ Warning: Received empty AI response! This may cause Twilio to hang up.");
    }

    if (twilioWs.readyState === WebSocket.OPEN) {
      console.log("🔄 Forwarding AI response to Twilio...");
      twilioWs.send(aiAudio);
    } else {
      console.warn("🚨 Twilio WebSocket is closed before AI response could be sent.");
    }
  });

  // Handle Twilio WebSocket Closure
  twilioWs.on("close", (code, reason) => {
    console.log(`❌ Twilio WebSocket closed. Code: ${code}, Reason: ${reason}`);
    isTwilioConnected = false;
    clearInterval(silenceInterval);
    if (isElevenLabsConnected && elevenLabsWs.readyState !== WebSocket.CLOSED) {
      elevenLabsWs.close();
    }
  });

  // Handle Eleven Labs WebSocket Closure
  elevenLabsWs.on("close", (code, reason) => {
    console.log(`❌ Eleven Labs WebSocket closed. Code: ${code}, Reason: ${reason}`);
    isElevenLabsConnected = false;
    if (isTwilioConnected && twilioWs.readyState !== WebSocket.CLOSED) {
      twilioWs.close();
    }
  });

  // Handle Errors
  twilioWs.on("error", (err) => console.error("❌ Twilio WS Error:", err));
  elevenLabsWs.on("error", (err) => console.error("❌ Eleven Labs WS Error:", err));
});
