// models/chat.ts
// Chat Agent implementation that handles real-time AI chat interactions

import {
    type Schedule
  } from "agents-sdk";
import { AsyncLocalStorage } from "node:async_hooks";
import { AIChatAgent } from "agents-sdk/ai-chat-agent";
import {
  createDataStreamResponse,
  generateId,
  streamText,
  type StreamTextOnFinishCallback, 
  type LanguageModelV1,
} from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";

import { processToolCalls } from "../utils/tool-utils";
import { logDebug, logInfo, logError } from "../../shared";
import { type Env, type ConversationLog } from "../types";
import { tools, executions } from "../../tools";
import { COLLECTION_ID, useGemini, getSystemPrompt } from "../config";
import { decodeHashedComponents } from "../utils/hash-utils";
import { ConversationLogger } from "../services/conversation-logger";

// We use ALS to expose the agent context to the tools
export const agentContext = new AsyncLocalStorage<Chat>();

/**
 * Chat Agent implementation that handles real-time AI chat interactions
 */
export class Chat extends AIChatAgent<Env> {
  public env: Env;
  private conversationLogger: ConversationLogger;

  constructor(state: DurableObjectState, env: Env, name?: string) {
    super(state, env);
    this.env = env;
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

  /**
   * Handles incoming chat messages and manages the response stream
   * @param onFinish - Callback function executed when streaming completes
   */
  // biome-ignore lint/complexity/noBannedTypes: <explanation>
  async onChatMessage(onFinish: StreamTextOnFinishCallback<{}>) {
    logInfo("Chat.onChatMessage", "Starting chat message processing");

    // Get the hashed ID from the agent name and decode it
    let userId = "unknown";
    let collectionId = COLLECTION_ID;
    let convoId = "unknown";
    
    if (this.name) {
      try {
        const decodedComponents = decodeHashedComponents(this.name);
        userId = decodedComponents.userId;
        collectionId = decodedComponents.collectionId;
        convoId = decodedComponents.convoId;
        
        logInfo("Chat.onChatMessage", "Successfully decoded conversation components", { 
          userId, 
          collectionId, 
          convoId 
        });
      } catch (error) {
        logInfo("Chat.onChatMessage", "Failed to decode conversation components, using defaults", { 
          error, 
          agentName: this.name 
        });
      }
    } else {
      logInfo("Chat.onChatMessage", "No agent name provided, using default values");
    }
  
    logInfo("Chat.onChatMessage", "Connection info", { 
      userId, 
      collectionId, 
      convoId 
    });  

    // Initialize conversation log
    await this.conversationLogger.initConversationLog(userId, collectionId, convoId);

    // Create a streaming response that handles both text and tool outputs
    return agentContext.run(this, async () => {
      logDebug("Chat.onChatMessage", "Setting up data stream response");
      const dataStreamResponse = createDataStreamResponse({
        execute: async (dataStream) => {          
          logDebug("Chat.onChatMessage", "Processing pending tool calls", { messageCount: this.messages.length });
          // Process any pending tool calls from previous messages
          // This handles human-in-the-loop confirmations for tools
          const processedMessages = await processToolCalls({
            messages: this.messages,
            dataStream,
            tools,
            executions,
          });

          // Declare model variable that will be set in the conditionals
          let model;

          if (useGemini) {
            logInfo("Chat.onChatMessage", "Initializing Gemini client");                              
            // Initialize Google client with API key from environment
            const googleAI = createGoogleGenerativeAI({
              apiKey: this.env.GOOGLE_GENERATIVE_AI_API_KEY
            });
            // NOTE: Gemini 3.x "thinking" models require a thought_signature
            // round-tripped in functionCall parts (see
            // https://ai.google.dev/gemini-api/docs/thought-signatures).
            // The pinned @ai-sdk/google@1.2.10 does not emit it, so multi-step
            // tool calls fail on the second-step request. flash-lite is the
            // non-thinking variant — multi-step tool calls work without the
            // signature.
            model = googleAI("models/gemini-3.1-flash-lite");
          } else {
            logInfo("Chat.onChatMessage", "Initializing OpenAI client");                  
              
            // Initialize OpenAI client with API key from environment
            const openai = createOpenAI({
              apiKey: this.env.OPENAI_API_KEY,
            });

            const model_name = "gpt-4o-2024-11-20";
            // const model_name = "gpt-4o-mini-2024-07-18";

            logDebug("Chat.onChatMessage", "Starting AI stream", { model: model_name });
            model = openai(model_name);
          }

          logDebug("Chat.onChatMessage", "Starting AI stream");
          // Stream the AI response using the model initialized within this scope
          const result = streamText({
            model: model as LanguageModelV1,
            system: getSystemPrompt(),
            messages: processedMessages,
            tools,
            onError: (error) => {
                logError("Chat.onChatMessage", "Error in AI stream", error);                
              },
            onFinish: async (event) => {
              // First, call the original onFinish callback if it exists
              if (onFinish) {
                await onFinish(event as any);                          
              }

              // Use the conversation logger to process and log the stream completion
              await this.conversationLogger.processStreamCompletion(
                event, 
                this.messages, 
                userId, 
                collectionId, 
                convoId
              );
            },
            maxSteps: 10,
          });

          logDebug("Chat.onChatMessage", "Merging AI response stream with tool outputs");
          // Merge the AI response stream with tool execution outputs
          try {
            result.mergeIntoDataStream(dataStream);
          } catch (error) {
            logError("Chat.onChatMessage", "Error merging AI response stream with tool outputs", error);
            // Try to gracefully continue despite merge errors
          }
        },
      });

      return dataStreamResponse;
    });
  }

  async executeTask(description: string, task: Schedule<string>) {
    logInfo("Chat.executeTask", "Executing scheduled task", { description });
    await this.saveMessages([
      ...this.messages,
      {
        id: generateId(),
        role: "user",
        content: `scheduled message: ${description}`,
      },
    ]);
    logDebug("Chat.executeTask", "Task execution completed");
  }
} 