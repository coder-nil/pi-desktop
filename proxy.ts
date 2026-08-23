import { NextResponse, type NextRequest } from "next/server";
import {
  isApiRequestAllowed,
  isApiRequestHostAllowed,
  isUnauthenticatedLoopbackRequest,
} from "@/lib/request-security";
import {
  isValidBasicAuthorization,
  isWebPasswordEnabled,
  recordFailedWebAuthAttempt,
} from "@/lib/web-auth";

declare global {
  var __piFailedWebAuthAttempts: number[] | undefined;
}

function failedWebAuthAttempts(): number[] {
  return globalThis.__piFailedWebAuthAttempts ??= [];
}

function desktopCorsHeaders(request: NextRequest): HeadersInit | undefined {
  const origin = request.headers.get("origin");
  if (!origin || origin !== process.env.PI_WEB_DESKTOP_API_ORIGIN) return undefined;
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    Vary: "Origin",
  };
}

export function proxy(request: NextRequest) {
  const isApiRequest = request.nextUrl.pathname === "/api"
    || request.nextUrl.pathname.startsWith("/api/");
  const isTrustedRequest = isApiRequest
    ? isApiRequestAllowed(request)
    : isApiRequestHostAllowed(request);

  if (!isTrustedRequest) {
    if (!isApiRequest) {
      return new NextResponse("Untrusted request", { status: 403 });
    }
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }

  const corsHeaders = isApiRequest ? desktopCorsHeaders(request) : undefined;
  if (isApiRequest && request.method === "OPTIONS") {
    return new NextResponse(null, { status: 204, headers: corsHeaders });
  }

  const password = process.env.PI_WEB_PASSWORD;
  if (!isUnauthenticatedLoopbackRequest(request) && !isWebPasswordEnabled(password)) {
    return new NextResponse("Authentication is required for non-loopback access", {
      status: 403,
      headers: { "Cache-Control": "no-store" },
    });
  }
  if (
    isWebPasswordEnabled(password)
    && !isValidBasicAuthorization(request.headers.get("authorization"), password)
  ) {
    const failedAttempt = recordFailedWebAuthAttempt(failedWebAuthAttempts());
    if (failedAttempt.rateLimited) {
      return new NextResponse("Too many failed authentication attempts", {
        status: 429,
        headers: {
          "Cache-Control": "no-store",
          "Retry-After": String(failedAttempt.retryAfterSeconds),
        },
      });
    }
    return new NextResponse("Authentication required", {
      status: 401,
      headers: {
        "Cache-Control": "no-store",
        "WWW-Authenticate": 'Basic realm="Pi Desktop", charset="UTF-8"',
      },
    });
  }

  return NextResponse.next({ headers: corsHeaders });
}

export const config = { matcher: ["/", "/api/:path*"] };
