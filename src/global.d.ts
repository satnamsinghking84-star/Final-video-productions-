declare module "fix-webm-duration" {
  function ysFixWebmDuration(
    blob: Blob,
    duration: number,
    callback: (fixedBlob: Blob) => void
  ): void;
  export default ysFixWebmDuration;
}
