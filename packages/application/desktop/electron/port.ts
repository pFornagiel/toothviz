import net from "node:net";

/**
 * Ask the OS for an unused TCP port on ``host``, then release it.
 * Caller should bind soon after (uvicorn spawn); a tiny race remains, as with
 * any preflight port check.
 */
export function allocateFreePort(host: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once("error", reject);
    server.listen(0, host, () => {
      const addr = server.address();
      if (addr == null || typeof addr === "string") {
        server.close(() => reject(new Error(`Could not allocate a free port on ${host}`)));
        return;
      }
      const { port } = addr;
      server.close((err) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(port);
      });
    });
  });
}
