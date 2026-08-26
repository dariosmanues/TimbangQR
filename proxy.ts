import { NextRequest, NextResponse } from "next/server";

const PREVIEW_ALLOWED_PAGES = new Set(["/login", "/scan"]);

function isPreview() {
  return (process.env.VERCEL_ENV || "").trim().toLowerCase() === "preview";
}

export function proxy(request: NextRequest) {
  if (!isPreview()) return NextResponse.next();

  const { pathname } = request.nextUrl;
  const method = request.method.toUpperCase();

  if (pathname.startsWith("/_next/") || pathname === "/favicon.ico") {
    return NextResponse.next();
  }

  if (pathname === "/api/auth/login" && method === "POST") {
    return NextResponse.next();
  }
  if (pathname === "/api/auth/logout" && method === "POST") {
    return NextResponse.next();
  }
  if (pathname === "/api/serial/latest" && method === "GET") {
    return NextResponse.next();
  }
  if (pathname.startsWith("/api/qr/") && method === "GET") {
    return NextResponse.next();
  }

  if (pathname.startsWith("/api/")) {
    return NextResponse.json(
      { error: "Vercel Preview berjalan dalam mode read-only. Mutation API dinonaktifkan." },
      { status: 403 }
    );
  }

  if (PREVIEW_ALLOWED_PAGES.has(pathname)) {
    return NextResponse.next();
  }

  const target = request.nextUrl.clone();
  target.pathname = "/scan";
  target.search = "";
  return NextResponse.redirect(target);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
