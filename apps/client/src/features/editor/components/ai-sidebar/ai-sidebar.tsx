import React, { FC, useState, useRef, useEffect, useMemo, useCallback } from "react";
import { Box, Text, Textarea, ActionIcon, ScrollArea, Group, Modal, Button, Stack, Divider, Switch, Badge, CloseButton } from "@mantine/core";
import { IconSend, IconSparkles, IconHistory, IconTrash, IconCheck, IconX, IconArrowRight, IconFile } from "@tabler/icons-react";
import { useDisclosure } from "@mantine/hooks";
import { useTranslation } from "react-i18next";
import { markdownToHtml } from "@docmost/editor-ext";
import DOMPurify from "dompurify";
import api from "@/lib/api-client";
import classes from "./ai-sidebar.module.css";
import clsx from "clsx";
import { useParams, useNavigate } from "react-router-dom";
import { extractPageSlugId } from "@/lib";
import { ToolExecutor } from "@/features/ai/services/tool-executor";
import type { AiChatResponse, PageTaggedToolCall } from "@/features/ai/types/ai-tools.types";
import { AiChangeTracker, AiChange } from "@/features/ai/components/ai-change-tracker";
import { useAtom } from "jotai";
import { multiPageToolQueueAtom, multiPageEditingActiveAtom, type PageToolQueue } from "@/features/ai/atoms/multi-page-tools-atom";
import { AiMentionDropdown, type AiMentionDropdownHandle, type ResolvedMention } from "./ai-mention-dropdown";
import { buildPageUrl } from "@/features/page/page.utils";
import { searchSuggestions } from "@/features/search/services/search-service";

// Plan step from planner node
type PlanStep = {
  step: number;
  action: string;
  target: string | string[];
  purpose: string;
};

// Mentioned document from @ mentions
type MentionedDocument = {
  pageId: string;
  title: string;
  matchText: string;
  resolved: boolean;
};

type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
  toolCalls?: Array<{
    name: string;
    status: "pending" | "executing" | "completed" | "failed";
    result?: string;
  }>;
  isStreaming?: boolean;
  plan?: PlanStep[];
  queryType?: string;
  scope?: string;
};

type AiSidebarProps = {
  editor?: any;
};

export const AiSidebar: FC<AiSidebarProps> = (props) => {
  const { editor } = props;
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { pageSlug } = useParams();
  const pageId = pageSlug ? extractPageSlugId(pageSlug) : undefined;
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [chatHistory, setChatHistory] = useState<any[]>([]);
  const [historyOpened, { open: openHistory, close: closeHistory }] = useDisclosure(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [previewMode, setPreviewMode] = useState(false); // Sidebar preview mode
  const [inlineTrackingEnabled, setInlineTrackingEnabled] = useState(true); // Inline accept/reject in editor
  const [proposedChanges, setProposedChanges] = useState<AiChange[]>([]);

  // Track executed tools to prevent duplicate execution
  // The AI agent accumulates pending_tool_calls across iterations, so we need to deduplicate
  const executedToolsRef = useRef<Set<string>>(new Set());

  // Track pending changes in the editor for bulk accept/reject
  const [pendingChangesCount, setPendingChangesCount] = useState(0);

  // Multi-page editing state
  const [multiPageQueue, setMultiPageQueue] = useAtom(multiPageToolQueueAtom);
  const [multiPageActive, setMultiPageActive] = useAtom(multiPageEditingActiveAtom);

  // @ mention dropdown state
  const [mentionDropdownVisible, setMentionDropdownVisible] = useState(false);
  const [resolvedMentions, setResolvedMentions] = useState<ResolvedMention[]>([]);
  const [cursorPosition, setCursorPosition] = useState(0);
  const mentionDropdownRef = useRef<AiMentionDropdownHandle>(null);

  // Parse @ mentions from input text
  // Supports @"Document Name" or @DocumentName
  const parseMentions = useCallback((text: string): string[] => {
    const mentionRegex = /@"([^"]+)"|@(\S+)/g;
    const matches: string[] = [];
    let match;
    while ((match = mentionRegex.exec(text)) !== null) {
      matches.push((match[1] || match[2]).trim());
    }
    return matches;
  }, []);

  // Resolve mentions to page IDs by searching workspace
  const resolveMentions = useCallback(async (mentions: string[]): Promise<MentionedDocument[]> => {
    const resolved: MentionedDocument[] = [];

    for (const mention of mentions) {
      try {
        const response = await api.post('/external-service/ai/workspace/search', {
          query: mention,
          searchType: 'title',
          limit: 1,
        });

        if (response.data?.results?.[0]) {
          const page = response.data.results[0];
          resolved.push({
            pageId: page.pageId || page.id,
            title: page.title,
            matchText: mention,
            resolved: true,
          });
          console.log(`[AiSidebar] Resolved @${mention} -> ${page.title} (${page.pageId || page.id})`);
        } else {
          console.warn(`[AiSidebar] Could not resolve @${mention}`);
        }
      } catch (error) {
        console.error(`[AiSidebar] Failed to resolve @${mention}:`, error);
      }
    }

    return resolved;
  }, []);

  // Update pending changes count periodically
  useEffect(() => {
    if (!editor) return;

    const updateChangesCount = () => {
      const changes = editor.storage?.changeTracking?.changes || [];
      const pending = changes.filter((c: any) => c.status === 'pending');
      setPendingChangesCount(pending.length);
    };

    // Initial count
    updateChangesCount();

    // Update on document changes
    const handleUpdate = () => {
      setTimeout(updateChangesCount, 100);
    };

    editor.on('update', handleUpdate);
    editor.on('transaction', handleUpdate);

    return () => {
      editor.off('update', handleUpdate);
      editor.off('transaction', handleUpdate);
    };
  }, [editor]);

  // Bulk accept all changes
  const handleAcceptAllEditorChanges = useCallback(() => {
    if (!editor) return;
    try {
      (editor.commands as any).acceptAllChanges?.();
      setPendingChangesCount(0);
    } catch (e) {
      console.error('[AiSidebar] Error accepting all changes:', e);
    }
  }, [editor]);

  // Bulk reject all changes
  const handleRejectAllEditorChanges = useCallback(() => {
    if (!editor) return;
    try {
      (editor.commands as any).rejectAllChanges?.();
      setPendingChangesCount(0);
    } catch (e) {
      console.error('[AiSidebar] Error rejecting all changes:', e);
    }
  }, [editor]);

  // Create ToolExecutor instance when editor is available
  const toolExecutor = useMemo(() => {
    if (!editor) {
      return null;
    }
    try {
      const executor = new ToolExecutor(editor);
      
      // Set modes
      executor.setPreviewMode(previewMode);
      executor.setInlineTracking(inlineTrackingEnabled);
      
      // Listen for proposed changes (sidebar mode)
      executor.onChangeProposed((change: AiChange) => {
        setProposedChanges((prev) => [...prev, change]);
      });
      
      return executor;
    } catch (error) {
      console.error("[AiSidebar] Failed to create ToolExecutor:", error);
      return null;
    }
  }, [editor]);

  // Update modes when they change
  useEffect(() => {
    if (toolExecutor) {
      toolExecutor.setPreviewMode(previewMode);
      toolExecutor.setInlineTracking(inlineTrackingEnabled);
    }
  }, [previewMode, inlineTrackingEnabled, toolExecutor]);

  // Auto-apply queued tools after navigation to a new page
  useEffect(() => {
    if (!editor || !multiPageActive) return;

    const navigatingEntry = multiPageQueue.find((q) => q.status === "navigating");
    if (!navigatingEntry) return;

    // Wait for editor to initialize after navigation
    const timer = setTimeout(() => {
      try {
        const executor = new ToolExecutor(editor);
        executor.setPreviewMode(previewMode);
        executor.setInlineTracking(inlineTrackingEnabled);

        console.log("[AiSidebar] Auto-applying", navigatingEntry.tools.length, "tools for page", navigatingEntry.pageId);

        for (const tool of navigatingEntry.tools) {
          executor.execute(tool as any);
        }

        // Mark this entry as completed
        setMultiPageQueue((prev) =>
          prev.map((q) =>
            q.pageId === navigatingEntry.pageId ? { ...q, status: "completed" as const } : q
          )
        );

        // Check if all entries are done
        const remaining = multiPageQueue.filter(
          (q) => q.status === "pending" && q.pageId !== navigatingEntry.pageId
        );
        if (remaining.length === 0) {
          setMultiPageActive(false);
        }
      } catch (e) {
        console.error("[AiSidebar] Error auto-applying tools after navigation:", e);
      }
    }, 500);

    return () => clearTimeout(timer);
  }, [editor, multiPageActive, multiPageQueue]);

  // Handle "Review Next File" button click
  const handleReviewNextFile = useCallback(async () => {
    const nextEntry = multiPageQueue.find((q) => q.status === "pending");
    if (!nextEntry) return;

    let { slugId, spaceSlug, title } = nextEntry.pageInfo;

    // If we don't have slugId, try to resolve it via search
    if (!slugId && title) {
      try {
        const result = await searchSuggestions({
          query: title,
          includePages: true,
          limit: 1,
        });
        const page = result.pages?.[0];
        if (page) {
          slugId = page.slugId;
          spaceSlug = page.space?.slug;
        }
      } catch (e) {
        console.error("[AiSidebar] Error resolving page for navigation:", e);
      }
    }

    if (!slugId) {
      console.warn("[AiSidebar] Cannot navigate: no slugId for page", nextEntry.pageId);
      return;
    }

    // Mark as navigating
    setMultiPageQueue((prev) =>
      prev.map((q) =>
        q.pageId === nextEntry.pageId ? { ...q, status: "navigating" as const } : q
      )
    );

    // Navigate to the page
    const url = buildPageUrl(spaceSlug || "", slugId, title);
    navigate(url);
  }, [multiPageQueue, navigate, setMultiPageQueue]);

  // Skip all remaining multi-page edits
  const handleSkipAllRemaining = useCallback(() => {
    setMultiPageQueue((prev) =>
      prev.map((q) => (q.status === "pending" ? { ...q, status: "completed" as const } : q))
    );
    setMultiPageActive(false);
  }, [setMultiPageQueue, setMultiPageActive]);

  // Handle @ mention selection from dropdown
  const handleMentionSelect = useCallback(
    (mention: ResolvedMention, insertText: string) => {
      const textarea = textareaRef.current;
      if (!textarea) return;

      const pos = cursorPosition;
      const textBeforeCursor = input.substring(0, pos);
      const atIndex = textBeforeCursor.lastIndexOf("@");

      if (atIndex === -1) return;

      // Replace from @ to cursor with the insertText
      const newInput = input.substring(0, atIndex) + insertText + input.substring(pos);
      setInput(newInput);

      // Track the resolved mention
      setResolvedMentions((prev) => [...prev, mention]);

      // Update cursor position after insertion
      const newCursorPos = atIndex + insertText.length;
      setCursorPosition(newCursorPos);

      // Focus and set cursor position
      setTimeout(() => {
        textarea.focus();
        textarea.setSelectionRange(newCursorPos, newCursorPos);
      }, 0);
    },
    [input, cursorPosition]
  );

  // Remove a resolved mention badge
  const handleRemoveMention = useCallback(
    (idx: number) => {
      setResolvedMentions((prev) => prev.filter((_, i) => i !== idx));
    },
    []
  );

  const handleAcceptChange = (changeId: string) => {
    if (toolExecutor) {
      const success = toolExecutor.applyChange(changeId);
      if (success) {
        setProposedChanges((prev) =>
          prev.map((change) =>
            change.id === changeId ? { ...change, status: "accepted" as const } : change
          )
        );
      }
    }
  };

  const handleRejectChange = (changeId: string) => {
    if (toolExecutor) {
      toolExecutor.rejectChange(changeId);
      setProposedChanges((prev) =>
        prev.map((change) =>
          change.id === changeId ? { ...change, status: "rejected" as const } : change
        )
      );
    }
  };

  const handleAcceptAllChanges = () => {
    proposedChanges
      .filter((c) => c.status === "pending")
      .forEach((change) => handleAcceptChange(change.id));
  };

  const handleRejectAllChanges = () => {
    proposedChanges
      .filter((c) => c.status === "pending")
      .forEach((change) => handleRejectChange(change.id));
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  useEffect(() => {
    loadChatHistory();
  }, []);

  const loadChatHistory = async () => {
    try {
      const response = await api.get("/external-service/ai/history");
      setChatHistory(response.data?.history || []);
    } catch (error) {
      console.error("Error loading chat history:", error);
    }
  };

  const loadChat = async (chatId: string) => {
    try {
      const response = await api.get(`/external-service/ai/history/${chatId}`);
      if (response.data?.messages) {
        const formattedMessages: Message[] = response.data.messages.map((msg: any) => ({
          id: Date.now().toString() + Math.random(),
          role: msg.role,
          content: msg.content,
          timestamp: new Date(),
        }));
        setMessages(formattedMessages);
        closeHistory();
      }
    } catch (error) {
      console.error("Error loading chat:", error);
    }
  };

  const deleteChat = async (chatId: string) => {
    try {
      await api.delete(`/external-service/ai/history/${chatId}`);
      loadChatHistory();
    } catch (error) {
      console.error("Error deleting chat:", error);
    }
  };

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;

    const currentInput = input.trim();

    // Use pre-resolved mentions from the dropdown first
    let mentionedDocuments: MentionedDocument[] = resolvedMentions.map((m) => ({
      pageId: m.pageId,
      title: m.title,
      matchText: m.title,
      resolved: true,
    }));

    // Also parse any manually-typed @ mentions that weren't picked from dropdown
    const mentionTexts = parseMentions(currentInput);
    const alreadyResolved = new Set(resolvedMentions.map((m) => m.title.toLowerCase()));
    const unresolvedTexts = mentionTexts.filter((t) => !alreadyResolved.has(t.toLowerCase()));

    if (unresolvedTexts.length > 0) {
      console.log("[AiSidebar] Resolving manually-typed mentions:", unresolvedTexts);
      const extraDocs = await resolveMentions(unresolvedTexts);
      mentionedDocuments = [...mentionedDocuments, ...extraDocs];
    }

    if (mentionedDocuments.length > 0) {
      console.log("[AiSidebar] Total mentioned documents:", mentionedDocuments);
    }

    // Clear resolved mentions after sending
    setResolvedMentions([]);

    const userMessage: Message = {
      id: Date.now().toString(),
      role: "user",
      content: currentInput,
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setIsLoading(true);

    // Clear executed tools for new message - prevents stale deduplication
    executedToolsRef.current.clear();

    // Create assistant message that will be updated via streaming
    const assistantMessageId = (Date.now() + 1).toString();
    const assistantMessage: Message = {
      id: assistantMessageId,
      role: "assistant",
      content: "",
      timestamp: new Date(),
      isStreaming: true,
      toolCalls: [],
    };

    setMessages((prev) => [...prev, assistantMessage]);

    try {
      // Prepare messages for API (include conversation history)
      const apiMessages = [...messages, userMessage].map((msg) => ({
        role: msg.role,
        content: msg.content,
      }));

      // Build request body with mentioned documents
      const requestBody: any = {
        messages: apiMessages,
        ...(pageId && { pageId }),
      };

      // Add mentioned documents if any were resolved
      if (mentionedDocuments.length > 0) {
        requestBody.mentionedDocuments = mentionedDocuments
          .filter(m => m.resolved)
          .map(m => ({ pageId: m.pageId, title: m.title }));
        console.log("[AiSidebar] Sending mentioned documents:", requestBody.mentionedDocuments);
      }

      console.log("[AiSidebar] Starting streaming request...");

      // Use fetch for SSE streaming
      const response = await fetch("/api/external-service/ai/chat/stream", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      if (!reader) {
        throw new Error("Response body is not readable");
      }

      let buffer = "";
      let currentEventType = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          console.log("[AiSidebar] Stream completed");
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.trim()) continue;

          if (line.startsWith("event: ")) {
            currentEventType = line.slice(7).trim();
            console.log("[AiSidebar] Event type:", currentEventType);
            continue;
          }

          if (line.startsWith("data: ")) {
            const data = line.slice(6).trim();
            
            try {
              const event = JSON.parse(data);
              console.log("[AiSidebar] Received event:", event.type || currentEventType, event);

              setMessages((prev) =>
                prev.map((msg) => {
                  if (msg.id !== assistantMessageId) return msg;

                  const eventType = event.type || currentEventType;

                  switch (eventType) {
                    case "plan":
                      // Execution plan from planner node
                      console.log("[AiSidebar] Received plan:", event.plan);
                      return {
                        ...msg,
                        plan: event.plan,
                        queryType: event.query_type,
                        scope: event.scope,
                      };

                    case "context_gathered":
                      // Context has been gathered, agent is processing
                      console.log("[AiSidebar] Context gathered");
                      return msg;

                    case "message":
                      // Append text content
                      return {
                        ...msg,
                        content: (msg.content || "") + (event.content || ""),
                      };

                    case "tool_calls":
                      // Add tool calls to message
                      console.log("[AiSidebar] Adding tool calls:", event.tool_calls);
                      const newToolCalls = event.tool_calls.map((tc: any) => ({
                        name: tc.name,
                        status: "executing" as const,
                      }));
                      return {
                        ...msg,
                        toolCalls: [...(msg.toolCalls || []), ...newToolCalls],
                      };

                    case "tool_result":
                      // Update tool call status
                      console.log("[AiSidebar] Tool result for:", event.tool_name);
                      return {
                        ...msg,
                        toolCalls: (msg.toolCalls || []).map((tc) =>
                          tc.name === event.tool_name
                            ? { ...tc, status: "completed" as const, result: event.content }
                            : tc
                        ),
                      };

                    case "pending_tools":
                      // Execute pending tools in frontend
                      // IMPORTANT: Deduplicate tools since AI agent accumulates pending_tool_calls across iterations
                      // Group by pageId: current page tools execute immediately, other pages are queued
                      console.log("[AiSidebar] Received pending tools:", event.tools?.length || 0);
                      if (event.tools) {
                        const currentPageTools: any[] = [];
                        const otherPageTools: Map<string, { pageInfo: any; tools: any[] }> = new Map();

                        // Separate tools by target page
                        for (const tool of event.tools) {
                          const toolId = `${tool.tool}_${JSON.stringify(tool.params || {})}`;
                          if (executedToolsRef.current.has(toolId)) {
                            console.log(`[AiSidebar] Skipping duplicate tool: ${tool.tool}`);
                            continue;
                          }
                          executedToolsRef.current.add(toolId);

                          const toolPageId = tool.pageId;
                          // If no pageId or matches current page, execute on current page
                          if (!toolPageId || toolPageId === pageId) {
                            currentPageTools.push(tool);
                          } else {
                            // Queue for another page
                            if (!otherPageTools.has(toolPageId)) {
                              otherPageTools.set(toolPageId, {
                                pageInfo: tool.pageInfo || { pageId: toolPageId },
                                tools: [],
                              });
                            }
                            otherPageTools.get(toolPageId)!.tools.push({
                              tool: tool.tool,
                              params: tool.params,
                            });
                          }
                        }

                        // Execute current page tools immediately
                        if (toolExecutor && currentPageTools.length > 0) {
                          for (const tool of currentPageTools) {
                            console.log("[AiSidebar] Executing tool:", tool.tool);
                            try {
                              const success = toolExecutor.execute(tool);
                              console.log(`[AiSidebar] Tool ${tool.tool} executed:`, success);
                              setMessages((msgs) =>
                                msgs.map((m) => {
                                  if (m.id !== assistantMessageId) return m;
                                  return {
                                    ...m,
                                    toolCalls: (m.toolCalls || []).map((tc) =>
                                      tc.name === tool.tool
                                        ? { ...tc, status: success ? ("completed" as const) : ("failed" as const) }
                                        : tc
                                    ),
                                  };
                                })
                              );
                            } catch (err) {
                              console.error(`[AiSidebar] Tool execution error for ${tool.tool}:`, err);
                            }
                          }
                        }

                        // Queue other page tools for "Review Next File"
                        if (otherPageTools.size > 0) {
                          const newQueueEntries: PageToolQueue[] = [];
                          for (const [pid, data] of otherPageTools) {
                            newQueueEntries.push({
                              pageId: pid,
                              pageInfo: data.pageInfo,
                              tools: data.tools,
                              status: "pending",
                            });
                          }
                          console.log("[AiSidebar] Queuing tools for", newQueueEntries.length, "other page(s)");
                          setMultiPageQueue((prev) => [...prev, ...newQueueEntries]);
                          setMultiPageActive(true);
                        }
                      } else if (!toolExecutor) {
                        console.warn("[AiSidebar] ToolExecutor not available");
                      }
                      return msg;

                    case "done":
                      // Mark streaming complete
                      console.log("[AiSidebar] Stream done");
                      return {
                        ...msg,
                        isStreaming: false,
                      };

                    case "error":
                      // Handle error
                      console.error("[AiSidebar] Stream error:", event.error);
                      return {
                        ...msg,
                        content: msg.content || `Error: ${event.error}`,
                        isStreaming: false,
                      };

                    default:
                      return msg;
                  }
                })
              );
            } catch (e) {
              // Ignore parse errors for incomplete chunks
              console.debug("[AiSidebar] SSE parse error:", e, "Line:", line);
            }
          }
        }
      }

      // Reload chat history after streaming completes
      loadChatHistory();
    } catch (error) {
      console.error("[AiSidebar] Error calling AI service:", error);
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === assistantMessageId
            ? {
                ...msg,
                content: "Sorry, there was an error connecting to the AI service. Please try again.",
                isStreaming: false,
              }
            : msg
        )
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Let mention dropdown handle keys first
    if (mentionDropdownVisible && mentionDropdownRef.current) {
      const consumed = mentionDropdownRef.current.handleKeyDown(e);
      if (consumed) return;
    }

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <>
      <Box className={classes.container}>
        <Group justify="space-between" p="xs" style={{ borderBottom: "1px solid var(--mantine-color-gray-3)" }}>
          <ActionIcon
            variant="subtle"
            size="sm"
            onClick={openHistory}
            title={t("Chat History")}
          >
            <IconHistory size={16} stroke={1.5} />
          </ActionIcon>

          <Group gap="xs">
            <Switch
              size="xs"
              label={t("Inline")}
              checked={inlineTrackingEnabled}
              onChange={(event) => {
                setInlineTrackingEnabled(event.currentTarget.checked);
                // If inline is enabled, disable sidebar preview
                if (event.currentTarget.checked) {
                  setPreviewMode(false);
                }
              }}
              styles={{
                label: { fontSize: "10px" },
              }}
              title={t("Show changes inline with accept/reject buttons")}
            />
          </Group>
        </Group>

        {/* Bulk Accept/Reject bar - shown when there are pending changes */}
        {pendingChangesCount > 0 && (
          <Group justify="space-between" p="xs" style={{
            backgroundColor: "var(--mantine-color-blue-0)",
            borderBottom: "1px solid var(--mantine-color-blue-2)",
          }}>
            <Group gap="xs">
              <Badge size="sm" color="blue" variant="light">
                {pendingChangesCount} {pendingChangesCount === 1 ? t("change") : t("changes")}
              </Badge>
            </Group>
            <Group gap="xs">
              <Button
                size="compact-xs"
                variant="filled"
                color="green"
                leftSection={<IconCheck size={12} />}
                onClick={handleAcceptAllEditorChanges}
                title={t("Accept all changes")}
              >
                {t("Accept All")}
              </Button>
              <Button
                size="compact-xs"
                variant="filled"
                color="red"
                leftSection={<IconX size={12} />}
                onClick={handleRejectAllEditorChanges}
                title={t("Reject all changes (undo)")}
              >
                {t("Reject All")}
              </Button>
            </Group>
          </Group>
        )}

        {/* Multi-page "Review Next File" banner */}
        {multiPageActive && (() => {
          const pendingEntries = multiPageQueue.filter((q) => q.status === "pending");
          if (pendingEntries.length === 0) return null;
          const nextEntry = pendingEntries[0];
          return (
            <Box
              p="xs"
              style={{
                backgroundColor: "var(--mantine-color-violet-0)",
                borderBottom: "1px solid var(--mantine-color-violet-2)",
              }}
            >
              <Group justify="space-between" mb={4}>
                <Text size="xs" fw={600} c="violet.7">
                  {pendingEntries.length} more {pendingEntries.length === 1 ? "file" : "files"} to review
                </Text>
                <Text
                  size="xs"
                  c="dimmed"
                  style={{ cursor: "pointer", textDecoration: "underline" }}
                  onClick={handleSkipAllRemaining}
                >
                  {t("Skip All")}
                </Text>
              </Group>
              <Button
                size="compact-sm"
                variant="light"
                color="violet"
                fullWidth
                rightSection={<IconArrowRight size={14} />}
                leftSection={<IconFile size={14} />}
                onClick={handleReviewNextFile}
              >
                {nextEntry.pageInfo.title || "Next page"} ({nextEntry.tools.length} {nextEntry.tools.length === 1 ? "change" : "changes"})
              </Button>
            </Box>
          );
        })()}

        <ScrollArea
          ref={scrollAreaRef}
          className={classes.messagesContainer}
          scrollbarSize={5}
          type="scroll"
        >
          <Box className={classes.messages}>
            {messages.length === 0 ? (
              <Box className={classes.emptyState}>
                <IconSparkles size={48} className={classes.emptyIcon} />
                <Text size="sm" c="dimmed" ta="center">
                  {t("Start a conversation with AI")}
                </Text>
                <Text size="xs" c="dimmed" ta="center" mt="xs">
                  {t("Ask questions or get help with your document")}
                </Text>
              </Box>
            ) : (
              messages.map((message) => (
                <Box
                  key={message.id}
                  className={clsx(classes.message, {
                    [classes.userMessage]: message.role === "user",
                    [classes.assistantMessage]: message.role === "assistant",
                  })}
                >
                  <Box className={classes.messageContent}>
                    {message.role === "assistant" ? (
                      <>
                        {/* Show execution plan if any */}
                        {message.plan && message.plan.length > 0 && (
                          <Box
                            mb="xs"
                            p="xs"
                            style={{
                              backgroundColor: "var(--mantine-color-blue-0)",
                              borderRadius: "var(--mantine-radius-sm)",
                              border: "1px solid var(--mantine-color-blue-2)",
                            }}
                          >
                            <Group gap="xs" mb="xs">
                              <Text size="xs" fw={600} c="blue.7">
                                {t("Plan")}:
                              </Text>
                              {message.scope && (
                                <Badge size="xs" variant="light" color="blue">
                                  {message.scope === "multi_doc" ? t("Multi-doc") : message.scope === "workspace" ? t("Workspace") : t("Single doc")}
                                </Badge>
                              )}
                              {message.queryType && (
                                <Badge size="xs" variant="outline" color="gray">
                                  {message.queryType}
                                </Badge>
                              )}
                            </Group>
                            {message.plan.map((step, idx) => (
                              <Group key={idx} gap="xs" ml="xs" mb={2}>
                                <Text size="xs" c="dimmed" style={{ minWidth: 16 }}>
                                  {step.step}.
                                </Text>
                                <Badge size="xs" variant="light" color="gray">
                                  {step.action}
                                </Badge>
                                <Text size="xs" c="dimmed" style={{ flex: 1 }}>
                                  {step.purpose}
                                </Text>
                              </Group>
                            ))}
                          </Box>
                        )}

                        {/* Show tool calls if any */}
                        {message.toolCalls && message.toolCalls.length > 0 && (
                          <Box mb="xs">
                            {message.toolCalls.map((toolCall, idx) => (
                              <Box
                                key={idx}
                                p="xs"
                                mb="xs"
                                style={{
                                  backgroundColor: "var(--mantine-color-gray-0)",
                                  borderRadius: "var(--mantine-radius-sm)",
                                  border: "1px solid var(--mantine-color-gray-3)",
                                }}
                              >
                                <Group gap="xs">
                                  {toolCall.status === "pending" && (
                                    <IconSparkles size={14} color="gray" />
                                  )}
                                  {toolCall.status === "executing" && (
                                    <IconSparkles size={14} color="blue" />
                                  )}
                                  {toolCall.status === "completed" && (
                                    <IconSparkles size={14} color="green" />
                                  )}
                                  {toolCall.status === "failed" && (
                                    <IconSparkles size={14} color="red" />
                                  )}
                                  <Text size="xs" fw={500}>
                                    {toolCall.name.replace(/_/g, " ")}
                                  </Text>
                                  {toolCall.status === "completed" && (
                                    <Text size="xs" c="dimmed">
                                      ✓
                                    </Text>
                                  )}
                                  {toolCall.status === "failed" && (
                                    <Text size="xs" c="red">
                                      ✗
                                    </Text>
                                  )}
                                </Group>
                                {toolCall.result && (
                                  <Text size="xs" c="dimmed" mt="xs">
                                    {toolCall.result}
                                  </Text>
                                )}
                              </Box>
                            ))}
                          </Box>
                        )}
                        
                        {/* Show message content */}
                        {message.content && (
                          <div
                            className={classes.markdownContent}
                            dangerouslySetInnerHTML={{
                              __html: DOMPurify.sanitize(markdownToHtml(message.content) as string),
                            }}
                          />
                        )}
                        
                        {/* Show streaming indicator */}
                        {message.isStreaming && (
                          <Text size="sm" c="dimmed">
                            {t("Thinking...")}
                          </Text>
                        )}
                      </>
                    ) : (
                      <Text size="sm" style={{ whiteSpace: "pre-wrap" }}>
                        {message.content}
                      </Text>
                    )}
                  </Box>
                </Box>
              ))
            )}
            <div ref={messagesEndRef} />
          </Box>
        </ScrollArea>

        <Box className={classes.inputContainer}>
          {/* Resolved mention badges */}
          {resolvedMentions.length > 0 && (
            <Group gap={4} p="4px 6px" style={{ flexWrap: "wrap" }}>
              {resolvedMentions.map((mention, idx) => (
                <Badge
                  key={`${mention.pageId}-${idx}`}
                  size="xs"
                  variant="light"
                  color="blue"
                  rightSection={
                    <CloseButton
                      size="xs"
                      variant="transparent"
                      onClick={() => handleRemoveMention(idx)}
                      style={{ marginLeft: -4 }}
                    />
                  }
                >
                  {mention.title}
                </Badge>
              ))}
            </Group>
          )}

          <Box className={classes.inputWrapper} style={{ position: "relative" }}>
            {/* @ mention dropdown */}
            <AiMentionDropdown
              ref={mentionDropdownRef}
              inputValue={input}
              cursorPosition={cursorPosition}
              textareaRef={textareaRef}
              onSelect={handleMentionSelect}
              visible={mentionDropdownVisible}
              onVisibilityChange={setMentionDropdownVisible}
            />

            <Textarea
              ref={textareaRef}
              className={classes.input}
              classNames={{ input: classes.inputTextarea }}
              placeholder={t("Ask AI anything... (@ to mention pages)")}
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                setCursorPosition(e.target.selectionStart || 0);
              }}
              onKeyDown={handleKeyDown}
              onSelect={(e) => {
                setCursorPosition((e.target as HTMLTextAreaElement).selectionStart || 0);
              }}
              onClick={(e) => {
                setCursorPosition((e.target as HTMLTextAreaElement).selectionStart || 0);
              }}
              minRows={1}
              maxRows={4}
              autosize
              disabled={isLoading}
              size="xs"
            />
            <ActionIcon
              variant="subtle"
              size="xs"
              onClick={handleSend}
              disabled={!input.trim() || isLoading}
              className={classes.sendButton}
            >
              <IconSend size={14} stroke={1.5} />
            </ActionIcon>
          </Box>
        </Box>
      </Box>

      <Modal opened={historyOpened} onClose={closeHistory} title={t("Chat History")} size="md">
        <Divider size="xs" mb="md" />
        <Stack gap="xs">
          {chatHistory.length === 0 ? (
            <Text size="sm" c="dimmed" ta="center" py="md">
              {t("No chat history yet")}
            </Text>
          ) : (
            chatHistory.map((chat) => (
              <Box
                key={chat.id}
                p="sm"
                style={{
                  border: "1px solid",
                  borderColor: "var(--mantine-color-gray-3)",
                  borderRadius: "var(--mantine-radius-sm)",
                  cursor: "pointer",
                }}
                onClick={() => loadChat(chat.id)}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = "var(--mantine-color-gray-0)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = "transparent";
                }}
              >
                <Group justify="space-between" wrap="nowrap">
                  <Box style={{ flex: 1, minWidth: 0 }}>
                    <Text size="sm" fw={500} truncate>
                      {chat.title || t("Untitled Chat")}
                    </Text>
                    <Text size="xs" c="dimmed">
                      {new Date(chat.createdAt).toLocaleString()}
                    </Text>
                  </Box>
                  <ActionIcon
                    variant="subtle"
                    color="red"
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteChat(chat.id);
                    }}
                  >
                    <IconTrash size={14} stroke={1.5} />
                  </ActionIcon>
                </Group>
              </Box>
            ))
          )}
        </Stack>
      </Modal>

      {/* AI Change Tracker */}
      {previewMode && proposedChanges.length > 0 && (
        <AiChangeTracker
          editor={editor}
          changes={proposedChanges}
          onAccept={handleAcceptChange}
          onReject={handleRejectChange}
          onAcceptAll={handleAcceptAllChanges}
          onRejectAll={handleRejectAllChanges}
        />
      )}
    </>
  );
};

