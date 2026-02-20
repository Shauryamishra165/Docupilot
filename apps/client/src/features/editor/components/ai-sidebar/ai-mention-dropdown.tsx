import React, { useState, useEffect, useRef, useCallback, forwardRef, useImperativeHandle } from "react";
import { Box, Paper, Text, UnstyledButton, ScrollArea, Loader } from "@mantine/core";
import { IconFile } from "@tabler/icons-react";
import { searchSuggestions } from "@/features/search/services/search-service";
import type { IPage } from "@/features/page/types/page.types";

export interface ResolvedMention {
  pageId: string;
  title: string;
  slugId: string;
  spaceSlug?: string;
}

interface AiMentionDropdownProps {
  inputValue: string;
  cursorPosition: number;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  onSelect: (mention: ResolvedMention, insertText: string) => void;
  visible: boolean;
  onVisibilityChange: (visible: boolean) => void;
  spaceId?: string;
}

export interface AiMentionDropdownHandle {
  handleKeyDown: (e: React.KeyboardEvent) => boolean;
}

export const AiMentionDropdown = forwardRef<AiMentionDropdownHandle, AiMentionDropdownProps>(
  ({ inputValue, cursorPosition, textareaRef, onSelect, visible, onVisibilityChange, spaceId }, ref) => {
    const [results, setResults] = useState<Partial<IPage>[]>([]);
    const [selectedIndex, setSelectedIndex] = useState(0);
    const [isSearching, setIsSearching] = useState(false);
    const [mentionQuery, setMentionQuery] = useState("");
    const [mentionStartPos, setMentionStartPos] = useState(-1);
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Detect @ trigger and extract query
    useEffect(() => {
      if (!inputValue || cursorPosition <= 0) {
        if (visible) onVisibilityChange(false);
        return;
      }

      const textBeforeCursor = inputValue.substring(0, cursorPosition);

      // Find the last @ that isn't inside quotes (i.e., not already a completed mention like @"Page")
      const atIndex = textBeforeCursor.lastIndexOf("@");
      if (atIndex === -1) {
        if (visible) onVisibilityChange(false);
        return;
      }

      // Check if this @ is part of an already completed @"..." mention
      const afterAt = inputValue.substring(atIndex + 1);
      if (afterAt.startsWith('"') && afterAt.indexOf('"', 1) !== -1 && afterAt.indexOf('"', 1) < cursorPosition - atIndex - 1) {
        if (visible) onVisibilityChange(false);
        return;
      }

      // The character before @ should be start of string or whitespace
      if (atIndex > 0 && !/\s/.test(inputValue[atIndex - 1])) {
        if (visible) onVisibilityChange(false);
        return;
      }

      const query = textBeforeCursor.substring(atIndex + 1);

      // Don't show dropdown if query is too long (likely not a mention)
      if (query.length > 50) {
        if (visible) onVisibilityChange(false);
        return;
      }

      setMentionStartPos(atIndex);
      setMentionQuery(query);

      if (!visible) onVisibilityChange(true);
    }, [inputValue, cursorPosition]);

    // Debounced search
    useEffect(() => {
      if (!visible) return;

      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }

      // Show results even for empty query (show recent/popular pages)
      debounceRef.current = setTimeout(async () => {
        setIsSearching(true);
        try {
          const result = await searchSuggestions({
            query: mentionQuery || "",
            includePages: true,
            spaceId,
            limit: 8,
          });

          const pages = ((result.pages || []) as Partial<IPage>[]).filter((p) => !!p);
          setResults(pages);
          setSelectedIndex(0);
        } catch (error) {
          console.error("[AiMentionDropdown] Search error:", error);
          setResults([]);
        } finally {
          setIsSearching(false);
        }
      }, 200);

      return () => {
        if (debounceRef.current) {
          clearTimeout(debounceRef.current);
        }
      };
    }, [mentionQuery, visible, spaceId]);

    const handleSelect = useCallback(
      (page: Partial<IPage>) => {
        if (!page.id || !page.title) return;

        const mention: ResolvedMention = {
          pageId: page.id,
          title: page.title,
          slugId: page.slugId || "",
          spaceSlug: page.space?.slug,
        };

        const insertText = `@"${page.title}" `;
        onSelect(mention, insertText);
        onVisibilityChange(false);
        setResults([]);
      },
      [onSelect, onVisibilityChange]
    );

    // Expose keyboard handler to parent
    useImperativeHandle(ref, () => ({
      handleKeyDown: (e: React.KeyboardEvent): boolean => {
        if (!visible || results.length === 0) return false;

        switch (e.key) {
          case "ArrowDown":
            e.preventDefault();
            setSelectedIndex((prev) => (prev + 1) % results.length);
            return true;

          case "ArrowUp":
            e.preventDefault();
            setSelectedIndex((prev) => (prev - 1 + results.length) % results.length);
            return true;

          case "Enter":
            e.preventDefault();
            if (results[selectedIndex]) {
              handleSelect(results[selectedIndex]);
            }
            return true;

          case "Escape":
            e.preventDefault();
            onVisibilityChange(false);
            return true;

          case "Tab":
            if (results[selectedIndex]) {
              e.preventDefault();
              handleSelect(results[selectedIndex]);
              return true;
            }
            return false;

          default:
            return false;
        }
      },
    }));

    if (!visible) return null;

    return (
      <Paper
        shadow="md"
        withBorder
        style={{
          position: "absolute",
          bottom: "100%",
          left: 0,
          right: 0,
          zIndex: 100,
          maxHeight: 280,
          overflow: "hidden",
        }}
      >
        <ScrollArea.Autosize mah={280} type="scroll" scrollbarSize={5}>
          {isSearching && results.length === 0 ? (
            <Box p="sm" style={{ display: "flex", justifyContent: "center" }}>
              <Loader size="xs" />
            </Box>
          ) : results.length === 0 ? (
            <Box p="sm">
              <Text size="xs" c="dimmed" ta="center">
                {mentionQuery ? "No pages found" : "Type to search pages"}
              </Text>
            </Box>
          ) : (
            results.map((page, index) => (
              <UnstyledButton
                key={page.id}
                onClick={() => handleSelect(page)}
                w="100%"
                p="6px 10px"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  backgroundColor:
                    index === selectedIndex
                      ? "var(--mantine-color-blue-light)"
                      : "transparent",
                  borderRadius: 0,
                }}
                onMouseEnter={() => setSelectedIndex(index)}
              >
                {page.icon ? (
                  <Text size="sm" style={{ flexShrink: 0, width: 18, textAlign: "center" }}>
                    {page.icon}
                  </Text>
                ) : (
                  <IconFile size={16} stroke={1.5} style={{ flexShrink: 0, opacity: 0.5 }} />
                )}
                <Text size="xs" truncate style={{ flex: 1 }}>
                  {page.title || "Untitled"}
                </Text>
                {page.space?.name && (
                  <Text size="xs" c="dimmed" style={{ flexShrink: 0 }}>
                    {page.space.name}
                  </Text>
                )}
              </UnstyledButton>
            ))
          )}
        </ScrollArea.Autosize>
      </Paper>
    );
  }
);

AiMentionDropdown.displayName = "AiMentionDropdown";
