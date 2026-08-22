/**
 * The Content-Security-Policy this site actually serves, quoted verbatim on
 * /privacy. Duplicating a header into the UI is how a page ends up claiming a
 * protection that was edited away six months earlier — so `policy.test.ts`
 * reads `public/_headers` and fails the build if the two ever drift apart.
 */
export const CSP_HEADER =
  "default-src 'self'; script-src 'self' 'wasm-unsafe-eval' 'sha256-mqPXBS3QHeQk4jjTXwNUaDOa+WArc2bRzkkhb2+B1iY='; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'";

/** The directive that does the work, highlighted on its own on the page. */
export const CONNECT_SRC = "connect-src 'self'";

export const PERMISSIONS_POLICY = 'geolocation=(), microphone=(), camera=(self)';
