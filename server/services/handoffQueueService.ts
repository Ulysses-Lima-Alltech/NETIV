import { query } from '../db/pg.js';

/**
 * Distribui handoff entre corretores vinculados ao empreendimento:
 * menor carga (conversas em handoff atribuídas ao corretor), depois last_assigned_at, depois id.
 */
export async function pickBrokerForEnterpriseHandoff(enterpriseId: number): Promise<number | null> {
  const { rows } = await query<{ id: number; load: string; last_assigned_at: Date | null }>(
    `SELECT c.id,
       (SELECT COUNT(*)::text FROM conversations conv
         WHERE conv.handoff = true AND conv.assigned_broker_id = c.id) AS load,
       c.last_assigned_at
     FROM corretores c
     INNER JOIN corretor_empreendimentos ce ON ce.corretor_id = c.id
     WHERE ce.enterprise_id = $1
       AND c.active = true
       AND COALESCE(c.receiving_enabled, true) = true`,
    [enterpriseId]
  );
  if (rows.length === 0) return null;
  rows.sort((a, b) => {
    const la = parseInt(a.load, 10) || 0;
    const lb = parseInt(b.load, 10) || 0;
    if (la !== lb) return la - lb;
    const ta = a.last_assigned_at ? new Date(a.last_assigned_at).getTime() : 0;
    const tb = b.last_assigned_at ? new Date(b.last_assigned_at).getTime() : 0;
    if (ta !== tb) return ta - tb;
    return a.id - b.id;
  });
  return rows[0].id;
}

export async function assignBrokerForHandoffConversation(conversationId: number): Promise<number | null> {
  const { rows } = await query<{
    enterprise_id: number | null;
    handoff: boolean;
    assigned_broker_id: number | null;
  }>(`SELECT enterprise_id, handoff, assigned_broker_id FROM conversations WHERE id = $1`, [conversationId]);
  const conv = rows[0];
  if (!conv || !conv.handoff) return null;
  if (conv.assigned_broker_id != null) return conv.assigned_broker_id;
  const eid = conv.enterprise_id;
  if (eid == null) return null;
  const brokerId = await pickBrokerForEnterpriseHandoff(eid);
  if (brokerId == null) return null;
  await query(
    `UPDATE conversations SET assigned_broker_id = $1, updated_at = NOW() WHERE id = $2`,
    [brokerId, conversationId]
  );
  await query(`UPDATE corretores SET last_assigned_at = NOW(), updated_at = NOW() WHERE id = $1`, [brokerId]);
  return brokerId;
}

export async function clearAssignedBroker(conversationId: number): Promise<void> {
  await query(`UPDATE conversations SET assigned_broker_id = NULL, updated_at = NOW() WHERE id = $1`, [
    conversationId,
  ]);
}
