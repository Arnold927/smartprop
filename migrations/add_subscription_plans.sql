-- Subscription plans managed by the platform admin, and per-organisation overrides.
-- Safe to run more than once.
--
--  * subscription_plans: the catalogue (price, limits, feature list). NULL limit = unlimited.
--  * organizations.limit_overrides: per-organisation limits that win over the plan, e.g.
--      {"maxProperties": 40, "maxUnits": null}   (a key present with null = unlimited for that org)
--  * organizations.custom_price_kes: a negotiated price for this organisation only.
--  * organizations.trial_ends_at / current_period_end: when the trial or paid period runs out (NULL = never).

CREATE TABLE IF NOT EXISTS subscription_plans (
  id             VARCHAR(50) PRIMARY KEY,
  name           VARCHAR(100) NOT NULL,
  description    TEXT,
  price_kes      NUMERIC(12,2) NOT NULL DEFAULT 0,
  max_properties INTEGER,
  max_units      INTEGER,
  max_users      INTEGER,
  features       JSONB NOT NULL DEFAULT '[]'::jsonb,
  feature_flags  JSONB NOT NULL DEFAULT '{}'::jsonb,
  trial_days     INTEGER,
  is_active      BOOLEAN NOT NULL DEFAULT TRUE,
  is_public      BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order     INTEGER NOT NULL DEFAULT 0,
  created_at     TIMESTAMP DEFAULT NOW(),
  updated_at     TIMESTAMP DEFAULT NOW()
);

ALTER TABLE organizations ADD COLUMN IF NOT EXISTS limit_overrides     JSONB;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS custom_price_kes    NUMERIC(12,2);
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS trial_ends_at       TIMESTAMP;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS current_period_end  TIMESTAMP;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS subscription_notes  TEXT;

-- The three plans that used to be hard-coded, plus "basic": what every organisation that signed up on its own
-- was given (5 properties, 10 users). It is private — not offered on the billing page.
INSERT INTO subscription_plans (id, name, price_kes, max_properties, max_units, max_users, features, feature_flags, sort_order) VALUES
 ('starter',    'Starter',    2500,  5,    NULL, 5,
  '["Up to 5 properties","Up to 5 users","M-Pesa rent collection","Basic reports"]'::jsonb, '{}'::jsonb, 1),
 ('growth',     'Growth',     6500,  25,   NULL, 20,
  '["Up to 25 properties","Up to 20 users","M-Pesa rent collection","Advanced analytics","WhatsApp notifications","Work orders"]'::jsonb, '{"whiteLabel": true}'::jsonb, 2),
 ('enterprise', 'Enterprise', 15000, NULL, NULL, NULL,
  '["Unlimited properties & users","All Growth features","Dedicated support","Custom integrations","SLA guarantee"]'::jsonb, '{"whiteLabel": true, "customDomain": true}'::jsonb, 3)
ON CONFLICT (id) DO NOTHING;

INSERT INTO subscription_plans (id, name, price_kes, max_properties, max_units, max_users, features, is_public, sort_order)
VALUES ('basic', 'Basic', 0, 5, NULL, 10, '["Up to 5 properties","Up to 10 users"]'::jsonb, FALSE, 0)
ON CONFLICT (id) DO NOTHING;

-- Keep every existing organisation exactly as limited as it is today: where its stored limits
-- differ from its plan's, record the difference as an override (9999 and above meant "unlimited").
UPDATE organizations o
SET limit_overrides = NULLIF(jsonb_strip_nulls(jsonb_build_object(
      'maxProperties', CASE WHEN o.max_properties IS NOT NULL AND o.max_properties IS DISTINCT FROM p.max_properties
                                 AND NOT (p.max_properties IS NULL AND o.max_properties >= 9999) THEN o.max_properties END,
      'maxUsers',      CASE WHEN o.max_users IS NOT NULL AND o.max_users IS DISTINCT FROM p.max_users
                                 AND NOT (p.max_users IS NULL AND o.max_users >= 9999) THEN o.max_users END
    )), '{}'::jsonb)
FROM subscription_plans p
WHERE p.id = o.subscription_plan AND o.limit_overrides IS NULL;
