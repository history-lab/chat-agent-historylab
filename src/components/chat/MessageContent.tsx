import React from 'react';
import ReactMarkdown from 'react-markdown';
import rehypeRaw from 'rehype-raw';
import remarkGfm from 'remark-gfm';
import type { DocumentRegistryType } from '../documents/DocumentRegistry';

interface MessageContentProps {
  text: string;
  messageId: string;
  documentRegistry: DocumentRegistryType;
}

/**
 * Component for rendering message content with markdown and citation support
 */
const MessageContent: React.FC<MessageContentProps> = ({ text, messageId, documentRegistry }) => {
  // Process special citation codes: {{cite:r2Key}} -> a <span> parsed as HTML
  // by rehypeRaw. The model sometimes emits the marker on its own (often
  // indented) line; Markdown then renders the resulting <span> as an indented
  // code block. So first pull any line-leading citation back onto the previous
  // line, and pull trailing punctuation that landed on the next line back up to
  // the marker, keeping the citation inline before converting it to HTML.
  const processedText = text
    .replace(/[ \t]*[\r\n]+[ \t]*(\{\{cite:[^}]+\}\})/g, ' $1')
    .replace(/(\{\{cite:[^}]+\}\})[ \t]*[\r\n]+[ \t]*([.,;:!?)])/g, '$1$2')
    .replace(/\{\{cite:([^}]+)\}\}/g, (_match, r2Key) => {
      // Register document if not already registered
      const docId = documentRegistry.registerDocument(r2Key);
      return `<span class="citation" data-number="${docId}" data-r2key="${r2Key}" title="View source document ${docId}: ${documentRegistry.getDocumentTitle(r2Key)}">${docId}</span>`;
    });

  return (
    <div className="whitespace-pre-wrap break-words text-gray-800 markdown-condensed">
      <ReactMarkdown
        rehypePlugins={[rehypeRaw]}
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({node, ...props}) => <h1 className="text-gray-900 font-bold text-xl mb-1 mt-2" {...props} />,
          h2: ({node, ...props}) => <h2 className="text-gray-900 font-bold text-lg mb-1 mt-2" {...props} />,
          h3: ({node, ...props}) => <h3 className="text-gray-900 font-bold text-base mb-1 mt-1" {...props} />,
          h4: ({node, ...props}) => <h4 className="text-gray-900 font-bold text-sm mb-1 mt-1" {...props} />,
          p: ({node, ...props}) => <p className="text-gray-800 mb-0" {...props} />,
          a: ({node, ...props}) => <a className="text-[#6CA0D6] hover:underline" target="_blank" rel="noopener noreferrer" {...props} />,
          strong: ({node, ...props}) => <strong className="text-gray-900 font-semibold" {...props} />,
          em: ({node, ...props}) => <em className="text-gray-800 italic" {...props} />,
          ul: ({node, ...props}) => <ul className="text-gray-800 list-disc ml-5 my-0 py-0" {...props} />,
          ol: ({node, ...props}) => <ol className="text-gray-800 list-decimal ml-5 my-0 py-0" {...props} />,
          li: ({node, ...props}) => <li className="text-gray-800 mb-0" {...props} />,
          blockquote: ({node, ...props}) => <blockquote className="border-l-4 border-[#6CA0D6] bg-gray-100/50 p-3 my-1 rounded-r-md text-gray-700 italic" {...props} />,
          code: ({node, inline, className, ...props}: any) =>
            inline
              ? <code className="bg-gray-200/70 rounded-md px-1 py-0.5 font-mono text-sm text-gray-800" {...props} />
              : <pre className="bg-gray-100 border border-gray-200 rounded-md p-4 my-1 overflow-x-auto font-mono text-sm leading-relaxed text-gray-800 block"><code className="bg-transparent p-0 border-none" {...props}/></pre>,
          pre: ({node, ...props}) => <pre className="bg-gray-100 border border-gray-200 rounded-md p-4 my-1 overflow-x-auto font-mono text-sm leading-relaxed text-gray-800" {...props} />,
          table: ({node, ...props}) => <table className="table-auto w-full my-1 border-collapse border border-gray-300 rounded-md overflow-hidden text-gray-800" {...props} />,
          th: ({node, ...props}) => <th className="border border-gray-300 p-2 text-left bg-gray-100 font-semibold" {...props} />,
          td: ({node, ...props}) => <td className="border border-gray-300 p-2" {...props} />,
          hr: ({node, ...props}) => <hr className="border-gray-300/80 my-1" {...props} />,
        }}
      >
        {processedText}
      </ReactMarkdown>
    </div>
  );
};

/**
 * Component for rendering reasoning/thinking content
 */
export const ReasoningContent: React.FC<MessageContentProps> = ({ text, messageId }) => {
  return (
    <div className="whitespace-pre-wrap break-words text-gray-500 text-xs opacity-90 markdown-condensed border-l-2 border-gray-300 pl-2 my-2">
      <ReactMarkdown
        rehypePlugins={[rehypeRaw]}
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({node, ...props}) => <h1 className="text-gray-600 font-semibold" {...props} />,
          h2: ({node, ...props}) => <h2 className="text-gray-600 font-semibold" {...props} />,
          h3: ({node, ...props}) => <h3 className="text-gray-600 font-semibold" {...props} />,
          h4: ({node, ...props}) => <h4 className="text-gray-600 font-semibold" {...props} />,
          p: ({node, ...props}) => <p className="text-gray-500" {...props} />,
          a: ({node, ...props}) => <a className="text-gray-500 underline" {...props} />,
          strong: ({node, ...props}) => <strong className="text-gray-600 font-semibold" {...props} />,
          em: ({node, ...props}) => <em className="text-gray-500 italic" {...props} />,
          ul: ({node, ...props}) => <ul className="text-gray-500 list-disc ml-4" {...props} />,
          ol: ({node, ...props}) => <ol className="text-gray-500 list-decimal ml-4" {...props} />,
          li: ({node, ...props}) => <li className="text-gray-500" {...props} />,
          blockquote: ({node, ...props}) => <blockquote className="border-l-4 border-gray-400 bg-gray-50 p-2 my-2 rounded-r-md text-gray-500" {...props} />,
          code: ({node, inline, className, ...props}: any) =>
            inline
              ? <code className="bg-gray-200/70 rounded-md px-1 py-0.5 font-mono text-xs text-gray-600" {...props} />
              : <pre className="bg-gray-100 border border-gray-200 rounded-md p-3 my-2 overflow-x-auto font-mono text-xs leading-relaxed text-gray-600 block"><code className="bg-transparent p-0 border-none" {...props}/></pre>,
          pre: ({node, ...props}) => <pre className="bg-gray-100 border border-gray-200 rounded-md p-3 my-2 overflow-x-auto font-mono text-xs leading-relaxed text-gray-600" {...props} />,
          table: ({node, ...props}) => <table className="table-auto w-full my-2 border-collapse rounded-md overflow-hidden text-gray-500 text-xs" {...props} />,
          th: ({node, ...props}) => <th className="border border-gray-200 p-1 text-left bg-gray-50 font-semibold" {...props} />,
          td: ({node, ...props}) => <td className="border border-gray-200 p-1" {...props} />,
          hr: ({node, ...props}) => <hr className="border-gray-200/80 my-2" {...props} />,
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
};

export default MessageContent; 