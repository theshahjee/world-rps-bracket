import { defineConfig, type Plugin } from 'vite';

// Strict Content-Security-Policy for the production build only (the dev server needs inline HMR code).
const csp: Plugin = {
  name: 'csp',
  apply: 'build',
  transformIndexHtml(html) {
    const policy = [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' https://fonts.googleapis.com",
      "font-src https://fonts.gstatic.com",
      "img-src 'self' data:",
      "connect-src 'self'",
      "base-uri 'none'",
      "form-action 'none'",
      "object-src 'none'",
    ].join('; ');
    return html.replace(
      '<meta charset="UTF-8" />',
      `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${policy}" />\n    <meta name="referrer" content="strict-origin-when-cross-origin" />`,
    );
  },
};

export default defineConfig({
  base: process.env.BASE_PATH ?? '/',
  plugins: [csp],
});
