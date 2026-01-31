import React, { FC, useState, useRef, useEffect, useMemo } from "react";
import { Box, Text, Textarea, ActionIcon, ScrollArea, Group, Modal, Button, Stack, Divider, Switch } from "@mantine/core";
import { IconSend, IconSparkles, IconHistory, IconTrash } from "@tabler/icons-react";
import { useDisclosure } from "@mantine/hooks";
import { useTranslation } from "react-i18next";
import { markdownToHtml } from "@docmost/editor-ext";
import DOMPurify from "dompurify";
import api from "@/lib/api-client";
import classes from "./ai-sidebar.module.css";
import clsx from "clsx";
import { useParams } from "react-router-dom";
import { extractPageSlugId } from "@/lib";
import { ToolExecutor } from "@/features/ai/services/tool-executor";
import type { AiChatResponse } from "@/features/ai/types/ai-tools.types";
import { AiChangeTracker, AiChange } from "@/features/ai/components/ai-change-tracker";

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
};

type AiSidebarProps = {
  editor?: any;
};

export const AiSidebar: FC<AiSidebarProps> = (props) => {
  const { editor } = props;
  const { t } = useTranslation();
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

    const userMessage: Message = {
      id: Date.now().toString(),
      role: "user",
      content: input.trim(),
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);
    const currentInput = input.trim();
    setInput("");
    setIsLoading(true);

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

      console.log("[AiSidebar] Starting streaming request...");

      // Use fetch for SSE streaming
      const response = await fetch("/api/external-service/ai/chat/stream", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify({
          messages: apiMessages,
          ...(pageId && { pageId }),
        }),
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
                      console.log("[AiSidebar] Executing pending tools:", event.tools);
                      if (toolExecutor && event.tools) {
                        event.tools.forEach((tool: any) => {
                          console.log("[AiSidebar] Executing tool:", tool);
                          try {
                            const success = toolExecutor.execute(tool);
                            console.log(`[AiSidebar] Tool ${tool.tool} executed:`, success);
                            
                            // Update tool status in message
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
                        });
                      } else {
                        console.warn("[AiSidebar] ToolExecutor not available or no tools to execute");
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
          <Box className={classes.inputWrapper}>
            <Textarea
              ref={textareaRef}
              className={classes.input}
              classNames={{ input: classes.inputTextarea }}
              placeholder={t("Ask AI anything...")}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
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

