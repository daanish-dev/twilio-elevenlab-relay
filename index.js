import WebSocket, { WebSocketServer } from "ws";
import fetch from "node-fetch"; // Required for making API requests
import dotenv from "dotenv"; // Load environment variables

dotenv.config(); // Load .env file

// Set port (Render will use this, defaults to 8080)
const port = process.env.PORT || 8080;
const elevenLabsApiKey = process.env.ELEVENLABS_API_KEY;
const elevenLabsAgentId = process.env.ELEVENLABS_AGENT_ID;

const wss = new WebSocketServer({ port }, () => {
  console.log(`✅ WebSocket Server running on port ${port}`);
});

wss.on("connection", async (twilioWs) => {
  console.log("✅ Twilio connected to our WebSocket");

  // ✅ Step 1: Get the Signed URL for the correct AI Agent
  async function getSignedUrl() {
    console.log("🛠 Fetching signed URL for Agent ID:", elevenLabsAgentId);

    try {
      const response = await fetch(
        `https://api.elevenlabs.io/v1/convai/conversation/get_signed_url?agent_id=${elevenLabsAgentId}`,
        {
          method: "GET",
          headers: { "xi-api-key": elevenLabsApiKey },
        }
      );

      if (!response.ok) {
        throw new Error(`Failed to get signed URL: ${response.statusText}`);
      }

      const data = await response.json();
      console.log("✅ Signed URL received:", data.signed_url);

      if (!data.signed_url.startsWith("wss://")) {
        console.error("❌ Invalid signed URL format:", data.signed_url);
        return null;
      }

      return data.signed_url;
    } catch (error) {
      console.error("❌ Error getting signed URL:", error);
      return null;
    }
  }

  let signedUrl = await getSignedUrl();

  if (!signedUrl) {
    console.error("❌ Could not retrieve signed URL, closing Twilio connection.");
    twilioWs.close();
    return;
  }

  // ✅ Step 2: Connect to Eleven Labs using the Signed URL
  let elevenLabsWs = new WebSocket(signedUrl);

  elevenLabsWs.on("open", () => {
    console.log("✅ Connected to Eleven Labs WebSocket");

    // ✅ Send AI Agent Configuration
    const initialConfig = {
      type: "conversation_initiation_client_data",
      conversation_config_override: {
        agent_id: elevenLabsAgentId, // Ensure correct AI agent is used
        agent: {
          prompt: { prompt: "Your AI agent's custom behavior and style" },
          first_message: "Hello! This is your AI assistant. How can I help you?",
        },
      },
    };

    console.log("📡 Sending AI agent configuration...");
    elevenLabsWs.send(JSON.stringify(initialConfig));
  });

  elevenLabsWs.on("error", (error) => {
    console.error("❌ Eleven Labs WebSocket Connection Error:", error);
  });

  elevenLabsWs.on("message", (data) => {
    try {
      const parsedData = JSON.parse(data.toString());

      // 🛑 Ignore non-audio messages
      if (parsedData.type === "conversation_initiation_metadata") {
        console.warn("⚠️ Ignoring metadata event from Eleven Labs:", parsedData);
        return;
      }

      // 📢 Handle AI-generated text response
      if (parsedData.type === "agent_response") {
        console.log(`🤖 AI Agent Response: ${parsedData.agent_response_event.agent_response}`);
        return;
      }

      // 🔊 Handle actual AI-generated audio
      if (parsedData.type === "audio_event" && parsedData.audio_event.audio_base_64) {
        console.log("🎤 AI-generated audio received.");

        // Convert base64 audio to Buffer
        const audioBuffer = Buffer.from(parsedData.audio_event.audio_base_64, "base64");

        if (twilioWs.readyState === WebSocket.OPEN) {
          console.log("🔄 Forwarding AI audio to Twilio...");
          twilioWs.send(audioBuffer);
        } else {
          console.warn("🚨 Twilio WebSocket is closed before AI response could be sent.");
        }
      }
    } catch (err) {
      console.error("❌ Error parsing Eleven Labs response:", err);
    }
  });

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
    if (elevenLabsWs.readyState === WebSocket.OPEN) {
      console.log(`🔊 Twilio audio received (${audioData.length} bytes), forwarding to Eleven Labs...`);
      elevenLabsWs.send(audioData);
    } else {
      console.warn("⚠️ Eleven Labs WebSocket is not open. Skipping audio forwarding.");
    }
  });

  // Handle WebSocket Closures
  twilioWs.on("close", () => {
    console.log(`❌ Twilio WebSocket closed.`);
    isTwilioConnected = false;
    clearInterval(silenceInterval);
    if (isElevenLabsConnected) {
      elevenLabsWs.close();
    }
  });

  elevenLabsWs.on("close", async (code, reason) => {
    console.log(`❌ Eleven Labs WebSocket closed. Code: ${code}, Reason: ${reason}`);
    isElevenLabsConnected = false;

    setTimeout(async () => {
      console.log("🔄 Reconnecting to Eleven Labs WebSocket...");
      signedUrl = await getSignedUrl();
      if (signedUrl) {
        elevenLabsWs = new WebSocket(signedUrl);
      }
    }, 3000);
  });

  twilioWs.on("error", (err) => console.error("❌ Twilio WS Error:", err));
  elevenLabsWs.on("error", (err) => console.error("❌ Eleven Labs WS Error:", err));
});
