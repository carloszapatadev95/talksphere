CREATE TABLE IF NOT EXISTS push_tokens (
  id          SERIAL PRIMARY KEY,
  user_id     INT NOT NULL,
  token       VARCHAR(255) NOT NULL,
  platform    TEXT NOT NULL CHECK (platform IN ('ios', 'android')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT unique_token UNIQUE (token)
);
