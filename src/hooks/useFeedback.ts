import { useState, useCallback } from 'react';
import type { UIMessage as Message } from "@ai-sdk/react";

type FeedbackType = 'like' | 'dislike' | null;
type FeedbackState = Record<string, FeedbackType>;

interface UseFeedbackReturn {
  feedbackState: FeedbackState;
  handleFeedback: (messageId: string, feedbackType: 'like' | 'dislike') => Promise<void>;
}

/**
 * Hook to manage message feedback state and submission
 * 
 * @param conversationId Current conversation ID
 * @param messages Array of chat messages
 * @returns Object with feedback state and submission handler
 */
export function useFeedback(
  conversationId: string,
  messages: Message[]
): UseFeedbackReturn {
  // State to track feedback for each message
  const [feedbackState, setFeedbackState] = useState<FeedbackState>({});

  // Function to handle feedback submission
  const handleFeedback = useCallback(async (
    messageId: string, 
    feedbackType: 'like' | 'dislike'
  ) => {
    const currentFeedback = feedbackState[messageId];
    
    // If clicking the same button again, toggle it off (set to null)
    // Otherwise, set to the new feedback type
    const newFeedback = currentFeedback === feedbackType ? null : feedbackType;

    // Optimistically update UI
    setFeedbackState(prev => ({ ...prev, [messageId]: newFeedback }));

    try {
      // Find the index of this assistant message among all assistant messages
      const assistantMessages = messages.filter(msg => msg.role === 'assistant');
      const messageIndex = assistantMessages.findIndex(msg => msg.id === messageId);
      
      // Construct the full URL for the feedback endpoint
      const feedbackUrl = `${window.location.origin}/feedback`;

      const response = await fetch(feedbackUrl, { 
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversationId,
          messageId,
          messageIndex: messageIndex >= 0 ? messageIndex : undefined,
          feedback: newFeedback
        })
      });

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`Feedback API failed: ${response.status} ${response.statusText} - ${errorBody}`);
      }
    } catch (error) {
      console.error("Failed to submit feedback:", error);
      // Revert optimistic update on error
      setFeedbackState(prev => ({ ...prev, [messageId]: currentFeedback }));
      // Show error message to user
      alert(`Failed to save feedback: ${error instanceof Error ? error.message : String(error)}`);
    }
  }, [feedbackState, conversationId, messages]);

  return {
    feedbackState,
    handleFeedback
  };
} 