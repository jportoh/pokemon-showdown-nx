// nx.js closes the app when + is pressed, unless the `beforeunload` event it fires first is
// cancelled. Leaving is the console's HOME button's job, so + is always cancelled here and becomes
// one more of the app's buttons (console-keys: 'buttonPlus', e.g. OK on the on-screen keyboard).

globalThis.addEventListener('beforeunload', (event) => event.preventDefault());
