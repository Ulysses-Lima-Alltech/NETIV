import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

test('bootstrap e rotas nao expoem resgate automatico de conversas inativas', () => {
  const serverRoot = process.cwd();
  const indexSource = readFileSync(path.resolve(serverRoot, 'index.ts'), 'utf8');
  const routesSource = readFileSync(path.resolve(serverRoot, 'routes/index.ts'), 'utf8');
  const engineSource = readFileSync(path.resolve(serverRoot, 'services/conversationEngine.ts'), 'utf8');
  const frontendClientSource = readFileSync(path.resolve(serverRoot, '..', 'src/api/client.ts'), 'utf8');
  const frontendTypesSource = readFileSync(path.resolve(serverRoot, '..', 'src/types.ts'), 'utf8');
  const inboxSource = readFileSync(path.resolve(serverRoot, '..', 'src/pages/InboxPage.tsx'), 'utf8');

  assert.doesNotMatch(indexSource, /processAnaReengagementScan|inactiveConversationWallet|AUTO_WALLET_INACTIVE/);
  assert.doesNotMatch(routesSource, /reengagement/);
  assert.doesNotMatch(engineSource, /startAnaGeneralFollowup|cancelAnaGeneralFollowup/);
  assert.doesNotMatch(frontendClientSource, /reengagementApi|reengagementCount|\/reengagement/);
  assert.doesNotMatch(frontendTypesSource, /reengagementCount|reengajamento automático/);
  assert.doesNotMatch(inboxSource, /reengagementCount/);

  for (const relativePath of [
    'routes/reengagement.ts',
    'services/anaReengagementService.ts',
    'services/anaGeneralFollowupService.ts',
    'services/inactiveConversationWalletService.ts',
    'scripts/autoWalletInactiveConversations.ts',
  ]) {
    assert.equal(existsSync(path.join(serverRoot, relativePath)), false, relativePath);
  }
});
