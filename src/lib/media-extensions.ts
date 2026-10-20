/** File types the scan engine picks up. Keep in step with engine/VDF.Core/Utils/FileUtils.cs. */
export const IMAGE_EXTENSIONS: ReadonlySet<string> = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".gif",
  ".bmp",
  ".tiff",
  ".webp",
  ".heic",
  ".heif",
]);

export const VIDEO_EXTENSIONS: ReadonlySet<string> = new Set([
  ".mp4",
  ".wmv",
  ".avi",
  ".mkv",
  ".flv",
  ".mov",
  ".mpg",
  ".mpeg",
  ".m4v",
  ".asf",
  ".f4v",
  ".webm",
  ".divx",
  ".m2t",
  ".m2ts",
  ".mts",
  ".vob",
  ".ts",
  ".rmvb",
  ".rm",
]);

function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  return dot <= 0 ? "" : fileName.slice(dot).toLowerCase();
}

/** True when a scan with these settings reads the file. Images only count when images are scanned. */
export function isScannedMedia(fileName: string, includeImages: boolean): boolean {
  const ext = extensionOf(fileName);
  if (VIDEO_EXTENSIONS.has(ext)) return true;
  return includeImages && IMAGE_EXTENSIONS.has(ext);
}
