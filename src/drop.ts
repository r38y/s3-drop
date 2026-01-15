import { getPreferenceValues, Clipboard, showToast, Toast } from "@raycast/api";
import { S3Client, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { createReadStream } from "fs";
import { stat } from "fs/promises";
import { basename, extname } from "path";
import { fileURLToPath } from "url";
import { lookup } from "mime-types";
import { randomUUID } from "crypto";

const INLINE_TYPES = new Set([
  "application/json",
  "application/pdf",
  "audio/mpeg",
  "audio/ogg",
  "audio/wav",
  "audio/webm",
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
  "text/css",
  "text/plain",
  "video/mp4",
  "video/webm",
]);

function shouldDisplayInline(contentType: string): boolean {
  return INLINE_TYPES.has(contentType);
}

interface Preferences {
  awsAccessKey: string;
  awsSecretKey: string;
  bucketName: string;
  awsRegion: string;
}

export default async function Command() {
  const prefs = getPreferenceValues<Preferences>();

  const clipboard = await Clipboard.read();
  if (!clipboard.file) {
    await showToast({ style: Toast.Style.Failure, title: "No file in clipboard" });
    return;
  }

  const filePath = fileURLToPath(clipboard.file);
  const toast = await showToast({ style: Toast.Style.Animated, title: "Uploading..." });

  try {
    const fileStats = await stat(filePath);
    if (!fileStats.isFile()) {
      toast.style = Toast.Style.Failure;
      toast.title = "Upload Failed";
      toast.message = "Clipboard item is not a file";
      return;
    }

    const maxPutObjectBytes = 5 * 1024 * 1024 * 1024;
    if (fileStats.size > maxPutObjectBytes) {
      toast.style = Toast.Style.Failure;
      toast.title = "Upload Failed";
      toast.message = "File is larger than 5 GB (single PUT limit)";
      return;
    }

    const s3 = new S3Client({
      region: prefs.awsRegion,
      credentials: {
        accessKeyId: prefs.awsAccessKey,
        secretAccessKey: prefs.awsSecretKey,
      },
    });

    const originalName = basename(filePath);
    const safeFilename = originalName
      .replace(/[\r\n]/g, "")
      .replace(/\\/g, "\\\\")
      .replace(/"/g, '\\"');
    const ext = extname(filePath);
    const key = `${randomUUID()}${ext}`;
    const contentType = lookup(filePath) || "application/octet-stream";

    await s3.send(
      new PutObjectCommand({
        Bucket: prefs.bucketName,
        Key: key,
        Body: createReadStream(filePath),
        ContentType: contentType,
      }),
    );

    const disposition = shouldDisplayInline(contentType) ? "inline" : "attachment";
    const url = await getSignedUrl(
      s3,
      new GetObjectCommand({
        Bucket: prefs.bucketName,
        Key: key,
        ResponseContentDisposition: `${disposition}; filename="${safeFilename}"`,
      }),
      { expiresIn: 86400 },
    );

    await Clipboard.copy(url);
    toast.style = Toast.Style.Success;
    toast.title = "File Uploaded";
    toast.message = "URL copied to clipboard";
  } catch (error) {
    toast.style = Toast.Style.Failure;
    toast.title = "Upload Failed";
    toast.message = error instanceof Error ? error.message : "Unknown error";
  }
}
