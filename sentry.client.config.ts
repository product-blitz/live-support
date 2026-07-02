// Sentry client-side init. Runs in browsers.
// Enabled only when NEXT_PUBLIC_SENTRY_DSN is set.
import * as Sentry from "@sentry/nextjs";

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    // Adjust in production if traces get noisy
    tracesSampleRate: 1.0,
    // Session Replay is optional — keep off for MVP to stay on free tier
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,
    environment: process.env.NEXT_PUBLIC_APP_URL?.includes("vercel.app") ? "production" : "development",
  });
}
