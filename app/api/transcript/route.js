export async function POST(request) {
  try {
    const { videoId } = await request.json();

    if (!videoId || !/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
      return Response.json({ error: "Invalid video ID" }, { status: 400 });
    }

    // Fetch the YouTube watch page to extract caption data
    const pageResp = await fetch(
      `https://www.youtube.com/watch?v=${videoId}`,
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
          "Accept-Language": "en-US,en;q=0.9",
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
      }
    );

    if (!pageResp.ok) {
      return Response.json(
        { error: "Failed to fetch video page." },
        { status: 502 }
      );
    }

    const html = await pageResp.text();

    // Extract ytInitialPlayerResponse from the page HTML
    const playerMatch = html.match(
      /ytInitialPlayerResponse\s*=\s*(\{.+?\});/s
    );
    if (!playerMatch) {
      return Response.json(
        { error: "Could not parse video data from YouTube." },
        { status: 500 }
      );
    }

    let playerData;
    try {
      playerData = JSON.parse(playerMatch[1]);
    } catch {
      return Response.json(
        { error: "Could not parse video data from YouTube." },
        { status: 500 }
      );
    }

    // Extract video title
    const title = playerData?.videoDetails?.title || "Unknown";

    // Check playability
    const status = playerData?.playabilityStatus?.status;
    if (status === "UNPLAYABLE" || status === "ERROR") {
      return Response.json(
        { error: "This video is unavailable." },
        { status: 404 }
      );
    }

    // Extract caption tracks
    const captionTracks =
      playerData?.captions?.playerCaptionsTracklistRenderer?.captionTracks;

    if (!captionTracks || captionTracks.length === 0) {
      // Fallback: try InnerTube /next endpoint for transcript via engagement panels
      const transcript = await tryInnerTubeTranscript(videoId);
      if (transcript) {
        return Response.json({ title, transcript, videoId });
      }

      return Response.json(
        { error: "No captions found for this video." },
        { status: 404 }
      );
    }

    // Find the best caption track: prefer English, fall back to first available
    const track =
      captionTracks.find((t) => t.languageCode === "en") ||
      captionTracks.find((t) => t.languageCode?.startsWith("en")) ||
      captionTracks[0];

    if (!track?.baseUrl) {
      return Response.json(
        { error: "No captions found for this video." },
        { status: 404 }
      );
    }

    // Fetch the caption XML
    const captionResp = await fetch(track.baseUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
    });

    if (!captionResp.ok) {
      return Response.json(
        { error: "Failed to fetch caption data." },
        { status: 502 }
      );
    }

    const xml = await captionResp.text();

    // Parse XML captions: extract text from <text start="..." dur="...">content</text>
    const transcript = xml
      .replace(/<\?xml[^>]*\?>/, "")
      .split("</text>")
      .filter((line) => line.includes("<text"))
      .map((line) => {
        // Extract the text content after the <text ...> tag
        const textContent = line.replace(/<text[^>]*>/, "");
        return decodeHTMLEntities(textContent);
      })
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

// Decode HTML entities commonly found in YouTube captions
function decodeHTMLEntities(text) {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, num) => String.fromCharCode(Number(num)))
    .replace(/<\/?[^>]+(>|$)/g, ""); // strip any remaining HTML tags
}

// Fallback: use InnerTube API to get transcript from engagement panels
async function tryInnerTubeTranscript(videoId) {
  try {
    const API_KEY = "AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8";
    const clientVersion = "2.20250219.01.00";

    const context = {
      client: {
        hl: "en",
        gl: "US",
        clientName: "WEB",
        clientVersion,
      },
    };

    // Call /next to get engagement panels (including transcript panel)
    const nextResp = await fetch(
      `https://www.youtube.com/youtubei/v1/next?key=${API_KEY}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
          Origin: "https://www.youtube.com",
          Referer: "https://www.youtube.com/",
        },
        body: JSON.stringify({ context, videoId }),
      }
    );

    if (!nextResp.ok) return null;

    const nextData = await nextResp.json();

    // Find transcript engagement panel
    const panels = nextData?.engagementPanels || [];
    const transcriptPanel = panels.find(
      (p) =>
        p?.engagementPanelSectionListRenderer?.panelIdentifier ===
        "engagement-panel-searchable-transcript"
    );

    if (!transcriptPanel) return null;

    const content =
      transcriptPanel.engagementPanelSectionListRenderer?.content;

    // Find continuation token from multiple possible locations
    let token = null;

    // Try: direct continuationItemRenderer
    const contItem = content?.continuationItemRenderer;
    token =
      contItem?.continuationEndpoint?.getTranscriptEndpoint?.params ||
      contItem?.continuationEndpoint?.continuationCommand?.token ||
      null;

    // Try: inside sectionListRenderer
    if (!token) {
      const sections = content?.sectionListRenderer?.contents || [];
      for (const section of sections) {
        const ci = section?.continuationItemRenderer;
        if (ci) {
          token =
            ci?.continuationEndpoint?.getTranscriptEndpoint?.params ||
            ci?.continuationEndpoint?.continuationCommand?.token ||
            null;
          if (token) break;
        }
        // Try transcriptRenderer footer (language menu)
        const footer = section?.transcriptRenderer?.footer;
        const menuItems =
          footer?.transcriptFooterRenderer?.languageMenu
            ?.sortFilterSubMenuRenderer?.subMenuItems;
        if (menuItems) {
          const item =
            menuItems.find(
              (m) => m?.title?.toLowerCase().includes("english") || m?.selected
            ) || menuItems[0];
          token = item?.continuation?.reloadContinuationData?.continuation;
          if (token) break;
        }
      }
    }

    if (!token) return null;

    // Call /get_transcript with the continuation token
    const transcriptResp = await fetch(
      `https://www.youtube.com/youtubei/v1/get_transcript?key=${API_KEY}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
          Origin: "https://www.youtube.com",
          Referer: "https://www.youtube.com/",
        },
        body: JSON.stringify({ context, params: token }),
      }
    );

    if (!transcriptResp.ok) return null;

    const transcriptData = await transcriptResp.json();

    // Extract segments from the response
    const segments =
      transcriptData?.actions?.[0]?.updateEngagementPanelAction?.content
        ?.transcriptRenderer?.content?.transcriptSearchPanelRenderer?.body
        ?.transcriptSegmentListRenderer?.initialSegments;

    if (!segments || !Array.isArray(segments) || segments.length === 0)
      return null;

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

    if (texts.length === 0) return null;

    return texts
      .join(" ")
      .replace(/\n/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  } catch {
    return null;
  }
}
