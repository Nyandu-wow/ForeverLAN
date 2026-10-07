--[[
  Forever LAN

  Offline-first character telemetry for a local Forever leveling LAN.
  Queues events in SavedVariables. Does not use the network.

  ForeverLANDB     - account settings
  ForeverLANCharDB - per-character pending queue (schema 3)

  Push LAN writes SavedVariables to disk (reload), then an optional external
  companion may read that file. LoggingCombat(true) and CopyToClipboard are
  never called (protected on Forever).
]]

local ADDON_NAME = ...
local ADDON_VERSION = "0.1.68"
local SV_SCHEMA = 3
-- Optional friend-pack inject (ForeverLAN_Party.lua). CurseForge ships empty.
local BUILTIN_ROSTER = (ForeverLAN_Party and ForeverLAN_Party.roster) or {}
local BUILTIN_ALIASES = (ForeverLAN_Party and ForeverLAN_Party.aliases) or {}
local PREFIX = "FOREVERLAN_CLIP|"
local MAX_PENDING = 1500
-- Prefer dropping these when the queue is full.
local DROP_UNDER_PRESSURE = {
  PLAYER_DISTANCE = true,
  PLAYER_FOOD_BUFF = true,
  PLAYER_MAP_OPENED = true,
  PLAYER_POWER_STATS = true,
  PLAYER_MONEY = true,
  PLAYER_QUESTS = true,
  PLAYER_PROFESSIONS = true,
  PLAYER_COMBAT_TIME = true,
  PLAYER_CRAFT = true,
  PING = true,
  WORLD_ENTER = true,
  POSITION_UPDATE = true,
}
-- Keep one pending row per type+guid (+ map_kind). Crafts stay one-per-action.
local COALESCE_PENDING = {
  PLAYER_DISTANCE = true,
  PLAYER_FOOD_BUFF = true,
  PLAYER_MAP_OPENED = true,
  PLAYER_POWER_STATS = true,
  PLAYER_MONEY = true,
  PLAYER_QUESTS = true,
  PLAYER_PROFESSIONS = true,
  PLAYER_COMBAT_TIME = true,
  PING = true,
  WORLD_ENTER = true,
  POSITION_UPDATE = true,
}
local ROSTER_POLL = 4.0
local SELF_POLL = 8.0
local TRAVEL_POLL = 2.0
local MAX_STEP_YARDS = 80
local MIN_STEP_YARDS = 0.4
local DISTANCE_EMIT_YARDS = 120
local JUMP_EMIT_EVERY = 8

local SETTINGS_DEFAULTS = {
  show_push_button = true,
  lock_push_button = false,
  announce_events = false,
  startup_hints = false,
  push_reminders = true,
  show_minimap_button = false,
}

-- Account-wide (settings + migration leftovers).
ForeverLANDB = ForeverLANDB or {}
-- Per-character telemetry queue (WoW writes a separate SV file per character).
ForeverLANCharDB = ForeverLANCharDB or {}

-- One table for UI forwards - keeps the main chunk under WoW's 200-local limit.
local ui = {
  settingsCategory = nil,
  flushBtn = nil,
  dock = nil,
  minimapBtn = nil,
  optionsFrame = nil,
  applyUiSettings = nil,
  refreshPushButton = nil,
  openOptionsPanel = nil,
  doPushLan = nil,
  positionMinimapButton = nil,
  printHelp = nil,
  printStatus = nil,
}

local function ensureSettings()
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

local function setting(key)
  local s = ensureSettings()
  if s[key] == nil then
    return SETTINGS_DEFAULTS[key]
  end
  return s[key]
end

local function setSetting(key, value)
  ensureSettings()[key] = value and true or false
  if ui.applyUiSettings then
    ui.applyUiSettings()
  end
end

-- ---------------------------------------------------------------------------
-- Per-character store (ForeverLANCharDB) - schema 3
-- ---------------------------------------------------------------------------
local activeCharKey = nil
local seq = 0
local pending = {}
local pendingById = {}

local function charStore()
  ForeverLANCharDB = ForeverLANCharDB or {}
  if type(ForeverLANCharDB.pending) ~= "table" then
    ForeverLANCharDB.pending = {}
  end
  return ForeverLANCharDB
end

local function realmLabel()
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

local function normalizeRealm(raw)
  if type(raw) ~= "string" then
    return ""
  end
  return (raw:gsub("%s+", "")):lower()
end

--- Forever names are always "First Last". That convention leads.
--- UnitName / UnitNameUnmodified second return is the surname - never the realm.
--- Realm comes from UnitFullName's second return or GetNormalizedRealmName.
local function parseForeverName(first, second, realm)
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

local function fetchUnitNameParts(unit)
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
local function charKeyFromParts(fullName, realm)
  if type(fullName) ~= "string" or fullName == "" then
    return nil
  end
  if type(realm) == "string" and realm ~= "" then
    return fullName .. "-" .. realm
  end
  return fullName
end

--- Resolve current player name parts (GUID + Forever full name).
local function resolvePlayerNameParts()
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

local function currentCharKey()
  local parts = resolvePlayerNameParts()
  if not parts then
    return nil
  end
  return charKeyFromParts(parts.fullName, parts.realm)
end

--- Exact identity key: full Forever name ("First Last"), realm suffix stripped.
local function fullKey(raw)
  if type(raw) ~= "string" then
    return ""
  end
  local s = raw:match("^([^%-]*)") or raw
  s = s:gsub("%s+", " ")
  s = s:match("^%s*(.-)%s*$") or ""
  return string.lower(s)
end

local function appendUniqueEvents(dest, src)
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
local function currentPlayerIdentity()
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

local function namesEqual(a, b)
  if type(a) ~= "string" or type(b) ~= "string" or a == "" or b == "" then
    return false
  end
  return string.lower(a) == string.lower(b)
end

--- Conservative: migrate only with GUID match or exact unique full identity.
--- A first name is never a key for a surnamed Forever character.
local function eventSafelyBelongsToPlayer(ev, player)
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
local function bucketSafelyBelongsToPlayer(bucketKey, player)
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
local function scrubStaleAccountPushState()
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

local function pendingIsArray(pending)
  return type(pending) == "table" and #pending > 0
end

--- Take events that safely belong to player out of a pending table (array or map).
--- Returns remaining pending (same shape), or nil if empty.
local function splitPendingByPlayer(pending, player)
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
local function reclaimAccountEventsForPlayer(db, player)
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
local function migrateAccountQueueIntoCharDB()
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

local function persistCharStore()
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

local function flushMeta()
  local db = charStore()
  return {
    last_flush_at = tonumber(db.last_flush_at) or 0,
    last_flush_count = tonumber(db.last_flush_count) or 0,
    export = type(db.export) == "string" and db.export or nil,
  }
end

local function rebuildPendingIndex()
  wipe(pendingById)
  for _, ev in ipairs(pending) do
    if ev and ev.id then
      pendingById[ev.id] = true
    end
  end
end

-- Forward declarations: bind runs before the trim helpers are assigned.
local trimPendingOverCap
local pruneFlushedLowValuePending
local pendingFullyFlushedToDisk
local restorePersistedTotals
local snapshotSessionTotals

local function bindActiveCharacter()
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

local enteredWorld = false
local playerGUID = nil
local hintShown = false
local combatLogHintShown = false
local lastPushRemindAt = 0
local lastQueueCapRemindAt = 0
local lastCombatLogRemindAt = 0
local combatLogRemindCount = 0
local PUSH_REMIND_SEC = 720 -- 12 min between push nudges
local QUEUE_CAP_REMIND_SEC = 180 -- 3 min between queue-full nudges (gentler spam guard)
local QUEUE_SOFT_WARN = 1200 -- ~80% of MAX_PENDING
local COMBATLOG_REMIND_SEC = 900 -- 15 min between combat-log nudges
local COMBATLOG_REMIND_MAX = 3 -- per session
-- Set while Push LAN triggers C_UI.Reload so LOGOUT does not mark the board Offline.
local pushingLan = false

local tracked = {}
local lastInstanceState = nil
local lastInstanceName = ""

-- Self-only session probes (professions / quests / food / distance)
local lastProfKey = nil
local lastQuestCompleted = nil
local lastFoodKey = nil
local lastPowerKey = nil
local lastMoneyCopper = nil
local mapOpens = 0
local minimapOpens = 0
local lastMapOpensEmitted = -1
local lastMinimapOpensEmitted = -1
local worldMapHooked = false
local minimapHooked = false
local jumpHooked = false
local travel = {
  yards = 0,
  jumps = 0,
  last_x = nil,
  last_y = nil,
  last_z = nil,
  last_instance = nil,
  emitted_yards = 0,
  emitted_jumps = 0,
}
local combat = {
  entered_at = nil,
  seconds = 0,
  emitted = 0,
}

local restoredTotals = false

restorePersistedTotals = function()
  if restoredTotals then
    return
  end
  restoredTotals = true
  local db = charStore()
  travel.yards = tonumber(db.travel_yards) or travel.yards or 0
  travel.jumps = tonumber(db.travel_jumps) or travel.jumps or 0
  travel.emitted_yards = travel.yards
  travel.emitted_jumps = travel.jumps
  combat.seconds = tonumber(db.combat_seconds) or combat.seconds or 0
  combat.emitted = combat.seconds
  mapOpens = tonumber(db.map_opens) or mapOpens or 0
  minimapOpens = tonumber(db.minimap_opens) or minimapOpens or 0
  lastMapOpensEmitted = mapOpens
  lastMinimapOpensEmitted = minimapOpens
end

snapshotSessionTotals = function(db)
  db.travel_yards = travel.yards
  db.travel_jumps = travel.jumps
  db.combat_seconds = combat.seconds
  db.map_opens = mapOpens
  db.minimap_opens = minimapOpens
end

local snapshotUnit -- forward decl for emitSelfTelemetry

-- Remembered LAN names: builtins (friend pack) + ForeverLANDB.settings (user /fl remember).
local rosterKeys = {}
local rosterAliases = {}

local function rebuildRosterIndex()
  wipe(rosterKeys)
  wipe(rosterAliases)
  local function addName(n)
    local key = fullKey(tostring(n))
    if key ~= "" then
      rosterKeys[key] = true
    end
  end
  local function addAlias(bare, full)
    if type(bare) ~= "string" or type(full) ~= "string" then
      return
    end
    local bk = string.lower((bare:match("^%s*([^%s%-]+)") or bare))
    if bk ~= "" and fullKey(full) ~= "" then
      rosterAliases[bk] = full
    end
  end
  for _, n in ipairs(BUILTIN_ROSTER) do
    addName(n)
  end
  for bare, full in pairs(BUILTIN_ALIASES) do
    addAlias(bare, full)
  end
  local s = ForeverLANDB and ForeverLANDB.settings
  if s and type(s.remembered_roster) == "table" then
    for _, n in ipairs(s.remembered_roster) do
      addName(n)
    end
  end
  if s and type(s.remembered_aliases) == "table" then
    for bare, full in pairs(s.remembered_aliases) do
      addAlias(bare, full)
    end
  end
end

local function rememberedRosterList()
  local out, seen = {}, {}
  local function push(n)
    local key = fullKey(tostring(n))
    if key ~= "" and not seen[key] then
      seen[key] = true
      out[#out + 1] = tostring(n)
    end
  end
  for _, n in ipairs(BUILTIN_ROSTER) do
    push(n)
  end
  local s = ForeverLANDB and ForeverLANDB.settings
  if s and type(s.remembered_roster) == "table" then
    for _, n in ipairs(s.remembered_roster) do
      push(n)
    end
  end
  table.sort(out)
  return out
end

local function rememberLanName(fullName)
  fullName = type(fullName) == "string" and fullName:gsub("^%s+", ""):gsub("%s+$", "") or ""
  if fullName == "" or not fullName:find("%s") then
    return false, "Use Forever full name: First Last"
  end
  local s = ensureSettings()
  s.remembered_roster = s.remembered_roster or {}
  local key = fullKey(fullName)
  for _, n in ipairs(s.remembered_roster) do
    if fullKey(n) == key then
      rebuildRosterIndex()
      return true, "already remembered"
    end
  end
  s.remembered_roster[#s.remembered_roster + 1] = fullName
  rebuildRosterIndex()
  return true, "remembered"
end

local function forgetLanName(fullName)
  fullName = type(fullName) == "string" and fullName:gsub("^%s+", ""):gsub("%s+$", "") or ""
  if fullName == "" then
    return false, "Usage: /fl forget First Last"
  end
  local s = ensureSettings()
  s.remembered_roster = s.remembered_roster or {}
  local key = fullKey(fullName)
  local kept = {}
  for _, n in ipairs(s.remembered_roster) do
    if fullKey(n) ~= key then
      kept[#kept + 1] = n
    end
  end
  s.remembered_roster = kept
  if type(s.remembered_aliases) == "table" then
    for bare, full in pairs(s.remembered_aliases) do
      if fullKey(full) == key then
        s.remembered_aliases[bare] = nil
      end
    end
  end
  rebuildRosterIndex()
  return true, "forgot"
end

local function isRememberedLanName(name)
  local key = fullKey(name)
  if key ~= "" and rosterKeys[key] == true then
    return true
  end
  -- Bare first-name alias only when explicitly configured (never fuzzy).
  local alias = rosterAliases[key]
  if type(alias) == "string" then
    local ak = fullKey(alias)
    return ak ~= "" and rosterKeys[ak] == true
  end
  return false
end

--- Party GUIDs whose ForeverLAN said hello over addon comms (guid -> version).
local addonGuids = {}

-- Played character always syncs. Party members sync when they run ForeverLAN
-- (hello by GUID) or their exact full name is on the remembered roster.
local function shouldSyncCharacter(name, isSelf, guid)
  if isSelf then
    return true
  end
  if guid and guid ~= "" and addonGuids[guid] then
    return true
  end
  return isRememberedLanName(name)
end

local lastPlayingKey = nil

local function now()
  return time()
end

local function nextId()
  seq = seq + 1
  local guid = playerGUID or UnitGUID("player") or "unknown"
  return string.format("%s-%d-%d", guid, now(), seq)
end

local function jsonEscape(s)
  s = tostring(s)
  s = s:gsub("\\", "\\\\")
  s = s:gsub('"', '\\"')
  s = s:gsub("\n", "\\n")
  s = s:gsub("\r", "\\r")
  s = s:gsub("\t", "\\t")
  return s
end

local function jsonValue(v)
  local t = type(v)
  if v == nil then
    return "null"
  elseif t == "boolean" then
    return v and "true" or "false"
  elseif t == "number" then
    return tostring(v)
  elseif t == "string" then
    return '"' .. jsonEscape(v) .. '"'
  elseif t == "table" then
    if #v > 0 or next(v) == nil then
      local parts = {}
      for i = 1, #v do
        parts[i] = jsonValue(v[i])
      end
      return "[" .. table.concat(parts, ",") .. "]"
    else
      local parts = {}
      for k, val in pairs(v) do
        parts[#parts + 1] = '"' .. jsonEscape(k) .. '":' .. jsonValue(val)
      end
      return "{" .. table.concat(parts, ",") .. "}"
    end
  end
  return "null"
end

-- Keep SavedVariables lean in memory: pending table only.
-- The giant JSON export string is built ONLY on logout / Push LAN (disk write).
local function touchPending()
  if not activeCharKey then
    bindActiveCharacter()
  end
  persistCharStore()
  -- Drop stale export once new events arrive after a flush (pending is source of truth again).
  if #pending > 0 then
    local db = charStore()
    db.export = nil
  end
end

local function buildExportString()
  return PREFIX .. jsonValue({ events = pending })
end

-- Prefer dropping noisy telemetry over dings / deaths / login when the queue is full.
-- Returns how many events were dropped this call (0 if under cap).
trimPendingOverCap = function()
  local dropped = 0
  local flushedAt = flushMeta().last_flush_at
  while #pending > MAX_PENDING do
    local dropIdx = nil
    -- Already-flushed rows are on disk / in the collector; drop those first.
    if flushedAt > 0 then
      for i = 1, #pending do
        local ts = tonumber(pending[i] and pending[i].ts) or 0
        if ts > 0 and ts <= flushedAt then
          dropIdx = i
          break
        end
      end
    end
    if not dropIdx then
      for i = 1, #pending do
        local t = pending[i] and pending[i].type
        if t and DROP_UNDER_PRESSURE[t] then
          dropIdx = i
          break
        end
      end
    end
    if not dropIdx then
      dropIdx = 1
    end
    local gone = table.remove(pending, dropIdx)
    if gone and gone.id then
      pendingById[gone.id] = nil
    end
    dropped = dropped + 1
  end
  if dropped > 0 then
    local db = charStore()
    db.dropped_total = (tonumber(db.dropped_total) or 0) + dropped
  end
  return dropped
end

--- True when every queued event is already covered by the last Push/logout snapshot.
pendingFullyFlushedToDisk = function()
  local flushedAt = flushMeta().last_flush_at
  if flushedAt <= 0 or #pending == 0 then
    return false
  end
  for _, ev in ipairs(pending) do
    local ts = tonumber(ev and ev.ts) or 0
    if ts > flushedAt then
      return false
    end
  end
  return true
end

--- After a successful Push, drop flushed low-value noise from RAM (still in export on disk).
--- Keeps high-signal + anything newer than the flush. No soft-warn floor - prune all matching noise.
pruneFlushedLowValuePending = function()
  local flushedAt = flushMeta().last_flush_at
  if flushedAt <= 0 or #pending == 0 then
    return 0
  end
  local dropped = 0
  local i = 1
  while i <= #pending do
    local ev = pending[i]
    local ts = tonumber(ev and ev.ts) or 0
    local t = ev and ev.type
    if t and DROP_UNDER_PRESSURE[t] and ts <= flushedAt then
      if ev.id then
        pendingById[ev.id] = nil
      end
      table.remove(pending, i)
      dropped = dropped + 1
    else
      i = i + 1
    end
  end
  if dropped > 0 then
    persistCharStore()
  end
  return dropped
end

local function chat(msg)
  DEFAULT_CHAT_FRAME:AddMessage("|cff7ad1ff[ForeverLAN]|r " .. tostring(msg))
end

--- Gentle nudge when the local queue is near/at capacity (host may be offline).
local function maybeRemindQueuePressure(droppedCount)
  if not enteredWorld or not setting("push_reminders") then
    return
  end
  if UnitAffectingCombat and UnitAffectingCombat("player") then
    return
  end
  if InCombatLockdown and InCombatLockdown() then
    return
  end
  -- Push already wrote everything currently queued - do not nag again.
  if pendingFullyFlushedToDisk() then
    return
  end
  local n = #pending
  local hittingCap = (droppedCount or 0) > 0 or n >= MAX_PENDING
  local softWarn = n >= QUEUE_SOFT_WARN
  if not hittingCap and not softWarn then
    return
  end
  local t = now()
  local gap = hittingCap and math.floor(QUEUE_CAP_REMIND_SEC / 2) or QUEUE_CAP_REMIND_SEC
  if lastQueueCapRemindAt > 0 and (t - lastQueueCapRemindAt) < gap then
    return
  end
  lastQueueCapRemindAt = t
  lastPushRemindAt = t -- don't stack with the normal push nudge immediately after
  if hittingCap then
    chat(
      string.format(
        "Queue full (%d/%d) - click |cffffffffFL|r or logout.",
        n,
        MAX_PENDING
      )
    )
    chat(
      "If you don't, Forever LAN starts dropping older/low-value events so dings and deaths still fit. Nothing is sent to the board until you Push or log out."
    )
  else
    chat(
      string.format(
        "Queue getting full (%d/%d) - click |cffffffffFL|r when you can.",
        n,
        MAX_PENDING
      )
    )
  end
end

local function persistPending()
  touchPending()
end

local function clearPendingBuffer()
  -- Not used by Push LAN (pending is retained on purpose).
  -- Kept for rare operator/debug clears if ever needed.
  wipe(pendingById)
  for i = #pending, 1, -1 do
    pending[i] = nil
  end
  persistCharStore()
end

-- SavedVariables only hit disk on logout or UI reload (hardware event).
-- Push LAN / logout: build export snapshot for the collector. Do NOT clear pending -
-- a second crash/reload must not erase events before the collector has seen them.
-- Push button badge uses last_flush_at so it still resets after a successful flush.
local function saveForCollector()
  if not activeCharKey then
    bindActiveCharacter()
  end
  local n = #pending
  local exportStr = buildExportString()
  local ts = now()
  local db = charStore()
  db.export = exportStr
  db.last_flush_at = ts
  db.last_flush_count = n
  persistCharStore()
  -- Do not prune here: PLAYER_LOGOUT can still enqueue (combat-time) and would
  -- clear export via touchPending, leaving pruned crafts only in vanished RAM.
  return n
end

-- Snapshot + keep pending (alias kept for call sites / mental model).
local function flushForPush()
  return saveForCollector()
end

local function reloadForCollector()
  if C_UI and C_UI.Reload then
    C_UI.Reload()
  elseif ReloadUI then
    ReloadUI()
  else
    DEFAULT_CHAT_FRAME:AddMessage(
      "|cff7ad1ff[ForeverLAN]|r Could not reload UI - type |cffffffff/reload|r manually."
    )
  end
end

local function isCombatLogging()
  if not LoggingCombat then
    return nil
  end
  local ok, a, b = pcall(LoggingCombat)
  if not ok then
    return nil
  end
  -- Classic returns boolean; some builds return 1/0 or (combat, advanced).
  if a == true or a == 1 then
    return true
  end
  if a == false or a == 0 or a == nil then
    return false
  end
  if b == true or b == 1 then
    return true
  end
  return not not a
end

-- Forever LoggingCombat() is sometimes wrong, but when it clearly says OFF we
-- must not stick "already on" forever (that blocked right-click while /combatlog
-- still worked). Sticky ON is only used when the API is unreadable, and only
-- after a CHAT_MSG_SYSTEM enable confirmation.
local function setCombatLogUiOn(on)
  ForeverLANDB = ForeverLANDB or {}
  ForeverLANDB.combat_log_on = on and true or false
end

local function combatLogUiOn()
  local live = isCombatLogging()
  if live == true then
    setCombatLogUiOn(true)
    return true
  end
  if live == false then
    if ForeverLANDB and ForeverLANDB.combat_log_on then
      setCombatLogUiOn(false)
    end
    return false
  end
  -- API nil/unreadable: trust sticky only if we saw an enable system message.
  return ForeverLANDB and ForeverLANDB.combat_log_on and true or false
end

local function combatLogStatusLabel()
  local live = isCombatLogging()
  if live == true then
    return "on"
  end
  if live == false then
    return "off"
  end
  if ForeverLANDB and ForeverLANDB.combat_log_on then
    return "on?"
  end
  return "off?"
end

local function recordCapabilities()
  local version, build, buildDate, tocVersion = nil, nil, nil, nil
  if GetBuildInfo then
    local ok, v, b, d, t = pcall(GetBuildInfo)
    if ok then
      version, build, buildDate, tocVersion = v, b, d, t
    end
  end
  ForeverLANDB.capabilities = {
    ts = now(),
    addon_version = ADDON_VERSION,
    game_version = version,
    game_build = build and tostring(build) or nil,
    game_build_date = buildDate,
    toc_version = tocVersion,
    LoggingCombat_read = LoggingCombat ~= nil,
    combat_logging = isCombatLogging(),
    C_UI_Reload = C_UI ~= nil and C_UI.Reload ~= nil,
    C_ChatInfo = C_ChatInfo ~= nil,
    SendAddonMessage = C_ChatInfo ~= nil and C_ChatInfo.SendAddonMessage ~= nil,
    -- Presence of the global only - calling CopyToClipboard may still Action Block.
    CopyToClipboard = CopyToClipboard ~= nil,
    GetProfessions = GetProfessions ~= nil,
    GetProfessionInfo = GetProfessionInfo ~= nil,
    GetNumSkillLines = GetNumSkillLines ~= nil,
    GetSkillLineInfo = GetSkillLineInfo ~= nil,
    GetQuestsCompleted = GetQuestsCompleted ~= nil,
    GetNumQuestLogEntries = GetNumQuestLogEntries ~= nil,
    UnitBuff = UnitBuff ~= nil,
    UnitAura = UnitAura ~= nil,
    UnitPosition = UnitPosition ~= nil,
    UnitAttackPower = UnitAttackPower ~= nil,
    UnitRangedAttackPower = UnitRangedAttackPower ~= nil,
    GetSpellBonusDamage = GetSpellBonusDamage ~= nil,
    GetSpellBonusHealing = GetSpellBonusHealing ~= nil,
    GetMoney = GetMoney ~= nil,
    WorldMapFrame = WorldMapFrame ~= nil,
    Minimap = Minimap ~= nil,
  }
end

local function showCombatLogHint()
  if combatLogHintShown or not setting("startup_hints") then
    return
  end
  combatLogHintShown = true
  lastCombatLogRemindAt = now() -- first follow-up wait starts after this tip
  local on = combatLogUiOn()
  if on == true then
    chat("Combat log ON - kills/zones stream live (no Push needed for those).")
  else
    chat(
      "Combat log is a status line. Click it once if it says off. Do not click it again."
    )
  end
end

local function findCoalesceTarget(eventType, fields)
  if not COALESCE_PENDING[eventType] then
    return nil
  end
  local guid = fields and fields.guid
  if type(guid) ~= "string" or guid == "" then
    return nil
  end
  local mapKind = fields and fields.map_kind
  local flushedAt = flushMeta().last_flush_at
  for i = #pending, 1, -1 do
    local ev = pending[i]
    if ev and ev.type == eventType and ev.guid == guid then
      -- Already covered by last Push/logout - mint a new row (new id + ts) so the
      -- host gets the update and the pin can show unsaved again.
      local evTs = tonumber(ev.ts) or 0
      if flushedAt > 0 and evTs <= flushedAt then
        return nil
      end
      if eventType == "PLAYER_MAP_OPENED" then
        if ev.map_kind == mapKind then
          return ev
        end
      else
        return ev
      end
    end
  end
  return nil
end

local function enqueue(eventType, fields, opts)
  opts = opts or {}
  -- Update the latest unflushed snapshot in place (keep id; refresh ts).
  local existing = findCoalesceTarget(eventType, fields)
  if existing then
    if fields then
      -- Snapshot replace: Lua omits nil keys, so a food-buff end would otherwise
      -- keep the previous food_buff string on the coalesced row.
      local keep = {
        v = true,
        id = true,
        source = true,
        type = true,
        guid = true,
        ts = true,
        character = true,
        realm = true,
        class = true,
        is_self = true,
        honesty = true,
        unit = true,
        has_addon = true,
      }
      for k, _ in pairs(existing) do
        if not keep[k] and fields[k] == nil then
          existing[k] = nil
        end
      end
      for k, v in pairs(fields) do
        existing[k] = v
      end
    end
    existing.ts = now()
    if not existing.is_self and type(existing.guid) == "string" and addonGuids[existing.guid] then
      existing.has_addon = true
    end
    touchPending()
    if ui.refreshPushButton then
      ui.refreshPushButton()
    end
    return existing
  end

  local event = {
    v = 1,
    id = nextId(),
    ts = now(),
    type = eventType,
    source = "addon",
  }
  if fields then
    for k, v in pairs(fields) do
      event[k] = v
    end
  end
  if not event.is_self and type(event.guid) == "string" and addonGuids[event.guid] then
    event.has_addon = true
  end

  if pendingById[event.id] then
    return event
  end
  pendingById[event.id] = true
  pending[#pending + 1] = event
  local dropped = trimPendingOverCap()
  touchPending()
  maybeRemindQueuePressure(dropped)
  -- Chat only when explicitly requested AND announcements are enabled.
  if opts.silent == false and setting("announce_events") then
    local label = event.character or event.unit or "?"
    local lvl = event.level and (" L" .. tostring(event.level)) or ""
    local pretty = ({
      LOGIN = "Logged in",
      PLAYER_LEVEL_CHANGED = "Ding",
      PLAYER_DIED = "Died",
      PLAYER_RESURRECTED = "Resurrected",
      PLAYER_DETECTED = "Detected",
    })[eventType] or eventType
    DEFAULT_CHAT_FRAME:AddMessage(
      string.format("|cff7ad1ff[ForeverLAN]|r %s - %s%s", pretty, label, lvl)
    )
  end
  if ui.refreshPushButton then
    ui.refreshPushButton()
  end
  return event
end

local function showLoadHint()
  if hintShown or not setting("startup_hints") then
    return
  end
  hintShown = true
  chat(
    "v" ..
      ADDON_VERSION ..
      " collecting - |cffffffff/fl|r - Push writes disk - combat log line is click-once"
  )
end

--- Forever first+last name for any unit (player or party).
local function splitNameRealm(unit)
  local first, second, realmFromFull = fetchUnitNameParts(unit)
  local realm = realmFromFull ~= "" and realmFromFull or realmLabel()
  return parseForeverName(first, second, realm)
end

local function safeCall(fn, ...)
  if not fn then
    return nil
  end
  local results = { pcall(fn, ...) }
  local ok = table.remove(results, 1)
  if not ok then
    return nil
  end
  return unpack(results)
end

--- Single read door for Forever APIs. Call sites should not touch Unit*/C_Map raw.
--- One table keeps the main chunk under WoW's 200-local limit.
local api = { call = safeCall }

function api.exists(unit)
  if not unit or not UnitExists then
    return false
  end
  return UnitExists(unit) and true or false
end

function api.text(fn, ...)
  local v = api.call(fn, ...)
  if type(v) ~= "string" then
    return ""
  end
  return v
end

--- true/false from a unit predicate. On throw/nil, keep `fallback` (avoid fake deaths/offline).
function api.flag(fn, unit, fallback)
  local v = api.call(fn, unit)
  if v == nil then
    return fallback
  end
  return v and true or false
end

--- Forever can return "secret numbers" that taint arithmetic (SecretValues).
local function isPlainNumber(v)
  if type(v) ~= "number" then
    return false
  end
  if issecretvalue and issecretvalue(v) then
    return false
  end
  if canaccessvalue and not canaccessvalue(v) then
    return false
  end
  return true
end

local function plainNumber(v)
  if isPlainNumber(v) then
    return v
  end
  return nil
end

--- Forever can also mark chat / system text as a secret string; comparing it while
--- tainted throws ("attempt to compare ... a secret string value").
local function isPlainString(v)
  if type(v) ~= "string" then
    return false
  end
  if issecretvalue and issecretvalue(v) then
    return false
  end
  if canaccessvalue and not canaccessvalue(v) then
    return false
  end
  return true
end

--- Sum plain numbers; nil terms count as 0. Any secret term -> nil (blocked).
local function sumPlain(...)
  local total = 0
  local n = select("#", ...)
  for i = 1, n do
    local raw = select(i, ...)
    if raw ~= nil then
      local v = plainNumber(raw)
      if v == nil then
        return nil
      end
      total = total + v
    end
  end
  return total
end

local function maxPlain(a, b)
  local pa, pb = plainNumber(a), plainNumber(b)
  if pa == nil then
    return pb
  end
  if pb == nil then
    return pa
  end
  if pa > pb then
    return pa
  end
  return pb
end

api.num = plainNumber

--- Primary + secondary professions for the local player only.
local function readProfessions()
  local list = {}
  local method = "unavailable"

  if GetProfessions and GetProfessionInfo then
    local p1, p2, _arch, fish, cook, firstAid = safeCall(GetProfessions)
    local function add(idx, kind)
      if not idx then
        return
      end
      local name, _icon, rank, maxRank = safeCall(GetProfessionInfo, idx)
      if name and rank ~= nil then
        list[#list + 1] = {
          name = name,
          rank = rank or 0,
          max_rank = maxRank or 0,
          kind = kind,
        }
      end
    end
    add(p1, "primary")
    add(p2, "primary")
    add(fish, "fishing")
    add(cook, "cooking")
    add(firstAid, "first_aid")
    if #list > 0 then
      method = "GetProfessions"
    end
  end

  if #list == 0 and GetNumSkillLines and GetSkillLineInfo then
    local n = safeCall(GetNumSkillLines) or 0
    local section = nil
    for i = 1, n do
      local name, header, _, rank, _, _, maxRank = safeCall(GetSkillLineInfo, i)
      if header then
        if name == "Professions" then
          section = "primary"
        elseif name == "Secondary Skills" then
          section = "secondary"
        else
          section = nil
        end
      elseif section and name and type(rank) == "number" and type(maxRank) == "number" and maxRank > 0 then
        list[#list + 1] = {
          name = name,
          rank = rank,
          max_rank = maxRank,
          kind = section,
        }
      end
    end
    if #list > 0 then
      method = "GetSkillLineInfo"
    end
  end

  return list, method
end

local function professionsKey(list)
  local parts = {}
  for _, p in ipairs(list) do
    parts[#parts + 1] = string.format("%s:%d/%d", tostring(p.name), p.rank or 0, p.max_rank or 0)
  end
  table.sort(parts)
  return table.concat(parts, "|")
end

-- Optional /fl craftprobe: listen for craft/gather chat without enqueueing events.
local craftProbeFrame = nil
local craftProbeHits = nil
local craftProbeStopAt = 0

local function craftProbeIsSelfMessage(msg)
  if not isPlainString(msg) or msg == "" then
    return false
  end
  local lower = string.lower(msg)
  if string.find(lower, "^you[%s']") or string.find(lower, "^your%s") then
    return true
  end
  local function namePrefixMatch(name)
    if not name or name == "" then
      return false
    end
    local n = string.lower(name)
    if string.sub(lower, 1, #n) ~= n then
      return false
    end
    local nextChar = string.sub(lower, #n + 1, #n + 1)
    return nextChar == "" or nextChar == " " or nextChar == "-" or nextChar == "'"
  end
  -- Match the played full name only (never bare first name).
  return namePrefixMatch(splitNameRealm("player"))
end

local function craftProbeApiSnapshot()
  local hasCTrade = C_TradeSkillUI ~= nil
  return {
    GetProfessions = GetProfessions ~= nil,
    GetProfessionInfo = GetProfessionInfo ~= nil,
    GetSkillLineInfo = GetSkillLineInfo ~= nil,
    GetNumSkillLines = GetNumSkillLines ~= nil,
    GetNumTradeSkills = GetNumTradeSkills ~= nil,
    GetTradeSkillInfo = GetTradeSkillInfo ~= nil,
    GetTradeSkillItemLink = GetTradeSkillItemLink ~= nil,
    GetTradeSkillNumReagents = GetTradeSkillNumReagents ~= nil,
    C_TradeSkillUI = hasCTrade,
    C_TradeSkillUI_GetAllRecipeIDs = hasCTrade and C_TradeSkillUI.GetAllRecipeIDs ~= nil,
    C_TradeSkillUI_GetRecipeInfo = hasCTrade and C_TradeSkillUI.GetRecipeInfo ~= nil,
    C_TradeSkillUI_CraftRecipe = hasCTrade and C_TradeSkillUI.CraftRecipe ~= nil,
  }
end

local function stopCraftProbe(reason)
  if craftProbeFrame then
    craftProbeFrame:SetScript("OnEvent", nil)
    craftProbeFrame:SetScript("OnUpdate", nil)
    craftProbeFrame:UnregisterAllEvents()
  end
  craftProbeStopAt = 0
  local apis = craftProbeApiSnapshot()
  local hits = craftProbeHits or {}
  ForeverLANDB = ForeverLANDB or {}
  ForeverLANDB.craftProbe = {
    ts = now(),
    reason = reason or "done",
    version = ADDON_VERSION,
    apis = apis,
    hits = hits,
    hit_count = #hits,
  }
  print(string.format(
    "[ForeverLAN] craftprobe %s - %d chat hits (stored in SavedVariables; Push LAN to write disk)",
    tostring(reason or "done"),
    #hits
  ))
  if #hits == 0 then
    print("  No craft/gather lines seen. Try again while crafting or gathering.")
  end
  craftProbeHits = nil
end

local function startCraftProbe(seconds)
  seconds = tonumber(seconds) or 90
  if seconds < 15 then seconds = 15 end
  if seconds > 300 then seconds = 300 end

  local apis = craftProbeApiSnapshot()
  print("[ForeverLAN] craftprobe - listening only (does not enqueue events)")
  print(string.format(
    "  GetProfessions=%s GetProfessionInfo=%s GetSkillLineInfo=%s",
    tostring(apis.GetProfessions),
    tostring(apis.GetProfessionInfo),
    tostring(apis.GetSkillLineInfo)
  ))
  print(string.format(
    "  GetNumTradeSkills=%s GetTradeSkillInfo=%s C_TradeSkillUI=%s",
    tostring(apis.GetNumTradeSkills),
    tostring(apis.GetTradeSkillInfo),
    tostring(apis.C_TradeSkillUI)
  ))
  if apis.C_TradeSkillUI then
    print(string.format(
      "  C_TradeSkillUI GetAllRecipeIDs=%s GetRecipeInfo=%s CraftRecipe=%s",
      tostring(apis.C_TradeSkillUI_GetAllRecipeIDs),
      tostring(apis.C_TradeSkillUI_GetRecipeInfo),
      tostring(apis.C_TradeSkillUI_CraftRecipe)
    ))
  end

  craftProbeHits = {}
  if not craftProbeFrame then
    craftProbeFrame = CreateFrame("Frame", "ForeverLANCraftProbe")
  end
  craftProbeFrame:UnregisterAllEvents()
  local listen = {
    "CHAT_MSG_SKILL",
    "CHAT_MSG_LOOT",
    "CHAT_MSG_SYSTEM",
    "CHAT_MSG_TRADESKILLS",
    "CHAT_MSG_OPENING",
    "UNIT_SPELLCAST_SUCCEEDED",
  }
  for _, ev in ipairs(listen) do
    pcall(function()
      craftProbeFrame:RegisterEvent(ev)
    end)
  end
  craftProbeFrame:SetScript("OnEvent", function(_, event, ...)
    local a1, a2, a3 = ...
    local msg
    if event == "UNIT_SPELLCAST_SUCCEEDED" then
      if a1 ~= "player" then
        return
      end
      msg = string.format("unit=%s spell=%s", tostring(a1), tostring(a3 or a2))
    else
      -- Skip secret system/loot chat (same Forever taint path as combat-log watcher).
      if not isPlainString(a1) then
        return
      end
      msg = a1
      -- Forever TRADESKILLS chat is zone-wide ("Name creates Item.") - keep self only.
      if not craftProbeIsSelfMessage(msg) then
        return
      end
      if event == "CHAT_MSG_LOOT" or event == "CHAT_MSG_SYSTEM" then
        local lower = string.lower(msg)
        local interesting =
          string.find(lower, "creat", 1, true)
          or string.find(lower, "receiv", 1, true)
          or string.find(lower, "skill", 1, true)
          or string.find(lower, "gather", 1, true)
          or string.find(lower, "herb", 1, true)
          or string.find(lower, "mine", 1, true)
          or string.find(lower, "skin", 1, true)
          or string.find(lower, "craft", 1, true)
          or string.find(lower, "smelt", 1, true)
          or string.find(lower, "cook", 1, true)
        if not interesting then
          return
        end
      end
    end
    if #msg > 220 then
      msg = string.sub(msg, 1, 220) .. "..."
    end
    print("|cff66ff66[ForeverLAN] craftprobe HIT:|r " .. event .. " | " .. msg)
    if craftProbeHits then
      craftProbeHits[#craftProbeHits + 1] = {
        ts = now(),
        event = event,
        msg = msg,
        self_only = true,
      }
    end
  end)

  craftProbeStopAt = (GetTime and GetTime() or 0) + seconds
  if C_Timer and C_Timer.After then
    C_Timer.After(seconds, function()
      if craftProbeHits then
        stopCraftProbe("timer")
      end
    end)
  else
    craftProbeFrame:SetScript("OnUpdate", function(self)
      if not craftProbeHits then
        self:SetScript("OnUpdate", nil)
        return
      end
      if (GetTime and GetTime() or 0) >= craftProbeStopAt then
        self:SetScript("OnUpdate", nil)
        stopCraftProbe("timer")
      end
    end)
  end
  chat(string.format(
    "Craft probe on for %ds - craft or gather now. |cffffffff/fl craftprobe stop|r to finish.",
    seconds
  ))
end

--- Lifetime completed quests (self) + in-log counts.
local function readQuestProgress()
  local completed = 0
  local method = "unavailable"

  if GetQuestsCompleted then
    local t = safeCall(GetQuestsCompleted)
    if type(t) == "table" then
      for _ in pairs(t) do
        completed = completed + 1
      end
      method = "GetQuestsCompleted"
    end
  elseif C_QuestLog and C_QuestLog.GetAllCompletedQuestIDs then
    local ids = safeCall(C_QuestLog.GetAllCompletedQuestIDs)
    if type(ids) == "table" then
      completed = #ids
      method = "C_QuestLog.GetAllCompletedQuestIDs"
    end
  end

  local inLog, ready = 0, 0
  if GetNumQuestLogEntries and GetQuestLogTitle then
    local n = safeCall(GetNumQuestLogEntries) or 0
    for i = 1, n do
      local title, _level, _sg, isHeader, _col, isComplete = safeCall(GetQuestLogTitle, i)
      if title and not isHeader then
        inLog = inLog + 1
        if isComplete then
          ready = ready + 1
        end
      end
    end
  end

  return {
    completed = completed,
    in_log = inLog,
    ready_to_turn_in = ready,
    method = method,
  }
end

local function isFoodBuffName(name)
  if not name or name == "" then
    return false
  end
  local lower = string.lower(name)
  if lower == "well fed" or lower == "food" or lower == "drink" then
    return true
  end
  if string.find(lower, "well fed", 1, true) then
    return true
  end
  if string.find(lower, "fed", 1, true) and string.find(lower, "well", 1, true) then
    return true
  end
  return false
end

--- Active food/drink buff remaining time for the local player (party N/A).
local function readFoodBuff()
  if not UnitBuff then
    return nil, "UnitBuff_missing"
  end
  for i = 1, 40 do
    local name, _icon, _count, _debuffType, duration, expirationTime, _source, _steal, _np, spellId =
      safeCall(UnitBuff, "player", i)
    if not name then
      break
    end
    if isFoodBuffName(name) then
      local remaining = nil
      local exp = plainNumber(expirationTime)
      local dur = plainNumber(duration)
      local nowT = GetTime and plainNumber(GetTime()) or nil
      if exp and nowT and exp > 0 then
        remaining = math.max(0, exp - nowT)
      elseif dur and dur > 0 then
        remaining = dur
      end
      return {
        name = name,
        spell_id = spellId,
        duration_seconds = dur,
        remaining_seconds = remaining and math.floor(remaining + 0.5) or nil,
      }, "UnitBuff"
    end
  end
  return nil, "none"
end

local function sampleTravelDistance()
  if not UnitPosition then
    return travel.yards, "UnitPosition_missing"
  end
  local y, x, z, instanceId = safeCall(UnitPosition, "player")
  x = plainNumber(x)
  y = plainNumber(y)
  z = plainNumber(z) or 0
  instanceId = plainNumber(instanceId) or instanceId
  if x == nil or y == nil then
    return travel.yards, "no_position"
  end
  if type(instanceId) ~= "number" then
    instanceId = 0
  end

  if travel.last_x ~= nil and travel.last_instance == instanceId then
    local dx = x - travel.last_x
    local dy = y - travel.last_y
    local dz = z - (travel.last_z or 0)
    -- Guard: secret arithmetic throws; only run when all plain.
    if isPlainNumber(dx) and isPlainNumber(dy) and isPlainNumber(dz) then
      local step = math.sqrt(dx * dx + dy * dy + dz * dz)
      if isPlainNumber(step) and step >= MIN_STEP_YARDS and step <= MAX_STEP_YARDS then
        travel.yards = travel.yards + step
      end
    end
  end

  travel.last_x = x
  travel.last_y = y
  travel.last_z = z
  travel.last_instance = instanceId
  return travel.yards, "UnitPosition"
end

local function readCombatPower()
  local ok, result = pcall(function()
    local out = {
      attack_power = nil,
      ranged_attack_power = nil,
      spell_power = nil,
      spell_healing = nil,
      detection = "unavailable",
    }
    local methods = {}
    local blocked = false

    if UnitAttackPower then
      local base, pos, neg = safeCall(UnitAttackPower, "player")
      local effective = sumPlain(base, pos, neg)
      if effective ~= nil and base ~= nil then
        out.attack_power = math.max(0, effective)
        methods[#methods + 1] = "UnitAttackPower"
      elseif type(base) == "number" then
        blocked = true
      end
    end
    if UnitRangedAttackPower then
      local base, pos, neg = safeCall(UnitRangedAttackPower, "player")
      local effective = sumPlain(base, pos, neg)
      if effective ~= nil and base ~= nil then
        out.ranged_attack_power = math.max(0, effective)
        methods[#methods + 1] = "UnitRangedAttackPower"
      elseif type(base) == "number" then
        blocked = true
      end
    end
    if GetSpellBonusDamage then
      local maxSp = nil
      for school = 2, 7 do
        local raw = safeCall(GetSpellBonusDamage, school)
        local v = plainNumber(raw)
        if v ~= nil then
          maxSp = maxPlain(maxSp, v)
        elseif type(raw) == "number" then
          blocked = true
        end
      end
      if maxSp ~= nil then
        out.spell_power = maxSp
        methods[#methods + 1] = "GetSpellBonusDamage"
      end
    end
    if GetSpellBonusHealing then
      local raw = safeCall(GetSpellBonusHealing)
      local h = plainNumber(raw)
      if h ~= nil then
        out.spell_healing = h
        methods[#methods + 1] = "GetSpellBonusHealing"
      elseif type(raw) == "number" then
        blocked = true
      end
    end
    if #methods > 0 then
      out.detection = table.concat(methods, "+")
    elseif blocked then
      out.detection = "secret_blocked"
    end
    return out
  end)
  if ok and result then
    return result
  end
  return {
    attack_power = nil,
    ranged_attack_power = nil,
    spell_power = nil,
    spell_healing = nil,
    detection = "secret_blocked",
  }
end

local function powerKey(p)
  return string.format(
    "ap:%s|rap:%s|sp:%s|heal:%s",
    tostring(p.attack_power),
    tostring(p.ranged_attack_power),
    tostring(p.spell_power),
    tostring(p.spell_healing)
  )
end

local function readMoney()
  if not GetMoney then
    return nil, "GetMoney_missing"
  end
  local copper = plainNumber(safeCall(GetMoney))
  if copper == nil then
    return nil, "GetMoney_secret_or_failed"
  end
  return {
    copper = copper,
    gold = math.floor(copper / 10000),
    silver = math.floor((copper % 10000) / 100),
    copper_rem = copper % 100,
  }, "GetMoney"
end

-- Aura/money/quest/power fire in bursts; one full snapshot per second is enough.
-- Login / map / poll / skill lines stay immediate so the board does not wait.
-- One table (not three locals) - Forever's 200-local main-chunk ceiling.
local selfTelemetryGate = {
  gap = 1.0,
  lastAt = 0,
  immediate = {
    login = true,
    world_enter = true,
    skill_lines = true,
    jump = true,
    world_map = true,
    minimap = true,
    poll = true,
  },
}

local function emitSelfTelemetry(reason, opts)
  opts = opts or {}
  if not UnitExists("player") then
    return
  end
  local t = (GetTime and GetTime()) or 0
  if not selfTelemetryGate.immediate[reason or ""] then
    if (t - selfTelemetryGate.lastAt) < selfTelemetryGate.gap then
      return
    end
  end
  selfTelemetryGate.lastAt = t
  local snap = snapshotUnit("player", {}) or {}
  local silent = opts.silent ~= false

  local professions, profMethod = readProfessions()
  local pk = professionsKey(professions)
  if pk ~= lastProfKey and (#professions > 0 or lastProfKey ~= nil) then
    lastProfKey = pk
    enqueue("PLAYER_PROFESSIONS", {
      character = snap.character,
      realm = snap.realm,
      class = snap.class,
      guid = snap.guid,
      level = snap.level,
      is_self = true,
      professions = professions,
      detection = profMethod,
      reason = reason,
    }, { silent = silent })
  end

  local quests = readQuestProgress()
  if lastQuestCompleted == nil or quests.completed ~= lastQuestCompleted then
    local prev = lastQuestCompleted
    lastQuestCompleted = quests.completed
    if prev ~= nil or quests.completed > 0 or quests.in_log > 0 then
      enqueue("PLAYER_QUESTS", {
        character = snap.character,
        realm = snap.realm,
        class = snap.class,
        guid = snap.guid,
        level = snap.level,
        is_self = true,
        quests_completed = quests.completed,
        quests_in_log = quests.in_log,
        quests_ready = quests.ready_to_turn_in,
        detection = quests.method,
        reason = reason,
      }, { silent = silent })
    end
  end

  local food, foodMethod = readFoodBuff()
  local foodKey = food
      and string.format("%s:%s", tostring(food.name), tostring(food.remaining_seconds or "?"))
    or "none"
  local shouldFood = false
  if lastFoodKey == nil then
    shouldFood = food ~= nil
  elseif foodKey ~= lastFoodKey then
    if food == nil or lastFoodKey == "none" then
      shouldFood = true
    else
      local prevRem = tonumber(string.match(lastFoodKey, ":(%d+)"))
      local curRem = food and food.remaining_seconds
      if prevRem and curRem and math.abs(curRem - prevRem) >= 20 then
        shouldFood = true
      elseif (food and food.name) ~= string.match(lastFoodKey, "^([^:]+)") then
        shouldFood = true
      end
    end
  end
  if shouldFood or (food and reason == "force") then
    lastFoodKey = foodKey
    enqueue("PLAYER_FOOD_BUFF", {
      character = snap.character,
      realm = snap.realm,
      class = snap.class,
      guid = snap.guid,
      level = snap.level,
      is_self = true,
      food_buff = food,
      detection = foodMethod,
      reason = reason,
    }, { silent = silent })
  elseif food then
    lastFoodKey = foodKey
  else
    lastFoodKey = "none"
  end

  local yards, distMethod = sampleTravelDistance()
  local jumpDelta = (travel.jumps or 0) - (travel.emitted_jumps or 0)
  -- Throttle: yards / jump batches only. reason=="jump" must NOT bypass
  -- (JumpOrAscendStart fires every hop and was the main event flood).
  if
    yards - travel.emitted_yards >= DISTANCE_EMIT_YARDS
    or jumpDelta >= JUMP_EMIT_EVERY
    or reason == "force"
  then
    travel.emitted_yards = yards
    travel.emitted_jumps = travel.jumps or 0
    enqueue("PLAYER_DISTANCE", {
      character = snap.character,
      guid = snap.guid,
      level = snap.level,
      is_self = true,
      distance_yards = math.floor(yards + 0.5),
      jumps = travel.jumps or 0,
      detection = distMethod,
      reason = reason,
    }, { silent = true })
  end

  local power = readCombatPower()
  local pkPower = powerKey(power)
  if
    pkPower ~= lastPowerKey
    and (
      power.attack_power ~= nil
      or power.spell_power ~= nil
      or power.ranged_attack_power ~= nil
      or power.spell_healing ~= nil
    )
  then
    lastPowerKey = pkPower
    enqueue("PLAYER_POWER_STATS", {
      character = snap.character,
      realm = snap.realm,
      class = snap.class,
      guid = snap.guid,
      level = snap.level,
      is_self = true,
      attack_power = power.attack_power,
      ranged_attack_power = power.ranged_attack_power,
      spell_power = power.spell_power,
      spell_healing = power.spell_healing,
      detection = power.detection,
      reason = reason,
    }, { silent = silent })
  elseif power.detection == "secret_blocked" and lastPowerKey ~= "secret_blocked" then
    lastPowerKey = "secret_blocked"
    -- One-shot note for capabilities; no numeric fields (Forever SecretValues).
    enqueue("PLAYER_POWER_STATS", {
      character = snap.character,
      realm = snap.realm,
      class = snap.class,
      guid = snap.guid,
      level = snap.level,
      is_self = true,
      detection = "secret_blocked",
      reason = reason,
    }, { silent = true })
  end

  local money, moneyMethod = readMoney()
  if money and (lastMoneyCopper == nil or money.copper ~= lastMoneyCopper) then
    local prev = lastMoneyCopper
    lastMoneyCopper = money.copper
    if prev ~= nil or reason == "force" or reason == "login" or reason == "player_money" then
      enqueue("PLAYER_MONEY", {
        character = snap.character,
        realm = snap.realm,
        class = snap.class,
        guid = snap.guid,
        level = snap.level,
        is_self = true,
        copper = money.copper,
        gold = money.gold,
        silver = money.silver,
        copper_rem = money.copper_rem,
        detection = moneyMethod,
        reason = reason,
      }, { silent = silent })
    end
    -- Money dropped while a repairable merchant is open ~= repairs (may include vendor buys).
    if prev ~= nil and type(money.copper) == "number" and money.copper < prev then
      local lost = prev - money.copper
      local atRepair = false
      if MerchantFrame and MerchantFrame:IsShown() and CanMerchantRepair and CanMerchantRepair() then
        atRepair = true
      end
      if atRepair and lost > 0 then
        ForeverLANDB.repair_copper = (tonumber(ForeverLANDB.repair_copper) or 0) + lost
        enqueue("PLAYER_REPAIR_SPEND", {
          character = snap.character,
          realm = snap.realm,
          class = snap.class,
          guid = snap.guid,
          level = snap.level,
          is_self = true,
          spend_copper = lost,
          repair_copper = ForeverLANDB.repair_copper,
          detection = "merchant_money_drop",
          honesty = "inferred",
        }, { silent = true })
      end
    end
  end

  if mapOpens > 0 and mapOpens ~= lastMapOpensEmitted then
    lastMapOpensEmitted = mapOpens
    enqueue("PLAYER_MAP_OPENED", {
      character = snap.character,
      realm = snap.realm,
      class = snap.class,
      guid = snap.guid,
      level = snap.level,
      is_self = true,
      map_kind = "world_map",
      opens = mapOpens,
      detection = "WorldMapFrame_OnShow",
      reason = reason,
    }, { silent = silent })
  end

  if minimapOpens > 0 and minimapOpens ~= lastMinimapOpensEmitted then
    lastMinimapOpensEmitted = minimapOpens
    enqueue("PLAYER_MAP_OPENED", {
      character = snap.character,
      realm = snap.realm,
      class = snap.class,
      guid = snap.guid,
      level = snap.level,
      is_self = true,
      map_kind = "minimap",
      opens = minimapOpens,
      detection = "Minimap_OnMouseDown",
      reason = reason,
    }, { silent = silent })
  end
end

local function hookJumpTelemetry()
  if jumpHooked then
    return
  end
  jumpHooked = true

  local function noteJump()
    if not enteredWorld then
      return
    end
    travel.jumps = (travel.jumps or 0) + 1
    if (travel.jumps - (travel.emitted_jumps or 0)) >= JUMP_EMIT_EVERY then
      emitSelfTelemetry("jump", { silent = true })
    end
  end

  -- Prefer JumpOrAscendStart (one press = one jump). Forever may not expose it.
  if type(hooksecurefunc) == "function" and type(JumpOrAscendStart) == "function" then
    hooksecurefunc("JumpOrAscendStart", noteJump)
    return
  end

  -- Fallback: rising edge of IsFalling() (jump / fall start).
  local wasFalling = false
  local fallFrame = CreateFrame("Frame")
  fallFrame:SetScript("OnUpdate", function()
    if not enteredWorld then
      return
    end
    local falling = IsFalling and IsFalling()
    if falling and not wasFalling then
      noteJump()
    end
    wasFalling = falling and true or false
  end)
end

local function hookMapTelemetry()
  if not worldMapHooked and WorldMapFrame then
    worldMapHooked = true
    if WorldMapFrame.HookScript then
      WorldMapFrame:HookScript("OnShow", function()
        mapOpens = mapOpens + 1
        if enteredWorld then
          emitSelfTelemetry("world_map", { silent = true })
        end
      end)
    else
      local prev = WorldMapFrame:GetScript("OnShow")
      WorldMapFrame:SetScript("OnShow", function(self, ...)
        mapOpens = mapOpens + 1
        if enteredWorld then
          emitSelfTelemetry("world_map", { silent = true })
        end
        if prev then
          prev(self, ...)
        end
      end)
    end
  end

  -- Minimap is always visible; count intentional clicks (zoom / tracking / ping).
  if not minimapHooked and Minimap and Minimap.HookScript then
    minimapHooked = true
    Minimap:HookScript("OnMouseDown", function()
      minimapOpens = minimapOpens + 1
      if enteredWorld then
        emitSelfTelemetry("minimap", { silent = true })
      end
    end)
  end

  hookJumpTelemetry()
end

local function readMemberZone(unit, raidIndex)
  if raidIndex and GetRaidRosterInfo then
    local name, rank, subgroup, level, class, fileName, zone = api.call(GetRaidRosterInfo, raidIndex)
    if zone and zone ~= "" then
      return zone, "GetRaidRosterInfo"
    end
  end
  if C_Map and C_Map.GetBestMapForUnit then
    local mapID = api.call(C_Map.GetBestMapForUnit, unit)
    if mapID and C_Map.GetMapInfo then
      local info = api.call(C_Map.GetMapInfo, mapID)
      if info and info.name and info.name ~= "" then
        return info.name, "C_Map.GetBestMapForUnit"
      end
    end
  end
  if UnitPosition then
    local y, x, z, instanceId = api.call(UnitPosition, unit)
    local py, px, pz, pInstanceId = api.call(UnitPosition, "player")
    if instanceId and pInstanceId and instanceId == pInstanceId then
      local myZone = api.text(GetZoneText)
      if myZone ~= "" then
        return myZone, "inferred_same_UnitPosition_instance"
      end
    end
  end
  return "", "unavailable"
end

-- Compact position snapshot from UnitPosition / C_Map (no invented coordinates).
local function probePosition(unit)
  local out = {
    unit = unit,
    apis_present = {
      UnitPosition = UnitPosition ~= nil,
      C_Map = C_Map ~= nil,
      GetBestMapForUnit = C_Map and C_Map.GetBestMapForUnit ~= nil or false,
      GetPlayerMapPosition = C_Map and C_Map.GetPlayerMapPosition ~= nil or false,
      GetMapInfo = C_Map and C_Map.GetMapInfo ~= nil or false,
      GetWorldPosFromMapPos = C_Map and C_Map.GetWorldPosFromMapPos ~= nil or false,
      GetZoneText = GetZoneText ~= nil,
      GetSubZoneText = GetSubZoneText ~= nil,
      GetRealZoneText = GetRealZoneText ~= nil,
      GetMinimapZoneText = GetMinimapZoneText ~= nil,
    },
    zone_text = nil,
    subzone_text = nil,
    real_zone_text = nil,
    minimap_zone_text = nil,
    ui_map_id = nil,
    ui_map_name = nil,
    ui_map_type = nil,
    ui_map_parent = nil,
    map_x = nil,
    map_y = nil,
    world_y = nil,
    world_x = nil,
    world_z = nil,
    instance_id = nil,
    continent_id = nil,
    world_pos_x = nil,
    world_pos_y = nil,
    accuracy = "UNKNOWN",
    notes = {},
  }

  if not UnitExists(unit) then
    out.notes[#out.notes + 1] = "UnitExists=false"
    return out
  end

  if GetZoneText and unit == "player" then
    out.zone_text = GetZoneText() or nil
  end
  if GetSubZoneText and unit == "player" then
    out.subzone_text = GetSubZoneText() or nil
  end
  if GetRealZoneText and unit == "player" then
    out.real_zone_text = GetRealZoneText() or nil
  end
  if GetMinimapZoneText and unit == "player" then
    out.minimap_zone_text = GetMinimapZoneText() or nil
  end

  if UnitPosition then
    local y, x, z, instanceId = safeCall(UnitPosition, unit)
    if y ~= nil or x ~= nil then
      out.world_y = y
      out.world_x = x
      out.world_z = z
      out.instance_id = instanceId
      out.notes[#out.notes + 1] = "UnitPosition returned values"
    else
      out.notes[#out.notes + 1] = "UnitPosition returned nil"
    end
  end

  if C_Map and C_Map.GetBestMapForUnit then
    local mapID = safeCall(C_Map.GetBestMapForUnit, unit)
    out.ui_map_id = mapID
    if mapID and C_Map.GetMapInfo then
      local info = safeCall(C_Map.GetMapInfo, mapID)
      if info then
        out.ui_map_name = info.name
        out.ui_map_type = info.mapType
        out.ui_map_parent = info.parentMapID
      end
    end
    if mapID and C_Map.GetPlayerMapPosition then
      local pos = safeCall(C_Map.GetPlayerMapPosition, mapID, unit)
      if pos then
        local mx, my
        if pos.GetXY then
          mx, my = pos:GetXY()
        elseif type(pos) == "table" then
          mx, my = pos.x, pos.y
        end
        if mx ~= nil and my ~= nil then
          out.map_x = mx
          out.map_y = my
          out.notes[#out.notes + 1] = "C_Map.GetPlayerMapPosition OK"
          if C_Map.GetWorldPosFromMapPos then
            local cont, wpos = safeCall(C_Map.GetWorldPosFromMapPos, mapID, pos)
            out.continent_id = cont
            if wpos and wpos.GetXY then
              out.world_pos_x, out.world_pos_y = wpos:GetXY()
            elseif type(wpos) == "table" then
              out.world_pos_x, out.world_pos_y = wpos.x, wpos.y
            end
          end
        else
          out.notes[#out.notes + 1] = "GetPlayerMapPosition object without XY"
        end
      else
        out.notes[#out.notes + 1] = "GetPlayerMapPosition returned nil"
      end
    end
  end

  -- Classify accuracy honestly
  if out.map_x ~= nil and out.map_y ~= nil then
    out.accuracy = "EXACT"
  elseif out.world_x ~= nil and out.world_y ~= nil then
    out.accuracy = "EXACT"
    out.notes[#out.notes + 1] = "EXACT via UnitPosition yards (instance-relative)"
  elseif out.ui_map_id or (out.zone_text and out.zone_text ~= "") or out.ui_map_name then
    out.accuracy = "ZONE"
  else
    out.accuracy = "UNKNOWN"
  end

  return out
end

local function attachPosition(snap, unit)
  if not snap then
    return snap
  end
  local probe = probePosition(unit)
  snap.position = {
    accuracy = probe.accuracy,
    zone = probe.zone_text or probe.ui_map_name or snap.zone or nil,
    subzone = probe.subzone_text,
    map_id = probe.ui_map_id,
    map_name = probe.ui_map_name,
    map_type = probe.ui_map_type,
    parent_map_id = probe.ui_map_parent,
    map_x = probe.map_x,
    map_y = probe.map_y,
    world_x = probe.world_x,
    world_y = probe.world_y,
    world_z = probe.world_z,
    instance_id = probe.instance_id,
    continent_id = probe.continent_id,
    source = probe.accuracy == "EXACT"
        and ((probe.map_x and "C_Map.GetPlayerMapPosition") or "UnitPosition")
      or (probe.ui_map_id and "C_Map.GetBestMapForUnit")
      or (probe.zone_text and "GetZoneText")
      or "none",
    confidence = probe.accuracy == "EXACT" and "VERIFIED"
      or probe.accuracy == "ZONE" and "HIGH"
      or "LOW",
    ts = now(),
  }
  return snap
end

snapshotUnit = function(unit, meta)
  meta = meta or {}
  if not api.exists(unit) then
    return nil
  end

  local name, realm, firstName, lastName = splitNameRealm(unit)
  local _, classToken = api.call(UnitClass, unit)
  local _, raceToken = api.call(UnitRace, unit)
  local level = api.num(api.call(UnitLevel, unit))
  local guid = api.text(UnitGUID, unit)
  local connected = api.flag(UnitIsConnected, unit, true)
  local dead = api.flag(UnitIsDead, unit, false) or api.flag(UnitIsGhost, unit, false)
  local role = api.text(UnitGroupRolesAssigned, unit)

  local zone, zoneSource = "", "unavailable"
  if unit == "player" then
    zone = api.text(GetZoneText)
    if zone ~= "" then
      zoneSource = "GetZoneText"
    end
  else
    zone, zoneSource = readMemberZone(unit, meta.raidIndex)
  end

  local inInstance, instanceType = false, ""
  local instanceName, difficultyName, difficultyID = "", "", nil
  if unit == "player" then
    local inst, iType = api.call(IsInInstance)
    inInstance = inst and true or false
    instanceType = type(iType) == "string" and iType or ""
    local iName, iKind, diffID, diffName = api.call(GetInstanceInfo)
    instanceName = type(iName) == "string" and iName or ""
    difficultyName = type(diffName) == "string" and diffName or ""
    difficultyID = diffID
    if instanceType == "" and type(iKind) == "string" then
      instanceType = iKind
    end
  end

  local snap = {
    unit = unit,
    party_index = meta.partyIndex,
    raid_index = meta.raidIndex,
    character = name,
    first_name = firstName or "",
    last_name = lastName or "",
    realm = realm,
    class = classToken or "",
    race = raceToken or "",
    level = level,
    guid = guid,
    online = connected,
    dead = dead,
    role = role,
    zone = zone,
    zone_source = zoneSource,
    in_instance = inInstance,
    instance_type = instanceType,
    instance_name = instanceName,
    difficulty_name = difficultyName,
    difficulty_id = difficultyID,
    is_self = unit == "player",
  }
  -- Position is a second read. Polls and UNIT_FLAGS only need identity/vitals.
  if meta.withPosition then
    return attachPosition(snap, unit)
  end
  return snap
end

local function collectGroupMembers(opts)
  opts = opts or {}
  local members = {}
  local selfSnap = snapshotUnit("player", { withPosition = opts.withPosition })
  if selfSnap then
    members[#members + 1] = selfSnap
  end

  if IsInRaid and IsInRaid() then
    local n = api.num(api.call(GetNumGroupMembers)) or 0
    for i = 1, n do
      local unit = "raid" .. i
      if api.exists(unit) and not (UnitIsUnit and UnitIsUnit(unit, "player")) then
        members[#members + 1] = snapshotUnit(unit, { raidIndex = i, partyIndex = i, withPosition = opts.withPosition })
      end
    end
  elseif IsInGroup and IsInGroup() then
    local n = api.num(api.call(GetNumSubgroupMembers)) or 4
    for i = 1, n do
      local unit = "party" .. i
      if api.exists(unit) then
        members[#members + 1] = snapshotUnit(unit, { partyIndex = i, withPosition = opts.withPosition })
      end
    end
  end
  return members
end

local function emitDetected(snap, reason)
  enqueue("PLAYER_DETECTED", {
    character = snap.character,
    realm = snap.realm,
    class = snap.class,
    race = snap.race,
    level = snap.level,
    guid = snap.guid,
    unit = snap.unit,
    online = snap.online,
    dead = snap.dead,
    role = snap.role,
    zone = snap.zone,
    zone_source = snap.zone_source,
    is_self = snap.is_self,
    reason = reason or "roster",
  }, { silent = false })
end

local MAX_CORPSE_RUN_SECONDS = 2 * 60 * 60

local function markDeathStart(guid)
  if not guid then
    return now()
  end
  tracked[guid] = tracked[guid] or {}
  local deathTs = now()
  tracked[guid].death_started_at = deathTs
  if GetTime then
    local gt = plainNumber(GetTime())
    if gt then
      tracked[guid].death_started_gamet = gt
    end
  end
  return deathTs
end

local function corpseRunDuration(guid)
  if not guid or not tracked[guid] then
    return nil
  end
  local t = tracked[guid]
  local duration = nil
  if t.death_started_gamet and GetTime then
    local gt = plainNumber(GetTime())
    if gt then
      duration = math.max(0, gt - t.death_started_gamet)
    end
  end
  if duration == nil and type(t.death_started_at) == "number" then
    duration = math.max(0, now() - t.death_started_at)
  end
  if duration ~= nil and duration > MAX_CORPSE_RUN_SECONDS then
    -- Likely login/reload after an old death clock - don't invent a multi-hour run.
    duration = nil
  end
  t.death_started_at = nil
  t.death_started_gamet = nil
  return duration
end

local function emitPlaying(snap)
  if not snap or not snap.is_self or not snap.character or snap.character == "" then
    return
  end
  local key = snap.guid or fullKey(snap.character)
  if key == lastPlayingKey then
    return
  end
  lastPlayingKey = key
  enqueue("PLAYER_PLAYING", {
    character = snap.character,
    realm = snap.realm or "",
    class = snap.class or "",
    guid = snap.guid or "",
    level = snap.level or 0,
    is_self = true,
    detection = "UnitName_player",
  }, { silent = true })
end

local function processMemberChanges(snap)
  if not snap or not snap.guid or snap.guid == "" then
    return
  end
  if not shouldSyncCharacter(snap.character, snap.is_self, snap.guid) then
    return
  end
  local prev = tracked[snap.guid]

  if not prev then
    tracked[snap.guid] = {
      level = snap.level,
      dead = snap.dead,
      online = snap.online,
      zone = snap.zone,
      zone_source = snap.zone_source,
      character = snap.character,
      class = snap.class,
      in_instance = snap.in_instance,
      instance_name = snap.instance_name,
    }
    emitDetected(snap, "first_seen")
    return
  end

  if type(snap.level) == "number" and type(prev.level) == "number" and snap.level ~= prev.level then
    enqueue("PLAYER_LEVEL_CHANGED", {
      character = snap.character,
      realm = snap.realm,
      class = snap.class,
      race = snap.race,
      guid = snap.guid,
      unit = snap.unit,
      level = snap.level,
      old_level = prev.level,
      is_self = snap.is_self,
      detection = "UnitLevel_delta",
    }, { silent = false })
  end

  if snap.dead and not prev.dead then
    local deathTs = markDeathStart(snap.guid)
    enqueue("PLAYER_DIED", {
      character = snap.character,
      realm = snap.realm,
      class = snap.class,
      guid = snap.guid,
      unit = snap.unit,
      level = snap.level,
      zone = snap.zone,
      is_self = snap.is_self,
      detection = "UnitIsDead",
      death_started_at = deathTs,
    }, { silent = false })
  end

  if (not snap.dead) and prev.dead then
    local duration = corpseRunDuration(snap.guid)
    enqueue("PLAYER_RESURRECTED", {
      character = snap.character,
      realm = snap.realm,
      class = snap.class,
      guid = snap.guid,
      unit = snap.unit,
      level = snap.level,
      zone = snap.zone,
      is_self = snap.is_self,
      detection = "UnitIsDead_cleared",
      corpse_run_seconds = duration,
    }, { silent = false })
  end

  if snap.online ~= prev.online then
    enqueue(snap.online and "PLAYER_ONLINE" or "PLAYER_OFFLINE", {
      character = snap.character,
      realm = snap.realm,
      class = snap.class,
      guid = snap.guid,
      unit = snap.unit,
      level = snap.level,
      is_self = snap.is_self,
    })
  end

  if snap.zone and snap.zone ~= "" and snap.zone ~= prev.zone and snap.zone_source ~= "unavailable" then
    enqueue("PLAYER_ZONE_CHANGED", {
      character = snap.character,
      realm = snap.realm,
      guid = snap.guid,
      unit = snap.unit,
      zone = snap.zone,
      old_zone = prev.zone or "",
      zone_source = snap.zone_source,
      is_self = snap.is_self,
    })
  end

  tracked[snap.guid] = {
    level = snap.level,
    dead = snap.dead,
    online = snap.online,
    zone = snap.zone,
    zone_source = snap.zone_source,
    character = snap.character,
    class = snap.class,
    in_instance = snap.in_instance,
    instance_name = snap.instance_name,
  }
end

local function emitPartyRoster(reason, opts)
  opts = opts or {}
  local members = collectGroupMembers({ withPosition = not opts.silentOnly })
  for _, snap in ipairs(members) do
    processMemberChanges(snap)
  end

  -- Polls only update tracked state; skip noisy roster snapshots unless forced.
  if opts.silentOnly then
    persistPending()
    return
  end

  local syncMembers = {}
  for _, snap in ipairs(members) do
    if shouldSyncCharacter(snap.character, snap.is_self, snap.guid) then
      if not snap.is_self and addonGuids[snap.guid] then
        snap.has_addon = true
      end
      syncMembers[#syncMembers + 1] = snap
    end
  end
  local selfSnap = members[1] and members[1].is_self and members[1] or nil
  if selfSnap then
    emitPlaying(selfSnap)
  end

  enqueue("PARTY_ROSTER", {
    reason = reason or "poll",
    group_size = #members,
    in_group = (IsInGroup and IsInGroup()) and true or false,
    in_raid = (IsInRaid and IsInRaid()) and true or false,
    members = syncMembers,
    character = selfSnap and selfSnap.character or (syncMembers[1] and syncMembers[1].character) or "",
    level = selfSnap and selfSnap.level or (syncMembers[1] and syncMembers[1].level) or 0,
    is_self = true,
  }, { silent = true })
end

local function checkPlayerInstanceTransition()
  local inInstance, instanceType = false, ""
  if IsInInstance then
    inInstance, instanceType = IsInInstance()
  end
  inInstance = inInstance and true or false
  instanceType = instanceType or ""

  local instanceName, difficultyName, difficultyID = "", "", nil
  if GetInstanceInfo then
    local iName, iType, diffID, diffName = GetInstanceInfo()
    instanceName = iName or ""
    difficultyName = diffName or ""
    difficultyID = diffID
    if instanceType == "" then
      instanceType = iType or ""
    end
  end

  local snap = snapshotUnit("player", {})
  if lastInstanceState == nil then
    lastInstanceState = inInstance
    lastInstanceName = instanceName
    return
  end

  if inInstance and not lastInstanceState then
    enqueue("PLAYER_ENTERED_INSTANCE", {
      character = snap and snap.character or "",
      realm = snap and snap.realm or "",
      class = snap and snap.class or "",
      guid = snap and snap.guid or "",
      level = snap and snap.level or 0,
      instance_name = instanceName,
      instance_type = instanceType,
      difficulty_name = difficultyName,
      difficulty_id = difficultyID,
      is_self = true,
    })
  elseif (not inInstance) and lastInstanceState then
    enqueue("PLAYER_LEFT_INSTANCE", {
      character = snap and snap.character or "",
      realm = snap and snap.realm or "",
      class = snap and snap.class or "",
      guid = snap and snap.guid or "",
      level = snap and snap.level or 0,
      instance_name = lastInstanceName,
      is_self = true,
    })
  end

  lastInstanceState = inInstance
  lastInstanceName = instanceName
end

local function closeCombatSegment()
  if not combat.entered_at then
    return
  end
  local delta = GetTime() - combat.entered_at
  if delta > 0 and delta < 3600 then
    combat.seconds = combat.seconds + delta
  end
  combat.entered_at = nil
end

local function emitCombatTime(reason, silent)
  closeCombatSegment()
  if combat.seconds <= (combat.emitted or 0) and reason ~= "force" then
    return
  end
  if combat.seconds <= 0 then
    return
  end
  combat.emitted = combat.seconds
  local snap = snapshotUnit("player", {})
  enqueue("PLAYER_COMBAT_TIME", {
    character = snap and snap.character or UnitName("player") or "",
    realm = snap and snap.realm or "",
    class = snap and snap.class or "",
    guid = snap and snap.guid or playerGUID or "",
    level = snap and snap.level or UnitLevel("player") or 0,
    is_self = true,
    combat_seconds = math.floor(combat.seconds + 0.5),
    reason = reason or "tick",
  }, { silent = silent ~= false })
end

local function qualityFromLootColor(color)
  if type(color) ~= "string" then
    return nil
  end
  local c = string.lower(color)
  -- Classic item link colors (with alpha prefix ff)
  if c == "ffa335ee" or c == "a335ee" then
    return 4
  end
  if c == "ff0070dd" or c == "0070dd" then
    return 3
  end
  return nil
end

local function handleLootChat(msg)
  -- Same secret-string path as combat-log / tradeskill chat (party combat).
  if not isPlainString(msg) or msg == "" then
    return
  end
  if not (string.find(msg, "^You receive loot:") or string.find(msg, "^You receive item:")) then
    return
  end
  local link = string.match(msg, "|c%x+|Hitem:.-|h%[.-%]|h|r")
  if not link then
    return
  end
  local itemName, _, quality = GetItemInfo(link)
  if not itemName then
    itemName = string.match(link, "%[(.-)%]")
  end
  if type(quality) ~= "number" then
    local color = string.match(msg, "|c(%x%x%x%x%x%x%x%x)|Hitem:")
    quality = qualityFromLootColor(color)
  end
  if quality ~= 3 and quality ~= 4 then
    return
  end
  local snap = snapshotUnit("player", {})
  local eventType = quality == 4 and "PLAYER_LOOT_EPIC" or "PLAYER_LOOT_RARE"
  local itemId = nil
  local idStr = string.match(link, "item:(%d+)")
  if idStr then
    itemId = tonumber(idStr)
  end
  enqueue(eventType, {
    character = snap and snap.character or UnitName("player") or "",
    realm = snap and snap.realm or "",
    class = snap and snap.class or "",
    guid = snap and snap.guid or playerGUID or "",
    level = snap and snap.level or UnitLevel("player") or 0,
    zone = snap and snap.zone or "",
    is_self = true,
    item_name = itemName or "item",
    item_link = link,
    item_id = itemId,
    item_quality = quality,
    detection = "CHAT_MSG_LOOT",
  })
end

--- Forever zone-wide craft chat: "Name creates Item." Self only -> PLAYER_CRAFT.
local function handleTradeskillChat(msg)
  -- Skip secret chat text (Forever SecretValues); comparing it throws while tainted.
  if not isPlainString(msg) or msg == "" then
    return
  end
  if not craftProbeIsSelfMessage(msg) then
    return
  end
  local item =
    string.match(msg, "^[Yy]ou create[sd]?%s+(.+)$")
    or string.match(msg, "^.- creates?%s+(.+)$")
  if not item then
    return
  end
  item = string.gsub(item, "%s+$", "")
  item = string.gsub(item, "%.$", "")
  -- Strip item links to plain name when present
  local linked = string.match(item, "|h%[(.-)%]|h")
  if linked then
    item = linked
  end
  if item == "" then
    return
  end
  local qty = 1
  local q, rest = string.match(item, "^(%d+)[xX]%s+(.+)$")
  if q and rest then
    qty = tonumber(q) or 1
    item = rest
  end
  local snap = snapshotUnit("player", {})
  enqueue("PLAYER_CRAFT", {
    character = snap and snap.character or UnitName("player") or "",
    realm = snap and snap.realm or "",
    class = snap and snap.class or "",
    guid = snap and snap.guid or playerGUID or "",
    level = snap and snap.level or UnitLevel("player") or 0,
    zone = snap and snap.zone or "",
    is_self = true,
    action = "create",
    item_name = item,
    quantity = qty,
    detection = "CHAT_MSG_TRADESKILLS",
  }, { silent = true })
end

-- Tiny linking pin: collect quietly, flush on click, combat log on right-click.
-- No options panel, no minimap button, no status meter - the board is elsewhere.

-- Events that re-fire every login and should not alone make the pin scream.
-- Everything else newer than last Push counts as unsaved (honest badge).
local NOISE_FOR_BADGE = {
  LOGIN = true,
  LOGOUT = true,
  WORLD_ENTER = true,
  PLAYER_PLAYING = true,
  PLAYER_DETECTED = true,
  PLAYER_ONLINE = true,
  PLAYER_OFFLINE = true,
  PING = true,
}

local function pendingCountForButton()
  local flushedAt = flushMeta().last_flush_at
  local n = 0
  for _, ev in ipairs(pending) do
    if ev and ev.type and not NOISE_FOR_BADGE[ev.type] then
      local ts = tonumber(ev.ts) or 0
      if flushedAt <= 0 or ts > flushedAt then
        n = n + 1
      end
    end
  end
  return n
end

local function pinStatusLine()
  local n = pendingCountForButton()
  if n > 0 then
    return tostring(n) .. " not on disk - left-click Push"
  end
  local flushedAt = flushMeta().last_flush_at
  if flushedAt > 0 then
    if #pending > 0 and pendingFullyFlushedToDisk() then
      return "saved to disk - collector sends when host is up"
    end
    return "saved to disk"
  end
  if #pending > 0 then
    return tostring(#pending) .. " queued - left-click Push"
  end
  return "queue empty"
end

local function inCombatNow()
  if UnitAffectingCombat and UnitAffectingCombat("player") then
    return true
  end
  if InCombatLockdown and InCombatLockdown() then
    return true
  end
  return false
end

local function maybeRemindPush()
  if not enteredWorld or not setting("push_reminders") then
    return
  end
  if inCombatNow() then
    return
  end
  local t = now()
  local flushedAt = flushMeta().last_flush_at
  if flushedAt > 0 and (t - flushedAt) < 120 then
    return
  end
  if lastPushRemindAt > 0 and (t - lastPushRemindAt) < PUSH_REMIND_SEC then
    return
  end
  if lastPushRemindAt == 0 then
    lastPushRemindAt = t
    return
  end
  local notable = pendingCountForButton()
  if notable < 80 then
    return
  end
  lastPushRemindAt = t
  chat(string.format("%d unsaved - click |cffffffffFL|r (or logout).", notable))
end

local function maybeRemindCombatLog()
  -- Intentionally quiet. Use right-click on FL or type /combatlog once.
end

ui.doPushLan = function()
  emitPartyRoster("flush")
  local n = flushForPush()
  ui.refreshPushButton()
  lastPushRemindAt = now()
  lastQueueCapRemindAt = now()
  if n == 0 then
    chat("Reloading for collector.")
  else
    chat(string.format("Saved %d - collector sends when host is up.", n))
  end
  pushingLan = true
  reloadForCollector()
end

-- One small pin. Left = save+reload. Right = /combatlog once.
ui.dock = CreateFrame("Button", "ForeverLANDock", UIParent)
ui.dock:SetSize(72, 20)
ui.dock:SetPoint("BOTTOMRIGHT", UIParent, "BOTTOMRIGHT", -16, 140)
ui.dock:SetFrameStrata("HIGH")
ui.dock:SetMovable(true)
ui.dock:SetClampedToScreen(true)
ui.dock:EnableMouse(true)
ui.dock:RegisterForDrag("LeftButton")
ui.dock:RegisterForClicks("LeftButtonUp", "RightButtonUp")
ui.dock:Hide()
ui.flushBtn = ui.dock

local pinBg = ui.dock:CreateTexture(nil, "BACKGROUND")
pinBg:SetAllPoints()
pinBg:SetTexture("Interface\\Buttons\\WHITE8X8")
pinBg:SetVertexColor(0.05, 0.05, 0.06, 0.85)
ui.dock.bg = pinBg

local pinFs = ui.dock:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
pinFs:SetPoint("CENTER", 0, 0)
pinFs:SetText("FL")
ui.dock.label = pinFs

ui.refreshPushButton = function()
  if not ui.dock or not ui.dock.label then
    return
  end
  local n = pendingCountForButton()
  if n > 0 then
    ui.dock.label:SetText(n > 99 and "FL 99+" or ("FL " .. tostring(n)))
    ui.dock.label:SetTextColor(1, 0.82, 0.35)
  else
    ui.dock.label:SetText("FL")
    ui.dock.label:SetTextColor(0.75, 0.75, 0.75)
  end
end

ui.dock:SetScript("OnDragStart", function(self)
  if not setting("lock_push_button") then
    self:StartMoving()
  end
end)
ui.dock:SetScript("OnDragStop", function(self)
  self:StopMovingOrSizing()
  local s = ensureSettings()
  local point, _, relativePoint, x, y = self:GetPoint(1)
  s.btn_point = point
  s.btn_relative = relativePoint
  s.btn_x = x
  s.btn_y = y
end)

ui.dock:SetScript("OnEnter", function(self)
  GameTooltip:SetOwner(self, "ANCHOR_TOP")
  GameTooltip:AddLine("Forever LAN", 0.7, 0.85, 1)
  GameTooltip:AddLine(pinStatusLine(), 1, 1, 1)
  GameTooltip:AddLine("Combat log: " .. combatLogStatusLabel(), 0.85, 0.85, 0.7)
  GameTooltip:AddLine("Left: Push to disk - Right: /combatlog once", 0.65, 0.65, 0.65)
  GameTooltip:Show()
end)
ui.dock:SetScript("OnLeave", function()
  GameTooltip:Hide()
end)

-- Combat log: Forever blocks LoggingCombat(true). Feed /combatlog once via chat box.
local combatLogClickPending = false
local combatSlashSent = false
local refreshCombatLogButton

local function noteCombatLogChat(msg)
  -- Hall of Thanes / party combat: Forever can deliver CHAT_MSG_SYSTEM as a
  -- secret string. Comparing it while tainted errors the addon (General.log
  -- 2026-10-06). Combat-log on/off confirmations are plain; ignore the rest.
  if not isPlainString(msg) or msg == "" then
    return
  end
  local okMatch, off, on = pcall(function()
    local isOff = (COMBATLOGDISABLED and msg == COMBATLOGDISABLED) or false
    local isOn = (COMBATLOGENABLED and msg == COMBATLOGENABLED) or false
    if not isOff and not isOn then
      local lower = string.lower(msg)
      local about = string.find(lower, "combat log", 1, true) or string.find(lower, "combat logging", 1, true)
      if not about then
        return false, false
      end
      if string.find(lower, "disabled", 1, true) or string.find(lower, "stopped", 1, true) then
        isOff = true
      elseif string.find(lower, "enabled", 1, true) or string.find(lower, "being logged", 1, true) then
        isOn = true
      else
        return false, false
      end
    end
    return isOff, isOn
  end)
  if not okMatch then
    return
  end
  if off then
    setCombatLogUiOn(false)
    combatSlashSent = false
    combatLogClickPending = false
  elseif on then
    setCombatLogUiOn(true)
    combatSlashSent = true
    combatLogClickPending = false
  else
    return
  end
  if refreshCombatLogButton then
    refreshCombatLogButton()
  end
end

local combatWatch = CreateFrame("Frame")
combatWatch:RegisterEvent("CHAT_MSG_SYSTEM")
combatWatch:SetScript("OnEvent", function(_, _, msg)
  noteCombatLogChat(msg)
end)

local function sendCombatLogSlash()
  local box = ChatFrame1EditBox or (DEFAULT_CHAT_FRAME and DEFAULT_CHAT_FRAME.editBox)
  if not box or not box.SetText or not box.SendText then
    return false
  end
  local hadFocus = box:HasFocus()
  local prev = box:GetText() or ""
  box:SetText("/combatlog")
  box:SendText()
  if hadFocus then
    box:SetText(prev)
    box:Show()
  else
    box:SetText("")
    box:Hide()
  end
  return true
end

local function finishCombatLogAttempt(_)
  combatLogClickPending = false
  if refreshCombatLogButton then
    refreshCombatLogButton()
  end
end

local function requestCombatLogOnce()
  local live = isCombatLogging()
  if live == true then
    setCombatLogUiOn(true)
    combatSlashSent = true
    chat("Combat log is on (LoggingCombat). Right-click ignored.")
    if refreshCombatLogButton then
      refreshCombatLogButton()
    end
    return
  end
  -- Sticky/session flag must not block when the API says off - that was the bug.
  if live == false then
    setCombatLogUiOn(false)
    combatSlashSent = false
  elseif combatSlashSent and combatLogUiOn() then
    chat(
      "Already sent /combatlog this session. If it's still off, type |cffffffff/combatlog|r once."
    )
    return
  end
  combatLogClickPending = true
  local ok = sendCombatLogSlash()
  if not ok then
    combatLogClickPending = false
    chat("Could not send from the pin - type |cffffffff/combatlog|r once yourself.")
    return
  end
  combatSlashSent = true
  -- Do not mark ON until CHAT_MSG_SYSTEM (or LoggingCombat) confirms.
  chat("Sent /combatlog - waiting for the game to confirm.")
  if C_Timer and C_Timer.After then
    C_Timer.After(0.5, function()
      if isCombatLogging() == true then
        setCombatLogUiOn(true)
        chat("Combat log on.")
      elseif ForeverLANDB and ForeverLANDB.combat_log_on then
        chat("Combat log on (system message).")
      else
        chat(
          "No combat-log confirm yet. If chat said nothing, type |cffffffff/combatlog|r once."
        )
      end
      finishCombatLogAttempt(1)
    end)
  else
    finishCombatLogAttempt(1)
  end
end

refreshCombatLogButton = function()
  -- Pin label is the only UI; nothing else to paint.
  if ui.refreshPushButton then
    ui.refreshPushButton()
  end
end

ui.dock:SetScript("OnClick", function(_, button)
  if button == "RightButton" then
    requestCombatLogOnce()
    return
  end
  ui.doPushLan()
end)

ui.positionMinimapButton = function() end
ui.openOptionsPanel = function()
  chat("No options panel - |cffffffff/fl|r for status, left-click FL to save.")
  return false
end

ui.applyUiSettings = function()
  ensureSettings()
  local s = ForeverLANDB.settings
  if s.btn_point and s.btn_x and s.btn_y and ui.dock then
    ui.dock:ClearAllPoints()
    ui.dock:SetPoint(s.btn_point, UIParent, s.btn_relative or s.btn_point, s.btn_x, s.btn_y)
  end
  if setting("show_push_button") and enteredWorld and ui.dock then
    ui.dock:Show()
  elseif ui.dock then
    ui.dock:Hide()
  end
  ui.refreshPushButton()
end

ui.printHelp = function()
  chat("|cffffffff/fl|r status | push | combatlog | roster | remember First Last | forget First Last")
end

ui.printStatus = function()
  local snap = snapshotUnit("player", {})
  local who = snap and snap.character or UnitName("player") or "?"
  chat(string.format(
    "v%s - %s - queue %d - %s - combatlog %s",
    ADDON_VERSION,
    who,
    #pending,
    pinStatusLine(),
    combatLogStatusLabel()
  ))
end

function ForeverLAN_OnAddonCompartmentClick()
  ui.doPushLan()
end

-- Party hello: announce this character's GUID to groupmates running ForeverLAN.
local COMMS_PREFIX = "ForeverLAN"
local HELLO_MIN_GAP = 5
local lastHelloAt = 0

local function commsAvailable()
  return C_ChatInfo ~= nil and C_ChatInfo.SendAddonMessage ~= nil
end

local function sendHello(force)
  if not commsAvailable() or not (IsInGroup and IsInGroup()) then
    return
  end
  local t = now()
  if not force and t - lastHelloAt < HELLO_MIN_GAP then
    return
  end
  local guid = playerGUID or UnitGUID("player")
  if type(guid) ~= "string" or guid == "" then
    return
  end
  lastHelloAt = t
  local channel = (IsInRaid and IsInRaid()) and "RAID" or "PARTY"
  pcall(C_ChatInfo.SendAddonMessage, COMMS_PREFIX, "HELLO|" .. guid .. "|" .. ADDON_VERSION, channel)
end

local function onAddonMessage(prefix, text)
  if prefix ~= COMMS_PREFIX or not isPlainString(text) then
    return
  end
  local guid, version = text:match("^HELLO|(Player%-[^|]+)|([^|]*)$")
  if not guid or guid == (playerGUID or UnitGUID("player")) then
    return
  end
  local isNew = addonGuids[guid] == nil
  addonGuids[guid] = version ~= "" and version or "?"
  -- Always answer (rate-limited): a groupmate who /reloaded forgot our GUID.
  sendHello(false)
  if isNew then
    emitPartyRoster("addon_hello")
  end
end

local frame = CreateFrame("Frame")
frame:RegisterEvent("ADDON_LOADED")
frame:RegisterEvent("CHAT_MSG_ADDON")
frame:RegisterEvent("PLAYER_LOGIN")
frame:RegisterEvent("PLAYER_ENTERING_WORLD")
frame:RegisterEvent("PLAYER_LEVEL_UP")
frame:RegisterEvent("PLAYER_DEAD")
frame:RegisterEvent("PLAYER_ALIVE")
frame:RegisterEvent("PLAYER_UNGHOST")
frame:RegisterEvent("ZONE_CHANGED_NEW_AREA")
frame:RegisterEvent("PLAYER_LOGOUT")
frame:RegisterEvent("GROUP_ROSTER_UPDATE")
frame:RegisterEvent("UNIT_LEVEL")
frame:RegisterEvent("UNIT_CONNECTION")
frame:RegisterEvent("UNIT_FLAGS")
frame:RegisterEvent("PARTY_MEMBER_ENABLE")
frame:RegisterEvent("PARTY_MEMBER_DISABLE")
frame:RegisterEvent("SKILL_LINES_CHANGED")
frame:RegisterEvent("QUEST_LOG_UPDATE")
frame:RegisterEvent("UNIT_AURA")
frame:RegisterEvent("PLAYER_MONEY")
frame:RegisterEvent("UNIT_ATTACK_POWER")
frame:RegisterEvent("UNIT_RANGED_ATTACK_POWER")
frame:RegisterEvent("PLAYER_DAMAGE_DONE_MODS")
frame:RegisterEvent("CHAT_MSG_LOOT")
frame:RegisterEvent("CHAT_MSG_TRADESKILLS")
frame:RegisterEvent("PLAYER_REGEN_DISABLED")
frame:RegisterEvent("PLAYER_REGEN_ENABLED")

frame:SetScript("OnEvent", function(_, event, ...)
  if event == "CHAT_MSG_ADDON" then
    onAddonMessage(...)
    return
  end

  if event == "ADDON_LOADED" then
    local name = ...
    if name ~= ADDON_NAME and name ~= "ForeverLAN" then
      return
    end
    if C_ChatInfo and C_ChatInfo.RegisterAddonMessagePrefix then
      pcall(C_ChatInfo.RegisterAddonMessagePrefix, COMMS_PREFIX)
    end
    ForeverLANDB = ForeverLANDB or {}
    ForeverLANCharDB = ForeverLANCharDB or {}
    ensureSettings()
    rebuildRosterIndex()
    ForeverLANDB.positionProbe = nil
    bindActiveCharacter()
    trimPendingOverCap()
    rebuildPendingIndex()
    -- After Push LAN, keep export briefly so the collector can read the SV write.
    local meta = flushMeta()
    local keepExport = meta.export and meta.last_flush_at > 0 and (now() - meta.last_flush_at) < 180
    if keepExport then
      persistCharStore()
      -- Drop export from RAM after collector has had time to poll (disk already wrote it).
      if C_Timer and C_Timer.After then
        C_Timer.After(20, function()
          local db = ForeverLANCharDB
          if db then
            db.export = nil
          end
        end)
      end
    else
      local db = charStore()
      db.export = nil
      touchPending()
    end
    hookMapTelemetry()
    ui.applyUiSettings()
    return
  end

  if event == "PLAYER_LOGIN" then
    playerGUID = UnitGUID("player")
    -- UnitName is reliable here - rebind so we never keep another character's queue.
    bindActiveCharacter()
    trimPendingOverCap()
    rebuildPendingIndex()
    recordCapabilities()
    hookMapTelemetry()
    showLoadHint()
    showCombatLogHint()
    ui.applyUiSettings()
    return
  end

  if event == "PLAYER_ENTERING_WORLD" then
    local isInitialLogin, isReloadingUi = ...
    recordCapabilities()
    showLoadHint()
    showCombatLogHint()
    playerGUID = UnitGUID("player")
    if not enteredWorld then
      enteredWorld = true
      local snap = snapshotUnit("player", {})
      if snap then
        tracked[snap.guid] = {
          level = snap.level,
          dead = snap.dead,
          online = snap.online,
          zone = snap.zone,
          zone_source = snap.zone_source,
          character = snap.character,
          class = snap.class,
        }
      end
      enqueue("LOGIN", snap or {}, { silent = false })
      sendHello(true)
      emitPartyRoster(isReloadingUi and "reload" or "login")
      checkPlayerInstanceTransition()
      emitSelfTelemetry("login", { silent = true })
    else
      enqueue("WORLD_ENTER", { initial = false }, { silent = true })
      checkPlayerInstanceTransition()
      emitPartyRoster("world_enter")
      emitSelfTelemetry("world_enter", { silent = true })
    end
    persistPending()
    -- Fresh login: combat log starts off unless the API says otherwise.
    -- Reload: keep button "Combat Log ON" if we enabled earlier this session.
    if isInitialLogin then
      setCombatLogUiOn(isCombatLogging() == true)
    elseif isCombatLogging() == true then
      setCombatLogUiOn(true)
    end
    ui.applyUiSettings()
    -- Pending survives Push->Reload; host dedupes by event.id.
    if isReloadingUi then
      ForeverLANDB.last_reload_pending = #pending
    end
    return
  end

  if event == "PLAYER_LEVEL_UP" then
    local newLevel = ...
    local snap = snapshotUnit("player", {})
    local oldLevel = (type(newLevel) == "number") and (newLevel - 1) or nil
    enqueue("PLAYER_LEVEL_CHANGED", {
      character = snap and snap.character or "",
      realm = snap and snap.realm or "",
      class = snap and snap.class or "",
      race = snap and snap.race or "",
      guid = snap and snap.guid or "",
      unit = "player",
      level = newLevel,
      old_level = oldLevel,
      is_self = true,
      detection = "PLAYER_LEVEL_UP",
    }, { silent = false })
    if snap and snap.guid then
      tracked[snap.guid] = tracked[snap.guid] or {}
      tracked[snap.guid].level = newLevel
    end
    return
  end

  if event == "PLAYER_DEAD" then
    local snap = snapshotUnit("player", {})
    local deathTs = markDeathStart(snap and snap.guid)
    if snap and snap.guid and tracked[snap.guid] then
      tracked[snap.guid].dead = true
    end
    enqueue("PLAYER_DIED", {
      character = snap and snap.character or "",
      realm = snap and snap.realm or "",
      class = snap and snap.class or "",
      guid = snap and snap.guid or "",
      unit = "player",
      level = snap and snap.level or 0,
      zone = snap and snap.zone or "",
      is_self = true,
      detection = "PLAYER_DEAD",
      death_started_at = deathTs,
    }, { silent = false })
    return
  end

  if event == "PLAYER_ALIVE" or event == "PLAYER_UNGHOST" then
    if event == "PLAYER_ALIVE" then
      local ghost = false
      if UnitIsGhost then
        local ok, isGhost = pcall(UnitIsGhost, "player")
        ghost = ok and isGhost == true
      end
      if ghost then
        return
      end
    end
    local snap = snapshotUnit("player", {})
    local guid = snap and snap.guid
    -- Only emit one rez per death clock; ALIVE+UNGHOST both fire.
    if not guid or not tracked[guid] or not tracked[guid].death_started_at then
      return
    end
    local duration = corpseRunDuration(guid)
    enqueue("PLAYER_RESURRECTED", {
      character = snap and snap.character or "",
      realm = snap and snap.realm or "",
      class = snap and snap.class or "",
      guid = guid or "",
      unit = "player",
      level = snap and snap.level or 0,
      zone = snap and snap.zone or "",
      is_self = true,
      detection = event,
      corpse_run_seconds = duration,
    }, { silent = false })
    if tracked[guid] then
      tracked[guid].dead = false
    end
    return
  end

  if event == "ZONE_CHANGED_NEW_AREA" then
    checkPlayerInstanceTransition()
    emitPartyRoster("zone_changed")
    return
  end

  if event == "GROUP_ROSTER_UPDATE"
    or event == "PARTY_MEMBER_ENABLE"
    or event == "PARTY_MEMBER_DISABLE"
  then
    sendHello(false)
    emitPartyRoster(event)
    return
  end

  if event == "UNIT_LEVEL" then
    local unit = ...
    if unit and (unit == "player" or unit:match("^party%d+$") or unit:match("^raid%d+$")) then
      local snap = snapshotUnit(unit, {})
      if snap then
        processMemberChanges(snap)
      end
    end
    return
  end

  if event == "UNIT_CONNECTION" or event == "UNIT_FLAGS" then
    local unit = ...
    if unit and (unit == "player" or unit:match("^party%d+$") or unit:match("^raid%d+$")) then
      local snap = snapshotUnit(unit, {})
      if snap then
        processMemberChanges(snap)
      end
    end
    return
  end

  if event == "PLAYER_LOGOUT" then
    emitCombatTime("logout", true)
    local snap = snapshotUnit("player", {}) or {}
    if pushingLan then
      -- Push LAN reload - re-snapshot after emitCombatTime so the export still
      -- contains the pre-reload queue (and any last combat-time row).
      saveForCollector()
      return
    end
    snap.online = false
    enqueue("PLAYER_OFFLINE", snap, { silent = true })
    enqueue("LOGOUT", snap, { silent = true })
    local meta = flushMeta()
    if meta.export and meta.last_flush_at > 0 and (now() - meta.last_flush_at) <= 5 then
      persistCharStore()
      return
    end
    saveForCollector()
    return
  end

  if event == "CHAT_MSG_LOOT" then
    local msg = ...
    handleLootChat(msg)
    return
  end

  if event == "CHAT_MSG_TRADESKILLS" then
    local msg = ...
    handleTradeskillChat(msg)
    return
  end

  if event == "PLAYER_REGEN_DISABLED" then
    combat.entered_at = GetTime()
    return
  end

  if event == "PLAYER_REGEN_ENABLED" then
    emitCombatTime("leave_combat", true)
    refreshCombatLogButton()
    return
  end

  if event == "SKILL_LINES_CHANGED" then
    emitSelfTelemetry("skill_lines", { silent = true })
    return
  end

  if event == "QUEST_LOG_UPDATE" then
    emitSelfTelemetry("quest_log", { silent = true })
    return
  end

  if event == "UNIT_AURA" then
    local unit = ...
    if unit == "player" then
      emitSelfTelemetry("unit_aura", { silent = true })
    end
    return
  end

  if event == "PLAYER_MONEY" then
    emitSelfTelemetry("player_money", { silent = true })
    return
  end

  if event == "UNIT_ATTACK_POWER" or event == "UNIT_RANGED_ATTACK_POWER" then
    local unit = ...
    if unit == "player" then
      emitSelfTelemetry("attack_power", { silent = true })
    end
    return
  end

  if event == "PLAYER_DAMAGE_DONE_MODS" then
    emitSelfTelemetry("spell_power", { silent = true })
    return
  end
end)

-- Roster / self poll + soft reminders (never auto-reload - WoW needs a click).
if C_Timer and C_Timer.NewTicker then
  C_Timer.NewTicker(ROSTER_POLL, function()
    if not enteredWorld then
      return
    end
    emitPartyRoster("poll", { silentOnly = true })
  end)
  -- Sample yards often enough that mounted travel fits under MAX_STEP_YARDS.
  C_Timer.NewTicker(TRAVEL_POLL, function()
    if not enteredWorld then
      return
    end
    sampleTravelDistance()
  end)
  C_Timer.NewTicker(SELF_POLL, function()
    if not enteredWorld then
      return
    end
    emitSelfTelemetry("poll", { silent = true })
  end)
  C_Timer.NewTicker(60, function()
    if not enteredWorld then
      return
    end
    maybeRemindCombatLog()
    maybeRemindPush()
    if refreshCombatLogButton then
      refreshCombatLogButton()
    end
  end)
end

SLASH_FOREVERLAN1 = "/foreverlan"
SLASH_FOREVERLAN2 = "/fl"
SlashCmdList.FOREVERLAN = function(msg)
  msg = (msg or ""):gsub("^%s+", ""):gsub("%s+$", "")
  local cmd, rest = msg:match("^(%S+)%s*(.*)$")
  cmd = string.lower(cmd or "")
  rest = rest or ""
  if cmd == "" or cmd == "status" then
    ui.printStatus()
  elseif cmd == "help" or cmd == "?" then
    ui.printHelp()
  elseif cmd == "hide" then
    setSetting("show_push_button", false)
    chat("FL pin hidden - /fl show")
  elseif cmd == "show" then
    setSetting("show_push_button", true)
    if enteredWorld and ui.dock then
      ui.dock:Show()
    end
    chat("FL pin shown")
  elseif cmd == "lock" then
    setSetting("lock_push_button", not setting("lock_push_button"))
    chat(setting("lock_push_button") and "FL pin locked" or "FL pin unlocked - drag to move")
  elseif cmd == "unlock" then
    setSetting("lock_push_button", false)
    chat("FL pin unlocked - drag to move")
  elseif cmd == "combatlog" or cmd == "cl" then
    requestCombatLogOnce()
  elseif cmd == "flush" or cmd == "push" then
    ui.doPushLan()
  elseif cmd == "remember" or cmd == "add" then
    local ok, info = rememberLanName(rest)
    if ok then
      chat(string.format("LAN roster: %s |cffffffff%s|r", info, rest))
    else
      chat(info or "Could not remember name")
    end
  elseif cmd == "forget" or cmd == "remove" then
    local ok, info = forgetLanName(rest)
    if ok then
      chat(string.format("LAN roster: %s |cffffffff%s|r", info, rest ~= "" and rest or "?"))
    else
      chat(info or "Could not forget name")
    end
  elseif cmd == "roster" then
    local list = rememberedRosterList()
    if #list == 0 then
      chat("Remembered LAN names: (none) - |cffffffff/fl remember First Last|r")
    else
      chat("Remembered LAN names:")
      for _, n in ipairs(list) do
        print("  " .. n)
      end
    end
    emitPartyRoster("slash")
  elseif cmd == "quiet" then
    setSetting("announce_events", not setting("announce_events"))
    chat("Chat pings " .. (setting("announce_events") and "on" or "off"))
  else
    ui.printHelp()
  end
end

