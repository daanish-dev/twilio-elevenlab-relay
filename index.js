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

      // Ensure it's a WebSocket URL
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
        agent_id: elevenLabsAgentId, // Force the correct AI agent ID
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

  elevenLabsWs.on("close", async (code, reason) => {
    console.warn(`⚠️ Eleven Labs WebSocket closed. Code: ${code}, Reason: ${reason}`);

    // 🔄 Retry logic to reconnect if it closes unexpectedly
    setTimeout(async () => {
      console.log("🔄 Reconnecting to Eleven Labs WebSocket...");
      signedUrl = await getSignedUrl();
      if (signedUrl) {
        elevenLabsWs = new WebSocket(signedUrl);
      }
    }, 3000); // Retry after 3 seconds
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

  // ✅ Convert Twilio raw audio to Base64 JSON for Eleven Labs
  twilioWs.on("message", (audioData) => {
    if (elevenLabsWs.readyState === WebSocket.OPEN) {
      console.log(`🔊 Twilio audio received (${audioData.length} bytes), forwarding to Eleven Labs...`);

      const formattedData = JSON.stringify({
        type: "audio_input",
        format: "pcm",
        data: audioData.toString("base64"),
      });

      elevenLabsWs.send(formattedData);
    } else {
      console.warn("⚠️ Eleven Labs WebSocket is not open. Skipping audio forwarding.");
    }
  });

  // ✅ Forward AI-generated audio from Eleven Labs to Twilio
  elevenLabsWs.on("message", (message) => {
    console.log(`🗣 Eleven Labs AI audio received`);

    try {
      const parsedMessage = JSON.parse(message);

      if (parsedMessage.type === "audio_output" && parsedMessage.data) {
        const aiAudio = Buffer.from(parsedMessage.data, "base64");

        if (twilioWs.readyState === WebSocket.OPEN) {
          console.log("🔄 Forwarding AI response to Twilio...");
          twilioWs.send(aiAudio);
        } else {
          console.warn("🚨 Twilio WebSocket is closed before AI response could be sent.");
        }
      } else {
        console.warn("⚠️ Unexpected message format received from Eleven Labs:", parsedMessage);
      }
    } catch (error) {
      console.error("❌ Error parsing AI response from Eleven Labs:", error);
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
});
