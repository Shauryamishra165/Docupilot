import { atom } from "jotai";

export interface PageToolQueue {
  pageId: string;
  pageInfo: { title?: string; slugId?: string; spaceSlug?: string };
  tools: Array<{ tool: string; params: Record<string, any> }>;
  status: "pending" | "navigating" | "applying" | "completed";
}

export const multiPageToolQueueAtom = atom<PageToolQueue[]>([]);
export const multiPageEditingActiveAtom = atom<boolean>(false);
