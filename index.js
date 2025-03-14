import WebSocket, { WebSocketServer } from "ws";

// Start WebSocket server on port 8080
const wss = new WebSocketServer({ port: 8080 }, () => {
  console.log("✅ WebSocket Server started on ws://localhost:8080");
});

wss.on("connection", (twilioWs, req) => {
  console.log(`✅ Twilio WebSocket connected from: ${req.socket.remoteAddress}`);

  // Connect to Eleven Labs WebSocket with correct AI agent ID and Voice ID
  console.log("⚙ Connecting to Eleven Labs WebSocket...");

  const elevenLabsWs = new WebSocket("wss://api.elevenlabs.io/v1/conversation/ws", {
    headers: {
      "xi-api-key": "sk_2de7a2463796ce0b9588f3d92507cc1631b0d957f06078ab", // ✅ Your API key
      "xi-agent-id": "JzzWYXNl2EgI01Z0OTvR", // ✅ Your Agent ID
      "xi-voice-id": "9BWtsMINqrJLrRacOk9x", // ✅ Your Voice ID
      "Content-Type": "application/json"
    },
  });

  // Log connection success and errors for Eleven Labs
  elevenLabsWs.on("open", () => console.log("✅ Connected to Eleven Labs WebSocket"));
  elevenLabsWs.on("error", (err) => console.error("❌ Eleven Labs WebSocket Error:", err));
  elevenLabsWs.on("close", (code, reason) => console.log(`❌ Eleven Labs WebSocket closed. Code: ${code}, Reason: ${reason}`));

  // Generate low-volume background noise (to prevent Twilio timeout)
  const generateNoise = () => {
    return Buffer.from([0xF8, 0xFF, 0xFE]); // Silent Opus frame
  };

  // Send background noise to Twilio every 500ms
  const keepAliveInterval = setInterval(() => {
    if (twilioWs.readyState === WebSocket.OPEN) {
      console.log("🔈 Sending background noise to Twilio...");
      twilioWs.send(generateNoise());
    }
  }, 500);

  // Send keep-alive ping to Eleven Labs every 5 seconds
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
      console.log("➡ Forwarding audio to Eleven Labs...");
      elevenLabsWs.send(audioData);
    } else {
      console.warn("⚠ Eleven Labs WebSocket not open. Skipping forwarding.");
    }
  });

  // Forward AI-generated audio from Eleven Labs to Twilio
  elevenLabsWs.on("message", (aiAudio) => {
    console.log(`🗣 Eleven Labs AI audio received (${aiAudio.length} bytes)`);

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
    clearInterval(keepAliveInterval);
    clearInterval(keepAlivePing);
    if (elevenLabsWs.readyState !== WebSocket.CLOSED) {
      console.log("❌ Closing Eleven Labs WebSocket as Twilio disconnected...");
      elevenLabsWs.close();
    }
  });

  // Handle Eleven Labs WebSocket Closure
  elevenLabsWs.on("close", (code, reason) => {
    console.log(`❌ Eleven Labs WebSocket closed. Code: ${code}, Reason: ${reason}`);
    clearInterval(keepAliveInterval);
    clearInterval(keepAlivePing);
    if (twilioWs.readyState !== WebSocket.CLOSED) {
      console.log("❌ Closing Twilio WebSocket as Eleven Labs disconnected...");
      twilioWs.close();
    }
  });

  // Handle Errors
  twilioWs.on("error", (err) => console.error("❌ Twilio WS Error:", err));
  elevenLabsWs.on("error", (err) => console.error("❌ Eleven Labs WS Error:", err));
});