// server/index.ts
// Main worker entry: routes static handlers + chat DO requests.

import { type Env } from "./types";
import { handleFeedback } from "./handlers/feedback-handler";
import { handleDocumentClick } from "./handlers/document-handler";
import { handleAuthCallback } from "./handlers/auth-handler";

export { Chat } from "./models/chat";

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === "/ping") {
      return new Response("pong", { status: 200 });
    }
    if (path === "/feedback") {
      return handleFeedback(request, env);
    }
    if (path === "/document-click") {
      return handleDocumentClick(request, env);
    }
    if (path === "/auth-callback") {
      return handleAuthCallback(request, env);
    }

    // Chat DO routes: /api/chat/:id/messages
    //   POST → stream a new assistant turn
    //   GET  → list persisted messages
    const chatMatch = path.match(/^\/api\/chat\/([^/]+)\/messages$/);
    if (chatMatch) {
      const hashedId = decodeURIComponent(chatMatch[1]);
      if (!hashedId) {
        return new Response("missing chat id", { status: 400 });
      }
      const stubId = env.Chat.idFromName(hashedId);
      const stub = env.Chat.get(stubId);
      // Forward the request to the DO, attaching the logical id so it can decode
      const forwarded = new Request(request, {
        headers: new Headers(request.headers),
      });
      forwarded.headers.set("cf-chat-id", hashedId);
      return stub.fetch(forwarded);
    }

    return new Response("Not found", { status: 404 });
  },
};
