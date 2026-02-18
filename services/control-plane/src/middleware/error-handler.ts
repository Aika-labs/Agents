import type { ErrorHandler } from "hono";
import { logger } from "../lib/logger.js";

/** Global error handler. Returns structured JSON errors. */
export const errorHandler: ErrorHandler = (err, c) => {
  const status =
    "status" in err && typeof err.status === "number" ? err.status : 500;

  let requestId: string | undefined;
  try {
    requestId = c.get("requestId") as string | undefined;
  } catch {
    // requestId middleware may not have run yet.
  }

  const logFields: Record<string, unknown> = {
    requestId,
    status,
    method: c.req.method,
    path: c.req.path,
  };

  if (status >= 500) {
    logger.error(err.message || "Internal Server Error", {
      ...logFields,
      stack: err.stack,
    });
  } else if (status >= 400) {
    logger.warn(err.message, logFields);
  }

  return c.json(
    {
      error: {
        message: err.message || "Internal Server Error",
        status,
      },
    },
    status as 500,
  );
};
