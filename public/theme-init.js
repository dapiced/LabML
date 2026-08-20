// Applied before the app bundle loads to avoid a flash of the wrong theme.
// Kept as an external file because the CSP forbids inline scripts.
(function () {
  try {
    var stored = localStorage.getItem('labml-theme');
    var dark =
      stored === 'dark' ||
      (stored !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.classList.toggle('dark', dark);
  } catch (e) {
    /* default to light */
  }
})();
