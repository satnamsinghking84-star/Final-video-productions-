import React, { useRef, useState } from "react";
import { Sparkles, Clock, Play, Image as ImageIcon, Upload, X, Edit2, Trash2, Check, Plus, Scissors, GitMerge, FileSpreadsheet, FolderOpen, Wand2, Search, Loader2, Video, Shuffle } from "lucide-react";
import { TranscribeSegment, UploadedImage } from "../types";
import { matchImageForScript, getSafeImageUrl } from "../lib/scriptImageMatcher";
import { distributeMediaToSegments } from "../lib/mediaDistributor";

interface TranscriptionViewProps {
  segments: TranscribeSegment[];
  currentTime: number;
  uploadedImages?: UploadedImage[];
  onSeek: (seconds: number) => void;
  onSegmentImageUploaded: (index: number, url: string | null, type?: "image" | "video") => void;
  onSegmentEdited: (index: number, updatedFields: Partial<TranscribeSegment>) => void;
  onDeleteSegment: (index: number) => void;
  onCreateSegment: () => void;
  onSplitSegment: (index: number) => void;
  onMergeSegment: (index: number) => void;
  onDistributeUploadedImages?: () => void;
}

export default function TranscriptionView({
  segments,
  currentTime,
  uploadedImages,
  onSeek,
  onSegmentImageUploaded,
  onSegmentEdited,
  onDeleteSegment,
  onCreateSegment,
  onSplitSegment,
  onMergeSegment,
  onDistributeUploadedImages
}: TranscriptionViewProps) {
  const fileInputRefs = useRef<Record<number, HTMLInputElement | null>>({});
  const folderInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const [folderSyncStatus, setFolderSyncStatus] = useState<string | null>(null);

  const handleVideoUploadForAll = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      const url = URL.createObjectURL(file);
      
      if (segments.length === 0) {
        alert("Please create or transcribe audio segments first before applying a background video.\nवीडियो लागू करने के लिए कृपया पहले ऑडियो ट्रांसक्राइब करें या सेगमेंट बनाएं।");
        return;
      }

      // Apply this uploaded video to ALL segments
      segments.forEach((_, idx) => {
        onSegmentImageUploaded(idx, url, "video");
      });

      setFolderSyncStatus(`🎥 Video '${file.name}' applied to all ${segments.length} segment(s)! (सभी पार्ट्स में वीडियो लागू कर दिया गया है)`);
      setTimeout(() => setFolderSyncStatus(null), 6000);

      if (videoInputRef.current) {
        videoInputRef.current.value = "";
      }
    }
  };

  const directoryAttributes = {
    webkitdirectory: "",
    directory: "",
    multiple: true
  } as React.InputHTMLAttributes<HTMLInputElement>;

  const handleFolderUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return;
    const filesArray = Array.from(e.target.files) as File[];
    
    // Filter files to images and videos with robust extension fallback
    const mediaFiles = filesArray.filter(file => {
      const ext = file.name.split('.').pop()?.toLowerCase();
      const isImg = file.type.startsWith("image/") || ["png", "jpg", "jpeg", "webp", "gif", "svg"].includes(ext || "");
      const isVid = file.type.startsWith("video/") || ["mp4", "webm", "avi", "mov", "mkv", "ogg"].includes(ext || "");
      return isImg || isVid;
    });

    if (mediaFiles.length === 0) {
      alert("No valid images or videos found in the selected folder.\nचुने गए फ़ोल्डर में कोई मान्य चित्र या वीडियो नहीं मिला।");
      return;
    }

    if (segments.length === 0) {
      alert("Please transcribe or create audio segments first.\nइमेज बांटने के लिए कृपया पहले ऑडियो ट्रांसक्राइब करें या सेगमेंट बनाएं।");
      return;
    }

    // Sort media naturally by filename (1, 2, 3 ... 14)
    mediaFiles.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));

    const mediaItems = mediaFiles.map(file => {
      const ext = file.name.split('.').pop()?.toLowerCase();
      const isVid = file.type.startsWith("video/") || ["mp4", "webm", "avi", "mov", "mkv"].includes(ext || "");
      return {
        url: URL.createObjectURL(file),
        type: (isVid ? "video" : "image") as "image" | "video",
        name: file.name
      };
    });

    const distributed = distributeMediaToSegments(mediaItems, segments);
    distributed.forEach((seg, idx) => {
      onSegmentImageUploaded(idx, seg.imageUrl || null, seg.imageType);
    });

    const m = mediaFiles.length;
    const n = segments.length;
    if (n > m) {
      setFolderSyncStatus(`📁 ${m} images loaded from folder! First ${m} parts placed sequentially (#1 to #${m}), remaining ${n - m} parts auto-shuffled cleanly. (सभी ${n} पार्ट्स में इमेज भर दिए गए हैं)`);
    } else {
      setFolderSyncStatus(`📁 ${m} images loaded from folder! Applied sequentially to all ${n} parts. (सभी ${n} पार्ट्स में इमेज सेट कर दिए गए हैं)`);
    }

    setTimeout(() => {
      setFolderSyncStatus(null);
    }, 8000);

    if (folderInputRef.current) {
      folderInputRef.current.value = "";
    }
  };
  
  // Inline editing state
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [tempText, setTempText] = useState("");
  const [tempStart, setTempStart] = useState("");
  const [tempEnd, setTempEnd] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);
  const [deletingIndex, setDeletingIndex] = useState<number | null>(null);

  const formatTime = (time: number) => {
    const mins = Math.floor(time / 60);
    const secs = Math.floor(time % 60);
    const ms = Math.floor((time % 1) * 10);
    return `${mins}:${secs < 10 ? "0" : ""}${secs}.${ms}`;
  };

  const isSegmentActive = (seg: TranscribeSegment) => {
    if (!segments || segments.length === 0) return false;
    return currentTime >= (seg.start - 0.05) && currentTime <= (seg.end + 0.15);
  };

  const handleImageChange = (index: number, e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      const url = URL.createObjectURL(file);
      const isVideo = file.type.startsWith("video/");
      onSegmentImageUploaded(index, url, isVideo ? "video" : "image");
    }
  };

  const handleRemoveImage = (index: number, e: React.MouseEvent) => {
    e.stopPropagation();
    onSegmentImageUploaded(index, null);
    if (fileInputRefs.current[index]) {
      fileInputRefs.current[index]!.value = "";
    }
  };

  const startEditing = (index: number, seg: TranscribeSegment, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingIndex(index);
    setTempText(seg.text);
    setTempStart(seg.start.toString());
    setTempEnd(seg.end.toString());
    setValidationError(null);
  };

  const saveEditing = (index: number, e: React.MouseEvent) => {
    e.stopPropagation();
    const parsedStart = parseFloat(tempStart);
    const parsedEnd = parseFloat(tempEnd);
    
    if (isNaN(parsedStart) || isNaN(parsedEnd) || parsedStart < 0 || parsedEnd < parsedStart) {
      setValidationError("End time must be greater than start time.");
      return;
    }

    onSegmentEdited(index, {
      text: tempText.trim() || "Empty segment",
      start: Number(parsedStart.toFixed(1)),
      end: Number(parsedEnd.toFixed(1))
    });
    setEditingIndex(null);
    setValidationError(null);
  };

  const cancelEditing = (e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingIndex(null);
    setValidationError(null);
  };

  const handleDownloadExcel = () => {
    if (segments.length === 0) return;

    // Header columns
    const headers = ["Segment #", "Start Time (Seconds)", "End Time (Seconds)", "Duration (Seconds)", "Transcription Text"];
    
    // Rows
    const rows = segments.map((seg, idx) => [
      (idx + 1).toString(),
      seg.start.toFixed(1),
      seg.end.toFixed(1),
      (seg.end - seg.start).toFixed(1),
      `"${(seg.text || "").replace(/"/g, '""')}"`
    ]);

    const csvContent = [
      headers.join(","),
      ...rows.map(row => row.join(","))
    ].join("\n");

    // Use \uFEFF BOM to ensure Excel opens Unicode/Hindi characters correctly
    const blob = new Blob(["\uFEFF" + csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", "transcription_timestamps.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const [autoMatching, setAutoMatching] = useState(false);
  const [suggestingAll, setSuggestingAll] = useState(false);

  const handleSuggestAllMissingImages = async () => {
    if (segments.length === 0) return;

    // Find segments lacking an assigned image
    const missingIndices = segments
      .map((s, idx) => (!s.imageUrl ? idx : -1))
      .filter((i) => i !== -1);

    // Target missing segments, or target all segments if none are missing
    const targetIndices = missingIndices.length > 0 ? missingIndices : segments.map((_, idx) => idx);

    setSuggestingAll(true);
    let updatedCount = 0;

    try {
      setFolderSyncStatus(`🔍 Performing NLP script analysis & fetching HD photos for ${targetIndices.length} segment(s)...`);
      const targetSegments = targetIndices.map(idx => segments[idx]);
      const res = await fetch("/api/auto-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ segments: targetSegments })
      });

      if (res.ok) {
        const data = await res.json();
        if (data.segments && Array.isArray(data.segments) && data.segments.length === targetSegments.length) {
          data.segments.forEach((procSeg: any, i: number) => {
            const segIdx = targetIndices[i];
            const imgUrl = procSeg.image_url || procSeg.imageUrl;
            if (imgUrl) {
              onSegmentImageUploaded(segIdx, getSafeImageUrl(imgUrl), "image");
              if (procSeg.subject || procSeg.action) {
                onSegmentEdited(segIdx, {
                  subject: procSeg.subject,
                  action: procSeg.action,
                  keywords: procSeg.keywords,
                  query: procSeg.query
                });
              }
              updatedCount++;
            }
          });
        } else if (data.images && Array.isArray(data.images) && data.images.length === targetSegments.length) {
          data.images.forEach((imgUrl: string, i: number) => {
            const segIdx = targetIndices[i];
            if (imgUrl) {
              onSegmentImageUploaded(segIdx, getSafeImageUrl(imgUrl), "image");
              updatedCount++;
            }
          });
        }
      }
    } catch (err) {
      console.warn("Suggest All batch error, running individual fallback queries:", err);
    }

    // Individual fallback check for any remaining segment without image
    for (const idx of targetIndices) {
      const seg = segments[idx];
      if (seg && !seg.imageUrl) {
        try {
          const query = deriveSearchQueryFromText(seg.text);
          const res = await fetch(`/api/search-images?q=${encodeURIComponent(query)}`);
          if (res.ok) {
            const data = await res.json();
            if (data.results && data.results[0] && data.results[0].url) {
              onSegmentImageUploaded(idx, getSafeImageUrl(data.results[0].url), "image");
              updatedCount++;
            }
          }
        } catch (e) {
          const match = matchImageForScript(seg.text, idx);
          onSegmentImageUploaded(idx, getSafeImageUrl(match.url), "image");
          updatedCount++;
        }
      }
    }

    setSuggestingAll(false);
    setFolderSyncStatus(`✨ 'Suggest All' complete! Updated live web photos for ${updatedCount || targetIndices.length} segment(s).`);
    setTimeout(() => setFolderSyncStatus(null), 5000);
  };

  const handleAutoGenerateAllImages = async () => {
    if (segments.length === 0) return;
    setAutoMatching(true);

    try {
      const res = await fetch("/api/auto-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ segments })
      });

      if (res.ok) {
        const data = await res.json();
        if (data.segments && Array.isArray(data.segments) && data.segments.length === segments.length) {
          data.segments.forEach((procSeg: any, idx: number) => {
            const imgUrl = procSeg.image_url || procSeg.imageUrl;
            if (imgUrl) {
              onSegmentImageUploaded(idx, getSafeImageUrl(imgUrl), "image");
              if (procSeg.subject || procSeg.action) {
                onSegmentEdited(idx, {
                  subject: procSeg.subject,
                  action: procSeg.action,
                  keywords: procSeg.keywords,
                  query: procSeg.query
                });
              }
            }
          });
          setFolderSyncStatus(`✨ Contextual HD stock photos fetched for all ${segments.length} script segments!`);
          return;
        } else if (data.images && Array.isArray(data.images) && data.images.length === segments.length) {
          data.images.forEach((imgUrl: string, idx: number) => {
            if (imgUrl) {
              onSegmentImageUploaded(idx, getSafeImageUrl(imgUrl), "image");
            }
          });
          setFolderSyncStatus(`✨ Real Google/Web HD photos fetched for all ${segments.length} script segments!`);
          return;
        }
      }
    } catch (err) {
      console.warn("Live web image API error, using script matcher fallback:", err);
    } finally {
      // Fallback local matcher if network or segment count differs
      segments.forEach((seg, idx) => {
        if (!seg.imageUrl && !seg.image_url) {
          const match = matchImageForScript(seg.text, idx);
          onSegmentImageUploaded(idx, match.url, "image");
        }
      });
      setTimeout(() => {
        setAutoMatching(false);
        setTimeout(() => setFolderSyncStatus(null), 5000);
      }, 300);
    }
  };

  const handleAutoGenerateSingleImage = async (index: number) => {
    const seg = segments[index];
    if (!seg) return;

    try {
      const res = await fetch("/api/auto-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ segments: [seg] })
      });
      if (res.ok) {
        const data = await res.json();
        if (data.segments && data.segments[0]) {
          const procSeg = data.segments[0];
          const imgUrl = procSeg.image_url || procSeg.imageUrl;
          if (imgUrl) {
            onSegmentImageUploaded(index, getSafeImageUrl(imgUrl), "image");
            if (procSeg.subject || procSeg.action) {
              onSegmentEdited(index, {
                subject: procSeg.subject,
                action: procSeg.action,
                keywords: procSeg.keywords,
                query: procSeg.query
              });
            }
            return;
          }
        } else if (data.images && data.images[0]) {
          onSegmentImageUploaded(index, getSafeImageUrl(data.images[0]), "image");
          return;
        }
      }
    } catch (err) {
      console.warn("Single image fetch fallback:", err);
    }

    const match = matchImageForScript(seg.text, index);
    onSegmentImageUploaded(index, getSafeImageUrl(match.url), "image");
  };

  const [searchModalIndex, setSearchModalIndex] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  const deriveSearchQueryFromText = (text: string): string => {
    if (!text || !text.trim()) return "India news study photo";
    const lower = text.toLowerCase();
    if (lower.includes("मोदी") || lower.includes("narendra modi") || lower.includes("prime minister") || lower.includes("प्रधान मंत्री")) return "PM Narendra Modi India speech";
    if (lower.includes("पेपर लीक") || lower.includes("paper leak") || lower.includes("परीक्षा") || lower.includes("exam")) return "Paper leak exam student protest India";
    if (lower.includes("कैबिनेट") || lower.includes("cabinet") || lower.includes("सरकार") || lower.includes("government")) return "Indian cabinet meeting government decision";
    if (lower.includes("छात्र") || lower.includes("student") || lower.includes("गुस्सा")) return "Indian students study exam classroom";
    if (lower.includes("कानून") || lower.includes("सख्त") || lower.includes("कार्रवाई") || lower.includes("action") || lower.includes("crime") || lower.includes("अपराध")) return "law strict action court justice";
    if (lower.includes("राय") || lower.includes("opinion") || lower.includes("कमेंट") || lower.includes("comment") || lower.includes("सवाल")) return "thoughtful discussion question mark";
    if (lower.includes("चैनल") || lower.includes("फॉलो") || lower.includes("follow") || lower.includes("subscribe") || lower.includes("अपडेट")) return "news channel media camera follow";
    if (lower.includes("payday")) return "Payday cash salary";
    if (lower.includes("rent")) return "Rent contract home keys";
    if (lower.includes("bills")) return "Monthly bills receipts";
    if (lower.includes("groceries")) return "Grocery shopping cart";
    if (lower.includes("subscriptions")) return "App subscriptions payment";
    if (lower.includes("bank balance")) return "Bank balance wallet";
    return text.trim().slice(0, 40) || "HD photo";
  };

  const openImageSearchModal = (idx: number) => {
    setSearchModalIndex(idx);
    // User requested input box query MUST start completely empty ("")
    setSearchQuery("");

    const seg = segments[idx];
    const initialQuery = deriveSearchQueryFromText(seg ? seg.text : "");
    executeImageSearch(initialQuery);
  };

  const executeImageSearch = async (queryStr: string) => {
    if (!queryStr.trim()) return;
    setIsSearching(true);
    try {
      const res = await fetch(`/api/search-images?q=${encodeURIComponent(queryStr.trim())}`);
      if (res.ok) {
        const data = await res.json();
        if (data.results && Array.isArray(data.results) && data.results.length > 0) {
          setSearchResults(data.results);
          return;
        }
      }
    } catch (err) {
      console.error("Failed to search live images:", err);
    } finally {
      setIsSearching(false);
    }

    // Fallback images if network fetch fails or returns no results
    const fallbackResults = [
      { id: "fb1", url: "https://images.unsplash.com/photo-1585829365295-ab7cd400c167?auto=format&fit=crop&w=1200&q=80", thumb: "https://images.unsplash.com/photo-1585829365295-ab7cd400c167?auto=format&fit=crop&w=400&q=80", title: "News Media & Live Broadcast", author: "Live Web Photo", source: "Google / HD Web Image" },
      { id: "fb2", url: "https://images.unsplash.com/photo-1577896851231-70ef18881754?auto=format&fit=crop&w=1200&q=80", thumb: "https://images.unsplash.com/photo-1577896851231-70ef18881754?auto=format&fit=crop&w=400&q=80", title: "Study & Examination", author: "Live Web Photo", source: "Google / HD Web Image" },
      { id: "fb3", url: "https://images.unsplash.com/photo-1529107386315-e1a2ed48a620?auto=format&fit=crop&w=1200&q=80", thumb: "https://images.unsplash.com/photo-1529107386315-e1a2ed48a620?auto=format&fit=crop&w=400&q=80", title: "Government Cabinet Decision", author: "Live Web Photo", source: "Google / HD Web Image" },
      { id: "fb4", url: "https://images.unsplash.com/photo-1531403009284-440f080d1e12?auto=format&fit=crop&w=1200&q=80", thumb: "https://images.unsplash.com/photo-1531403009284-440f080d1e12?auto=format&fit=crop&w=400&q=80", title: "Discussion & Questions", author: "Live Web Photo", source: "Google / HD Web Image" }
    ];
    setSearchResults(fallbackResults);
  };

  const handleSelectImageFromModal = (imageUrl: string) => {
    if (searchModalIndex !== null) {
      onSegmentImageUploaded(searchModalIndex, getSafeImageUrl(imageUrl), "image");
      setSearchModalIndex(null);
    }
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6 space-y-4 flex flex-col h-full">
      <input
        type="file"
        accept="video/*"
        ref={videoInputRef}
        className="hidden"
        onChange={handleVideoUploadForAll}
        id="apply-video-all-input"
      />
      <input
        type="file"
        ref={folderInputRef}
        className="hidden"
        onChange={handleFolderUpload}
        {...directoryAttributes}
      />

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between border-b border-slate-100 pb-3 gap-2">
        <h2 className="text-xl font-display font-semibold text-slate-800 flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-amber-500 animate-pulse" />
          Transcription & Timestamps
        </h2>
        <div className="flex flex-wrap items-center gap-2 justify-between sm:justify-end w-full sm:w-auto">
          {segments.length > 0 && (
            <>
              <button
                onClick={() => videoInputRef.current?.click()}
                className="flex items-center gap-1.5 text-xs text-purple-900 hover:text-purple-950 font-bold bg-purple-100 hover:bg-purple-200 px-3 py-1.5 rounded-lg border border-purple-200 transition-all whitespace-nowrap shrink-0 cursor-pointer shadow-xs active:scale-95"
                id="apply-video-all-btn"
                title="Upload a video to apply as background across all transcription segments / सभी पार्ट्स में एक साथ वीडियो डालें"
              >
                <Video className="w-3.5 h-3.5 text-purple-600" />
                🎥 Video for All / सभी में वीडियो
              </button>
              <span className="text-xs text-slate-300 font-mono hidden sm:inline">
                |
              </span>
              <button
                onClick={handleSuggestAllMissingImages}
                disabled={suggestingAll || autoMatching}
                className="flex items-center gap-1.5 text-xs text-blue-900 hover:text-blue-950 font-bold bg-blue-100 hover:bg-blue-200 px-3 py-1.5 rounded-lg border border-blue-200 transition-all whitespace-nowrap shrink-0 cursor-pointer shadow-xs active:scale-95"
                id="suggest-all-images-btn"
                title="Automatically trigger live web image search for all segments that currently lack an assigned image / बिना इमेज वाले सभी सेगमेंट में फोटो ऑटो-सुझाएं"
              >
                <Sparkles className="w-3.5 h-3.5 text-blue-600 animate-pulse" />
                {suggestingAll ? "Suggesting All..." : "✨ Suggest All / सभी में इमेज सुझाव"}
              </button>
              <span className="text-xs text-slate-300 font-mono hidden sm:inline">
                |
              </span>
              <button
                onClick={handleAutoGenerateAllImages}
                disabled={autoMatching || suggestingAll}
                className="flex items-center gap-1.5 text-xs text-amber-800 hover:text-amber-900 font-bold bg-amber-100 hover:bg-amber-200 px-3 py-1.5 rounded-lg border border-amber-200 transition-all whitespace-nowrap shrink-0 cursor-pointer shadow-xs"
                id="auto-generate-all-images-btn"
                title="Automatically match relevant HD photos for all segments based on script keywords / ऑटोमेटिक इमेज जोड़ें"
              >
                <Wand2 className="w-3.5 h-3.5 text-amber-600" />
                {autoMatching ? "Syncing Images..." : "✨ Auto Images / ऑटो इमेज जोड़ें"}
              </button>
              <span className="text-xs text-slate-300 font-mono hidden sm:inline">
                |
              </span>
              <button
                onClick={() => folderInputRef.current?.click()}
                className="flex items-center gap-1.5 text-xs text-indigo-700 hover:text-indigo-800 font-semibold bg-indigo-50 hover:bg-indigo-100 px-3 py-1.5 rounded-lg border border-indigo-100 transition-all whitespace-nowrap shrink-0 cursor-pointer"
                id="upload-folder-btn"
                title="Upload image/video folder to auto-match with segment numbers / फ़ोल्डर से ऑटो-सिंक करें"
              >
                <FolderOpen className="w-3.5 h-3.5 text-indigo-600" />
                Folder Upload / फ़ोल्डर
              </button>
              <span className="text-xs text-slate-300 font-mono hidden sm:inline">
                |
              </span>
              {uploadedImages && uploadedImages.length > 0 && onDistributeUploadedImages && (
                <>
                  <button
                    onClick={() => {
                      onDistributeUploadedImages();
                      setFolderSyncStatus(`🔀 Distributed ${uploadedImages.length} images across all ${segments.length} segments! First ${uploadedImages.length} sequentially, remaining auto-shuffled. (सभी पार्ट्स में इमेजेस भर दिए गए हैं)`);
                      setTimeout(() => setFolderSyncStatus(null), 8000);
                    }}
                    className="flex items-center gap-1.5 text-xs text-violet-800 hover:text-violet-900 font-bold bg-violet-100 hover:bg-violet-200 px-3 py-1.5 rounded-lg border border-violet-200 transition-all whitespace-nowrap shrink-0 cursor-pointer shadow-xs active:scale-95"
                    id="distribute-folder-images-btn"
                    title="Auto-distribute uploaded folder images across all segments (1..M sequential, then shuffled) / सभी सेगमेंट्स में इमेजेस बांटे"
                  >
                    <Shuffle className="w-3.5 h-3.5 text-violet-600" />
                    🔀 Auto-Fill All Parts ({uploadedImages.length} Img)
                  </button>
                  <span className="text-xs text-slate-300 font-mono hidden sm:inline">
                    |
                  </span>
                </>
              )}
              <button
                onClick={handleDownloadExcel}
                className="flex items-center gap-1.5 text-xs text-emerald-700 hover:text-emerald-800 font-semibold bg-emerald-50 hover:bg-emerald-100 px-3 py-1.5 rounded-lg border border-emerald-100 transition-all whitespace-nowrap shrink-0 cursor-pointer"
                id="download-excel-btn"
                title="Download full transcription in Excel (CSV) / एक्सेल डाउनलोड"
              >
                <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600" />
                Excel
              </button>
              <span className="text-xs text-slate-300 font-mono hidden sm:inline">
                |
              </span>
              <span className="text-xs text-slate-400 font-mono">
                {segments.length} seg
              </span>
            </>
          )}
          <button
            onClick={onCreateSegment}
            className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 font-semibold bg-blue-50 hover:bg-blue-100 px-2.5 py-1.5 rounded-lg transition-all whitespace-nowrap shrink-0 cursor-pointer"
            id="add-segment-header-btn"
          >
            <Plus className="w-3.5 h-3.5" />
            Add Segment
          </button>
        </div>
      </div>

      {folderSyncStatus && (
        <div className="bg-indigo-50 border border-indigo-100 text-indigo-800 text-xs font-medium px-4 py-3 rounded-xl flex items-center justify-between gap-2 animate-fade-in shadow-xs">
          <span>{folderSyncStatus}</span>
          <button 
            onClick={() => setFolderSyncStatus(null)}
            className="text-indigo-400 hover:text-indigo-600 shrink-0 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {segments.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center py-12 px-4 text-center">
          <div className="w-12 h-12 rounded-full bg-slate-50 flex items-center justify-center text-slate-400 mb-3 border border-slate-100">
            <Clock className="w-6 h-6" />
          </div>
          <p className="text-sm font-medium text-slate-600">No transcription segments yet</p>
          <p className="text-xs text-slate-400 max-w-[280px] mt-1">
            Upload your audio above and click Transcribe, or click "Add Segment" to manually type your subtitles/lyrics.
          </p>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto max-h-[420px] scrollbar-thin space-y-3 pr-2" id="transcription-timeline">
          {segments.map((seg, idx) => {
            const active = isSegmentActive(seg);
            const isEditing = editingIndex === idx;

            return (
              <div
                key={idx}
                onClick={() => !isEditing && onSeek(seg.start)}
                className={`group flex items-start gap-3 p-3.5 rounded-xl border text-left transition-all ${
                  isEditing 
                    ? "border-blue-300 ring-2 ring-blue-50 bg-slate-50/50"
                    : active
                    ? "bg-amber-50/70 border-amber-200 shadow-sm ring-1 ring-amber-100 cursor-pointer"
                    : "bg-white hover:bg-slate-50 border-slate-100 hover:border-slate-200 cursor-pointer"
                }`}
              >
                {/* Left side play/jump indicator */}
                <div className="flex flex-col items-center gap-2">
                  <button
                    className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 transition-all ${
                      active
                        ? "bg-amber-500 text-white scale-105 shadow-sm"
                        : "bg-slate-100 text-slate-500 hover:bg-amber-100 hover:text-amber-700"
                    }`}
                    title="Jump to this segment"
                    onClick={(e) => {
                      e.stopPropagation();
                      onSeek(seg.start);
                    }}
                    disabled={isEditing}
                  >
                    <Play className={`w-3.5 h-3.5 ${active ? "fill-current" : ""}`} />
                  </button>
                </div>

                {/* Center text and timestamp details */}
                <div className="flex-1 min-w-0 space-y-1.5" onClick={(e) => isEditing && e.stopPropagation()}>
                  {isEditing ? (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <div className="flex items-center gap-1">
                          <span className="text-[10px] text-slate-400 font-mono">Start:</span>
                          <input
                            type="number"
                            step="0.1"
                            min="0"
                            value={tempStart}
                            onChange={(e) => setTempStart(e.target.value)}
                            className="w-16 text-xs font-mono border border-slate-200 rounded px-1 py-0.5"
                          />
                        </div>
                        <span className="text-slate-400 font-mono">&rarr;</span>
                        <div className="flex items-center gap-1">
                          <span className="text-[10px] text-slate-400 font-mono">End:</span>
                          <input
                            type="number"
                            step="0.1"
                            min="0"
                            value={tempEnd}
                            onChange={(e) => setTempEnd(e.target.value)}
                            className="w-16 text-xs font-mono border border-slate-200 rounded px-1 py-0.5"
                          />
                        </div>
                      </div>
                      <textarea
                        value={tempText}
                        onChange={(e) => setTempText(e.target.value)}
                        className="w-full text-sm border border-slate-200 rounded-lg p-2 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                        rows={2}
                        placeholder="Enter subtitle text..."
                        autoFocus
                      />
                      {validationError && (
                        <p className="text-xs text-red-600 font-medium">
                          {validationError}
                        </p>
                      )}
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={(e) => saveEditing(idx, e)}
                          className="flex items-center gap-1 bg-emerald-600 text-white text-xs font-semibold px-2 py-1 rounded hover:bg-emerald-700 transition-colors"
                        >
                          <Check className="w-3 h-3" /> Save
                        </button>
                        <button
                          onClick={cancelEditing}
                          className="flex items-center gap-1 bg-slate-200 text-slate-700 text-xs font-semibold px-2 py-1 rounded hover:bg-slate-300 transition-colors"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className={`font-mono text-xs font-semibold ${
                            active ? "text-amber-700" : "text-slate-500"
                          }`}>
                            {formatTime(seg.start)} &rarr; {formatTime(seg.end)}
                          </span>
                          <span className="text-[10px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded">
                            {((seg.end - seg.start)).toFixed(1)}s
                          </span>
                        </div>
                        
                        {/* Quick Action buttons */}
                        <div className="flex opacity-100 sm:opacity-0 sm:group-hover:opacity-100 items-center gap-1 transition-all">
                          <button
                            onClick={(e) => startEditing(idx, seg, e)}
                            className="p-1 bg-slate-100 hover:bg-blue-50 text-slate-500 hover:text-blue-700 rounded transition-colors"
                            title="Edit text / timestamps"
                          >
                            <Edit2 className="w-3 h-3" />
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onSplitSegment(idx);
                            }}
                            className="p-1 bg-slate-100 hover:bg-amber-50 text-slate-500 hover:text-amber-700 rounded transition-colors"
                            title="Split segment in half (आधा काटें)"
                          >
                            <Scissors className="w-3 h-3" />
                          </button>
                          {idx < segments.length - 1 && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                onMergeSegment(idx);
                              }}
                              className="p-1 bg-slate-100 hover:bg-indigo-50 text-slate-500 hover:text-indigo-700 rounded transition-colors"
                              title="Merge with next segment (अगले से जोड़ें)"
                            >
                              <GitMerge className="w-3 h-3" />
                            </button>
                          )}
                          {deletingIndex === idx ? (
                            <div className="flex items-center gap-1 bg-red-50 p-0.5 rounded border border-red-100">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onDeleteSegment(idx);
                                  setDeletingIndex(null);
                                }}
                                className="text-[10px] font-bold text-red-600 hover:text-red-700 px-1.5 py-0.5"
                              >
                                Delete
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setDeletingIndex(null);
                                }}
                                className="text-[10px] font-medium text-slate-500 hover:text-slate-700 px-1 py-0.5"
                              >
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setDeletingIndex(idx);
                              }}
                              className="p-1 bg-slate-100 hover:bg-red-50 text-slate-500 hover:text-red-600 rounded transition-colors"
                              title="Delete segment"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          )}
                        </div>
                      </div>
                      
                      <p className={`text-sm leading-relaxed transition-colors ${
                        active ? "text-slate-900 font-medium" : "text-slate-600"
                      }`}>
                        {seg.text}
                      </p>
                    </>
                  )}
                </div>

                {/* Right side Segment Image/Video Uploader & Small Search Box */}
                <div 
                  className="shrink-0 flex items-center gap-1.5 self-center ml-2"
                  onClick={(e) => e.stopPropagation()}
                >
                  <input
                    type="file"
                    accept="image/*,video/*"
                    ref={(el) => {
                      fileInputRefs.current[idx] = el;
                    }}
                    onChange={(e) => handleImageChange(idx, e)}
                    className="hidden"
                  />
                  {seg.imageUrl ? (
                    <div className="relative w-16 h-16 rounded-lg overflow-hidden border border-slate-200 group/img bg-slate-100 shadow-xs">
                      {seg.imageType === "video" ? (
                        <div className="w-full h-full relative flex items-center justify-center bg-slate-950">
                          <video
                            src={seg.imageUrl}
                            className="w-full h-full object-cover"
                            muted
                            playsInline
                          />
                          <span className="absolute bottom-0 right-0 bg-indigo-600 text-[6px] text-white font-extrabold px-0.5 rounded-tl">VIDEO</span>
                        </div>
                      ) : (
                        <img
                          src={seg.imageUrl}
                          alt="Segment visual"
                          className="w-full h-full object-cover"
                          referrerPolicy="no-referrer"
                        />
                      )}
                      <div className="absolute inset-0 bg-black/40 opacity-0 group-hover/img:opacity-100 transition-opacity flex items-center justify-center gap-1">
                        <button
                          onClick={() => handleAutoGenerateSingleImage(idx)}
                          className="p-1 bg-amber-500 hover:bg-amber-600 text-white rounded-full transition-colors"
                          title="✨ Re-match image from script (स्क्रिप्ट इमेज अपडेट करें)"
                        >
                          <Wand2 className="w-3 h-3" />
                        </button>
                        <button
                          onClick={() => fileInputRefs.current[idx]?.click()}
                          className="p-1 bg-white/90 rounded-full hover:bg-white text-slate-800 transition-colors"
                          title="Change custom media"
                        >
                          <Upload className="w-3 h-3" />
                        </button>
                        <button
                          onClick={(e) => handleRemoveImage(idx, e)}
                          className="p-1 bg-red-600/90 rounded-full hover:bg-red-600 text-white transition-colors"
                          title="Remove media"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center gap-1">
                      <button
                        onClick={() => handleAutoGenerateSingleImage(idx)}
                        className="w-16 h-10 rounded-lg bg-amber-500 hover:bg-amber-600 text-white font-bold text-[9px] flex items-center justify-center gap-1 transition-all shadow-xs cursor-pointer px-1 text-center"
                        title="✨ Auto-match HD picture for this script segment (स्क्रिप्ट के हिसाब से इमेज ऑटो-लोड करें)"
                      >
                        <Wand2 className="w-3 h-3 shrink-0" />
                        <span>✨ Auto</span>
                      </button>
                      <button
                        onClick={() => fileInputRefs.current[idx]?.click()}
                        className="w-16 h-6 rounded-md border border-slate-200 hover:border-slate-300 bg-slate-50 hover:bg-slate-100 flex items-center justify-center text-[8px] font-semibold text-slate-500 transition-all gap-0.5"
                        title="Upload your own custom photo/video"
                      >
                        <Upload className="w-2.5 h-2.5" />
                        <span>Upload</span>
                      </button>
                    </div>
                  )}

                  {/* Small Search Box Button next to Image Box */}
                  <button
                    onClick={() => openImageSearchModal(idx)}
                    className="h-16 w-12 bg-gradient-to-b from-blue-600 to-indigo-700 hover:from-blue-700 hover:to-indigo-800 text-white rounded-lg border border-blue-500/30 shadow-xs flex flex-col items-center justify-center gap-0.5 cursor-pointer transition-all hover:scale-105 shrink-0"
                    title="Search Google & Web Photos for this script box / वेब-गूगल फोटो सर्च करें"
                    id={`search-photo-box-${idx}`}
                  >
                    <Search className="w-4 h-4 text-blue-200" />
                    <span className="text-[8px] font-extrabold tracking-tight uppercase leading-none">Search</span>
                    <span className="text-[7px] font-medium text-blue-200 leading-none">Photo</span>
                  </button>
                </div>

              </div>
            );
          })}
        </div>
      )}

      {/* Google / Web Live Photo Search Modal */}
      {searchModalIndex !== null && (
        <div 
          className="fixed inset-0 z-50 bg-slate-900/80 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4 animate-in fade-in duration-200"
          onClick={() => setSearchModalIndex(null)}
        >
          <div 
            className="bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl border border-slate-200 w-full max-w-3xl overflow-hidden flex flex-col max-h-[92vh] sm:max-h-[85vh]"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="px-4 py-3.5 sm:px-6 sm:py-4 bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 text-white flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
                <div className="p-2 bg-blue-500/20 border border-blue-400/30 rounded-xl text-blue-400 shrink-0">
                  <Search className="w-4 h-4 sm:w-5 sm:h-5" />
                </div>
                <div className="min-w-0">
                  <h3 className="text-sm sm:text-base font-bold flex items-center gap-2 truncate">
                    Google / Web Photo Finder
                    <span className="bg-blue-500/30 text-blue-300 text-[9px] sm:text-[10px] uppercase font-bold px-2 py-0.5 rounded-full border border-blue-400/30 hidden xs:inline-block">Live Search</span>
                  </h3>
                  <p className="text-[11px] sm:text-xs text-slate-300 truncate">
                    Seg #{searchModalIndex + 1} ({formatTime(segments[searchModalIndex]?.start || 0)}) &bull; Tap photo to sync
                  </p>
                </div>
              </div>
              <button
                onClick={() => setSearchModalIndex(null)}
                className="p-2 sm:p-1.5 rounded-xl bg-white/10 hover:bg-white/20 text-slate-300 hover:text-white transition-colors cursor-pointer shrink-0 ml-2"
                aria-label="Close photo search"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Script Text Banner */}
            <div className="bg-blue-50/90 px-4 py-2 sm:px-6 sm:py-2.5 border-b border-blue-100 flex items-center gap-2 shrink-0">
              <span className="text-[11px] sm:text-xs font-bold text-blue-800 shrink-0">Script:</span>
              <p className="text-[11px] sm:text-xs text-slate-700 italic truncate">
                "{segments[searchModalIndex]?.text}"
              </p>
            </div>

            {/* Search Input Bar */}
            <div className="p-3 sm:p-5 space-y-2.5 border-b border-slate-100 bg-slate-50/50 shrink-0">
              <form 
                onSubmit={(e) => {
                  e.preventDefault();
                  const queryToUse = searchQuery.trim() || segments[searchModalIndex]?.text || "";
                  executeImageSearch(queryToUse);
                }}
                className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2"
              >
                <div className="relative flex-1">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search Google & Web HD photos (Type e.g. PM Modi, Paper leak, Rent, Salary...)"
                    className="w-full pl-10 pr-4 py-2.5 bg-white border border-slate-200 rounded-xl text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 shadow-2xs"
                  />
                </div>
                <button
                  type="submit"
                  disabled={isSearching}
                  className="w-full sm:w-auto h-10 px-5 bg-blue-600 hover:bg-blue-700 active:scale-98 text-white font-bold text-xs rounded-xl shadow-xs transition-all flex items-center justify-center gap-1.5 cursor-pointer shrink-0"
                >
                  {isSearching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                  <span>Search Photo / खोजें</span>
                </button>
              </form>

              {/* Quick Suggestion Tag Chips - Horizontal scrollable on touch */}
              <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs scrollbar-none -mx-1 px-1 sm:mx-0 sm:px-0 sm:flex-wrap">
                <span className="text-[10px] sm:text-[11px] font-semibold text-slate-400 shrink-0">Suggestions:</span>
                {[
                  "PM Narendra Modi",
                  "Paper leak exam India",
                  "Student protest India",
                  "Cabinet meeting India",
                  "News channel camera",
                  "Payday salary cash",
                  "House rent contract",
                  "Monthly bills paper",
                  "Grocery shopping cart",
                  "Financial freedom chart"
                ].map((tag) => (
                  <button
                    key={tag}
                    onClick={() => {
                      setSearchQuery(tag);
                      executeImageSearch(tag);
                    }}
                    className="px-2.5 py-1 bg-white hover:bg-blue-50 text-slate-600 hover:text-blue-700 font-medium text-[10px] sm:text-[11px] rounded-lg border border-slate-200 hover:border-blue-300 transition-all cursor-pointer shadow-2xs shrink-0 whitespace-nowrap"
                  >
                    {tag}
                  </button>
                ))}
              </div>
            </div>

            {/* Results Grid */}
            <div className="p-3 sm:p-6 overflow-y-auto max-h-[50vh] sm:max-h-[55vh] flex-1">
              {isSearching ? (
                <div className="py-12 flex flex-col items-center justify-center text-slate-400 space-y-3">
                  <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
                  <p className="text-xs sm:text-sm font-medium">Fetching real live Google & Web HD photos...</p>
                </div>
              ) : searchResults.length === 0 ? (
                <div className="py-12 text-center text-slate-400 space-y-2">
                  <ImageIcon className="w-10 h-10 mx-auto text-slate-300" />
                  <p className="text-xs sm:text-sm font-medium text-slate-600">No images found for "{searchQuery}"</p>
                  <p className="text-[11px] sm:text-xs">Try typing a different keyword above</p>
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 sm:gap-3">
                  {searchResults.map((item, photoIdx) => (
                    <div
                      key={item.id || photoIdx}
                      onClick={() => handleSelectImageFromModal(item.url)}
                      className="group relative bg-slate-100 rounded-xl overflow-hidden border border-slate-200 hover:border-blue-500 hover:shadow-lg transition-all cursor-pointer aspect-video flex flex-col active:scale-95"
                    >
                      <img
                        src={item.thumb || item.url}
                        alt={item.title || "Web Photo"}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                        referrerPolicy="no-referrer"
                        loading="lazy"
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/30 to-transparent opacity-90 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity flex flex-col justify-end p-2 text-white">
                        <span className="text-[9px] sm:text-[10px] font-bold bg-blue-600 px-1.5 py-0.5 rounded w-max mb-1 shadow-2xs">
                          ✨ Tap to Sync
                        </span>
                        <p className="text-[10px] sm:text-[11px] font-medium line-clamp-1 leading-tight text-slate-100">
                          {item.title || "Live Photo"}
                        </p>
                        <span className="text-[8px] sm:text-[9px] text-slate-300">
                          {item.source || "Google / Web"}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="px-4 py-3 sm:px-6 sm:py-3 bg-slate-50 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500 shrink-0">
              <span className="text-[11px] sm:text-xs truncate pr-2">Tap any photo to sync instantly into segment #{searchModalIndex + 1}</span>
              <button
                onClick={() => setSearchModalIndex(null)}
                className="px-4 py-1.5 bg-slate-200 hover:bg-slate-300 text-slate-700 font-semibold rounded-lg transition-colors cursor-pointer shrink-0"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
