import { EventEmitter } from 'events'
import { GreprApiClient } from './api-client.js'
import { HEARTBEAT_EVENTS } from '../types.js'

/**
 * Manages heartbeat messages to keep sync jobs alive
 */
export class HeartbeatManager extends EventEmitter {
  private apiClient: GreprApiClient;
  private isActive = false;
  private maxRetries: number;
  private retryAttempts = new Map<string, number>();

  constructor(apiClient: GreprApiClient, maxRetries = 3) {
    super();
    this.apiClient = apiClient;
    this.maxRetries = maxRetries;
  }

  start(): void {
    this.isActive = true;
  }

  stop(): void {
    this.isActive = false;
    this.retryAttempts.clear();
  }

  async handleHeartbeatRequest(token: string): Promise<void> {
    if (!this.isActive) {
      return;
    }

    this.emit(HEARTBEAT_EVENTS.REQUEST, token);

    try {
      await this.apiClient.sendHeartbeat(token);
      this.emit(HEARTBEAT_EVENTS.SENT, token);
      // Reset retry count on success
      this.retryAttempts.delete(token);
    } catch (error) {
      await this.handleRetry(token, error as Error);
    }
  }

  private async handleRetry(token: string, error: Error): Promise<void> {
    const currentAttempts = this.retryAttempts.get(token) || 0;
    const newAttempts = currentAttempts + 1;

    if (newAttempts <= this.maxRetries) {
      this.retryAttempts.set(token, newAttempts);
      this.emit(HEARTBEAT_EVENTS.RETRY, newAttempts, this.maxRetries, error);

      // Wait a bit before retrying
      setTimeout(() => {
        this.handleHeartbeatRequest(token);
      }, 1000 * newAttempts); // Exponential backoff
    } else {
      // Retry failed too many times
      this.emit(HEARTBEAT_EVENTS.ERROR, error, token);
      this.retryAttempts.delete(token);
    }
  }
}

