ALTER TABLE bg_home_content
  MODIFY COLUMN kind ENUM('banner','card','wallet_banner') NOT NULL;
