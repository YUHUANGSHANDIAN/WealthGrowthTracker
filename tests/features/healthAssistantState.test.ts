import { describe, expect, it } from 'vitest';
import {
  emptyHealthAssistantState,
  parseHealthAssistantState,
  pruneHealthAssistantState,
  upsertHealthConversation,
} from '../../src/domain/healthAssistant/state';
import type { HealthAssistantConversation } from '../../src/domain/healthAssistant/types';

function conversation(updatedAt: string): HealthAssistantConversation {
  return {
    schemaVersion: 1,
    id: 'conversation-1',
    ledgerId: 'ledger-1',
    issueId: 'history:duplicate:global',
    issueFingerprint: 'fingerprint-1',
    task: 'data-health-assistant',
    providerId: 'gateway',
    profileId: 'profile-1',
    modelId: 'model-1',
    authorization: {
      issueId: 'history:duplicate:global',
      issueFingerprint: 'fingerprint-1',
      domain: 'history',
      includeEvidence: false,
      includeAmounts: false,
    },
    baseRevision: 7,
    messages: [{
      id: 'message-1',
      role: 'user',
      text: '为什么提示重复日期？',
      createdAt: updatedAt,
    }],
    createdAt: updatedAt,
    updatedAt,
  };
}

describe('health assistant local conversation schema', () => {
  it('defaults to 30 days and excludes conversations from full backups', () => {
    expect(emptyHealthAssistantState()).toMatchObject({
      retention: 30,
      includeInFullBackup: false,
      conversations: [],
    });
  });

  it('prunes expired conversations and keeps local-only records independent', () => {
    const state = {
      ...emptyHealthAssistantState(),
      retention: 7 as const,
      conversations: [
        conversation('2026-10-01T00:00:00.000Z'),
        { ...conversation('2026-11-09T00:00:00.000Z'), id: 'conversation-2' },
      ],
    };
    const pruned = pruneHealthAssistantState(state, new Date('2026-11-10T00:00:00.000Z'));
    expect(pruned.conversations.map((item) => item.id)).toEqual(['conversation-2']);
  });

  it('rejects credentials and future schemas', () => {
    expect(() => parseHealthAssistantState({
      ...emptyHealthAssistantState(),
      apiKey: 'must-not-be-stored',
    })).toThrow('敏感字段');
    expect(() => parseHealthAssistantState({
      ...emptyHealthAssistantState(),
      schemaVersion: 2,
    })).toThrow('版本');
  });

  it('upserts a bounded conversation without changing financial schema fields', () => {
    const state = upsertHealthConversation(emptyHealthAssistantState(), conversation('2026-11-10T00:00:00.000Z'));
    expect(state.conversations[0]).toMatchObject({
      task: 'data-health-assistant',
      authorization: { includeAmounts: false, includeEvidence: false },
    });
  });
});
