const templates: Record<string, string> = {
  receipt: "Thank you. Total: {total}",
  shipped: "Your parcel is on its way.",
};

export function renderTemplate(name: string, values: Record<string, string>): string {
  const text = templates[name] ?? "";
  return text.replace(/\{(\w+)\}/g, (_, key: string) => values[key] ?? "");
}
