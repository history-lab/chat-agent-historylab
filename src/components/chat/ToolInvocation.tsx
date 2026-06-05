import React from 'react';
import { RefreshCw, Check, AlertTriangle } from 'lucide-react';
import DocumentResults from '../documents/DocumentResults';
import { formatDateRange } from '../../utils/formatting';

interface ToolInvocationProps {
  // v6 tool part: { type: `tool-${name}`, state, toolCallId, input, output, errorText }
  part: any;
  messageId: string;
  index: number;
  conversationId: string;
  status: string;
}

const ToolInvocation: React.FC<ToolInvocationProps> = ({ part, messageId, index, conversationId, status }) => {
  const toolName: string = typeof part?.type === 'string' ? part.type.replace(/^tool-/, '') : '';
  const toolCallId = part?.toolCallId;
  const partState = part?.state;
  const input = part?.input;
  const output = part?.output;
  const errorText = part?.errorText;
  const isComplete = partState === 'output-available';
  const isErrored = partState === 'output-error';

  if (toolName === 'queryCollection') {
    if (!isComplete && !isErrored) {
      const queryText = input?.query || '...';
      const dateRangeStr = formatDateRange(input);
      const displayText = `"${queryText.length > 60 ? queryText.substring(0, 60) + '...' : queryText}" ${dateRangeStr}`.trim();
      return (
        <div
          key={`${messageId}-tool-searching-${index}`}
          className="bg-blue-50 p-3 my-3 border border-blue-200 rounded-md text-blue-700 flex items-center gap-2 shadow-sm"
        >
          <RefreshCw size={14} className="animate-spin text-blue-500" />
          <span className="text-xs font-medium">
            Searching archive for: <span className="italic">{displayText}</span>
          </span>
        </div>
      );
    }
    if (isErrored) {
      return (
        <div
          key={`${messageId}-tool-error-${index}`}
          className="bg-red-50 p-3 my-3 border border-red-300 rounded-md text-red-700 flex items-center gap-2 shadow-sm"
        >
          <AlertTriangle size={14} className="text-red-500 flex-shrink-0" />
          <span className="text-xs font-medium">Search failed: {errorText || 'unknown error'}</span>
        </div>
      );
    }
    if (output && typeof output === 'object') {
      return (
        <div key={`${messageId}-tool-results-${index}`} className="my-3">
          <DocumentResults
            resultData={output}
            chatStatus={status}
            conversationId={conversationId}
          />
        </div>
      );
    }
    return (
      <div
        key={`${messageId}-tool-unknown-${index}`}
        className="bg-gray-50 p-3 my-3 border border-gray-200 rounded-md text-gray-500 flex items-center gap-2 shadow-sm"
      >
        <AlertTriangle size={14} className="text-gray-400 flex-shrink-0" />
        <span className="text-xs font-medium italic">Received unexpected search result format.</span>
      </div>
    );
  }

  if (toolName === 'getDocumentText') {
    const r2Key = input?.r2Key || 'unknown document';
    const r2KeySnippet = r2Key.length > 40 ? `...${r2Key.substring(r2Key.length - 40)}` : r2Key;

    if (!isComplete && !isErrored) {
      return (
        <div
          key={`${messageId}-tool-fetching-${index}`}
          className="bg-blue-50 p-3 my-3 border border-blue-200 rounded-md text-blue-700 flex items-center gap-2 shadow-sm"
        >
          <RefreshCw size={14} className="animate-spin text-blue-500" />
          <span className="text-xs font-medium">
            Fetching text for document: <span className="font-mono text-[10px] bg-blue-100 px-1 rounded">{r2KeySnippet}</span>...
          </span>
        </div>
      );
    }

    const hasError = isErrored || (typeof output === 'object' && output !== null && output.error);
    const errorMessage = isErrored ? errorText : (output?.error ?? 'Unknown error');
    if (hasError) {
      return (
        <div
          key={`${messageId}-tool-error-${index}`}
          className="bg-red-50 p-3 my-3 border border-red-300 rounded-md text-red-700 flex items-center gap-2 shadow-sm"
        >
          <AlertTriangle size={14} className="text-red-500 flex-shrink-0" />
          <span className="text-xs font-medium">
            Error fetching <span className="font-mono text-[10px] bg-red-100 px-1 rounded">{r2KeySnippet}</span>: {errorMessage}
          </span>
        </div>
      );
    }
    return (
      <div
        key={`${messageId}-tool-success-${index}`}
        className="bg-blue-50 p-3 my-3 border border-blue-200 rounded-md text-blue-700 flex items-center gap-2 shadow-sm"
      >
        <Check size={14} className="text-blue-500 flex-shrink-0" />
        <span className="text-xs font-medium">Document text retrieved.</span>
      </div>
    );
  }

  if (toolName === 'submitFeedback') {
    if (!isComplete && !isErrored) {
      return (
        <div
          key={`${messageId}-tool-feedback-${index}`}
          className="bg-blue-50 p-3 my-3 border border-blue-200 rounded-md text-blue-700 flex items-center gap-2 shadow-sm"
        >
          <RefreshCw size={14} className="animate-spin text-blue-500" />
          <span className="text-xs font-medium">Submitting feedback…</span>
        </div>
      );
    }
    if (isErrored) {
      return (
        <div
          key={`${messageId}-tool-feedback-error-${index}`}
          className="bg-red-50 p-3 my-3 border border-red-300 rounded-md text-red-700 flex items-center gap-2 shadow-sm"
        >
          <AlertTriangle size={14} className="text-red-500 flex-shrink-0" />
          <span className="text-xs font-medium">{errorText || 'Feedback submission failed.'}</span>
        </div>
      );
    }
    const isFailed = typeof output === 'object' && output !== null && output.success === false;
    if (isFailed) {
      return (
        <div
          key={`${messageId}-tool-feedback-error-${index}`}
          className="bg-red-50 p-3 my-3 border border-red-300 rounded-md text-red-700 flex items-center gap-2 shadow-sm"
        >
          <AlertTriangle size={14} className="text-red-500 flex-shrink-0" />
          <span className="text-xs font-medium">{output.error || 'Failed to submit feedback.'}</span>
        </div>
      );
    }
    return (
      <div
        key={`${messageId}-tool-feedback-success-${index}`}
        className="bg-blue-50 p-3 my-3 border border-blue-200 rounded-md text-blue-700 flex items-center gap-2 shadow-sm"
      >
        <Check size={14} className="text-blue-500 flex-shrink-0" />
        <span className="text-xs font-medium">Feedback submitted successfully.</span>
      </div>
    );
  }

  if (isComplete) {
    return (
      <div
        key={`${messageId}-tool-generic-result-${index}`}
        className="bg-gray-100 p-3 my-3 border border-gray-300 rounded-md text-gray-700 text-xs shadow-sm"
      >
        <span className="font-semibold">Tool Result ({toolName}):</span>
        <pre className="mt-1 text-[10px] overflow-auto">{JSON.stringify(output, null, 2)}</pre>
      </div>
    );
  }

  return null;
};

export default ToolInvocation;
