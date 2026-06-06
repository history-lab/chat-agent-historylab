import React from 'react';
import { RefreshCw, Check, AlertTriangle, FileText } from 'lucide-react';
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

const SEARCH_TOOLS = new Set([
  'vectorSearch',
  'corpusSearch',
  'frusSearch',
  'entityDocuments',
  'browseTopics',
]);

const ToolInvocation: React.FC<ToolInvocationProps> = ({ part, messageId, index, conversationId, status }) => {
  const toolName: string = typeof part?.type === 'string' ? part.type.replace(/^tool-/, '') : '';
  const partState = part?.state;
  const input = part?.input ?? {};
  const output = part?.output;
  const errorText = part?.errorText;
  const isComplete = partState === 'output-available';
  const isErrored = partState === 'output-error';
  const isPending = !isComplete && !isErrored;

  // ── In-progress spinner ───────────────────────────────────────
  if (isPending) {
    const queryText = input?.query || input?.title || input?.from || input?.to || input?.corpus || input?.type || '';
    const dateRangeStr = formatDateRange(input);
    const label = queryText
      ? `${toolName}: "${queryText.length > 60 ? queryText.substring(0, 60) + '...' : queryText}" ${dateRangeStr}`.trim()
      : toolName;
    return (
      <div
        key={`${messageId}-tool-pending-${index}`}
        className="bg-blue-50 p-3 my-3 border border-blue-200 rounded-md text-blue-700 flex items-center gap-2 shadow-sm"
      >
        <RefreshCw size={14} className="animate-spin text-blue-500" />
        <span className="text-xs font-medium">
          Running <span className="italic">{label}</span>
        </span>
      </div>
    );
  }

  // ── Error ─────────────────────────────────────────────────────
  if (isErrored || (typeof output === 'object' && output !== null && output.error)) {
    const msg = errorText || output?.error || 'Tool failed.';
    return (
      <div
        key={`${messageId}-tool-error-${index}`}
        className="bg-red-50 p-3 my-3 border border-red-300 rounded-md text-red-700 flex items-center gap-2 shadow-sm"
      >
        <AlertTriangle size={14} className="text-red-500 flex-shrink-0" />
        <span className="text-xs font-medium">
          {toolName} failed: {msg}
        </span>
      </div>
    );
  }

  // ── Specialised rendering ─────────────────────────────────────

  // vectorSearch returns { documents: [...] } with file_info.r2Key + chunks
  if (toolName === 'vectorSearch' && output && Array.isArray(output.documents)) {
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

  // corpusSearch / frusSearch / entityDocuments / browseTopics return { data: [...], total }
  if (SEARCH_TOOLS.has(toolName) && output && Array.isArray(output.data)) {
    const rows = output.data as any[];
    const total = output.total;
    const headline = total != null && total > rows.length
      ? `${toolName}: ${rows.length} shown · ${total} total`
      : `${toolName}: ${rows.length} result${rows.length === 1 ? '' : 's'}`;
    return (
      <div
        key={`${messageId}-tool-results-${index}`}
        className="bg-blue-50 p-3 my-3 border border-blue-200 rounded-md shadow-sm"
      >
        <div className="flex items-center gap-2 mb-2">
          <FileText size={14} className="text-blue-600 flex-shrink-0" />
          <span className="text-xs font-medium text-blue-800">{headline}</span>
        </div>
        {rows.length > 0 && (
          <ul className="text-xs text-blue-900 space-y-1 ml-1">
            {rows.slice(0, 8).map((row: any, i: number) => (
              <li key={row.doc_id ?? row.entity_id ?? i} className="truncate">
                {row.title || row.entity || row.doc_id || JSON.stringify(row).slice(0, 80)}
                {row.authored ? ` · ${row.authored.toString().slice(0, 10)}` : ''}
              </li>
            ))}
            {rows.length > 8 && (
              <li className="text-[10px] text-blue-700 italic">+ {rows.length - 8} more</li>
            )}
          </ul>
        )}
      </div>
    );
  }

  // entityLookup returns { data: [{entity, doc_cnt, ...}], total }
  if (toolName === 'entityLookup' && output && Array.isArray(output.data)) {
    const entities = output.data as any[];
    return (
      <div
        key={`${messageId}-tool-results-${index}`}
        className="bg-blue-50 p-3 my-3 border border-blue-200 rounded-md shadow-sm"
      >
        <div className="text-xs font-medium text-blue-800 mb-2">
          entityLookup: {entities.length} match{entities.length === 1 ? '' : 'es'}
        </div>
        <ul className="text-xs text-blue-900 space-y-1 ml-1">
          {entities.slice(0, 10).map((e: any, i: number) => (
            <li key={e.entity_id ?? i}>
              <span className="font-medium">{e.entity}</span>
              <span className="text-blue-700"> · {e.entity_group} · {e.doc_cnt} docs</span>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  // getDocument returns a single doc object with title/body/doc_id
  if (toolName === 'getDocument' && output && (output.doc_id || output.title)) {
    return (
      <div
        key={`${messageId}-tool-doc-${index}`}
        className="bg-blue-50 p-3 my-3 border border-blue-200 rounded-md text-blue-700 flex items-center gap-2 shadow-sm"
      >
        <Check size={14} className="text-blue-500 flex-shrink-0" />
        <span className="text-xs font-medium">
          Loaded <span className="italic">{output.title || output.doc_id}</span>
        </span>
      </div>
    );
  }

  // submitFeedback success
  if (toolName === 'submitFeedback') {
    if (output?.success === false) {
      return (
        <div
          key={`${messageId}-tool-fb-err-${index}`}
          className="bg-red-50 p-3 my-3 border border-red-300 rounded-md text-red-700 flex items-center gap-2 shadow-sm"
        >
          <AlertTriangle size={14} className="text-red-500 flex-shrink-0" />
          <span className="text-xs font-medium">{output?.error || 'Feedback submission failed.'}</span>
        </div>
      );
    }
    return (
      <div
        key={`${messageId}-tool-fb-${index}`}
        className="bg-blue-50 p-3 my-3 border border-blue-200 rounded-md text-blue-700 flex items-center gap-2 shadow-sm"
      >
        <Check size={14} className="text-blue-500 flex-shrink-0" />
        <span className="text-xs font-medium">Feedback submitted.</span>
      </div>
    );
  }

  // ── Generic fallback (listCorpora, archiveStats, anything new) ─
  return (
    <div
      key={`${messageId}-tool-generic-${index}`}
      className="bg-gray-100 p-3 my-3 border border-gray-300 rounded-md text-gray-700 text-xs shadow-sm"
    >
      <div className="flex items-center gap-2 mb-1">
        <FileText size={14} className="text-gray-500 flex-shrink-0" />
        <span className="font-semibold">{toolName}</span>
      </div>
      <pre className="text-[10px] overflow-auto max-h-48 whitespace-pre-wrap break-words text-gray-700">
        {JSON.stringify(output, null, 2)}
      </pre>
    </div>
  );
};

export default ToolInvocation;
