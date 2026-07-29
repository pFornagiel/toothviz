import type { PipelineMessage } from "./types";
import { pipelineWsUrl } from "./baseUrl";

export function establishWebsocketConnection(
  jobId: string,
  onMessage: (msg: PipelineMessage) => void,
  onClose?: () => void,
): () => void {
  const ws = new WebSocket(pipelineWsUrl(jobId));

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
