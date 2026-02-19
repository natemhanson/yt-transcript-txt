export async function POST(request) {
  try {
    const { videoId } = await request.json();

    if (!videoId || !/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
      return Response.json({ error: "Invalid video ID" }, { status: 400 });
    }

    // Step 1: Fetch the YouTube watch page
    const pageResp = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });

    if (!pageResp.ok) {
      return Response.json(
        { error: `YouTube returned status ${pageResp.status}` },
        { status: 502 }
      );
    }

    const html = await pageResp.text();

    // Extract video title
    const titleMatch = html.match(/<title>([^<]+)<\/title>/);
    let title = titleMatch
      ? titleMatch[1].replace(/ - YouTube$/, "").trim()
      : "Unknown";

    // Step 2: Extract caption tracks from the page
    const captionMatch = html.match(/"captionTracks"\s*:\s*(\[.*?\])/);
    if (!captionMatch) {
      // Try the innertube player approach as fallback
      const playerResp = await fetch(
        "https://www.youtube.com/youtubei/v1/player?prettyPrint=false",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          },
          body: JSON.stringify({
            context: {
              client: {
                clientName: "WEB",
                clientVersion: "2.20240101.00.00",
              },
            },
            videoId,
          }),
        }
      );

      if (!playerResp.ok) {
        return Response.json(
          { error: "No captions found for this video." },
          { status: 404 }
        );
      }

      const playerData = await playerResp.json();
      const tracks =
        playerData?.captions?.playerCaptionsTracklistRenderer?.captionTracks;

      if (!tracks || tracks.length === 0) {
        return Response.json(
          { error: "No captions found for this video." },
          { status: 404 }
        );
      }

      if (playerData?.videoDetails?.title) {
        title = playerData.videoDetails.title;
      }

      const track =
        tracks.find((t) => t.languageCode === "en" && !t.kind) ||
        tracks.find((t) => t.languageCode === "en") ||
        tracks[0];

      const transcript = await fetchCaptionText(track.baseUrl);
      return Response.json({ title, transcript, videoId });
    }

    // Parse caption tracks JSON
    let tracks;
    try {
      // The JSON in the HTML has escaped quotes
      const raw = captionMatch[1].replace(/\\u0026/g, "&").replace(/\\"/g, '"');
      tracks = JSON.parse(raw);
    } catch {
      return Response.json(
        { error: "Failed to parse caption data from YouTube page." },
        { status: 500 }
      );
    }

    if (!tracks || tracks.length === 0) {
      return Response.json(
        { error: "No captions found for this video." },
        { status: 404 }
      );
    }

    // Prefer manual English captions, then auto-generated English, then first available
    const track =
      tracks.find((t) => t.languageCode === "en" && t.kind !== "asr") ||
      tracks.find((t) => t.languageCode === "en") ||
      tracks[0];

    const baseUrl = track.baseUrl.replace(/\\u0026/g, "&");
    const transcript = await fetchCaptionText(baseUrl);

    return Response.json({ title, transcript, videoId });
  } catch (err) {
    console.error("Transcript error:", err);
    return Response.json(
      { error: err.message || "Internal server error" },
      { status: 500 }
    );
  }
}

async function fetchCaptionText(baseUrl) {
  const url = baseUrl.includes("fmt=")
    ? baseUrl
    : baseUrl + "&fmt=json3";

  const resp = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    },
  });

  const text = await resp.text();

  // Try JSON format first
  try {
    const data = JSON.parse(text);
    if (data.events) {
      const segments = data.events
        .filter((e) => e.segs)
        .map((e) => e.segs.map((s) => s.utf8 || "").join(""))
        .filter((s) => s.trim().length > 0);

      return segments
        .join(" ")
        .replace(/\n/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    }
  } catch {
    // Not JSON, try XML
  }

  // XML fallback
  const xmlSegments = [];
  const regex = /<text[^>]*>([\s\S]*?)<\/text>/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    xmlSegments.push(decodeXMLEntities(match[1]));
  }

  if (xmlSegments.length > 0) {
    return xmlSegments
      .join(" ")
      .replace(/\n/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  throw new Error("Could not parse caption data.");
}

function decodeXMLEntities(text) {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) =>
      String.fromCharCode(parseInt(n, 16))
    );
}
