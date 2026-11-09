import { describe, expect, it } from 'vitest';
import source from '../components/UnclassifiedLeadMessageCard.tsx?raw';
import nav from '../hooks/useAppNav.ts?raw';
import settings from '../pages/SettingsWhatsAppPage.tsx?raw';

describe('UnclassifiedLeadMessageCard', () => {
  it('uses the requested orange card and black typography', () => {
    expect(source).toContain('TRATAR LEADS SEM CLASSIFICAÇÃO');
    expect(source).toContain('border-2 border-[#F97316] bg-white p-6 pl-9 text-black');
    expect(source).toContain('absolute bottom-0 left-0 top-0 w-2 rounded-l-[10px] bg-[#F97316]');
    expect(source).toContain("text-black placeholder:text-black");
    expect(settings).toContain('<UnclassifiedLeadMessageCard />');
  });

  it('explains the dynamic city placeholder and the no-handoff behavior', () => {
    expect(source).toContain("Use {'{cidades}'}");
    expect(source).toContain('não cria um HandOff automaticamente');
    expect(source).toContain('Salvar mensagens');
    expect(source).toContain('Follow-Up de Leads Não Classificados (Sem Empreendimento)');
    expect(source).toContain('OBJETIVO: Classificar esses Leads');
    expect(source).not.toContain('Gerar prévia de leads');
    expect(source).toContain('Confirmar e Disparar Follow-Up');
    expect(source).toContain('autorizaram receber comunicações de acompanhamento');
  });

  it('labels the Settings navigation in Portuguese uppercase', () => {
    expect(nav).toContain("label: 'CONFIGURAÇÕES'");
  });
});
