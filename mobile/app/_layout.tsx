import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useState } from "react";

export default function RootLayout() {
  const [queryClient] = useState(() => new QueryClient());

  return (
    <QueryClientProvider client={queryClient}>
      <StatusBar style="dark" />
      <Stack screenOptions={{ headerShown: false, animation: "fade" }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="login" />
        <Stack.Screen name="home" />
        <Stack.Screen name="conversas/index" />
        <Stack.Screen name="conversas/[id]" />
        <Stack.Screen name="visitas/index" />
        <Stack.Screen name="equipe/index" />
        <Stack.Screen name="empreendimentos/index" />
        <Stack.Screen name="templates/index" />
        <Stack.Screen name="configuracoes/index" />
        <Stack.Screen name="perfil" />
      </Stack>
    </QueryClientProvider>
  );
}
