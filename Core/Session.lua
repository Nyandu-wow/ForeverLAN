setfenv(1, ForeverLAN_Env)

enteredWorld = false
playerGUID = nil
hintShown = false
combatLogHintShown = false
lastPushRemindAt = 0
lastQueueCapRemindAt = 0
lastCombatLogRemindAt = 0
combatLogRemindCount = 0
PUSH_REMIND_SEC = 720 -- 12 min between push nudges
QUEUE_CAP_REMIND_SEC = 180 -- 3 min between queue-full nudges (gentler spam guard)
QUEUE_SOFT_WARN = 1200 -- ~80% of MAX_PENDING
COMBATLOG_REMIND_SEC = 900 -- 15 min between combat-log nudges
COMBATLOG_REMIND_MAX = 3 -- per session
-- Set while Push LAN triggers C_UI.Reload so LOGOUT does not mark the board Offline.
pushingLan = false
-- One-shot guard so Push summary is not printed twice (LOGIN + ENTERING_WORLD).
pushReportPrintedThisLoad = false

tracked = {}
lastInstanceState = nil
lastInstanceName = ""

-- Self-only session probes (professions / quests / food / distance)
lastProfKey = nil
lastQuestCompleted = nil
lastFoodKey = nil
lastPowerKey = nil
lastMoneyCopper = nil
mapOpens = 0
minimapOpens = 0
lastMapOpensEmitted = -1
lastMinimapOpensEmitted = -1
worldMapHooked = false
minimapHooked = false
jumpHooked = false
travel = {
  yards = 0,
  jumps = 0,
  last_x = nil,
  last_y = nil,
  last_z = nil,
  last_instance = nil,
  emitted_yards = 0,
  emitted_jumps = 0,
}
combat = {
  entered_at = nil,
  seconds = 0,
  emitted = 0,
}

restoredTotals = false

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


-- Remembered LAN names: builtins (friend pack) + ForeverLANDB.settings (user /fl remember).
rosterKeys = {}
rosterAliases = {}

function rebuildRosterIndex()
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

function rememberedRosterList()
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

function rememberLanName(fullName)
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

function forgetLanName(fullName)
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

function isRememberedLanName(name)
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
addonGuids = {}

-- Played character always syncs. Party members sync when they run ForeverLAN
-- (hello by GUID) or their exact full name is on the remembered roster.
function shouldSyncCharacter(name, isSelf, guid)
  if isSelf then
    return true
  end
  if guid and guid ~= "" and addonGuids[guid] then
    return true
  end
  return isRememberedLanName(name)
end
