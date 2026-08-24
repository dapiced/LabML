/// <reference lib="webworker" />
/**
 * Runs the three V23 models (ONNX Runtime Web, WASM backend) entirely in this
 * worker: EfficientNet-Lite4 answers "what is it", YOLOX-Nano finds objects,
 * UltraFace finds faces. Models and runtime are self-hosted — the strict CSP
 * still allows no third party, and the image never leaves the browser.
 */
import * as ort from 'onnxruntime-web/wasm';
import { decodeUltraface, decodeYolox, type DetectedBox } from '@/features/ai/vision/detect';
import { topK } from '@/features/ai/vision/preprocess';

export type VisionRequest =
  | { kind: 'init' }
  | {
      kind: 'analyze';
      /** NHWC 224² RGB, (x−127)/128. */
      classifier: Float32Array;
      /** NCHW 416² BGR, raw 0–255, letterboxed top-left. */
      objects: Float32Array;
      /** NCHW 320×240 RGB, (x−127)/128, letterboxed top-left. */
      faces: Float32Array;
      /** Original image size in pixels — boxes come back in this space. */
      width: number;
      height: number;
      /** Letterbox scale used for the YOLOX input: min(416/w, 416/h). */
      ratio: number;
      /** Letterbox scale used for the UltraFace input: min(320/w, 240/h). */
      faceRatio: number;
    };

export type VisionResponse =
  | { kind: 'ready'; loadMs: number }
  | {
      kind: 'result';
      top: { index: number; p: number }[];
      objects: DetectedBox[];
      faces: DetectedBox[];
      inferMs: number;
    }
  | { kind: 'error'; message: string };

ort.env.wasm.wasmPaths = '/ort/';
ort.env.wasm.numThreads = 1; // no COOP/COEP headers → single-threaded WASM
// V35 — measured: loading the three models printed 366 lines to console.error,
// every one of them an ONNX Runtime *warning* that the WASM build routes to
// error. They all say the same thing about UltraFace — its export lists the
// initializers among the graph inputs, an old-opset convention, not a fault in
// our code or our weights. Nothing was broken; 366 red lines simply meant a
// real error would have been invisible.
//
// The silencing goes on the session, not here: `ort.env.logLevel` governs the
// JavaScript-side logger, and setting it to 'error' left all 366 lines in
// place — they come from the runtime's own C++ logger, which reads the
// session's `logSeverityLevel`. See `loadSessions` below.

const MODEL_URLS = {
  classifier: '/models/efficientnet-lite4-11-int8.onnx',
  objects: '/models/yolox-nano.onnx',
  faces: '/models/ultraface-RFB-320.onnx',
} as const;

let sessions: Record<keyof typeof MODEL_URLS, ort.InferenceSession> | null = null;

function post(message: VisionResponse) {
  self.postMessage(message);
}

async function loadSessions() {
  const create = (url: string) =>
    // `logSeverityLevel: 3` is ERROR on the runtime's own scale (0 verbose,
    // 1 info, 2 warning — the default — 3 error, 4 fatal). Warnings stay
    // suppressed; a genuine failure still reaches the console, and every error
    // path here also posts a named `{ kind: 'error' }` back to the page.
    ort.InferenceSession.create(url, { executionProviders: ['wasm'], logSeverityLevel: 3 });
  const [classifier, objects, faces] = await Promise.all([
    create(MODEL_URLS.classifier),
    create(MODEL_URLS.objects),
    create(MODEL_URLS.faces),
  ]);
  return { classifier, objects, faces };
}

self.onmessage = async (event: MessageEvent<VisionRequest>) => {
  try {
    if (event.data.kind === 'init') {
      if (!sessions) {
        const start = performance.now();
        sessions = await loadSessions();
        post({ kind: 'ready', loadMs: performance.now() - start });
      } else {
        post({ kind: 'ready', loadMs: 0 });
      }
    } else if (event.data.kind === 'analyze') {
      if (!sessions) throw new Error('not-ready');
      const { classifier, objects, faces, width, height, ratio, faceRatio } = event.data;
      const start = performance.now();

      const clsOut = await sessions.classifier.run({
        [sessions.classifier.inputNames[0]]: new ort.Tensor(
          'float32',
          classifier,
          [1, 224, 224, 3],
        ),
      });
      // The graph ends in a Softmax node: these are probabilities already.
      const probs = clsOut[sessions.classifier.outputNames[0]].data as Float32Array;

      const objOut = await sessions.objects.run({
        [sessions.objects.inputNames[0]]: new ort.Tensor('float32', objects, [1, 3, 416, 416]),
      });
      const rawObjects = objOut[sessions.objects.outputNames[0]].data as Float32Array;

      const faceOut = await sessions.faces.run({
        [sessions.faces.inputNames[0]]: new ort.Tensor('float32', faces, [1, 3, 240, 320]),
      });

      post({
        kind: 'result',
        top: topK(probs, 5),
        objects: decodeYolox(rawObjects, ratio, width, height),
        faces: decodeUltraface(
          faceOut.scores.data as Float32Array,
          faceOut.boxes.data as Float32Array,
          faceRatio,
          width,
          height,
        ),
        inferMs: performance.now() - start,
      });
    }
  } catch (error) {
    post({ kind: 'error', message: error instanceof Error ? error.message : String(error) });
  }
};
