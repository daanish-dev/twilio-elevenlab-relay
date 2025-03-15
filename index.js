import WebSocket, { WebSocketServer } from 'ws';
import dotenv from 'dotenv';

dotenv.config();

const PORT = process.env.PORT || 8080;

const wss = new WebSocketServer({ port: PORT }, () => {
    console.log(`✅ WebSocket Server running on ws://localhost:${PORT}`);
});

wss.on('connection', (twilioWs, req) => {
    console.log(`✅ Twilio WebSocket connected from: ${req.socket.remoteAddress}`);

    // Connect to Eleven Labs AI agent WebSocket
    console.log('⚙ Connecting to Eleven Labs WebSocket...');
    const elevenLabsWs = new WebSocket('wss://api.elevenlabs.io/v1/conversational/stream', {
        headers: {
            'xi-api-key': process.env.ELEVEN_API_KEY,
            'xi-agent-id': process.env.ELEVEN_AGENT_ID,
            'xi-voice-id': process.env.ELEVEN_VOICE_ID,
            'Content-Type': 'application/json'
        }
    });

    const noise = Buffer.from([0xF8, 0xFF, 0xFE]); // Background noise
    const noiseInterval = setInterval(() => twilioWs.readyState === WebSocket.OPEN && twilioWs.send(noise), 500);
    const pingInterval = setInterval(() => elevenLabsWs.readyState === WebSocket.OPEN && elevenLabsWs.send(JSON.stringify({ type: 'ping' })), 5000);

    twilioWs.on('message', (msg) => {
        console.log(`🔊 Twilio audio received (${msg.length} bytes)`);
        if (elevenLabsWs.readyState === WebSocket.OPEN) elevenLabsWs.send(msg);
    });

    elevenLabsWs.on('message', (msg) => {
        console.log(`🗣 AI audio received (${msg.length} bytes)`);
        if (twilioWs.readyState === WebSocket.OPEN) twilioWs.send(msg);
    });

    const cleanup = (reason) => {
        console.log(`❌ Closing connections: ${reason}`);
        clearInterval(noiseInterval);
        clearInterval(pingInterval);
        twilioWs.close();
        elevenLabsWs.close();
    };

    twilioWs.on('close', () => cleanup('Twilio closed'));
    elevenLabsWs.on('close', () => cleanup('Eleven Labs closed'));
    elevenLabsWs.on('error', (err) => { console.error('❌ Eleven Labs WS Error:', err); cleanup('Eleven Labs error'); });
    twilioWs.on('error', (err) => { console.error('❌ Twilio WS Error:', err); cleanup('Twilio error'); });
});

