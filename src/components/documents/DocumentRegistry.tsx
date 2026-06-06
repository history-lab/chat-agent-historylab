import { useMemo } from 'react';

/**
 * Pick the right document viewer URL for an identifier.
 * R2 keys contain '/' (e.g. `0000000001/80650a98-.../file.txt`) → ramus doc-viewer.
 * Flat doc IDs (e.g. `CIA-RDP78-06362A000200010013-9`) → FOIArchive streamlit viewer.
 */
export function getDocumentViewerUrl(identifier: string): string {
  if (identifier.includes('/')) {
    return `https://doc-viewer.ramus.network/${identifier}`;
  }
  return `https://foiarchive-search-docviewer.streamlit.app/?doc_id=${encodeURIComponent(identifier)}`;
}

/**
 * Document registry for consistent citation numbering.
 * Keys can be either r2Keys or doc_ids — they share a namespace because the
 * model picks whichever the tool returned.
 */
export interface DocumentRegistryType {
  documents: Map<string, { id: number, title: string }>;
  counter: number;
  registerDocument: (identifier: string, title?: string) => number;
  getDocumentId: (identifier: string) => number | null;
  getDocumentUrl: (identifier: string) => string;
  getDocumentTitle: (identifier: string) => string;
}

/**
 * Hook that creates a document registry instance 
 * @returns Document registry object with methods for tracking documents
 */
export function useDocumentRegistry(): DocumentRegistryType {
  return useMemo(() => {
    return {
      documents: new Map<string, { id: number, title: string }>(),
      counter: 0,
      
      registerDocument(identifier: string, title?: string): number {
        if (this.documents.has(identifier)) {
          return this.documents.get(identifier)!.id;
        }
        const docId = ++this.counter;
        this.documents.set(identifier, {
          id: docId,
          title: title || `Document ${docId}`,
        });
        return docId;
      },
      getDocumentId(identifier: string): number | null {
        return this.documents.has(identifier) ? this.documents.get(identifier)!.id : null;
      },
      getDocumentUrl(identifier: string): string {
        return getDocumentViewerUrl(identifier);
      },
      getDocumentTitle(identifier: string): string {
        return this.documents.has(identifier) ? this.documents.get(identifier)!.title : `Document`;
      },
    };
  }, []);
}

/**
 * Track document click with the server
 * @param r2Key Document key
 * @param conversationId Conversation ID
 */
export async function trackDocumentClick(r2Key: string, conversationId: string): Promise<void> {
  try {
    // Construct the full URL for the document click endpoint
    const clickUrl = `${window.location.origin}/document-click`;

    // Send tracking request to server
    const response = await fetch(clickUrl, { 
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        conversationId,
        r2Key
      })
    });

    if (!response.ok) {
      console.error("Failed to track document click:", await response.text());
    }
  } catch (err) {
    // Log error but don't block document opening on failure
    console.error("Error tracking document click:", err);
  }
} 