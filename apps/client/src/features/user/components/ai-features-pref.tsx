import { userAtom } from "@/features/user/atoms/current-user-atom.ts";
import { updateUser } from "@/features/user/services/user-service.ts";
import { Text, Checkbox, Stack } from "@mantine/core";
import { useAtom } from "jotai/index";
import React, { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ResponsiveSettingsRow,
  ResponsiveSettingsContent,
  ResponsiveSettingsControl,
} from "@/components/ui/responsive-settings-row";
import { AiCommand, DEFAULT_AI_COMMANDS } from "@/features/editor/components/bubble-menu/ai-selector.tsx";

export default function AiFeaturesPref() {
  const { t } = useTranslation();

  return (
    <ResponsiveSettingsRow>
      <ResponsiveSettingsContent>
        <Text size="md">{t("AI features")}</Text>
        <Text size="sm" c="dimmed">
          {t("Choose which AI features are available in the editor.")}
        </Text>
      </ResponsiveSettingsContent>

      <ResponsiveSettingsControl>
        <AiFeaturesCheckboxes />
      </ResponsiveSettingsControl>
    </ResponsiveSettingsRow>
  );
}

function AiFeaturesCheckboxes() {
  const { t } = useTranslation();
  const [user, setUser] = useAtom(userAtom);
  const enabledAiFeatures =
    user?.settings?.preferences?.enabledAiFeatures ||
    DEFAULT_AI_COMMANDS.map((cmd) => cmd.id);

  const [checkedFeatures, setCheckedFeatures] = useState<string[]>(enabledAiFeatures);

  useEffect(() => {
    if (enabledAiFeatures !== checkedFeatures) {
      setCheckedFeatures(enabledAiFeatures);
    }
  }, [enabledAiFeatures]);

  const handleChange = useCallback(
    async (featureId: string, checked: boolean) => {
      const newFeatures = checked
        ? [...checkedFeatures, featureId]
        : checkedFeatures.filter((id) => id !== featureId);

      setCheckedFeatures(newFeatures);

      // Update user settings
      // Note: Backend API for this will be implemented later
      // For now, we'll update the local state and the user atom
      // The actual API call can be added when backend is ready
      const updatedSettings = {
        ...user?.settings,
        preferences: {
          ...user?.settings?.preferences,
          enabledAiFeatures: newFeatures,
        },
      };

      // Update local user atom immediately for UI responsiveness
      if (user) {
        setUser({
          ...user,
          settings: updatedSettings,
        });
      }

      // TODO: Add API call when backend is ready
      // const updatedUser = await updateUser({
      //   enabledAiFeatures: newFeatures,
      // });
      // setUser(updatedUser);
    },
    [user, setUser, checkedFeatures]
  );

  return (
    <Stack gap="xs">
      {DEFAULT_AI_COMMANDS.map((command) => (
        <Checkbox
          key={command.id}
          label={t(command.label)}
          checked={checkedFeatures.includes(command.id)}
          onChange={(event) =>
            handleChange(command.id, event.currentTarget.checked)
          }
        />
      ))}
    </Stack>
  );
}

