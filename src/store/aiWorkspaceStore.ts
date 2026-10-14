import { create } from 'zustand';
import type { AITask } from '../services/ai/client';

export interface AIWorkspaceTarget {
  task: AITask;
  reportId?: string;
  goalId?: string;
  range?: { start: string; end: string };
}
interface AIWorkspaceState {
  target: AIWorkspaceTarget | null;
  open: (target: AIWorkspaceTarget) => void;
  close: () => void;
}
export const useAIWorkspaceStore = create<AIWorkspaceState>()(set => ({
  target: null,
  open: target => set({ target }),
  close: () => set({ target: null }),
}));
