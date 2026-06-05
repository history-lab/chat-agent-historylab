// services/conversation-logger.ts
// Service for handling conversation logging functionality

import { type UIMessage } from "ai";

// Local alias keeps the rest of the file readable while we migrate from
// AI SDK v4's `Message` to v6's `UIMessage`.
type Message = UIMessage & { content?: string; createdAt?: string | Date };
import { logDebug, logInfo, logError } from "../../shared";
import { type ConversationLog } from "../types";

export class ConversationLogger {
  private conversationLog: ConversationLog | null = null;
  private readonly conversationLogsKV: KVNamespace;
  
  constructor(conversationLogsKV: KVNamespace) {
    this.conversationLogsKV = conversationLogsKV;
  }
  
  /**
   * Initialize or retrieve the conversation log
   */
  public async initConversationLog(userId: string, collectionId: string, convoId: string): Promise<ConversationLog> {
    // Generate a unique ID for this conversation if we don't have one
    const conversationId = `${userId}-${collectionId}-${convoId}`;
    
    // Check if we already have a log for this conversation
    try {
      const existingLog = await this.conversationLogsKV.get(conversationId, 'json');
      if (existingLog) {
        logInfo("ConversationLogger.initConversationLog", "Retrieved existing conversation log", { conversationId });
        this.conversationLog = existingLog as ConversationLog;
        return this.conversationLog;
      }
    } catch (kvError) {
      logError("ConversationLogger.initConversationLog", "Error retrieving conversation log from KV", kvError, { conversationId });
      // Proceed to create a new log if retrieval fails
    }
    
    // Create a new conversation log
    const now = new Date().toISOString();
    const newLog: ConversationLog = {
      id: conversationId,
      createdAt: now,
      updatedAt: now,
      userId,
      collectionId,
      convoId,
      messageCount: 0,
      toolCalls: {
        total: 0,
        byType: {}
      },
      queries: {
        total: 0,
        withToolCalls: 0,
        withoutToolCalls: 0,
        details: []
      },
      characters: {
        input: 0,
        output: 0
      },
      messageObjects: [],
      documentClicks: []
    };
    
    // Store the new log
    try {
      await this.conversationLogsKV.put(conversationId, JSON.stringify(newLog));
      logInfo("ConversationLogger.initConversationLog", "Created new conversation log", { conversationId });
    } catch (kvError) {
      logError("ConversationLogger.initConversationLog", "Error saving new conversation log to KV", kvError, { conversationId });
      // If saving fails, the log will be null, which might affect subsequent updates, but we proceed
    }
    
    this.conversationLog = newLog;
    return newLog;
  }
  
  /**
   * Update the conversation log with new stats
   */
  public async updateConversationLog(stats: Partial<ConversationLog>): Promise<void> {
    if (!this.conversationLog) {
      logInfo("ConversationLogger.updateConversationLog", "No conversation log to update");
      return;
    }
    
    // Update the conversation log
    this.conversationLog = {
      ...this.conversationLog,
      ...stats,
      updatedAt: new Date().toISOString()
    };
    
    // Store the updated log
    try {
      await this.conversationLogsKV.put(this.conversationLog.id, JSON.stringify(this.conversationLog));
      logDebug("ConversationLogger.updateConversationLog", "Updated conversation log", { id: this.conversationLog.id });
    } catch (kvError) {
      logError("ConversationLogger.updateConversationLog", "Error saving updated conversation log to KV", kvError, { id: this.conversationLog.id });
    }
  }

  /**
   * Extract and process stream completion data for logging
   */
  public async processStreamCompletion(
    event: any, 
    messages: Message[], 
    userId: string, 
    collectionId: string, 
    convoId: string
  ): Promise<void> {
    if (!this.conversationLog) {
      logInfo("ConversationLogger.processStreamCompletion", "No conversation log to update");
      return;
    }

    logInfo("ConversationLogger.processStreamCompletion", "Processing stream completion", { 
      steps: event.steps.length,
      userId,
      collectionId,
      convoId
    });
    
    // Count tool calls and track stats
    const toolCallsByType: Record<string, number> = {};
    const totalToolCalls = event.steps.reduce((count: number, step: any) => {
      // Count tool calls across all steps
      if (step.toolCalls && step.toolCalls.length > 0) {
        step.toolCalls.forEach((toolCall: any) => {
          const toolName = toolCall.toolName;
          toolCallsByType[toolName] = (toolCallsByType[toolName] || 0) + 1;
        });
        return count + step.toolCalls.length;
      }
      return count;
    }, 0);
    
    // Extract query details for logging
    const queryDetails = this.extractQueryDetails(messages);
    
    // Get the last assistant message and user message
    const lastAssistantMessage = messages.findLast(m => m.role === 'assistant');
    const assistantMessageIndex = messages.length - 1; // Index of the last message (assistant)
    
    // Find the triggering user message
    const lastUserMessageIndex = messages.length - 2; // Last user message before the assistant response
    const lastUserMessage = messages[lastUserMessageIndex];
    
    // Log all messages for debugging ID issues
    logDebug("ConversationLogger.processStreamCompletion", "Messages array", { 
      messageCount: messages.length,
      messageIds: messages.map(m => ({ role: m.role, id: m.id, createdAt: m.createdAt }))
    });
    
    // Create log message objects
    const messageObjects = this.createMessageObjects(lastUserMessage, lastAssistantMessage, lastUserMessageIndex, assistantMessageIndex);
    
    // Calculate character counts
    const { userInputChars, assistantOutputChars } = this.calculateCharacterCounts(lastUserMessage, lastAssistantMessage);
    
    // Check if this query used tool calls
    const queryHadToolCalls = totalToolCalls > 0;
    
    // Update the conversation log with the new stats
    await this.updateConversationLog({
      messageCount: messages.length,
      toolCalls: {
        total: this.conversationLog.toolCalls.total + totalToolCalls,
        byType: Object.entries(toolCallsByType).reduce((merged, [key, value]) => {
          merged[key] = (this.conversationLog?.toolCalls.byType[key] || 0) + value;
          return merged;
        }, { ...this.conversationLog.toolCalls.byType })
      },
      queries: {
        total: this.conversationLog.queries.total + 1,
        withToolCalls: this.conversationLog.queries.withToolCalls + (queryHadToolCalls ? 1 : 0),
        withoutToolCalls: this.conversationLog.queries.withoutToolCalls + (queryHadToolCalls ? 0 : 1),
        details: [...this.conversationLog.queries.details, ...queryDetails]
      },
      characters: {
        input: this.conversationLog.characters.input + userInputChars,
        output: this.conversationLog.characters.output + assistantOutputChars
      },
      messageObjects: [...(this.conversationLog.messageObjects || []), ...messageObjects]
    });

    // Log the messages so we can verify the IDs being captured
    logDebug("ConversationLogger.processStreamCompletion", "Saved message objects", {
      userMsgId: messageObjects[0]?.id,
      assistantMsgId: messageObjects[1]?.id, 
    });
    
    // Log minimal completion info as debug
    logDebug("ConversationLogger.processStreamCompletion", "Stream processing finished", { 
      userId, convoId, totalToolCalls, totalSteps: event.steps.length 
    });
  }

  /**
   * Create message objects for logging from user and assistant messages
   */
  private extractTextFromParts(message: Message | undefined): string {
    if (!message || !Array.isArray(message.parts)) return "";
    return message.parts
      .filter((p: any) => p?.type === "text")
      .map((p: any) => p.text ?? "")
      .join("\n\n");
  }

  private createMessageObjects(
    lastUserMessage: Message | undefined,
    lastAssistantMessage: Message | undefined,
    lastUserMessageIndex: number,
    assistantMessageIndex: number,
  ): ConversationLog['messageObjects'] {
    const userText = this.extractTextFromParts(lastUserMessage);
    const truncatedUserMessage = userText.length > 1000 ? userText.substring(0, 1000) + "..." : userText;

    const userMsgObj: ConversationLog['messageObjects'][number] | null = lastUserMessage ? {
      index: lastUserMessageIndex,
      role: 'user',
      id: lastUserMessage.id || `msg-${lastUserMessageIndex}`,
      content: truncatedUserMessage,
      timestamp: new Date(lastUserMessage.createdAt ?? Date.now()).toISOString(),
    } : null;

    const assistantText = this.extractTextFromParts(lastAssistantMessage);
    const truncatedAssistantMessage = assistantText.length > 4000
      ? assistantText.substring(0, 4000) + "..."
      : assistantText;

    const assistantMsgObj: ConversationLog['messageObjects'][number] | null = lastAssistantMessage ? {
      index: assistantMessageIndex,
      role: 'assistant',
      id: lastAssistantMessage.id,
      content: truncatedAssistantMessage,
      timestamp: new Date(lastAssistantMessage.createdAt ?? Date.now()).toISOString(),
      feedback: null,
    } : null;

    return [userMsgObj, assistantMsgObj].filter(Boolean) as ConversationLog['messageObjects'];
  }

  private calculateCharacterCounts(
    lastUserMessage: Message | undefined,
    lastAssistantMessage: Message | undefined,
  ): { userInputChars: number; assistantOutputChars: number } {
    return {
      userInputChars: this.extractTextFromParts(lastUserMessage).length,
      assistantOutputChars: this.extractTextFromParts(lastAssistantMessage).length,
    };
  }

  /**
   * Extract query details from message parts
   */
  private extractQueryDetails(messages: Message[]): ConversationLog['queries']['details'] {
    const queryDetails: ConversationLog['queries']['details'] = [];
    
    const lastAssistantMessage = messages.findLast(m => m.role === 'assistant');
    const lastUserMessageIndex = messages.length - 2; // Last user message before the assistant response
    const lastUserMessage = messages[lastUserMessageIndex];
    
    // Extract query details from message parts.
    // v6 represents tool invocations as discriminated parts with `type: \`tool-${toolName}\``,
    // `state`, `input`, and `output` fields.
    if (lastAssistantMessage && Array.isArray(lastAssistantMessage.parts)) {
      lastAssistantMessage.parts.forEach((part: any) => {
        if (part?.type !== "tool-queryCollection") return;
        if (part.state !== "output-available") {
          logDebug("ConversationLogger.extractQueryDetails", "Skipping tool part without output", {
            toolCallId: part.toolCallId,
            state: part.state,
          });
          return;
        }
        const args = part.input || {};
        const result = part.output || {};
        const queryDetail: ConversationLog['queries']['details'][number] = {
          toolCallId: part.toolCallId || '',
          timestamp: new Date().toISOString(),
          query: args.query || '',
          userMessageIndex: lastUserMessageIndex,
          userMessageId: lastUserMessage?.id || '',
          dateFilters: {
            authored_start_year_month: args.authored_start_year_month,
            authored_end_year_month: args.authored_end_year_month,
            authored_start_year_month_day: args.authored_start_year_month_day,
            authored_end_year_month_day: args.authored_end_year_month_day,
          },
          documentResults: [],
        };

        if ((result.status === "success" || result.status === "partial_success") && Array.isArray(result.documents)) {
          queryDetail.documentResults = this.extractDocumentResults(result.documents);
        } else if (result.status && result.status !== "success") {
          logInfo("ConversationLogger.extractQueryDetails", "Query Collection tool did not succeed", {
            toolCallId: part.toolCallId,
            status: result.status,
          });
        }

        queryDetails.push(queryDetail);
      });
    }
    
    return queryDetails;
  }

  /**
   * Extract document results from query response
   */
  private extractDocumentResults(documents: any[]): ConversationLog['queries']['details'][number]['documentResults'] {
    return documents.map((doc: any) => {
      // Extract chunk IDs, scores, and truncated texts from the document's chunks
      const chunkIds: string[] = [];
      
      if (doc.chunks && Array.isArray(doc.chunks)) {
        doc.chunks.forEach((chunk: any) => {
          if (chunk.id) {
            chunkIds.push(chunk.id);
          }
        });
      }
      
      // Include more metadata from the document and file_info for better analysis
      return {
        doc_id: doc.file_info?.metadata?.doc_id || '', // Document ID like "Clinton-82559"
        best_score: doc.best_score || 0,
        chunk_ids: chunkIds,
        file_id: doc.file_info?.id || '', // File ID (UUID)
        file_r2key: doc.file_info?.r2Key || '', // The R2 key path
        metadata: { // Extract relevant metadata from file_info.metadata
          title: doc.file_info?.metadata?.title || '',
          authored_date: doc.file_info?.metadata?.authored || doc.file_info?.metadata?.date || '', // Check multiple fields for date
          classification: doc.file_info?.metadata?.classification || ''
        }
      };
    });
  }

  /**
   * Get the current conversation log
   */
  public getConversationLog(): ConversationLog | null {
    return this.conversationLog;
  }
} 