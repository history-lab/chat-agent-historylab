// types.ts
// Types and interfaces used across the server modules

import { type Chat } from "./models/chat";

export type Env = {
  OPENAI_API_KEY: string;
  GOOGLE_GENERATIVE_AI_API_KEY: string;
  BUCKET: R2Bucket;
  Chat: DurableObjectNamespace<Chat>;
  VECTORIZE_SEARCH: {
    findSimilarEmbeddings(
      queries: string | string[],
      collection_id: string,
      topK?: number,
      filters?: Record<string, any>
    ): Promise<{
      status: string;
      matches?: Array<{
        id: string;
        text: string;
        score: number;
        metadata?: Record<string, any>;
      }>;
      message?: string;
      error?: string;
    }>;
  };
  CONVERSATION_LOGS: KVNamespace;
  FEEDBACK_LOGS: KVNamespace;
};

// Type definition for conversation logs
export interface ConversationLog {
  id: string;
  createdAt: string;
  updatedAt: string;
  userId: string;
  collectionId: string;
  convoId: string;
  messageCount: number;
  toolCalls: {
    total: number;
    byType: Record<string, number>;
  };
  queries: {
    total: number;
    withToolCalls: number;
    withoutToolCalls: number;
    details: Array<{
      toolCallId: string;
      timestamp: string;
      query: string;
      userMessageIndex: number;
      userMessageId: string;
      dateFilters?: {
        authored_start_year_month?: string;
        authored_end_year_month?: string;
        authored_start_year_month_day?: string;
        authored_end_year_month_day?: string;
      };
      documentResults?: Array<{
        doc_id: string;
        best_score: number;
        chunk_ids: string[];
        file_id: string;
        file_r2key: string;
        metadata: {
          title: string;
          authored_date: string;
          classification: string;
        };
      }>;
    }>;
  };
  characters: {
    input: number;
    output: number;
  };
  messageObjects: Array<{
    index: number;
    role: 'user' | 'assistant';
    id: string;
    content: string;
    timestamp: string;
    feedback?: 'like' | 'dislike' | null;
  }>;
  documentClicks: Array<{
    r2Key: string;
    timestamp: string;
  }>;
}
