import { SignJWT } from "jose";
import { randomUUID } from "crypto";

const HMS_API = "https://api.100ms.live/v2";

// Management token — signed JWT good for API calls to 100ms.
// Short-lived; generate per-request rather than caching.
async function managementToken() {
  const secret = new TextEncoder().encode(process.env.HMS_APP_SECRET!);
  const now = Math.floor(Date.now() / 1000);
  return await new SignJWT({
    access_key: process.env.HMS_APP_ACCESS_KEY!,
    type: "management",
    version: 2,
    jti: randomUUID(),
    iat: now,
    nbf: now,
    exp: now + 60 * 10, // 10 min
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .sign(secret);
}

export async function createHmsRoom(sessionId: string) {
  const mgmt = await managementToken();
  const res = await fetch(`${HMS_API}/rooms`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${mgmt}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: `support-${sessionId}`,
      template_id: process.env.HMS_TEMPLATE_ID!,
    }),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`100ms room create failed: ${res.status} ${txt}`);
  }
  return (await res.json()) as { id: string; name: string };
}

// Generate a client auth token for a specific user + role in a room.
// This is the token the 100ms client SDK uses to join.
export async function createHmsAuthToken(opts: {
  roomId: string;
  userId: string;
  role: "agent" | "customer";
}) {
  const secret = new TextEncoder().encode(process.env.HMS_APP_SECRET!);
  const now = Math.floor(Date.now() / 1000);
  return await new SignJWT({
    access_key: process.env.HMS_APP_ACCESS_KEY!,
    type: "app",
    version: 2,
    room_id: opts.roomId,
    user_id: opts.userId,
    role: opts.role,
    jti: randomUUID(),
    iat: now,
    nbf: now,
    exp: now + 60 * 60 * 24, // 24h — plenty for a support session
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .sign(secret);
}

export async function disableHmsRoom(roomId: string) {
  const mgmt = await managementToken();
  await fetch(`${HMS_API}/rooms/${roomId}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${mgmt}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ enabled: false }),
  }).catch(() => {
    // best effort — we still mark session completed in DB
  });
}
