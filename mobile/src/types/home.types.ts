export type HomeMetric = {
  label: string;
  value: string;
};

export type HomeSummary = {
  title: string;
  subtitle: string;
  description: string;
  metrics: HomeMetric[];
  nextActionText: string;
};
