import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { RefreshCw, AlertTriangle, Loader2, ChevronDown } from 'lucide-react';

import ChatHeader from './ChatHeader';
import ChatMessage from './ChatMessage';
import ChatInput from './ChatInput';
import ExampleQueries from './ExampleQueries';
import { useDocumentRegistry, getDocumentViewerUrl } from '../documents/DocumentRegistry';
import { useConversation } from '../../hooks/useConversation';
import { useFeedback } from '../../hooks/useFeedback';
import { useAuth } from '../../hooks/useAuth';
import { AUTH_CONFIG } from '../../config';
import { exportConversation } from '../../utils/exportConversation';

const RESPONSE_TIMEOUT = 5000;

const ChatContainer: React.FC = () => {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLimbo, setIsLimbo] = useState(false);
  const limboTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isFirstConversationRef = useRef(true);
  const inputContainerRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [isBottomVisible, setIsBottomVisible] = useState(true);

  const { user, isAuthenticated } = useAuth();
  const { userId, conversationId, createNewConversation, urlCopied, shareConversationUrl } = useConversation();
  const documentRegistry = useDocumentRegistry();

  // Local input state — v3 useChat no longer manages input.
  const [input, setInput] = useState("");

  // Build extra body data + auth header reactively so the transport stays in sync.
  const buildExtras = useCallback(() => {
    const headers: Record<string, string> = {};
    const body: Record<string, any> = {
      userId,
      annotations: { hello: "world" },
    };
    if (isAuthenticated && user) {
      body.authUser = {
        email: user.email,
        name: user.name || "",
        institution: user.institution || "",
        position: user.position || "",
      };
      const token = sessionStorage.getItem(AUTH_CONFIG.TOKEN_KEY);
      if (token) {
        headers.Authorization = `Bearer ${token}`;
      }
    }
    return { headers, body };
  }, [userId, isAuthenticated, user]);

  // Transport instance is memoised by conversationId so the api URL is correct
  // and rebuildExtras runs per-request via closure.
  const transport = React.useMemo(() => {
    return new DefaultChatTransport<UIMessage>({
      api: `/api/chat/${encodeURIComponent(conversationId)}/messages`,
      credentials: "include",
      headers: () => buildExtras().headers,
      body: () => buildExtras().body,
    });
  }, [conversationId, buildExtras]);

  const {
    messages,
    sendMessage,
    setMessages,
    status,
    stop,
  } = useChat({
    id: conversationId,
    transport,
  });

  // Load persisted history whenever the conversation id changes.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/chat/${encodeURIComponent(conversationId)}/messages`, {
          credentials: "include",
        });
        if (!res.ok) return;
        const initial = (await res.json()) as UIMessage[];
        if (!cancelled && Array.isArray(initial)) {
          setMessages(initial);
        }
      } catch (err) {
        console.error("Failed to load initial messages", err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [conversationId, setMessages]);

  // Initialize the feedback hook
  const { feedbackState, handleFeedback } = useFeedback(conversationId, messages);

  // Reset isSubmitting and clear limbo timeout when status changes
  useEffect(() => {
    if (status === "ready" || status === "error" || status === "streaming") {
      setIsSubmitting(false);
      setIsLimbo(false);
      if (limboTimeoutRef.current) {
        clearTimeout(limboTimeoutRef.current);
        limboTimeoutRef.current = null;
      }
    }
  }, [status]);

  const handleReload = () => {
    window.location.reload();
  };

  const openNewConversation = () => {
    const isInIframe = window !== window.parent;
    if (isInIframe) {
      // Clear messages locally + create a new conversation id.
      setMessages([]);
      createNewConversation();
    } else {
      window.open(window.location.pathname, '_blank', 'noopener,noreferrer');
    }
  };

  const scrollToBottom = useCallback(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
  }, []);

  // Intersection observer for the "scroll to bottom" pill.
  useEffect(() => {
    if (!messagesEndRef.current) return;
    const observer = new IntersectionObserver(
      ([entry]) => setIsBottomVisible(entry.isIntersecting),
      { threshold: 0.1 },
    );
    observer.observe(messagesEndRef.current);
    return () => observer.disconnect();
  }, []);

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (!text) return;

    const isFirstMessage = messages.length === 0;
    isFirstConversationRef.current = isFirstMessage;

    setIsSubmitting(true);
    limboTimeoutRef.current = setTimeout(() => {
      if (isSubmitting) {
        setIsLimbo(true);
      }
    }, RESPONSE_TIMEOUT);

    sendMessage({ role: "user", parts: [{ type: "text", text }] });
    setInput("");
  };

  // If the conversation changes or is cleared, reset the first conversation flag
  useEffect(() => {
    if (messages.length === 0) {
      isFirstConversationRef.current = true;
    }
  }, [messages.length, conversationId]);

  // Reload page if status hangs on submitted (rough liveness check).
  useEffect(() => {
    let timeoutId: NodeJS.Timeout | null = null;
    if (status === 'submitted') {
      timeoutId = setTimeout(() => {
        console.log('Status remained submitted for too long - reloading page');
        window.location.reload();
      }, 10000);
    }
    return () => {
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [status]);

  // Track user activity and reload on inactivity
  useEffect(() => {
    let inactivityTimeout: NodeJS.Timeout | null = null;
    let lastActivityTime = Date.now();
    const resetInactivityTimer = () => {
      lastActivityTime = Date.now();
      if (inactivityTimeout) clearTimeout(inactivityTimeout);
      inactivityTimeout = setTimeout(() => {
        const timeSinceLastActivity = Date.now() - lastActivityTime;
        if (timeSinceLastActivity >= 60000) {
          console.log('Page inactive for 1 minute - reloading');
          window.location.reload();
        }
      }, 60000);
    };
    const activityEvents = ['mousedown', 'mousemove', 'keydown', 'scroll', 'touchstart', 'wheel', 'focus'];
    activityEvents.forEach((eventName) => window.addEventListener(eventName, resetInactivityTimer));
    resetInactivityTimer();
    return () => {
      if (inactivityTimeout) clearTimeout(inactivityTimeout);
      activityEvents.forEach((eventName) => window.removeEventListener(eventName, resetInactivityTimer));
    };
  }, []);

  // Citation styles
  useEffect(() => {
    let citationStyles = `
      .citation {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        background-color: #6CA0D6;
        color: white;
        width: 1.25rem;
        height: 1.25rem;
        border-radius: 50%;
        font-size: 0.7rem;
        font-weight: 500;
        box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
        cursor: pointer;
        margin: 0 0.125rem;
        vertical-align: text-bottom;
        position: relative;
        top: -0.05rem;
        transition: background-color 0.15s, transform 0.15s;
        line-height: 1;
        user-select: none;
      }
      .citation:active {
        transform: scale(0.95);
        background-color: #4a80b0;
      }
    `;
    const hoverStyles = status !== 'streaming' ? `
      .citation:hover {
        background-color: #5a90c0;
        transform: scale(1.1);
      }
    ` : '';
    citationStyles += hoverStyles;
    let styleElement = document.getElementById('citation-styles');
    if (!styleElement) {
      styleElement = document.createElement('style');
      styleElement.id = 'citation-styles';
      document.head.appendChild(styleElement);
    }
    styleElement.textContent = citationStyles;
  }, [status]);

  // Global click handler for citations
  useEffect(() => {
    const handleGlobalCitationClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.classList.contains('citation')) {
        const identifier = target.getAttribute('data-r2key');
        if (identifier) {
          window.open(getDocumentViewerUrl(identifier), '_blank');
        }
      }
    };
    document.addEventListener('click', handleGlobalCitationClick);
    return () => document.removeEventListener('click', handleGlobalCitationClick);
  }, []);

  // Register documents from any tool that returns them. v6 tool parts are
  // `type: \`tool-${name}\``, `state: 'output-available'`, `input`/`output`.
  // Different tools return different shapes:
  //   vectorSearch  → output.documents[] with file_info.r2Key
  //   corpusSearch  → output.data[] with doc_id
  //   frusSearch    → output.data[] with doc_id
  //   entityDocuments / browseTopics → output.data[] with doc_id
  useEffect(() => {
    if (!messages || messages.length === 0) return;
    messages.forEach((message: any) => {
      if (message.role !== 'assistant' || !Array.isArray(message.parts)) return;
      message.parts.forEach((part: any) => {
        if (typeof part?.type !== 'string' || !part.type.startsWith('tool-')) return;
        if (part.state !== 'output-available') return;
        const result = part.output;
        if (!result || typeof result !== 'object') return;

        // vectorSearch: documents[] with file_info.r2Key
        if (Array.isArray(result.documents)) {
          result.documents.forEach((doc: any) => {
            const r2Key = doc.file_info?.r2Key;
            if (r2Key) {
              const title = doc.file_info?.metadata?.title || doc.document_id || `Document`;
              documentRegistry.registerDocument(r2Key, title);
            }
          });
        }

        // corpus / frus / entity / topic tools: data[] with doc_id
        if (Array.isArray(result.data)) {
          result.data.forEach((row: any) => {
            const docId = row?.doc_id;
            if (docId) {
              documentRegistry.registerDocument(docId, row.title || docId);
            }
          });
        }

        // getDocument single result with doc_id
        if (result.doc_id) {
          documentRegistry.registerDocument(result.doc_id, result.title || result.doc_id);
        }
      });
    });
  }, [messages, documentRegistry]);

  const handleExportConversation = () => {
    exportConversation(messages, documentRegistry);
  };

  const handleExampleQuerySelect = (query: string) => {
    setInput(query);
    setTimeout(() => {
      if (!isSubmitting && status !== "streaming" && status !== "error") {
        const text = query.trim();
        if (text) {
          sendMessage({ role: "user", parts: [{ type: "text", text }] });
          setInput("");
        }
      }
    }, 100);
  };

  return (
    <div className="flex min-h-screen w-full flex-col bg-white text-gray-800 font-sans antialiased transition-all pb-0 selection:bg-[#6CA0D6] selection:text-white">
      <ChatHeader
        status={status}
        hasMessages={messages.length > 0}
        urlCopied={urlCopied}
        shareConversationUrl={shareConversationUrl}
        exportConversation={handleExportConversation}
        openNewConversation={openNewConversation}
      />

      <div className="flex-1 overflow-hidden pb-20 bg-white">
        <div className="mx-auto max-w-6xl mt-4 mb-0 flex-1 overflow-hidden px-4 lg:px-8 py-0">
          <div className="flex flex-col">
            <div className="flex-1 overflow-y-auto mt-2 pr-2 custom-scrollbar bg-white">
              <div className="pb-[80px] bg-white">
                {messages.length === 0 ? (
                  <div className="bg-white p-4 m-4 mt-8 rounded-lg border border-gray-200">
                    <div className="markdown-condensed text-[#6CA0D6] text-sm text-left mb-4 font-sans">
                      <div className="whitespace-pre-wrap break-words text-gray-800 markdown-condensed">
                        <h1 className="text-gray-900 font-bold text-xl mb-1 mt-2">Welcome to HistoryLab AI</h1>
                        <p className="text-gray-800 mb-0">
                          An AI assistant for exploring declassified government documents, diplomatic cables, intelligence reports, and historical archives. Access nearly 5 million documents (18+ million pages) including Presidential Daily Briefings (1946-1977), State Department Files (1973-1979), CIA CREST Collection (1941-2005), Clinton Emails (2009-2013), UN Archives (1997-2016), World Bank records (1942-2020), and more.
                        </p>
                      </div>
                    </div>
                    <ExampleQueries onSelectQuery={handleExampleQuerySelect} />
                  </div>
                ) : (
                  <>
                    {messages.map((message, index) => {
                      const isLastMessage = index === messages.length - 1;
                      return (
                        <ChatMessage
                          key={message.id}
                          message={message}
                          isLastMessage={isLastMessage}
                          status={status}
                          documentRegistry={documentRegistry}
                          conversationId={conversationId}
                          feedbackState={feedbackState}
                          handleFeedback={handleFeedback}
                        />
                      );
                    })}

                    {isLimbo && (
                      <div className="mb-4 flex flex-col items-start p-1">
                        <div className="flex w-full max-w-4xl justify-start">
                          <div className="h-8 w-8 overflow-hidden border border-amber-400 bg-white flex-none order-first mr-2 rounded-full flex items-center justify-center shadow-sm">
                            <AlertTriangle className="h-4 w-4 text-amber-500" />
                          </div>
                          <div className="rounded-lg flex flex-col bg-amber-50 border border-amber-300 overflow-hidden w-fit max-w-[calc(100%-3rem)] shadow-sm">
                            <div className="px-3 py-1.5 font-mono text-xs border-b border-amber-300 flex items-center justify-between bg-amber-50">
                              <div className="flex items-center">
                                <AlertTriangle className="h-3.5 w-3.5 mr-1.5 text-amber-600" />
                                <span className="font-semibold text-xs tracking-wide text-amber-700">
                                  WARNING
                                </span>
                              </div>
                              <div className="flex items-center gap-2">
                                <div className="font-mono bg-amber-100 text-[9px] px-1 text-amber-600 border border-amber-200 rounded-sm">
                                  SYSTEM
                                </div>
                              </div>
                            </div>
                            <div className="px-4 py-3 text-sm text-amber-800 font-sans">
                              <div className="whitespace-pre-wrap break-words">
                                <p className="mb-2">
                                  Something went wrong. Please reload the page.
                                </p>
                                <div className="mt-3 flex flex-wrap gap-2">
                                  <button
                                    onClick={handleReload}
                                    className="inline-flex h-8 items-center justify-center border border-amber-400 bg-amber-100 text-sm font-medium transition-colors hover:bg-amber-200 focus-visible:outline-none px-3 text-amber-800 text-xs rounded-md"
                                  >
                                    <RefreshCw className="h-3.5 w-3.5 icon-visible mr-1" />
                                    <span>RELOAD PAGE</span>
                                  </button>
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                    {status === "error" && (
                      <div className="mb-4 flex flex-col items-start p-1">
                        <div className="flex w-full max-w-4xl justify-start">
                          <div className="h-8 w-8 overflow-hidden border border-red-400 bg-white flex-none order-first mr-2 rounded-full flex items-center justify-center shadow-sm">
                            <AlertTriangle className="h-4 w-4 text-red-500" />
                          </div>
                          <div className="rounded-lg flex flex-col bg-red-50 border border-red-300 overflow-hidden w-fit max-w-[calc(100%-3rem)] shadow-sm">
                            <div className="px-3 py-1.5 font-mono text-xs border-b border-red-300 flex items-center justify-between bg-red-50">
                              <div className="flex items-center">
                                <AlertTriangle className="h-3.5 w-3.5 mr-1.5 text-red-600" />
                                <span className="font-semibold text-xs tracking-wide text-red-700">
                                  ERROR
                                </span>
                              </div>
                              <div className="flex items-center gap-2">
                                <div className="font-mono bg-red-100 text-[9px] px-1 text-red-600 border border-red-200 rounded-sm">
                                  SYSTEM
                                </div>
                              </div>
                            </div>
                            <div className="px-4 py-3 text-sm text-red-800 font-sans">
                              <div className="whitespace-pre-wrap break-words">
                                <p className="mb-2">
                                  There was an error processing your request. This conversation may have encountered a technical issue.
                                </p>
                                <div className="mt-3 flex flex-wrap gap-2">
                                  <button
                                    onClick={openNewConversation}
                                    className="inline-flex h-8 items-center justify-center border border-red-400 bg-red-100 text-sm font-medium transition-colors hover:bg-red-200 focus-visible:outline-none px-3 text-red-800 text-xs rounded-md"
                                  >
                                    <span>START NEW CONVERSATION</span>
                                  </button>
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                  </>
                )}

                <div
                  ref={messagesEndRef}
                  style={{ height: '11vh', width: '100%' }}
                  aria-hidden="true"
                  className="bg-white"
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      {!isBottomVisible && messages.length > 0 && (
        <div className="fixed bottom-28 left-1/2 transform -translate-x-1/2 z-30">
          <button
            onClick={scrollToBottom}
            className="flex items-center justify-center h-10 w-10 rounded-full bg-[#6CA0D6] text-white shadow-md hover:bg-[#5a90c0] focus:outline-none focus:ring-2 focus:ring-[#6CA0D6] focus:ring-opacity-50 transition-colors"
            aria-label="Scroll to bottom"
          >
            <ChevronDown className="h-5 w-5" />
          </button>
        </div>
      )}

      <div
        ref={inputContainerRef}
        className="fixed bottom-0 left-0 right-0 z-20"
        style={{ background: 'linear-gradient(to bottom, transparent, white 15%, white)' }}
      >
        <div className="mx-auto max-w-6xl px-4 lg:px-8">
          {status === 'submitted' && (
            <div className="flex justify-center items-center py-2">
              <Loader2 className="h-5 w-5 text-gray-500 animate-spin" />
            </div>
          )}
          <ChatInput
            input={input}
            isSubmitting={isSubmitting}
            status={status}
            handleInputChange={handleInputChange}
            handleSubmit={handleSubmit}
          />

          <div className="flex justify-center text-gray-500 text-xs font-mono mb-2">
            <a
              href="https://landing.ramus.network"
              target="_blank"
              rel="noopener noreferrer"
              className="text-gray-500 hover:text-[#6CA0D6] transition-colors"
            >
              powered by ramus
            </a>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ChatContainer;
