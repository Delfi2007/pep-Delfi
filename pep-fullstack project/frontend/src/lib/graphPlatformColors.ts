/** Edge colour per channel — distinct from platforms.ts's brand tint
 * because two channels that share a tint there (call_log and browser
 * both grey) need to read apart as parallel lines on the graph, per the
 * legend: WhatsApp green, Instagram pink, Call blue, Browser teal,
 * Images grey. */
export function edgeColorForChannel(channel: string): string {
  const c = channel.toLowerCase();
  if (c.includes("whatsapp")) return "#25D366";
  if (c.includes("instagram")) return "#E1306C";
  if (c.includes("call_log")) return "#007AFF";
  if (c.includes("browser")) return "#00C7BE";
  return "#8E8E93"; // images / unknown
}

export function edgeLabelForChannel(channel: string): string {
  const c = channel.toLowerCase();
  if (c.includes("whatsapp")) return "WhatsApp";
  if (c.includes("instagram")) return "Instagram";
  if (c.includes("call_log")) return "Call";
  if (c.includes("browser")) return "Browser";
  return "Images";
}

export const PLATFORM_LEGEND = [
  { channel: "whatsapp", label: "WhatsApp", color: "#25D366" },
  { channel: "instagram", label: "Instagram", color: "#E1306C" },
  { channel: "call_log", label: "Call", color: "#007AFF" },
  { channel: "browser", label: "Browser", color: "#00C7BE" },
  { channel: "images", label: "Images", color: "#8E8E93" },
];
