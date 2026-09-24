import { Text, View } from "react-native";
import { useCallback } from "react";
import { useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { BrowserImportSource } from "@getpaseo/protocol/browser-import/rpc-schemas";
import { SettingsCard, SettingsRow } from "@/components/settings";
import { SettingsSection } from "@/components/settings/headings/settings-section";
import { Button } from "@/components/ui/button";
import { getIsElectron } from "@/constants/platform";
import { useFetchQuery } from "@/data/query";
import { getDesktopHost } from "@/desktop/host";
import { useHostFeature } from "@/runtime/host-features";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { settingsStyles } from "@/styles/settings";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";

type ImportLocation = "host" | "device";

interface ImportSourceEntry {
  location: ImportLocation;
  source: BrowserImportSource;
}

export function BrowserImportSection({
  serverId,
  isLocalDaemon,
}: {
  serverId: string;
  isLocalDaemon: boolean;
}) {
  const { t } = useTranslation();
  const isConnected = useHostRuntimeIsConnected(serverId);
  const client = useHostRuntimeClient(serverId);
  const isSupported = useHostFeature(serverId, "browserCookieImport");
  const bridge = getDesktopHost()?.browser;
  // A local daemon already sees this device's browsers, so only a remote host needs the desktop read.
  const listDeviceSources =
    getIsElectron() && !isLocalDaemon ? bridge?.listImportSources : undefined;

  const hostSources = useFetchQuery({
    queryKey: ["browser-import-sources", "host", serverId],
    queryFn: async () => {
      const response = await client!.listBrowserImportSources();
      if (response.error) throw new Error(response.error);
      return response.sources;
    },
    enabled: isConnected && isSupported && client !== null,
    dataShape: "list",
    staleTimeMs: 0,
  });
  const deviceSources = useFetchQuery({
    queryKey: ["browser-import-sources", "device"],
    queryFn: () => listDeviceSources!(),
    enabled: isSupported && listDeviceSources !== undefined,
    dataShape: "list",
    staleTimeMs: 0,
  });

  if (!isConnected) return null;

  const entries: ImportSourceEntry[] = [
    ...(deviceSources.data ?? []).map((source) => ({ location: "device" as const, source })),
    ...(hostSources.data ?? []).map((source) => ({ location: "host" as const, source })),
  ];
  const isLoading =
    hostSources.isPending || (listDeviceSources !== undefined && deviceSources.isPending);
  const loadError = hostSources.error ?? deviceSources.error;

  return (
    <SettingsSection
      title={t("settings.browser.import.title")}
      info={t("settings.browser.import.info")}
    >
      <SettingsCard>
        <BrowserImportCardBody
          isSupported={isSupported}
          isLoading={isLoading}
          entries={entries}
          loadError={loadError}
          client={client}
          isLocalDaemon={isLocalDaemon}
        />
      </SettingsCard>
    </SettingsSection>
  );
}

function BrowserImportCardBody({
  isSupported,
  isLoading,
  entries,
  loadError,
  client,
  isLocalDaemon,
}: {
  isSupported: boolean;
  isLoading: boolean;
  entries: ImportSourceEntry[];
  loadError: Error | null;
  client: DaemonClient | null;
  isLocalDaemon: boolean;
}) {
  const { t } = useTranslation();
  if (!isSupported) {
    return (
      <SettingsRow
        label={t("settings.browser.import.unsupported.label")}
        hint={t("settings.browser.import.unsupported.hint")}
      />
    );
  }
  if (isLoading) {
    return (
      <View style={settingsStyles.row}>
        <Text style={settingsStyles.rowHint}>{t("settings.browser.import.loading")}</Text>
      </View>
    );
  }
  if (entries.length === 0) {
    return <SettingsRow label={t("settings.browser.import.empty")} error={loadError?.message} />;
  }
  return entries.map((entry) => (
    <BrowserImportRow
      key={`${entry.location}:${entry.source.id}`}
      entry={entry}
      client={client}
      isHostThisDevice={isLocalDaemon}
    />
  ));
}

function BrowserImportRow({
  entry,
  client,
  isHostThisDevice,
}: {
  entry: ImportSourceEntry;
  client: DaemonClient | null;
  isHostThisDevice: boolean;
}) {
  const { t } = useTranslation();
  const mutation = useMutation({
    mutationFn: async () => {
      if (!client) throw new Error(t("workspace.terminal.hostDisconnected"));
      const source =
        entry.location === "host"
          ? { kind: "host" as const, sourceId: entry.source.id }
          : { kind: "cookies" as const, cookies: await readDeviceCookies(entry.source.id) };
      const response = await client.importBrowserCookies(source);
      if (response.error) throw new Error(response.error);
      return response;
    },
  });

  const handlePress = useCallback(() => mutation.mutate(), [mutation]);
  const location =
    entry.location === "device" || isHostThisDevice
      ? t("settings.browser.import.onThisDevice")
      : t("settings.browser.import.onHost");
  const hint = mutation.data
    ? t("settings.browser.import.success", {
        cookieCount: mutation.data.cookieCount,
        domainCount: mutation.data.domainCount,
      })
    : location;

  return (
    <SettingsRow
      label={`${entry.source.browserName} – ${entry.source.profileName}`}
      hint={hint}
      error={mutation.error ? mutation.error.message : undefined}
      testID={`browser-import-row-${entry.location}-${entry.source.id}`}
    >
      <Button
        variant="outline"
        size="sm"
        loading={mutation.isPending}
        disabled={mutation.isPending}
        onPress={handlePress}
      >
        {mutation.isPending
          ? t("settings.browser.import.importing")
          : t("settings.browser.import.action")}
      </Button>
    </SettingsRow>
  );
}

async function readDeviceCookies(sourceId: string) {
  const readImportCookies = getDesktopHost()?.browser?.readImportCookies;
  if (!readImportCookies) throw new Error("Electron browser import bridge is unavailable");
  const result = await readImportCookies(sourceId);
  if (!result.ok) throw new Error(result.error);
  return result.cookies;
}
