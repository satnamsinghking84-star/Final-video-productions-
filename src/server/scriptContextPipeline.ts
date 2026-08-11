import { GoogleGenAI, Type } from "@google/genai";

export interface ScriptSegmentInput {
  start: number;
  end: number;
  text: string;
  [key: string]: any;
}

export interface ContextualSegmentResult {
  start: number;
  end: number;
  text: string;
  subject: string;
  action: string;
  keywords: string;
  query: string;
  image_url: string;
  imageUrl: string;
  imageType: "image" | "video";
}

// Advanced Local NLP Fallback Extractor for English, Hindi, and Hinglish scripts
export function extractLocalKeywords(text: string): { subject: string; action: string; keywords: string; query: string } {
  if (!text || !text.trim()) {
    return {
      subject: "information news",
      action: "displaying details",
      keywords: "news background information",
      query: "news background information cinematic high resolution professional photography"
    };
  }

  const raw = text.trim();
  const lower = raw.toLowerCase();

  // Common stop words to strip away
  const stopWords = new Set([
    "a", "an", "the", "is", "are", "was", "were", "be", "been", "being",
    "have", "has", "had", "do", "does", "did", "will", "would", "shall",
    "should", "may", "might", "must", "can", "could", "of", "for", "with",
    "about", "against", "between", "into", "through", "during", "before",
    "after", "above", "below", "to", "from", "up", "down", "in", "out",
    "on", "off", "over", "under", "again", "further", "then", "once", "here",
    "there", "when", "where", "why", "how", "all", "any", "both", "each",
    "few", "more", "most", "other", "some", "such", "no", "nor", "not",
    "only", "own", "same", "so", "than", "too", "very", "s", "t", "can",
    "will", "just", "don", "should", "now", "hai", "hain", "ho", "ka", "ke",
    "ki", "ko", "se", "me", "par", "bhi", "thi", "tha", "the", "aur", "ya"
  ]);

  // Topic specific rule enhancements
  if (lower.includes("tiger") || lower.includes("शेर") || lower.includes("चीता")) {
    const subject = "wild tiger";
    const action = lower.includes("run") || lower.includes("भाग") ? "running in dense jungle" : "walking in wild forest";
    return {
      subject,
      action,
      keywords: `wild tiger ${action}`,
      query: `${subject} ${action} cinematic high resolution professional photography`
    };
  }

  if (lower.includes("मोदी") || lower.includes("modi") || lower.includes("prime minister") || lower.includes("प्रधान मंत्री")) {
    return {
      subject: "Prime Minister Narendra Modi",
      action: "delivering official speech at podium",
      keywords: "Prime Minister Narendra Modi India speech",
      query: "Prime Minister Narendra Modi official speech podium cinematic high resolution professional photography"
    };
  }

  if (lower.includes("पेपर लीक") || lower.includes("paper leak") || lower.includes("परीक्षा") || lower.includes("exam")) {
    return {
      subject: "examination paper and students",
      action: "protesting student examination leak",
      keywords: "paper leak exam student protest India",
      query: "paper leak examination answer sheet students protest cinematic high resolution professional photography"
    };
  }

  if (lower.includes("कैबिनेट") || lower.includes("cabinet") || lower.includes("सरकार") || lower.includes("government")) {
    return {
      subject: "government cabinet meeting",
      action: "official policy decision discussion",
      keywords: "government cabinet meeting decision",
      query: "government cabinet meeting official conference room cinematic high resolution professional photography"
    };
  }

  if (lower.includes("कानून") || lower.includes("court") || lower.includes("judge") || lower.includes("justice")) {
    return {
      subject: "court law and justice",
      action: "strict legal action and gavel",
      keywords: "court justice legal action gavel",
      query: "courtroom justice judge gavel law book cinematic high resolution professional photography"
    };
  }

  // Generic token extraction
  const words = raw
    .replace(/[^\w\s\u0900-\u097F]/gi, " ")
    .split(/\s+/)
    .filter(w => w.length > 2 && !stopWords.has(w.toLowerCase()));

  const mainTokens = words.slice(0, 4).join(" ") || "news updates information";
  const subject = words.slice(0, 2).join(" ") || "topic";
  const action = words.slice(2, 4).join(" ") || "activity";
  const keywords = mainTokens;
  const query = `${mainTokens} cinematic high resolution professional photography`;

  return { subject, action, keywords, query };
}

// Perform Gemini AI Script Analysis (NLP) to extract Subject, Action, Keywords & Query for each segment
export async function analyzeScriptSegments(
  segments: ScriptSegmentInput[]
): Promise<{ subject: string; action: string; keywords: string; query: string }[]> {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey || apiKey === "MY_GEMINI_API_KEY") {
    console.log("[ScriptNLP] Gemini API key not configured. Using local NLP keyword fallback.");
    return segments.map(seg => extractLocalKeywords(seg.text));
  }

  try {
    const ai = new GoogleGenAI({
      apiKey: apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build'
        }
      }
    });

    const promptText = `Analyze the following audio/video script segments (in English, Hindi, Hinglish, or Indian regional languages) sentence-by-sentence.
For EVERY segment, perform deep contextual NLP script analysis to identify:
1. "primary_subject": The main noun/person/object (e.g., "wild tiger", "Prime Minister", "student exam paper", "money cash").
2. "action": The active verb or context occurring (e.g., "running in dense jungle", "giving speech at podium", "writing exam in hall", "calculating monthly budget").
3. "keywords": 3-5 core search keywords representing this exact scene.
4. "query": A high-quality search query combining the subject, action, and descriptive quality modifiers (MUST end with "cinematic high resolution professional photography").

Script Segments:
${segments.map((s, idx) => `[Segment #${idx + 1} | ${s.start}s - ${s.end}s]: "${s.text}"`).join("\n")}

Respond strictly in JSON matching the specified schema.`;

    const modelsToTry = ["gemini-3.6-flash", "gemini-flash-latest", "gemini-3.1-flash-lite"];
    for (const modelName of modelsToTry) {
      try {
        const response = await ai.models.generateContent({
          model: modelName,
          contents: [{ text: promptText }],
          config: {
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                analysis: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      primary_subject: { type: Type.STRING, description: "Primary subject noun" },
                      action: { type: Type.STRING, description: "Action or setting" },
                      keywords: { type: Type.STRING, description: "Core search keywords" },
                      query: { type: Type.STRING, description: "Formulated search query with quality modifiers" }
                    },
                    required: ["primary_subject", "action", "keywords", "query"]
                  }
                }
              },
              required: ["analysis"]
            }
          }
        });

        if (response.text) {
          const parsed = JSON.parse(response.text);
          if (parsed.analysis && Array.isArray(parsed.analysis) && parsed.analysis.length === segments.length) {
            console.log(`[ScriptNLP] Successfully analyzed ${segments.length} segments using ${modelName}`);
            return parsed.analysis.map((item: any) => ({
              subject: item.primary_subject || "topic",
              action: item.action || "scene",
              keywords: item.keywords || item.primary_subject || "photo",
              query: item.query || `${item.keywords || "HD photo"} cinematic high resolution professional photography`
            }));
          }
        }
      } catch (err: any) {
        console.warn(`[ScriptNLP] Model ${modelName} error:`, err?.message || err);
      }
    }
  } catch (error: any) {
    console.error("[ScriptNLP Error]:", error?.message || error);
  }

  // Fallback to local NLP if Gemini fails or returns incomplete count
  console.log("[ScriptNLP] Falling back to local NLP script analyzer.");
  return segments.map(seg => extractLocalKeywords(seg.text));
}

// Multi-Source Image Search Engine (Unsplash, Openverse, Wikimedia, DuckDuckGo, Pexels)
export async function fetchContextualImageForQuery(query: string, index: number): Promise<string> {
  const cleanQuery = query.trim() || "cinematic high resolution professional photography";

  // 1. Try Unsplash Search API for real, live high-definition stock photos
  try {
    const unsplashUrl = `https://unsplash.com/napi/search/photos?query=${encodeURIComponent(cleanQuery)}&per_page=6`;
    const res = await fetch(unsplashUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });
    if (res.ok) {
      const data = await res.json();
      if (data.results && Array.isArray(data.results) && data.results.length > 0) {
        const item = data.results[index % data.results.length] || data.results[0];
        if (item.urls && (item.urls.regular || item.urls.full || item.urls.small)) {
          return item.urls.regular || item.urls.full || item.urls.small;
        }
      }
    }
  } catch (err) {
    console.warn("[ContextImageSearch] Unsplash search error:", err);
  }

  // 2. Try DuckDuckGo / Google Web Photo Index Search
  try {
    const tokenRes = await fetch(`https://duckduckgo.com/?q=${encodeURIComponent(cleanQuery)}&t=h_&iax=images&ia=images`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });
    if (tokenRes.ok) {
      const html = await tokenRes.text();
      const match = html.match(/vqd=['"]?([^'"&]+)/i) || html.match(/vqd=([0-9-]+)/i);
      if (match && match[1]) {
        const vqd = match[1];
        const imgRes = await fetch(`https://duckduckgo.com/i.js?l=us-en&o=json&q=${encodeURIComponent(cleanQuery)}&vqd=${vqd}&f=,,,`, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Referer': 'https://duckduckgo.com/'
          }
        });
        if (imgRes.ok) {
          const data = await imgRes.json();
          if (data.results && Array.isArray(data.results) && data.results.length > 0) {
            const item = data.results[index % data.results.length] || data.results[0];
            const url = item.image || item.thumbnail;
            if (url) return url;
          }
        }
      }
    }
  } catch (err) {
    console.warn("[ContextImageSearch] DuckDuckGo search error:", err);
  }

  // 3. Try Openverse CC Image API
  try {
    const openverseUrl = `https://api.openverse.org/v1/images/?q=${encodeURIComponent(cleanQuery)}&page_size=10`;
    const res = await fetch(openverseUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (res.ok) {
      const data = await res.json();
      if (data.results && Array.isArray(data.results) && data.results.length > 0) {
        const item = data.results[index % data.results.length] || data.results[0];
        const url = item.url || item.thumbnail;
        if (url) return url;
      }
    }
  } catch (err) {
    console.warn("[ContextImageSearch] Openverse search error:", err);
  }

  // 4. Try Wikimedia Commons Search
  try {
    const wikiUrl = `https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(cleanQuery + " photo")}&gsrnamespace=6&prop=imageinfo&iiprop=url&format=json&gsrlimit=10`;
    const res = await fetch(wikiUrl, { headers: { 'User-Agent': 'SyncScriptVideoCreator/1.0' } });
    if (res.ok) {
      const data = await res.json();
      if (data.query && data.query.pages) {
        const pages = Object.values(data.query.pages) as any[];
        for (const page of pages) {
          if (page.imageinfo && page.imageinfo[0] && page.imageinfo[0].url) {
            const url = page.imageinfo[0].url;
            if (/\.(jpg|jpeg|png|webp)/i.test(url)) return url;
          }
        }
      }
    }
  } catch (err) {
    console.warn("[ContextImageSearch] Wikimedia search error:", err);
  }

  // Quality Fallback Image
  return "https://images.unsplash.com/photo-1553729459-efe14ef6055d?auto=format&fit=crop&w=1200&q=80";
}

// Full Pipeline: Script -> NLP Keyword & Context Extraction -> Live Image Search -> Time-Scribe Mapping
export async function processScriptToContextualImages(
  segments: ScriptSegmentInput[]
): Promise<ContextualSegmentResult[]> {
  if (!Array.isArray(segments) || segments.length === 0) {
    return [];
  }

  console.log(`[ScriptPipeline] Starting Script-to-Keyword-to-Image pipeline for ${segments.length} segments...`);

  // Step 1: Script Analysis Phase (NLP)
  const nlpResults = await analyzeScriptSegments(segments);

  // Step 2: Concurrent External Image API Integration & Fetching
  const imagePromises = nlpResults.map((nlp, idx) =>
    fetchContextualImageForQuery(nlp.query, idx)
  );

  const imageUrls = await Promise.all(imagePromises);

  // Step 3: Matching & Placement into Time-Scribe Data
  const results: ContextualSegmentResult[] = segments.map((seg, idx) => {
    const nlp = nlpResults[idx] || extractLocalKeywords(seg.text);
    const rawUrl = imageUrls[idx] || "https://images.unsplash.com/photo-1553729459-efe14ef6055d?auto=format&fit=crop&w=1200&q=80";
    
    // Convert to safe proxied URL to prevent CORS taint during rendering/downloads
    const safeUrl = (rawUrl.startsWith("http://") || rawUrl.startsWith("https://")) && !rawUrl.includes("/api/proxy-image")
      ? `/api/proxy-image?url=${encodeURIComponent(rawUrl)}`
      : rawUrl;

    return {
      start: typeof seg.start === "number" ? seg.start : parseFloat(seg.start) || 0,
      end: typeof seg.end === "number" ? seg.end : parseFloat(seg.end) || 0,
      text: seg.text || "",
      subject: nlp.subject,
      action: nlp.action,
      keywords: nlp.keywords,
      query: nlp.query,
      image_url: safeUrl,
      imageUrl: safeUrl,
      imageType: "image"
    };
  });

  console.log(`[ScriptPipeline] Pipeline completed successfully for ${results.length} segments.`);
  return results;
}
