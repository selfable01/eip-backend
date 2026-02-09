import { NextResponse } from "next/server";

/**
 * Simple helper to detect YouTube URLs
 */
function isYouTube(url: string) {
  return /youtube\.com|youtu\.be/.test(url);
}

/**
 * POST /api/video-summary
 * Body:
 * {
 *   ad_url: string,
 *   fallback_caption?: string,
 *   fallback_dialogue?: string
 * }
 */
export async function POST(req: Request) {
  try {
    // ✅ TEMP CHECK: confirm API key is loaded
    console.log(
      "GEMINI_API_KEY loaded:",
      !!process.env.GEMINI_API_KEY
    );

    const body = await req.json();
    const ad_url: string = body.ad_url || "";
    const fallback_caption: string = body.fallback_caption || "";
    const fallback_dialogue: string = body.fallback_dialogue || "";

    if (!ad_url) {
      return NextResponse.json(
        { error: "Missing ad_url" },
        { status: 400 }
      );
    }

    // ❌ Non-YouTube links → require text input
    if (!isYouTube(ad_url)) {
      if (!fallback_caption && !fallback_dialogue) {
        return NextResponse.json({
          mode: "text_required",
          message:
            "This platform link cannot be read as video. Please paste the caption or dialogue transcript.",
        });
      }

      const reference = await geminiTextSummary({
        ad_url,
        caption: fallback_caption,
        dialogue: fallback_dialogue,
      });

      return NextResponse.json({
        mode: "text",
        ...reference,
      });
    }

    // ✅ YouTube link → video summary mode
    const reference = await geminiYouTubeSummary({ ad_url });

    return NextResponse.json({
      mode: "video",
      ...reference,
    });
  } catch (err: any) {
    console.error("video-summary error:", err);
    return NextResponse.json(
      { error: String(err?.message || err) },
      { status: 500 }
    );
  }
}

/**
 * Gemini summary for YouTube links
 * (MVP: reasoning-based extraction from URL context)
 */
async function geminiYouTubeSummary({
  ad_url,
}: {
  ad_url: string;
}) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY not set");
  }

  const prompt = `
You are an advertising analyst.

Analyze the storytelling logic of this YouTube advertisement.
Return JSON ONLY in this format:

{
  "transcript_summary": "short paragraph summary",
  "scene_descriptions": [
    { "t": "0-3", "visual": "...", "dialogue": "..." },
    { "t": "3-8", "visual": "...", "dialogue": "..." }
  ],
  "key_lines": ["...", "..."],
  "candidate_hooks": ["...", "..."],
  "candidate_pains": ["...", "..."],
  "candidate_shows": ["...", "..."]
}

Rules:
- JSON only (no markdown, no explanation)
- If access to the exact video is limited, infer cautiously
- Keep everything generic and reusable
- Do NOT invent brand-specific claims

YouTube URL:
${ad_url}
`;

  return await callGemini(prompt);
}

/**
 * Gemini summary for TEXT MODE
 */
async function geminiTextSummary({
  ad_url,
  caption,
  dialogue,
}: {
  ad_url: string;
  caption: string;
  dialogue: string;
}) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY not set");
  }

  const prompt = `
You are an advertising analyst.

Analyze the storytelling logic using ONLY the text below.
Return JSON ONLY in this format:

{
  "transcript_summary": "short paragraph summary",
  "scene_descriptions": [
    { "t": "0-3", "visual": "...", "dialogue": "..." }
  ],
  "key_lines": ["...", "..."],
  "candidate_hooks": ["...", "..."],
  "candidate_pains": ["...", "..."],
  "candidate_shows": ["...", "..."]
}

Ad URL:
${ad_url}

Caption:
${caption}

Dialogue:
${dialogue}

Rules:
- JSON only
- Do not invent scenes not implied by the text
`;

  return await callGemini(prompt);
}

/**
 * Shared Gemini API call
 */
async function callGemini(prompt: string) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY not set");
  }

  const url =
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=" +
    encodeURIComponent(apiKey);

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      contents: [
        {
          role: "user",
          parts: [{ text: prompt }],
        },
      ],
    }),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(
      `Gemini API error ${resp.status}: ${errText}`
    );
  }

  const data = await resp.json();
  const text =
    data?.candidates?.[0]?.content?.parts?.[0]?.text || "";

  return safeParseJson(text);
}

/**
 * Safely parse Gemini JSON output
 */
function safeParseJson(text: string) {
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) {
      throw new Error("Failed to parse Gemini JSON output");
    }
    return JSON.parse(match[0]);
  }
}
