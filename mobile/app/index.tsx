import { Redirect } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { useAuthStore } from "../src/stores/auth.store";
import { colors } from "../src/theme";

export default function Index() {
  const restoreSession = useAuthStore((state) => state.restoreSession);
  const isLoading = useAuthStore((state) => state.isLoading);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const [checkedSession, setCheckedSession] = useState(false);

  useEffect(() => {
    let active = true;

    restoreSession()
      .catch(() => {
        // noop
      })
      .finally(() => {
        if (active) {
          setCheckedSession(true);
        }
      });

    return () => {
      active = false;
    };
  }, [restoreSession]);

  if (!checkedSession || isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="small" color={colors.navy} />
      </View>
    );
  }

  return <Redirect href={isAuthenticated ? "/home" : "/login"} />;
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: "center",
    justifyContent: "center",
  },
});
