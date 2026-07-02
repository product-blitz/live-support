// Sentry server-side init. Runs in Node.js serverless functions.
import * as Sentry from "@sentry/nextjs";

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    tracesSampleRate: 1.0,
    environment: process.env.NEXT_PUBLIC_APP_URL?.includes("vercel.app") ? "production" : "development",
  });
}
