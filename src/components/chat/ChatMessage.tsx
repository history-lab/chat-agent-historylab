import React, { useState } from 'react';
import { User, Bot, Copy, Check, ThumbsUp, ThumbsDown } from 'lucide-react';
import type { UIMessage } from "@ai-sdk/react";
import MessageContent, { ReasoningContent } from './MessageContent';
import ToolInvocation from './ToolInvocation';
import { formatTime } from '../../utils/formatting';
import type { DocumentRegistryType } from '../documents/DocumentRegistry';

// v6 UIMessage doesn't have top-level createdAt; we still surface it optionally.
type Message = UIMessage & { createdAt?: string | Date };

interface ChatMessageProps {
  message: Message;
  isLastMessage: boolean;
  status: string;
  documentRegistry: DocumentRegistryType;
  conversationId: string;
  feedbackState: Record<string, 'like' | 'dislike' | null>;
  handleFeedback: (messageId: string, feedbackType: 'like' | 'dislike') => Promise<void>;
}

/**
 * Component for rendering a single chat message
 */
const ChatMessage: React.FC<ChatMessageProps> = ({
  message,
  isLastMessage,
  status,
  documentRegistry,
  conversationId,
  feedbackState,
  handleFeedback,
}) => {
  const isUser = message.role === "user";
  const showActionButtons = !isUser && (!isLastMessage || (isLastMessage && status === "ready"));
  
  // State for tracking which message content has been copied
  const [copiedMessageId, setCopiedMessageId] = useState<boolean>(false);
  
  // Function to extract text content from message parts
  const extractMessageText = (message: Message): string => {
    if (!message.parts || message.parts.length === 0) return '';

    return message.parts
      .filter((part: any) => part?.type === 'text')
      .map((part: any) => (part.type === 'text' ? part.text ?? '' : ''))
      .join('\n\n');
  };
  
  // Function to copy message content to clipboard
  const copyMessageContent = () => {
    const textContent = extractMessageText(message);
    
    // Check if we're running in an iframe
    const isInIframe = window !== window.parent;
    
    if (isInIframe) {
      try {
        // Fallback method using a temporary textarea element
        const textArea = document.createElement('textarea');
        textArea.value = textContent;
        
        // Make the textarea invisible but part of the document
        textArea.style.position = 'fixed';
        textArea.style.opacity = '0';
        textArea.style.left = '0';
        textArea.style.top = '0';
        textArea.style.width = '1px';
        textArea.style.height = '1px';
        textArea.style.padding = '0';
        
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        
        // Try to use the older document.execCommand method
        const successful = document.execCommand('copy');
        
        // Clean up
        document.body.removeChild(textArea);
        
        if (successful) {
          setCopiedMessageId(true);
          setTimeout(() => setCopiedMessageId(false), 2000);
        } else {
          // Show a manual copy dialog or message if execCommand also fails
          alert('Clipboard access is restricted. Please copy this text manually: ' + textContent);
        }
      } catch (err) {
        // If all else fails, show the text to manually copy
        alert('Clipboard access is restricted. Please copy this text manually: ' + textContent);
      }
    } else {
      // Use the Clipboard API in normal (non-iframe) context
      navigator.clipboard.writeText(textContent)
        .then(() => {
          setCopiedMessageId(true);
          setTimeout(() => setCopiedMessageId(false), 2000);
        })
        .catch(() => {
          // Fallback if Clipboard API fails for some reason
          alert('Could not copy to clipboard. Please copy this text manually: ' + textContent);
        });
    }
  };

  return (
    <div
      id={`message-${message.id}`}
      className={`mb-5 flex flex-col p-1 ${isUser ? "items-end" : "items-start"}`}
    >
      <div
        className={`flex w-full max-w-4xl ${
          isUser ? "justify-end" : "justify-start"
        }`}
      >
        <div
          className={`h-8 w-8 overflow-hidden border border-gray-300 bg-white flex-none rounded-full flex items-center justify-center shadow-sm ${
            isUser ? "order-last ml-2" : "order-first mr-2"
          }`}
        >
          {isUser ? (
            <User className="h-4 w-4 text-gray-500" />
          ) : (
            <Bot className="h-4 w-4 text-[#6CA0D6]" />
          )}
        </div>
        <div
          className={`rounded-lg flex flex-col border overflow-hidden shadow-sm ${
            isUser
              ? "bg-gray-100 border-gray-200"
              : "bg-white border-gray-200"
          } w-fit max-w-[calc(100%-3rem)]`}
        >
          <div
            className={`px-3 py-1.5 font-mono text-xs border-b flex items-center justify-between ${
              isUser ? "bg-gray-100 border-gray-200" : "bg-white border-gray-200"
            }`}
          >
            <div className="flex items-center">
              <span className={`font-semibold text-xs tracking-wide ${isUser ? 'text-gray-600' : 'text-[#6CA0D6]'}`}>
                {isUser ? "RESEARCHER" : "ASSISTANT"}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <time
                dateTime={message.createdAt?.toString() ?? new Date().toString()}
                className="text-[10px] text-gray-400 font-mono"
              >
                {formatTime(new Date(message.createdAt ?? new Date()))}
              </time>
              {!isUser && (
                <div className="font-mono bg-gray-100 text-[9px] px-1 text-gray-500 border border-gray-200 rounded-sm">
                  HISTORYLAB
                </div>
              )}
            </div>
          </div>
          <div className="px-4 py-3 text-sm text-gray-800 font-sans">
            {!message.parts || message.parts.length === 0 ? (
              <div className="flex items-center gap-2">
                <span className="text-gray-500 text-xs italic">Processing query...</span>
              </div>
            ) : (
              <>
                {(message.parts as any[]).map((part, i) => {
                  if (part?.type === "text") {
                    return (
                      <div key={i} className="relative">
                        <MessageContent
                          text={part.text}
                          messageId={message.id}
                          documentRegistry={documentRegistry}
                        />
                      </div>
                    );
                  }

                  if (part?.type === "reasoning") {
                    return (
                      <div key={i} className="relative">
                        <ReasoningContent
                          text={part.text ?? part.reasoning ?? ''}
                          messageId={message.id}
                          documentRegistry={documentRegistry}
                        />
                      </div>
                    );
                  }

                  // v6: tool parts are `tool-${name}` or `dynamic-tool`
                  if (typeof part?.type === 'string' && (part.type.startsWith('tool-') || part.type === 'dynamic-tool')) {
                    return (
                      <ToolInvocation
                        key={i}
                        part={part}
                        messageId={message.id}
                        index={i}
                        conversationId={conversationId}
                        status={status}
                      />
                    );
                  }

                  return null;
                })}
                
                {showActionButtons && (
                  <div className="flex justify-end items-center mt-2 gap-2">
                    {/* Like Button */}
                    <button
                      onClick={() => handleFeedback(message.id, 'like')}
                      className={`inline-flex h-7 w-7 items-center justify-center border rounded-md transition-colors duration-150 ease-in-out cursor-pointer 
                        ${feedbackState[message.id] === 'like' 
                          ? 'bg-blue-100 border-blue-300 text-[#6CA0D6]' 
                          : 'bg-white border-gray-300 text-gray-500 hover:bg-gray-100 hover:text-gray-700'}
                      `}
                      aria-label="Like this message"
                      title="Like this message"
                    >
                      <ThumbsUp className="h-3.5 w-3.5" />
                    </button>

                    {/* Dislike Button */}
                    <button
                      onClick={() => handleFeedback(message.id, 'dislike')}
                      className={`inline-flex h-7 w-7 items-center justify-center border rounded-md transition-colors duration-150 ease-in-out cursor-pointer 
                        ${feedbackState[message.id] === 'dislike' 
                          ? 'bg-red-100 border-red-300 text-red-600' 
                          : 'bg-white border-gray-300 text-gray-500 hover:bg-gray-100 hover:text-gray-700'}
                      `}
                      aria-label="Dislike this message"
                      title="Dislike this message"
                    >
                      <ThumbsDown className="h-3.5 w-3.5" />
                    </button>

                    {/* Copy Button */}
                    <button
                      onClick={copyMessageContent}
                      className="inline-flex h-7 items-center justify-center border border-gray-300 bg-white text-gray-600 text-xs font-medium transition-colors hover:bg-gray-100 hover:text-gray-800 px-2 gap-1 rounded-md cursor-pointer"
                      aria-label="Copy message content"
                      title="Copy message content"
                    >
                      {copiedMessageId ? (
                        <>
                          <Check className="h-3 w-3 text-[#6CA0D6]" />
                          <span className="text-[10px] text-[#6CA0D6]">COPIED</span>
                        </>
                      ) : (
                        <>
                          <Copy className="h-3 w-3" />
                          <span className="text-[10px]">COPY</span>
                        </>
                      )}
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ChatMessage; 