import assert from "node:assert/strict";
import { beforeEach, after, test } from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { compileFunction } from "node:vm";
import { mkdtemp, writeFile, truncate, chmod, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

let state;
let directory;
const preferences = {
  awsAccessKey: "test-key",
  awsSecretKey: "test-secret",
  bucketName: "test-bucket",
  awsRegion: "us-east-1",
};

const modules = {};
modules["@raycast/api"] = {
  Clipboard: {
    read: async () => {
      if (state.readError) throw state.readError;
      return state.clipboard;
    },
    copy: async (url) => {
      if (state.copyError) throw state.copyError;
      state.copied.push(url);
    },
  },
  getPreferenceValues: () => preferences,
  Toast: { Style: { Animated: "animated", Failure: "failure", Success: "success" } },
  showToast: async (options) => {
    const toast = { ...options };
    state.toasts.push(toast);
    return toast;
  },
};
modules["@aws-sdk/client-s3"] = {
  S3Client: class {
    constructor(options) {
      state.clientOptions = options;
    }
    async send(command) {
      state.uploads.push(command.input);
      if (state.uploadError) throw state.uploadError;
      const chunks = [];
      for await (const chunk of command.input.Body) chunks.push(chunk);
      state.uploadedBytes = Buffer.concat(chunks);
    }
    destroy() {
      state.destroyed = true;
    }
  },
  PutObjectCommand: class {
    constructor(input) {
      this.input = input;
    }
  },
  GetObjectCommand: class {
    constructor(input) {
      this.input = input;
    }
  },
};
modules["@aws-sdk/s3-request-presigner"] = {
  getSignedUrl: async (_client, command, options) => {
    state.signatures.push({ input: command.input, options });
    if (state.signError) throw state.signError;
    return "https://test-bucket.example/file?signature=test";
  },
};
// Raycast supplies its API at runtime, so it has no Node.js entry point to import.
// Execute the unchanged CommonJS output with mocked service modules.
const filename = fileURLToPath(new URL("../.test-build/drop.js", import.meta.url));
const requireFromCommand = createRequire(filename);
const compiled = compileFunction(
  readFileSync(filename, "utf8"),
  ["exports", "require", "module", "__filename", "__dirname"],
  { filename },
);
const loaded = { exports: {} };
compiled(loaded.exports, (name) => modules[name] ?? requireFromCommand(name), loaded, filename, dirname(filename));
const command = loaded.exports.default;

beforeEach(async () => {
  directory ||= await mkdtemp(join(tmpdir(), "s3-drop-test-"));
  state = { clipboard: {}, toasts: [], copied: [], uploads: [], signatures: [] };
});
after(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
});

async function copyFile(name, contents = "hello") {
  const file = join(directory, name);
  await writeFile(file, contents);
  state.clipboard = { file: pathToFileURL(file).href };
  return file;
}
function failure() {
  const toast = state.toasts.at(-1);
  assert.equal(toast.style, "failure");
  return toast;
}
function namedError(name) {
  return Object.assign(new Error("provider detail"), { name });
}

test("uploads the copied file and copies a 24-hour link to the same object", async () => {
  await copyFile("example.txt", "file contents");
  await command();
  assert.equal(state.uploads.length, 1);
  assert.equal(state.uploads[0].Bucket, preferences.bucketName);
  assert.match(state.uploads[0].Key, /^[0-9a-f-]{36}\.txt$/);
  assert.equal(state.uploads[0].ContentLength, 13);
  assert.equal(state.uploads[0].ContentType, "text/plain");
  assert.equal(state.uploadedBytes.toString(), "file contents");
  assert.equal(state.signatures[0].input.Key, state.uploads[0].Key);
  assert.equal(state.signatures[0].input.Bucket, preferences.bucketName);
  assert.equal(state.signatures[0].options.expiresIn, 86400);
  assert.match(state.signatures[0].input.ResponseContentDisposition, /^inline;/);
  assert.deepEqual(state.copied, ["https://test-bucket.example/file?signature=test"]);
  assert.equal(state.toasts.at(-1).style, "success");
  assert.equal(state.destroyed, true);
});

test("also accepts an absolute local clipboard path", async () => {
  const file = await copyFile("absolute.txt");
  state.clipboard = { file };
  await command();
  assert.equal(state.copied.length, 1);
});

test("asks for a copied file without starting an upload", async () => {
  await command();
  assert.equal(failure().title, "No File in Clipboard");
  assert.equal(state.uploads.length, 0);
});

test("handles a clipboard read failure", async () => {
  state.readError = new Error("clipboard unavailable");
  await command();
  assert.match(failure().message, /Could not read the clipboard/);
});

test("handles an invalid file URL", async () => {
  state.clipboard = { file: "https://example.com/file" };
  await command();
  assert.match(failure().message, /valid local file/);
  assert.equal(state.uploads.length, 0);
});

test("handles a deleted file", async () => {
  state.clipboard = { file: pathToFileURL(join(directory, "missing.txt")).href };
  await command();
  assert.match(failure().message, /no longer exists/);
});

test("rejects directories", async () => {
  state.clipboard = { file: pathToFileURL(directory).href };
  await command();
  assert.equal(failure().title, "Cannot Upload Folder");
  assert.equal(state.uploads.length, 0);
});

test("rejects files above the single-upload limit without reading them", async () => {
  const file = await copyFile("large.bin", "");
  await truncate(file, 5 * 1024 * 1024 * 1024 + 1);
  await command();
  assert.equal(failure().title, "File Too Large");
  assert.equal(state.uploads.length, 0);
});

test("escapes Unicode filenames and header control characters", async () => {
  await copyFile('résumé "draft"\r\n.txt');
  await command();
  const disposition = state.signatures[0].input.ResponseContentDisposition;
  assert.doesNotMatch(disposition, /[\r\n]/);
  assert.match(disposition, /filename="r_sum_ \\"draft\\"\.txt"/);
  assert.match(disposition, /filename\*=UTF-8''r%C3%A9sum%C3%A9%20%22draft%22\.txt/);
});

test("downloads unknown types as attachments", async () => {
  await copyFile("example.unknownextension");
  await command();
  assert.equal(state.uploads[0].ContentType, "application/octet-stream");
  assert.match(state.signatures[0].input.ResponseContentDisposition, /^attachment;/);
});

for (const [name, expected] of [
  ["InvalidAccessKeyId", /access key and secret key/],
  ["AccessDenied", /AWS user can upload and download/],
  ["NoSuchBucket", /bucket was not found/],
  ["PermanentRedirect", /region/],
  ["TimeoutError", /internet connection/],
]) {
  test(`explains ${name} upload failures and does not copy a link`, async () => {
    await copyFile("failure.txt");
    state.uploadError = namedError(name);
    await command();
    assert.match(failure().message, expected);
    assert.equal(state.copied.length, 0);
    assert.equal(state.signatures.length, 0);
    assert.equal(state.uploads[0].Body.destroyed, true);
    assert.equal(state.destroyed, true);
  });
}

test("recognizes a network error wrapped by the AWS SDK", async () => {
  await copyFile("network.txt");
  state.uploadError = Object.assign(new Error("request failed"), { cause: { code: "ENOTFOUND" } });
  await command();
  assert.match(failure().message, /internet connection/);
});

test("does not copy a link when signing fails", async () => {
  await copyFile("signing.txt");
  state.signError = new Error("Could not sign URL");
  await command();
  assert.equal(failure().message, "Could not sign URL");
  assert.equal(state.copied.length, 0);
  assert.equal(state.destroyed, true);
});

test("distinguishes a copy failure from an upload failure", async () => {
  await copyFile("clipboard.txt");
  state.copyError = new Error("clipboard unavailable");
  await command();
  assert.equal(failure().title, "Could Not Copy Link");
  assert.match(failure().message, /file was uploaded/);
  assert.equal(state.uploads.length, 1);
});

test("uploads an empty file", async () => {
  await copyFile("empty.txt", "");
  await command();
  assert.equal(state.uploads[0].ContentLength, 0);
  assert.equal(state.uploadedBytes.length, 0);
  assert.equal(state.copied.length, 1);
});

test("explains unreadable files without copying a link", async () => {
  const file = await copyFile("unreadable.txt");
  await chmod(file, 0o000);
  try {
    await command();
    assert.match(failure().message, /permissions/);
    assert.equal(state.copied.length, 0);
    assert.equal(state.uploads.length, 0);
    assert.equal(state.clientOptions, undefined);
  } finally {
    await chmod(file, 0o600);
  }
});
