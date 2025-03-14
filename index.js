import WebSocket, { WebSocketServer } from "ws";

// Start WebSocket server on port 8080
const wss = new WebSocketServer({ port: 8080 }, () => {
  console.log("✅ WebSocket Server started on ws://localhost:8080");
});

wss.on("connection", (twilioWs, req) => {
  console.log("✅ Twilio WebSocket connected from:", req.socket.remoteAddress);

  // Connect to Eleven Labs WebSocket with correct AI agent ID
  console.log("⚙ Connecting to Eleven Labs WebSocket...");
  const elevenLabsWs = new WebSocket("wss://api.elevenlabs.io/v1/conversational/stream", {
    headers: {
      "xi-api-key": "sk_2de7a2463796ce0b9588f3d92507cc1631b0d957f06078ab", // ✅ Make sure this key is valid
      "xi-agent-id": "JzzWYXNl2EgI01Z0OTvR", // ✅ Your valid agent ID
      "Content-Type": "application/json"
    }
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
  elevenLabsWs.on("open", () => console.log("✅ Connected to Eleven Labs WebSocket"));
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