import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { sendAnaTextMessageWithQuota } from '../services/anaOutboundQuotaService.js';
import { processAnaReengagementScan } from '../services/anaReengagementService.js';
import { processAnaRetryJobsTick } from '../services/anaRetryWorkerService.js';
import { startAnaVisitFollowupIfEligible } from '../services/anaVisitFollowupService.js';
import { sendAnaEmergencyHandoff } from '../utils/anaEmergencyHandoff.js';
import {
  isAnaAutomationDisabled,
  isAnaOutboundDisabled,
  shouldBlockAnaAutomationOutbound,
} from '../utils/anaAutomationKillSwitch.js';

function withEnv(env: Record<string, string | undefined>, fn: () => Promise<void> | void): Promise<void> | void {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(env)) {
    previous.set(key, process.env[key]);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  const restore = () => {
    for (const [key, value] of previous.entries()) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
  try {
    const result = fn();
    if (result && typeof (result as Promise<void>).then === 'function') {
      return (result as Promise<void>).finally(restore);
    }
    restore();
  } catch (error) {
    restore();
    throw error;
  }
}

test('ANA_OUTBOUND_DISABLED=true impede sendAnaTextMessageWithQuota de chamar Meta', async () => {
  await withEnv(
    {
      ANA_OUTBOUND_DISABLED: 'true',
      ANA_AUTOMATION_DISABLED: undefined,
      ANA_EMERGENCY_HANDOFF: undefined,
    },
    async () => {
      let fetchCalls = 0;
      const originalFetch = globalThis.fetch;
      globalThis.fetch = (async () => {
        fetchCalls += 1;
        throw new Error('fetch should not be called');
      }) as typeof fetch;

      try {
        const result = await sendAnaTextMessageWithQuota({
          conversationId: 123,
          to: '5511999999999',
          text: 'Oi',
          phase: 'test_kill_switch',
        });

        assert.equal(result.success, false);
        assert.equal(result.error, 'ana_outbound_disabled');
        assert.equal(fetchCalls, 0);
      } finally {
        globalThis.fetch = originalFetch;
      }
    }
  );
});

test('ANA_EMERGENCY_HANDOFF=true bloqueia scan e retry worker antes de DB/OpenAI/Meta', async () => {
  await withEnv(
    {
      ANA_EMERGENCY_HANDOFF: 'true',
      ANA_AUTOMATION_DISABLED: undefined,
      ANA_OUTBOUND_DISABLED: undefined,
    },
    async () => {
      await processAnaReengagementScan();
      await processAnaRetryJobsTick();
    }
  );
});

test('ANA_AUTOMATION_DISABLED=true bloqueia follow-up, retry e visit follow-up sem buscar jobs', async () => {
  await withEnv(
    {
      ANA_AUTOMATION_DISABLED: 'true',
      ANA_EMERGENCY_HANDOFF: undefined,
      ANA_OUTBOUND_DISABLED: undefined,
    },
    async () => {
      assert.equal(isAnaAutomationDisabled(), true);
      await processAnaReengagementScan();
      await processAnaRetryJobsTick();
      await startAnaVisitFollowupIfEligible({
        conversationId: 456,
        flowState: {
          pendingVisitScheduling: true,
          suggestedVisitStatus: 'awaiting_confirmation',
          suggestedVisitSlotLabel: 'amanha as 14h',
        },
        replyText: 'Que tal uma visita amanha as 14h?',
        anchorAssistantMessageId: null,
      });
    }
  );
});

test('ANA_OUTBOUND_DISABLED=true prevalece ate sobre handoff de emergencia', async () => {
  await withEnv(
    {
      ANA_OUTBOUND_DISABLED: 'true',
      ANA_AUTOMATION_DISABLED: undefined,
      ANA_EMERGENCY_HANDOFF: 'true',
    },
    async () => {
      let sendCalls = 0;
      const result = await sendAnaEmergencyHandoff({
        conversationId: 789,
        toPhoneNumber: '5511999999999',
        sendTextMessage: async () => {
          sendCalls += 1;
          return { success: true, metaMessageId: 'wamid.should-not-send' };
        },
        insertAssistantMessage: async () => {
          throw new Error('insert should not happen when outbound is disabled');
        },
      });

      assert.equal(result.sent, false);
      assert.equal(result.error, 'ana_outbound_disabled');
      assert.equal(sendCalls, 0);
    }
  );
});

test('kill switch util interpreta flags e retorna decisao com source/conversationId', () => {
  withEnv(
    {
      ANA_OUTBOUND_DISABLED: 'true',
      ANA_AUTOMATION_DISABLED: undefined,
      ANA_EMERGENCY_HANDOFF: undefined,
    },
    () => {
      assert.equal(isAnaOutboundDisabled(), true);
      assert.deepEqual(
        shouldBlockAnaAutomationOutbound({ source: 'unit_test', conversationId: 42 }),
        {
          blocked: true,
          reason: 'ana_outbound_disabled',
          source: 'unit_test',
          conversationId: 42,
        }
      );
    }
  );
});

test('textos outbound principais da Ana nao possuem mojibake', () => {
  const files = [
    'services/anaReengagementService.ts',
    'utils/anaVisitFollowupCadence.ts',
    'config/anaCommercialRules.ts',
    'services/conversationEngine.ts',
  ];
  for (const file of files) {
    const source = readFileSync(path.resolve(process.cwd(), file), 'utf8');
    assert.doesNotMatch(source, /Ãƒ|Ã‚|ï¿½/, file);
  }
});
