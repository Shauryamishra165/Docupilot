import React, { FC, useState, useRef, useEffect } from "react";
import { Box, Text, Textarea, ActionIcon, ScrollArea, Group, Modal, Button, Stack, Divider } from "@mantine/core";
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

type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
};

type AiSidebarProps = {
  editor?: any;
};

export const AiSidebar: FC<AiSidebarProps> = (props) => {
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

    try {
      // Prepare messages for API (include conversation history)
      const apiMessages = [...messages, userMessage].map((msg) => ({
        role: msg.role,
        content: msg.content,
      }));

      // Call backend AI chat endpoint (which will route to AI service)
      // Uses JWT authentication automatically via api client
      // Pass pageId if available so AI knows which document we're working with
      const response = await api.post("/external-service/ai/chat", {
        messages: apiMessages,
        ...(pageId && { pageId }), // Include pageId if available
      });

      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: response.data?.message || response.data || "Sorry, I couldn't generate a response.",
        timestamp: new Date(),
      };

      setMessages((prev) => [...prev, assistantMessage]);
      
      // Reload chat history after sending message
      loadChatHistory();
    } catch (error) {
      console.error("Error calling AI service:", error);
      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: "Sorry, there was an error connecting to the AI service. Please try again.",
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, errorMessage]);
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
        <ActionIcon
          variant="subtle"
          size="sm"
          onClick={openHistory}
          className={classes.historyButton}
          title={t("Chat History")}
        >
          <IconHistory size={16} stroke={1.5} />
        </ActionIcon>

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
                      <div
                        className={classes.markdownContent}
                        dangerouslySetInnerHTML={{
                          __html: DOMPurify.sanitize(markdownToHtml(message.content) as string),
                        }}
                      />
                    ) : (
                      <Text size="sm" style={{ whiteSpace: "pre-wrap" }}>
                        {message.content}
                      </Text>
                    )}
                  </Box>
                </Box>
              ))
            )}
            {isLoading && (
              <Box className={clsx(classes.message, classes.assistantMessage)}>
                <Box className={classes.messageContent}>
                  <Text size="sm" c="dimmed">
                    {t("Thinking...")}
                  </Text>
                </Box>
              </Box>
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
    </>
  );
};

