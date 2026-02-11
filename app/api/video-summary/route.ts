import { NextResponse } from "next/server";

export const runtime = "nodejs";

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
}

// ✅ This handles the browser "preflight" request
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: corsHeaders(),
  });
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const ad_url = body?.ad_url;
    const fallback_caption = body?.fallback_caption ?? "";

    if (!ad_url || typeof ad_url !== "string") {
      return NextResponse.json(
        { error: "Missing ad_url" },
        { status: 400, headers: corsHeaders() }
      );
    }

    // ✅ Keep using your existing Gemini logic here.
    // If you already have working Gemini summary code, paste it here and return its JSON.

    // --- EXAMPLE: if you already generate `result` JSON ---
    // const result = await yourGeminiFunction(ad_url, fallback_caption);
    // return NextResponse.json(result, { status: 200, headers: corsHeaders() });

    // TEMP fallback (replace with your real Gemini return if needed)
    return NextResponse.json(
      {
        mode: "video",
        transcript_summary: "CORS OK. Replace this with your Gemini result.",
        scene_descriptions: [],
        key_lines: [],
        candidate_hooks: [],
        candidate_pains: [],
        candidate_shows: [],
      },
      { status: 200, headers: corsHeaders() }
    );
  } catch (err: any) {
    return NextResponse.json(
      { error: "Server error", detail: String(err?.message ?? err) },
      { status: 500, headers: corsHeaders() }
    );
  }
}
