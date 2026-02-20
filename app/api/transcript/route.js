const INNERTUBE_API_KEY = "AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8";

function innerTubeContext() {
  return {
    client: {
      hl: "en",
      gl: "US",
      clientName: "WEB",
      clientVersion: "2.20250220.01.00",
    },
  };
}

const HEADERS = {
  "Content-Type": "application/json",
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  Origin: "https://www.youtube.com",
  Referer: "https://www.youtube.com/",
};

export async function POST(request) {
  try {
    const { videoId } = await request.json();

    if (!videoId || !/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
      return Response.json({ error: "Invalid video ID" }, { status: 400 });
    }

    const errors = [];
    let title = "Unknown";
    let transcript = null;

    // ── Method 1: InnerTube /player for caption track URLs ──────────
    try {
      const result = await method_playerCaptions(videoId);
      if (result) {
        title = result.title || title;
        transcript = result.transcript;
      }
    } catch (err) {
      errors.push(`player: ${err.message}`);
    }

    // ── Method 2: InnerTube /next + /get_transcript ─────────────────
    if (!transcript) {
      try {
        const result = await method_nextTranscript(videoId);
        if (result) {
          title = result.title || title;
          transcript = result.transcript;
        }
      } catch (err) {
        errors.push(`next: ${err.message}`);
      }
    }

    // ── Method 3: Scrape YouTube watch page with consent cookies ────
    if (!transcript) {
      try {
        const result = await method_pageScrape(videoId);
        if (result) {
          title = result.title || title;
          transcript = result.transcript;
        }
      } catch (err) {
        errors.push(`page: ${err.message}`);
      }
    }

    if (!transcript) {
      const debugInfo = errors.length > 0 ? ` [${errors.join("; ")}]` : "";
      console.error(`All caption methods failed for ${videoId}:`, errors);
      return Response.json(
        { error: `No captions found for this video.${debugInfo}` },
        { status: 404 }
      );
    }

    return Response.json({ title, transcript, videoId });
  } catch (err) {
    console.error("Transcript error:", err);
    return Response.json(
      { error: err.message || "Internal server error" },
      { status: 500 }
    );
  }
}

// ═══════════════════════════════════════════════════════════════════════
// Method 1: InnerTube /player → caption track URL → fetch XML captions
// ═══════════════════════════════════════════════════════════════════════
async function method_playerCaptions(videoId) {
  const resp = await fetch(
    `https://www.youtube.com/youtubei/v1/player?key=${INNERTUBE_API_KEY}&prettyPrint=false`,
    {
      method: "POST",
      headers: HEADERS,
      body: JSON.stringify({
        context: innerTubeContext(),
        videoId,
        playbackContext: {
          contentPlaybackContext: { vis: 0, splay: false },
        },
        racyCheckOk: true,
        contentCheckOk: true,
      }),
    }
  );

  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const data = await resp.json();

  const title = data?.videoDetails?.title || null;
  const tracks =
    data?.captions?.playerCaptionsTracklistRenderer?.captionTracks;

  if (!tracks || tracks.length === 0) {
    throw new Error(
      `no caption tracks (status: ${data?.playabilityStatus?.status || "unknown"})`
    );
  }

  // Prefer English, fall back to first
  const track =
    tracks.find((t) => t.languageCode === "en") ||
    tracks.find((t) => t.languageCode?.startsWith("en")) ||
    tracks[0];

  if (!track?.baseUrl) throw new Error("no baseUrl on track");

  const transcript = await fetchCaptionXML(track.baseUrl);
  if (!transcript) throw new Error("empty XML transcript");

  return { title, transcript };
}

// ═══════════════════════════════════════════════════════════════════════
// Method 2: InnerTube /next → engagement panel → /get_transcript
// ═══════════════════════════════════════════════════════════════════════
async function method_nextTranscript(videoId) {
  // Step 1: call /next to get engagement panels
  const nextResp = await fetch(
    `https://www.youtube.com/youtubei/v1/next?key=${INNERTUBE_API_KEY}&prettyPrint=false`,
    {
      method: "POST",
      headers: HEADERS,
      body: JSON.stringify({ context: innerTubeContext(), videoId }),
    }
  );

  if (!nextResp.ok) throw new Error(`/next HTTP ${nextResp.status}`);
  const nextData = await nextResp.json();

  // Extract title from /next response
  const title =
    nextData?.contents?.twoColumnWatchNextResults?.results?.results
      ?.contents?.[0]?.videoPrimaryInfoRenderer?.title?.runs?.[0]?.text ||
    nextData?.videoDetails?.title ||
    null;

  // Find transcript panel
  const panels = nextData?.engagementPanels || [];
  const transcriptPanel = panels.find(
    (p) =>
      p?.engagementPanelSectionListRenderer?.panelIdentifier ===
      "engagement-panel-searchable-transcript"
  );

  if (!transcriptPanel) throw new Error("no transcript panel");

  const content =
    transcriptPanel.engagementPanelSectionListRenderer?.content;

  // Step 2: extract continuation token
  const token = findContinuationToken(content);
  if (!token) throw new Error("no continuation token");

  // Step 3: call /get_transcript
  const trResp = await fetch(
    `https://www.youtube.com/youtubei/v1/get_transcript?key=${INNERTUBE_API_KEY}&prettyPrint=false`,
    {
      method: "POST",
      headers: HEADERS,
      body: JSON.stringify({ context: innerTubeContext(), params: token }),
    }
  );

  if (!trResp.ok) throw new Error(`/get_transcript HTTP ${trResp.status}`);
  const trData = await trResp.json();

  const segments =
    trData?.actions?.[0]?.updateEngagementPanelAction?.content
      ?.transcriptRenderer?.content?.transcriptSearchPanelRenderer?.body
      ?.transcriptSegmentListRenderer?.initialSegments;

  if (!segments?.length) throw new Error("no transcript segments");

  const texts = segments
    .map((seg) => {
      const r = seg?.transcriptSegmentRenderer;
      if (!r) return "";
      return (
        r.snippet?.simpleText ||
        r.snippet?.runs?.map((run) => run.text).join("") ||
        ""
      );
    })
    .filter((t) => t.trim());

  if (texts.length === 0) throw new Error("all segments empty");

  const transcript = texts
    .join(" ")
    .replace(/\n/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return { title, transcript };
}

// ═══════════════════════════════════════════════════════════════════════
// Method 3: Scrape YouTube watch page HTML (with consent cookies)
// ═══════════════════════════════════════════════════════════════════════
async function method_pageScrape(videoId) {
  const resp = await fetch(
    `https://www.youtube.com/watch?v=${videoId}&hl=en&has_verified=1`,
    {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        "Accept-Language": "en-US,en;q=0.9",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        Cookie:
          "CONSENT=PENDING+999; SOCS=CAESEwgDEgk2ODE3MTcyMjQaAmVuIAEaBgiA_LyaBg",
      },
    }
  );

  if (!resp.ok) throw new Error(`page HTTP ${resp.status}`);
  const html = await resp.text();

  // Check if we got a consent page instead of the actual video
  if (
    html.includes("consent.youtube.com") ||
    html.includes("CONSENT") && !html.includes("ytInitialPlayerResponse")
  ) {
    throw new Error("got consent page");
  }

  // Extract ytInitialPlayerResponse using brace counting for robust JSON extraction
  const playerData = extractJSON(html, "ytInitialPlayerResponse");
  if (!playerData) throw new Error("no ytInitialPlayerResponse in HTML");

  const title = playerData?.videoDetails?.title || null;
  const tracks =
    playerData?.captions?.playerCaptionsTracklistRenderer?.captionTracks;

  if (!tracks || tracks.length === 0) {
    throw new Error("no caption tracks in page data");
  }

  const track =
    tracks.find((t) => t.languageCode === "en") ||
    tracks.find((t) => t.languageCode?.startsWith("en")) ||
    tracks[0];

  if (!track?.baseUrl) throw new Error("no baseUrl");

  const transcript = await fetchCaptionXML(track.baseUrl);
  if (!transcript) throw new Error("empty XML");

  return { title, transcript };
}

// ═══════════════════════════════════════════════════════════════════════
// Shared helpers
// ═══════════════════════════════════════════════════════════════════════

async function fetchCaptionXML(url) {
  const resp = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    },
  });
  if (!resp.ok) throw new Error(`caption XML HTTP ${resp.status}`);
  const xml = await resp.text();

  const transcript = xml
    .split("</text>")
    .filter((line) => line.includes("<text"))
    .map((line) => decodeHTMLEntities(line.replace(/<text[^>]*>/, "")))
    .join(" ")
    .replace(/\n/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return transcript || null;
}

function decodeHTMLEntities(text) {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, num) => String.fromCharCode(Number(num)))
    .replace(/<\/?[^>]+(>|$)/g, "");
}

// Extract a JSON object from HTML by finding the variable assignment
// and counting braces to find the complete object (more robust than regex)
function extractJSON(html, varName) {
  // Match both "var name = {" and "name = {"
  const patterns = [
    `var ${varName}\\s*=\\s*\\{`,
    `${varName}\\s*=\\s*\\{`,
    `window\\["${varName}"\\]\\s*=\\s*\\{`,
  ];

  for (const pattern of patterns) {
    const match = html.match(new RegExp(pattern));
    if (!match) continue;

    // Find the opening brace position
    const startIdx = html.indexOf("{", match.index + varName.length);
    if (startIdx === -1) continue;

    // Count braces to find the matching closing brace
    let depth = 0;
    let inString = false;
    let escape = false;

    for (let i = startIdx; i < html.length; i++) {
      const ch = html[i];

      if (escape) {
        escape = false;
        continue;
      }

      if (ch === "\\") {
        escape = true;
        continue;
      }

      if (ch === '"' && !escape) {
        inString = !inString;
        continue;
      }

      if (inString) continue;

      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) {
          try {
            return JSON.parse(html.slice(startIdx, i + 1));
          } catch {
            break;
          }
        }
      }
    }
  }

  return null;
}

function findContinuationToken(content) {
  if (!content) return null;

  // Try: direct continuationItemRenderer
  const ci = content?.continuationItemRenderer;
  if (ci) {
    const t =
      ci?.continuationEndpoint?.getTranscriptEndpoint?.params ||
      ci?.continuationEndpoint?.continuationCommand?.token;
    if (t) return t;
  }

  // Try: inside sectionListRenderer
  const sections = content?.sectionListRenderer?.contents || [];
  for (const section of sections) {
    const sci = section?.continuationItemRenderer;
    if (sci) {
      const t =
        sci?.continuationEndpoint?.getTranscriptEndpoint?.params ||
        sci?.continuationEndpoint?.continuationCommand?.token;
      if (t) return t;
    }

    // Try: transcriptRenderer footer language menu
    const menuItems =
      section?.transcriptRenderer?.footer?.transcriptFooterRenderer
        ?.languageMenu?.sortFilterSubMenuRenderer?.subMenuItems;
    if (menuItems) {
      const item =
        menuItems.find(
          (m) => m?.title?.toLowerCase().includes("english") || m?.selected
        ) || menuItems[0];
      const t = item?.continuation?.reloadContinuationData?.continuation;
      if (t) return t;
    }
  }

  return null;
}
