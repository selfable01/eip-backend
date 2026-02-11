import { NextRequest, NextResponse } from "next/server";
import { YoutubeTranscript } from "youtube-transcript";

export const runtime = "nodejs";

const BUILD_ID = "video-summary-v2-2026-02-11";

// ---- CORS helper ----
function corsHeaders(req: NextRequest) {
  const origin = req.headers.get("origin") || "";
  const allowOrigin = origin.endsWith(".lovable.app") || origin === "https://lovable.dev" ? origin : "*";

  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, x-goog-api-key",
    "Access-Control-Max-Age": "86400",
  };
}

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req) });
}

// Try to extract JSON object from Gemini output even if it includes extra text
function extractJsonObject(text: string): any | null {
  const trimmed = text.trim();
  // direct parse
  try {
    return JSON.parse(trimmed);
  } catch {}

  // try find first { ... last }
  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first !== -1 && last !== -1 && last > first) {
    const maybe = trimmed.slice(first, last + 1);
    try {
      return JSON.parse(maybe);
    } catch {}
  }
  return null;
}

export async function POST(req: NextRequest) {
  const headers = corsHeaders(req);

  try {
    const body = await req.json().catch(() => ({}));
    const ad_url = body?.ad_url;
    const fallback_caption = body?.fallback_caption;

    if (!ad_url || typeof ad_url !== "string") {
      return NextResponse.json(
        { build_id: BUILD_ID, error: "Missing ad_url" },
        { status: 400, headers }
      );
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { build_id: BUILD_ID, error: "Missing GEMINI_API_KEY on server (set in Vercel env vars)" },
        { status: 500, headers }
      );
    }

    // 1) Get transcript text (YouTube only, no video download)
    let transcriptText = "";

    const isYouTube =
      ad_url.includes("youtube.com") || ad_url.includes("youtu.be") || ad_url.includes("youtube.com/shorts");

    if (isYouTube) {
      try {
        const items = await YoutubeTranscript.fetchTranscript(ad_url);
        transcriptText = items.map((item: { text: string }) => item.text).join(" ");
      } catch {
        transcriptText = "";
      }
    }

    const caption = typeof fallback_caption === "string" ? fallback_caption : "";
    const sourceText = transcriptText.trim() || caption.trim();

    if (!sourceText) {
      return NextResponse.json(
        {
          build_id: BUILD_ID,
          mode: "need_text",
          transcript_summary:
            "No transcript could be extracted from this URL. For TikTok/Facebook/Xiaohongshu or music-only ads, please paste the caption or transcript into fallback_caption.",
          scene_descriptions: [],
          key_lines: [],
          candidate_hooks: [],
          candidate_pains: [],
          candidate_shows: [],
          ctas: [],
        },
        { status: 200, headers }
      );
    }

    // 2) Ask Gemini to produce STRICT JSON (text-only analysis, no guessing visuals)
    const prompt = `
You are an "Ad Reference Analyzer".

You ONLY have the provided transcript/caption text. You cannot see video frames.
Do NOT invent visuals. If visuals are not clearly described in the text, set visual="UNKNOWN".

Return STRICT JSON with this exact shape:

{
  "mode": "text",
  "transcript_summary": "string",
  "scene_descriptions": [
    {"t":"0-3","visual":"UNKNOWN or text-supported","dialogue":"string or NONE"}
  ],
  "key_lines": ["string"],
  "candidate_hooks": ["string"],
  "candidate_pains": ["string"],
  "candidate_shows": ["string"],
  "ctas": ["string"]
}

Requirements:
- scene_descriptions: 6–10 segments, with time ranges like "0-3", "3-8", "8-15", etc.
- candidate_hooks: 8–10 items
- candidate_pains: 8–10 items
- candidate_shows: 8–10 items
- ctas: 6–10 items
- key_lines: 8–12 items if possible
- If there is no dialogue, use "NONE" (do not hallucinate lines).

TEXT TO ANALYZE:
"""${sourceText}"""
`.trim();

    const geminiRes = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey,
        },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.3,
            responseMimeType: "application/json",
          },
        }),
      }
    );

    if (!geminiRes.ok) {
      const errText = await geminiRes.text();
      return NextResponse.json(
        { build_id: BUILD_ID, error: "Gemini API error", details: errText },
        { status: 502, headers }
      );
    }

    const geminiJson = await geminiRes.json();
    const textOut = geminiJson?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "";

    const parsed = extractJsonObject(textOut);
    if (!parsed) {
      return NextResponse.json(
        { build_id: BUILD_ID, error: "Gemini did not return valid JSON", raw: textOut },
        { status: 502, headers }
      );
    }

    // attach build_id so you can confirm deployed version from Lovable
    return NextResponse.json({ ...parsed, build_id: BUILD_ID }, { status: 200, headers });
  } catch (e: any) {
    return NextResponse.json(
      { build_id: BUILD_ID, error: "Server error", details: String(e?.message || e) },
      { status: 500, headers }
    );
  }
}
