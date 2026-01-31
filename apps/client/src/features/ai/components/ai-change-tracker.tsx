import React, { FC, useState, useEffect } from "react";
import { Box, Button, Group, Text, Stack, Badge, Paper, ActionIcon } from "@mantine/core";
import { IconCheck, IconX, IconSparkles } from "@tabler/icons-react";
import { Editor } from "@tiptap/react";
import classes from "./ai-change-tracker.module.css";

export interface AiChange {
  id: string;
  type: "insert" | "replace" | "delete" | "format";
  description: string;
  range?: { from: number; to: number };
  newContent?: string;
  oldContent?: string;
  status: "pending" | "accepted" | "rejected";
  preview?: string;
}

interface AiChangeTrackerProps {
  editor: Editor | null;
  changes: AiChange[];
  onAccept: (changeId: string) => void;
  onReject: (changeId: string) => void;
  onAcceptAll: () => void;
  onRejectAll: () => void;
}

export const AiChangeTracker: FC<AiChangeTrackerProps> = ({
  editor,
  changes,
  onAccept,
  onReject,
  onAcceptAll,
  onRejectAll,
}) => {
  const [highlightedChange, setHighlightedChange] = useState<string | null>(null);

  const pendingChanges = changes.filter((c) => c.status === "pending");

  useEffect(() => {
    // Highlight the range when hovering over a change
    if (editor && highlightedChange) {
      const change = changes.find((c) => c.id === highlightedChange);
      if (change?.range) {
        editor.commands.setTextSelection(change.range);
      }
    }
  }, [highlightedChange, editor, changes]);

  if (changes.length === 0) {
    return null;
  }

  return (
    <Paper
      shadow="md"
      p="md"
      radius="md"
      style={{
        position: "fixed",
        bottom: 20,
        right: 20,
        width: 400,
        maxHeight: "60vh",
        overflow: "auto",
        zIndex: 1000,
        backgroundColor: "white",
        border: "2px solid var(--mantine-color-blue-5)",
      }}
    >
      <Stack gap="md">
        <Group justify="space-between" wrap="nowrap">
          <Group gap="xs">
            <IconSparkles size={20} color="var(--mantine-color-blue-6)" />
            <Text fw={600} size="sm">
              AI Suggestions
            </Text>
            <Badge size="sm" color="blue">
              {pendingChanges.length}
            </Badge>
          </Group>
          
          {pendingChanges.length > 0 && (
            <Group gap="xs">
              <Button size="xs" variant="light" color="green" onClick={onAcceptAll}>
                Accept All
              </Button>
              <Button size="xs" variant="light" color="red" onClick={onRejectAll}>
                Reject All
              </Button>
            </Group>
          )}
        </Group>

        <Stack gap="xs">
          {changes.map((change) => (
            <Box
              key={change.id}
              p="sm"
              style={{
                backgroundColor:
                  change.status === "accepted"
                    ? "var(--mantine-color-green-0)"
                    : change.status === "rejected"
                    ? "var(--mantine-color-red-0)"
                    : "var(--mantine-color-gray-0)",
                borderRadius: "var(--mantine-radius-sm)",
                border: `1px solid ${
                  change.status === "accepted"
                    ? "var(--mantine-color-green-3)"
                    : change.status === "rejected"
                    ? "var(--mantine-color-red-3)"
                    : "var(--mantine-color-gray-3)"
                }`,
                cursor: change.range ? "pointer" : "default",
              }}
              onMouseEnter={() => setHighlightedChange(change.id)}
              onMouseLeave={() => setHighlightedChange(null)}
            >
              <Stack gap="xs">
                <Group justify="space-between" wrap="nowrap">
                  <Group gap="xs">
                    <Badge
                      size="xs"
                      color={
                        change.type === "insert"
                          ? "green"
                          : change.type === "delete"
                          ? "red"
                          : change.type === "replace"
                          ? "blue"
                          : "gray"
                      }
                    >
                      {change.type}
                    </Badge>
                    <Text size="xs" fw={500}>
                      {change.description}
                    </Text>
                  </Group>

                  {change.status === "pending" && (
                    <Group gap="xs">
                      <ActionIcon
                        size="sm"
                        variant="light"
                        color="green"
                        onClick={() => onAccept(change.id)}
                      >
                        <IconCheck size={14} />
                      </ActionIcon>
                      <ActionIcon
                        size="sm"
                        variant="light"
                        color="red"
                        onClick={() => onReject(change.id)}
                      >
                        <IconX size={14} />
                      </ActionIcon>
                    </Group>
                  )}

                  {change.status === "accepted" && (
                    <Badge size="xs" color="green">
                      ✓ Accepted
                    </Badge>
                  )}

                  {change.status === "rejected" && (
                    <Badge size="xs" color="red">
                      ✗ Rejected
                    </Badge>
                  )}
                </Group>

                {change.preview && (
                  <Box
                    p="xs"
                    style={{
                      backgroundColor: "white",
                      borderRadius: "var(--mantine-radius-xs)",
                      fontSize: "12px",
                      fontFamily: "monospace",
                    }}
                  >
                    <Text size="xs" c="dimmed">
                      {change.preview}
                    </Text>
                  </Box>
                )}

                {change.oldContent && change.newContent && (
                  <Box>
                    <Text size="xs" c="red" td="line-through">
                      {change.oldContent.substring(0, 50)}
                      {change.oldContent.length > 50 ? "..." : ""}
                    </Text>
                    <Text size="xs" c="green" fw={500}>
                      {change.newContent.substring(0, 50)}
                      {change.newContent.length > 50 ? "..." : ""}
                    </Text>
                  </Box>
                )}
              </Stack>
            </Box>
          ))}
        </Stack>
      </Stack>
    </Paper>
  );
};
