// The native .nro's entry: installs the platform pieces nx.js lacks, then runs the app's own
// production build (the build script appends the import of Angular's main chunk after these).

import './boot-start';
import './native-log';
import './net-diagnostics';
import './bundled-showdown';
import './touch-bridge';
import './plus-button';
import './dom-shim';
import { registerBoldFace } from './bold-font';

registerBoldFace();
