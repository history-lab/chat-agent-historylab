// tools.ts
// Tool definitions calling History Lab APIs directly over HTTP.
// No Cloudflare R2 / Vectorize bindings required.

import { tool } from "ai";
import { z } from "zod";

import { agentContext } from "./server";
import { logDebug, logInfo, logError } from "./shared";

const VECTOR_API_URL = "https://vector-search-worker.nchimicles.workers.dev";
const CORPUS_API_URL = "https://api.foiarchive.org";
const COLLECTION_ID = "80650a98-fe49-429a-afbd-9dde66e2d02b";

function getAgent() {
  const agent = agentContext.getStore();
  if (!agent) {
    throw new Error("Agent not found");
  }
  return agent;
}

function getVectorApiKey(): string {
  const key = getAgent().getVectorApiKey();
  if (!key) {
    throw new Error("VECTOR_API_KEY secret is not configured");
  }
  return key;
}

async function vectorFetch(path: string, body?: any) {
  const opts: RequestInit = {
    headers: {
      Authorization: `Bearer ${getVectorApiKey()}`,
      "Content-Type": "application/json",
    },
  };
  if (body) {
    opts.method = "POST";
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(`${VECTOR_API_URL}${path}`, opts);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Vector API ${res.status}: ${text}`);
  }
  return res.json() as Promise<any>;
}

async function corpusFetch(
  path: string,
  params: Record<string, string> = {},
): Promise<{ data: any; total?: number }> {
  const url = new URL(`${CORPUS_API_URL}${path}`);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.append(k, v);
  }
  const res = await fetch(url.toString(), { headers: { Prefer: "count=exact" } });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Corpus API ${res.status}: ${text}`);
  }
  const data = await res.json();
  const contentRange = res.headers.get("Content-Range");
  const total = contentRange ? parseInt(contentRange.split("/")[1]) : undefined;
  return { data, total };
}

function dateToNum(date: string): number {
  return parseInt(date.replace(/-/g, ""), 10);
}
function dateToYM(date: string): number {
  const [y, m] = date.split("-");
  return parseInt(`${y}${m}`, 10);
}

// ─── Search Tools ───────────────────────────────────────────────

const vectorSearch = tool({
  description:
    "Semantic search across ~5M declassified documents using natural language. Best for exploratory queries. For complex topics, make MULTIPLE separate calls with focused queries.",
  inputSchema: z.object({
    query: z.string().describe("Natural language search query - be specific with names, places, events"),
    limit: z.number().min(1).max(100).default(10).describe("Number of results (default 10)"),
    date_from: z.string().optional().describe("Start date filter (YYYY-MM-DD)"),
    date_to: z.string().optional().describe("End date filter (YYYY-MM-DD)"),
  }),
  execute: async ({ query, limit, date_from, date_to }) => {
    logInfo("vectorSearch", `Searching: "${query}"`, { limit, date_from, date_to });
    try {
      const filters: Record<string, any> = {};
      if (date_from || date_to) {
        const useDayLevel = (date_from && date_from.length === 10) || (date_to && date_to.length === 10);
        if (useDayLevel) {
          filters.authored_year_month_day = {};
          if (date_from) filters.authored_year_month_day.$gte = dateToNum(date_from);
          if (date_to) filters.authored_year_month_day.$lte = dateToNum(date_to);
        } else {
          filters.authored_year_month = {};
          if (date_from) filters.authored_year_month.$gte = dateToYM(date_from);
          if (date_to) filters.authored_year_month.$lte = dateToYM(date_to);
        }
      }
      const result = await vectorFetch("/api/search", {
        queries: query,
        collection_id: COLLECTION_ID,
        topK: limit || 10,
        ...(Object.keys(filters).length > 0 ? { filters } : {}),
      });
      logInfo("vectorSearch", `Returned ${result?.documents?.length || 0} results`);
      return result;
    } catch (error: any) {
      logError("vectorSearch", "Search failed", error);
      return { error: error.message };
    }
  },
});

const corpusSearch = tool({
  description:
    "Full-text search with filters for corpus, classification level, and date ranges. Use when you need to search a specific collection (e.g., CIA, FRUS, cables) or filter by classification.",
  inputSchema: z.object({
    query: z.string().describe("Full-text search query"),
    title: z.string().optional().describe("Filter by document title (partial match)"),
    corpus: z
      .string()
      .optional()
      .describe("Collection: frus, cables, cia, clinton, briefing, cfpf, kissinger, nato, un, worldbank, cabinet, cpdoc"),
    classification: z
      .string()
      .optional()
      .describe("Classification level: top secret, secret, confidential, unclassified, etc."),
    date_from: z.string().optional().describe("Start date (YYYY-MM-DD)"),
    date_to: z.string().optional().describe("End date (YYYY-MM-DD)"),
    limit: z.number().min(1).max(100).default(25).describe("Number of results"),
    offset: z.number().default(0).describe("Offset for pagination"),
  }),
  execute: async ({ query, title, corpus, classification, date_from, date_to, limit, offset }) => {
    logInfo("corpusSearch", `Searching corpus: "${query}"`, { corpus, classification, date_from, date_to });
    try {
      const params: Record<string, string> = {
        select: "doc_id,corpus,title,authored,classification,body",
        order: "authored.desc.nullslast",
        limit: String(limit || 25),
        offset: String(offset || 0),
      };
      if (query) params["full_text"] = `plfts.${query.replace(/\s+/g, "+")}`;
      if (title) params["title"] = `ilike.*${title}*`;
      if (corpus) params["corpus"] = `eq.${corpus}`;
      if (classification) params["classification"] = `eq.${classification}`;
      if (date_from) params["authored"] = `gte.${date_from}`;
      if (date_to) {
        // PostgREST allows duplicate keys via URL.searchParams.append
        if (params["authored"]) {
          const existing = params["authored"];
          delete params["authored"];
          const url = new URL(`${CORPUS_API_URL}/docs`);
          for (const [k, v] of Object.entries(params)) {
            url.searchParams.append(k, v);
          }
          url.searchParams.append("authored", existing);
          url.searchParams.append("authored", `lt.${date_to}`);
          const res = await fetch(url.toString(), { headers: { Prefer: "count=exact" } });
          if (!res.ok) throw new Error(`Corpus API ${res.status}: ${await res.text()}`);
          const data: any = await res.json();
          const contentRange = res.headers.get("Content-Range");
          const total = contentRange ? parseInt(contentRange.split("/")[1]) : undefined;
          logInfo("corpusSearch", `Returned ${data?.length || 0} results (total: ${total})`);
          return { data, total };
        } else {
          params["authored"] = `lt.${date_to}`;
        }
      }
      const result = await corpusFetch("/docs", params);
      logInfo("corpusSearch", `Returned ${result.data?.length || 0} results (total: ${result.total})`);
      return result;
    } catch (error: any) {
      logError("corpusSearch", "Search failed", error);
      return { error: error.message };
    }
  },
});

const frusSearch = tool({
  description:
    "Search Foreign Relations of the United States (FRUS) diplomatic records. 312K documents from 1620-1989. Supports filtering by sender, recipient, and location.",
  inputSchema: z.object({
    query: z.string().optional().describe("Full-text search query"),
    from: z.string().optional().describe("Sender name (e.g., 'Kissinger')"),
    to: z.string().optional().describe("Recipient name (e.g., 'Nixon')"),
    location: z.string().optional().describe("Location filter"),
    date_from: z.string().optional().describe("Start date (YYYY-MM-DD)"),
    date_to: z.string().optional().describe("End date (YYYY-MM-DD)"),
    limit: z.number().min(1).max(100).default(25).describe("Number of results"),
    offset: z.number().default(0).describe("Offset for pagination"),
  }),
  execute: async ({ query, from, to, location, date_from, date_to, limit, offset }) => {
    logInfo("frusSearch", "Searching FRUS", { query, from, to, location });
    try {
      const params: Record<string, string> = {
        select: "doc_id,title,p_from,p_to,location,authored,classification",
        order: "authored.desc.nullslast",
        limit: String(limit || 25),
        offset: String(offset || 0),
      };
      if (query) params["full_text"] = `plfts.${query.replace(/\s+/g, "+")}`;
      if (from) params["p_from"] = `ilike.*${from}*`;
      if (to) params["p_to"] = `ilike.*${to}*`;
      if (location) params["location"] = `ilike.*${location}*`;
      if (date_from) params["authored"] = `gte.${date_from}`;
      if (date_to) {
        if (params["authored"]) {
          const existing = params["authored"];
          delete params["authored"];
          const url = new URL(`${CORPUS_API_URL}/docs_frus`);
          for (const [k, v] of Object.entries(params)) {
            url.searchParams.append(k, v);
          }
          url.searchParams.append("authored", existing);
          url.searchParams.append("authored", `lt.${date_to}`);
          const res = await fetch(url.toString(), { headers: { Prefer: "count=exact" } });
          if (!res.ok) throw new Error(`Corpus API ${res.status}: ${await res.text()}`);
          const data: any = await res.json();
          const contentRange = res.headers.get("Content-Range");
          const total = contentRange ? parseInt(contentRange.split("/")[1]) : undefined;
          logInfo("frusSearch", `Returned ${data?.length || 0} results (total: ${total})`);
          return { data, total };
        } else {
          params["authored"] = `lt.${date_to}`;
        }
      }
      const result = await corpusFetch("/docs_frus", params);
      logInfo("frusSearch", `Returned ${result.data?.length || 0} results (total: ${result.total})`);
      return result;
    } catch (error: any) {
      logError("frusSearch", "Search failed", error);
      return { error: error.message };
    }
  },
});

// ─── Document Tools ─────────────────────────────────────────────

const getDocument = tool({
  description: "Fetch the full text and metadata of a specific document by its document ID or R2 key.",
  inputSchema: z.object({
    doc_id: z.string().optional().describe("Document ID (e.g., 'CIA-RDP79T00429A001400010019-1')"),
    r2_key: z.string().optional().describe("R2 storage key path for the document"),
    enriched: z.boolean().default(false).describe("Include entities and topics if true"),
  }),
  execute: async ({ doc_id, r2_key, enriched }) => {
    logInfo("getDocument", "Fetching document", { doc_id, r2_key, enriched });
    try {
      if (r2_key) {
        return await vectorFetch(`/api/document/${r2_key}`);
      }
      if (doc_id) {
        const endpoint = enriched ? "/documents" : "/docs";
        const params: Record<string, string> = { doc_id: `eq.${doc_id}` };
        params.select = enriched
          ? "doc_id,corpus,title,authored,classification,body,entities,topics"
          : "doc_id,corpus,title,authored,classification,body";
        const result = await corpusFetch(endpoint, params);
        return result.data?.[0] || { error: "Document not found" };
      }
      return { error: "Either doc_id or r2_key is required" };
    } catch (error: any) {
      logError("getDocument", "Fetch failed", error);
      return { error: error.message };
    }
  },
});

// ─── Entity Tools ───────────────────────────────────────────────

const entityLookup = tool({
  description:
    "Look up named entities (people, places, organizations) mentioned in the archive. Returns entities with document counts.",
  inputSchema: z.object({
    query: z.string().describe("Entity name to search for (e.g., 'Castro', 'Saigon')"),
    group: z.enum(["PERSON", "LOC", "ORG", "OTHER"]).optional().describe("Entity type filter"),
    limit: z.number().min(1).max(100).default(25).describe("Number of results"),
  }),
  execute: async ({ query, group, limit }) => {
    logInfo("entityLookup", `Looking up entity: "${query}"`, { group });
    try {
      const params: Record<string, string> = {
        entity: `ilike.*${query}*`,
        order: "doc_cnt.desc",
        limit: String(limit || 25),
        select: "entity_id,entity,entity_group,doc_cnt",
      };
      if (group) params["entity_group"] = `eq.${group}`;
      const result = await corpusFetch("/entities", params);
      logInfo("entityLookup", `Found ${result.data?.length || 0} entities`);
      return result;
    } catch (error: any) {
      logError("entityLookup", "Lookup failed", error);
      return { error: error.message };
    }
  },
});

const entityDocuments = tool({
  description: "Get documents associated with a specific entity (by entity_id from entityLookup results).",
  inputSchema: z.object({
    entity_id: z.number().describe("Entity ID from entityLookup results"),
    limit: z.number().min(1).max(100).default(25).describe("Number of results"),
    offset: z.number().default(0).describe("Offset for pagination"),
  }),
  execute: async ({ entity_id, limit, offset }) => {
    logInfo("entityDocuments", `Fetching docs for entity ${entity_id}`);
    try {
      const params: Record<string, string> = {
        entity_id: `eq.${entity_id}`,
        select: "doc_id,corpus,title,authored",
        order: "authored.desc.nullslast",
        limit: String(limit || 25),
        offset: String(offset || 0),
      };
      const result = await corpusFetch("/entity_docs", params);
      logInfo("entityDocuments", `Found ${result.data?.length || 0} documents`);
      return result;
    } catch (error: any) {
      logError("entityDocuments", "Fetch failed", error);
      return { error: error.message };
    }
  },
});

// ─── Browse & Stats Tools ───────────────────────────────────────

const listCorpora = tool({
  description: "List all available document collections with their statistics.",
  inputSchema: z.object({}),
  execute: async () => {
    logInfo("listCorpora", "Fetching corpora list");
    try {
      return await corpusFetch("/corpora", { select: "*", order: "corpus" });
    } catch (error: any) {
      logError("listCorpora", "Fetch failed", error);
      return { error: error.message };
    }
  },
});

const browseTopics = tool({
  description: "Explore LDA topic models by corpus. Shows topic keywords and top documents.",
  inputSchema: z.object({
    corpus: z.string().describe("Corpus to browse topics for (e.g., 'cia', 'frus')"),
    topic_id: z.number().optional().describe("Specific topic ID to get details and documents"),
    limit: z.number().min(1).max(50).default(20).describe("Number of results"),
  }),
  execute: async ({ corpus, topic_id, limit }) => {
    logInfo("browseTopics", `Browsing topics for ${corpus}`, { topic_id });
    try {
      if (topic_id !== undefined) {
        return await corpusFetch("/topic_docs", {
          topic_id: `eq.${topic_id}`,
          select: "doc_id,corpus,title,authored,weight",
          order: "weight.desc",
          limit: String(limit || 20),
        });
      }
      return await corpusFetch("/topics", {
        corpus: `eq.${corpus}`,
        select: "topic_id,corpus,words,word_weights",
        order: "topic_id",
        limit: String(limit || 20),
      });
    } catch (error: any) {
      logError("browseTopics", "Fetch failed", error);
      return { error: error.message };
    }
  },
});

const archiveStats = tool({
  description: "Get aggregate statistics about the archive: total documents, breakdown by decade, or classification levels.",
  inputSchema: z.object({
    type: z.enum(["totals", "decades", "classifications"]).default("totals").describe("Type of statistics"),
  }),
  execute: async ({ type }) => {
    logInfo("archiveStats", `Fetching stats: ${type}`);
    try {
      const endpoints: Record<string, string> = {
        totals: "/totals",
        decades: "/totals_decade",
        classifications: "/classifications",
      };
      return await corpusFetch(endpoints[type] || "/totals", { select: "*" });
    } catch (error: any) {
      logError("archiveStats", "Fetch failed", error);
      return { error: error.message };
    }
  },
});

// ─── Feedback Tool ──────────────────────────────────────────────

const submitFeedback = tool({
  description:
    "Submit a feedback report for technical issues or user feedback about the service. Use when the user reports a tool failure or expresses frustration. Captures conversation context automatically.",
  inputSchema: z.object({
    description: z
      .string()
      .describe(
        "Detailed description: (1) specific issue, (2) what the user was trying to accomplish, (3) impact on their research.",
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
        if (decoded.length === 3) [userId, collectionId, convoId] = decoded;
      } catch (error) {
        logError("submitFeedback", "Failed to decode agent name", error);
      }

      const reportId = `feedback-${userId}-${convoId}-${Date.now()}`;
      await feedbackKV.put(
        reportId,
        JSON.stringify({
          reportId,
          timestamp: new Date().toISOString(),
          userId,
          collectionId,
          convoId,
          description,
          conversation: filteredConversation,
        }),
      );

      logInfo("submitFeedback", `Saved feedback: ${reportId}`);
      return { success: true, reportId, message: "Thank you for your feedback. A report has been submitted." };
    } catch (error: any) {
      logError("submitFeedback", "Error submitting feedback", error);
      return { success: false, error: "Failed to submit feedback due to an internal error." };
    }
  },
});

// ─── Exports ────────────────────────────────────────────────────

export const tools = {
  vectorSearch,
  corpusSearch,
  frusSearch,
  getDocument,
  entityLookup,
  entityDocuments,
  listCorpora,
  browseTopics,
  archiveStats,
  submitFeedback,
};

// ─── Helpers ────────────────────────────────────────────────────

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
