import React, { useState, useRef } from "react";
import { Image as ImageIcon, Trash2, ChevronUp, ChevronDown, Plus, Upload, Video, FolderOpen } from "lucide-react";
import { UploadedImage } from "../types";

import { validateVideoFile } from "../lib/videoValidator";

interface ImageUploaderProps {
  images: UploadedImage[];
  onImagesUploaded: (newImages: UploadedImage[]) => void;
  onRemoveImage: (id: string) => void;
  onReorderImages: (reordered: UploadedImage[]) => void;
  onApplyVideoToAllSegments?: (videoUrl: string) => void;
}

export default function ImageUploader({
  images,
  onImagesUploaded,
  onRemoveImage,
  onReorderImages,
  onApplyVideoToAllSegments
}: ImageUploaderProps) {
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const [validationError, setValidationError] = useState<string | null>(null);

  const processFiles = async (fileList: FileList | File[]) => {
    setValidationError(null);
    const validMedia: UploadedImage[] = [];
    const filesArray = Array.from(fileList);

    // Naturally sort by filename so 1, 2, 3 ... 14 are in clean numeric/alphabetical order
    filesArray.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));

    for (let i = 0; i < filesArray.length; i++) {
      const file = filesArray[i];
      const ext = file.name.split('.').pop()?.toLowerCase();
      const isImg = file.type.startsWith("image/") || ["png", "jpg", "jpeg", "webp", "gif", "svg"].includes(ext || "");
      const isVid = file.type.startsWith("video/") || ["mp4", "webm", "avi", "mov", "mkv", "ogg"].includes(ext || "");

      if (isImg) {
        const url = URL.createObjectURL(file);
        validMedia.push({
          id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          url,
          name: file.name,
          size: file.size,
          type: "image"
        });
      } else if (isVid) {
        const result = await validateVideoFile(file);
        if (result.isValid) {
          const url = URL.createObjectURL(file);
          validMedia.push({
            id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            url,
            name: file.name,
            size: file.size,
            type: "video"
          });
        } else {
          setValidationError(`Video "${file.name}" is invalid or corrupted: ${result.errorMessage || "Unable to decode video frames"}`);
        }
      }
    }
    if (validMedia.length > 0) {
      onImagesUploaded([...images, ...validMedia]);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      processFiles(e.dataTransfer.files);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      processFiles(e.target.files);
    }
  };

  const moveImage = (index: number, direction: "up" | "down") => {
    const newImages = [...images];
    const targetIndex = direction === "up" ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= images.length) return;

    // Swap
    const temp = newImages[index];
    newImages[index] = newImages[targetIndex];
    newImages[targetIndex] = temp;
    onReorderImages(newImages);
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6 space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between pb-2 gap-2">
        <h2 className="text-xl font-display font-semibold text-slate-800 flex items-center gap-2">
          <Video className="w-5 h-5 text-indigo-500" />
          2. Upload Video/Image Slides
        </h2>
        {images.length > 0 && (
          <span className="text-xs bg-indigo-50 text-indigo-700 font-semibold px-2.5 py-1 rounded-full w-fit">
            {images.length} {images.length === 1 ? "Item" : "Items"}
          </span>
        )}
      </div>

      {validationError && (
        <div className="bg-rose-50 border border-rose-200 text-rose-700 px-4 py-3 rounded-xl text-xs font-medium flex items-center justify-between">
          <span>{validationError}</span>
          <button onClick={() => setValidationError(null)} className="text-rose-500 hover:text-rose-700 font-bold ml-2">✕</button>
        </div>
      )}

      <div
        onDragEnter={handleDrag}
        onDragOver={handleDrag}
        onDragLeave={handleDrag}
        onDrop={handleDrop}
        className={`border-2 border-dashed rounded-xl p-6 text-center transition-all ${
          dragActive
            ? "border-indigo-500 bg-indigo-50/50"
            : "border-slate-200 hover:border-indigo-400 hover:bg-slate-50/50"
        }`}
        id="image-dropzone"
      >
        <input
          type="file"
          ref={fileInputRef}
          onChange={handleFileChange}
          accept="image/*,video/*"
          multiple
          className="hidden"
        />
        <input
          type="file"
          ref={folderInputRef}
          onChange={handleFileChange}
          {...({ webkitdirectory: "", directory: "", multiple: true } as any)}
          className="hidden"
        />
        <div className="mx-auto w-10 h-10 rounded-full bg-indigo-50 flex items-center justify-center mb-2">
          <Upload className="w-5 h-5 text-indigo-500" />
        </div>
        <p className="text-sm font-medium text-slate-700">
          Click or drag multiple images/videos here
        </p>
        <p className="text-xs text-slate-400 mt-1 mb-4">
          MP4, WebM, JPG, PNG, WebP etc.
        </p>

        <div className="flex flex-wrap items-center justify-center gap-3">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-lg shadow-xs transition-colors cursor-pointer flex items-center gap-1.5"
          >
            <ImageIcon className="w-3.5 h-3.5" /> Select Files
          </button>
          <button
            type="button"
            onClick={() => folderInputRef.current?.click()}
            className="px-3 py-1.5 bg-slate-800 hover:bg-slate-900 text-white text-xs font-semibold rounded-lg shadow-xs transition-colors cursor-pointer flex items-center gap-1.5"
            title="Upload an entire folder of images/videos / पूरा फ़ोल्डर चुनें"
          >
            <FolderOpen className="w-3.5 h-3.5 text-indigo-400" /> Select Entire Folder (फ़ोल्डर)
          </button>
        </div>
      </div>

      {images.length > 0 && (
        <div className="space-y-2 mt-4">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
            Reorder & Manage Slides (First to Last)
          </p>
          <div className="max-h-[300px] overflow-y-auto scrollbar-thin space-y-2 pr-1" id="image-slide-list">
            {images.map((image, idx) => (
              <div
                key={image.id}
                className="flex items-center justify-between p-2.5 bg-slate-50 rounded-xl border border-slate-100 hover:border-indigo-100 transition-colors"
              >
                <div className="flex items-center gap-3 overflow-hidden">
                  <div className="font-mono text-xs font-semibold text-slate-400 w-4">
                    #{idx + 1}
                  </div>
                  {image.type === "video" ? (
                    <div className="relative w-12 h-12 rounded-lg bg-slate-900 shrink-0 flex items-center justify-center overflow-hidden border border-slate-200 shadow-sm">
                      <video
                        src={image.url}
                        className="w-full h-full object-cover"
                        muted
                        playsInline
                      />
                      <span className="absolute bottom-0 right-0 bg-indigo-600 text-[7px] text-white font-extrabold px-1 rounded-tl">VIDEO</span>
                    </div>
                  ) : (
                    <img
                      src={image.url}
                      alt={image.name}
                      className="w-12 h-12 rounded-lg object-cover bg-slate-200 border border-slate-200 shrink-0"
                      referrerPolicy="no-referrer"
                    />
                  )}
                  <div className="overflow-hidden">
                    <p className="text-xs font-medium text-slate-800 truncate" title={image.name}>
                      {image.name}
                    </p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <p className="text-[10px] text-slate-400">
                        {(image.size / (1024 * 1024)).toFixed(2) === "0.00" 
                          ? `${(image.size / 1024).toFixed(0)} KB` 
                          : `${(image.size / (1024 * 1024)).toFixed(2)} MB`}
                      </p>
                      {image.type === "video" && onApplyVideoToAllSegments && (
                        <button
                          onClick={() => onApplyVideoToAllSegments(image.url)}
                          className="text-[9px] font-bold bg-purple-100 hover:bg-purple-200 text-purple-800 px-2 py-0.5 rounded border border-purple-200 transition-colors flex items-center gap-1 cursor-pointer shrink-0"
                          title="Apply this video across all transcription parts/segments / सभी पार्ट्स में यह वीडियो लागू करें"
                        >
                          <Video className="w-2.5 h-2.5 text-purple-600" />
                          Apply to All Parts
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-1 shrink-0">
                  <button
                    disabled={idx === 0}
                    onClick={() => moveImage(idx, "up")}
                    className="p-1 text-slate-400 hover:text-slate-700 hover:bg-slate-200 rounded disabled:opacity-30 disabled:hover:bg-transparent"
                    title="Move slide up"
                  >
                    <ChevronUp className="w-4 h-4" />
                  </button>
                  <button
                    disabled={idx === images.length - 1}
                    onClick={() => moveImage(idx, "down")}
                    className="p-1 text-slate-400 hover:text-slate-700 hover:bg-slate-200 rounded disabled:opacity-30 disabled:hover:bg-transparent"
                    title="Move slide down"
                  >
                    <ChevronDown className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => onRemoveImage(image.id)}
                    className="p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded"
                    title="Delete item"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
