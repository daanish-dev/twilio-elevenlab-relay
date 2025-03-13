import WebSocket, { WebSocketServer } from "ws";

// Set port (Render will use this, defaults to 8080)
const port = process.env.PORT || 8080;
const wss = new WebSocketServer({ port }, () => {
  console.log('✅ WebSocket Server running on port ${port}');
});

// When Twilio connects
wss.on("connection", (twilioWs) => {
  console.log("✅ Twilio connected to our WebSocket");

  // Connect to Eleven Labs
  const elevenLabsWs = new WebSocket("wss://api.elevenlabs.io/v1/conversational/stream", {
    headers: {
      "xi-api-key": process.env.ELEVEN_LABS_API_KEY,
    },
  });

  elevenLabsWs.on("open", () => console.log("✅ Connected to Eleven Labs"));

  // Forward audio from Twilio to Eleven Labs
  twilioWs.on("message", (audioData) => {
    console.log('🔊 Twilio audio received (${audioData.length} bytes)');
    if (elevenLabsWs.readyState === WebSocket.OPEN) {
      elevenLabsWs.send(audioData);
    }
  });

  // Forward AI-generated audio from Eleven Labs to Twilio
  elevenLabsWs.on("message", (aiAudio) => {
    console.log('🗣 Eleven Labs AI audio received (${aiAudio.length} bytes)');
    if (twilioWs.readyState === WebSocket.OPEN) {
      twilioWs.send(aiAudio);
    }
  });

  // Handle errors
  twilioWs.on("error", (err) => console.error("❌ Twilio WS Error:", err));
  elevenLabsWs.on("error", (err) => console.error("❌ Eleven Labs WS Error:", err));

  // Handle closure of connections
  twilioWs.on("close", () => {
    console.log("❌ Twilio WebSocket closed.");
    elevenLabsWs.close();
  });

  elevenLabsWs.on("close", () => {
    console.log("❌ Eleven Labs WebSocket closed.");
    twilioWs.close();
  });
});
