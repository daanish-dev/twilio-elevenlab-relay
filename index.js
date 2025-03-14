import WebSocket, { WebSocketServer } from "ws";
import fetch from "node-fetch";
import dotenv from "dotenv";

dotenv.config();

const port = process.env.PORT || 8080;
const elevenLabsApiKey = process.env.ELEVENLABS_API_KEY;
const elevenLabsAgentId = process.env.ELEVENLABS_AGENT_ID;

const wss = new WebSocketServer({ port }, () => {
  console.log(`✅ WebSocket Server running on port ${port}`);
});

wss.on("connection", async (twilioWs) => {
  console.log("✅ Twilio connected to our WebSocket");

  async function getSignedUrl() {
    console.log("🛠 Fetching signed URL for Agent ID:", elevenLabsAgentId);
    try {
      const response = await fetch(
        `https://api.elevenlabs.io/v1/convai/conversation/get_signed_url?agent_id=${elevenLabsAgentId}`,
        { method: "GET", headers: { "xi-api-key": elevenLabsApiKey } }
      );

      if (!response.ok) {
        throw new Error(`Failed to get signed URL: ${response.statusText}`);
      }

      const data = await response.json();
      console.log("✅ Signed URL received:", data.signed_url);
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

  let elevenLabsWs = new WebSocket(signedUrl);

  elevenLabsWs.on("open", () => {
    console.log("✅ Connected to Eleven Labs WebSocket");

    const initialConfig = {
      type: "conversation_initiation_client_data",
      conversation_config_override: {
        agent_id: elevenLabsAgentId,
        agent: {
          prompt: { prompt: "Your AI agent's behavior and style" },
          first_message: "Hello! This is your AI assistant. How can I help you?",
        },
      },
    };
    console.log("📡 Sending AI agent configuration...");
    elevenLabsWs.send(JSON.stringify(initialConfig));
  });

  elevenLabsWs.on("message", (message) => {
    const parsedMessage = JSON.parse(message.toString());
    if (parsedMessage.type === "audio_event") {
      const audioData = Buffer.from(parsedMessage.audio_event.audio_base_64, "base64");
      if (twilioWs.readyState === WebSocket.OPEN) {
        twilioWs.send(audioData);
      }
    } else if (parsedMessage.type === "agent_response_event") {
      console.log("🗣 AI Response:", parsedMessage.agent_response_event.agent_response);
    }
  });

  twilioWs.on("message", (audioData) => {
    if (elevenLabsWs.readyState === WebSocket.OPEN) {
      elevenLabsWs.send(audioData);
    }
  });

  twilioWs.on("close", () => {
    console.log("❌ Twilio WebSocket closed");
    if (elevenLabsWs.readyState !== WebSocket.CLOSED) {
      elevenLabsWs.close();
    }
  });

  elevenLabsWs.on("close", async () => {
    console.log("❌ Eleven Labs WebSocket closed");
    setTimeout(async () => {
      console.log("🔄 Reconnecting to Eleven Labs WebSocket...");
      signedUrl = await getSignedUrl();
      if (signedUrl) {
        elevenLabsWs = new WebSocket(signedUrl);
      }
    }, 3000);
  });

  elevenLabsWs.on("error", (err) => console.error("❌ Eleven Labs WS Error:", err));
  twilioWs.on("error", (err) => console.error("❌ Twilio WS Error:", err));
});
