-- Insert test org for integration tests
INSERT INTO organizations (id, name, slug) VALUES
  ('00000000-0000-0000-0000-000000000001', 'Test Org', 'test-org')
ON CONFLICT (id) DO NOTHING;
