// models/chat.ts
// Chat Durable Object — handles real-time AI chat backed by streamText + SSE.

import { AsyncLocalStorage } from "node:async_hooks";
import { DurableObject } from "cloudflare:workers";
import {
  streamText,
  convertToModelMessages,
  stepCountIs,
  type UIMessage,
  type LanguageModel,
} from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";

import { logDebug, logInfo, logError } from "../../shared";
import { type Env } from "../types";
import { tools } from "../../tools";
import { useGemini, getSystemPrompt } from "../config";
import { decodeHashedComponents } from "../utils/hash-utils";
import { ConversationLogger } from "../services/conversation-logger";

// ALS exposes the active Chat DO (and thus env) to tool executions.
export const agentContext = new AsyncLocalStorage<Chat>();

const STORAGE_KEY = "messages";

export class Chat extends DurableObject<Env> {
  private conversationLogger: ConversationLogger;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.conversationLogger = new ConversationLogger(env.CONVERSATION_LOGS);
  }

  public getBucket() {
    return this.env.BUCKET;
  }

  public getVectorizeSearch() {
    return this.env.VECTORIZE_SEARCH;
  }

  public getFeedbackKV() {
    return this.env.FEEDBACK_LOGS;
  }

  // Stored messages (for export, feedback hook).
  public get name(): string {
    return this._name ?? "";
  }
  private _name: string | undefined;

  public messages: UIMessage[] = [];

  private async loadMessages(): Promise<UIMessage[]> {
    const stored = await this.ctx.storage.get<UIMessage[]>(STORAGE_KEY);
    this.messages = stored ?? [];
    return this.messages;
  }

  private async saveMessages(msgs: UIMessage[]): Promise<void> {
    this.messages = msgs;
    await this.ctx.storage.put(STORAGE_KEY, msgs);
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    // The hashed name is provided by the worker via the `cf-chat-id` header so
    // the DO knows its own logical identifier for logging + decoding.
    this._name = request.headers.get("cf-chat-id") ?? this._name;

    logDebug("Chat.fetch", "request", { method: request.method, path, name: this._name });

    if (request.method === "GET" && path.endsWith("/messages")) {
      const msgs = await this.loadMessages();
      return Response.json(msgs);
    }

    if (request.method === "POST" && path.endsWith("/messages")) {
      return this.handleChatPost(request);
    }

    return new Response("Not Found", { status: 404 });
  }

  private async handleChatPost(request: Request): Promise<Response> {
    let payload: { messages: UIMessage[] };
    try {
      payload = await request.json<{ messages: UIMessage[] }>();
    } catch (err) {
      logError("Chat.handleChatPost", "Invalid JSON body", err);
      return new Response("Invalid JSON", { status: 400 });
    }

    const incoming = payload.messages ?? [];
    if (incoming.length === 0) {
      return new Response("messages required", { status: 400 });
    }

    await this.saveMessages(incoming);

    // Decode conversation identity for logging
    let userId = "unknown";
    let collectionId = "unknown";
    let convoId = "unknown";
    if (this._name) {
      try {
        const decoded = decodeHashedComponents(this._name);
        userId = decoded.userId;
        collectionId = decoded.collectionId;
        convoId = decoded.convoId;
      } catch (err) {
        logError("Chat.handleChatPost", "Failed to decode name", err, { name: this._name });
      }
    }

    await this.conversationLogger.initConversationLog(userId, collectionId, convoId);

    return agentContext.run(this, async () => {
      let model: LanguageModel;
      if (useGemini) {
        logInfo("Chat.handleChatPost", "Initializing Gemini");
        const googleAI = createGoogleGenerativeAI({
          apiKey: this.env.GOOGLE_GENERATIVE_AI_API_KEY,
        });
        model = googleAI("models/gemini-3.5-flash");
      } else {
        logInfo("Chat.handleChatPost", "Initializing OpenAI");
        const openai = createOpenAI({ apiKey: this.env.OPENAI_API_KEY });
        model = openai("gpt-4o-2024-11-20");
      }

      const modelMessages = await convertToModelMessages(incoming);
      const result = streamText({
        model,
        system: getSystemPrompt(),
        messages: modelMessages,
        tools,
        stopWhen: stepCountIs(10),
        // Cap thinking to keep latency low between tool calls — Gemini 3.x
        // models default to large thinking budgets which add multi-second
        // pauses without visible benefit for this search-and-synthesize flow.
        providerOptions: {
          google: {
            thinkingConfig: { thinkingBudget: 256 },
          },
        },
        onError: (error) => {
          logError("Chat.handleChatPost", "Error in AI stream", error);
        },
        onFinish: async (event) => {
          try {
            await this.conversationLogger.processStreamCompletion(
              event,
              this.messages,
              userId,
              collectionId,
              convoId,
            );
          } catch (err) {
            logError("Chat.handleChatPost", "conversation logger failed", err);
          }
        },
      });

      return result.toUIMessageStreamResponse({
        originalMessages: incoming,
        onFinish: async ({ messages: updated }) => {
          await this.saveMessages(updated);
        },
      });
    });
  }
}
