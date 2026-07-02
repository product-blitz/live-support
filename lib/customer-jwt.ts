import { SignJWT, jwtVerify } from "jose";

const secret = () => new TextEncoder().encode(process.env.CUSTOMER_JWT_SECRET!);

export async function signCustomerToken(sessionId: string) {
  return await new SignJWT({ session_id: sessionId, kind: "customer" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("24h")
    .sign(secret());
}

export async function verifyCustomerToken(
  token: string
): Promise<{ session_id: string } | null> {
  try {
    const { payload } = await jwtVerify(token, secret());
    if (payload.kind !== "customer") return null;
    return { session_id: payload.session_id as string };
  } catch {
    return null;
  }
}
