export async function POST(request) {
  try {
    const { videoId } = await request.json();

    if (!videoId || !/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
      return Response.json({ error: "Invalid video ID" }, { status: 400 });
    }

    // Common headers for YouTube requests
    const defaultHeaders = {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      "Accept-Language": "en-US,en;q=0.9",
    };

    // Consent cookies to bypass cookie consent wall that YouTube shows
    // to server-side requests / certain regions
    const consentCookies =
      "SOCS=CAISNQgDEitib3FfaWRlbnRpdHlmcm9udGVuZHVpc2VydmVyXzIwMjMwODI5LjA3X3AxGgJlbiADGgYIgOe_pwY; CONSENT=PENDING+999";

    let title = "Unknown";
    let tracks = null;

    // ── Strategy 1: Fetch YouTube watch page and parse caption data ──
    try {
      const pageResp = await fetch(
        `https://www.youtube.com/watch?v=${videoId}`,
        {
          headers: {
            ...defaultHeaders,
            Cookie: consentCookies,
          },
        }
      );

      if (pageResp.ok) {
        const html = await pageResp.text();

        // Extract video title
        const titleMatch = html.match(/<title>([^<]+)<\/title>/);
        if (titleMatch) {
          title = titleMatch[1].replace(/ - YouTube$/, "").trim();
        }

        // Method A: Look for captionTracks directly
        const captionMatch = html.match(
          /"captionTracks"\s*:\s*(\[.*?\])/
        );
        if (captionMatch) {
          try {
            const raw = captionMatch[1]
              .replace(/\\u0026/g, "&")
              .replace(/\\"/g, '"');
            tracks = JSON.parse(raw);
          } catch {
            // JSON parse failed, will try other methods
          }
        }

        // Method B: Extract from ytInitialPlayerResponse
        if (!tracks || tracks.length === 0) {
          const playerRespMatch = html.match(
            /var\s+ytInitialPlayerResponse\s*=\s*(\{.+?\})\s*;/
          );
          if (playerRespMatch) {
            try {
              const playerData = JSON.parse(playerRespMatch[1]);
              const htmlTracks =
                playerData?.captions?.playerCaptionsTracklistRenderer
                  ?.captionTracks;
              if (htmlTracks && htmlTracks.length > 0) {
                tracks = htmlTracks;
                if (playerData?.videoDetails?.title) {
                  title = playerData.videoDetails.title;
                }
              }
            } catch {
              // JSON parse failed, will try other methods
            }
          }
        }

        // Method C: Look for captions in ytInitialData or embedded player response
        if (!tracks || tracks.length === 0) {
          const playerCaptionsMatch = html.match(
            /"playerCaptionsTracklistRenderer"\s*:\s*(\{[^}]*"captionTracks"\s*:\s*\[.*?\][^}]*\})/
          );
          if (playerCaptionsMatch) {
            try {
              const raw = playerCaptionsMatch[1]
                .replace(/\\u0026/g, "&")
                .replace(/\\"/g, '"');
              const parsed = JSON.parse(raw);
              if (parsed.captionTracks && parsed.captionTracks.length > 0) {
                tracks = parsed.captionTracks;
              }
            } catch {
              // Parse failed, continue to API fallback
            }
          }
        }
      }
    } catch {
      // Page fetch failed entirely, will try API fallbacks
    }

    // ── Strategy 2: Innertube API with WEB client ──
    if (!tracks || tracks.length === 0) {
      try {
        const result = await tryInnertubeClient(videoId, {
          clientName: "WEB",
          clientVersion: "2.20250217.00.00",
          userAgent: defaultHeaders["User-Agent"],
        });
        if (result.tracks && result.tracks.length > 0) {
          tracks = result.tracks;
          if (result.title) title = result.title;
        }
      } catch {
        // WEB client failed, try next
      }
    }

    // ── Strategy 3: Innertube API with MWEB client ──
    if (!tracks || tracks.length === 0) {
      try {
        const result = await tryInnertubeClient(videoId, {
          clientName: "MWEB",
          clientVersion: "2.20250217.00.00",
          userAgent:
            "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36",
        });
        if (result.tracks && result.tracks.length > 0) {
          tracks = result.tracks;
          if (result.title) title = result.title;
        }
      } catch {
        // MWEB client failed, try next
      }
    }

    // ── Strategy 4: Innertube API with TVHTML5_SIMPLY_EMBEDDED_PLAYER ──
    if (!tracks || tracks.length === 0) {
      try {
        const result = await tryInnertubeClient(videoId, {
          clientName: "TVHTML5_SIMPLY_EMBEDDED_PLAYER",
          clientVersion: "2.0",
          userAgent: defaultHeaders["User-Agent"],
        });
        if (result.tracks && result.tracks.length > 0) {
          tracks = result.tracks;
          if (result.title) title = result.title;
        }
      } catch {
        // Embedded player client failed too
      }
    }

    // ── All strategies exhausted ──
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

    const baseUrl = (track.baseUrl || "").replace(/\\u0026/g, "&");
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

async function tryInnertubeClient(videoId, { clientName, clientVersion, userAgent }) {
  const resp = await fetch(
    "https://www.youtube.com/youtubei/v1/player?prettyPrint=false",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": userAgent,
      },
      body: JSON.stringify({
        context: {
          client: {
            clientName,
            clientVersion,
          },
        },
        videoId,
      }),
    }
  );

  if (!resp.ok) {
    throw new Error(`Innertube ${clientName} returned ${resp.status}`);
  }

  const playerData = await resp.json();
  const tracks =
    playerData?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
  const playerTitle = playerData?.videoDetails?.title || null;

  return { tracks, title: playerTitle };
}

async function fetchCaptionText(baseUrl) {
  const url = baseUrl.includes("fmt=") ? baseUrl : baseUrl + "&fmt=json3";

  const resp = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
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

      if (segments.length > 0) {
        return segments
          .join(" ")
          .replace(/\n/g, " ")
          .replace(/\s+/g, " ")
          .trim();
      }
    }
  } catch {
    // Not JSON, try XML
  }

  // XML fallback (also handles case where fmt=json3 wasn't available)
  // Try fetching without fmt=json3 for XML format
  let xmlText = text;
  if (baseUrl.includes("fmt=")) {
    // Already have the text, use it
  } else {
    // Try fetching the raw URL (default XML format)
    try {
      const xmlResp = await fetch(baseUrl, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        },
      });
      xmlText = await xmlResp.text();
    } catch {
      // Use original text for XML parsing
    }
  }

  const xmlSegments = [];
  const regex = /<text[^>]*>([\s\S]*?)<\/text>/g;
  let match;
  while ((match = regex.exec(xmlText)) !== null) {
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
