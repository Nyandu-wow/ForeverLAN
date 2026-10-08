setfenv(1, ForeverLAN_Env)

-- Party hello: announce this character's GUID to groupmates running ForeverLAN.
COMMS_PREFIX = "ForeverLAN"
HELLO_MIN_GAP = 5
lastHelloAt = 0

function commsAvailable()
  return C_ChatInfo ~= nil and C_ChatInfo.SendAddonMessage ~= nil
end

function sendHello(force)
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

function onAddonMessage(prefix, text)
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

frame = CreateFrame("Frame")
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

_G.ForeverLAN_Env = nil
