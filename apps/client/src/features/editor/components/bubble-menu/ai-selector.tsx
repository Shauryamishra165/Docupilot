import { Dispatch, FC, SetStateAction, useCallback, useState, useMemo } from "react";
import { IconSparkles, IconLoader2 } from "@tabler/icons-react";
import { ActionIcon, Popover, Tooltip, Stack, Button, rem, Text, Loader } from "@mantine/core";
import { useEditor } from "@tiptap/react";
import { useTranslation } from "react-i18next";
import { useAtom } from "jotai";
import { userAtom } from "@/features/user/atoms/current-user-atom.ts";
import { notifications } from "@mantine/notifications";
import { AiTransformService, AiCommandType } from "./ai-text-transform";

interface AiSelectorProps {
  editor: ReturnType<typeof useEditor>;
  isOpen: boolean;
  setIsOpen: Dispatch<SetStateAction<boolean>>;
}

export interface AiCommand {
  id: AiCommandType;
  label: string;
  enabled: boolean;
}

export const DEFAULT_AI_COMMANDS: AiCommand[] = [
  { id: "improve", label: "Improve", enabled: true },
  { id: "fix-grammar", label: "Fix grammar", enabled: true },
  { id: "change-tone", label: "Change tone", enabled: true },
];

export const AiSelector: FC<AiSelectorProps> = ({
  editor,
  isOpen,
  setIsOpen,
}) => {
  const { t } = useTranslation();
  const [user] = useAtom(userAtom);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingCommand, setProcessingCommand] = useState<AiCommandType | null>(null);

  // Create the transform service instance
  const transformService = useMemo(() => {
    if (!editor) return null;
    return new AiTransformService(editor);
  }, [editor]);

  // Get enabled AI features from user settings
  const enabledAiFeatures =
    user?.settings?.preferences?.enabledAiFeatures || DEFAULT_AI_COMMANDS.map((cmd) => cmd.id);

  // Filter commands based on enabled features
  const availableCommands = DEFAULT_AI_COMMANDS.filter((cmd) =>
    enabledAiFeatures.includes(cmd.id)
  );

  // Don't show AI selector if no commands are enabled
  if (availableCommands.length === 0) {
    return null;
  }

  const handleCommand = useCallback(
    async (commandId: AiCommandType) => {
      if (!transformService || !editor) {
        console.error('[AiSelector] No transform service or editor available');
        return;
      }

      // Check if there's a selection
      const { from, to } = editor.state.selection;
      const selectedText = editor.state.doc.textBetween(from, to);

      if (!selectedText || selectedText.trim().length === 0) {
        notifications.show({
          title: t('No text selected'),
          message: t('Please select some text to transform'),
          color: 'yellow',
        });
        return;
      }

      // Close the popover
      setIsOpen(false);

      // Set processing state
      setIsProcessing(true);
      setProcessingCommand(commandId);

      try {
        console.log(`[AiSelector] Executing command: ${commandId}`);
        console.log(`[AiSelector] Selected text: "${selectedText}"`);

        // Execute the command
        const result = await transformService.executeCommand(commandId);

        if (result.success) {
          notifications.show({
            title: t('Text transformed'),
            message: t('The selected text has been updated'),
            color: 'green',
          });
          console.log('[AiSelector] Transform successful:', result);
        } else {
          notifications.show({
            title: t('Transform failed'),
            message: result.error || t('An error occurred while transforming the text'),
            color: 'red',
          });
          console.error('[AiSelector] Transform failed:', result.error);
        }
      } catch (error) {
        console.error('[AiSelector] Error executing command:', error);
        notifications.show({
          title: t('Error'),
          message: error instanceof Error ? error.message : t('An unexpected error occurred'),
          color: 'red',
        });
      } finally {
        setIsProcessing(false);
        setProcessingCommand(null);
      }
    },
    [editor, transformService, setIsOpen, t]
  );

  return (
    <Popover
      width={200}
      opened={isOpen}
      trapFocus
      offset={{ mainAxis: 35, crossAxis: 0 }}
      withArrow
    >
      <Popover.Target>
        <Tooltip label={t("AI")} withArrow>
          <ActionIcon
            variant="default"
            size="lg"
            radius="0"
            style={{
              border: "none",
            }}
            onClick={() => setIsOpen(!isOpen)}
            loading={isProcessing}
          >
            {isProcessing ? (
              <Loader size={14} />
            ) : (
              <IconSparkles size={16} />
            )}
          </ActionIcon>
        </Tooltip>
      </Popover.Target>

      <Popover.Dropdown>
        <Stack gap="xs">
          {isProcessing ? (
            <Stack align="center" gap="xs" py="md">
              <Loader size="sm" />
              <Text size="sm" c="dimmed">
                {processingCommand === 'improve' && t('Improving...')}
                {processingCommand === 'fix-grammar' && t('Fixing grammar...')}
                {processingCommand === 'change-tone' && t('Changing tone...')}
              </Text>
            </Stack>
          ) : (
            availableCommands.map((command) => (
              <Button
                key={command.id}
                variant="subtle"
                fullWidth
                justify="flex-start"
                onClick={() => handleCommand(command.id)}
                disabled={isProcessing}
                style={{
                  height: rem(32),
                  paddingLeft: rem(12),
                  paddingRight: rem(12),
                }}
              >
                {t(command.label)}
              </Button>
            ))
          )}
        </Stack>
      </Popover.Dropdown>
    </Popover>
  );
};
