import { getPreferenceValues, Clipboard, showToast, Toast } from "@raycast/api";
import { S3Client, GetObjectCommand, PutObjectCommand, PutObjectCommandInput } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { constants, ReadStream, Stats } from "node:fs";
import { open, FileHandle } from "node:fs/promises";
import { basename, extname, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { lookup } from "mime-types";
import { randomUUID } from "node:crypto";
import { setTimeout } from "node:timers/promises";

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024 * 1024;
const LINK_EXPIRY_SECONDS = 24 * 60 * 60;
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

type Stage = "clipboard" | "file" | "upload" | "link" | "copy";

function isRetryable(error: unknown): boolean {
  const detail = error as {
    name?: string;
    code?: string;
    cause?: { code?: string };
    $metadata?: { httpStatusCode?: number };
  } | null;
  const code = detail?.code || detail?.cause?.code || detail?.name;
  return (
    ["EAI_AGAIN", "ECONNRESET", "ETIMEDOUT", "EPIPE", "TimeoutError", "SlowDown", "RequestTimeout"].includes(
      code || "",
    ) || [429, 500, 502, 503, 504].includes(detail?.$metadata?.httpStatusCode || 0)
  );
}

async function uploadFile(client: S3Client, filePath: string, original: Stats, input: PutObjectCommandInput) {
  // The SDK cannot retry a consumed stream. Reopen it for each bounded attempt.
  for (let attempt = 0; attempt < 3; attempt++) {
    const file = await open(filePath, constants.O_RDONLY | constants.O_NONBLOCK);
    let body: ReadStream | undefined;
    try {
      const current = await file.stat();
      if (
        !current.isFile() ||
        current.dev !== original.dev ||
        current.ino !== original.ino ||
        current.size !== original.size ||
        current.mtimeMs !== original.mtimeMs
      ) {
        throw new Error("The file changed. Copy it again in Finder and try again.");
      }
      body = file.createReadStream();
      await client.send(new PutObjectCommand({ ...input, Body: body }));
      return;
    } catch (error) {
      if (attempt === 2 || !isRetryable(error)) throw error;
    } finally {
      body?.destroy();
      await file.close();
    }
    await setTimeout(500 * 2 ** attempt);
  }
}

function contentDisposition(filename: string, contentType: string): string {
  // Keep a quoted ASCII fallback and preserve Unicode names with RFC 5987 encoding.
  const name =
    Array.from(filename)
      .filter((char) => {
        const code = char.charCodeAt(0);
        return code >= 32 && code !== 127;
      })
      .join("") || "download";
  const fallback = name.replace(/[^\x20-\x7e]/g, "_").replace(/([\\"])/g, "\\$1");
  const encoded = encodeURIComponent(name).replace(
    /[!'()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  const disposition = INLINE_TYPES.has(contentType) ? "inline" : "attachment";
  return `${disposition}; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

function errorMessage(error: unknown, stage: Stage): string {
  const detail = error as { name?: string; code?: string; cause?: { code?: string } } | null;
  const code = detail?.code || detail?.cause?.code || detail?.name;

  if (stage === "copy") return "The file was uploaded, but the link could not be copied to the clipboard.";
  if (stage === "clipboard") return "Could not read the clipboard. Copy a file in Finder and try again.";
  if (
    ["ERR_INVALID_URL", "ERR_INVALID_FILE_URL_HOST", "ERR_INVALID_URL_SCHEME", "ERR_INVALID_FILE_URL_PATH"].includes(
      code || "",
    )
  ) {
    return "The clipboard does not contain a valid local file. Copy a file in Finder and try again.";
  }
  if (code === "ENOENT") return "The copied file no longer exists. Copy it again in Finder.";
  if (code === "EACCES" || code === "EPERM") return "The file could not be read. Check its permissions and try again.";
  if (
    [
      "InvalidAccessKeyId",
      "SignatureDoesNotMatch",
      "InvalidToken",
      "ExpiredToken",
      "CredentialsProviderError",
    ].includes(code || "")
  ) {
    return "Check your AWS access key and secret key in the extension preferences.";
  }
  if (code === "AccessDenied")
    return "Access denied. Check that your AWS user can upload and download files in this bucket.";
  if (code === "NoSuchBucket")
    return "The S3 bucket was not found. Check the bucket name in the extension preferences.";
  if (["PermanentRedirect", "AuthorizationHeaderMalformed"].includes(code || "")) {
    return "Check that the AWS region in the extension preferences matches your bucket.";
  }
  if (["ENOTFOUND", "EAI_AGAIN", "ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "TimeoutError"].includes(code || "")) {
    return "Could not reach AWS. Check your internet connection and try again.";
  }
  return error instanceof Error ? error.message : "Something went wrong. Please try again.";
}

export default async function Command() {
  let toast: Toast | undefined;
  let stage: Stage = "clipboard";
  let client: S3Client | undefined;
  let file: FileHandle | undefined;

  try {
    const clipboard = await Clipboard.read();
    if (!clipboard.file) {
      await showToast({
        style: Toast.Style.Failure,
        title: "No File in Clipboard",
        message: "Copy a file in Finder and try again.",
      });
      return;
    }

    stage = "file";
    const filePath = isAbsolute(clipboard.file) ? clipboard.file : fileURLToPath(clipboard.file);
    file = await open(filePath, constants.O_RDONLY | constants.O_NONBLOCK);
    const fileStats = await file.stat();
    await file.close();
    file = undefined;
    if (!fileStats.isFile()) {
      await showToast({
        style: Toast.Style.Failure,
        title: fileStats.isDirectory() ? "Cannot Upload Folder" : "Cannot Upload Special File",
        message: "Copy a regular file, or compress a folder first.",
      });
      return;
    }
    if (fileStats.size > MAX_UPLOAD_BYTES) {
      await showToast({
        style: Toast.Style.Failure,
        title: "File Too Large",
        message: "Choose a file smaller than 5 GB.",
      });
      return;
    }

    toast = await showToast({ style: Toast.Style.Animated, title: "Uploading File", message: basename(filePath) });
    stage = "upload";
    const prefs = getPreferenceValues<Preferences>();
    client = new S3Client({
      region: prefs.awsRegion,
      credentials: { accessKeyId: prefs.awsAccessKey, secretAccessKey: prefs.awsSecretKey },
      maxAttempts: 1,
      requestHandler: { connectionTimeout: 10_000, socketTimeout: 60_000 },
    });
    const key = `${randomUUID()}${extname(filePath)}`;
    const contentType = lookup(filePath) || "application/octet-stream";
    await uploadFile(client, filePath, fileStats, {
      Bucket: prefs.bucketName,
      Key: key,
      ContentLength: fileStats.size,
      ContentType: contentType,
    });

    stage = "link";
    const url = await getSignedUrl(
      client,
      new GetObjectCommand({
        Bucket: prefs.bucketName,
        Key: key,
        ResponseContentDisposition: contentDisposition(basename(filePath), contentType),
      }),
      { expiresIn: LINK_EXPIRY_SECONDS },
    );

    stage = "copy";
    await Clipboard.copy(url);
    toast.style = Toast.Style.Success;
    toast.title = "Link Copied";
    toast.message = "The link is valid for 24 hours.";
  } catch (error) {
    const title = stage === "copy" ? "Could Not Copy Link" : "Upload Failed";
    const message = errorMessage(error, stage);
    if (toast) {
      toast.style = Toast.Style.Failure;
      toast.title = title;
      toast.message = message;
    } else {
      await showToast({ style: Toast.Style.Failure, title, message });
    }
  } finally {
    client?.destroy();
    await file?.close();
  }
}
