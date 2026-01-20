import { useQuery } from "@tanstack/react-query";
import api from "@/lib/api-client";

interface EmbeddingStatusResponse {
  hasEmbeddings: boolean | null;
}

/**
 * Hook to check embedding status for a page
 * Returns:
 * - true: Embeddings exist
 * - false: No embeddings
 * - null: Status unknown (Cloud AI server not available)
 */
export function useEmbeddingStatusQuery(pageId: string | undefined) {
  console.log("[useEmbeddingStatusQuery] Hook called:", {
    pageId,
    enabled: !!pageId,
  });

  return useQuery<EmbeddingStatusResponse>({
    queryKey: ["embeddings", "status", pageId],
    queryFn: async () => {
      console.log("[useEmbeddingStatusQuery] Query function called:", { pageId });
      
      if (!pageId) {
        console.log("[useEmbeddingStatusQuery] No pageId provided, returning null");
        return { hasEmbeddings: null };
      }
      
      try {
        console.log("[useEmbeddingStatusQuery] Calling API:", `/embeddings/status/${pageId}`);
        
        // Note: api.get() returns response.data directly due to interceptor
        const result: any = await api.get<any>(
          `/embeddings/status/${pageId}`
        );
        
        console.log("[useEmbeddingStatusQuery] API Response (raw):", {
          result,
          resultType: typeof result,
          isString: typeof result === 'string',
          isObject: typeof result === 'object',
          resultKeys: result && typeof result === 'object' ? Object.keys(result) : 'N/A',
        });
        
        // Check if response is HTML (404 or routing error)
        if (typeof result === 'string' && (result as string).trim().startsWith('<!')) {
          console.warn("[useEmbeddingStatusQuery] Received HTML instead of JSON - endpoint not found");
          return { hasEmbeddings: null };
        }
        
        // Handle different response structures
        let hasEmbeddings: boolean | null = null;
        
        // Check if result has nested data structure: {data: {hasEmbeddings: ...}}
        if (result && typeof result === 'object') {
          console.log("[useEmbeddingStatusQuery] Processing object result:", {
            hasDataKey: 'data' in result,
            hasDirectHasEmbeddings: 'hasEmbeddings' in result,
            dataValue: 'data' in result ? result.data : 'N/A',
            directHasEmbeddingsValue: 'hasEmbeddings' in result ? result.hasEmbeddings : 'N/A',
          });
          
          if ('data' in result && result.data && typeof result.data === 'object' && 'hasEmbeddings' in result.data) {
            const value = (result.data as any).hasEmbeddings;
            console.log("[useEmbeddingStatusQuery] Found nested data.hasEmbeddings:", {
              value,
              valueType: typeof value,
            });
            if (typeof value === 'boolean') {
              hasEmbeddings = value;
            } else if (value === null || value === undefined) {
              hasEmbeddings = null;
            }
          } 
          // Check if result has direct hasEmbeddings property
          else if ('hasEmbeddings' in result) {
            const value = (result as any).hasEmbeddings;
            console.log("[useEmbeddingStatusQuery] Found direct hasEmbeddings:", {
              value,
              valueType: typeof value,
            });
            if (typeof value === 'boolean') {
              hasEmbeddings = value;
            } else if (value === null || value === undefined) {
              hasEmbeddings = null;
            }
          } else {
            console.warn("[useEmbeddingStatusQuery] No hasEmbeddings found in result structure:", {
              resultKeys: Object.keys(result),
              result,
            });
          }
        } else {
          console.warn("[useEmbeddingStatusQuery] Result is not an object:", {
            resultType: typeof result,
            result,
          });
        }
        
        console.log("[useEmbeddingStatusQuery] Final extracted value:", {
          hasEmbeddings,
          hasEmbeddingsType: typeof hasEmbeddings,
        });
        
        return { hasEmbeddings };
      } catch (error: any) {
        // Return null if there's an error (connection issue, etc.)
        console.error("[useEmbeddingStatusQuery] API Error:", {
          error: error?.message || error,
          errorType: typeof error,
          errorFull: error,
          stack: error?.stack,
        });
        return { hasEmbeddings: null };
      }
    },
    enabled: !!pageId,
    retry: 1, // Only retry once on failure
    // NO automatic polling - only refetch when explicitly invalidated (e.g., when page content changes)
    refetchInterval: false,
    // Don't refetch automatically - only when page content changes (via websocket)
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    refetchOnReconnect: false,
    // Keep data fresh for 10 minutes - only refetch when embeddings are regenerated
    staleTime: 10 * 60 * 1000, // 10 minutes - data is considered fresh
    gcTime: 30 * 60 * 1000, // Keep in cache for 30 minutes
  });
}

