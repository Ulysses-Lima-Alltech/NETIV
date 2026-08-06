import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { sendAnaTextMessageWithQuota } from '../services/anaOutboundQuotaService.js';
import { processAnaRetryJobsTick } from '../services/anaRetryWorkerService.js';
import { startAnaVisitFollowupIfEligible } from '../services/anaVisitFollowupService.js';
import { sendAnaEmergencyHandoff } from '../utils/anaEmergencyHandoff.js';
import {
  getAnaAutomationPauseReason,
  isAnaAutomationDisabled,
  isAnaDirectInboundReplyEnabled,
  isAnaOutboundDisabled,
  runWithAnaAutomationOutboundSource,
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

async function captureConsoleLogs(fn: () => Promise<void>): Promise<string[]> {
  const logs: string[] = [];
  const originalLog = console.log;
  const originalWarn = console.warn;
  const originalError = console.error;
  const capture = (...args: unknown[]) => {
    logs.push(
      args
        .map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg)))
        .join(' ')
    );
  };
  console.log = capture;
  console.warn = capture;
  console.error = capture;
  try {
    await fn();
    return logs;
  } finally {
    console.log = originalLog;
    console.warn = originalWarn;
    console.error = originalError;
  }
}

test('ANA_OUTBOUND_DISABLED=true impede sendAnaTextMessageWithQuota de chamar Meta', async () => {
  await withEnv(
    {
      ANA_OUTBOUND_DISABLED: 'true',
      ANA_AUTOMATION_DISABLED: undefined,
      ANA_EMERGENCY_HANDOFF: undefined,
      ANA_DIRECT_INBOUND_REPLY_ENABLED: undefined,
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

test('inbound engine direto nao e bloqueado por ANA_AUTOMATION_DISABLED quando flag explicita esta ativa', async () => {
  await withEnv(
    {
      ANA_AUTOMATION_DISABLED: 'true',
      ANA_DIRECT_INBOUND_REPLY_ENABLED: 'true',
      ANA_OUTBOUND_DISABLED: 'false',
      ANA_EMERGENCY_HANDOFF: 'false',
    },
    async () => {
      assert.equal(isAnaAutomationDisabled(), true);
      assert.equal(isAnaDirectInboundReplyEnabled(), true);
      assert.equal(
        getAnaAutomationPauseReason({ source: 'ana_inbound_engine', conversationId: 15310 }),
        null
      );
      assert.deepEqual(
        shouldBlockAnaAutomationOutbound({ source: 'ana_inbound_engine', conversationId: 15310 }),
        { blocked: false }
      );

      assert.deepEqual(
        shouldBlockAnaAutomationOutbound({ source: 'ana_main_reply', conversationId: 15310 }),
        {
          blocked: true,
          reason: 'ana_automation_disabled',
          source: 'ana_main_reply',
          conversationId: 15310,
        }
      );

      await runWithAnaAutomationOutboundSource('ana_inbound_engine', async () => {
        assert.deepEqual(
          shouldBlockAnaAutomationOutbound({ source: 'ana_main_reply', conversationId: 15310 }),
          { blocked: false }
        );
      });
    }
  );
});

test('handleIncomingMessage escopa outbound direto como ana_inbound_engine', () => {
  const source = readFileSync(path.resolve(process.cwd(), 'services/conversationEngine.ts'), 'utf8');
  assert.match(source, /runWithAnaAutomationOutboundSource\('ana_inbound_engine'/);
  assert.match(source, /getAnaAutomationPauseReason\(\{\s*source: 'ana_inbound_engine',\s*conversationId,/s);
});

test('background sources continuam bloqueados com ANA_AUTOMATION_DISABLED=true mesmo com direct inbound ligado', () => {
  withEnv(
    {
      ANA_AUTOMATION_DISABLED: 'true',
      ANA_DIRECT_INBOUND_REPLY_ENABLED: 'true',
      ANA_OUTBOUND_DISABLED: 'false',
      ANA_EMERGENCY_HANDOFF: 'false',
    },
    () => {
      const sources = [
        'ana_retry_worker',
        'ana_visit_followup',
        'scheduled_batch',
        'ana_retry_scheduler',
        'ana_reprocess',
      ];

      for (const source of sources) {
        assert.equal(
          getAnaAutomationPauseReason({ source, conversationId: 15310 }),
          'ana_automation_disabled',
          source
        );
        assert.deepEqual(
          shouldBlockAnaAutomationOutbound({ source, conversationId: 15310 }),
          {
            blocked: true,
            reason: 'ana_automation_disabled',
            source,
            conversationId: 15310,
          },
          source
        );
      }
    }
  );
});

test('ANA_OUTBOUND_DISABLED=true bloqueia tambem inbound direto autorizado', async () => {
  await withEnv(
    {
      ANA_AUTOMATION_DISABLED: 'true',
      ANA_DIRECT_INBOUND_REPLY_ENABLED: 'true',
      ANA_OUTBOUND_DISABLED: 'true',
      ANA_EMERGENCY_HANDOFF: 'false',
    },
    async () => {
      assert.equal(
        getAnaAutomationPauseReason({ source: 'ana_inbound_engine', conversationId: 15310 }),
        'ana_outbound_disabled'
      );
      await runWithAnaAutomationOutboundSource('ana_inbound_engine', async () => {
        assert.deepEqual(
          shouldBlockAnaAutomationOutbound({ source: 'ana_main_reply', conversationId: 15310 }),
          {
            blocked: true,
            reason: 'ana_outbound_disabled',
            source: 'ana_inbound_engine',
            conversationId: 15310,
          }
        );
      });

      let fetchCalls = 0;
      const originalFetch = globalThis.fetch;
      globalThis.fetch = (async () => {
        fetchCalls += 1;
        throw new Error('fetch should not be called');
      }) as typeof fetch;

      try {
        const result = await runWithAnaAutomationOutboundSource('ana_inbound_engine', () =>
          sendAnaTextMessageWithQuota({
            conversationId: 15310,
            to: '5512992367544',
            text: 'Oi',
            phase: 'ana_main_reply',
          })
        );

        assert.equal(result.success, false);
        assert.equal(result.error, 'ana_outbound_disabled');
        assert.equal(fetchCalls, 0);
      } finally {
        globalThis.fetch = originalFetch;
      }
    }
  );
});

test('ANA_EMERGENCY_HANDOFF=true bloqueia retry worker antes de DB/OpenAI/Meta', async () => {
  await withEnv(
    {
      ANA_EMERGENCY_HANDOFF: 'true',
      ANA_AUTOMATION_DISABLED: undefined,
      ANA_OUTBOUND_DISABLED: undefined,
      ANA_DIRECT_INBOUND_REPLY_ENABLED: undefined,
    },
    async () => {
      await processAnaRetryJobsTick();
    }
  );
});

test('ANA_AUTOMATION_DISABLED=true bloqueia retry e visit follow-up sem buscar jobs', async () => {
  await withEnv(
    {
      ANA_AUTOMATION_DISABLED: 'true',
      ANA_EMERGENCY_HANDOFF: undefined,
      ANA_OUTBOUND_DISABLED: undefined,
      ANA_DIRECT_INBOUND_REPLY_ENABLED: 'true',
    },
    async () => {
      assert.equal(isAnaAutomationDisabled(), true);
      const logs = await captureConsoleLogs(async () => {
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
      });
      const joinedLogs = logs.join('\n');
      assert.match(joinedLogs, /ANA_AUTOMATION_SKIP/);
      assert.doesNotMatch(joinedLogs, /outboundMetaMessageId/);
    }
  );
});

test('ANA_OUTBOUND_DISABLED=true prevalece ate sobre handoff de emergencia', async () => {
  await withEnv(
    {
      ANA_OUTBOUND_DISABLED: 'true',
      ANA_AUTOMATION_DISABLED: undefined,
      ANA_EMERGENCY_HANDOFF: 'true',
      ANA_DIRECT_INBOUND_REPLY_ENABLED: 'true',
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
    'utils/anaVisitFollowupCadence.ts',
    'config/anaCommercialRules.ts',
    'services/conversationEngine.ts',
  ];
  for (const file of files) {
    const source = readFileSync(path.resolve(process.cwd(), file), 'utf8');
    assert.doesNotMatch(source, /Ãƒ|Ã‚|ï¿½/, file);
  }
});
