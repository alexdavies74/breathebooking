import type { RowRef } from "@vennbase/core";
import type { Schema } from "./schema";

export function makeRowRef<TCollection extends keyof Schema & string>(
  collection: TCollection,
  id: string,
): RowRef<TCollection> {
  return {
    collection,
    id,
    baseUrl: window.location.origin,
  };
}
