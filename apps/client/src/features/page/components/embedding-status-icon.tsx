import { Loader, ActionIcon } from "@mantine/core";
import { IconCheck, IconX } from "@tabler/icons-react";
import { useEmbeddingStatusQuery } from "../queries/embedding-query";
import { useEffect } from "react";
import { useParams } from "react-router-dom";
import { extractPageSlugId } from "@/lib";
import { useQueryClient } from "@tanstack/react-query";
import { IPage } from "../types/page.types";
import { validate as isValidUuid } from "uuid";

interface EmbeddingStatusIconProps {
  pageId: string; // This is the UUID from node.id
  size?: number;
}

/**
 * Component that shows embedding sync status:
 * - Spinner when embeddings are being generated (hasEmbeddings === false) or loading
 * - Checkmark when embeddings are synced (hasEmbeddings === true)
 * - Cross mark when status is unknown or connection error (hasEmbeddings === null)
 * 
 * Only queries status for the currently open/active page to optimize performance.
 */
export function EmbeddingStatusIcon({ pageId, size = 12 }: EmbeddingStatusIconProps) {
  const { pageSlug } = useParams();
  const currentPageSlugId = extractPageSlugId(pageSlug);
  const queryClient = useQueryClient();
  
  // Get current page data from cache to compare both UUID and slugId
  const currentPage = currentPageSlugId 
    ? (queryClient.getQueryData<IPage>(["pages", currentPageSlugId]) || null)
    : null;
  
  // Check if this is the current page by comparing:
  // 1. UUID: pageId (prop) === currentPage.id
  // 2. slugId: currentPageSlugId === currentPage.slugId (already matched if we got the page)
  // 3. Or if pageId is actually a slugId, compare directly
  const isCurrentPage = currentPage
    ? currentPage.id === pageId || currentPage.slugId === pageId
    : currentPageSlugId === pageId; // Fallback: direct comparison if page not in cache
  
  // Use UUID for API call (pageId is UUID, but API also accepts slugId)
  const pageIdForQuery = isCurrentPage && currentPage ? currentPage.id : (isCurrentPage ? pageId : undefined);
  
  console.log("[EmbeddingStatusIcon] Component render:", {
    pageId, // UUID from node.id
    currentPageSlugId, // slugId from URL
    currentPageId: currentPage?.id, // UUID from current page
    currentPageSlugIdFromPage: currentPage?.slugId, // slugId from current page
    pageSlug,
    isCurrentPage,
    pageIdForQuery,
    size,
  });
  
  const { data, isLoading, isError, error, status, fetchStatus } = useEmbeddingStatusQuery(
    pageIdForQuery // Use UUID for query
  );

  // Comprehensive debug logging
  useEffect(() => {
    console.log("[EmbeddingStatusIcon] Query state changed:", {
      pageId,
      currentPageSlugId,
      currentPageId: currentPage?.id,
      isCurrentPage,
      pageIdForQuery,
      isLoading,
      isError,
      status, // 'pending' | 'error' | 'success'
      fetchStatus, // 'fetching' | 'paused' | 'idle'
      hasEmbeddings: data?.hasEmbeddings,
      dataType: typeof data?.hasEmbeddings,
      dataFull: data,
      error: error?.message || error,
      errorFull: error,
    });
  }, [pageId, currentPageSlugId, currentPage, isCurrentPage, pageIdForQuery, isLoading, isError, status, fetchStatus, data, error]);
  
  // Don't show anything if this is not the current page
  if (!isCurrentPage) {
    console.log("[EmbeddingStatusIcon] Not current page, returning null:", {
      pageId,
      currentPageSlugId,
      currentPageId: currentPage?.id,
    });
    return null;
  }

  // Show spinner ONLY during initial loading (first fetch)
  if (isLoading && !data) {
    console.log("[EmbeddingStatusIcon] Rendering SPINNER (initial load):", {
      isLoading,
      hasData: !!data,
      size,
    });
    return (
      <div
        style={{ 
          display: "inline-flex", 
          alignItems: "center", 
          justifyContent: "center",
          width: size,
          height: size,
          minWidth: size,
          minHeight: size,
        }}
      >
        <Loader size={size} color="blue" type="dots" />
      </div>
    );
  }

  // Show checkmark when embeddings exist (synced)
  if (data?.hasEmbeddings === true) {
    console.log("[EmbeddingStatusIcon] Rendering CHECKMARK:", {
      hasEmbeddings: data.hasEmbeddings,
      size,
      dataFull: data,
    });
    return (
      <div
        style={{ 
          display: "inline-flex", 
          alignItems: "center", 
          justifyContent: "center",
          width: size,
          height: size,
          minWidth: size,
          minHeight: size,
          color: "var(--mantine-color-blue-6)",
        }}
      >
        <IconCheck size={size} stroke={2.5} />
      </div>
    );
  }

  // Show cross mark for all other cases:
  // - No embeddings exist (hasEmbeddings === false) - empty/new page
  // - Status is unknown (hasEmbeddings === null) - Cloud AI server unavailable
  // - Error occurred (isError)
  // - Any other unexpected state
  console.log("[EmbeddingStatusIcon] Rendering CROSS (default case):", {
    isError,
    hasEmbeddings: data?.hasEmbeddings,
    hasEmbeddingsType: typeof data?.hasEmbeddings,
    size,
    dataFull: data,
    error: error?.message || error,
  });
  return (
    <div
      style={{ 
        display: "inline-flex", 
        alignItems: "center", 
        justifyContent: "center",
        width: size,
        height: size,
        minWidth: size,
        minHeight: size,
        color: "var(--mantine-color-blue-6)",
      }}
    >
      <IconX size={size} stroke={2.5} />
    </div>
  );
}

