import { rm } from "node:fs/promises";
import { setTimeout } from "node:timers/promises";

/** Remove an isolated host data directory after asynchronous host shutdown. */
export async function removeRealHostDataDir(dataDir: string): Promise<void> {
  // Retry the operation as a whole: recursive rm otherwise retries at every
  // ancestor and can hide a permanently held handle behind a hook timeout.
  for (let attempt = 0; ; attempt += 1) {
    try {
      await rm(dataDir, { recursive: true, force: true, maxRetries: 0 });
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (attempt >= 10 || !["EBUSY", "EMFILE", "ENFILE", "ENOTEMPTY", "EPERM"].includes(code ?? "")) throw error;
      await setTimeout(100);
    }
  }
}
