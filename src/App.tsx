import React, { useState, useRef, useEffect } from "react";
import { Sparkles, Layers, Info, Film, Settings, AlertCircle, Trash2 } from "lucide-react";
import AudioUploader from "./components/AudioUploader";
import ImageUploader from "./components/ImageUploader";
import TranscriptionView from "./components/TranscriptionView";
import VideoPlayer from "./components/VideoPlayer";
import { TranscribeSegment, UploadedImage } from "./types";
import { matchImageForScript, getSafeImageUrl } from "./lib/scriptImageMatcher";
import { distributeMediaToSegments } from "./lib/mediaDistributor";
import { normalizeSegments } from "./lib/segmentNormalizer";

// Helper functions for IndexedDB to persist audio files safely across refreshes
const DB_NAME = "AudioVideoSyncerDB";
const STORE_NAME = "AudioFiles";

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function saveAudioFileToDB(file: File): Promise<void> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const request = store.put(file, "current_audio");
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  } catch (err) {
    console.error("IndexedDB save failed", err);
  }
}

async function getAudioFileFromDB(): Promise<File | null> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const request = store.get("current_audio");
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  } catch (err) {
    console.error("IndexedDB fetch failed", err);
    return null;
  }
}

async function clearAudioFileFromDB(): Promise<void> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const request = store.delete("current_audio");
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  } catch (err) {
    console.error("IndexedDB clear failed", err);
  }
}

export default function App() {
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [globalVideoUrl, setGlobalVideoUrl] = useState<string | null>(null);
  const [audioName, setAudioName] = useState<string | null>(() => {
    if (localStorage.getItem("syncer_clear_on_refresh") === "true") {
      return null;
    }
    return localStorage.getItem("syncer_audio_name") || null;
  });
  const [audioDuration, setAudioDuration] = useState<number | null>(() => {
    if (localStorage.getItem("syncer_clear_on_refresh") === "true") {
      return null;
    }
    const saved = localStorage.getItem("syncer_audio_duration");
    return saved ? parseFloat(saved) : null;
  });
  const [images, setImages] = useState<UploadedImage[]>([]);
  const [segments, setSegments] = useState<TranscribeSegment[]>(() => {
    if (localStorage.getItem("syncer_clear_on_refresh") === "true") {
      return [];
    }
    try {
      const saved = localStorage.getItem("syncer_segments");
      if (saved) {
        const parsed = JSON.parse(saved);
        // Clean up any temporary blob URLs that won't work on fresh load
        return parsed.map((seg: any) => {
          if (seg.imageUrl && seg.imageUrl.startsWith("blob:")) {
            return { ...seg, imageUrl: undefined, imageType: undefined };
          }
          return seg;
        });
      }
    } catch (e) {
      console.error("Error loading saved segments", e);
    }
    return [];
  });
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [showResetConfirm, setShowResetConfirm] = useState(false);

  const playbackRef = useRef<HTMLAudioElement | null>(null);

  // Load audio file from IndexedDB on startup
  useEffect(() => {
    if (localStorage.getItem("syncer_clear_on_refresh") === "true") {
      clearAudioFileFromDB();
      localStorage.removeItem("syncer_clear_on_refresh");
      setAudioFile(null);
      setAudioUrl(null);
      setAudioName(null);
      setAudioDuration(null);
      setSegments([]);
      return;
    }

    async function loadSavedAudio() {
      const savedFile = await getAudioFileFromDB();
      if (savedFile) {
        const url = URL.createObjectURL(savedFile);
        setAudioFile(savedFile);
        setAudioUrl(url);
        if (savedFile.type.startsWith("video/") || /\.(mp4|webm|mov|mkv|avi|m4v)$/i.test(savedFile.name)) {
          setGlobalVideoUrl(url);
          setSegments((prev) => {
            if (prev.length > 0) {
              return prev.map((seg) => ({
                ...seg,
                imageUrl: seg.imageUrl || url,
                imageType: seg.imageType || "video"
              }));
            }
            return prev;
          });
        }
      }
    }
    loadSavedAudio();
  }, []);

  // Auto-save changes to localStorage
  useEffect(() => {
    if (segments.length > 0) {
      localStorage.setItem("syncer_segments", JSON.stringify(segments));
    } else {
      localStorage.removeItem("syncer_segments");
    }
  }, [segments]);

  useEffect(() => {
    if (audioName) {
      localStorage.setItem("syncer_audio_name", audioName);
    } else {
      localStorage.removeItem("syncer_audio_name");
    }
  }, [audioName]);

  useEffect(() => {
    if (audioDuration !== null) {
      localStorage.setItem("syncer_audio_duration", audioDuration.toString());
    } else {
      localStorage.removeItem("syncer_audio_duration");
    }
  }, [audioDuration]);

  const handleAudioUploaded = (file: File | null, url: string | null, duration: number | null) => {
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    // Clean up segment image URLs too when removing audio
    if (!file) {
      segments.forEach((seg) => {
        if (seg.imageUrl) URL.revokeObjectURL(seg.imageUrl);
      });
    }

    if (!file) {
      setAudioFile(null);
      setAudioUrl(null);
      setAudioName(null);
      setAudioDuration(null);
      setGlobalVideoUrl(null);
      setSegments([]);
      setCurrentTime(0);
      clearAudioFileFromDB();
    } else {
      setAudioFile(file);
      setAudioUrl(url);
      setAudioName(file.name);
      setAudioDuration(duration);
      setSegments([]);
      if (file.type.startsWith("video/") || /\.(mp4|webm|mov|mkv|avi|m4v)$/i.test(file.name)) {
        setGlobalVideoUrl(url);
      }
      saveAudioFileToDB(file);
    }
  };

  const handleTranscriptionComplete = (rawSegments: TranscribeSegment[]) => {
    const newSegments = normalizeSegments(rawSegments, audioDuration);

    // Check if there is an active video (either globalVideoUrl or audioFile is a video)
    const activeVideoUrl = globalVideoUrl || (audioFile && (audioFile.type.startsWith("video/") || /\.(mp4|webm|mov|mkv|avi|m4v)$/i.test(audioFile.name)) ? audioUrl : null);

    if (activeVideoUrl) {
      const initialWithVideo = newSegments.map((seg) => ({
        ...seg,
        imageUrl: activeVideoUrl,
        imageType: "video" as const
      }));
      setSegments(initialWithVideo);
      return;
    }

    // Check if user has uploaded images/folder slides
    if (images.length > 0) {
      const initialWithUploadedFolder = distributeMediaToSegments(images, newSegments);
      setSegments(initialWithUploadedFolder);
      return;
    }

    // 1. Immediately assign local thematic script matches so UI responds instantly
    const initialMatched = newSegments.map((seg, idx) => {
      if (!seg.imageUrl) {
        const match = matchImageForScript(seg.text, idx);
        return {
          ...seg,
          imageUrl: getSafeImageUrl(match.url),
          imageType: "image" as const
        };
      }
      return seg;
    });
    setSegments(initialMatched);

    // 2. Asynchronously fetch real live web HD photos matching each script sentence from server (ONLY if no global video)
    if (!globalVideoUrl && !activeVideoUrl) {
      fetch("/api/auto-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ segments: newSegments })
      })
        .then((res) => res.json())
        .then((data) => {
          if (data.success && Array.isArray(data.images) && data.images.length === newSegments.length) {
            setSegments((prev) =>
              prev.map((seg, idx) => {
                if (seg.imageType === "video" || seg.imageUrl === globalVideoUrl) {
                  return seg;
                }
                if (data.images[idx]) {
                  return {
                    ...seg,
                    imageUrl: getSafeImageUrl(data.images[idx]),
                    imageType: "image"
                  };
                }
                return seg;
              })
            );
          }
        })
        .catch((err) => console.warn("Live image auto-sync error:", err));
    }
  };

  const handleSegmentImageUploaded = (index: number, url: string | null, type?: "image" | "video") => {
    setSegments((prev) => {
      const updated = [...prev];
      if (updated[index]) {
        const oldUrl = updated[index].imageUrl;
        if (
          oldUrl &&
          oldUrl !== url &&
          oldUrl.startsWith("blob:") &&
          oldUrl !== globalVideoUrl &&
          oldUrl !== audioUrl
        ) {
          try {
            URL.revokeObjectURL(oldUrl);
          } catch (e) {
            console.warn("Could not revoke object URL:", e);
          }
        }
        updated[index] = {
          ...updated[index],
          imageUrl: url || undefined,
          imageType: url ? (type || "image") : undefined
        };
      }
      return updated;
    });
  };

  const handleSegmentEdited = (index: number, updatedFields: Partial<TranscribeSegment>) => {
    setSegments((prev) => {
      const updated = [...prev];
      if (updated[index]) {
        updated[index] = {
          ...updated[index],
          ...updatedFields
        };
      }
      return normalizeSegments(updated, audioDuration);
    });
  };

  const handleDeleteSegment = (index: number) => {
    setSegments((prev) => {
      const updated = [...prev];
      const target = updated[index];
      if (target && target.imageUrl) {
        URL.revokeObjectURL(target.imageUrl);
      }
      updated.splice(index, 1);
      return normalizeSegments(updated, audioDuration);
    });
  };

  const handleSplitSegment = (index: number) => {
    setSegments((prev) => {
      if (!prev[index]) return prev;
      const updated = [...prev];
      const seg = updated[index];
      const words = (seg.text || "").trim().split(/\s+/);
      const midTime = Number(((seg.start + seg.end) / 2).toFixed(1));

      if (words.length <= 1) {
        const seg1 = { ...seg, end: midTime };
        const seg2 = { ...seg, start: midTime, imageUrl: undefined, imageType: undefined };
        updated.splice(index, 1, seg1, seg2);
      } else {
        const midWordIdx = Math.max(1, Math.ceil(words.length / 2));
        const text1 = words.slice(0, midWordIdx).join(" ");
        const text2 = words.slice(midWordIdx).join(" ");

        const seg1 = { ...seg, end: midTime, text: text1 };
        const seg2 = { ...seg, start: midTime, text: text2, imageUrl: undefined, imageType: undefined };
        updated.splice(index, 1, seg1, seg2);
      }
      return normalizeSegments(updated, audioDuration);
    });
  };

  const handleMergeSegment = (index: number) => {
    setSegments((prev) => {
      if (index >= prev.length - 1) return prev;
      const updated = [...prev];
      const seg1 = updated[index];
      const seg2 = updated[index + 1];

      if (seg2.imageUrl && seg2.imageUrl !== seg1.imageUrl) {
        URL.revokeObjectURL(seg2.imageUrl);
      }

      const merged = {
        ...seg1,
        end: seg2.end,
        text: `${seg1.text.trim()} ${seg2.text.trim()}`
      };

      updated.splice(index, 2, merged);
      return normalizeSegments(updated, audioDuration);
    });
  };

  const handleCreateSegment = () => {
    setSegments((prev) => {
      const lastSeg = prev[prev.length - 1];
      const start = lastSeg ? lastSeg.end : 0;
      const end = start + 5;
      const updated = [
        ...prev,
        {
          start: Number(start.toFixed(1)),
          end: Number(end.toFixed(1)),
          text: "Edit this text to add your custom words or lyrics..."
        }
      ];
      return normalizeSegments(updated, audioDuration);
    });
  };

  const handleImagesUploaded = (newImages: UploadedImage[]) => {
    setImages(newImages);
    if (segments.length > 0 && newImages.length > 0) {
      setSegments((prev) => distributeMediaToSegments(newImages, prev));
    }
  };

  const handleDistributeUploadedImages = () => {
    if (images.length === 0 || segments.length === 0) return;
    setSegments((prev) => distributeMediaToSegments(images, prev));
  };

  const handleApplyVideoToAllSegments = (videoUrl: string) => {
    setGlobalVideoUrl(videoUrl);
    setSegments((prev) => {
      if (prev.length === 0) {
        return [];
      }
      return prev.map((seg) => ({
        ...seg,
        imageUrl: videoUrl,
        imageType: "video" as const
      }));
    });
  };

  const handleRemoveImage = (id: string) => {
    const target = images.find((img) => img.id === id);
    if (target) URL.revokeObjectURL(target.url);
    setImages(images.filter((img) => img.id !== id));
  };

  const handleReorderImages = (reordered: UploadedImage[]) => {
    setImages(reordered);
  };

  const handleSeek = (seconds: number) => {
    setCurrentTime(seconds);
    if (playbackRef.current) {
      playbackRef.current.currentTime = seconds;
    }
  };

  const handleResetAll = async () => {
    // Revoke Object URLs to avoid memory leaks
    if (audioUrl) {
      URL.revokeObjectURL(audioUrl);
    }
    segments.forEach((seg) => {
      if (seg.imageUrl) URL.revokeObjectURL(seg.imageUrl);
    });
    images.forEach((img) => {
      if (img.url) URL.revokeObjectURL(img.url);
    });

    // Clear Storage
    localStorage.removeItem("syncer_segments");
    localStorage.removeItem("syncer_audio_name");
    localStorage.removeItem("syncer_audio_duration");
    localStorage.removeItem("syncer_clear_on_refresh");
    await clearAudioFileFromDB();

    // Reset React State
    setAudioFile(null);
    setAudioUrl(null);
    setAudioName(null);
    setAudioDuration(null);
    setImages([]);
    setSegments([]);
    setCurrentTime(0);
    setShowResetConfirm(false);
  };

  // Safe fallback duration in case they have uploaded images but no audio yet
  const effectiveDuration = audioDuration || (images.length > 0 ? images.length * 3 : null);

  return (
    <div className="min-h-screen bg-slate-50/50 text-slate-900 flex flex-col font-sans">
      
      {/* Custom Confirmation Modal */}
      {showResetConfirm && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl max-w-md w-full border border-slate-100 p-6 shadow-xl space-y-4 animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-center gap-3 text-red-600">
              <div className="p-2 bg-red-50 rounded-xl">
                <Trash2 className="w-6 h-6" />
              </div>
              <div>
                <h3 className="font-display font-bold text-lg text-slate-850">Reset Application?</h3>
                <p className="text-xs text-red-500 font-semibold font-sans">डेटा पूरी तरह से मिटा दिया जाएगा</p>
              </div>
            </div>
            
            <div className="space-y-2 text-slate-600 text-sm leading-relaxed">
              <p>
                Are you sure you want to delete all data and reset the app? This will permanently clear your:
              </p>
              <ul className="list-disc pl-5 text-xs text-slate-500 space-y-1">
                <li>Uploaded audio file (स्थानीय ऑडियो फ़ाइल)</li>
                <li>Transcribed audio segments (टाइमस्क्रिप्ट डेटा)</li>
                <li>Uploaded slides and synchronized images (सारे चित्र)</li>
              </ul>
              <p className="text-xs text-slate-400 mt-2 font-medium">
                This action cannot be undone. / इस प्रक्रिया को वापस नहीं लिया जा सकता।
              </p>
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                onClick={() => setShowResetConfirm(false)}
                className="px-4 py-2 border border-slate-200 text-slate-600 text-sm font-semibold rounded-xl hover:bg-slate-50 transition-colors cursor-pointer"
              >
                Cancel / रद्द करें
              </button>
              <button
                onClick={handleResetAll}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-semibold rounded-xl transition-all shadow-md hover:shadow-red-500/20 active:scale-95 cursor-pointer"
              >
                Reset Everything / हाँ, हटाएँ
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Top Header Navigation */}
      <header className="bg-white border-b border-slate-100 py-3 px-4 sm:px-6 md:px-12 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sticky top-0 z-30 shadow-xs">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-blue-600 flex items-center justify-center text-white shadow-sm shadow-blue-500/20 shrink-0">
            <Layers className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-lg sm:text-xl font-display font-bold text-slate-800 tracking-tight whitespace-nowrap">
              Audio Video Syncer
            </h1>
            <p className="text-[9px] sm:text-xs text-slate-400 font-medium font-mono whitespace-nowrap">
              AI Audio Transcription & Slideshow Compiler
            </p>
          </div>
        </div>
        
        <div className="flex items-center gap-3 self-end sm:self-center">
          <button
            onClick={() => setShowResetConfirm(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1 bg-red-50 hover:bg-red-100 text-red-600 hover:text-red-700 font-bold text-[10px] sm:text-xs rounded-full border border-red-100 transition-colors shadow-xs cursor-pointer"
            title="Clear all data & Reset (सभी डेटा साफ करें)"
          >
            <Trash2 className="w-3 h-3 text-red-500" />
            Reset App / रीसेट करें
          </button>
          
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 sm:px-3 sm:py-1 bg-amber-50 text-amber-700 font-bold text-[9px] sm:text-xs rounded-full border border-amber-100 whitespace-nowrap">
            <Sparkles className="w-3 h-3 text-amber-500" />
            Gemini Flash 3.5 Active
          </span>
        </div>
      </header>

      {/* Saved Transcription Alert Banner */}
      {segments.length > 0 && !audioUrl && (
        <div className="max-w-7xl w-full mx-auto px-4 md:px-12 mt-4">
          <div className="flex items-start gap-3 bg-blue-50/70 border border-blue-200/60 rounded-xl p-4 text-blue-800 shadow-xs">
            <Info className="w-5 h-5 text-blue-500 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <p className="text-sm font-semibold">
                Saved Transcription Loaded! / पुरानी ट्रांसक्रिप्शन लोड हो चुकी है!
              </p>
              <p className="text-xs text-blue-600 leading-relaxed">
                We've restored your last transcription segments from storage. To play synced slideshow visuals, or compile/export your video, please upload or select your matching audio file in Section 1 below.
                <br />
                हमने आपके अंतिम ट्रांसक्रिप्शन सेगमेंट्स को सुरक्षित लोड कर दिया है। वीडियो प्ले करने, सिंक्रोनाइज करने या एक्सपोर्ट करने के लिए नीचे Section 1 में अपना ऑडियो फाइल फिर से चुनें।
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Main Container Layout */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 md:p-8 grid grid-cols-1 lg:grid-cols-12 gap-6 md:gap-8">
        
        {/* Left Control Column (Audio & Transcription) */}
        <div className="lg:col-span-5 space-y-6 md:space-y-8 flex flex-col">
          
          {/* Section 1: Audio & Media Upload Card */}
          <AudioUploader
            audioFile={audioFile}
            onAudioUploaded={handleAudioUploaded}
            onTranscriptionComplete={handleTranscriptionComplete}
            currentAudioUrl={audioUrl}
            currentAudioName={audioName}
            currentAudioDuration={audioDuration}
            segments={segments}
            onApplyVideoToAllSegments={handleApplyVideoToAllSegments}
            globalVideoUrl={globalVideoUrl}
          />

          {/* Section 2: Interactive Transcription Timeline */}
          <div className="flex-1 min-h-[300px]">
            <TranscriptionView
              segments={segments}
              currentTime={currentTime}
              uploadedImages={images}
              onSeek={handleSeek}
              onSegmentImageUploaded={handleSegmentImageUploaded}
              onSegmentEdited={handleSegmentEdited}
              onDeleteSegment={handleDeleteSegment}
              onCreateSegment={handleCreateSegment}
              onSplitSegment={handleSplitSegment}
              onMergeSegment={handleMergeSegment}
              onDistributeUploadedImages={handleDistributeUploadedImages}
            />
          </div>
        </div>

        {/* Right Preview Column (Images & Cinematic Player) */}
        <div className="lg:col-span-7 space-y-6 md:space-y-8 flex flex-col">
          
          {/* Section 3: Cinematic Synced Video Player */}
          <VideoPlayer
            audioFile={audioFile}
            audioUrl={audioUrl}
            globalVideoUrl={globalVideoUrl}
            audioDuration={effectiveDuration}
            images={images}
            segments={segments}
            currentTime={currentTime}
            onTimeUpdate={setCurrentTime}
            playbackRef={playbackRef}
            onAudioDurationSync={(dur) => setAudioDuration(dur)}
          />

          {/* Section 4: Image Slides Upload Box */}
          <ImageUploader
            images={images}
            onImagesUploaded={handleImagesUploaded}
            onRemoveImage={handleRemoveImage}
            onReorderImages={handleReorderImages}
            onApplyVideoToAllSegments={handleApplyVideoToAllSegments}
          />
        </div>
      </main>

      {/* Footer Details */}
      <footer className="border-t border-slate-100 bg-white py-6 text-center text-xs text-slate-400 mt-auto">
        <div className="max-w-7xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-4">
          <p className="font-medium">
            &copy; {new Date().getFullYear()} Audio Video Syncer. Built with Google Gemini API & HTML5 Canvas.
          </p>
          <div className="flex items-center gap-1 text-[10px] bg-slate-50 border border-slate-100 text-slate-500 px-3 py-1.5 rounded-lg max-w-xs text-left">
            <Info className="w-4.5 h-4.5 text-blue-500 shrink-0 mt-0.5" />
            <span>
              <strong>Hindi Guide:</strong> Audio aur multiple images upload karein. Syncing automatic ho jayegi. Play karke preview dekhein aur MP4 export karein!
            </span>
          </div>
        </div>
      </footer>
    </div>
  );
}
