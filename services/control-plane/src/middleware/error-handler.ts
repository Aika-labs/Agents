import type { ErrorHandler } from "hono";

/** Global error handler. Returns structured JSON errors. */
export const errorHandler: ErrorHandler = (err, c) => {
  console.error(`[ERROR] ${err.message}`, err.stack);

  const status = "status" in err && typeof err.status === "number" ? err.status : 500;
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
