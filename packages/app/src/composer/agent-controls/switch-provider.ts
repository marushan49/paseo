import type { ConfirmDialogInput } from "@/utils/confirm-dialog";

export interface ResolveSwitchProviderDialogInput {
  fromProviderLabel: string;
  toProviderLabel: string;
  modelLabel: string;
}

/**
 * The switch keeps everything Paseo owns and drops everything the old provider
 * owned, which is not what "pick another model" usually means. The dialog says
 * that in both directions so the choice is informed rather than surprising.
 */
export function resolveSwitchProviderDialog(
  input: ResolveSwitchProviderDialogInput,
): ConfirmDialogInput {
  return {
    title: `Switch to ${input.toProviderLabel}?`,
    message:
      `${input.modelLabel} belongs to ${input.toProviderLabel}, so this agent moves off ` +
      `${input.fromProviderLabel}. The transcript, workspace, and files stay; the ` +
      `${input.fromProviderLabel} session ends and ${input.toProviderLabel} starts without its memory.`,
    confirmLabel: "Switch",
    cancelLabel: "Cancel",
    destructive: true,
  };
}

export interface SwitchAgentProviderDeps {
  confirm: (input: ConfirmDialogInput) => Promise<boolean>;
  setAgentProvider: (input: {
    agentId: string;
    provider: string;
    modelId: string;
  }) => Promise<void>;
  reportError: (error: unknown) => void;
}

export interface RequestSwitchAgentProviderInput {
  agentId: string;
  fromProviderLabel: string;
  toProvider: string;
  toProviderLabel: string;
  modelId: string;
  modelLabel: string;
}

export async function requestSwitchAgentProvider(
  input: RequestSwitchAgentProviderInput,
  deps: SwitchAgentProviderDeps,
): Promise<void> {
  const confirmed = await deps.confirm(
    resolveSwitchProviderDialog({
      fromProviderLabel: input.fromProviderLabel,
      toProviderLabel: input.toProviderLabel,
      modelLabel: input.modelLabel,
    }),
  );
  if (!confirmed) {
    return;
  }
  try {
    await deps.setAgentProvider({
      agentId: input.agentId,
      provider: input.toProvider,
      modelId: input.modelId,
    });
  } catch (error) {
    deps.reportError(error);
  }
}
