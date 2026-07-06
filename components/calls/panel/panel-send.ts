import { PANEL_SOURCE, type PanelCommand } from "@/lib/panel-bus"

export type CmdPayload = PanelCommand extends infer U
  ? U extends { source: unknown; type: unknown }
    ? Omit<U, "source" | "type">
    : never
  : never

/** Send a PanelCommand to the offscreen engine via the extension shell. */
export function send(cmd: CmdPayload) {
  window.parent.postMessage({ source: PANEL_SOURCE, type: "cmd", ...cmd }, "*")
}
