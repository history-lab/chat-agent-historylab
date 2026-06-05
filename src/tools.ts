// tools.ts
// Tool definitions for the AI chat agent.

import { tool } from "ai";
import { z } from "zod";

import { agentContext } from "./server";
import { logDebug, logInfo, logError } from "./shared";

function getAgent() {
  const agent = agentContext.getStore();
  if (!agent) {
    throw new Error("Agent not found");
  }
  return agent;
}

const getDocumentText = tool({
  description: "get the text of a given document from the R2 bucket",
  inputSchema: z.object({ r2Key: z.string() }),
  execute: async ({ r2Key }) => {
    logInfo("getDocumentText", `Getting document text for document: ${r2Key}`);
    try {
      const agent = getAgent();
      const bucket = agent.getBucket();
      const file = await bucket.get(r2Key);
      if (!file) {
        return { error: "File not found" };
      }
      return await file.text();
    } catch (error) {
      logError("getDocumentText", "Error getting document text", error);
      return { error: "Failed to get document text" };
    }
  },
});

const queryCollection = tool({
  description:
    "Perform semantic searches through historical document collections. For complex topics, make MULTIPLE separate tool calls with focused queries. Use narrow date ranges (e.g., ~5 years) when possible, as wider ranges increase error likelihood.",
  inputSchema: z.object({
    query: z
      .string()
      .describe(
        "The semantic search query text - make focused, specific queries rather than combining multiple topics",
      ),
    doc_id: z
      .string()
      .optional()
      .describe("Filter by specific document ID when looking for more information within a document"),
    authored_start_year_month: z
      .string()
      .optional()
      .describe(
        "Start year and month for filtering documents (format: 'YYYY-MM' as string). Preferred for most searches as it's more efficient.",
      ),
    authored_end_year_month: z
      .string()
      .optional()
      .describe(
        "End year and month for filtering documents (format: 'YYYY-MM' as string). Preferred for most searches as it's more efficient.",
      ),
    authored_start_year_month_day: z
      .string()
      .optional()
      .describe(
        "Start date for filtering documents (format: 'YYYY-MM-DD' as string). Only use for highly specific date-sensitive searches.",
      ),
    authored_end_year_month_day: z
      .string()
      .optional()
      .describe(
        "End date for filtering documents (format: 'YYYY-MM-DD' as string). Only use for highly specific date-sensitive searches.",
      ),
  }),
  execute: async ({
    query,
    doc_id,
    authored_start_year_month,
    authored_end_year_month,
    authored_start_year_month_day,
    authored_end_year_month_day,
  }) => {
    logInfo(
      "queryCollection",
      `Querying collection: history-lab-1 with query: ${query}` +
        (doc_id ? `, doc_id: ${doc_id}` : "") +
        (authored_start_year_month ? `, authored_year_month from: ${authored_start_year_month}` : "") +
        (authored_end_year_month ? `, to: ${authored_end_year_month}` : "") +
        (authored_start_year_month_day ? `, authored_year_month_day from: ${authored_start_year_month_day}` : "") +
        (authored_end_year_month_day ? `, to: ${authored_end_year_month_day}` : ""),
    );

    try {
      const agent = getAgent();
      const vectorizeSearch = agent.getVectorizeSearch();

      const k = 5;
      const filters: Record<string, any> = {};
      if (doc_id) {
        filters.doc_id = doc_id;
      }

      const convertYearMonthToNumber = (dateStr: string): number => {
        const [year, month] = dateStr.split("-");
        return parseInt(`${year}${month}`, 10);
      };
      const convertYearMonthDayToNumber = (dateStr: string): number => {
        return parseInt(dateStr.replace(/-/g, ""), 10);
      };

      const hasYearMonthDayParams =
        authored_start_year_month_day || authored_end_year_month_day;

      if (hasYearMonthDayParams) {
        filters.authored_year_month_day = {};
        if (
          authored_start_year_month_day &&
          authored_end_year_month_day &&
          authored_start_year_month_day === authored_end_year_month_day
        ) {
          filters.authored_year_month_day.$eq = convertYearMonthDayToNumber(
            authored_start_year_month_day,
          );
        } else {
          if (authored_start_year_month_day) {
            filters.authored_year_month_day.$gte = convertYearMonthDayToNumber(
              authored_start_year_month_day,
            );
          }
          if (authored_end_year_month_day) {
            filters.authored_year_month_day.$lte = convertYearMonthDayToNumber(
              authored_end_year_month_day,
            );
          }
        }
      } else if (authored_start_year_month || authored_end_year_month) {
        filters.authored_year_month = {};
        if (
          authored_start_year_month &&
          authored_end_year_month &&
          authored_start_year_month === authored_end_year_month
        ) {
          filters.authored_year_month.$eq = convertYearMonthToNumber(
            authored_start_year_month,
          );
        } else {
          if (authored_start_year_month) {
            filters.authored_year_month.$gte = convertYearMonthToNumber(
              authored_start_year_month,
            );
          }
          if (authored_end_year_month) {
            filters.authored_year_month.$lte = convertYearMonthToNumber(
              authored_end_year_month,
            );
          }
        }
      }

      const finalCollectionId = "80650a98-fe49-429a-afbd-9dde66e2d02b"; // history-lab-1

      logDebug(
        "queryCollection",
        `Search request: {queries: "${query}", collection_id: "${finalCollectionId}", topK: ${k}, filters: ${JSON.stringify(filters)}}`,
      );

      const results = await vectorizeSearch.findSimilarEmbeddings(
        query,
        finalCollectionId,
        k,
        Object.keys(filters).length > 0 ? filters : undefined,
      );

      if (results?.error) {
        logError("queryCollection", "Error querying collection", results.error, {
          query,
          doc_id,
        });
      }
      logInfo("queryCollection", `Search returned ${results?.matches?.length || 0} results`);
      logDebug("queryCollection", `Results: ${JSON.stringify(results)}`);
      return results;
    } catch (error) {
      logError("queryCollection", "Error querying collection", error, { query, doc_id });
      return { error: "Failed to query collection" };
    }
  },
});

const submitFeedback = tool({
  description:
    "Submit a feedback report for technical issues or user feedback about the service. Use when the user reports a tool failure, unexpected empty results, or expresses frustration. The tool captures the conversation context automatically.",
  inputSchema: z.object({
    description: z
      .string()
      .describe(
        "Detailed description: (1) the specific issue or feedback, (2) what the user was trying to accomplish, (3) impact on their research.",
      ),
  }),
  execute: async ({ description }) => {
    logInfo("submitFeedback", "Received feedback submission request.");
    try {
      const agent = getAgent();
      const feedbackKV = agent.getFeedbackKV();
      const messages = agent.messages;
      const agentName = agent.name || "unknown-agent";

      const filteredConversation = filterConversationForFeedback(messages);

      let userId = "unknown";
      let collectionId = "unknown";
      let convoId = "unknown";
      try {
        const decoded = Buffer.from(agentName, "base64").toString("utf-8").split("|");
        if (decoded.length === 3) {
          [userId, collectionId, convoId] = decoded;
        }
      } catch (error) {
        logError("submitFeedback", "Failed to decode agent name", error, { agentName });
      }

      const reportId = `feedback-${userId}-${convoId}-${Date.now()}`;
      const feedbackData = {
        reportId,
        timestamp: new Date().toISOString(),
        userId,
        collectionId,
        convoId,
        description,
        conversation: filteredConversation,
      };
      await feedbackKV.put(reportId, JSON.stringify(feedbackData));
      logInfo("submitFeedback", `Successfully saved feedback report: ${reportId}`);
      return {
        success: true,
        reportId,
        message: "Thank you for your feedback. A report has been submitted.",
      };
    } catch (error) {
      logError("submitFeedback", "Error submitting feedback", error, { description });
      return { success: false, error: "Failed to submit feedback due to an internal error." };
    }
  },
});

export const tools = {
  queryCollection,
  getDocumentText,
  submitFeedback,
};

function truncateLargeStrings(data: any, maxLength: number): any {
  if (typeof data === "string") {
    return data.length > maxLength ? data.substring(0, maxLength) + "..." : data;
  }
  if (Array.isArray(data)) {
    return data.map((item) => truncateLargeStrings(item, maxLength));
  }
  if (data !== null && typeof data === "object") {
    const out: Record<string, any> = {};
    for (const key in data) {
      if (Object.prototype.hasOwnProperty.call(data, key)) {
        out[key] = truncateLargeStrings(data[key], maxLength);
      }
    }
    return out;
  }
  return data;
}

// Reduce tool result payloads embedded in messages before persisting them to KV.
function filterConversationForFeedback(messages: any[]) {
  return messages.map((message) => {
    const copy = JSON.parse(JSON.stringify(message));
    const charLimit = 1000;
    if (copy.role === "assistant" && Array.isArray(copy.parts)) {
      copy.parts = copy.parts.map((part: any) => {
        if (typeof part?.type === "string" && part.type.startsWith("tool-") && part.output) {
          try {
            return { ...part, output: truncateLargeStrings(part.output, charLimit) };
          } catch (error) {
            logError("filterConversationForFeedback", "truncate failed", error, { part });
            return { ...part, output: { error: "Failed to truncate tool result content." } };
          }
        }
        return part;
      });
    }
    return copy;
  });
}
