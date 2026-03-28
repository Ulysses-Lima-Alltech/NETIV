-- Nome de exibição do WhatsApp (só listagem); separado de customer_name (confirmado pelo cliente na conversa).
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS whatsapp_display_name TEXT;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS ana_asked_customer_name BOOLEAN NOT NULL DEFAULT FALSE;
