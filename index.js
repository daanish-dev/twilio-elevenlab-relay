async function getSignedUrl() {
  console.log("🛠 Fetching signed URL for Agent ID:", elevenLabsAgentId); // Debugging log

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
    console.log("✅ Signed URL received:", data.signed_url); // Log the signed URL
    return data.signed_url;
  } catch (error) {
    console.error("❌ Error getting signed URL:", error);
    return null;
  }
}
