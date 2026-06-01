import { useRouter } from "expo-router";
import * as Notifications from "expo-notifications";
import { useCallback, useEffect, useRef } from "react";
import { Platform } from "react-native";
import { registerPushTokenWithApi } from "../services/push.service";

type UseMobilePushNotificationsArgs = {
  token: string | null;
  isAuthenticated: boolean;
};

function normalizeConversationId(raw: unknown): string | null {
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) {
    return String(Math.trunc(raw));
  }
  if (typeof raw === "string") {
    const normalized = raw.trim();
    return normalized.length > 0 ? normalized : null;
  }
  return null;
}

function extractHandoffConversationId(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const payload = data as Record<string, unknown>;
  if (payload.type !== "broker_handoff") return null;
  return normalizeConversationId(payload.conversationId);
}

export function useMobilePushNotifications({
  token,
  isAuthenticated,
}: UseMobilePushNotificationsArgs): void {
  const router = useRouter();
  const lastRegisteredKeyRef = useRef<string | null>(null);
  const pendingConversationIdRef = useRef<string | null>(null);
  const lastHandledResponseKeyRef = useRef<string | null>(null);

  const openConversationFromNotification = useCallback(
    (conversationId: string, source: "listener" | "last_response" | "deferred") => {
      if (!isAuthenticated || !token) {
        pendingConversationIdRef.current = conversationId;
        console.info("[MobilePush] notification_open_deferred", {
          conversationId,
          source,
        });
        return;
      }

      console.info("[MobilePush] notification_opened", {
        conversationId,
        source,
      });
      router.push(`/conversas/${conversationId}`);
    },
    [isAuthenticated, router, token]
  );

  const handleNotificationResponse = useCallback(
    (response: Notifications.NotificationResponse | null, source: "listener" | "last_response") => {
      if (!response) return;
      const conversationId = extractHandoffConversationId(response.notification.request.content.data);
      if (!conversationId) return;

      const actionIdentifier =
        typeof response.actionIdentifier === "string" ? response.actionIdentifier : "default";
      const requestIdentifier =
        typeof response.notification.request.identifier === "string"
          ? response.notification.request.identifier
          : "";
      const key = requestIdentifier
        ? `${requestIdentifier}:${actionIdentifier}`
        : `${conversationId}:${actionIdentifier}`;
      if (lastHandledResponseKeyRef.current === key) return;
      lastHandledResponseKeyRef.current = key;

      openConversationFromNotification(conversationId, source);
    },
    [openConversationFromNotification]
  );

  useEffect(() => {
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowAlert: true,
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: true,
        shouldSetBadge: true,
      }),
    });
  }, []);

  useEffect(() => {
    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      handleNotificationResponse(response, "listener");
    });

    return () => {
      subscription.remove();
    };
  }, [handleNotificationResponse]);

  useEffect(() => {
    let active = true;

    async function checkLastNotificationResponse() {
      const response = await Notifications.getLastNotificationResponseAsync().catch(() => null);
      if (!active) return;
      handleNotificationResponse(response, "last_response");
    }

    void checkLastNotificationResponse();
    return () => {
      active = false;
    };
  }, [handleNotificationResponse]);

  useEffect(() => {
    if (!isAuthenticated || !token) return;
    const pendingConversationId = pendingConversationIdRef.current;
    if (!pendingConversationId) return;

    pendingConversationIdRef.current = null;
    openConversationFromNotification(pendingConversationId, "deferred");
  }, [isAuthenticated, openConversationFromNotification, token]);

  useEffect(() => {
    if (!isAuthenticated || !token) return;
    const authToken = token;
    let active = true;

    async function registerPushToken() {
      try {
        if (Platform.OS === "android") {
          await Notifications.setNotificationChannelAsync("default", {
            name: "default",
            importance: Notifications.AndroidImportance.MAX,
            sound: "default",
          });
        }

        const existingPermission = await Notifications.getPermissionsAsync();
        let permissionStatus = existingPermission.status;
        if (permissionStatus !== "granted") {
          const requested = await Notifications.requestPermissionsAsync();
          permissionStatus = requested.status;
        }

        if (!active) return;
        console.info("[MobilePush] permission_status", { status: permissionStatus });
        if (permissionStatus !== "granted") return;

        const expoPushTokenResult = await Notifications.getExpoPushTokenAsync();
        const expoPushToken = expoPushTokenResult.data?.trim() ?? "";
        if (!expoPushToken) return;

        console.info("[MobilePush] expo_token_received", {
          platform: Platform.OS,
          tokenPreview: expoPushToken.slice(0, 18),
        });

        const registerKey = `${authToken}:${expoPushToken}`;
        if (lastRegisteredKeyRef.current === registerKey) return;

        await registerPushTokenWithApi(expoPushToken, Platform.OS, authToken);
        if (!active) return;
        lastRegisteredKeyRef.current = registerKey;
        console.info("[MobilePush] token_registered", {
          platform: Platform.OS,
          tokenPreview: expoPushToken.slice(0, 18),
        });
      } catch {
        // Erro ja logado por [MobilePush] token_register_failed no service.
      }
    }

    void registerPushToken();
    return () => {
      active = false;
    };
  }, [isAuthenticated, token]);
}
