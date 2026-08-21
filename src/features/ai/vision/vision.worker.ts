/// <reference lib="webworker" />
/**
 * Runs SqueezeNet (ONNX Runtime Web, WASM backend) entirely in this worker.
 * Model and runtime are self-hosted — the strict CSP still allows no third
 * party, and the image never leaves the browser.
 */
import * as ort from 'onnxruntime-web/wasm';
import { softmaxTop, VISION_SIZE } from '@/features/ai/vision/preprocess';

export type VisionRequest = { kind: 'init' } | { kind: 'classify'; tensor: Float32Array };

export type VisionResponse =
  | { kind: 'ready'; loadMs: number }
  | { kind: 'top'; items: { index: number; p: number }[]; inferMs: number }
  | { kind: 'error'; message: string };

ort.env.wasm.wasmPaths = '/ort/';
ort.env.wasm.numThreads = 1; // no COOP/COEP headers → single-threaded WASM

let session: ort.InferenceSession | null = null;

function post(message: VisionResponse) {
  self.postMessage(message);
}

self.onmessage = async (event: MessageEvent<VisionRequest>) => {
  try {
    if (event.data.kind === 'init') {
      if (!session) {
        const start = performance.now();
        session = await ort.InferenceSession.create('/models/squeezenet1_1.onnx', {
          executionProviders: ['wasm'],
        });
        post({ kind: 'ready', loadMs: performance.now() - start });
      } else {
        post({ kind: 'ready', loadMs: 0 });
      }
    } else if (event.data.kind === 'classify') {
      if (!session) throw new Error('not-ready');
      const input = new ort.Tensor('float32', event.data.tensor, [1, 3, VISION_SIZE, VISION_SIZE]);
      const start = performance.now();
      const outputs = await session.run({ [session.inputNames[0]]: input });
      const inferMs = performance.now() - start;
      const scores = outputs[session.outputNames[0]].data as Float32Array;
      post({ kind: 'top', items: softmaxTop(scores, 5), inferMs });
    }
  } catch (error) {
    post({ kind: 'error', message: error instanceof Error ? error.message : String(error) });
  }
};
