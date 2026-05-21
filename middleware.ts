import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

// Only protect operator routes (require sign-in). Everything else — the public
// social surface, sign-in pages, API endpoints, webhooks — is open. Endpoints
// that need their own auth (/api/agent/* uses API keys; /api/inngest signs its
// own requests) check it themselves.
const isProtected = createRouteMatcher(["/operator(.*)"]);

export default clerkMiddleware(async (auth, req) => {
  if (isProtected(req)) {
    // Redirect unauthenticated users to /sign-in instead of returning 404.
    const { userId, redirectToSignIn } = await auth();
    if (!userId) return redirectToSignIn();
  }
});

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
