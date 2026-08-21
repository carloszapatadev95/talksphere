ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS reply_to_id INT;

ALTER TABLE messages
  ADD CONSTRAINT fk_messages_reply_to FOREIGN KEY (reply_to_id) REFERENCES messages(id) ON DELETE SET NULL;
