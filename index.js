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

  let reconnectAttempts = 0;
  const maxReconnectAttempts = 5;
  let elevenLabsWs = null;

  // Fetch Signed URL from Eleven Labs
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
      if (!data.signed_url) {
        throw new Error("❌ Invalid signed URL received!");
      }
      console.log("✅ Signed URL received:", data.signed_url);
      return data.signed_url;
    } catch (error) {
      console.error("❌ Error getting signed URL:", error);
      return null;
    }
  }

  // Establish connection to Eleven Labs
  async function connectToElevenLabs() {
    const signedUrl = await getSignedUrl();
    if (!signedUrl) {
      console.error("❌ Could not retrieve signed URL, closing Twilio connection.");
      twilioWs.close();
      return;
    }

    elevenLabsWs = new WebSocket(signedUrl);

    elevenLabsWs.on("open", () => {
      console.log("✅ Connected to Eleven Labs WebSocket");

      // AI agent configuration
      const initialConfig = {
        type: "conversation_initiation_client_data",
        conversation_config_override: {
          agent_id: elevenLabsAgentId,
          agent: {
            prompt: { prompt: "Your AI agent's custom behavior and style" },
            first_message: "Hello! This is your AI assistant. How can I help you?",
            always_listen: true,
            auto_continue: true,
          },
        },
      };

      console.log("📡 Sending AI agent configuration...");
      elevenLabsWs.send(JSON.stringify(initialConfig));

      // Reset reconnection attempts on successful connection
      reconnectAttempts = 0;
    });

    elevenLabsWs.on("error", (error) => {
      console.error("❌ Eleven Labs WebSocket Error:", error);
    });

    elevenLabsWs.on("close", async (code, reason) => {
      console.warn(`⚠️ Eleven Labs WebSocket closed. Code: ${code}, Reason: ${reason}`);

      if (reconnectAttempts < maxReconnectAttempts) {
        reconnectAttempts++;
        setTimeout(() => {
          console.log(`🔄 Reconnecting to Eleven Labs (${reconnectAttempts}/${maxReconnectAttempts})...`);
          connectToElevenLabs();
        }, 3000);
      } else {
        console.error("❌ Max reconnection attempts reached. Stopping reconnection.");
      }
    });
  }

  await connectToElevenLabs();

  // ✅ FIX 1: Properly handle Twilio audio before forwarding to Eleven Labs
  twilioWs.on("message", (audioData) => {
    if (elevenLabsWs && elevenLabsWs.readyState === WebSocket.OPEN) {
      console.log(`🔊 Received Twilio audio (${audioData.length} bytes), forwarding...`);

      // Ensure data is in the expected format before sending
      const formattedData = Buffer.from(audioData); // Convert to Buffer if needed
      elevenLabsWs.send(formattedData);
    } else {
      console.warn("⚠️ Eleven Labs WebSocket is not open. Skipping audio forwarding.");
    }
  });

  // ✅ FIX 2: Correctly process AI responses from Eleven Labs and forward to Twilio
  elevenLabsWs.on("message", (data) => {
    try {
      const message = JSON.parse(data);
      if (message.type === "agent_response" && message.agent_response_event?.audio) {
        console.log("🗣 AI Response received, forwarding to Twilio...");
        const aiAudioBuffer = Buffer.from(message.agent_response_event.audio, "base64"); // Decode Base64
        if (twilioWs.readyState === WebSocket.OPEN) {
          twilioWs.send(aiAudioBuffer);
        }
      } else {
        console.warn("⚠️ Unexpected AI response format:", message);
      }
    } catch (error) {
      console.error("❌ Failed to parse WebSocket message:", error);
    }
  });

  // Handle Twilio WebSocket closing
  twilioWs.on("close", (code, reason) => {
    console.log(`❌ Twilio WebSocket closed. Code: ${code}, Reason: ${reason}`);
    if (elevenLabsWs && elevenLabsWs.readyState !== WebSocket.CLOSED) {
      elevenLabsWs.close();
    }
  });

  // Prevent Twilio from timing out by sending silence
  function sendSilence() {
    if (twilioWs.readyState === WebSocket.OPEN) {
      console.log("🔇 Sending silent audio to Twilio to prevent timeout...");
      twilioWs.send(Buffer.alloc(320)); // 20ms of silence for 8kHz ulaw audio
    }
  }
  setInterval(sendSilence, 1000); // Send silence every second
});
