import type { UIMessage } from "@ai-sdk/react";
import { formatTime } from "./formatting";
import type { DocumentRegistryType } from "../components/documents/DocumentRegistry";

// v6 UIMessage has no top-level `content` or `createdAt`. Local alias keeps
// the rest of this file readable while we still annotate optional legacy fields.
type Message = UIMessage & { content?: string; createdAt?: string | Date };

/**
 * Extract text content from message parts
 */
export const extractMessageText = (message: Message): string => {
  if (!message.parts || message.parts.length === 0) return '';
  return message.parts
    .filter((part: any) => part?.type === 'text')
    .map((part: any) => part.text ?? '')
    .join('\n\n');
};

/**
 * Export conversation as markdown file
 * @param messages Array of chat messages
 * @param documentRegistry Document registry instance for citation lookup
 */
export function exportConversation(
  messages: Message[],
  documentRegistry: DocumentRegistryType
): void {
  // Generate a filename with timestamp
  const timestamp = new Date().toISOString().replace(/:/g, '-').replace(/\..+/, '');
  const filename = `historylab-conversation-${timestamp}.md`;
  
  // Start building markdown content
  let markdownContent = `# HistoryLab AI Conversation\n\n`;
  markdownContent += `*Exported on ${new Date().toLocaleString()}*\n\n`;
  
  // Keep track of all document references
  const documentReferences = new Map();
  
  // Convert messages to markdown
  messages.forEach((message) => {
    const formattedTime = message.createdAt ? formatTime(new Date(message.createdAt)) : '';
    
    if (message.role === 'user') {
      // Format user messages
      markdownContent += `## User (${formattedTime})\n\n`;
      
      // Extract text from user message
      const messageText = typeof message.content === 'string' 
        ? message.content
        : extractMessageText(message);
        
      markdownContent += `${messageText}\n\n`;
    } else if (message.role === 'assistant') {
      // Format assistant messages
      markdownContent += `## HistoryLab AI (${formattedTime})\n\n`;
      
      // Extract text content from assistant message
      const messageText = extractMessageText(message);
      
      // Process citation markers to make them readable in exported markdown
      // Replace {{cite:r2Key}} with clickable document links
      const processedText = messageText.replace(
        /{{cite:([^}]+)}}/g,
        (match, r2Key) => {
          const docId = documentRegistry.getDocumentId(r2Key) || '?';
          const docUrl = `https://doc-viewer.ramus.network/${r2Key}`;
          
          // Store reference for the document references section
          if (!documentReferences.has(r2Key)) {
            const title = documentRegistry.getDocumentTitle(r2Key) || `Document #${docId}`;
            
            // Try to find this document in message tool results to get full metadata.
            // v6: tool parts are `type: \`tool-${toolName}\`` with `state: "output-available"` and `output`.
            let metadata: Record<string, any> = {};
            if (message.parts) {
              for (const part of message.parts as any[]) {
                if (part?.type === 'tool-queryCollection' && part.state === 'output-available' && part.output?.documents) {
                  const foundDoc = (part.output.documents || []).find(
                    (doc: any) => doc.file_info?.r2Key === r2Key,
                  );
                  if (foundDoc && foundDoc.file_info?.metadata) {
                    metadata = foundDoc.file_info.metadata;
                    break;
                  }
                }
              }
            }
            
            documentReferences.set(r2Key, { docId, docUrl, title, r2Key, metadata });
          }
          
          return `[Document #${docId}](${docUrl})`;
        }
      );
      
      markdownContent += `${processedText}\n\n`;
      
      // Include tool invocations if present
      if (message.parts) {
        (message.parts as any[]).forEach((part) => {
          if (part?.type === 'tool-queryCollection' && part.state === 'output-available') {
            const result = part.output;
            if (result) {
              if (result.status === 'success' || result.status === 'partial_success') {
                if (result.documents && result.documents.length > 0) {                    
                  markdownContent += `### Documents Found (${result.documents.length})\n\n`;
                  result.documents.forEach((doc: any, index: number) => {
                    const title = doc.file_info?.metadata?.title || doc.document_id || 'Unknown Document';
                    const docId = documentRegistry.getDocumentId(doc.file_info?.r2Key) || '?';
                    const docUrl = doc.file_info?.r2Key ? `https://doc-viewer.ramus.network/${doc.file_info.r2Key}` : '';
                    
                    // Store reference for the document references section
                    if (doc.file_info?.r2Key && !documentReferences.has(doc.file_info.r2Key)) {
                      documentReferences.set(doc.file_info.r2Key, { 
                        docId, 
                        docUrl, 
                        title, 
                        r2Key: doc.file_info.r2Key,
                        metadata: doc.file_info?.metadata || {}
                      });
                    }
                    
                    // Format document entry with metadata when available
                    markdownContent += `${index + 1}. **${title}** - [Document #${docId}](${docUrl})`;
                    
                    // Add document metadata when available
                    const metadata = [];
                    if (doc.file_info?.metadata) {
                      // Date can be in different formats
                      const dateStr = doc.file_info.metadata.date || 
                                    (doc.file_info.metadata.authored ? 
                                      new Date(doc.file_info.metadata.authored).toISOString().split('T')[0] : 
                                      null);
                      
                      if (dateStr) {
                        metadata.push(`Date: ${dateStr}`);
                      }
                      
                      if (doc.file_info.metadata.classification) {
                        metadata.push(`Classification: ${doc.file_info.metadata.classification}`);
                      }
                      
                      if (doc.file_info.metadata.corpus) {
                        metadata.push(`Corpus: ${doc.file_info.metadata.corpus}`);
                      }
                      
                      if (doc.file_info.metadata.doc_id) {
                        metadata.push(`Document ID: ${doc.file_info.metadata.doc_id}`);
                      }
                      
                      if (doc.file_info.metadata.source) {
                        metadata.push(`Source: [${doc.file_info.metadata.source}](${doc.file_info.metadata.source})`);
                      }
                    }
                    
                    // Append metadata if any exists
                    if (metadata.length > 0) {
                      markdownContent += `  \n   *${metadata.join(' | ')}*`;
                    }
                    
                    markdownContent += '\n';
                  });
                  markdownContent += `\n`;
                }
              }
            }
          }
        });
      }
    }
  });
  
  // Add document references section if there are any documents
  if (documentReferences.size > 0) {
    markdownContent += `\n## Document References\n\n`;
    
    // Sort references by document ID for a consistent order
    const sortedReferences = Array.from(documentReferences.values())
      .sort((a, b) => (a.docId < b.docId ? -1 : 1));
    
    sortedReferences.forEach(ref => {
      markdownContent += `### Document #${ref.docId}: ${ref.title}\n`;
      markdownContent += `- **Link**: [View Document](${ref.docUrl})\n`;
      
      // Add metadata if available
      if (ref.metadata) {
        // Date can be in different formats
        const dateStr = ref.metadata.date || 
                      (ref.metadata.authored ? 
                        new Date(ref.metadata.authored).toISOString().split('T')[0] : 
                        null);
        
        if (dateStr) {
          markdownContent += `- **Date**: ${dateStr}\n`;
        }
        
        if (ref.metadata.classification) {
          markdownContent += `- **Classification**: ${ref.metadata.classification}\n`;
        }
        
        if (ref.metadata.corpus) {
          markdownContent += `- **Corpus**: ${ref.metadata.corpus}\n`;
        }
        
        if (ref.metadata.doc_id) {
          markdownContent += `- **Document ID**: ${ref.metadata.doc_id}\n`;
        }
        
        if (ref.metadata.source) {
          markdownContent += `- **Source**: [${ref.metadata.source}](${ref.metadata.source})\n`;
        }
      }
      
      markdownContent += `- **R2 Key**: \`${ref.r2Key}\`\n\n`;
    });
  }
  
  // Create blob and download
  const blob = new Blob([markdownContent], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  
  // Clean up
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 100);
} 