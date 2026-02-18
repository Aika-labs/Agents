/**
 * Webhook dispatcher -- payload signing, delivery with retries, and event matching.
 *
 * Provides:
 *   - signPayload(): HMAC-SHA256 signature generation for webhook payloads.
 *   - deliverWebhook(): HTTP delivery with timeout, retry logic, and delivery logging.
 *   - dispatchEvent(): find matching webhooks for an event and deliver to all.
 */

import { createHmac } from "node:crypto";
import { getSupabase } from "./supabase.js";
import { logger } from "./logger.js";
import type { WebhookEvent, AgentWebhookRow } from "../types/database.js";

// =============================================================================
// Payload signing
// =============================================================================

/**
 * Generate an HMAC-SHA256 signature for a webhook payload.
 *
 * The signature is returned as a hex string prefixed with "sha256=".
 * Recipients verify by computing the same HMAC over the raw body
 * using their copy of the shared secret.
 */
export function signPayload(payload: string, secret: string): string {
  const hmac = createHmac("sha256", secret);
  hmac.update(payload, "utf8");
  return `sha256=${hmac.digest("hex")}`;
}

// =============================================================================
// Delivery
// =============================================================================

export interface DeliveryResult {
  success: boolean;
  responseStatus: number | null;
  responseBody: string | null;
  responseTimeMs: number;
  error?: string;
}

/**
 * Deliver a signed payload to a webhook URL.
 *
 * Sends a POST request with:
 *   - Content-Type: application/json
 *   - X-Webhook-Signature: HMAC-SHA256 signature
 *   - X-Webhook-Event: event type
 *   - X-Webhook-Delivery: delivery ID
 *
 * Returns delivery result with response details.
 */
async function deliverPayload(
  url: string,
  payload: string,
  signature: string,
  event: WebhookEvent,
  deliveryId: string,
  timeoutMs: number,
): Promise<DeliveryResult> {
  const start = performance.now();

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Webhook-Signature": signature,
        "X-Webhook-Event": event,
        "X-Webhook-Delivery": deliveryId,
        "User-Agent": "AgentOS-Webhook/1.0",
      },
      body: payload,
      signal: controller.signal,
    });

    clearTimeout(timeout);
    const responseTimeMs = performance.now() - start;

    // Read response body (truncate to 4KB for storage).
    const body = await response.text();
    const truncatedBody = body.length > 4096 ? body.slice(0, 4096) + "...[truncated]" : body;

    const success = response.status >= 200 && response.status < 300;

    return {
      success,
      responseStatus: response.status,
      responseBody: truncatedBody,
      responseTimeMs: Math.round(responseTimeMs * 100) / 100,
      error: success ? undefined : `HTTP ${response.status}`,
    };
  } catch (err) {
    const responseTimeMs = performance.now() - start;
    const msg = err instanceof Error ? err.message : "Unknown delivery error";

    return {
      success: false,
      responseStatus: null,
      responseBody: null,
      responseTimeMs: Math.round(responseTimeMs * 100) / 100,
      error: msg,
    };
  }
}

// =============================================================================
// Delivery with logging
// =============================================================================

/**
 * Deliver a webhook event and log the result.
 *
 * Creates a webhook_deliveries record, attempts delivery, and updates
 * the record with the result. Also updates webhook stats.
 */
export async function deliverWebhook(
  webhook: AgentWebhookRow,
  event: WebhookEvent,
  eventPayload: Record<string, unknown>,
): Promise<void> {
  const db = getSupabase();

  const fullPayload = {
    event,
    webhook_id: webhook.id,
    agent_id: webhook.agent_id,
    timestamp: new Date().toISOString(),
    data: eventPayload,
  };

  const payloadStr = JSON.stringify(fullPayload);
  const signature = signPayload(payloadStr, webhook.secret);
  const maxAttempts = webhook.max_retries + 1;

  // Create delivery record.
  const { data: delivery, error: createErr } = await db
    .from("webhook_deliveries")
    .insert({
      webhook_id: webhook.id,
      agent_id: webhook.agent_id,
      event,
      status: "pending" as const,
      payload: fullPayload,
      max_attempts: maxAttempts,
    })
    .select()
    .single();

  if (createErr || !delivery) {
    logger.error("Failed to create webhook delivery record", {
      webhookId: webhook.id,
      error: createErr?.message,
    });
    return;
  }

  // Attempt delivery with retries.
  let lastResult: DeliveryResult | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    // Wait before retry (skip for first attempt).
    if (attempt > 1) {
      const delayMs = webhook.retry_delay_seconds * 1000 * Math.pow(2, attempt - 2);
      await new Promise((resolve) => setTimeout(resolve, Math.min(delayMs, 60000)));
    }

    lastResult = await deliverPayload(
      webhook.url,
      payloadStr,
      signature,
      event,
      delivery.id,
      webhook.timeout_ms,
    );

    if (lastResult.success) {
      // Success -- update delivery and webhook stats.
      await db
        .from("webhook_deliveries")
        .update({
          status: "success" as const,
          response_status: lastResult.responseStatus,
          response_body: lastResult.responseBody,
          response_time_ms: lastResult.responseTimeMs.toFixed(2),
          attempt_number: attempt,
          delivered_at: new Date().toISOString(),
        })
        .eq("id", delivery.id);

      await db
        .from("agent_webhooks")
        .update({
          total_deliveries: webhook.total_deliveries + 1,
          last_delivered_at: new Date().toISOString(),
          last_error: null,
        })
        .eq("id", webhook.id);

      logger.info("Webhook delivered successfully", {
        webhookId: webhook.id,
        deliveryId: delivery.id,
        event,
        attempt,
        responseTimeMs: lastResult.responseTimeMs,
      });

      return;
    }

    // Update delivery with retry status.
    if (attempt < maxAttempts) {
      const nextRetryAt = new Date(
        Date.now() + webhook.retry_delay_seconds * 1000 * Math.pow(2, attempt - 1),
      ).toISOString();

      await db
        .from("webhook_deliveries")
        .update({
          status: "retrying" as const,
          attempt_number: attempt,
          response_status: lastResult.responseStatus,
          error_message: lastResult.error,
          next_retry_at: nextRetryAt,
        })
        .eq("id", delivery.id);
    }
  }

  // All attempts failed.
  await db
    .from("webhook_deliveries")
    .update({
      status: "failed" as const,
      attempt_number: maxAttempts,
      response_status: lastResult?.responseStatus ?? null,
      response_body: lastResult?.responseBody ?? null,
      response_time_ms: lastResult?.responseTimeMs.toFixed(2) ?? null,
      error_message: lastResult?.error ?? "All delivery attempts failed",
    })
    .eq("id", delivery.id);

  await db
    .from("agent_webhooks")
    .update({
      total_deliveries: webhook.total_deliveries + 1,
      failed_deliveries: webhook.failed_deliveries + 1,
      last_error: lastResult?.error ?? "Delivery failed",
    })
    .eq("id", webhook.id);

  logger.warn("Webhook delivery failed after all retries", {
    webhookId: webhook.id,
    deliveryId: delivery.id,
    event,
    attempts: maxAttempts,
    lastError: lastResult?.error,
  });
}

// =============================================================================
// Event dispatcher
// =============================================================================

/**
 * Dispatch a webhook event to all matching active webhooks for an agent.
 *
 * Finds all active webhooks subscribed to the given event and delivers
 * the payload to each. Deliveries are fire-and-forget (non-blocking).
 */
export async function dispatchEvent(
  agentId: string,
  event: WebhookEvent,
  payload: Record<string, unknown>,
): Promise<number> {
  const db = getSupabase();

  // Find active webhooks subscribed to this event.
  const { data: webhooks, error } = await db
    .from("agent_webhooks")
    .select()
    .eq("agent_id", agentId)
    .eq("is_active", true)
    .contains("events", [event]);

  if (error) {
    logger.error("Failed to fetch webhooks for dispatch", {
      agentId,
      event,
      error: error.message,
    });
    return 0;
  }

  if (!webhooks || webhooks.length === 0) {
    return 0;
  }

  // Deliver to all matching webhooks (fire-and-forget).
  let dispatched = 0;
  for (const webhook of webhooks) {
    // Run delivery in background -- don't await to avoid blocking the caller.
    void deliverWebhook(webhook, event, payload).catch((err) => {
      const msg = err instanceof Error ? err.message : "Unknown error";
      logger.error("Webhook delivery error", {
        webhookId: webhook.id,
        event,
        error: msg,
      });
    });
    dispatched++;
  }

  return dispatched;
}
