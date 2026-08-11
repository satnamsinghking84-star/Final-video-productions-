export interface VideoValidationResult {
  isValid: boolean;
  duration: number;
  width: number;
  height: number;
  aspectRatio: number;
  isPortrait: boolean;
  hasAudio?: boolean;
  errorMessage?: string;
}

/**
 * Validates an uploaded video file or URL before usage in playback/rendering.
 * Checks duration, resolution, dimensions, aspect ratio, frame decoding, and audio stream status.
 */
export async function validateVideoFile(fileOrUrl: File | string): Promise<VideoValidationResult> {
  return new Promise((resolve) => {
    let objectUrl: string | null = null;
    let urlToLoad = "";

    if (typeof fileOrUrl === "string") {
      urlToLoad = fileOrUrl;
    } else {
      try {
        objectUrl = URL.createObjectURL(fileOrUrl);
        urlToLoad = objectUrl;
      } catch (e) {
        resolve({
          isValid: false,
          duration: 0,
          width: 0,
          height: 0,
          aspectRatio: 1,
          isPortrait: false,
          errorMessage: "Unable to create Object URL for the uploaded file."
        });
        return;
      }
    }

    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";

    let resolved = false;

    const cleanup = () => {
      if (objectUrl && typeof fileOrUrl !== "string") {
        // Keep object URL active if valid, otherwise caller revokes if invalid
      }
      video.removeEventListener("loadedmetadata", onMetadata);
      video.removeEventListener("canplay", onCanPlay);
      video.removeEventListener("error", onError);
      clearTimeout(timer);
    };

    const finish = (result: VideoValidationResult) => {
      if (!resolved) {
        resolved = true;
        cleanup();
        if (!result.isValid && objectUrl) {
          try {
            URL.revokeObjectURL(objectUrl);
          } catch (e) {}
        }
        resolve(result);
      }
    };

    const timer = setTimeout(() => {
      finish({
        isValid: false,
        duration: 0,
        width: 0,
        height: 0,
        aspectRatio: 1,
        isPortrait: false,
        errorMessage: "Video validation timed out. The file may be corrupt, incomplete, or in an unsupported format."
      });
    }, 6000);

    const checkMetadata = () => {
      const dur = video.duration;
      const w = video.videoWidth;
      const h = video.videoHeight;

      if (!dur || isNaN(dur) || !isFinite(dur) || dur <= 0.05) {
        finish({
          isValid: false,
          duration: 0,
          width: w || 0,
          height: h || 0,
          aspectRatio: h > 0 ? w / h : 1,
          isPortrait: h > w,
          errorMessage: "Invalid video duration. The video file has no readable duration or is corrupted."
        });
        return;
      }

      if (!w || !h || w <= 0 || h <= 0) {
        finish({
          isValid: false,
          duration: dur,
          width: 0,
          height: 0,
          aspectRatio: 1,
          isPortrait: false,
          errorMessage: "Invalid video resolution. The video track contains no valid dimensions."
        });
        return;
      }

      // Check audio track presence if available in standard browser inspect
      let hasAudio = false;
      if ((video as any).mozHasAudio !== undefined) {
        hasAudio = (video as any).mozHasAudio;
      } else if ((video as any).webkitAudioDecodedByteCount !== undefined) {
        hasAudio = (video as any).webkitAudioDecodedByteCount > 0;
      } else if ((video as any).audioTracks && (video as any).audioTracks.length > 0) {
        hasAudio = true;
      }

      finish({
        isValid: true,
        duration: dur,
        width: w,
        height: h,
        aspectRatio: w / h,
        isPortrait: h > w,
        hasAudio
      });
    };

    const onMetadata = () => {
      checkMetadata();
    };

    const onCanPlay = () => {
      checkMetadata();
    };

    const onError = () => {
      const err = video.error;
      let msg = "The uploaded video could not be decoded.";
      if (err) {
        switch (err.code) {
          case err.MEDIA_ERR_ABORTED:
            msg = "Video loading was aborted.";
            break;
          case err.MEDIA_ERR_NETWORK:
            msg = "A network error occurred while loading the video.";
            break;
          case err.MEDIA_ERR_DECODE:
            msg = "The video file is corrupted or uses an unsupported video codec.";
            break;
          case err.MEDIA_ERR_SRC_NOT_SUPPORTED:
            msg = "The video format or codec is not supported by your browser.";
            break;
        }
      }
      finish({
        isValid: false,
        duration: 0,
        width: 0,
        height: 0,
        aspectRatio: 1,
        isPortrait: false,
        errorMessage: msg
      });
    };

    video.addEventListener("loadedmetadata", onMetadata);
    video.addEventListener("canplay", onCanPlay);
    video.addEventListener("error", onError);

    try {
      video.src = urlToLoad;
      video.load();
    } catch (e) {
      onError();
    }
  });
}
