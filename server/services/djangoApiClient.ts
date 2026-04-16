import { createServiceJwt } from './jwtService.js';
import { config } from '../config.js';

interface DjangoApiOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: Record<string, unknown>;
  params?: Record<string, string | number>;
}

interface DjangoApiResponse<T = unknown> {
  data?: T;
  error?: string;
  status: number;
  ok: boolean;
}

/**
 * Base client for Django API calls with JWT authentication
 */
class DjangoApiClient {
  private baseUrl: string;

  constructor() {
    // Use DJANGO_WEBHOOK_URL as base URL (same as used for webhooks)
    this.baseUrl = process.env.DJANGO_WEBHOOK_URL || '';
    if (!this.baseUrl) {
      console.warn('[DjangoApiClient] DJANGO_WEBHOOK_URL not configured');
    }
  }

  private async request<T = unknown>(
    endpoint: string,
    options: DjangoApiOptions = {}
  ): Promise<DjangoApiResponse<T>> {
    if (!this.baseUrl) {
      return {
        error: 'Django API not configured',
        status: 0,
        ok: false,
      };
    }

    const url = new URL(`${this.baseUrl}/api/v2${endpoint}`);
    
    // Add query parameters
    if (options.params) {
      Object.entries(options.params).forEach(([key, value]) => {
        url.searchParams.append(key, String(value));
      });
    }

    // Create JWT for authentication
    const jwt = createServiceJwt('netiv');

    try {
      const response = await fetch(url.toString(), {
        method: options.method || 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${jwt}`,
        },
        body: options.body ? JSON.stringify(options.body) : undefined,
      });

      const data = response.ok ? await response.json() : null;
      
      return {
        data,
        error: response.ok ? undefined : data?.error || `HTTP ${response.status}`,
        status: response.status,
        ok: response.ok,
      };
    } catch (error) {
      console.error('[DjangoApiClient] Request failed:', error);
      return {
        error: error instanceof Error ? error.message : 'Unknown error',
        status: 0,
        ok: false,
      };
    }
  }

  // === Empreendimentos / Espelho de Venda ===
  async getEmpreendimentos(filters?: {
    status?: string;
    central_id?: number;
  }) {
    return this.request('/empreendimentos/', { params: filters });
  }

  async getEmpreendimento(empreendimentoId: number) {
    return this.request(`/empreendimentos/${empreendimentoId}/`);
  }

  async getEmpreendimentoUnits(empreendimentoId: number, filters?: {
    status?: string;
    block_id?: number;
    type?: string;
  }) {
    return this.request(`/empreendimentos/${empreendimentoId}/units/`, { params: filters });
  }

  // === Leads CRM ===
  async getLeads(filters?: {
    phone?: string;
    status?: string;
    temperature?: string;
    central_id?: number;
    date_from?: string; // YYYY-MM-DD
    date_to?: string;   // YYYY-MM-DD
    page?: number;
    page_size?: number;
  }) {
    return this.request('/leads/', { params: filters });
  }

  async getLead(leadId: number) {
    return this.request(`/leads/${leadId}/`);
  }

  async updateLead(leadId: number, data: {
    name?: string;
    phone?: string;
    email?: string;
    status?: string;
    temperature?: string;
    responsible_id?: number;
  }) {
    return this.request(`/leads/${leadId}/`, {
      method: 'PUT',
      body: data,
    });
  }

  // === Agenda ===
  async getSchedules(filters?: {
    lead_id?: number;
    responsible_id?: number;
    status?: string;
    date_from?: string; // YYYY-MM-DD
    date_to?: string;   // YYYY-MM-DD
  }) {
    return this.request('/schedules/', { params: filters });
  }

  async createSchedule(data: {
    lead_id: number;
    date: string;      // YYYY-MM-DD
    time: string;      // HH:MM
    status?: string;
    notes?: string;
    responsible_id?: number;
  }) {
    // Montar publish_at no formato ISO 8601 esperado pelo Django
    const publish_at = `${data.date}T${data.time}:00`;
    
    const payload = {
      lead_id: data.lead_id,
      publish_at,
      ...(data.status && { status: data.status }),
      ...(data.notes && { notes: data.notes }),
      ...(data.responsible_id && { responsible_id: data.responsible_id }),
    };
    
    // Django route: POST /api/v2/schedules/ (schedules_dispatch)
    return this.request('/schedules/', {
      method: 'POST',
      body: payload,
    });
  }

  async updateSchedule(scheduleId: number, data: {
    status?: string;
    notes?: string;
    responsible_id?: number;
  }) {
    return this.request(`/schedules/${scheduleId}/`, {
      method: 'PATCH',
      body: data,
    });
  }
}

// Export singleton instance
export const djangoApiClient = new DjangoApiClient();

// Export types for use in other modules
export type {
  DjangoApiOptions,
  DjangoApiResponse,
};
