import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { SettingsAction, SettingsCard, SettingsInput } from "@/components/settings";
import { useBrowserStore } from "@/desktop/browser/store";

export function BrowserStartPageSection() {
  const { t } = useTranslation();
  const startUrl = useBrowserStore((state) => state.startUrl ?? "");
  const setStartUrl = useBrowserStore((state) => state.setStartUrl);
  const [draft, setDraft] = useState(startUrl);
  const save = useCallback(() => setStartUrl(draft), [draft, setStartUrl]);

  return (
    <SettingsCard>
      <SettingsInput
        label={t("settings.browser.startPage.label")}
        hint={t("settings.browser.startPage.hint")}
        initialValue={startUrl}
        placeholder="https://example.com"
        onChangeText={setDraft}
      />
      <SettingsAction
        label={t("settings.browser.startPage.saveLabel")}
        hint={startUrl || t("settings.browser.startPage.unset")}
        actionLabel={t("settings.browser.startPage.save")}
        disabled={draft.trim() === startUrl}
        onPress={save}
      />
    </SettingsCard>
  );
}
