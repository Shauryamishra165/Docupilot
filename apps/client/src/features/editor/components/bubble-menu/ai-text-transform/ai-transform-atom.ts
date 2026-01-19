/**
 * AI Transform Atom
 * 
 * State management for AI text transformation processing.
 * Keeps track of:
 * - Current processing state
 * - Original block content (for rollback)
 * - Transformed content
 * - Selection info
 */

import { atom } from 'jotai';
import { AiProcessingState, AiCommandType, BlockInfo, SelectionInfo } from './types';

// Initial state
const initialState: AiProcessingState = {
  isProcessing: false,
  currentCommand: null,
  blockInfo: null,
  selectionInfo: null,
  originalBlockText: null,
  bracketedText: null,
  transformedText: null,
  error: null,
};

// Main processing state atom
export const aiTransformStateAtom = atom<AiProcessingState>(initialState);

// Derived atoms for specific pieces of state
export const isAiProcessingAtom = atom((get) => get(aiTransformStateAtom).isProcessing);
export const aiTransformErrorAtom = atom((get) => get(aiTransformStateAtom).error);
export const currentAiCommandAtom = atom((get) => get(aiTransformStateAtom).currentCommand);

// Action atoms for state updates
export const startAiProcessingAtom = atom(
  null,
  (get, set, payload: {
    command: AiCommandType;
    blockInfo: BlockInfo;
    selectionInfo: SelectionInfo;
    bracketedText: string;
  }) => {
    set(aiTransformStateAtom, {
      isProcessing: true,
      currentCommand: payload.command,
      blockInfo: payload.blockInfo,
      selectionInfo: payload.selectionInfo,
      originalBlockText: payload.blockInfo.text,
      bracketedText: payload.bracketedText,
      transformedText: null,
      error: null,
    });
  }
);

export const setAiTransformResultAtom = atom(
  null,
  (get, set, transformedText: string) => {
    const current = get(aiTransformStateAtom);
    set(aiTransformStateAtom, {
      ...current,
      isProcessing: false,
      transformedText,
    });
  }
);

export const setAiTransformErrorAtom = atom(
  null,
  (get, set, error: string) => {
    const current = get(aiTransformStateAtom);
    set(aiTransformStateAtom, {
      ...current,
      isProcessing: false,
      error,
    });
  }
);

export const resetAiTransformAtom = atom(
  null,
  (_get, set) => {
    set(aiTransformStateAtom, initialState);
  }
);

// Helper to get the final text after transformation (with brackets removed)
export const getFinalTransformedTextAtom = atom((get) => {
  const state = get(aiTransformStateAtom);
  if (!state.transformedText) return null;
  
  // The transformed text should already have the modification applied
  // We just need to extract it properly
  return state.transformedText;
});

