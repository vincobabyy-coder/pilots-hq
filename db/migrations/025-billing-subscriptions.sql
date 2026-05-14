-- Stripe billing subscriptions table
-- Stores subscription state for each organization

CREATE TABLE billing_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL UNIQUE REFERENCES organizations(id) ON DELETE CASCADE,
  stripe_customer_id VARCHAR(255) NOT NULL,
  stripe_subscription_id VARCHAR(255),
  tier VARCHAR(50) NOT NULL DEFAULT 'free', -- free, starter, professional, enterprise
  status VARCHAR(50) NOT NULL DEFAULT 'active', -- active, past_due, unpaid, canceled
  period_start TIMESTAMP,
  period_end TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_billing_subscriptions_org ON billing_subscriptions(org_id);
CREATE INDEX idx_billing_subscriptions_stripe_customer ON billing_subscriptions(stripe_customer_id);
CREATE INDEX idx_billing_subscriptions_status ON billing_subscriptions(status);
