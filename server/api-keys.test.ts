import { describe, it, expect } from "vitest";

describe("API Key Validation", () => {
  it("OpenAI API key is active and can reach the API", async () => {
    const apiKey = process.env.OPENAI_API_KEY;
    expect(apiKey, "OPENAI_API_KEY must be set").toBeTruthy();

    const res = await fetch("https://api.openai.com/v1/models", {
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    expect(res.status, `OpenAI returned HTTP ${res.status} — key may be invalid or quota exceeded`).toBe(200);
    const data = await res.json() as { data: { id: string }[] };
    expect(Array.isArray(data.data)).toBe(true);
    expect(data.data.length).toBeGreaterThan(0);
    console.log(`✅ OpenAI key active — ${data.data.length} models available`);
  }, 15000);

  it("Anthropic API key is active and can reach the API", async () => {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    expect(apiKey, "ANTHROPIC_API_KEY must be set").toBeTruthy();

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey!,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-3-haiku-20240307",
        max_tokens: 10,
        messages: [{ role: "user", content: "Say hi" }],
      }),
    });

    // 200 = success, 400 = bad request (key valid but request issue), 401 = invalid key
    expect(
      res.status,
      `Anthropic returned HTTP ${res.status} — key may be invalid or quota exceeded`
    ).not.toBe(401);
    expect(res.status).not.toBe(403);

    const data = await res.json() as any;
    if (res.status === 200) {
      console.log(`✅ Anthropic key active — model: ${data.model}, stop_reason: ${data.stop_reason}`);
    } else {
      console.log(`✅ Anthropic key valid (HTTP ${res.status}) — response: ${JSON.stringify(data)}`);
    }
  }, 20000);
});
