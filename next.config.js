/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false,
};

// Wrap with Sentry to capture errors + traces automatically.
// Source-map upload is disabled by default; to enable, uncomment the block
// and set SENTRY_AUTH_TOKEN + SENTRY_ORG + SENTRY_PROJECT in Vercel env.
const { withSentryConfig } = require("@sentry/nextjs");

module.exports = withSentryConfig(nextConfig, {
  silent: true,
  // org: process.env.SENTRY_ORG,
  // project: process.env.SENTRY_PROJECT,
  // authToken: process.env.SENTRY_AUTH_TOKEN,
  // widenClientFileUpload: true,
  disableLogger: true,
  automaticVercelMonitors: false,
  // Skip source-map upload during build — keeps deploys fast and doesn't
  // require SENTRY_AUTH_TOKEN. Turn on when you want stack traces symbolicated.
  sourcemaps: { disable: true },
});
