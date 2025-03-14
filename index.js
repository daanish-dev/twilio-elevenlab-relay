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

  let elevenLabsWs = null;
  let audioFormat = "ulaw_8000"; // Default format

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

      if (!response.ok) throw new Error(`Failed to get signed URL: ${response.statusText}`);
      
      const data = await response.json();
      if (!data.signed_url) throw new Error("❌ Invalid signed URL received!");

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

      // Send initial conversation configuration
      const initMessage = {
        type: "conversation_initiation_client_data",
        conversation_config_override: {
          agent_id: elevenLabsAgentId,
          agent: {
            prompt: { prompt: "Your AI assistant is ready to help!" },
            first_message: "Hello! This is your AI assistant. How can I help you?",
            always_listen: true,
            auto_continue: true,
          },
        },
      };

      console.log("📡 Sending AI agent configuration...");
      elevenLabsWs.send(JSON.stringify(initMessage));
    });

    // ✅ Handle metadata response properly
    elevenLabsWs.on("message", (data) => {
      try {
        const message = JSON.parse(data);
        if (message.type === "conversation_initiation_metadata") {
          console.log("✅ Conversation initiated:", message);
          audioFormat = message.conversation_initiation_metadata_event.agent_output_audio_format;
          console.log("🔊 Audio format set to:", audioFormat);
        } else if (message.type === "audio") {
          const aiAudioBuffer = Buffer.from(message.audio, "base64");
          if (twilioWs.readyState === WebSocket.OPEN) {
            console.log("🗣 AI audio response received, forwarding to Twilio...");
            twilioWs.send(aiAudioBuffer);
          }
        } else {
          console.warn("⚠️ Unexpected message type from Eleven Labs:", message);
        }
      } catch (error) {
        console.error("❌ Failed to parse Eleven Labs message:", error);
      }
    });

    elevenLabsWs.on("error", (error) => {
      console.error("❌ Eleven Labs WebSocket Error:", error);
    });

    elevenLabsWs.on("close", (code, reason) => {
      console.warn(`⚠️ Eleven Labs WebSocket closed. Code: ${code}, Reason: ${reason}`);
    });
  }

  await connectToElevenLabs();

  // ✅ Forward Twilio audio properly formatted for Eleven Labs
  twilioWs.on("message", (audioData) => {
    if (elevenLabsWs && elevenLabsWs.readyState === WebSocket.OPEN) {
      console.log(`🔊 Received Twilio audio (${audioData.length} bytes), forwarding to Eleven Labs...`);

      const formattedAudio = {
        type: "audio",
        audio: audioData.toString("base64"),
        encoding: "ulaw_8000" // Always use ulaw_8000 for Twilio audio
      };
      elevenLabsWs.send(JSON.stringify(formattedAudio));
    } else {
      console.warn("⚠️ Eleven Labs WebSocket not open, cannot forward audio.");
    }
  });

  // ✅ Handle Twilio disconnection
  twilioWs.on("close", (code, reason) => {
    console.log(`❌ Twilio WebSocket closed. Code: ${code}, Reason: ${reason}`);
    if (elevenLabsWs && elevenLabsWs.readyState !== WebSocket.CLOSED) {
      elevenLabsWs.close();
    }
  });

  // ✅ Send silence to prevent Twilio timeout
  function sendSilence() { 
    if (twilioWs.readyState === WebSocket.OPEN) {
      console.log("🔇 Sending silent audio to Twilio to keep connection alive...");
      twilioWs.send(Buffer.alloc(320)); // 20ms of silence (ulaw 8kHz)
    }
  }
  setInterval(sendSilence, 1000); // Send silence every second
});