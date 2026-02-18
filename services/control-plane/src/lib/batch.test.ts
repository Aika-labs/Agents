import { describe, it, expect } from "vitest";
import { chunk, processInChunks } from "./batch.js";

describe("chunk", () => {
  it("splits an array into chunks of the given size", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it("returns a single chunk when size >= array length", () => {
    expect(chunk([1, 2, 3], 5)).toEqual([[1, 2, 3]]);
  });

  it("returns empty array for empty input", () => {
    expect(chunk([], 3)).toEqual([]);
  });

  it("handles chunk size of 1", () => {
    expect(chunk([1, 2, 3], 1)).toEqual([[1], [2], [3]]);
  });

  it("handles exact divisible length", () => {
    expect(chunk([1, 2, 3, 4], 2)).toEqual([
      [1, 2],
      [3, 4],
    ]);
  });
});

describe("processInChunks", () => {
  it("processes all items and returns combined results", async () => {
    const items = [1, 2, 3, 4, 5];
    const results = await processInChunks(items, 2, async (chunkItems, startIndex) => {
      return chunkItems.map((item, i) => ({
        index: startIndex + i,
        value: item * 10,
      }));
    });

    expect(results).toHaveLength(5);
    expect(results[0]).toEqual({ index: 0, value: 10 });
    expect(results[4]).toEqual({ index: 4, value: 50 });
  });

  it("passes correct startIndex to each chunk", async () => {
    const startIndices: number[] = [];
    await processInChunks([1, 2, 3, 4, 5], 2, async (_chunk, startIndex) => {
      startIndices.push(startIndex);
      return [];
    });

    expect(startIndices).toEqual([0, 2, 4]);
  });

  it("handles empty input", async () => {
    const results = await processInChunks([], 10, async () => []);
    expect(results).toEqual([]);
  });
});
