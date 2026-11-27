const MAX_BYTES = 500 * 1024; // 500 KB ceiling (AGENTS.md Section 3)
const MAX_WIDTH = 1600;

export type CompressedImageResult = {
  blob: Blob;
  fileName: string;
  originalBytes: number;
  compressedBytes: number;
  mimeType: string;
};

function loadImageElement(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Unable to decode image file."));
    };
    img.src = url;
  });
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  mimeType: string,
  quality: number
): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), mimeType, quality);
  });
}

/**
 * Compresses dental X-rays and intraoral photos client-side via HTML5 Canvas:
 * max 1600px width, WebP (0.8 quality, stepping down to guarantee <= 500 KB).
 * Non-image files (e.g. consent PDFs) are validated directly against the 500 KB cap.
 */
export async function compressClinicalFile(
  file: File
): Promise<CompressedImageResult> {
  if (!file.type.startsWith("image/")) {
    if (file.size > MAX_BYTES) {
      throw new Error("Non-image documents must be 500 KB or smaller.");
    }
    return {
      blob: file,
      fileName: file.name,
      originalBytes: file.size,
      compressedBytes: file.size,
      mimeType: file.type || "application/octet-stream",
    };
  }

  const img = await loadImageElement(file);
  let targetWidth = Math.min(img.naturalWidth || MAX_WIDTH, MAX_WIDTH);
  let targetHeight = Math.round(
    targetWidth * ((img.naturalHeight || 1) / (img.naturalWidth || 1))
  );

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Canvas 2D context is unavailable in this browser.");
  }

  const baseName = file.name.replace(/\.[^/.]+$/, "");
  const mimeCandidates = ["image/webp", "image/jpeg"];

  for (let scaleAttempt = 0; scaleAttempt < 3; scaleAttempt++) {
    canvas.width = Math.max(1, targetWidth);
    canvas.height = Math.max(1, targetHeight);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    for (const mime of mimeCandidates) {
      for (const quality of [0.8, 0.65, 0.5, 0.38]) {
        const blob = await canvasToBlob(canvas, mime, quality);
        if (blob && blob.size <= MAX_BYTES) {
          const ext = mime === "image/webp" ? "webp" : "jpg";
          return {
            blob,
            fileName: `${baseName}.${ext}`,
            originalBytes: file.size,
            compressedBytes: blob.size,
            mimeType: mime,
          };
        }
      }
    }

    targetWidth = Math.round(targetWidth * 0.75);
    targetHeight = Math.round(targetHeight * 0.75);
  }

  throw new Error(
    "Could not compress image below 500 KB. Please crop or use a lower-resolution image."
  );
}
