import React, { useState, useEffect, useRef } from "react";
import { Play, Pause, Download, Film, Volume2, VolumeX, Subtitles, HelpCircle, Loader, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import ysFixWebmDuration from "fix-webm-duration";
import { Muxer as WebmMuxer, ArrayBufferTarget as WebmArrayBufferTarget } from "webm-muxer";
import { TranscribeSegment, UploadedImage } from "../types";
import { getSafeImageUrl } from "../lib/scriptImageMatcher";
import ExportModal from "./ExportModal";

interface VideoPlayerProps {
  audioFile?: File | null;
  audioUrl: string | null;
  globalVideoUrl?: string | null;
  audioDuration: number | null;
  images: UploadedImage[];
  segments: TranscribeSegment[];
  currentTime: number;
  onTimeUpdate: (time: number) => void;
  playbackRef: React.MutableRefObject<HTMLAudioElement | null>;
  onAudioDurationSync?: (duration: number) => void;
}

function wrapCanvasText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  if (!text) return [];
  const words = text.split(" ");
  const lines: string[] = [];
  let currentLine = "";

  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    const testLine = currentLine ? `${currentLine} ${word}` : word;
    if (ctx.measureText(testLine).width > maxWidth && currentLine) {
      lines.push(currentLine);
      currentLine = word;
    } else {
      currentLine = testLine;
    }
  }
  if (currentLine) {
    lines.push(currentLine);
  }
  return lines.length > 0 ? lines : [text];
}

const ensureVideoReady = (video: HTMLVideoElement): Promise<void> => {
  return new Promise((resolve) => {
    if (!video) {
      resolve();
      return;
    }
    video.muted = true;
    video.volume = 0;
    video.playsInline = true;

    if (video.readyState >= 2 && video.videoWidth > 0) {
      resolve();
      return;
    }

    let resolved = false;
    const cleanup = () => {
      if (!resolved) {
        resolved = true;
        video.removeEventListener("loadeddata", cleanup);
        video.removeEventListener("canplay", cleanup);
        video.removeEventListener("canplaythrough", cleanup);
        video.removeEventListener("error", cleanup);
        clearTimeout(timer);
        resolve();
      }
    };

    video.addEventListener("loadeddata", cleanup, { once: true });
    video.addEventListener("canplay", cleanup, { once: true });
    video.addEventListener("canplaythrough", cleanup, { once: true });
    video.addEventListener("error", cleanup, { once: true });

    const timer = setTimeout(cleanup, 1500);

    try {
      if (video.readyState === 0) {
        video.load();
      }
    } catch (e) {
      cleanup();
    }
  });
};

const seekVideoToTime = (video: HTMLVideoElement, targetTime: number): Promise<void> => {
  return new Promise((resolve) => {
    if (!video || isNaN(targetTime) || !isFinite(targetTime)) {
      resolve();
      return;
    }

    const dur = video.duration;
    let safeTarget = targetTime;
    if (dur && isFinite(dur) && dur > 0) {
      safeTarget = Math.max(0, Math.min(dur - 0.02, targetTime));
    } else {
      safeTarget = Math.max(0, targetTime);
    }

    if (Math.abs(video.currentTime - safeTarget) < 0.002 && !video.seeking && video.readyState >= 2 && video.videoWidth > 0) {
      resolve();
      return;
    }

    let resolved = false;
    const cleanup = () => {
      if (!resolved) {
        resolved = true;
        video.removeEventListener("seeked", onSeeked);
        video.removeEventListener("error", onError);
        clearTimeout(timer);
        resolve();
      }
    };

    const onSeeked = () => {
      if ("requestVideoFrameCallback" in video && typeof (video as any).requestVideoFrameCallback === "function") {
        try {
          (video as any).requestVideoFrameCallback(() => cleanup());
        } catch (e) {
          cleanup();
        }
      } else {
        setTimeout(cleanup, 10);
      }
    };

    const onError = () => cleanup();

    const timer = setTimeout(cleanup, 1000);

    video.addEventListener("seeked", onSeeked, { once: true });
    video.addEventListener("error", onError, { once: true });

    try {
      video.currentTime = safeTarget;
    } catch (e) {
      cleanup();
    }
  });
};

export default function VideoPlayer({
  audioFile,
  audioUrl,
  globalVideoUrl,
  audioDuration,
  images,
  segments,
  currentTime,
  onTimeUpdate,
  playbackRef,
  onAudioDurationSync
}: VideoPlayerProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [volume, setVolume] = useState(0.8);
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [isCompiling, setIsCompiling] = useState(false);
  const [compileProgress, setCompileProgress] = useState(0);
  const [compileStatus, setCompileStatus] = useState("Rendering segments...");
  const [compileError, setCompileError] = useState<string | null>(null);
  const [showSubtitles, setShowSubtitles] = useState(true);
  const [zoomMode, setZoomMode] = useState<"none" | "zoom-in" | "zoom-out" | "ken-burns">("zoom-in");
  const [subtitleStyle, setSubtitleStyle] = useState<"classic" | "cinematic-yellow" | "bold-outline" | "minimal-accent" | "news-banner">("cinematic-yellow");
  const [aspectRatio, setAspectRatio] = useState<"16:9" | "9:16">("16:9");
  const [exportResolution, setExportResolution] = useState<"720p" | "1080p">("1080p");

  const containerRef = useRef<HTMLDivElement>(null);
  const imageElementsRef = useRef<Record<string, HTMLImageElement>>({});
  const segmentImageElementsRef = useRef<Record<number, HTMLImageElement>>({});
  const videoElementsRef = useRef<Record<string, HTMLVideoElement>>({});
  const segmentVideoElementsRef = useRef<Record<number, HTMLVideoElement>>({});
  const uniqueVideoElementsRef = useRef<Record<string, HTMLVideoElement>>({});
  const globalVideoElementRef = useRef<HTMLVideoElement | null>(null);
  const previewVideoRef = useRef<HTMLVideoElement | null>(null);
  const [videoTrigger, setVideoTrigger] = useState(0);

  // References to keep track of previous playback states for desynchronization and lag checks
  const lastActiveImageIdRef = useRef<string | null>(null);
  const lastActiveVideoUrlRef = useRef<string | null>(null);
  const lastExportVideoUrlRef = useRef<string | null>(null);
  const lastIsPlayingRef = useRef<boolean>(false);
  const lastCanvasFrameRef = useRef<HTMLCanvasElement | null>(null);
  const hasRenderedFrameRef = useRef<boolean>(false);

  // Helper to compute exact continuous video currentTime for a video asset
  const getVideoTargetTimeForUrl = (
    url: string | null,
    time: number,
    segs: TranscribeSegment[],
    audioDur: number | null,
    videoDuration: number
  ): { targetVideoTime: number; groupStart: number } => {
    if (!url) return { targetVideoTime: 0, groupStart: 0 };

    let firstSegStart: number | null = null;
    if (segs && segs.length > 0) {
      for (let i = 0; i < segs.length; i++) {
        if (segs[i].imageUrl === url) {
          firstSegStart = segs[i].start;
          break;
        }
      }
    }

    let groupStart = 0;
    if (firstSegStart !== null && time >= firstSegStart) {
      groupStart = firstSegStart;
    } else {
      groupStart = 0;
    }

    const safeVidDuration = (!videoDuration || isNaN(videoDuration) || !isFinite(videoDuration) || videoDuration <= 0) ? 5 : videoDuration;
    const elapsed = Math.max(0, time - groupStart);

    let targetVideoTime = 0;
    if (safeVidDuration > 0) {
      targetVideoTime = elapsed % safeVidDuration;
    } else {
      targetVideoTime = 0;
    }

    return { targetVideoTime, groupStart };
  };

  // Helper to compute total continuous slide bounds across multiple caption segments
  const getSlideBounds = (
    currentSegIdx: number,
    segs: TranscribeSegment[],
    audioDur: number | null,
    activeImgIdx: number,
    imgs: UploadedImage[]
  ) => {
    if (currentSegIdx !== -1) {
      let startIdx = currentSegIdx;
      for (let i = currentSegIdx; i >= 0; i--) {
        if (segs[i].imageUrl) {
          startIdx = i;
          break;
        }
      }

      const slideStart = segs[startIdx].start;

      let slideEnd = audioDur || 1;
      for (let i = startIdx + 1; i < segs.length; i++) {
        if (segs[i].imageUrl) {
          slideEnd = segs[i].start;
          break;
        }
      }

      let slideIndex = 0;
      for (let i = 0; i <= startIdx; i++) {
        if (segs[i].imageUrl) slideIndex++;
      }

      return { slideStart, slideEnd, slideIndex };
    }

    if (imgs.length > 0 && audioDur) {
      const interval = audioDur / imgs.length;
      const safeIdx = Math.max(0, Math.min(imgs.length - 1, activeImgIdx));
      const slideStart = safeIdx * interval;
      const slideEnd = (safeIdx + 1) * interval;
      return { slideStart, slideEnd, slideIndex: safeIdx };
    }

    return { slideStart: 0, slideEnd: audioDur || 1, slideIndex: 0 };
  };

  // Persistent Web Audio API nodes to safely support multiple exports without re-routing errors
  const audioCtxRef = useRef<AudioContext | null>(null);
  const audioSourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const audioDestRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  const lastConnectedAudioRef = useRef<HTMLAudioElement | null>(null);

  // Cleanup Web Audio context on unmount
  useEffect(() => {
    return () => {
      if (audioCtxRef.current) {
        audioCtxRef.current.close().catch((err) => console.warn("Error closing audio context on unmount:", err));
      }
    };
  }, []);

  // Reset play state if URL changes
  useEffect(() => {
    setIsPlaying(false);
  }, [audioUrl]);

  // Sync real-time duration from HTMLAudioElement when loaded or updated
  const syncDurationFromAudio = () => {
    const audio = playbackRef.current;
    if (audio && audio.duration && !isNaN(audio.duration) && isFinite(audio.duration) && audio.duration > 0) {
      if (onAudioDurationSync && Math.abs((audioDuration || 0) - audio.duration) > 0.1) {
        onAudioDurationSync(audio.duration);
      }
    }
  };

  // Smooth real-time update of playhead using requestAnimationFrame matching native audio output clock
  useEffect(() => {
    let animationFrameId: number;

    const updatePlayhead = () => {
      const audio = playbackRef.current;
      if (audio && !audio.paused && !audio.seeking) {
        onTimeUpdate(audio.currentTime);
        animationFrameId = requestAnimationFrame(updatePlayhead);
      }
    };

    if (isPlaying) {
      animationFrameId = requestAnimationFrame(updatePlayhead);
    }

    return () => {
      cancelAnimationFrame(animationFrameId);
    };
  }, [isPlaying, onTimeUpdate, playbackRef]);

  // Handle Play / Pause
  const togglePlay = () => {
    const audio = playbackRef.current;
    if (!audio) return;

    if (isPlaying) {
      audio.pause();
      setIsPlaying(false);
    } else {
      setIsPlaying(true);
      audio.play().catch((err) => {
        if (err.name !== "AbortError") {
          console.warn("Playback failed:", err);
        }
        setIsPlaying(false);
      });
    }
  };

  // Sync state with HTML Audio element triggers
  const handleAudioPlay = () => setIsPlaying(true);
  const handleAudioPause = () => setIsPlaying(false);
  const handleAudioEnded = () => {
    setIsPlaying(false);
    onTimeUpdate(0);
    if (playbackRef.current) {
      playbackRef.current.pause();
      playbackRef.current.currentTime = 0;
    }
  };

  const handleTimeUpdate = () => {
    if (playbackRef.current) {
      onTimeUpdate(playbackRef.current.currentTime);
    }
  };

  // Sync mute
  const toggleMute = () => {
    const audio = playbackRef.current;
    if (!audio) return;
    audio.muted = !isMuted;
    setIsMuted(!isMuted);
  };

  // Sync volume slider
  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const vol = parseFloat(e.target.value);
    setVolume(vol);
    const audio = playbackRef.current;
    if (audio) {
      audio.volume = vol;
      audio.muted = vol === 0;
      setIsMuted(vol === 0);
    }
  };

  // Sync timeline seek slider
  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    onTimeUpdate(val);
    if (playbackRef.current) {
      playbackRef.current.currentTime = val;
    }
  };

  // Exact Zero-Latency Master Clock Speech Segment Lookup
  const getActiveSpeechSegmentIdx = (time: number, segs: TranscribeSegment[]) => {
    if (!segs || segs.length === 0) return -1;
    for (let i = 0; i < segs.length; i++) {
      const s = segs[i];
      if (time >= (s.start - 0.05) && time <= (s.end + 0.15)) {
        return i;
      }
    }
    return -1;
  };

  // Continuous Media Background Segment Lookup (fills gaps so background slides transition seamlessly)
  const getMediaSegmentIdx = (time: number, segs: TranscribeSegment[], totalDuration?: number | null) => {
    if (!segs || segs.length === 0) return -1;
    if (time <= segs[0].start) return 0;
    for (let i = 0; i < segs.length; i++) {
      const nextStart = i < segs.length - 1 ? segs[i + 1].start : (totalDuration && totalDuration > segs[i].end ? totalDuration : segs[i].end + 3600);
      if (time >= segs[i].start && time < nextStart) {
        return i;
      }
    }
    return segs.length - 1;
  };

  // Master Clock: Direct HTMLAudioElement currentTime with zero latency offset correction
  const getMasterClockTime = (): number => {
    const audio = playbackRef.current;
    if (audio && !audio.paused && !isNaN(audio.currentTime) && audio.currentTime >= 0) {
      return audio.currentTime;
    }
    return currentTime;
  };

  const masterTime = getMasterClockTime();
  const activeSegmentIdx = getMediaSegmentIdx(masterTime, segments, audioDuration);
  const activeSegment = activeSegmentIdx !== -1 ? segments[activeSegmentIdx] : null;

  const activeSpeechSegIdx = getActiveSpeechSegmentIdx(masterTime, segments);
  const activeSubtitle = activeSpeechSegIdx !== -1 ? segments[activeSpeechSegIdx] : null;

  // Determine current active image index based on equal division of duration (for general slides)
  const activeImageIndex = (() => {
    if (!audioDuration || images.length === 0) return -1;
    const interval = audioDuration / images.length;
    const index = Math.floor(currentTime / interval);
    return Math.min(index, images.length - 1);
  })();

  // Retrieve active image/video (prioritizing segment-specific uploads, then backward carry-over, then general fallback)
  const activeImage = (() => {
    // 1. If active segment is playing and has an image/video, use it!
    if (activeSegment && activeSegment.imageUrl) {
      return {
        id: activeSegment.imageType === "video" ? `vid-${activeSegment.imageUrl}` : `seg-${activeSegmentIdx}`,
        url: activeSegment.imageUrl,
        name: `Segment #${activeSegmentIdx + 1}`,
        type: activeSegment.imageType || "image"
      };
    }
    // 2. Search backward from current time for nearest segment image/video to carry over during gaps
    for (let i = segments.length - 1; i >= 0; i--) {
      if (currentTime >= segments[i].start && segments[i].imageUrl) {
        return {
          id: segments[i].imageType === "video" ? `vid-${segments[i].imageUrl}` : `seg-${i}`,
          url: segments[i].imageUrl!,
          name: `Segment #${i + 1}`,
          type: segments[i].imageType || "image"
        };
      }
    }
    // 3. Fallback to first segment with an image
    for (let i = 0; i < segments.length; i++) {
      if (segments[i].imageUrl) {
        return {
          id: segments[i].imageType === "video" ? `vid-${segments[i].imageUrl}` : `seg-${i}`,
          url: segments[i].imageUrl!,
          name: `Segment #${i + 1}`,
          type: segments[i].imageType || "image"
        };
      }
    }
    // 4. Fallback to general images list
    if (images.length > 0 && audioDuration) {
      const img = images[activeImageIndex];
      if (img) {
        return {
          id: img.type === "video" ? `vid-${img.url}` : img.id,
          url: img.url,
          name: img.name,
          type: img.type || "image"
        };
      }
    }
    // 5. Fallback to global video URL if uploaded
    if (globalVideoUrl) {
      return {
        id: `global-vid-${globalVideoUrl}`,
        url: globalVideoUrl,
        name: "Video Source",
        type: "video" as const
      };
    }
    return null;
  })();

  // Determine active subtitle segment: strictly display subtitle only while speech is active
  // (using zero-latency activeSpeechSegIdx calculated above)

  // Calculate dynamic zoom scale for Option 1 (Zoom In) and Option 2 (Ken Burns Effect)
  const currentZoomScale = (() => {
    if (zoomMode === "none" || !audioDuration) return 1;

    const { slideStart, slideEnd, slideIndex } = getSlideBounds(
      activeSegmentIdx,
      segments,
      audioDuration,
      activeImageIndex,
      images
    );

    const slideDuration = Math.max(0.1, slideEnd - slideStart);
    const progress = Math.max(0, Math.min(1, (currentTime - slideStart) / slideDuration));
    
    if (zoomMode === "zoom-in") {
      // Smooth slow zoom in for every slide
      return 1 + progress * 0.15;
    } else if (zoomMode === "zoom-out") {
      // Smooth slow zoom out for every slide
      return 1.15 - progress * 0.15;
    } else if (zoomMode === "ken-burns") {
      // Alternating zoom directions (Ken Burns effect)
      const isEven = (slideIndex % 2 === 0);
      return isEven ? (1 + progress * 0.15) : (1.15 - progress * 0.15);
    }
    return 1;
  })();

  // Synchronize active preview video playback rate and position
  useEffect(() => {
    const video = previewVideoRef.current;
    if (!video) return;

    // Explicitly guarantee video is muted and volume is zero
    video.muted = true;
    video.volume = 0;

    const videoUrl = activeImage?.type === "video" ? activeImage.url : null;
    const rawDuration = video.duration;
    const videoDuration = (!rawDuration || isNaN(rawDuration) || !isFinite(rawDuration)) ? 5 : rawDuration;

    const { targetVideoTime } = getVideoTargetTimeForUrl(videoUrl, currentTime, segments, audioDuration, videoDuration);
    const targetSpeed = 1;

    // Set speed safely within standard ranges
    const safeSpeed = Math.max(0.0625, Math.min(16, targetSpeed));
    if (Math.abs(video.playbackRate - safeSpeed) > 0.02) {
      video.playbackRate = safeSpeed;
    }

    const videoUrlChanged = lastActiveVideoUrlRef.current !== videoUrl;
    const playStateChanged = lastIsPlayingRef.current !== isPlaying;

    lastActiveImageIdRef.current = activeImage?.id || null;
    lastActiveVideoUrlRef.current = videoUrl;
    lastIsPlayingRef.current = isPlaying;

    // Match audio play/pause status and handle seeking intelligently without decoder freezes
    if (isPlaying) {
      if (video.paused) {
        video.play().catch(() => {});
      }
      // Only seek video.currentTime if video URL changed, play state toggled, or drift exceeds 0.4s
      const drift = Math.abs(video.currentTime - targetVideoTime);
      if (videoUrlChanged || playStateChanged || drift > 0.4) {
        video.currentTime = targetVideoTime;
      }
    } else {
      if (!video.paused) {
        video.pause();
      }
      // If paused, keep high accuracy seek for interactive timeline sliding
      if (Math.abs(video.currentTime - targetVideoTime) > 0.05) {
        video.currentTime = targetVideoTime;
      }
    }
  }, [activeImage?.id, activeImage?.url, activeImage?.type, currentTime, isPlaying, audioDuration, activeSegmentIdx, activeImageIndex, images.length, segments, videoTrigger]);

  // Deterministic Canvas Frame Renderer for exact timestamp t (in seconds)
  const renderCanvasFrameAtTime = (
    time: number,
    ctx: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement
  ) => {
    // Fill Slate-900 background
    ctx.fillStyle = "#0f172a";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";

    const currentSegIdx = getMediaSegmentIdx(time, segments, audioDuration);
    const speechSegIdx = getActiveSpeechSegmentIdx(time, segments);
    const intervalTime = images.length > 0 && audioDuration ? (audioDuration / images.length) : 0;

    let activeImgEl: HTMLImageElement | null = null;
    let activeVideoEl: HTMLVideoElement | null = null;

    const isImgValid = (img: HTMLImageElement | null) => img && img.complete && img.naturalWidth > 0;
    const isVidValid = (v: HTMLVideoElement | null) => v && v.videoWidth > 0 && v.readyState >= 1;

    // 1. Check current segment
    if (currentSegIdx !== -1) {
      const seg = segments[currentSegIdx];
      if (seg && seg.imageUrl) {
        if (seg.imageType === "video") {
          const url = seg.imageUrl;
          const candidate = uniqueVideoElementsRef.current[url] || segmentVideoElementsRef.current[currentSegIdx] || videoElementsRef.current[url] || null;
          if (isVidValid(candidate)) {
            activeVideoEl = candidate;
          }
        } else {
          const img = segmentImageElementsRef.current[currentSegIdx] || imageElementsRef.current[seg.imageUrl];
          if (isImgValid(img)) {
            activeImgEl = img;
          }
        }
      }
    }

    // 2. If current segment has no valid/ready media, look backward to nearest preceding segment with valid media
    if (!activeImgEl && !activeVideoEl && currentSegIdx > 0) {
      for (let i = currentSegIdx - 1; i >= 0; i--) {
        const seg = segments[i];
        if (seg && seg.imageUrl) {
          if (seg.imageType === "video") {
            const url = seg.imageUrl;
            const candidate = uniqueVideoElementsRef.current[url] || segmentVideoElementsRef.current[i] || videoElementsRef.current[url] || null;
            if (isVidValid(candidate)) {
              activeVideoEl = candidate;
              break;
            }
          } else {
            const img = segmentImageElementsRef.current[i] || imageElementsRef.current[seg.imageUrl];
            if (isImgValid(img)) {
              activeImgEl = img;
              break;
            }
          }
        }
      }
    }

    // 3. Fallback to images list
    if (!activeImgEl && !activeVideoEl && images.length > 0 && intervalTime > 0) {
      const idx = Math.min(Math.floor(time / intervalTime), images.length - 1);
      const img = images[idx];
      if (img) {
        if (img.type === "video") {
          const candidate = uniqueVideoElementsRef.current[img.url] || videoElementsRef.current[img.id] || null;
          if (isVidValid(candidate)) {
            activeVideoEl = candidate;
          }
        } else {
          const imgEl = imageElementsRef.current[img.id];
          if (isImgValid(imgEl)) {
            activeImgEl = imgEl;
          }
        }
      }
    }

    // 4. Fallback to global video URL
    if (!activeImgEl && !activeVideoEl && globalVideoUrl) {
      const candidate = uniqueVideoElementsRef.current[globalVideoUrl] || globalVideoElementRef.current || previewVideoRef.current || null;
      if (isVidValid(candidate)) {
        activeVideoEl = candidate;
      }
    }

    // 5. Fallback to ANY segment video/image if available
    if (!activeImgEl && !activeVideoEl) {
      for (let i = 0; i < segments.length; i++) {
        const seg = segments[i];
        if (seg && seg.imageUrl) {
          if (seg.imageType === "video") {
            const candidate = uniqueVideoElementsRef.current[seg.imageUrl] || segmentVideoElementsRef.current[i] || videoElementsRef.current[seg.imageUrl] || null;
            if (isVidValid(candidate)) {
              activeVideoEl = candidate;
              break;
            }
          } else {
            const img = segmentImageElementsRef.current[i] || imageElementsRef.current[seg.imageUrl];
            if (isImgValid(img)) {
              activeImgEl = img;
              break;
            }
          }
        }
      }
    }

    if (activeVideoEl && activeVideoEl.videoWidth === 0) {
      if (previewVideoRef.current && previewVideoRef.current.videoWidth > 0) {
        activeVideoEl = previewVideoRef.current;
      } else if (globalVideoElementRef.current && globalVideoElementRef.current.videoWidth > 0) {
        activeVideoEl = globalVideoElementRef.current;
      }
    }

    let isReady = false;
    let mediaWidth = 0;
    let mediaHeight = 0;
    let elementToDraw: HTMLImageElement | HTMLVideoElement | null = null;

    if (activeImgEl) {
      isReady = activeImgEl.complete && activeImgEl.naturalWidth > 0;
      mediaWidth = activeImgEl.naturalWidth;
      mediaHeight = activeImgEl.naturalHeight;
      elementToDraw = activeImgEl;
    } else if (activeVideoEl) {
      isReady = activeVideoEl.videoWidth > 0 && activeVideoEl.readyState >= 1;
      mediaWidth = activeVideoEl.videoWidth > 0 ? activeVideoEl.videoWidth : 1280;
      mediaHeight = activeVideoEl.videoHeight > 0 ? activeVideoEl.videoHeight : 720;
      elementToDraw = activeVideoEl;

      const videoUrl = activeVideoEl.src || activeImage?.url || null;
      const rawVideoDuration = activeVideoEl.duration;
      const videoDuration = (!rawVideoDuration || isNaN(rawVideoDuration) || !isFinite(rawVideoDuration)) ? 5 : rawVideoDuration;

      const { targetVideoTime } = getVideoTargetTimeForUrl(videoUrl, time, segments, audioDuration, videoDuration);

      if (!isCompiling) {
        const drift = Math.abs(activeVideoEl.currentTime - targetVideoTime);
        if (!isPlaying && drift > 0.05) {
          activeVideoEl.currentTime = targetVideoTime;
        } else if (isPlaying && drift > 0.5) {
          activeVideoEl.currentTime = targetVideoTime;
        }
      }
    }

    // Initialize or check offscreen canvas memory buffer
    if (!lastCanvasFrameRef.current) {
      lastCanvasFrameRef.current = document.createElement("canvas");
    }
    const offscreen = lastCanvasFrameRef.current;
    if (offscreen.width !== canvas.width || offscreen.height !== canvas.height) {
      offscreen.width = canvas.width;
      offscreen.height = canvas.height;
      hasRenderedFrameRef.current = false;
    }
    const offCtx = offscreen.getContext("2d");

    if (elementToDraw && isReady) {
      try {
        const canvasRatio = canvas.width / canvas.height;
        const mediaRatio = mediaWidth / mediaHeight;
        let drawWidth = canvas.width;
        let drawHeight = canvas.height;
        let offsetX = 0;
        let offsetY = 0;

        if (mediaRatio > canvasRatio) {
          drawHeight = canvas.width / mediaRatio;
          offsetY = (canvas.height - drawHeight) / 2;
        } else {
          drawWidth = canvas.height * mediaRatio;
          offsetX = (canvas.width - drawWidth) / 2;
        }

        let activeImgIdx = 0;
        if (images.length > 0 && audioDuration) {
          const interval = audioDuration / images.length;
          activeImgIdx = Math.min(Math.floor(time / interval), images.length - 1);
        }

        const { slideStart, slideEnd, slideIndex } = getSlideBounds(
          currentSegIdx,
          segments,
          audioDuration,
          activeImgIdx,
          images
        );

        const slideDuration = Math.max(0.1, slideEnd - slideStart);
        const progress = Math.max(0, Math.min(1, (time - slideStart) / slideDuration));

        let compileScale = 1;
        if (zoomMode === "zoom-in") {
          compileScale = 1 + progress * 0.15;
        } else if (zoomMode === "zoom-out") {
          compileScale = 1.15 - progress * 0.15;
        } else if (zoomMode === "ken-burns") {
          const isEven = (slideIndex % 2 === 0);
          compileScale = isEven ? (1 + progress * 0.15) : (1.15 - progress * 0.15);
        }

        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";

        if (compileScale !== 1) {
          ctx.save();
          ctx.translate(canvas.width / 2, canvas.height / 2);
          ctx.scale(compileScale, compileScale);
          ctx.translate(-canvas.width / 2, -canvas.height / 2);
          ctx.drawImage(elementToDraw, offsetX, offsetY, drawWidth, drawHeight);
          ctx.restore();
        } else {
          ctx.drawImage(elementToDraw, offsetX, offsetY, drawWidth, drawHeight);
        }

        // Cache successful frame to offscreen canvas memory
        if (offCtx) {
          try {
            offCtx.clearRect(0, 0, offscreen.width, offscreen.height);
            offCtx.drawImage(canvas, 0, 0);
            hasRenderedFrameRef.current = true;
          } catch (e) {}
        }
      } catch (err) {
        if (hasRenderedFrameRef.current && offscreen) {
          try { ctx.drawImage(offscreen, 0, 0); } catch (e) {}
        } else {
          ctx.fillStyle = "rgba(15, 23, 42, 0.9)";
          ctx.fillRect(50, 50, canvas.width - 100, canvas.height - 100);
        }
      }
    } else {
      // Fallback to last rendered valid frame from offscreen memory to prevent ANY black screens
      if (hasRenderedFrameRef.current && offscreen) {
        try {
          ctx.drawImage(offscreen, 0, 0);
        } catch (e) {
          ctx.fillStyle = "#0f172a";
          ctx.fillRect(0, 0, canvas.width, canvas.height);
        }
      } else {
        ctx.fillStyle = "#1e293b";
        ctx.fillRect(100, 100, canvas.width - 200, canvas.height - 200);
        ctx.fillStyle = "#475569";
        ctx.font = "20px sans-serif";
        ctx.textAlign = "center";
        ctx.fillText("Ready to render synced media...", canvas.width / 2, canvas.height / 2);
      }
    }

    // Subtitles
    if (showSubtitles) {
      const seg = speechSegIdx !== -1 ? segments[speechSegIdx] : null;
      if (seg && seg.text) {
        // Calculate dynamic font scale multiplier (1.0 for 720p, 1.5 for 1080p)
        const scale = Math.min(canvas.width, canvas.height) / 720;

        if (subtitleStyle === "classic") {
          const fontSize = Math.round(24 * scale);
          ctx.font = `600 ${fontSize}px sans-serif`;
          const maxW = canvas.width - Math.round(120 * scale);
          const lines = wrapCanvasText(ctx, seg.text, maxW);
          const lineHeight = Math.round(34 * scale);
          const paddingY = Math.round(16 * scale);
          const boxHeight = lines.length * lineHeight + paddingY;
          let maxLineWidth = 0;
          lines.forEach((l) => {
            const w = ctx.measureText(l).width;
            if (w > maxLineWidth) maxLineWidth = w;
          });
          const boxWidth = Math.min(canvas.width - Math.round(80 * scale), maxLineWidth + Math.round(40 * scale));
          const boxX = (canvas.width - boxWidth) / 2;
          const boxY = canvas.height - Math.round(40 * scale) - boxHeight;

          ctx.fillStyle = "rgba(15, 23, 42, 0.88)";
          ctx.beginPath();
          if (ctx.roundRect) {
            ctx.roundRect(boxX, boxY, boxWidth, boxHeight, Math.round(10 * scale));
          } else {
            ctx.rect(boxX, boxY, boxWidth, boxHeight);
          }
          ctx.fill();

          ctx.fillStyle = "#ffffff";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          lines.forEach((line, idx) => {
            const lineY = boxY + paddingY / 2 + lineHeight / 2 + idx * lineHeight;
            ctx.fillText(line, canvas.width / 2, lineY);
          });
        } else if (subtitleStyle === "cinematic-yellow") {
          const fontSize = Math.round(28 * scale);
          ctx.font = `bold ${fontSize}px sans-serif`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          const maxW = canvas.width - Math.round(100 * scale);
          const lines = wrapCanvasText(ctx, seg.text, maxW);
          const lineHeight = Math.round(38 * scale);
          const startY = canvas.height - Math.round(50 * scale) - (lines.length - 1) * lineHeight;

          lines.forEach((line, idx) => {
            const lineY = startY + idx * lineHeight;
            ctx.strokeStyle = "black";
            ctx.lineWidth = Math.round(6 * scale);
            ctx.strokeText(line, canvas.width / 2, lineY);
            ctx.fillStyle = "#facc15";
            ctx.fillText(line, canvas.width / 2, lineY);
          });
        } else if (subtitleStyle === "bold-outline") {
          const fontSize = Math.round(32 * scale);
          ctx.font = `italic 900 ${fontSize}px sans-serif`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          const upperText = seg.text.toUpperCase();
          const maxW = canvas.width - Math.round(100 * scale);
          const lines = wrapCanvasText(ctx, upperText, maxW);
          const lineHeight = Math.round(42 * scale);
          const startY = canvas.height - Math.round(50 * scale) - (lines.length - 1) * lineHeight;

          lines.forEach((line, idx) => {
            const lineY = startY + idx * lineHeight;
            ctx.strokeStyle = "black";
            ctx.lineWidth = Math.round(8 * scale);
            ctx.strokeText(line, canvas.width / 2, lineY);
            ctx.fillStyle = "#ffffff";
            ctx.fillText(line, canvas.width / 2, lineY);
          });
        } else if (subtitleStyle === "minimal-accent") {
          const fontSize = Math.round(22 * scale);
          ctx.font = `600 ${fontSize}px sans-serif`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          const maxW = canvas.width - Math.round(140 * scale);
          const lines = wrapCanvasText(ctx, seg.text, maxW);
          const lineHeight = Math.round(32 * scale);
          const paddingY = Math.round(16 * scale);
          const boxHeight = lines.length * lineHeight + paddingY;
          let maxLineWidth = 0;
          lines.forEach((l) => {
            const w = ctx.measureText(l).width;
            if (w > maxLineWidth) maxLineWidth = w;
          });
          const boxWidth = Math.min(canvas.width - Math.round(100 * scale), maxLineWidth + Math.round(50 * scale));
          const boxX = (canvas.width - boxWidth) / 2;
          const boxY = canvas.height - Math.round(40 * scale) - boxHeight;

          ctx.fillStyle = "rgba(9, 15, 30, 0.92)";
          ctx.beginPath();
          if (ctx.roundRect) {
            ctx.roundRect(boxX, boxY, boxWidth, boxHeight, [0, Math.round(8 * scale), Math.round(8 * scale), 0]);
          } else {
            ctx.rect(boxX, boxY, boxWidth, boxHeight);
          }
          ctx.fill();

          ctx.fillStyle = "#6366f1";
          ctx.fillRect(boxX, boxY, Math.round(6 * scale), boxHeight);

          ctx.fillStyle = "#f1f5f9";
          lines.forEach((line, idx) => {
            const lineY = boxY + paddingY / 2 + lineHeight / 2 + idx * lineHeight;
            ctx.fillText(line, canvas.width / 2 + 3, lineY);
          });
        } else if (subtitleStyle === "news-banner") {
          const fontSize = Math.round(22 * scale);
          ctx.font = `500 ${fontSize}px sans-serif`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          const maxW = canvas.width - Math.round(80 * scale);
          const lines = wrapCanvasText(ctx, seg.text, maxW);
          const lineHeight = Math.round(34 * scale);
          const bannerHeight = Math.max(Math.round(76 * scale), lines.length * lineHeight + Math.round(24 * scale));
          const bannerY = canvas.height - bannerHeight;

          const grad = ctx.createLinearGradient(0, bannerY, canvas.width, bannerY);
          grad.addColorStop(0, "rgba(30, 58, 138, 0.95)");
          grad.addColorStop(0.5, "rgba(49, 46, 129, 0.98)");
          grad.addColorStop(1, "rgba(15, 23, 42, 0.95)");
          ctx.fillStyle = grad;
          ctx.fillRect(0, bannerY, canvas.width, bannerHeight);

          ctx.fillStyle = "#6366f1";
          ctx.fillRect(0, bannerY, canvas.width, Math.round(3 * scale));

          ctx.fillStyle = "#ffffff";
          const startY = bannerY + (bannerHeight - (lines.length - 1) * lineHeight) / 2;
          lines.forEach((line, idx) => {
            ctx.fillText(line, canvas.width / 2, startY + idx * lineHeight);
          });
        }
      }
    }

    // Watermark
    const wmScale = Math.min(canvas.width, canvas.height) / 720;
    ctx.fillStyle = "rgba(255, 255, 255, 0.4)";
    ctx.font = `500 ${Math.round(14 * wmScale)}px monospace`;
    ctx.textAlign = "right";
    ctx.fillText("Synced Video", canvas.width - Math.round(30 * wmScale), Math.round(30 * wmScale));
  };

  // Trigger server-side background FFmpeg export pipeline
  const handleExportVideo = async () => {
    const audio = playbackRef.current;
    const hasAnyImage = images.length > 0 || segments.some((s) => !!s.imageUrl) || !!globalVideoUrl;
    if (!audioUrl || !hasAnyImage) return;

    if (audio) {
      audio.pause();
      setIsPlaying(false);
    }
    setIsExportModalOpen(true);
  };

  const formatTime = (time: number) => {
    const mins = Math.floor(time / 60);
    const secs = Math.floor(time % 60);
    return `${mins}:${secs < 10 ? "0" : ""}${secs}`;
  };

  const containerWidth = aspectRatio === "9:16" ? "720px" : "1280px";
  const containerHeight = aspectRatio === "9:16" ? "1280px" : "720px";

  const uniqueVideoUrls = Array.from(
    new Set([
      ...(globalVideoUrl ? [globalVideoUrl] : []),
      ...images.filter((i) => i.type === "video").map((i) => i.url),
      ...segments.filter((s) => s.imageType === "video" && s.imageUrl).map((s) => s.imageUrl!)
    ])
  );

  return (
    <div className="bg-slate-900 text-white rounded-2xl border border-slate-800 shadow-xl p-6 space-y-6 flex flex-col h-full" ref={containerRef}>
      
      {/* Invisible DOM container (in-viewport, near-zero opacity, active and layer-ordered behind everything) to bypass browser background throttling and ensure frames render smoothly at full speed */}
      <div style={{ position: "fixed", top: "0px", left: "0px", width: "1px", height: "1px", overflow: "hidden", opacity: 0.1, zIndex: -1, pointerEvents: "none" }}>
        {uniqueVideoUrls.map((url) => (
          <video
            key={`unique-vid-${url}`}
            ref={(el) => {
              if (el) {
                uniqueVideoElementsRef.current[url] = el;
                if (url === globalVideoUrl) {
                  globalVideoElementRef.current = el;
                }
              }
            }}
            src={url}
            muted
            playsInline
            preload="auto"
            crossOrigin={url.startsWith("blob:") ? undefined : "anonymous"}
            style={{ width: containerWidth, height: containerHeight, objectFit: "contain" }}
          />
        ))}
        {images.map((img) => (
          img.type === "video" ? (
            <video
              key={img.id}
              ref={(el) => {
                if (el) videoElementsRef.current[img.id] = el;
              }}
              src={img.url}
              muted
              playsInline
              preload="auto"
              crossOrigin={img.url.startsWith("blob:") || img.url.startsWith("data:") ? undefined : "anonymous"}
              style={{ width: containerWidth, height: containerHeight, objectFit: "contain" }}
            />
          ) : (
            <img
              key={img.id}
              ref={(el) => {
                if (el) imageElementsRef.current[img.id] = el;
              }}
              src={getSafeImageUrl(img.url)}
              alt={img.name}
              crossOrigin={img.url.startsWith("blob:") || img.url.startsWith("data:") ? undefined : "anonymous"}
            />
          )
        ))}
        {segments.map((seg, idx) => {
          if (!seg.imageUrl) return null;
          return seg.imageType === "video" ? (
            <video
              key={`seg-vid-${idx}`}
              ref={(el) => {
                if (el) segmentVideoElementsRef.current[idx] = el;
              }}
              src={seg.imageUrl}
              muted
              playsInline
              preload="auto"
              crossOrigin={seg.imageUrl.startsWith("blob:") || seg.imageUrl.startsWith("data:") ? undefined : "anonymous"}
              style={{ width: containerWidth, height: containerHeight, objectFit: "contain" }}
            />
          ) : (
            <img
              key={`seg-img-${idx}`}
              ref={(el) => {
                if (el) segmentImageElementsRef.current[idx] = el;
              }}
              src={getSafeImageUrl(seg.imageUrl)}
              alt=""
              crossOrigin={seg.imageUrl.startsWith("blob:") || seg.imageUrl.startsWith("data:") ? undefined : "anonymous"}
            />
          );
        })}
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between border-b border-slate-800 pb-3 gap-3">
        <h2 className="text-xl font-display font-semibold flex items-center gap-2">
          <Film className="w-5 h-5 text-blue-400 animate-pulse" />
          3. Synced Video Player
        </h2>
        <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto justify-between sm:justify-end">
          {/* Zoom Option Toggle */}
          <button
            onClick={() => {
              if (zoomMode === "none") {
                setZoomMode("zoom-in");
              } else if (zoomMode === "zoom-in") {
                setZoomMode("zoom-out");
              } else if (zoomMode === "zoom-out") {
                setZoomMode("ken-burns");
              } else {
                setZoomMode("none");
              }
            }}
            className={`p-1.5 rounded-lg border text-xs flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 ${
              zoomMode === "zoom-in"
                ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400 font-medium"
                : zoomMode === "zoom-out"
                ? "bg-purple-500/10 border-purple-500/30 text-purple-400 font-medium"
                : zoomMode === "ken-burns"
                ? "bg-indigo-500/10 border-indigo-500/30 text-indigo-400 font-medium"
                : "bg-slate-800 border-slate-700 text-slate-400 hover:text-slate-200"
            }`}
            title="Toggle Dynamic Zoom Modes (Zoom In / Zoom Out / Ken Burns / Off)"
          >
            <Film className="w-4 h-4" />
            Zoom: {
              zoomMode === "zoom-in" ? "Zoom In 🔍" :
              zoomMode === "zoom-out" ? "Zoom Out 🔎" :
              zoomMode === "ken-burns" ? "Ken Burns 🎬" : "Off 🚫"
            }
          </button>

          {showSubtitles && (
            <div className="flex items-center bg-slate-900/80 border border-slate-800 rounded-lg p-0.5 gap-1 shadow-sm shrink-0">
              <span className="text-[10px] text-slate-400 pl-1.5 pr-0.5 font-bold uppercase tracking-wider select-none whitespace-nowrap">Style:</span>
              <select
                value={subtitleStyle}
                onChange={(e) => setSubtitleStyle(e.target.value as any)}
                className="bg-slate-950 border border-slate-800 text-[11px] text-slate-200 rounded px-2 py-1 focus:ring-1 focus:ring-blue-500 focus:outline-none cursor-pointer font-medium font-sans"
              >
                <option value="classic">Classic Slate</option>
                <option value="cinematic-yellow">Cinema Yellow 🎬</option>
                <option value="bold-outline">Bold Outline 🔥</option>
                <option value="minimal-accent">Minimal Accent ✨</option>
                <option value="news-banner">News Banner 📰</option>
              </select>
            </div>
          )}

          {/* Format / Aspect Ratio Option */}
          <div className="flex items-center bg-slate-900/80 border border-slate-800 rounded-lg p-0.5 gap-1 shadow-sm shrink-0">
            <span className="text-[10px] text-slate-400 pl-1.5 pr-0.5 font-bold uppercase tracking-wider select-none whitespace-nowrap">Format:</span>
            <select
              value={aspectRatio}
              onChange={(e) => setAspectRatio(e.target.value as "16:9" | "9:16")}
              className="bg-slate-950 border border-slate-800 text-[11px] text-slate-200 rounded px-2 py-1 focus:ring-1 focus:ring-blue-500 focus:outline-none cursor-pointer font-medium font-sans"
            >
              <option value="16:9">YouTube (16:9) 📺</option>
              <option value="9:16">Shorts (9:16) 📱</option>
            </select>
          </div>

          {/* Quality / Resolution Option */}
          <div className="flex items-center bg-slate-900/80 border border-slate-800 rounded-lg p-0.5 gap-1 shadow-sm shrink-0">
            <span className="text-[10px] text-slate-400 pl-1.5 pr-0.5 font-bold uppercase tracking-wider select-none whitespace-nowrap">Quality:</span>
            <select
              value={exportResolution}
              onChange={(e) => setExportResolution(e.target.value as "720p" | "1080p")}
              className="bg-slate-950 border border-slate-800 text-[11px] text-slate-200 rounded px-2 py-1 focus:ring-1 focus:ring-blue-500 focus:outline-none cursor-pointer font-medium font-sans"
            >
              <option value="1080p">1080p Full HD 🌟</option>
              <option value="720p">720p HD ⚡</option>
            </select>
          </div>

          <button
            onClick={() => setShowSubtitles(!showSubtitles)}
            className={`p-1.5 rounded-lg border text-xs flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 ${
              showSubtitles 
                ? "bg-blue-500/10 border-blue-500/30 text-blue-400" 
                : "bg-slate-800 border-slate-700 text-slate-400 hover:text-slate-200"
            }`}
            title="Toggle Subtitles"
          >
            <Subtitles className="w-4 h-4" />
            CC
          </button>
        </div>
      </div>

      {/* Centered viewbox container to handle vertical layout beautifully */}
      <div className="w-full flex justify-center items-center py-2 bg-slate-950/40 rounded-xl border border-slate-800/30">
        {/* Main Video View Box */}
        <div className={`relative rounded-xl overflow-hidden bg-slate-950 border border-slate-800 flex items-center justify-center shadow-inner group transition-all duration-300 ${
          aspectRatio === "9:16" 
            ? "h-[500px] aspect-[9/16] w-auto max-w-full" 
            : "w-full aspect-video"
        }`}>
        
        {/* Render Active Image/Video inside Framer Motion AnimatePresence */}
        <div className="absolute inset-0 flex items-center justify-center overflow-hidden">
          {/* We do NOT use mode="wait" to allow elegant concurrent crossfade, which completely avoids */}
          {/* black flashes/delays, keeping slides perfectly aligned and synchronized with playhead ticks. */}
          <AnimatePresence>
            {activeImage ? (
              activeImage.type === "video" ? (
                <motion.div
                  key={activeImage.id}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="absolute inset-0 w-full h-full flex items-center justify-center"
                >
                  <video
                    ref={previewVideoRef}
                    src={activeImage.url}
                    muted
                    playsInline
                    onLoadedMetadata={() => setVideoTrigger((prev) => prev + 1)}
                    style={{ transform: `scale(${currentZoomScale})` }}
                    className="w-full h-full object-contain"
                  />
                </motion.div>
              ) : (
                <motion.div
                  key={activeImage.id}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="absolute inset-0 w-full h-full flex items-center justify-center overflow-hidden"
                >
                  <img
                    src={getSafeImageUrl(activeImage.url)}
                    alt={activeImage.name}
                    style={{
                      transform: `scale(${currentZoomScale})`,
                      transformOrigin: "center center",
                      transition: "none",
                      willChange: "transform"
                    }}
                    className="w-full h-full object-contain"
                    referrerPolicy="no-referrer"
                  />
                </motion.div>
              )
            ) : (
              <div className="text-slate-500 text-center space-y-2 p-6">
                <Film className="w-10 h-10 mx-auto text-slate-700" />
                <p className="text-sm font-medium">Automatic Video Sync Preview</p>
                <p className="text-xs text-slate-600 max-w-xs leading-relaxed">
                  Upload audio and multiple images/videos. They will automatically align themselves to make a beautiful synchronized video here!
                </p>
              </div>
            )}
          </AnimatePresence>
        </div>

        {/* Subtitles Overlay */}
        {showSubtitles && activeSubtitle && (
          <div className={subtitleStyle === "news-banner" ? "absolute inset-x-0 bottom-0 z-10 text-center" : "absolute bottom-6 left-6 right-6 text-center z-10"}>
            {subtitleStyle === "classic" && (
              <div className="inline-block bg-slate-950/80 backdrop-blur-sm border border-white/5 text-white px-4 py-2 rounded-lg text-sm font-medium max-w-[85%] mx-auto shadow-md animate-fade-in">
                {activeSubtitle.text}
              </div>
            )}
            {subtitleStyle === "cinematic-yellow" && (
              <div 
                className="inline-block text-yellow-400 px-4 py-2 text-base font-bold tracking-wide max-w-[85%] mx-auto drop-shadow-[0_2px_4px_rgba(0,0,0,1)] uppercase select-none font-sans"
                style={{ textShadow: "2px 2px 0px #000, -2px -2px 0px #000, 2px -2px 0px #000, -2px 2px 0px #000" }}
              >
                {activeSubtitle.text}
              </div>
            )}
            {subtitleStyle === "bold-outline" && (
              <div 
                className="inline-block text-white px-4 py-1.5 text-lg font-extrabold tracking-wider max-w-[85%] mx-auto uppercase drop-shadow-[0_3px_5px_rgba(0,0,0,1.0)] font-sans italic"
                style={{ textShadow: "3px 3px 0px #000, -3px -3px 0px #000, 3px -3px 0px #000, -3px 3px 0px #000" }}
              >
                {activeSubtitle.text}
              </div>
            )}
            {subtitleStyle === "minimal-accent" && (
              <div className="inline-flex items-center gap-2 bg-slate-950/90 border-l-4 border-indigo-500 text-slate-100 px-4 py-2 rounded-r-md text-xs font-semibold tracking-wide max-w-[85%] mx-auto shadow-lg">
                <span>{activeSubtitle.text}</span>
              </div>
            )}
            {subtitleStyle === "news-banner" && (
              <div className="w-full bg-gradient-to-r from-blue-900/95 via-indigo-950/95 to-slate-900/95 border-t border-indigo-500/30 text-white px-6 py-3 text-xs font-medium tracking-wide">
                {activeSubtitle.text}
              </div>
            )}
          </div>
        )}

        {/* Audio Element */}
        {audioUrl && (
          <audio
            ref={playbackRef}
            src={audioUrl}
            onPlay={handleAudioPlay}
            onPause={handleAudioPause}
            onEnded={handleAudioEnded}
            onTimeUpdate={handleTimeUpdate}
            onLoadedMetadata={syncDurationFromAudio}
            onDurationChange={syncDurationFromAudio}
            className="hidden"
          />
        )}
      </div>
    </div>

      {/* Dynamic Segment Map (Visual Representation of Syncing) */}
      {images.length > 0 && audioDuration && (
        <div className="space-y-1.5">
          <div className="flex justify-between items-center">
            <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">
              Timeline Blocks ({images.length} Slides)
            </span>
            <span className="text-[10px] text-slate-500 font-mono">
              Each: {(audioDuration / images.length).toFixed(1)}s
            </span>
          </div>
          
          {/* Segment Blocks */}
          <div className="grid h-2 bg-slate-800 rounded-full overflow-hidden gap-0.5" style={{ gridTemplateColumns: `repeat(${images.length}, 1fr)` }}>
            {images.map((img, idx) => {
              const isActive = idx === activeImageIndex;
              return (
                <div
                  key={img.id}
                  onClick={() => {
                    const blockStart = (audioDuration / images.length) * idx;
                    onTimeUpdate(blockStart);
                    if (playbackRef.current) {
                      playbackRef.current.currentTime = blockStart;
                    }
                  }}
                  className={`h-full cursor-pointer transition-colors ${
                    isActive 
                      ? "bg-blue-400 hover:bg-blue-300" 
                      : "bg-slate-700 hover:bg-slate-600"
                  }`}
                  title={`Slide #${idx + 1}: ${img.name}`}
                />
              );
            })}
          </div>

          {/* Quick thumbnail strip beneath timeline map */}
          <div className="flex gap-1.5 overflow-x-auto py-1 scrollbar-thin">
            {images.map((img, idx) => {
              const isActive = idx === activeImageIndex;
              return (
                <button
                  key={img.id}
                  onClick={() => {
                    const blockStart = (audioDuration / images.length) * idx;
                    onTimeUpdate(blockStart);
                    if (playbackRef.current) {
                      playbackRef.current.currentTime = blockStart;
                    }
                  }}
                  className={`w-9 h-9 rounded-md overflow-hidden relative shrink-0 border-2 transition-all ${
                    isActive 
                      ? "border-blue-400 scale-105" 
                      : "border-transparent opacity-60 hover:opacity-100"
                  }`}
                >
                  <img src={img.url} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                  <span className="absolute bottom-0 right-0 bg-slate-900/80 text-[8px] px-0.5 rounded-tl font-mono">
                    #{idx + 1}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Control Actions / Playback controls */}
      <div className="space-y-4">
        
        {/* Seek slider */}
        <div className="flex items-center gap-3">
          <span className="font-mono text-xs text-slate-400 w-8 text-right">
            {formatTime(currentTime)}
          </span>
          <input
            type="range"
            min={0}
            max={audioDuration || 0}
            step={0.05}
            value={currentTime}
            onChange={handleSeek}
            disabled={!audioUrl}
            className="flex-1 h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            id="video-seek-bar"
          />
          <span className="font-mono text-xs text-slate-400 w-8">
            {formatTime(audioDuration || 0)}
          </span>
        </div>

        {/* Action Buttons Row */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex items-center justify-between sm:justify-start gap-4 w-full sm:w-auto">
            
            {/* Play Button */}
            <button
              onClick={togglePlay}
              disabled={!audioUrl}
              className={`w-12 h-12 rounded-full flex items-center justify-center shrink-0 transition-all ${
                audioUrl 
                  ? "bg-blue-500 hover:bg-blue-600 text-white scale-100 active:scale-95 shadow-lg" 
                  : "bg-slate-800 text-slate-600 cursor-not-allowed"
              }`}
              id="video-play-btn"
              title={isPlaying ? "Pause" : "Play Synced Video"}
            >
              {isPlaying ? (
                <Pause className="w-5 h-5 fill-current text-white" />
              ) : (
                <Play className="w-5 h-5 fill-current text-white translate-x-0.5" />
              )}
            </button>

            {/* Volume controls */}
            <div className="flex items-center gap-2">
              <button
                onClick={toggleMute}
                disabled={!audioUrl}
                className="text-slate-400 hover:text-white transition-colors shrink-0"
                title={isMuted ? "Unmute" : "Mute"}
              >
                {isMuted ? <VolumeX className="w-4.5 h-4.5" /> : <Volume2 className="w-4.5 h-4.5" />}
              </button>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={isMuted ? 0 : volume}
                onChange={handleVolumeChange}
                disabled={!audioUrl}
                className="w-20 sm:w-16 h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer"
              />
            </div>
          </div>

          {/* Compile and Download Button */}
          <button
            onClick={handleExportVideo}
            disabled={!audioUrl || (!images.length && !segments.some((s) => !!s.imageUrl)) || isCompiling}
            className={`flex items-center justify-center gap-2 font-medium px-5 py-2.5 rounded-xl text-sm transition-all w-full sm:w-auto whitespace-nowrap shrink-0 ${
              audioUrl && (images.length > 0 || segments.some((s) => !!s.imageUrl)) && !isCompiling
                ? "bg-indigo-600 hover:bg-indigo-700 text-white shadow-lg active:scale-98"
                : "bg-slate-800 text-slate-500 cursor-not-allowed"
            }`}
            id="export-video-btn"
          >
            <Download className="w-4 h-4" />
            Compile & Download MP4
          </button>
        </div>
      </div>

      {/* Compiling / Export progress overlay modal */}
      {(isCompiling || compileError) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/85 backdrop-blur-sm p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-6 text-center space-y-4 shadow-2xl">
            {compileError ? (
              <>
                <div className="w-14 h-14 rounded-full bg-red-500/10 flex items-center justify-center mx-auto text-red-400">
                  <X className="w-7 h-7" />
                </div>
                
                <div className="space-y-1">
                  <h3 className="text-lg font-display font-semibold text-white">
                    Compilation Failed
                  </h3>
                  <p className="text-xs text-red-400 leading-relaxed">
                    {compileError}
                  </p>
                </div>

                <div className="pt-2">
                  <button
                    onClick={() => {
                      setCompileError(null);
                      setIsCompiling(false);
                    }}
                    className="w-full bg-red-600 hover:bg-red-700 text-white font-medium py-2 rounded-xl text-sm transition-colors"
                  >
                    Close
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="w-14 h-14 rounded-full bg-indigo-500/10 flex items-center justify-center mx-auto text-indigo-400">
                  <Loader className="w-7 h-7 animate-spin" />
                </div>
                
                <div className="space-y-1">
                  <h3 className="text-lg font-display font-semibold text-white">
                    Compiling Synced Video...
                  </h3>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    We are capturing your canvas and embedding subtitles + audio stream into a downloadable video file. Please keep this browser window open.
                  </p>
                </div>

                {/* Progress bar */}
                <div className="space-y-1">
                  <div className="flex justify-between text-xs font-mono text-slate-500">
                    <span>{compileStatus}</span>
                    <span>{compileProgress}%</span>
                  </div>
                  <div className="h-2 w-full bg-slate-800 rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-indigo-500 transition-all duration-150" 
                      style={{ width: `${compileProgress}%` }}
                    />
                  </div>
                </div>

                <div className="pt-2">
                  <span className="inline-block px-3 py-1 bg-slate-850 border border-slate-800 rounded-full text-[10px] font-mono text-slate-400">
                    MPEG-4/WebM Sync Engine Active
                  </span>
                </div>
              </>
            )}
          </div>
        </div>
      )}
      {/* Server-Side FFmpeg Export Modal */}
      <ExportModal
        isOpen={isExportModalOpen}
        onClose={() => setIsExportModalOpen(false)}
        audioFile={audioFile || null}
        audioUrl={audioUrl}
        globalVideoUrl={globalVideoUrl}
        images={images}
        segments={segments}
        config={{
          aspectRatio,
          exportResolution: exportResolution === "1080p" ? "1080p" : "720p",
          zoomMode,
          subtitleStyle,
          showSubtitles,
          audioDuration: audioDuration || 0,
          segments
        }}
      />
    </div>
  );
}
