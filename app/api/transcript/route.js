import { YoutubeTranscript } from "youtube-transcript-plus";

export async function POST(request) {
  try {
    const { videoId } = await request.json();

    if (!videoId || !/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
      return Response.json({ error: "Invalid video ID" }, { status: 400 });
    }

    // Fetch title and transcript in parallel
    const [title, transcriptSegments] = await Promise.all([
      fetchTitle(videoId),
      YoutubeTranscript.fetchTranscript(videoId, { lang: "en" }).catch(() =>
        // If English isn't available, fall back to any language
        YoutubeTranscript.fetchTranscript(videoId)
      ),
    ]);

    const transcript = transcriptSegments
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

    // Map library-specific errors to user-friendly messages
    const message = err.name?.startsWith("YoutubeTranscript")
      ? err.message
      : err.message || "Internal server error";

    const status =
      err.name === "YoutubeTranscriptVideoUnavailableError"
        ? 404
        : err.name === "YoutubeTranscriptTooManyRequestError"
          ? 429
          : err.name?.startsWith("YoutubeTranscript")
            ? 404
            : 500;

    return Response.json({ error: message }, { status });
  }
}

async function fetchTitle(videoId) {
  try {
    const resp = await fetch(
      `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`
    );
    if (resp.ok) {
      const data = await resp.json();
      return data.title || "Unknown";
    }
  } catch {
    // oEmbed failed, not critical
  }
  return "Unknown";
}
