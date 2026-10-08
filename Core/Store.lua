setfenv(1, ForeverLAN_Env)

function ensureSettings()
  ForeverLANDB.settings = ForeverLANDB.settings or {}
  local s = ForeverLANDB.settings
  if ForeverLANDB.ui_mode ~= "pin" then
    ForeverLANDB.ui_mode = "pin"
    s.announce_events = false
    s.startup_hints = false
    s.show_minimap_button = false
  end
  for k, v in pairs(SETTINGS_DEFAULTS) do
    if s[k] == nil then
      s[k] = v
    end
  end
  return s
end

function setting(key)
  local s = ensureSettings()
  if s[key] == nil then
    return SETTINGS_DEFAULTS[key]
  end
  return s[key]
end

function setSetting(key, value)
  ensureSettings()[key] = value and true or false
  if ui.applyUiSettings then
    ui.applyUiSettings()
  end
end

-- ---------------------------------------------------------------------------
-- Per-character store (ForeverLANCharDB) - schema 3
-- ---------------------------------------------------------------------------
activeCharKey = nil
seq = 0
pending = {}
pendingById = {}

function charStore()
  ForeverLANCharDB = ForeverLANCharDB or {}
  if type(ForeverLANCharDB.pending) ~= "table" then
    ForeverLANCharDB.pending = {}
  end
  return ForeverLANCharDB
end

function realmLabel()
  if GetNormalizedRealmName then
    local ok, r = pcall(GetNormalizedRealmName)
    if ok and type(r) == "string" and r ~= "" then
      return r
    end
  end
  if GetRealmName then
    local ok, r = pcall(GetRealmName)
    if ok and type(r) == "string" and r ~= "" then
      return (r:gsub("%s+", ""))
    end
  end
  return ""
end

function normalizeRealm(raw)
  if type(raw) ~= "string" then
    return ""
  end
  return (raw:gsub("%s+", "")):lower()
end

--- Forever names are always "First Last". That convention leads.
--- UnitName / UnitNameUnmodified second return is the surname - never the realm.
--- Realm comes from UnitFullName's second return or GetNormalizedRealmName.
function parseForeverName(first, second, realm)
  first = type(first) == "string" and first or ""
  second = type(second) == "string" and second or ""
  realm = type(realm) == "string" and realm or ""
  local lower = string.lower(first)
  if lower == "unknown" or lower == "unknown entity" or lower == "nil" then
    first = ""
  end
  local firstName, lastName = first, ""
  if first:find("%s") then
    local a, b = first:match("^(%S+)%s+(.+)$")
    firstName, lastName = a or first, b or ""
    -- If UnitName also returned a surname token and first already had both parts, keep split.
  elseif second ~= "" then
    -- Forever: second return is surname. Never treat as realm.
    firstName, lastName = first, second
  else
    firstName, lastName = first, ""
  end
  local full = firstName
  if lastName ~= "" then
    full = firstName .. " " .. lastName
  end
  return full, realm, firstName, lastName
end

function fetchUnitNameParts(unit)
  local first, second
  if type(UnitNameUnmodified) == "function" then
    first, second = UnitNameUnmodified(unit)
  end
  if type(first) ~= "string" or first == "" then
    if type(UnitName) == "function" then
      first, second = UnitName(unit)
    end
  end
  if type(first) ~= "string" then
    first = ""
  end
  if type(second) ~= "string" then
    second = ""
  end
  -- Realm only from UnitFullName (name, realm) - not from UnitName's surname slot.
  local realmFromFull = ""
  if type(UnitFullName) == "function" then
    local fn, fr = UnitFullName(unit)
    if (type(first) ~= "string" or first == "") and type(fn) == "string" and fn ~= "" then
      first = fn
    end
    if type(fr) == "string" and fr ~= "" then
      realmFromFull = fr
    end
  end
  return first, second, realmFromFull
end

--- Forever-safe char key: full name (+ realm), never a first-name-only UnitName token.
function charKeyFromParts(fullName, realm)
  if type(fullName) ~= "string" or fullName == "" then
    return nil
  end
  if type(realm) == "string" and realm ~= "" then
    return fullName .. "-" .. realm
  end
  return fullName
end

--- Resolve current player name parts (GUID + Forever full name).
function resolvePlayerNameParts()
  local guid = UnitGUID and UnitGUID("player") or nil
  if type(guid) ~= "string" or guid == "" then
    guid = nil
  end
  local first, second, realmFromFull = fetchUnitNameParts("player")
  local realm = realmFromFull ~= "" and realmFromFull or realmLabel()
  local fullName, realmOut, firstName, lastName = parseForeverName(first, second, realm)
  if fullName == "" then
    return nil
  end
  return {
    guid = guid,
    fullName = fullName,
    firstName = firstName or "",
    lastName = lastName or "",
    realm = realmOut or "",
  }
end

function currentCharKey()
  local parts = resolvePlayerNameParts()
  if not parts then
    return nil
  end
  return charKeyFromParts(parts.fullName, parts.realm)
end

--- Exact identity key: full Forever name ("First Last"), realm suffix stripped.
function fullKey(raw)
  if type(raw) ~= "string" then
    return ""
  end
  local s = raw:match("^([^%-]*)") or raw
  s = s:gsub("%s+", " ")
  s = s:match("^%s*(.-)%s*$") or ""
  return string.lower(s)
end

function appendUniqueEvents(dest, src)
  if type(dest) ~= "table" or type(src) ~= "table" then
    return 0
  end
  local seen = {}
  for _, ev in ipairs(dest) do
    if ev and ev.id then
      seen[ev.id] = true
    end
  end
  local added = 0
  for _, ev in ipairs(src) do
    if ev and ev.id and not seen[ev.id] then
      dest[#dest + 1] = ev
      seen[ev.id] = true
      added = added + 1
    elseif ev and not ev.id then
      dest[#dest + 1] = ev
      added = added + 1
    end
  end
  return added
end

--- Strong identity for the currently logged-in character (no fuzzy first-token matching).
function currentPlayerIdentity()
  local parts = resolvePlayerNameParts()
  if not parts then
    return nil
  end
  return {
    guid = parts.guid,
    fullName = parts.fullName,
    firstName = parts.firstName,
    lastName = parts.lastName,
    realm = parts.realm,
    charKey = charKeyFromParts(parts.fullName, parts.realm),
  }
end

function namesEqual(a, b)
  if type(a) ~= "string" or type(b) ~= "string" or a == "" or b == "" then
    return false
  end
  return string.lower(a) == string.lower(b)
end

--- Conservative: migrate only with GUID match or exact unique full identity.
--- A first name is never a key for a surnamed Forever character.
function eventSafelyBelongsToPlayer(ev, player)
  if type(ev) ~= "table" or type(player) ~= "table" then
    return false
  end

  -- 1) GUID (strongest). A different GUID is a different character (deleted + recreated
  --    under the same name), even when the full name matches - leave it on the account store.
  if type(ev.guid) == "string" and ev.guid ~= "" and player.guid then
    return ev.guid == player.guid
  end

  -- 2) Exact full character name (+ realm when both sides have one) - only for GUID-less events.
  local evChar = ev.character
  if type(evChar) ~= "string" or evChar == "" then
    return false
  end
  if not namesEqual(evChar, player.fullName) then
    return false
  end
  -- Ambiguous short label: event is a single token but the live character has a surname.
  if not evChar:find("%s") and player.lastName ~= "" then
    return false
  end
  local evRealm = normalizeRealm(ev.realm)
  local pRealm = normalizeRealm(player.realm)
  if evRealm ~= "" and pRealm ~= "" and evRealm ~= pRealm then
    return false
  end
  return true
end

--- Schema-2 bucket keys: only exact Name-Realm / exact full name - never first-token / __legacy__.
function bucketSafelyBelongsToPlayer(bucketKey, player)
  if type(bucketKey) ~= "string" or bucketKey == "" or type(player) ~= "table" then
    return false
  end
  if bucketKey == "__legacy__" then
    return false
  end
  if player.charKey and namesEqual(bucketKey, player.charKey) then
    return true
  end
  if namesEqual(bucketKey, player.fullName) then
    -- Incomplete label: event is a single token but the live character has a surname.
    if not bucketKey:find("%s") and not bucketKey:find("%-") and player.lastName ~= "" then
      return false
    end
    return true
  end
  if player.fullName ~= "" and player.realm ~= "" then
    local alt = player.fullName .. "-" .. player.realm
    if namesEqual(bucketKey, alt) then
      return true
    end
  end
  return false
end

--- Drop obsolete account-level Push snapshots once CharDB owns the queue.
--- Keeps ambiguous pending leftovers for the collector.
function scrubStaleAccountPushState()
  ForeverLANDB = ForeverLANDB or {}
  if ForeverLANDB.export ~= nil then
    ForeverLANDB.export = nil
  end
  ForeverLANDB.last_flush_at = nil
  ForeverLANDB.last_flush_count = nil
  ForeverLANDB.version = ADDON_VERSION
  ForeverLANDB.schema = SV_SCHEMA
  ForeverLANDB.collection_mode = "local_first"
  if type(ForeverLANDB.pending) == "table" and #ForeverLANDB.pending == 0 then
    ForeverLANDB.pending = nil
  end
  if type(ForeverLANDB.characters) == "table" then
    for _, bucket in pairs(ForeverLANDB.characters) do
      if type(bucket) == "table" then
        bucket.export = nil
        bucket.last_flush_at = nil
        bucket.last_flush_count = nil
      end
    end
    if not next(ForeverLANDB.characters) then
      ForeverLANDB.characters = nil
    end
  end
end

function pendingIsArray(pending)
  return type(pending) == "table" and #pending > 0
end

--- Take events that safely belong to player out of a pending table (array or map).
--- Returns remaining pending (same shape), or nil if empty.
function splitPendingByPlayer(pending, player)
  if type(pending) ~= "table" then
    return {}, {}
  end
  local take, keep = {}, {}
  if pendingIsArray(pending) then
    for _, ev in ipairs(pending) do
      if eventSafelyBelongsToPlayer(ev, player) then
        take[#take + 1] = ev
      else
        keep[#keep + 1] = ev
      end
    end
    return take, keep
  end
  for _, ev in pairs(pending) do
    if type(ev) == "table" then
      if eventSafelyBelongsToPlayer(ev, player) then
        take[#take + 1] = ev
      else
        keep[#keep + 1] = ev
      end
    end
  end
  return take, keep
end

--- Reclaim this character's events from account pending + all characters{} buckets.
--- Safe to call repeatedly after migrated_from_account (short bucket keys left orphans before).
function reclaimAccountEventsForPlayer(db, player)
  if type(db) ~= "table" or type(player) ~= "table" then
    return
  end

  local chars = ForeverLANDB.characters
  if type(chars) == "table" then
    local removeKeys = {}
    for bucketKey, bucket in pairs(chars) do
      if type(bucket) == "table" then
        if bucketSafelyBelongsToPlayer(bucketKey, player) then
          if type(bucket.pending) == "table" then
            appendUniqueEvents(db.pending, bucket.pending)
          end
          if bucket.seq and (not db.seq or bucket.seq > db.seq) then
            db.seq = bucket.seq
          end
          if type(bucket.export) == "string" and bucket.export ~= "" and not db.export then
            db.export = bucket.export
            db.last_flush_at = bucket.last_flush_at
            db.last_flush_count = bucket.last_flush_count
          end
          removeKeys[#removeKeys + 1] = bucketKey
        else
          -- Short / foreign bucket key: still pull matching events by identity.
          local take, keep = splitPendingByPlayer(bucket.pending, player)
          if #take > 0 then
            appendUniqueEvents(db.pending, take)
          end
          if #keep == 0 then
            removeKeys[#removeKeys + 1] = bucketKey
          else
            bucket.pending = keep
          end
        end
      end
    end
    for _, k in ipairs(removeKeys) do
      chars[k] = nil
    end
  end

  if type(ForeverLANDB.pending) == "table" then
    local take, keep = splitPendingByPlayer(ForeverLANDB.pending, player)
    if #take > 0 then
      appendUniqueEvents(db.pending, take)
    end
    ForeverLANDB.pending = (#keep > 0) and keep or nil
  end
end

--- Pull this character's events out of older account-wide ForeverLANDB shapes.
--- Ambiguous leftovers stay on the account file for the collector (never guessed).
function migrateAccountQueueIntoCharDB()
  local db = charStore()
  local player = currentPlayerIdentity()
  if not player then
    -- Cannot identify current character safely - retry on a later bind (do not set the flag).
    return
  end

  reclaimAccountEventsForPlayer(db, player)
  db.migrated_from_account = true
  ForeverLANDB.schema = SV_SCHEMA
  scrubStaleAccountPushState()
end

function persistCharStore()
  local db = charStore()
  db.pending = pending
  db.seq = seq
  db.dirty = #pending > 0
  db.version = ADDON_VERSION
  db.collection_mode = "local_first"
  db.schema = SV_SCHEMA
  db.character_key = activeCharKey
  db.updatedAt = time()
  if snapshotSessionTotals then
    snapshotSessionTotals(db)
  end
  ForeverLANDB.schema = SV_SCHEMA
  ForeverLANDB.version = ADDON_VERSION
  ForeverLANDB.collection_mode = "local_first"
  ForeverLANDB.active_character = activeCharKey
end

function flushMeta()
  local db = charStore()
  return {
    last_flush_at = tonumber(db.last_flush_at) or 0,
    last_flush_count = tonumber(db.last_flush_count) or 0,
    export = type(db.export) == "string" and db.export or nil,
  }
end

function rebuildPendingIndex()
  wipe(pendingById)
  for _, ev in ipairs(pending) do
    if ev and ev.id then
      pendingById[ev.id] = true
    end
  end
end

-- Forward declarations: bind runs before the trim helpers are assigned.

function bindActiveCharacter()
  local key = currentCharKey()
  activeCharKey = key
  local db = charStore()
  -- Migrate only when we can identify the player; then persist CharDB (incl. migrated flag).
  migrateAccountQueueIntoCharDB()
  pending = db.pending
  if type(pending) ~= "table" then
    pending = {}
    db.pending = pending
  end
  seq = tonumber(db.seq) or 0
  rebuildPendingIndex()
  if trimPendingOverCap then
    trimPendingOverCap()
  end
  if pruneFlushedLowValuePending then
    pruneFlushedLowValuePending()
  end
  if restorePersistedTotals then
    restorePersistedTotals()
  end
  persistCharStore()
  return key ~= nil
end
