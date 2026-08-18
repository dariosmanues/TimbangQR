import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SignJWT, jwtVerify } from "jose";
import type { SessionUser } from "./types";

const COOKIE_NAME = "timbang_session";

function secretKey() {
  const raw = process.env.JWT_SECRET || "dev-only-change-this-jwt-secret-minimum-32";
  return new TextEncoder().encode(raw);
}

export async function setSession(user: SessionUser) {
  const token = await new SignJWT({ user })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("12h")
    .sign(secretKey());

  const store = await cookies();
  store.set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.COOKIE_SECURE === "true" || process.env.APP_URL?.startsWith("https://") === true,
    path: "/",
    maxAge: 60 * 60 * 12,
  });
}

export async function clearSession() {
  const store = await cookies();
  store.delete(COOKIE_NAME);
}

export async function getSession(): Promise<SessionUser | null> {
  const store = await cookies();
  const token = store.get(COOKIE_NAME)?.value;
  if (!token) return null;

  try {
    const result = await jwtVerify(token, secretKey());
    return (result.payload.user as SessionUser) ?? null;
  } catch {
    return null;
  }
}

export async function requireUser(): Promise<SessionUser> {
  const user = await getSession();
  if (!user) {
    redirect("/login");
    throw new Error("Redirecting to login");
  }
  return user;
}
