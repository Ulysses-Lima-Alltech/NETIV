import { ViewStyle } from "react-native";

const cardBase: ViewStyle = {
  shadowColor: "#061D33",
  shadowOpacity: 0.04,
  shadowRadius: 8,
  shadowOffset: { width: 0, height: 3 },
  elevation: 1,
};

const strongBase: ViewStyle = {
  shadowColor: "#061D33",
  shadowOpacity: 0.08,
  shadowRadius: 16,
  shadowOffset: { width: 0, height: 8 },
  elevation: 4,
};

export const shadows = {
  card: cardBase,
  strong: strongBase,
};
