import { getVideoDetails } from "youtube-caption-extractor";

export async function POST(request) {
  try {
    const { videoId } = await request.json();

    if (!videoId || !/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
      return Response.json({ error: "Invalid video ID" }, { status: 400 });
    }

    const details = await getVideoDetails({ videoID: videoId, lang: "en" });

    const title = details.title || "Unknown";

    if (!details.subtitles || details.subtitles.length === 0) {
      return Response.json(
        { error: "No captions found for this video." },
        { status: 404 }
      );
    }

    const transcript = details.subtitles
      .map((seg) => seg.text)
      .join(" ")
      .replace(/\n/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    if (!transcript) {
      return Response.json(
        { error: "No captions found for this video." },
        { status: 404 }
      );
    }

    return Response.json({ title, transcript, videoId });
  } catch (err) {
    console.error("Transcript error:", err);

    const message = err.message || "Internal server error";
    const status = message.includes("unavailable") ? 404 : 500;

    return Response.json({ error: message }, { status });
  }
}
