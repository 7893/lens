-- LENS Search Optimization: 0001_fts5_search.sql

-- 1. Create standalone FTS5 Virtual Table (no content sync due to TEXT id)
CREATE VIRTUAL TABLE IF NOT EXISTS images_fts USING fts5(
    id, 
    caption, 
    tags, 
    photographer, 
    location
);

-- 2. Triggers to keep FTS index in sync
CREATE TRIGGER IF NOT EXISTS images_fts_ai AFTER INSERT ON images BEGIN
  INSERT INTO images_fts(id, caption, tags, photographer, location)
  VALUES (
    new.id, 
    new.ai_caption, 
    new.ai_tags, 
    json_extract(new.meta_json, '$.user.name'),
    json_extract(new.meta_json, '$.location.name')
  );
END;

CREATE TRIGGER IF NOT EXISTS images_fts_ad AFTER DELETE ON images BEGIN
  DELETE FROM images_fts WHERE id = old.id;
END;

CREATE TRIGGER IF NOT EXISTS images_fts_au AFTER UPDATE ON images BEGIN
  DELETE FROM images_fts WHERE id = old.id;
  INSERT INTO images_fts(id, caption, tags, photographer, location)
  VALUES (
    new.id, 
    new.ai_caption, 
    new.ai_tags, 
    json_extract(new.meta_json, '$.user.name'),
    json_extract(new.meta_json, '$.location.name')
  );
END;

-- 3. Populate FTS with existing data
INSERT INTO images_fts(id, caption, tags, photographer, location)
SELECT id, ai_caption, ai_tags, json_extract(meta_json, '$.user.name'), json_extract(meta_json, '$.location.name')
FROM images;
