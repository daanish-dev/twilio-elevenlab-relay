import WebSocket, { WebSocketServer } from "ws";
import axios from "axios";
import dotenv from "dotenv";

// Load environment variables from .env file (Render handles env vars directly)
dotenv.config();

// Create WebSocket server on port 8080
const wss = new WebSocketServer({ port: 8080 }, () => {
  console.log("✅ WebSocket Server started on ws://localhost:8080");
});

// Listen for Twilio WebSocket connection
wss.on("connection", async (twilioWs, req) => {
  console.log(`✅ Twilio WebSocket connected from: ${req.socket.remoteAddress}`);

  try {
    console.log("⚙ Fetching ElevenLabs conversation token...");

    // Step 1: Get conversation token dynamically
    const response = await axios.get(
      `https://api.elevenlabs.io/v1/convai/agents/${process.env.ELEVEN_LABS_AGENT_ID}/link`,
      {
        headers: {
          "xi-api-key": process.env.ELEVEN_LABS_API_KEY,
        },
      }
    );

    console.log("✅ ElevenLabs link response:", response.data);

    const conversationToken = response.data?.token?.conversation_token;
    if (!conversationToken) {
      console.error("❌ ElevenLabs returned invalid response:", response.data);
      twilioWs.close();
      return;
    }

    console.log(`✅ Conversation Token: ${conversationToken}`);

    // Step 2: Connect to Eleven Labs WebSocket
    console.log("⚙ Connecting to Eleven Labs WebSocket...");
    const elevenLabsWs = new WebSocket("wss://api.elevenlabs.io/v1/convai/stream", {
      headers: {
        "xi-api-key": process.env.ELEVEN_LABS_API_KEY,
        "Authorization": `Bearer ${conversationToken}`,
        "xi-agent-id": process.env.ELEVEN_LABS_AGENT_ID,
        "xi-voice-id": process.env.ELEVEN_LABS_VOICE_ID, // ✅ Voice ID from variable
      },
    });

    // Step 3: Handle Eleven Labs WebSocket events
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

    // Step 4: Forward audio from Twilio to Eleven Labs
    twilioWs.on("message", (audioData) => {
      console.log(`🔊 Twilio audio received (${audioData.length} bytes)`);
      if (elevenLabsWs.readyState === WebSocket.OPEN) {
        elevenLabsWs.send(audioData);
      } else {
        console.warn("⚠ Eleven Labs WebSocket not open. Skipping forwarding.");
      }
    });

    // Step 5: Clean up on Twilio WebSocket close
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