import WebSocket, { WebSocketServer } from "ws";
import fetch from "node-fetch"; // Make sure to install this via npm install node-fetch

const AGENT_ID = "JzzWYXNl2EgI01Z0OTvR";
const XI_API_KEY = "sk_e57b39b41f200e61f3cfc9c737836af80113b261bcf094ba";

// Start WebSocket Server
const wss = new WebSocketServer({ port: 8080 }, () => {
  console.log("✅ WebSocket Server started on ws://localhost:8080");
});

wss.on("connection", async (twilioWs, req) => {
  console.log(`✅ Twilio WebSocket connected from: ${req.socket.remoteAddress}`);

  try {
    // Step 1: Fetch Eleven Labs Conversation Token
    console.log("⚙ Fetching ElevenLabs conversation token...");
    const response = await fetch(`https://api.elevenlabs.io/v1/convai/agents/${AGENT_ID}/link`, {
      method: "POST",
      headers: {
        "xi-api-key": XI_API_KEY,
        "Content-Type": "application/json",
      },
    });

    const data = await response.json();

    console.log("✅ ElevenLabs link response:", data);

    const conversationToken = data?.token?.conversation_token;

    if (!conversationToken) {
      console.error("❌ Failed to get conversation token:", data);
      twilioWs.close();
      return;
    }

    console.log("✅ Conversation Token:", conversationToken);

    // Step 2: Connect to Eleven Labs WebSocket
    console.log("⚙ Connecting to Eleven Labs WebSocket...");
    const elevenLabsWs = new WebSocket("wss://api.elevenlabs.io/v1/convai/stream", {
      headers: {
        "xi-api-key": XI_API_KEY,
        "xi-conversation-id": conversationToken, // Pass the conversation token here
        "Content-Type": "application/json"
      }
    });

    // Step 3: Keep alive ping for Eleven Labs every 5 seconds
    const keepAlivePing = setInterval(() => {
      if (elevenLabsWs.readyState === WebSocket.OPEN) {
        console.log("🛠 Sending Keep-Alive Ping to Eleven Labs...");
        elevenLabsWs.send(JSON.stringify({ type: "ping" }));
      }
    }, 5000);

    // Step 4: Forward audio from Twilio to Eleven Labs
    twilioWs.on("message", (audioData) => {
      console.log(`🔊 Twilio audio received (${audioData.length} bytes)`);
      if (elevenLabsWs.readyState === WebSocket.OPEN) {
        elevenLabsWs.send(audioData);
      }
    });

    // Step 5: Forward AI-generated audio from Eleven Labs to Twilio
    elevenLabsWs.on("message", (aiAudio) => {
      console.log(`🗣 Eleven Labs AI audio received (${aiAudio.length} bytes)`);
      if (twilioWs.readyState === WebSocket.OPEN) {
        twilioWs.send(aiAudio);
      }
    });

    // Step 6: Handle closures properly
    const closeConnections = (who) => {
      console.log(`❌ Closing connections: ${who}`);
      clearInterval(keepAlivePing);
      if (twilioWs.readyState === WebSocket.OPEN) twilioWs.close();
      if (elevenLabsWs.readyState === WebSocket.OPEN) elevenLabsWs.close();
    };

    twilioWs.on("close", () => closeConnections("Twilio closed"));
    elevenLabsWs.on("close", () => closeConnections("Eleven Labs closed"));

    // Step 7: Handle errors
    twilioWs.on("error", (err) => console.error("❌ Twilio WS Error:", err));
    elevenLabsWs.on("error", (err) => console.error("❌ Eleven Labs WS Error:", err));

  } catch (error) {
    console.error("❌ Error setting up connection:", error);
    twilioWs.close();
  }
});
