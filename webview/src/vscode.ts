import type { Action, HostMessage, WebviewMessage } from "../../src/shared/protocol";
import { handle as handleMock } from "./dev/mockHost";

interface VsCodeApi {
  postMessage(message: unknown): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

let api: VsCodeApi;
const listeners = new Set<(m: HostMessage) => void>();

if (typeof acquireVsCodeApi === "function") {
  api = acquireVsCodeApi();
} else {
  // Running in a plain browser (dev harness): fake the extension host.
  api = { postMessage: (m) => setTimeout(() => handleMock(m as WebviewMessage, emit), 30) };
}

function emit(message: HostMessage) {
  listeners.forEach((l) => l(message));
}

window.addEventListener("message", (e: MessageEvent<HostMessage>) => emit(e.data));

export function post(message: WebviewMessage) {
  api.postMessage(message);
}

export function act(action: Action) {
  post({ type: "action", action });
}

export function notSupported(feature: string) {
  act({ kind: "notSupported", feature });
}

export function onMessage(fn: (m: HostMessage) => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
