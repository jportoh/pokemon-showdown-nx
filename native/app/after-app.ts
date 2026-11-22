// Runs right after Angular's bundle has been evaluated (scripts/build-nro.mjs imports it last), which
// includes bootstrapApplication's synchronous part. With the first frames it splits the ~1.6 s block
// at start (test x11) into evaluating the code and the app's own start.

import { nativeLog } from './native-log';

const sinceEngine = () => `${performance.now().toFixed(0)} ms`;
nativeLog(`[boot] app bundle evaluated at ${sinceEngine()} (engine clock)`);

let frames = 0;
const frame = () => {
  frames++;
  nativeLog(`[boot] frame ${frames} at ${sinceEngine()}`);
  if (frames < 3) requestAnimationFrame(frame);
};
requestAnimationFrame(frame);
