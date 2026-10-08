setfenv(1, ForeverLAN_Env)

lastPlayingKey = nil

function now()
  return time()
end

function nextId()
  seq = seq + 1
  local guid = playerGUID or UnitGUID("player") or "unknown"
  return string.format("%s-%d-%d", guid, now(), seq)
end

function jsonEscape(s)
  s = tostring(s)
  s = s:gsub("\\", "\\\\")
  s = s:gsub('"', '\\"')
  s = s:gsub("\n", "\\n")
  s = s:gsub("\r", "\\r")
  s = s:gsub("\t", "\\t")
  return s
end

function jsonValue(v)
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
function touchPending()
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

function buildExportString()
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

function chat(msg)
  DEFAULT_CHAT_FRAME:AddMessage("|cff7ad1ff[ForeverLAN]|r " .. tostring(msg))
end

--- Gentle nudge when the local queue is near/at capacity (host may be offline).
function maybeRemindQueuePressure(droppedCount)
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

function persistPending()
  touchPending()
end

function clearPendingBuffer()
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
function saveForCollector()
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
function flushForPush()
  return saveForCollector()
end

function reloadForCollector()
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

function isCombatLogging()
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
function setCombatLogUiOn(on)
  ForeverLANDB = ForeverLANDB or {}
  ForeverLANDB.combat_log_on = on and true or false
end

function combatLogUiOn()
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

function combatLogStatusLabel()
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

function recordCapabilities()
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

function showCombatLogHint()
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

function findCoalesceTarget(eventType, fields)
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

function enqueue(eventType, fields, opts)
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

function showLoadHint()
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
