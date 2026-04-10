import type { PipelineMessage } from "./types";

export function connectPipeline(
  jobId: string,
  onMessage: (msg: PipelineMessage) => void,
  onClose?: () => void,
): () => void {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const url = `${protocol}//${window.location.host}/ws/pipeline/${jobId}`;
  const ws = new WebSocket(url);

  ws.onmessage = (event) => {
    try {
      const data: PipelineMessage = JSON.parse(event.data);
      onMessage(data);
    } catch {
      // ignore non-JSON frames
    }
  };

  ws.onclose = () => onClose?.();
  ws.onerror = () => ws.close();

  return () => {
    ws.close();
  };
}
