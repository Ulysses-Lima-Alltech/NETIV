import { Stack } from "expo-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StatusBar } from "expo-status-bar";
import { useState } from "react";

export default function RootLayout() {
  const [queryClient] = useState(() => new QueryClient());

  return (
    <QueryClientProvider client={queryClient}>
      <StatusBar style="dark" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: "#0F172A" },
          headerTintColor: "#FFFFFF",
          headerTitleStyle: { fontWeight: "700" },
          contentStyle: { backgroundColor: "#F8FAFC" },
        }}
      >
        <Stack.Screen name="login" options={{ title: "Entrar" }} />
        <Stack.Screen name="home" options={{ title: "NETIV" }} />
        <Stack.Screen name="conversas/index" options={{ title: "Conversas" }} />
        <Stack.Screen name="conversas/[id]" options={{ title: "Conversa" }} />
        <Stack.Screen name="visitas/index" options={{ title: "Visitas" }} />
        <Stack.Screen name="perfil" options={{ title: "Perfil" }} />
      </Stack>
    </QueryClientProvider>
  );
}
