import { copyFile, mkdir } from 'node:fs/promises';

await mkdir(new URL('../public/ort/', import.meta.url), { recursive: true });
for (const name of ['ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.wasm']) {
  await copyFile(
    new URL(`../node_modules/onnxruntime-web/dist/${name}`, import.meta.url),
    new URL(`../public/ort/${name}`, import.meta.url),
  );
}
await copyFile(
  new URL('../third-party/onnxruntime-LICENSE.txt', import.meta.url),
  new URL('../public/ort/LICENSE.txt', import.meta.url),
);
console.log('Prepared same-origin ONNX Runtime Web assets.');
