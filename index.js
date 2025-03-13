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
      "xi-api-key": process.env.ELEVEN_LABS_API_KEY,
    },
  });

  elevenLabsWs.on("open", () => console.log("✅ Connected to Eleven Labs"));

  // Keep track of the connection status
  let isTwilioConnected = true;
  let isElevenLabsConnected = true;

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

  // Keep-Alive Ping to Prevent Connection Drops
  const keepAliveInterval = setInterval(() => {
    if (twilioWs.readyState === WebSocket.OPEN) {
      console.log("🛠 Sending Keep-Alive Signal to Twilio...");
      twilioWs.send(JSON.stringify({ type: "keep-alive" }));
    }
  }, 5000); // Every 5 seconds

  // Handle Twilio WebSocket Closure
  twilioWs.on("close", (code, reason) => {
    console.log(`❌ Twilio WebSocket closed. Code: ${code}, Reason: ${reason}`);
    isTwilioConnected = false;
    clearInterval(keepAliveInterval);
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
