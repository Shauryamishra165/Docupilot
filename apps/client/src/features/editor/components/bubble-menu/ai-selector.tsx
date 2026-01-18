import { Dispatch, FC, SetStateAction, useCallback } from "react";
import { IconSparkles } from "@tabler/icons-react";
import { ActionIcon, Popover, Tooltip, Stack, Button, rem } from "@mantine/core";
import { useEditor } from "@tiptap/react";
import { useTranslation } from "react-i18next";
import { useAtom } from "jotai";
import { userAtom } from "@/features/user/atoms/current-user-atom.ts";

interface AiSelectorProps {
  editor: ReturnType<typeof useEditor>;
  isOpen: boolean;
  setIsOpen: Dispatch<SetStateAction<boolean>>;
}

export interface AiCommand {
  id: string;
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
    (commandId: string) => {
      setIsOpen(false);
      // Get selected text
      const { from, to } = editor.state.selection;
      const selectedText = editor.state.doc.textBetween(from, to);

      if (!selectedText) {
        return;
      }

      // TODO: This will be implemented later with API calls
      // For now, just log the command
      console.log(`AI Command: ${commandId}`, { selectedText });
    },
    [editor, setIsOpen]
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
          >
            <IconSparkles size={16} />
          </ActionIcon>
        </Tooltip>
      </Popover.Target>

      <Popover.Dropdown>
        <Stack gap="xs">
          {availableCommands.map((command) => (
            <Button
              key={command.id}
              variant="subtle"
              fullWidth
              justify="flex-start"
              onClick={() => handleCommand(command.id)}
              style={{
                height: rem(32),
                paddingLeft: rem(12),
                paddingRight: rem(12),
              }}
            >
              {t(command.label)}
            </Button>
          ))}
        </Stack>
      </Popover.Dropdown>
    </Popover>
  );
};

