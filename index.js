import WebSocket, { WebSocketServer } from "ws";
import fetch from "node-fetch"; // Make sure to install this!

const ELEVEN_API_KEY = "sk_e57b39b41f200e61f3cfc9c737836af80113b261bcf094ba";
const AGENT_ID = "JzzWYXNl2EgI01Z0OTvR";

// Start WebSocket server on port 8080
const wss = new WebSocketServer({ port: 8080 }, () => {
  console.log("✅ WebSocket Server started on ws://localhost:8080");
});

wss.on("connection", async (twilioWs, req) => {
  console.log(`✅ Twilio WebSocket connected from: ${req.socket.remoteAddress}`);

  // STEP 1: Fetch Eleven Labs WebSocket link
  console.log("⚙ Fetching ElevenLabs temp socket URL...");
  let elevenSocketUrl;
  try {
    const response = await fetch(`https://api.elevenlabs.io/v1/convai/agents/${AGENT_ID}/link`, {
      method: "POST",
      headers: {
        "xi-api-key": ELEVEN_API_KEY,
        "Content-Type": "application/json"
      }
    });

    if (!response.ok) {
      throw new Error(`❌ Failed to fetch ElevenLabs socket URL: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    elevenSocketUrl = data.socket_url;
    console.log(`✅ ElevenLabs Socket URL fetched: ${elevenSocketUrl}`);
  } catch (error) {
    console.error(error);
    twilioWs.close();
    return;
  }

  // STEP 2: Connect to Eleven Labs WebSocket
  console.log("⚙ Connecting to Eleven Labs WebSocket...");
  const elevenLabsWs = new WebSocket(elevenSocketUrl);

  elevenLabsWs.on("open", () => console.log("✅ Connected to Eleven Labs WebSocket"));

  // STEP 3: Audio relay between Twilio & Eleven Labs
  twilioWs.on("message", (audioData) => {
    console.log(`🔊 Twilio audio received (${audioData.length} bytes)`);
    if (elevenLabsWs.readyState === WebSocket.OPEN) elevenLabsWs.send(audioData);
    else console.warn("⚠ Eleven Labs WebSocket not open. Skipping forwarding.");
  });

  elevenLabsWs.on("message", (aiAudio) => {
    console.log(`🗣 Eleven Labs AI audio received (${aiAudio.length} bytes)`);
    if (twilioWs.readyState === WebSocket.OPEN) twilioWs.send(aiAudio);
    else console.warn("⚠ Twilio WebSocket not open. Skipping forwarding.");
  });

  // STEP 4: Cleanup on close
  const closeAll = (code, reason) => {
    console.log(`❌ Closing connections: Code=${code}, Reason=${reason}`);
    if (twilioWs.readyState === WebSocket.OPEN) twilioWs.close();
    if (elevenLabsWs.readyState === WebSocket.OPEN) elevenLabsWs.close();
  };

  twilioWs.on("close", (code, reason) => closeAll(code, reason));
  elevenLabsWs.on("close", (code, reason) => closeAll(code, reason));

  // STEP 5: Error handling
  twilioWs.on("error", (err) => console.error("❌ Twilio WS Error:", err));
  elevenLabsWs.on("error", (err) => console.error("❌ Eleven Labs WS Error:", err));
});
