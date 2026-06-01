import { requestJson } from "./api";

type RegisterPushTokenResponse = {
  success?: boolean;
  tokenId?: string;
  active?: boolean;
  updatedAt?: string;
};

export async function registerPushTokenWithApi(
  token: string,
  platform: string | null,
  authToken: string
): Promise<void> {
  try {
    await requestJson<RegisterPushTokenResponse>("/api/mobile/push-token", {
      method: "POST",
      token: authToken,
      body: {
        token: token.trim(),
        platform: platform?.trim() ? platform.trim() : null,
      },
    });
  } catch (error) {
    console.warn("[MobilePush] token_register_failed", {
      message: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

