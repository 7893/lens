-- LENS Search Optimization: 0001_fts5_search.sql

-- 1. Create FTS5 Virtual Table for Lightning-Fast Text Search
-- This table stores ONLY indexed textual data and references the main images table.
CREATE VIRTUAL TABLE IF NOT EXISTS images_fts USING fts5(
    id UNINDEXED, 
    caption, 
    tags, 
    photographer, 
    location, 
    content='images', 
    content_rowid='id'
);

-- 2. Define Triggers to keep FTS index in sync with the source table
-- Trigger A: Insert synchronization
CREATE TRIGGER IF NOT EXISTS images_ai AFTER INSERT ON images BEGIN
  INSERT INTO images_fts(rowid, id, caption, tags, photographer, location)
  VALUES (
    new.id, 
    new.id, 
    new.ai_caption, 
    new.ai_tags, 
    json_extract(new.meta_json, '$.user.name'),
    json_extract(new.meta_json, '$.location.name')
  );
END;

-- Trigger B: Delete synchronization
CREATE TRIGGER IF NOT EXISTS images_ad AFTER DELETE ON images BEGIN
  INSERT INTO images_fts(images_fts, rowid, id, caption, tags, photographer, location)
  VALUES('delete', old.id, old.id, old.ai_caption, old.ai_tags, json_extract(old.meta_json, '$.user.name'), json_extract(old.location, '$.name'));
END;

-- Trigger C: Update synchronization (for Evolution)
CREATE TRIGGER IF NOT EXISTS images_au AFTER UPDATE ON images BEGIN
  INSERT INTO images_fts(images_fts, rowid, id, caption, tags, photographer, location)
  VALUES('delete', old.id, old.id, old.ai_caption, old.ai_tags, json_extract(old.meta_json, '$.user.name'), json_extract(old.location, '$.name'));
  INSERT INTO images_fts(rowid, id, caption, tags, photographer, location)
  VALUES (
    new.id, 
    new.id, 
    new.ai_caption, 
    new.ai_tags, 
    json_extract(new.meta_json, '$.user.name'),
    json_extract(new.meta_json, '$.location.name')
  );
END;

-- 3. Rebuild (Populate FTS if there's existing data)
INSERT INTO images_fts(rowid, id, caption, tags, photographer, location)
SELECT id, id, ai_caption, ai_tags, json_extract(meta_json, '$.user.name'), json_extract(meta_json, '$.location.name')
FROM images;
