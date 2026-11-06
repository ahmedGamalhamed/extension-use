/**
 * @extension-use/host/offscreen
 *
 * Holds tab capture streams for the tabCapture group: a captured tab keeps
 * rendering in the background, and screenshots read its frames.
 *
 *   <!-- offscreen.html -->
 *   <script type="module" src="offscreen.js"></script>
 *
 *   // offscreen.ts
 *   import { mountOffscreen } from "@extension-use/host/offscreen";
 *   mountOffscreen();
 *
 *   // background.ts
 *   defineHost({ ..., offscreen: "offscreen.html" });
 */
import { OFFSCREEN_MESSAGE, type OffscreenCommand, type OffscreenReply } from "../wire.js";

interface Held {
  stream: MediaStream;
  track: MediaStreamTrack;
  video: HTMLVideoElement;
  width: number;
  height: number;
}

let mounted = false;

export function mountOffscreen() {
  if (mounted) return;
  mounted = true;
  const held = new Map<number, Held>();

  const stop = (tabId: number) => {
    const h = held.get(tabId);
    if (!h) return false;
    held.delete(tabId);
    for (const t of h.stream.getTracks()) t.stop();
    h.video.srcObject = null;
    return true;
  };

  const size = (h: Held) => ({ width: h.width, height: h.height });

  /**
   * The next frame of the stream (Chrome sends one on request), so a scroll
   * just before shows up. Undefined if none comes within a second.
   */
  async function grab(track: MediaStreamTrack): Promise<ImageBitmap | undefined> {
    if (typeof ImageCapture === "undefined") return undefined;
    return Promise.race([new ImageCapture(track).grabFrame().catch(() => undefined), new Promise<undefined>((r) => setTimeout(r, 1000))]);
  }

  async function start(c: Extract<OffscreenCommand, { op: "start" }>) {
    const existing = held.get(c.tabId);
    if (existing) return size(existing);
    if (!c.streamId) throw new Error(`Tab ${c.tabId} is not being captured`);
    const wantWidth = c.width ?? 1280;
    const wantHeight = c.height ?? 800;
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        // Chrome's legacy constraints for tab capture. min = max asks for a
        // fixed size: with only a max, Chrome lowers the size when it's busy.
        mandatory: {
          chromeMediaSource: "tab",
          chromeMediaSourceId: c.streamId,
          minWidth: wantWidth,
          maxWidth: wantWidth,
          minHeight: wantHeight,
          maxHeight: wantHeight,
          maxFrameRate: 30,
        },
      } as MediaTrackConstraints,
    });
    const track = stream.getVideoTracks()[0]!;
    const video = document.createElement("video");
    video.muted = true;
    video.srcObject = stream;
    await video.play();
    if (!video.videoWidth) await new Promise((r) => video.addEventListener("loadedmetadata", r, { once: true }));
    // Chrome may settle the size a pixel or two off over the first frames;
    // frame() records the size it actually got.
    const h: Held = { stream, track, video, width: video.videoWidth, height: video.videoHeight };
    held.set(c.tabId, h);
    // The tab was closed, or Chrome ended the capture.
    track.addEventListener("ended", () => held.get(c.tabId) === h && stop(c.tabId));
    return size(h);
  }

  async function frame(c: Extract<OffscreenCommand, { op: "frame" }>) {
    const h = held.get(c.tabId);
    if (!h) throw new Error(`Tab ${c.tabId} is not being captured`);
    // A fresh frame, or else the latest one the video element shows.
    const bitmap = await grab(h.track);
    const width = bitmap?.width ?? h.video.videoWidth;
    const height = bitmap?.height ?? h.video.videoHeight;
    if (!width || !height) throw new Error("The tab has not painted a frame yet");
    const canvas = new OffscreenCanvas(width, height);
    canvas.getContext("2d")!.drawImage(bitmap ?? h.video, 0, 0);
    bitmap?.close();
    h.width = width;
    h.height = height;
    const blob = await canvas.convertToBlob({
      type: c.format === "jpeg" ? "image/jpeg" : "image/png",
      ...(c.quality !== undefined ? { quality: c.quality / 100 } : {}),
    });
    return { dataUrl: await blobToDataUrl(blob), width, height };
  }

  async function handle(c: OffscreenCommand): Promise<unknown> {
    switch (c.op) {
      case "start":
        return start(c);
      case "stop":
        return { stopped: stop(c.tabId) };
      case "list":
        return { tabIds: [...held.keys()] };
      case "frame":
        return frame(c);
    }
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const command = (message as Record<string, unknown> | undefined)?.[OFFSCREEN_MESSAGE] as OffscreenCommand | undefined;
    if (!command || sender.id !== chrome.runtime.id) return;
    handle(command).then(
      (output) => sendResponse({ ok: true, output } satisfies OffscreenReply),
      (err: unknown) => sendResponse({ ok: false, error: String((err as Error)?.message ?? err) } satisfies OffscreenReply),
    );
    return true;
  });
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

declare class ImageCapture {
  constructor(track: MediaStreamTrack);
  grabFrame(): Promise<ImageBitmap>;
}
