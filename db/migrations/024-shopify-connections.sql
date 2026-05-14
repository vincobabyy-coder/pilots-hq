-- Shopify integration connections table
-- Stores encrypted OAuth tokens for each Shopify shop per organization

CREATE TABLE IF NOT EXISTS shopify_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  shop_domain VARCHAR(255) NOT NULL,
  access_token_encrypted VARCHAR(700) NOT NULL,
  webhook_hmac_secret_encrypted VARCHAR(700) NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),

  UNIQUE(org_id, shop_domain)
);

CREATE INDEX IF NOT EXISTS idx_shopify_connections_org ON shopify_connections(org_id);
CREATE INDEX IF NOT EXISTS idx_shopify_connections_domain ON shopify_connections(shop_domain);
