export interface TranscribeSegment {
  start: number; // in seconds
  end: number; // in seconds
  text: string;
  imageUrl?: string; // Image specific to this timestamp segment
  image_url?: string; // Alias for backend time-scribe data
  imageType?: "image" | "video";
  subject?: string;
  action?: string;
  keywords?: string;
  query?: string;
}

export interface UploadedImage {
  id: string;
  url: string; // ObjectURL or data URL for rendering
  name: string;
  size: number;
  type?: "image" | "video";
}

export interface SyncSegment {
  imageId: string; // ID of the image displayed during this time
  start: number; // in seconds
  end: number; // in seconds
}

export interface VideoPartInfo {
  partIndex: number;
  partName: string;
  startTime: number;
  endTime: number;
  duration: number;
  status: "queued" | "processing" | "completed" | "failed";
  progress: number;
  downloadUrl?: string;
}

export interface ExportJobConfig {
  aspectRatio: "16:9" | "9:16" | "source";
  exportResolution: "1080p" | "720p" | "source";
  zoomMode: "none" | "zoom-in" | "zoom-out" | "ken-burns";
  subtitleStyle: "classic" | "cinematic-yellow" | "bold-outline" | "minimal-accent" | "news-banner";
  showSubtitles: boolean;
  audioDuration: number;
  segments: TranscribeSegment[];
  partDurationSeconds?: number; // Part chunk size (e.g., 60 seconds per part, or 0 for single piece)
}

export interface VerificationReport {
  inputResolution: string;
  outputResolution: string;
  inputFps: number;
  outputFps: number;
  inputDuration: number;
  outputDuration: number;
  inputAudioSampleRate: number;
  outputAudioSampleRate: number;
  inputAudioChannels: number;
  outputAudioChannels: number;
  videoCodec: string;
  audioCodec: string;
  bitrateQuality: string;
  subtitleTimingVerified: boolean;
  audioVideoSyncVerified: boolean;
  exportTimeSeconds: number;
}

export interface ExportJobStatus {
  jobId: string;
  status: "queued" | "uploading" | "processing" | "paused" | "completed" | "failed" | "cancelled";
  progress: number;
  processedSeconds: number;
  totalSeconds: number;
  speed: number;
  etaSeconds: number;
  error?: string;
  downloadUrl?: string;
  verification?: VerificationReport;
  parts?: VideoPartInfo[];
}

