import { ViewStyle } from "react-native";

const cardBase: ViewStyle = {
  shadowColor: "#02111F",
  shadowOpacity: 0.08,
  shadowRadius: 14,
  shadowOffset: { width: 0, height: 8 },
  elevation: 4,
};

const strongBase: ViewStyle = {
  shadowColor: "#02111F",
  shadowOpacity: 0.14,
  shadowRadius: 22,
  shadowOffset: { width: 0, height: 10 },
  elevation: 7,
};

export const shadows = {
  card: cardBase,
  strong: strongBase,
};

