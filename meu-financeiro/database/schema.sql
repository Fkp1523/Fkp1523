CREATE DATABASE IF NOT EXISTS meu_financeiro
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_0900_ai_ci;

USE meu_financeiro;

CREATE TABLE IF NOT EXISTS app_users (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(80) NOT NULL UNIQUE,
  password_salt BINARY(16) NOT NULL,
  password_hash BINARY(64) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS app_sessions (
  token_hash CHAR(64) NOT NULL PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  expires_at DATETIME NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_app_sessions_user FOREIGN KEY (user_id) REFERENCES app_users(id) ON DELETE CASCADE,
  INDEX idx_app_sessions_expiry (expires_at)
);

CREATE TABLE IF NOT EXISTS incomes (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  description VARCHAR(120) NOT NULL,
  amount DECIMAL(12,2) NOT NULL,
  received_on DATE NOT NULL,
  note VARCHAR(500) NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_incomes_received_on (received_on)
);

CREATE TABLE IF NOT EXISTS bills (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  category VARCHAR(40) NOT NULL DEFAULT 'Outros',
  expected_amount DECIMAL(12,2) NOT NULL,
  due_day TINYINT UNSIGNED NOT NULL,
  started_month CHAR(7) NULL DEFAULT NULL,
  recurring TINYINT UNSIGNED NOT NULL DEFAULT 1,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_bills_active_due (active, due_day)
);

CREATE TABLE IF NOT EXISTS bill_payments (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  bill_id BIGINT UNSIGNED NOT NULL,
  period CHAR(7) NOT NULL,
  amount DECIMAL(12,2) NOT NULL,
  paid_on DATE NOT NULL,
  note VARCHAR(500) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_bill_payments_bill FOREIGN KEY (bill_id) REFERENCES bills(id) ON DELETE RESTRICT,
  UNIQUE KEY uq_bill_period (bill_id, period),
  INDEX idx_bill_payments_period (period)
);

CREATE TABLE IF NOT EXISTS installments (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  store VARCHAR(120) NULL,
  amount DECIMAL(12,2) NOT NULL,
  total SMALLINT UNSIGNED NOT NULL,
  paid SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  started_month CHAR(7) NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_installments_active_start (active, started_month)
);

CREATE TABLE IF NOT EXISTS debts (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  creditor VARCHAR(120) NULL,
  original_amount DECIMAL(12,2) NOT NULL,
  starting_balance DECIMAL(12,2) NOT NULL,
  balance DECIMAL(12,2) NOT NULL,
  monthly_payment DECIMAL(12,2) NOT NULL DEFAULT 0,
  due_day TINYINT UNSIGNED NULL,
  note VARCHAR(500) NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_debts_balance (balance)
);

CREATE TABLE IF NOT EXISTS transactions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  kind ENUM('income','bill','installment','debt') NOT NULL,
  item_id BIGINT UNSIGNED NULL,
  label VARCHAR(180) NOT NULL,
  amount DECIMAL(12,2) NOT NULL,
  happened_on DATE NOT NULL,
  period CHAR(7) NOT NULL,
  note VARCHAR(500) NULL,
  remaining_after DECIMAL(12,2) NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_transactions_period_date (period, happened_on),
  INDEX idx_transactions_kind (kind, item_id)
);

-- Atualiza estruturas criadas por versões anteriores sem apagar movimentações.
ALTER TABLE bills MODIFY category VARCHAR(40) NOT NULL DEFAULT 'Outros';
ALTER TABLE transactions MODIFY kind ENUM('income','bill','installment','debt') NOT NULL;
