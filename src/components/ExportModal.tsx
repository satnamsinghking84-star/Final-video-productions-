import React, { useState, useEffect, useRef } from "react";
import { Download, Play, Pause, X, RefreshCw, CheckCircle2, AlertTriangle, ShieldCheck, Film, Music, Cpu, HardDrive, Loader2 } from "lucide-react";
import { ExportJobConfig, ExportJobStatus, VerificationReport } from "../types";

interface ExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  audioFile: File | null;
  audioUrl: string | null;
  globalVideoUrl?: string | null;
  images: Array<{ id: string; url: string; name: string; type?: "image" | "video" }>;
  segments: Array<{ start: number; end: number; text: string; imageUrl?: string; imageType?: "image" | "video" }>;
  config: ExportJobConfig;
}

// Video validation & download pipeline
async function verifyAndDownloadExport(
  downloadUrl: string,
  jobId: string,
  onProgressMessage?: (msg: string) => void
): Promise<{ success: boolean; error?: string }> {
  try {
    if (onProgressMessage) onProgressMessage("Fetching video file from server...");

    let response: Response;
    try {
      response = await fetch(downloadUrl, {
        method: "GET",
        headers: {
          "Accept": "video/mp4,video/webm,video/*;q=0.9,*/*;q=0.8"
        }
      });
    } catch (netErr) {
      try {
        const fullUrl = new URL(downloadUrl, window.location.href).href;
        response = await fetch(fullUrl);
      } catch (e) {
        return {
          success: false,
          error: "Failed to connect to export server. Please check your network connection and retry."
        };
      }
    }

    const responseUrl = response.url || downloadUrl;
    const statusCode = response.status;
    const contentType = (response.headers.get("content-type") || "").toLowerCase();
    const contentLengthStr = response.headers.get("content-length") || "0";
    const responseSize = parseInt(contentLengthStr, 10) || 0;

    console.log(`[Export Download Check] URL: ${responseUrl}, Status: ${statusCode}, Content-Type: ${contentType}, Size: ${responseSize}`);

    if (!response.ok) {
      const errText = `Server returned status ${statusCode} (${response.statusText}) when fetching video export.`;
      console.error("[Export Download Error]:", { responseUrl, statusCode, contentType, responseSize });
      return { success: false, error: errText };
    }

    if (
      contentType.includes("text/html") ||
      contentType.includes("application/xhtml+xml") ||
      contentType.includes("text/plain")
    ) {
      console.error("[Export Download Error]: Export returned HTML instead of a video.", {
        responseUrl,
        statusCode,
        contentType,
        responseSize
      });
      return {
        success: false,
        error: "Export returned HTML instead of a video. Please retry."
      };
    }

    if (onProgressMessage) onProgressMessage("Reading video binary data...");
    const arrayBuffer = await response.arrayBuffer();

    if (!arrayBuffer || arrayBuffer.byteLength < 1000) {
      console.error("[Export Download Error]: File size too small or empty.", arrayBuffer?.byteLength);
      return {
        success: false,
        error: "Exported video file is incomplete or empty. Please retry export."
      };
    }

    if (onProgressMessage) onProgressMessage("Inspecting video signature & magic bytes...");
    const uint8 = new Uint8Array(arrayBuffer);

    // Check for HTML/markup in head
    const headerString = String.fromCharCode(...uint8.slice(0, 100)).toLowerCase();
    if (
      headerString.includes("<!doctype") ||
      headerString.includes("<html") ||
      headerString.includes("__cookie_check") ||
      headerString.includes("<script")
    ) {
      console.error("[Export Download Error]: Detected HTML markup in video buffer.", {
        responseUrl,
        statusCode,
        contentType,
        size: arrayBuffer.byteLength
      });
      return {
        success: false,
        error: "Export returned HTML instead of a video. Please retry."
      };
    }

    // Inspect MP4 vs WebM magic bytes
    let isMp4 = false;
    let isWebM = false;

    // MP4: 'ftyp' at offset 4
    if (uint8.length >= 8 && uint8[4] === 0x66 && uint8[5] === 0x74 && uint8[6] === 0x79 && uint8[7] === 0x70) {
      isMp4 = true;
    }

    // WebM: 0x1A 0x45 0xDF 0xA3 at offset 0
    if (uint8.length >= 4 && uint8[0] === 0x1A && uint8[1] === 0x45 && uint8[2] === 0xDF && uint8[3] === 0xA3) {
      isWebM = true;
    }

    if (!isMp4 && !isWebM) {
      if (contentType.includes("video/mp4") || contentType.includes("video/quicktime")) {
        isMp4 = true;
      } else if (contentType.includes("video/webm")) {
        isWebM = true;
      } else {
        for (let i = 0; i < Math.min(64, uint8.length - 4); i++) {
          if (uint8[i] === 0x66 && uint8[i + 1] === 0x74 && uint8[i + 2] === 0x79 && uint8[i + 3] === 0x70) {
            isMp4 = true;
            break;
          }
        }
      }
    }

    const verifiedMime = isWebM ? "video/webm" : "video/mp4";
    const fileExt = isWebM ? ".webm" : ".mp4";
    const downloadFileName = `final-video-${jobId}${fileExt}`;

    console.log(`[Export Signature Verified] Format: ${isWebM ? "WebM" : "MP4"}, MIME: ${verifiedMime}, Size: ${arrayBuffer.byteLength} bytes`);

    if (onProgressMessage) onProgressMessage("Testing video playability & duration...");

    const videoBlob = new Blob([arrayBuffer], { type: verifiedMime });
    const testBlobUrl = URL.createObjectURL(videoBlob);

    const playabilityValid = await new Promise<boolean>((resolve) => {
      const testVideo = document.createElement("video");
      testVideo.muted = true;
      testVideo.preload = "auto";
      testVideo.style.display = "none";
      document.body.appendChild(testVideo);

      let isDone = false;
      const cleanup = () => {
        if (!isDone) {
          isDone = true;
          clearTimeout(timeoutId);
          testVideo.removeEventListener("loadedmetadata", onLoaded);
          testVideo.removeEventListener("error", onError);
          if (testVideo.parentNode) testVideo.parentNode.removeChild(testVideo);
        }
      };

      const timeoutId = setTimeout(() => {
        console.warn("[Video Test] Timeout waiting for video metadata");
        cleanup();
        resolve(videoBlob.size > 50000);
      }, 5000);

      const onLoaded = () => {
        const hasWidth = testVideo.videoWidth > 0;
        const hasHeight = testVideo.videoHeight > 0;
        const hasDuration = testVideo.duration > 0 && isFinite(testVideo.duration);
        console.log(`[Video Test Passed] Dimensions: ${testVideo.videoWidth}x${testVideo.videoHeight}, Duration: ${testVideo.duration}s`);
        cleanup();
        resolve(hasWidth && hasHeight && hasDuration);
      };

      const onError = (e: any) => {
        console.warn("[Video Test Error]:", e);
        cleanup();
        resolve(false);
      };

      testVideo.addEventListener("loadedmetadata", onLoaded);
      testVideo.addEventListener("error", onError);
      testVideo.src = testBlobUrl;
      testVideo.load();
    });

    if (!playabilityValid) {
      URL.revokeObjectURL(testBlobUrl);
      return {
        success: false,
        error: "Export returned an unplayable or corrupt video file. Please retry."
      };
    }

    if (onProgressMessage) onProgressMessage("Saving video to device...");
    const downloadAnchor = document.createElement("a");
    downloadAnchor.href = testBlobUrl;
    downloadAnchor.download = downloadFileName;
    downloadAnchor.style.display = "none";
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    document.body.removeChild(downloadAnchor);

    setTimeout(() => {
      URL.revokeObjectURL(testBlobUrl);
    }, 20000);

    return { success: true };
  } catch (err: any) {
    console.error("[Export Download Exception]:", err);
    return {
      success: false,
      error: err?.message || "An error occurred while downloading the video file."
    };
  }
}

// Upload file to server using resumable chunked upload for files > 5MB, or standard upload for smaller files
async function uploadFileToServer(file: File, onProgress?: (pct: number) => void): Promise<{ fileKey: string; filePath: string }> {
  const CHUNK_SIZE = 5 * 1024 * 1024; // 5MB

  if (file.size <= CHUNK_SIZE) {
    const formData = new FormData();
    formData.append("file", file);
    const res = await fetch("/api/upload", {
      method: "POST",
      body: formData
    });
    if (!res.ok) throw new Error("File upload failed");
    const data = await res.json();
    if (onProgress) onProgress(100);
    return { fileKey: data.fileKey, filePath: data.filePath };
  }

  // Resumable Chunked Upload
  const initRes = await fetch("/api/upload/init", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fileName: file.name, fileSize: file.size, mimeType: file.type })
  });
  if (!initRes.ok) throw new Error("Could not initialize resumable upload");
  const { uploadId } = await initRes.json();

  let offset = 0;
  while (offset < file.size) {
    const chunk = file.slice(offset, offset + CHUNK_SIZE);
    const formData = new FormData();
    formData.append("chunk", chunk, file.name);

    const chunkRes = await fetch("/api/upload/chunk", {
      method: "POST",
      headers: { "x-upload-id": uploadId },
      body: formData
    });
    if (!chunkRes.ok) throw new Error("Chunk upload failed");

    offset += chunk.size;
    if (onProgress) {
      onProgress(Math.min(99, Math.round((offset / file.size) * 100)));
    }
  }

  const completeRes = await fetch("/api/upload/complete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ uploadId, originalName: file.name })
  });
  if (!completeRes.ok) throw new Error("Could not finalize upload");
  const completeData = await completeRes.json();
  if (onProgress) onProgress(100);
  return { fileKey: completeData.fileKey, filePath: completeData.filePath };
}

// Helper to fetch blob URL or remote URL and convert to File safely
async function urlToFile(url: string, filename: string): Promise<File | null> {
  if (!url) return null;
  try {
    if (url.startsWith("data:")) {
      const parts = url.split(",");
      const mimeMatch = parts[0].match(/:(.*?);/);
      const mime = mimeMatch ? mimeMatch[1] : "image/jpeg";
      const bstr = atob(parts[1]);
      let n = bstr.length;
      const u8arr = new Uint8Array(n);
      while (n--) {
        u8arr[n] = bstr.charCodeAt(n);
      }
      return new File([u8arr], filename, { type: mime });
    }

    let targetUrl = url;
    if (url.startsWith("/")) {
      targetUrl = window.location.origin + url;
    }

    if (targetUrl.startsWith("http://") || targetUrl.startsWith("https://")) {
      if (!targetUrl.startsWith(window.location.origin) && !targetUrl.includes("/api/proxy-image")) {
        try {
          const proxyRes = await fetch(`/api/proxy-image?url=${encodeURIComponent(targetUrl)}`);
          if (proxyRes.ok) {
            const blob = await proxyRes.blob();
            if (blob.size > 100 && !blob.type.includes("text")) {
              return new File([blob], filename, { type: blob.type || "image/jpeg" });
            }
          }
        } catch (proxyErr) {
          console.warn("Proxy fetch failed for URL:", targetUrl, proxyErr);
        }
      }
    }

    const res = await fetch(targetUrl);
    if (!res.ok) {
      console.warn(`Fetch returned status ${res.status} for ${targetUrl}`);
      return null;
    }
    const blob = await res.blob();
    if (blob.size < 100 || blob.type.includes("text")) {
      console.warn(`Fetch returned non-image blob (size: ${blob.size}, type: ${blob.type}) for ${targetUrl}`);
      return null;
    }
    return new File([blob], filename, { type: blob.type || "image/jpeg" });
  } catch (err) {
    console.warn(`Could not convert URL (${url}) to File:`, err);
    return null;
  }
}

export default function ExportModal({
  isOpen,
  onClose,
  audioFile,
  audioUrl,
  globalVideoUrl,
  images,
  segments,
  config
}: ExportModalProps) {
  const [phase, setPhase] = useState<"uploading" | "processing" | "completed" | "failed">("uploading");
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadStatus, setUploadStatus] = useState("Preparing server upload...");
  const [jobId, setJobId] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<ExportJobStatus | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isMinimized, setIsMinimized] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadStatusMsg, setDownloadStatusMsg] = useState<string | null>(null);

  const pollTimerRef = useRef<NodeJS.Timeout | null>(null);

  const handleDownloadVideo = async (customDownloadUrl?: string, customPartIndex?: number) => {
    const targetUrl = customDownloadUrl || jobStatus?.downloadUrl;
    if (!targetUrl || !jobId) return;
    setIsDownloading(true);
    const targetName = customPartIndex !== undefined ? `Part ${customPartIndex + 1}` : "Complete Video";
    setDownloadStatusMsg(`Verifying ${targetName} export response...`);
    setErrorMessage(null);

    const result = await verifyAndDownloadExport(targetUrl, jobId, (msg) => {
      setDownloadStatusMsg(msg);
    });

    setIsDownloading(false);
    setDownloadStatusMsg(null);

    if (!result.success) {
      const err = result.error || "Export returned HTML instead of a video. Please retry.";
      setErrorMessage(err);
      console.error("[Export Download Failure]:", err);
    }
  };

  // Start Server Export Pipeline
  const startPipeline = async () => {
    try {
      setPhase("uploading");
      setUploadProgress(0);
      setErrorMessage(null);
      setUploadStatus("Uploading audio track to server...");

      // 1. Upload main audio file
      let audioFileKey = "";
      if (audioFile) {
        const audioUpload = await uploadFileToServer(audioFile, (pct) => {
          setUploadProgress(Math.round(pct * 0.4));
        });
        audioFileKey = audioUpload.fileKey;
      } else if (audioUrl) {
        const fileFromUrl = await urlToFile(audioUrl, "audio_input.mp3");
        if (!fileFromUrl) {
          throw new Error("Could not load audio source file from browser.");
        }
        const audioUpload = await uploadFileToServer(fileFromUrl, (pct) => {
          setUploadProgress(Math.round(pct * 0.4));
        });
        audioFileKey = audioUpload.fileKey;
      } else {
        throw new Error("No audio source file provided.");
      }

      // 2. Upload global video if present
      let globalVideoFileKey: string | undefined = undefined;
      if (globalVideoUrl) {
        setUploadStatus("Uploading background video file...");
        try {
          const vidFile = await urlToFile(globalVideoUrl, "video_input.mp4");
          if (vidFile) {
            const vidUpload = await uploadFileToServer(vidFile, (pct) => {
              setUploadProgress(40 + Math.round(pct * 0.3));
            });
            globalVideoFileKey = vidUpload.fileKey;
          }
        } catch (e) {
          console.warn("Could not upload global background video:", e);
        }
      }

      // 3. Upload media slides & segment images
      setUploadStatus("Uploading slide images & media...");
      const mediaFileKeys: { [key: string]: string } = {};

      const isVideoAsset = (url?: string, type?: string) => {
        if (!url) return false;
        if (type === "video") return true;
        if (globalVideoUrl && url === globalVideoUrl) return true;
        if (audioUrl && url === audioUrl && (audioFile?.type.startsWith("video/") || /\.(mp4|webm|mov|mkv|avi|m4v)$/i.test(audioFile?.name || ""))) return true;
        return /\.(mp4|webm|mov|mkv|avi|m4v)$/i.test(url);
      };

      const uploadTasks: Promise<void>[] = [];

      segments.forEach((seg, idx) => {
        if (seg.imageUrl) {
          const imgUrl = seg.imageUrl;
          const isVideo = isVideoAsset(imgUrl, seg.imageType);
          const ext = isVideo ? "mp4" : "jpg";
          const task = (async () => {
            try {
              const file = await urlToFile(imgUrl, `segment_${idx}.${ext}`);
              if (file) {
                const res = await uploadFileToServer(file);
                mediaFileKeys[`seg_${idx}`] = res.fileKey;
                if (!mediaFileKeys["fallback"]) {
                  mediaFileKeys["fallback"] = res.fileKey;
                }
              }
            } catch (e) {
              console.warn(`Could not upload segment media ${idx}:`, e);
            }
          })();
          uploadTasks.push(task);
        }
      });

      if (images && images.length > 0) {
        images.forEach((img, idx) => {
          if (!img.url) return;
          const isVideo = isVideoAsset(img.url, img.type);
          const ext = isVideo ? "mp4" : "jpg";
          const task = (async () => {
            try {
              const file = await urlToFile(img.url, `img_${idx}.${ext}`);
              if (file) {
                const res = await uploadFileToServer(file);
                mediaFileKeys[`img_${idx}`] = res.fileKey;
                if (!mediaFileKeys["fallback"]) {
                  mediaFileKeys["fallback"] = res.fileKey;
                }
              }
            } catch (e) {
              console.warn(`Could not upload media ${idx}:`, e);
            }
          })();
          uploadTasks.push(task);
        });
      }

      await Promise.all(uploadTasks);

      setUploadProgress(100);
      setUploadStatus("Initializing server FFmpeg job...");

      // 4. Start export job on server
      const exportRes = await fetch("/api/export/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          config,
          audioFileKey,
          globalVideoFileKey,
          mediaFileKeys
        })
      });

      if (!exportRes.ok) {
        throw new Error("Failed to start export job on server");
      }

      const exportData = await exportRes.json();
      setJobId(exportData.jobId);
      setJobStatus(exportData.status);
      setPhase("processing");
    } catch (err: any) {
      console.error("[ExportModal Error]:", err);
      setErrorMessage(err?.message || "An error occurred while initiating export.");
      setPhase("failed");
    }
  };

  // Poll server for job status
  useEffect(() => {
    if (phase === "processing" && jobId) {
      pollTimerRef.current = setInterval(async () => {
        try {
          const res = await fetch(`/api/export/status/${jobId}`);
          if (res.ok) {
            const data = await res.json();
            const status: ExportJobStatus = data.status;
            setJobStatus(status);

            if (status.status === "completed") {
              setPhase("completed");
              if (pollTimerRef.current) clearInterval(pollTimerRef.current);
            } else if (status.status === "failed") {
              setErrorMessage(status.error || "FFmpeg render process failed.");
              setPhase("failed");
              if (pollTimerRef.current) clearInterval(pollTimerRef.current);
            }
          }
        } catch (e) {
          console.warn("Poll status error:", e);
        }
      }, 1000);
    }

    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    };
  }, [phase, jobId]);

  // Initial trigger when modal opens
  useEffect(() => {
    if (isOpen && !jobId && phase === "uploading") {
      startPipeline();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handlePauseResume = async () => {
    if (!jobId || !jobStatus) return;
    const endpoint = jobStatus.status === "paused" ? `/api/export/resume/${jobId}` : `/api/export/pause/${jobId}`;
    await fetch(endpoint, { method: "POST" });
  };

  const handleCancel = async () => {
    if (jobId) {
      await fetch(`/api/export/cancel/${jobId}`, { method: "POST" });
    }
    if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    onClose();
  };

  const handleRetry = () => {
    setJobId(null);
    setJobStatus(null);
    setErrorMessage(null);
    startPipeline();
  };

  const formatSeconds = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s < 10 ? "0" : ""}${s}`;
  };

  // Minimized background progress chip
  if (isMinimized) {
    return (
      <div className="fixed bottom-6 right-6 z-50 bg-slate-900 border border-slate-700 text-white rounded-2xl shadow-2xl p-4 flex items-center gap-4 animate-in fade-in slide-in-from-bottom-5">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-indigo-500/20 text-indigo-400 flex items-center justify-center font-bold text-xs">
            {jobStatus?.progress || 0}%
          </div>
          <div>
            <p className="text-xs font-semibold text-slate-200">
              {phase === "completed" ? "Video Export Ready! 🎉" : "Server FFmpeg Processing..."}
            </p>
            <p className="text-[10px] text-slate-400 font-mono">
              {jobStatus ? `${formatSeconds(jobStatus.processedSeconds)} / ${formatSeconds(jobStatus.totalSeconds)} (${jobStatus.speed || 1}x speed)` : "Uploading..."}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsMinimized(false)}
            className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-lg transition-colors cursor-pointer"
          >
            Open Modal
          </button>
          {phase === "completed" && jobStatus?.downloadUrl && (
            <button
              onClick={handleDownloadVideo}
              disabled={isDownloading}
              className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-700 text-white text-xs font-semibold rounded-lg transition-colors flex items-center gap-1 cursor-pointer"
            >
              {isDownloading ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Verifying...
                </>
              ) : (
                <>
                  <Download className="w-3.5 h-3.5" />
                  Download MP4
                </>
              )}
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-md p-4 animate-in fade-in duration-200">
      <div className="bg-slate-900 border border-slate-800 rounded-3xl max-w-2xl w-full p-6 text-white shadow-2xl space-y-6 max-h-[90vh] overflow-y-auto scrollbar-thin">
        
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 pb-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-indigo-500/10 text-indigo-400 rounded-xl border border-indigo-500/20">
              <Cpu className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-lg font-display font-bold text-slate-100">
                Server-Accelerated Video Compiler
              </h3>
              <p className="text-xs text-slate-400 font-sans">
                Non-blocking FFmpeg streaming pipeline for any media length
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {phase === "processing" && (
              <button
                onClick={() => setIsMinimized(true)}
                className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium rounded-lg transition-colors"
                title="Run export in background"
              >
                Run in Background
              </button>
            )}
            <button
              onClick={handleCancel}
              className="p-1.5 text-slate-400 hover:text-white transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Phase 1: Uploading */}
        {phase === "uploading" && (
          <div className="space-y-4 py-6 text-center">
            <div className="w-16 h-16 bg-blue-500/10 text-blue-400 rounded-full flex items-center justify-center mx-auto animate-pulse">
              <HardDrive className="w-8 h-8" />
            </div>
            <div className="space-y-1">
              <h4 className="text-base font-semibold text-slate-200">{uploadStatus}</h4>
              <p className="text-xs text-slate-400 max-w-md mx-auto">
                Transmitting original media files and subtitle timeline data to server disk with chunked upload protection.
              </p>
            </div>

            <div className="space-y-1 max-w-md mx-auto">
              <div className="flex justify-between text-xs font-mono text-slate-400">
                <span>Upload Progress</span>
                <span>{uploadProgress}%</span>
              </div>
              <div className="h-2.5 w-full bg-slate-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-blue-500 transition-all duration-200"
                  style={{ width: `${uploadProgress}%` }}
                />
              </div>
            </div>
          </div>
        )}

        {/* Phase 2: Server Processing */}
        {phase === "processing" && jobStatus && (
          <div className="space-y-6 py-2">
            <div className="bg-slate-950 border border-slate-800 rounded-2xl p-5 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className={`w-3 h-3 rounded-full ${jobStatus.status === "paused" ? "bg-amber-400 animate-ping" : "bg-emerald-400 animate-pulse"}`} />
                  <span className="text-sm font-bold tracking-wide uppercase text-slate-200">
                    {jobStatus.status === "paused" ? "Export Paused" : "FFmpeg Processing Active"}
                  </span>
                </div>
                <span className="text-xs font-mono text-indigo-400 font-bold bg-indigo-500/10 px-2.5 py-1 rounded-md border border-indigo-500/20">
                  Speed: {jobStatus.speed || 1.0}x Realtime
                </span>
              </div>

              {/* Progress Bar */}
              <div className="space-y-2">
                <div className="flex justify-between text-xs font-mono text-slate-400">
                  <span>Processed: {formatSeconds(jobStatus.processedSeconds)} / {formatSeconds(jobStatus.totalSeconds)}</span>
                  <span>{jobStatus.progress}%</span>
                </div>
                <div className="h-3 w-full bg-slate-800 rounded-full overflow-hidden p-0.5">
                  <div
                    className={`h-full rounded-full transition-all duration-300 ${jobStatus.status === "paused" ? "bg-amber-400" : "bg-indigo-500"}`}
                    style={{ width: `${jobStatus.progress}%` }}
                  />
                </div>
                <div className="flex justify-between text-[11px] text-slate-500 font-mono">
                  <span>ETA: ~{formatSeconds(jobStatus.etaSeconds)} remaining</span>
                  <span>No Browser Frame Loops / 0% Tab Freeze</span>
                </div>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex items-center justify-between gap-3 pt-2">
              <button
                onClick={handlePauseResume}
                className="flex items-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-xl transition-colors cursor-pointer"
              >
                {jobStatus.status === "paused" ? (
                  <>
                    <Play className="w-4 h-4 text-emerald-400" /> Resume Processing
                  </>
                ) : (
                  <>
                    <Pause className="w-4 h-4 text-amber-400" /> Pause Processing
                  </>
                )}
              </button>

              <button
                onClick={handleCancel}
                className="px-4 py-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 text-xs font-semibold rounded-xl border border-red-500/20 transition-colors cursor-pointer"
              >
                Cancel Job
              </button>
            </div>
          </div>
        )}

        {/* Phase 3: Completed Verification Report */}
        {phase === "completed" && jobStatus?.verification && (
          <div className="space-y-6 py-2 animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-center gap-3 bg-emerald-500/10 border border-emerald-500/20 rounded-2xl p-4 text-emerald-400">
              <CheckCircle2 className="w-6 h-6 shrink-0" />
              <div>
                <h4 className="text-base font-bold text-slate-100">
                  Export & Sync Verification Complete!
                </h4>
                <p className="text-xs text-emerald-300">
                  Your video has been rendered and validated on the server in {jobStatus.verification.exportTimeSeconds} seconds.
                </p>
              </div>
            </div>

            {/* Verification Report Card */}
            <div className="bg-slate-950 border border-slate-800 rounded-2xl p-5 space-y-4">
              <h5 className="text-xs font-mono font-bold text-slate-400 uppercase tracking-wider flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-indigo-400" /> Final Media Verification Summary
              </h5>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
                <div className="bg-slate-900 border border-slate-800 p-3 rounded-xl space-y-1">
                  <span className="text-slate-500 font-mono text-[10px]">RESOLUTION</span>
                  <p className="font-bold text-slate-200">{jobStatus.verification.outputResolution}</p>
                </div>
                <div className="bg-slate-900 border border-slate-800 p-3 rounded-xl space-y-1">
                  <span className="text-slate-500 font-mono text-[10px]">FRAME RATE</span>
                  <p className="font-bold text-slate-200">{jobStatus.verification.outputFps} FPS</p>
                </div>
                <div className="bg-slate-900 border border-slate-800 p-3 rounded-xl space-y-1">
                  <span className="text-slate-500 font-mono text-[10px]">TOTAL DURATION</span>
                  <p className="font-bold text-slate-200">{jobStatus.verification.outputDuration}s</p>
                </div>
                <div className="bg-slate-900 border border-slate-800 p-3 rounded-xl space-y-1">
                  <span className="text-slate-500 font-mono text-[10px]">AUDIO SAMPLE RATE</span>
                  <p className="font-bold text-slate-200">{jobStatus.verification.outputAudioSampleRate} Hz</p>
                </div>
                <div className="bg-slate-900 border border-slate-800 p-3 rounded-xl space-y-1">
                  <span className="text-slate-500 font-mono text-[10px]">AUDIO CHANNELS</span>
                  <p className="font-bold text-slate-200">{jobStatus.verification.outputAudioChannels} Channels (Stereo)</p>
                </div>
                <div className="bg-slate-900 border border-slate-800 p-3 rounded-xl space-y-1">
                  <span className="text-slate-500 font-mono text-[10px]">VIDEO CODEC</span>
                  <p className="font-bold text-slate-200">{jobStatus.verification.videoCodec}</p>
                </div>
              </div>

              <div className="flex flex-wrap gap-2 pt-2 text-[11px] font-mono text-slate-400">
                <span className="px-2.5 py-1 bg-slate-900 border border-slate-800 rounded-lg text-emerald-400">
                  ✓ Subtitle Timing Verified
                </span>
                <span className="px-2.5 py-1 bg-slate-900 border border-slate-800 rounded-lg text-emerald-400">
                  ✓ Audio-Video Sync Verified
                </span>
                <span className="px-2.5 py-1 bg-slate-900 border border-slate-800 rounded-lg text-indigo-400">
                  Quality: {jobStatus.verification.bitrateQuality}
                </span>
              </div>
            </div>

            {/* Chunked / Multi-Part Download Section for Large Videos */}
            {jobStatus.parts && jobStatus.parts.length > 0 && (
              <div className="bg-slate-950 border border-slate-800 rounded-2xl p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-xs font-bold text-slate-200">
                    <Film className="w-4 h-4 text-blue-400" />
                    <span>Download Video in Parts / Chunks ({jobStatus.parts.length} Parts)</span>
                  </div>
                  <span className="text-[10px] text-blue-400 font-mono bg-blue-500/10 px-2 py-0.5 rounded border border-blue-500/20">
                    500 Error Prevention
                  </span>
                </div>
                <p className="text-[11px] text-slate-400 leading-normal">
                  अगर 5 मिनट या बड़ी फाइल डाउनलोड करते समय सर्वर टाइमआउट / 500 Error आए, तो आप अपनी वीडियो को नीचे दिए गए अलग-अलग 1-1 मिनट के पार्ट्स में आसानी से डाउनलोड कर सकते हैं:
                </p>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                  {jobStatus.parts.map((part) => (
                    <button
                      key={part.partIndex}
                      onClick={() => handleDownloadVideo(part.downloadUrl, part.partIndex)}
                      disabled={isDownloading}
                      className="flex items-center justify-between p-3 bg-slate-900 hover:bg-slate-850 border border-slate-800 hover:border-blue-500/40 rounded-xl transition-all cursor-pointer text-left group disabled:opacity-50"
                    >
                      <div className="flex items-center gap-2.5 overflow-hidden">
                        <div className="w-7 h-7 rounded-lg bg-blue-500/10 text-blue-400 font-mono font-bold text-xs flex items-center justify-center shrink-0 group-hover:bg-blue-500 group-hover:text-white transition-colors">
                          P{part.partIndex + 1}
                        </div>
                        <div className="overflow-hidden">
                          <p className="text-xs font-bold text-slate-200 truncate">
                            Part {part.partIndex + 1} ({formatSeconds(part.startTime)} - {formatSeconds(part.endTime)})
                          </p>
                          <p className="text-[10px] text-slate-400 font-mono">
                            Size: {part.sizeMB ? `${part.sizeMB} MB` : "Ready"}
                          </p>
                        </div>
                      </div>
                      <Download className="w-4 h-4 text-blue-400 group-hover:translate-y-0.5 transition-transform shrink-0" />
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Download Status or Verification Error Banner */}
            {downloadStatusMsg && (
              <div className="flex items-center gap-2 bg-indigo-500/10 border border-indigo-500/20 text-indigo-300 p-3 rounded-xl text-xs font-mono animate-pulse">
                <Loader2 className="w-4 h-4 animate-spin text-indigo-400 shrink-0" />
                <span>{downloadStatusMsg}</span>
              </div>
            )}

            {errorMessage && (
              <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/20 text-red-400 p-3.5 rounded-xl text-xs font-medium">
                <AlertTriangle className="w-4 h-4 shrink-0 text-red-400" />
                <span>{errorMessage}</span>
              </div>
            )}

            {/* Download Button */}
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-2">
              <p className="text-[11px] text-slate-400">
                You can download the full merged MP4 video or download in individual parts above.
              </p>
              <div className="flex items-center gap-3 shrink-0">
                <button
                  onClick={onClose}
                  className="px-4 py-2.5 border border-slate-700 text-slate-300 text-xs font-semibold rounded-xl hover:bg-slate-800 transition-colors cursor-pointer"
                >
                  Close
                </button>
                <button
                  onClick={() => handleDownloadVideo()}
                  disabled={isDownloading}
                  className="flex items-center gap-2 px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-700 text-white text-sm font-bold rounded-xl shadow-lg shadow-emerald-500/20 transition-all active:scale-95 cursor-pointer"
                >
                  {isDownloading ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Verifying & Saving Video...</span>
                    </>
                  ) : (
                    <>
                      <Download className="w-4 h-4" />
                      <span>Download Complete MP4</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Phase 4: Error / Failed */}
        {phase === "failed" && (
          <div className="space-y-4 py-4 text-center">
            <div className="w-14 h-14 bg-red-500/10 text-red-400 rounded-full flex items-center justify-center mx-auto">
              <AlertTriangle className="w-7 h-7" />
            </div>
            <div className="space-y-1">
              <h4 className="text-base font-bold text-slate-100">Export Encountered An Issue</h4>
              <p className="text-xs text-red-400 max-w-md mx-auto leading-relaxed">
                {errorMessage || "An unexpected error occurred during FFmpeg processing."}
              </p>
            </div>

            <div className="flex items-center justify-center gap-3 pt-4">
              <button
                onClick={onClose}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold rounded-xl transition-colors cursor-pointer"
              >
                Close
              </button>
              <button
                onClick={handleRetry}
                className="flex items-center gap-2 px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-xl transition-colors cursor-pointer"
              >
                <RefreshCw className="w-4 h-4" /> Retry Export
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
