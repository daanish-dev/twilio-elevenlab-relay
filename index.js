import WebSocket, { WebSocketServer } from 'ws';
import 'dotenv/config'; // Loads environment variables from .env file

// Load API keys from environment
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const ELEVENLABS_AGENT_ID = process.env.ELEVENLABS_AGENT_ID;

if (!ELEVENLABS_API_KEY || !ELEVENLABS_AGENT_ID) {
  console.error("❌ API Key or Agent ID missing. Check your .env file.");
  process.exit(1);
}

// Start WebSocket server
const wss = new WebSocketServer({ port: 8080 }, () => {
  console.log("✅ WebSocket Server started on ws://localhost:8080");
});

// Handle new Twilio connections
wss.on('connection', (twilioWs, req) => {
  console.log(`✅ Twilio WebSocket connected from: ${req.socket.remoteAddress}`);

  // Connect to Eleven Labs
  console.log("⚙️ Connecting to Eleven Labs WebSocket...");
  const elevenLabsWs = new WebSocket('wss://api.elevenlabs.io/v1/conversational/stream', {
    headers: {
      'xi-api-key': ELEVENLABS_API_KEY,
      'xi-agent-id': ELEVENLABS_AGENT_ID,
      'Content-Type': 'application/json',
    },
  });

  // Background silent Opus frame
  const generateNoise = () => Buffer.from([0xF8, 0xFF, 0xFE]);

  // Keep-alive pings
  const keepAliveInterval = setInterval(() => {
    if (twilioWs.readyState === WebSocket.OPEN) {
      console.log('🔈 Sending background noise to Twilio...');
      twilioWs.send(generateNoise());
    }
  }, 500);

  const keepAlivePing = setInterval(() => {
    if (elevenLabsWs.readyState === WebSocket.OPEN) {
      console.log('🛠 Sending Keep-Alive Ping to Eleven Labs...');
      elevenLabsWs.send(JSON.stringify({ type: 'ping' }));
    }
  }, 5000);

  // Handle Eleven Labs connection
  elevenLabsWs.on('open', () => console.log('✅ Connected to Eleven Labs WebSocket'));
  elevenLabsWs.on('error', (err) => console.error('❌ Eleven Labs WebSocket Error:', err));
  elevenLabsWs.on('close', (code, reason) => {
    console.warn(`❌ Eleven Labs WebSocket closed. Code: ${code}, Reason: ${reason}`);
    if (twilioWs.readyState === WebSocket.OPEN) twilioWs.close();
    clearInterval(keepAliveInterval);
    clearInterval(keepAlivePing);
  });

  // Handle Twilio WebSocket messages and forward to Eleven Labs
  twilioWs.on('message', (audioData) => {
    console.log(`🔊 Twilio audio received (${audioData.length} bytes)`);
    if (elevenLabsWs.readyState === WebSocket.OPEN) {
      elevenLabsWs.send(audioData);
      console.log("➡️ Forwarded audio to Eleven Labs.");
    } else {
      console.warn("⚠ Eleven Labs WebSocket not open. Skipping forwarding.");
    }
  });

  // Handle AI-generated responses and forward back to Twilio
  elevenLabsWs.on('message', (aiAudio) => {
    console.log(`🗣 Eleven Labs AI audio received (${aiAudio.length} bytes)`);
    if (twilioWs.readyState === WebSocket.OPEN) {
      twilioWs.send(aiAudio);
      console.log("🔄 Forwarded AI response to Twilio.");
    } else {
      console.warn("🚨 Twilio WebSocket closed before AI response could be sent.");
    }
  });

  // Handle Twilio WebSocket closure
  twilioWs.on('close', (code, reason) => {
    console.warn(`❌ Twilio WebSocket closed. Code: ${code}, Reason: ${reason}`);
    if (elevenLabsWs.readyState === WebSocket.OPEN) elevenLabsWs.close();
    clearInterval(keepAliveInterval);
    clearInterval(keepAlivePing);
  });

  twilioWs.on('error', (err) => console.error('❌ Twilio WebSocket Error:', err));
});
