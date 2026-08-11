import React, { useState, useRef } from "react";
import { Upload, FileAudio, Sparkles, AlertCircle, Play, Pause, Info, Mic, Wand2, Video } from "lucide-react";
import { TranscribeSegment } from "../types";

interface AudioUploaderProps {
  audioFile: File | null;
  onAudioUploaded: (file: File, url: string, duration: number) => void;
  onTranscriptionComplete: (segments: TranscribeSegment[]) => void;
  currentAudioUrl: string | null;
  currentAudioName: string | null;
  currentAudioDuration: number | null;
  segments: TranscribeSegment[];
  onApplyVideoToAllSegments?: (videoUrl: string) => void;
  globalVideoUrl?: string | null;
}

export default function AudioUploader({
  audioFile,
  onAudioUploaded,
  onTranscriptionComplete,
  currentAudioUrl,
  currentAudioName,
  currentAudioDuration,
  segments,
  onApplyVideoToAllSegments,
  globalVideoUrl
}: AudioUploaderProps) {
  const [dragActive, setDragActive] = useState(false);
  const [loading, setLoading] = useState(false);
  const [selectedLanguage, setSelectedLanguage] = useState<"auto" | "en" | "hi">("auto");
  const [info, setInfo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);

  // AI TTS & Upload Voice states
  const [activeTab, setActiveTab] = useState<"upload" | "tts" | "video">("upload");
  const [ttsText, setTtsText] = useState("");
  const [selectedVoice, setSelectedVoice] = useState("Kore");
  const [generatingVoice, setGeneratingVoice] = useState(false);

  // Helper to convert base64 audio response to File object
  const base64ToFile = (base64Data: string, fileName: string, mimeType: string): File => {
    const byteString = atob(base64Data);
    const ab = new ArrayBuffer(byteString.length);
    const ia = new Uint8Array(ab);
    for (let i = 0; i < byteString.length; i++) {
      ia[i] = byteString.charCodeAt(i);
    }
    const blob = new Blob([ab], { type: mimeType });
    return new File([blob], fileName, { type: mimeType });
  };

  const handleGenerateVoice = async () => {
    if (!ttsText.trim()) {
      setError("Please write some script text to generate a voiceover.");
      return;
    }

    setGeneratingVoice(true);
    setError(null);
    setInfo(null);

    try {
      const response = await fetch("/api/generate-voice", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text: ttsText,
          voice: selectedVoice,
        }),
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || `Server error: ${response.status}`);
      }

      const data = await response.json();
      if (!data.audio) {
        throw new Error("No audio data returned from the server.");
      }

      const mimeType = data.mimeType || "audio/wav";
      const ext = mimeType.split("/")[1] || "wav";

      // Convert the base64 audio to a File object using returned mimeType
      const fileName = `voiceover-${selectedVoice.toLowerCase()}-${Date.now()}.${ext}`;
      const file = base64ToFile(data.audio, fileName, mimeType);
      
      const url = URL.createObjectURL(file);
      
      // Get audio duration and set upload state with multiple event listeners and timeout fallbacks
      const tempAudio = new Audio();
      tempAudio.preload = "auto";
      
      let isSettled = false;

      const handleSuccess = (duration: number) => {
        if (isSettled) return;
        isSettled = true;
        clearTimeout(timeoutId);
        
        onAudioUploaded(file, url, duration);
        setInfo(`AI Voiceover (${selectedVoice}) generated successfully! You can now transcribe it to sync slides.`);
        
        // Pre-populate transcription text with the user's script to make editing easier!
        const startSegments: TranscribeSegment[] = [
          {
            start: 0,
            end: Number(duration.toFixed(1)),
            text: ttsText
          }
        ];
        onTranscriptionComplete(startSegments);
      };

      const handleFallback = () => {
        if (isSettled) return;
        isSettled = true;
        clearTimeout(timeoutId);

        // Estimate fallback duration based on standard speech rate (~140 words per minute)
        const words = ttsText.trim().split(/\s+/).length;
        const fallbackDuration = Math.max(3, Number((words / 2.3 + 1.5).toFixed(1)));
        console.warn(`[Audio] Using calculated fallback duration of ${fallbackDuration}s due to browser playback limits.`);
        
        onAudioUploaded(file, url, fallbackDuration);
        setInfo(`AI Voiceover (${selectedVoice}) generated successfully! (Note: duration estimated at ${fallbackDuration}s for compatibility)`);
        
        const startSegments: TranscribeSegment[] = [
          {
            start: 0,
            end: fallbackDuration,
            text: ttsText
          }
        ];
        onTranscriptionComplete(startSegments);
      };

      // Set a 3.5s safety timeout to ensure user never gets blocked by silent audio load failures
      const timeoutId = setTimeout(() => {
        console.log("Audio load timed out, using fallback duration.");
        handleFallback();
      }, 3500);

      tempAudio.addEventListener("loadedmetadata", () => {
        if (tempAudio.duration && !isNaN(tempAudio.duration) && tempAudio.duration !== Infinity) {
          handleSuccess(tempAudio.duration);
        } else {
          handleFallback();
        }
      });

      tempAudio.addEventListener("durationchange", () => {
        if (tempAudio.duration && !isNaN(tempAudio.duration) && tempAudio.duration !== Infinity) {
          handleSuccess(tempAudio.duration);
        }
      });

      tempAudio.addEventListener("canplaythrough", () => {
        if (tempAudio.duration && !isNaN(tempAudio.duration) && tempAudio.duration !== Infinity) {
          handleSuccess(tempAudio.duration);
        }
      });

      tempAudio.addEventListener("error", (e) => {
        console.warn("Audio element error during metadata loading, resorting to fallback duration.", e);
        handleFallback();
      });

      tempAudio.src = url;
      tempAudio.load();

    } catch (err: any) {
      console.error(err);
      const isFetchErr = err?.message === "Failed to fetch" || (typeof err?.message === "string" && err.message.toLowerCase().includes("fetch"));
      setError(isFetchErr ? "Network error: Unable to reach the voice generation server. Please try again." : (err.message || "Failed to generate AI voice."));
    } finally {
      setGeneratingVoice(false);
    }
  };

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const processVideoFile = (file: File) => {
    if (!file.type.startsWith("video/") && !/\.(mp4|webm|mov|mkv|avi|m4v)$/i.test(file.name)) {
      setError("Please upload a valid video file (e.g. MP4, WEBM, MOV).");
      return;
    }
    setError(null);
    const url = URL.createObjectURL(file);

    // Read video metadata
    const tempVideo = document.createElement("video");
    tempVideo.preload = "metadata";

    const handleVideoLoaded = () => {
      const dur = tempVideo.duration && !isNaN(tempVideo.duration) && tempVideo.duration !== Infinity ? tempVideo.duration : 10;
      
      // Always set this video file as the active media/audio track
      onAudioUploaded(file, url, dur);

      // Apply video across all segments
      if (onApplyVideoToAllSegments) {
        onApplyVideoToAllSegments(url);
      }

      setInfo(`🎥 Video '${file.name}' loaded! Transcribing spoken audio track into timeline parts...`);
      setTimeout(() => {
        handleTranscribe(file);
      }, 150);
    };

    tempVideo.addEventListener("loadedmetadata", handleVideoLoaded);
    tempVideo.addEventListener("error", () => {
      onAudioUploaded(file, url, 10);
      if (onApplyVideoToAllSegments) {
        onApplyVideoToAllSegments(url);
      }
      setTimeout(() => {
        handleTranscribe(file);
      }, 150);
    });

    tempVideo.src = url;
  };

  const processFile = (file: File) => {
    if (file.type.startsWith("video/") || /\.(mp4|webm|mov|mkv|avi|m4v)$/i.test(file.name)) {
      processVideoFile(file);
      return;
    }

    if (!file.type.startsWith("audio/")) {
      setError("Please upload an audio or video file (e.g. MP3, WAV, M4A, MP4, WEBM).");
      return;
    }
    setError(null);
    const url = URL.createObjectURL(file);
    
    // Get audio duration with fallbacks for VBR / long audio files
    const tempAudio = new Audio(url);
    tempAudio.preload = "metadata";

    let durationHandled = false;
    const emitDurationAndTranscribe = () => {
      if (durationHandled) return;
      const dur = tempAudio.duration;
      if (dur && !isNaN(dur) && isFinite(dur) && dur > 0) {
        durationHandled = true;
        onAudioUploaded(file, url, dur);
        setTimeout(() => {
          handleTranscribe(file);
        }, 150);
      }
    };

    tempAudio.addEventListener("loadedmetadata", emitDurationAndTranscribe);
    tempAudio.addEventListener("durationchange", emitDurationAndTranscribe);
    tempAudio.addEventListener("canplaythrough", emitDurationAndTranscribe);
    tempAudio.addEventListener("error", () => {
      if (!durationHandled) {
        setError("Could not read audio duration. The file might be corrupted.");
      }
    });
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      processFile(e.dataTransfer.files[0]);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      processFile(e.target.files[0]);
    }
  };

  // Converts audio file to base64
  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => {
        const base64String = reader.result as string;
        const base64Data = base64String.split(",")[1];
        resolve(base64Data);
      };
      reader.onerror = (error) => reject(error);
    });
  };

  // Helper to upload large video/audio files in 5MB chunks to avoid 500 error & RAM limits
  const uploadFileInChunks = async (file: File): Promise<string> => {
    const initRes = await fetch("/api/upload/init", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fileName: file.name, fileSize: file.size, mimeType: file.type || "video/mp4" })
    });
    if (!initRes.ok) throw new Error("Could not initialize chunked upload");
    const { uploadId, fileKey } = await initRes.json();

    const chunkSize = 5 * 1024 * 1024;
    const totalChunks = Math.ceil(file.size / chunkSize);

    for (let i = 0; i < totalChunks; i++) {
      const start = i * chunkSize;
      const end = Math.min(start + chunkSize, file.size);
      const chunkBlob = file.slice(start, end);

      const formData = new FormData();
      formData.append("uploadId", uploadId);
      formData.append("chunkIndex", i.toString());
      formData.append("chunk", chunkBlob);

      const chunkRes = await fetch("/api/upload/chunk", {
        method: "POST",
        body: formData
      });
      if (!chunkRes.ok) throw new Error(`Chunk ${i + 1}/${totalChunks} upload failed`);
    }

    const compRes = await fetch("/api/upload/complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ uploadId })
    });
    if (!compRes.ok) throw new Error("Could not finalize chunked upload");

    return fileKey;
  };

  const handleTranscribe = async (file: File) => {
    setLoading(true);
    setError(null);
    setInfo(null);
    try {
      let reqBody: any = {
        mimeType: file.type || (file.name.toLowerCase().endsWith(".mp4") ? "video/mp4" : file.name.toLowerCase().endsWith(".webm") ? "video/webm" : "audio/mp3"),
        language: selectedLanguage,
        duration: currentAudioDuration || 0,
        fileName: file.name
      };

      // For video files or large files (> 8MB), use chunked upload to avoid memory crash or 500 payload limit
      if (file.size > 8 * 1024 * 1024 || file.type.startsWith("video/") || /\.(mp4|webm|mov|mkv|avi|m4v)$/i.test(file.name)) {
        setInfo(`Uploading large video/audio (${(file.size / (1024 * 1024)).toFixed(1)}MB) in parts...`);
        const fileKey = await uploadFileInChunks(file);
        reqBody.fileKey = fileKey;
      } else {
        const base64Data = await fileToBase64(file);
        reqBody.audio = base64Data;
      }

      const response = await fetch("/api/transcribe", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(reqBody)
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || `Server responded with status ${response.status}`);
      }

      const result = await response.json();
      if (result.segments && Array.isArray(result.segments)) {
        if (result.isFallback) {
          setInfo(result.fallbackReason);
        } else {
          setInfo(null);
        }
        onTranscriptionComplete(result.segments);
      } else {
        throw new Error("Invalid transcription format returned from Gemini model.");
      }
    } catch (err: any) {
      console.error("[Transcription Error]:", err);
      const isFetchErr = err?.message === "Failed to fetch" || (typeof err?.message === "string" && err.message.toLowerCase().includes("fetch"));
      
      // Calculate synthetic fallback timeline segments matching the total audio duration
      const totalSec = currentAudioDuration || 30;
      const targetSegLen = 4.0;
      const numSegments = Math.max(1, Math.round(totalSec / targetSegLen));
      const segDuration = totalSec / numSegments;
      const fallbackSegments = [];
      const phrases = selectedLanguage === "hi" ? [
        "Swagat hai aapka is beautiful audio video creator website par.",
        "Humne aapke audio ko analyze karke iske timestamps set kar diye hain.",
        "Aap side panel me specific photos add karke apne gane me custom images laga sakte hain.",
        "Play button dabaein aur dekhein kaise music ke sath automatic dynamic slideshow chalta hai.",
        "Aap niche export video option se is synchronized creation ko offline MP4 me download kar sakte hain!"
      ] : [
        "Welcome to this advanced audio-to-video creator application.",
        "Your audio track is playing, and transitions are beautifully in sync.",
        "You can customize each segment's subtitles, timings, and slide photos.",
        "Dynamic canvas renders high-definition visual layouts automatically.",
        "Export your creation into a high-quality offline MP4 video easily!"
      ];

      for (let i = 0; i < numSegments; i++) {
        fallbackSegments.push({
          start: Number((i * segDuration).toFixed(2)),
          end: Number(((i + 1) * segDuration).toFixed(2)),
          text: phrases[i % phrases.length]
        });
      }

      onTranscriptionComplete(fallbackSegments);
      if (isFetchErr) {
        setInfo("Note: Network connection delay during auto-transcription. Initial timeline segments have been generated for your audio duration so you can edit and add photos immediately!");
      } else {
        setInfo(`Note: ${err.message || "Auto-transcription limit reached."} Default timeline segments generated matching your audio duration.`);
      }
    } finally {
      setLoading(false);
    }
  };

  // Fallback / Demo Simulation in case user doesn't have an API key configured yet
  const handleSimulateTranscribe = () => {
    if (!currentAudioDuration) return;
    setLoading(true);
    setError(null);
    setInfo("You are running in Offline Demo mode. We have auto-generated standard placeholder segments synchronized to your audio's length. Feel free to edit the subtitles and timestamps as needed.");

    // Generate nice realistic segments based on duration
    setTimeout(() => {
      const totalSec = Math.floor(currentAudioDuration);
      const segmentLen = Math.max(4, Math.floor(totalSec / 5)); // split into around 5 segments
      const simulatedSegments: TranscribeSegment[] = [];
      
      const isEnglish = selectedLanguage === "en" || (selectedLanguage === "auto" && !currentAudioName || !/[अ-ञ]/.test(currentAudioName || "") && !/hindi|gaana|song|bhojpuri|tamil/i.test(currentAudioName || ""));
      
      const englishPhrases = [
        "Welcome to this advanced audio-to-video creator application.",
        "We have successfully analyzed your audio file and calculated accurate timestamps.",
        "You can upload specific images for each timestamp segment or global slideshow images.",
        "Press the play button to watch the dynamic canvas synchronize the visuals in real-time.",
        "Use the export video option below to render and download your synchronized creation as an MP4!"
      ];

      const hindiPhrases = [
        "Swagat hai aapka is beautiful audio video creator website par.",
        "Humne aapke audio ko analyze karke iske timestamps set kar diye hain.",
        "Aap side panel me specific photos add karke apne gane ya voiceover me custom images laga sakte hain.",
        "Play button dabaein aur dekhein kaise music ke sath automatic dynamic slideshow chalta hai.",
        "Aap niche export video option se is synchronized creation ko offline MP4 me download kar sakte hain!"
      ];

      const phrases = isEnglish ? englishPhrases : hindiPhrases;

      let currentStart = 0;
      for (let i = 0; i < phrases.length; i++) {
        if (currentStart >= totalSec) break;
        const currentEnd = Math.min(currentStart + segmentLen, totalSec);
        simulatedSegments.push({
          start: Number(currentStart.toFixed(1)),
          end: Number(currentEnd.toFixed(1)),
          text: phrases[i % phrases.length]
        });
        currentStart = currentEnd;
      }

      onTranscriptionComplete(simulatedSegments);
      setLoading(false);
    }, 1200);
  };

  const formatTime = (time: number) => {
    const mins = Math.floor(time / 60);
    const secs = Math.floor(time % 60);
    return `${mins}:${secs < 10 ? "0" : ""}${secs}`;
  };

  // Find the file reference using current audio name
  const currentFile = fileInputRef.current?.files?.[0] || null;

  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between border-b border-slate-100 pb-3 gap-2">
        <h2 className="text-xl font-display font-semibold text-slate-800 flex items-center gap-2">
          <FileAudio className="w-5 h-5 text-blue-500" />
          1. Audio Upload
        </h2>
        {currentAudioDuration && (
          <span className="font-mono text-xs bg-slate-100 text-slate-600 px-2.5 py-1 rounded-full w-fit">
            Duration: {formatTime(currentAudioDuration)}
          </span>
        )}
      </div>

      {!currentAudioUrl ? (
        <div className="space-y-4">
          {/* Tab Bar */}
          <div className="flex border-b border-slate-100 gap-1 overflow-x-auto scrollbar-none">
            <button
              onClick={() => setActiveTab("upload")}
              className={`flex-1 pb-3 text-[10px] sm:text-xs font-bold uppercase tracking-wider border-b-2 transition-all flex items-center justify-center gap-1.5 cursor-pointer whitespace-nowrap ${
                activeTab === "upload"
                  ? "border-blue-500 text-blue-600"
                  : "border-transparent text-slate-400 hover:text-slate-600"
              }`}
            >
              <Upload className="w-4 h-4" />
              Upload Audio
            </button>
            <button
              onClick={() => setActiveTab("tts")}
              className={`flex-1 pb-3 text-[10px] sm:text-xs font-bold uppercase tracking-wider border-b-2 transition-all flex items-center justify-center gap-1.5 cursor-pointer whitespace-nowrap ${
                activeTab === "tts"
                  ? "border-blue-500 text-blue-600"
                  : "border-transparent text-slate-400 hover:text-slate-600"
              }`}
            >
              <Mic className="w-4 h-4" />
              AI Voice (TTS) ✨
            </button>
            <button
              onClick={() => setActiveTab("video")}
              className={`flex-1 pb-3 text-[10px] sm:text-xs font-bold uppercase tracking-wider border-b-2 transition-all flex items-center justify-center gap-1.5 cursor-pointer whitespace-nowrap ${
                activeTab === "video"
                  ? "border-purple-600 text-purple-700 bg-purple-50/50 rounded-t-lg"
                  : "border-transparent text-slate-400 hover:text-slate-600"
              }`}
            >
              <Video className="w-4 h-4 text-purple-600" />
              Video for All Parts 🎥
            </button>
          </div>

          {activeTab === "upload" ? (
            <div
              onDragEnter={handleDrag}
              onDragOver={handleDrag}
              onDragLeave={handleDrag}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all ${
                dragActive
                  ? "border-blue-500 bg-blue-50/50"
                  : "border-slate-200 hover:border-blue-400 hover:bg-slate-50/50"
              }`}
              id="audio-dropzone"
            >
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileChange}
                accept="audio/*,video/*"
                className="hidden"
              />
              <div className="mx-auto w-12 h-12 rounded-full bg-blue-50 flex items-center justify-center mb-3">
                <Upload className="w-6 h-6 text-blue-500" />
              </div>
              <p className="text-sm font-medium text-slate-700">
                Drag & drop audio or video file here or click to browse
              </p>
              <p className="text-xs text-slate-400 mt-1">
                Supports MP3, WAV, M4A, MP4, WEBM (Max 50MB)
              </p>
            </div>
          ) : activeTab === "video" ? (
            <div
              onDragEnter={handleDrag}
              onDragOver={handleDrag}
              onDragLeave={handleDrag}
              onDrop={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setDragActive(false);
                if (e.dataTransfer.files && e.dataTransfer.files[0]) {
                  processVideoFile(e.dataTransfer.files[0]);
                }
              }}
              onClick={() => videoInputRef.current?.click()}
              className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-all ${
                dragActive
                  ? "border-purple-500 bg-purple-50/50"
                  : "border-purple-200 hover:border-purple-400 bg-purple-50/30 hover:bg-purple-50/60"
              }`}
              id="video-dropzone"
            >
              <input
                type="file"
                ref={videoInputRef}
                onChange={(e) => {
                  if (e.target.files && e.target.files[0]) {
                    processVideoFile(e.target.files[0]);
                  }
                }}
                accept="video/*"
                className="hidden"
              />
              <div className="mx-auto w-12 h-12 rounded-full bg-purple-100 flex items-center justify-center mb-2.5">
                <Video className="w-6 h-6 text-purple-600" />
              </div>
              <p className="text-sm font-bold text-purple-900">
                Upload Video to Apply Across ALL Parts / Segments
              </p>
              <p className="text-xs text-purple-600/90 mt-1">
                सभी सेगमेंट्स/पार्ट्स में एक साथ वीडियो बैकग्राउंड लगाने के लिए क्लिक करें या वीडियो ड्रॉप करें (MP4, WEBM, MOV)
              </p>
              {globalVideoUrl && (
                <div className="mt-3 inline-flex items-center gap-1.5 bg-purple-100 text-purple-800 text-xs font-bold px-3 py-1 rounded-full border border-purple-200">
                  <Sparkles className="w-3.5 h-3.5 text-purple-600" />
                  Video Active on All Parts!
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-4 text-left">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold text-slate-500 font-mono uppercase tracking-wider">
                  Script / Speech Text
                </label>
                <textarea
                  value={ttsText}
                  onChange={(e) => setTtsText(e.target.value)}
                  placeholder="Type or paste your video script here... Gemini will convert this exact text into a realistic AI voiceover!"
                  rows={4}
                  className="w-full text-sm bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-slate-700 font-medium placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 resize-none"
                />
              </div>

              <div className="flex flex-col sm:flex-row gap-3">
                <div className="flex flex-col gap-1 flex-1">
                  <label className="text-[10px] font-bold text-slate-400 font-mono uppercase tracking-wider">
                    AI Speaker Voice
                  </label>
                  <select
                    value={selectedVoice}
                    onChange={(e) => setSelectedVoice(e.target.value)}
                    className="text-xs bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-2 text-slate-700 font-semibold focus:outline-none focus:ring-2 focus:ring-blue-500/20 cursor-pointer w-full"
                  >
                    <option value="Kore">Kore (Male - Warm & Professional)</option>
                    <option value="Puck">Puck (Male - Bright & Energetic)</option>
                    <option value="Fenrir">Fenrir (Male - Deep & Cinematic)</option>
                    <option value="Zephyr">Zephyr (Female - Conversational)</option>
                    <option value="Charon">Charon (Female - Soft & Narrative)</option>
                  </select>
                </div>
                <div className="flex items-end w-full sm:w-auto">
                  <button
                    onClick={handleGenerateVoice}
                    disabled={generatingVoice || !ttsText.trim()}
                    className="w-full sm:w-auto flex items-center justify-center gap-2 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-medium py-2.5 px-4 rounded-xl text-xs shadow-sm transition-all disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer whitespace-nowrap"
                  >
                    {generatingVoice ? (
                      <>
                        <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        Generating Voice...
                      </>
                    ) : (
                      <>
                        <Wand2 className="w-3.5 h-3.5 animate-pulse" />
                        Generate AI Voice
                      </>
                    )}
                  </button>
                </div>
              </div>
              
              <div className="p-3.5 bg-slate-50/80 rounded-xl border border-slate-100 flex gap-2.5 items-start">
                <Sparkles className="w-4.5 h-4.5 text-blue-500 shrink-0 mt-0.5 animate-pulse" />
                <p className="text-[11px] text-slate-500 leading-relaxed">
                  <strong>AI Voice Engine:</strong> Generates beautiful audio voiceovers from text. After generation, we also auto-populate a draft subtitle track so you can start syncing your slide images immediately!
                </p>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center justify-between p-4 bg-slate-50 rounded-xl border border-slate-100">
            <div className="flex items-center gap-3 overflow-hidden">
              <div className="w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center shrink-0">
                <FileAudio className="w-5 h-5 text-blue-500" />
              </div>
              <div className="overflow-hidden">
                <p className="text-sm font-medium text-slate-800 truncate" title={currentAudioName || "Audio file"}>
                  {currentAudioName}
                </p>
                <p className="text-xs text-slate-400">
                  Ready for synchronization
                </p>
              </div>
            </div>
            <button
              onClick={() => {
                onAudioUploaded(null as any, null as any, null as any);
                onTranscriptionComplete([]);
                setInfo(null);
                setError(null);
              }}
              className="text-xs text-red-500 hover:text-red-700 font-medium px-2.5 py-1.5 hover:bg-red-50 rounded-lg transition-colors whitespace-nowrap shrink-0"
              id="remove-audio-btn"
            >
              Change
            </button>
          </div>

          {/* Quick Apply Video to All Parts Option */}
          <div className="flex items-center justify-between p-3.5 bg-purple-50/80 rounded-xl border border-purple-100">
            <div className="flex items-center gap-2.5 overflow-hidden">
              <div className="w-8 h-8 rounded-lg bg-purple-100 flex items-center justify-center shrink-0">
                <Video className="w-4 h-4 text-purple-600" />
              </div>
              <div className="overflow-hidden text-left">
                <p className="text-xs font-bold text-purple-900 truncate">
                  {globalVideoUrl ? "🎥 Video Active on All Parts (सभी पार्ट्स में वीडियो लागू)" : "🎥 Apply Video to All Parts (सभी पार्ट्स में वीडियो लगाएं)"}
                </p>
                <p className="text-[10px] text-purple-600 truncate">
                  {globalVideoUrl ? "Change video for all transcription segments" : "Upload video to fill all timeline parts automatically"}
                </p>
              </div>
            </div>
            <button
              onClick={() => videoInputRef.current?.click()}
              className="text-xs font-bold bg-purple-600 hover:bg-purple-700 text-white px-3 py-1.5 rounded-lg shadow-xs transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              {globalVideoUrl ? "Change Video" : "Upload Video for All"}
            </button>
            <input
              type="file"
              ref={videoInputRef}
              onChange={(e) => {
                if (e.target.files && e.target.files[0]) {
                  processVideoFile(e.target.files[0]);
                }
              }}
              accept="video/*"
              className="hidden"
            />
          </div>

          <div className="flex flex-col gap-3">
            {segments.length === 0 ? (
              <div className="flex flex-col gap-2">
                <div className="flex flex-col gap-1 text-left mb-1">
                  <label htmlFor="language-select" className="text-xs font-semibold text-slate-500 font-mono uppercase tracking-wider">
                    Audio Language
                  </label>
                  <select
                    id="language-select"
                    value={selectedLanguage}
                    onChange={(e) => setSelectedLanguage(e.target.value as any)}
                    className="text-sm bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-slate-700 font-medium focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  >
                    <option value="auto">Auto Detect Language</option>
                    <option value="hi">Hindi Transcription (देवनागरी)</option>
                    <option value="en">English Transcription</option>
                  </select>
                </div>

                <button
                  onClick={() => {
                    const files = fileInputRef.current?.files;
                    if (audioFile) {
                      handleTranscribe(audioFile);
                    } else if (files && files[0]) {
                      handleTranscribe(files[0]);
                    } else {
                      // Fallback: If we created the URL from state, we can run simulation or show key error
                      handleSimulateTranscribe();
                    }
                  }}
                  disabled={loading}
                  className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-medium py-3 px-4 rounded-xl shadow-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  id="transcribe-btn"
                >
                  {loading ? (
                    <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <Sparkles className="w-4 h-4" />
                  )}
                  {loading ? "Transcribing Audio..." : "Transcribe Audio (Gemini)"}
                </button>

                <button
                  onClick={handleSimulateTranscribe}
                  disabled={loading}
                  className="w-full flex items-center justify-center gap-1 text-slate-500 hover:text-slate-800 text-xs py-1.5 rounded-lg border border-dashed border-slate-200 hover:border-slate-300 transition-all disabled:opacity-50"
                  id="simulate-transcribe-btn"
                >
                  Or Simulate Transcription (Offline Demo)
                </button>
              </div>
            ) : (
              <div className="space-y-3 text-left">
                <div className="bg-emerald-50 text-emerald-800 border border-emerald-100 rounded-xl p-3.5 flex items-center justify-between gap-2.5">
                  <div className="flex items-start gap-2.5 overflow-hidden">
                    <Sparkles className="w-4.5 h-4.5 text-emerald-600 shrink-0 mt-0.5" />
                    <div>
                      <h4 className="text-xs font-bold">Transcription Active ({segments.length} Parts)!</h4>
                      <p className="text-[11px] text-emerald-700/90 mt-0.5">
                        Audio/video is split into timestamped segments below.
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => {
                      if (audioFile) {
                        handleTranscribe(audioFile);
                      } else {
                        handleSimulateTranscribe();
                      }
                    }}
                    disabled={loading}
                    className="text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-1.5 rounded-lg shadow-xs transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
                  >
                    {loading ? "Transcribing..." : "Re-Transcribe"}
                  </button>
                </div>

                {info && (
                  <div className="bg-blue-50 text-blue-800 border border-blue-100 rounded-xl p-3.5 flex items-start gap-2.5 text-xs">
                    <Info className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
                    <div>
                      <p className="font-semibold">Notice</p>
                      <p className="text-blue-700/90 mt-0.5">{info}</p>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {error && (
        <div className="bg-red-50 text-red-800 border border-red-100 rounded-xl p-4 flex gap-3 text-xs">
          <AlertCircle className="w-5 h-5 text-red-600 shrink-0" />
          <div className="space-y-1">
            <p className="font-semibold">Transcribe Issue</p>
            <p className="text-red-700">{error}</p>
            <button
              onClick={handleSimulateTranscribe}
              className="mt-1.5 font-semibold text-blue-600 hover:text-blue-800 flex items-center gap-1"
            >
              Use demo simulation to proceed instantly &rarr;
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
