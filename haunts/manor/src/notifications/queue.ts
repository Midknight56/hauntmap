import { logger } from "../shared/logger";

const pending: string[] = [];

export function enqueue(message: string): number {
  pending.push(message);
  logger.info(`queued ${pending.length}`);
  return pending.length;
}
