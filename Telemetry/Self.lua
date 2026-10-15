setfenv(1, ForeverLAN_Env)

-- Plain-value APIs only. Forever can expose secret XP numbers; those are
-- unavailable telemetry, never zero XP. Called by events / existing ticker.
xpPrevious = nil
xpLastEmitAt = nil
xpLastEmitKey = nil
locationLastKey = nil
locationLastEmitAt = nil

function readPlayerXP()
  local ok, result = pcall(function()
    local xp = plainNumber(safeCall(UnitXP, "player"))
    local maximum = plainNumber(safeCall(UnitXPMax, "player"))
    local level = plainNumber(safeCall(UnitLevel, "player"))
    if not xp or not maximum or not level then return nil end
    if xp ~= xp or maximum ~= maximum or level ~= level then return nil end
    if xp < 0 or maximum <= 0 or maximum > 1000000000 or xp > maximum or level < 1 or level > 100 then return nil end
    if xp ~= math.floor(xp) or maximum ~= math.floor(maximum) or level ~= math.floor(level) then return nil end
    return { xp = xp, maximum = maximum, level = level }
  end)
  return ok and result or nil
end

function observePlayerXP(reason, force)
  if not enteredWorld then return end
  local current = readPlayerXP()
  if not current then
    -- Do not bridge an unavailable interval with an invented gain.
    xpPrevious = nil
    return
  end
  local db = charStore()
  if not db.xp_tracker or db.xp_tracker.guid ~= playerGUID then
    db.xp_tracker = { key = (playerGUID or "player") .. ":" .. tostring(now()), guid = playerGUID, observed = 0, started_at = now() }
    xpPrevious = nil
  end
  local tracker = db.xp_tracker
  local gained = 0
  if xpPrevious then
    if current.level == xpPrevious.level and current.maximum == xpPrevious.maximum and current.xp >= xpPrevious.xp then
      gained = current.xp - xpPrevious.xp
    elseif current.level == xpPrevious.level + 1 then
      -- Only a single observed rollover can be reconstructed. A skipped level
      -- or a reload starts a new baseline rather than guessing its XP cost.
      gained = xpPrevious.maximum - xpPrevious.xp + current.xp
    end
  end
  tracker.observed = (tonumber(tracker.observed) or 0) + gained
  xpPrevious = current
  local key = string.format("%d:%d:%d:%d", current.level, current.xp, current.maximum, tracker.observed)
  local clock = GetTime()
  if key == xpLastEmitKey then return end
  if not force and xpLastEmitAt and clock - xpLastEmitAt < 30 then return end
  local snap = snapshotUnit("player", {}) or {}
  enqueue("PLAYER_XP_SNAPSHOT", {
    guid = snap.guid, character = snap.character, realm = snap.realm, class = snap.class,
    is_self = true, level = current.level, xp_current = current.xp, xp_max = current.maximum,
    xp_observed = tracker.observed, xp_tracker = tracker.key, xp_started_at = tracker.started_at,
    detection = "UnitXP/UnitXPMax", reason = reason,
  }, { silent = true })
  xpLastEmitAt = clock
  xpLastEmitKey = key
end

function observePlayerLocation(reason, force)
  if not enteredWorld then return end
  local zone = safeCall(GetZoneText)
  local subzone = safeCall(GetSubZoneText)
  if not isPlainString(zone) or not isPlainString(subzone) then return end
  if zone == "" then return end
  local key = zone .. "\n" .. subzone
  if key == locationLastKey then return end
  local clock = GetTime()
  -- Bound border oscillation to one record per ten seconds. The existing
  -- ticker retries a suppressed transition without an extra timer.
  if not force and locationLastEmitAt and clock - locationLastEmitAt < 10 then return end
  local snap = snapshotUnit("player", {}) or {}
  enqueue("PLAYER_LOCATION", {
    guid = snap.guid, character = snap.character, realm = snap.realm, class = snap.class,
    is_self = true, zone = zone, subzone = subzone,
    detection = "GetZoneText/GetSubZoneText", reason = reason,
  }, { silent = true })
  locationLastKey = key
  locationLastEmitAt = clock
end

function readProfessions()
  local list = {}
  local method = "unavailable"

  if GetProfessions and GetProfessionInfo then
    -- Forever's installed professions UI uses slot 3 for First Aid.
    local p1, p2, firstAid, fish, cook = safeCall(GetProfessions)
    local function add(idx, kind)
      if not idx then
        return
      end
      local name, _icon, rank, maxRank = safeCall(GetProfessionInfo, idx)
      rank, maxRank = plainNumber(rank), plainNumber(maxRank)
      if isPlainString(name) and rank and maxRank and rank >= 0 and rank <= maxRank and maxRank > 0 and rank == math.floor(rank) and maxRank == math.floor(maxRank) then
        list[#list + 1] = {
          name = name,
          rank = rank or 0,
          max_rank = maxRank or 0,
          kind = kind == "first_aid" and name ~= "First Aid" and "secondary" or kind,
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
    local n = plainNumber(safeCall(GetNumSkillLines)) or 0
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
      elseif section and isPlainString(name) and plainNumber(rank) and plainNumber(maxRank) and rank >= 0 and rank <= maxRank and maxRank > 0 then
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

function professionsKey(list)
  local parts = {}
  for _, p in ipairs(list) do
    parts[#parts + 1] = string.format("%s:%d/%d", tostring(p.name), p.rank or 0, p.max_rank or 0)
  end
  table.sort(parts)
  return table.concat(parts, "|")
end

--- Lifetime completed quests (self) + in-log counts.
function readQuestProgress()
  local completed = nil
  local completedIDs = nil
  local method = "unavailable"

  if GetQuestsCompleted then
    -- Classic variants may fill a supplied table instead of returning one.
    local supplied = {}
    local ok, t = pcall(GetQuestsCompleted, supplied)
    if ok and t == nil then t = supplied end
    if type(t) == "table" then
      completedIDs = {}
      for id, done in pairs(t) do
        if plainNumber(id) and id > 0 and not (issecretvalue and issecretvalue(done)) and (done == true or done == 1) then completedIDs[id] = true end
      end
      method = "GetQuestsCompleted"
    end
  end
  if not completedIDs and C_QuestLog and C_QuestLog.GetAllCompletedQuestIDs then
    local ids = safeCall(C_QuestLog.GetAllCompletedQuestIDs)
    if type(ids) == "table" then
      completedIDs = {}
      for _, id in ipairs(ids) do
        if plainNumber(id) and id > 0 then completedIDs[id] = true end
      end
      method = "C_QuestLog.GetAllCompletedQuestIDs"
    end
  end

  if completedIDs then
    completed = 0
    for _ in pairs(completedIDs) do completed = completed + 1 end
  end
  local inLog, ready = nil, nil
  if GetNumQuestLogEntries and GetQuestLogTitle then
    local n = plainNumber(safeCall(GetNumQuestLogEntries))
    if n and n >= 0 then inLog, ready = 0, 0 end
    n = n or 0
    for i = 1, n do
      local title, _level, _sg, isHeader, _col, isComplete = safeCall(GetQuestLogTitle, i)
      if isPlainString(title) and not isHeader then
        inLog = inLog + 1
        if not (issecretvalue and issecretvalue(isComplete)) and (isComplete == true or isComplete == 1) then
          ready = ready + 1
        end
      end
    end
  end
  -- The installed Forever quest UI uses this namespaced log API. Completion
  -- history remains a separate guarded probe; a ready quest is not a turn-in.
  if inLog == nil and C_QuestLog and C_QuestLog.GetNumQuestLogEntries and C_QuestLog.GetInfo then
    local n = plainNumber(safeCall(C_QuestLog.GetNumQuestLogEntries))
    if n and n >= 0 then
      inLog = 0
      ready = C_QuestLog.IsComplete and 0 or nil
      for i = 1, n do
        local info = safeCall(C_QuestLog.GetInfo, i)
        if type(info) == "table" and isPlainString(info.title) and not info.isHeader then
          inLog = inLog + 1
          if ready ~= nil then
            local complete = safeCall(C_QuestLog.IsComplete, info.questID)
            if complete == nil or (issecretvalue and issecretvalue(complete)) then ready = nil
            elseif complete == true then ready = ready + 1 end
          end
        end
      end
    end
  end

  return {
    completed = completed,
    completed_ids = completedIDs,
    in_log = inLog,
    ready_to_turn_in = ready,
    method = method,
  }
end

-- Aggregate newly observed completion IDs. Login is a baseline, never a burst
-- of lifetime quests. Missing APIs break continuity instead of guessing.
questObservation = { previous = nil, key = nil, emitted_at = nil }
function observeQuestProgress(progress, reason, force)
  local ids = progress.completed_ids
  if not ids then questObservation.previous = nil; return end
  local db = charStore()
  if not db.quest_tracker or db.quest_tracker.guid ~= playerGUID then
    db.quest_tracker = { guid = playerGUID, key = (playerGUID or "player") .. ":quests:" .. tostring(now()), observed = 0 }
    questObservation.previous = nil
  end
  local tracker = db.quest_tracker
  if questObservation.previous then
    for id in pairs(ids) do
      if not questObservation.previous[id] then tracker.observed = tracker.observed + 1 end
    end
  end
  questObservation.previous = ids
  local key = tostring(tracker.observed) .. ":" .. tostring(progress.in_log) .. ":" .. tostring(progress.ready_to_turn_in)
  local clock = GetTime()
  if key == questObservation.key then return end
  if not force and questObservation.emitted_at and clock - questObservation.emitted_at < 30 then return end
  local snap = snapshotUnit("player", {}) or {}
  enqueue("PLAYER_QUEST_PROGRESS", {
    guid = snap.guid, character = snap.character, realm = snap.realm, class = snap.class,
    is_self = true, quests_observed = tracker.observed, quest_tracker = tracker.key,
    quests_in_log = progress.in_log, quests_ready = progress.ready_to_turn_in,
    detection = progress.method, reason = reason,
  }, { silent = true })
  questObservation.key, questObservation.emitted_at = key, clock
end

function isFoodBuffName(name)
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
function readFoodBuff()
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

function sampleTravelDistance()
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

function readCombatPower()
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

function powerKey(p)
  return string.format(
    "ap:%s|rap:%s|sp:%s|heal:%s",
    tostring(p.attack_power),
    tostring(p.ranged_attack_power),
    tostring(p.spell_power),
    tostring(p.spell_healing)
  )
end

function readMoney()
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
selfTelemetryGate = {
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

function emitSelfTelemetry(reason, opts)
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
  observePlayerXP(reason, reason == "login")
  observePlayerLocation(reason, reason == "login")
  local snap = snapshotUnit("player", {}) or {}
  local silent = opts.silent ~= false

  local professions, profMethod = readProfessions()
  local pk = professionsKey(professions)
  if profMethod ~= "unavailable" and pk ~= lastProfKey and (#professions > 0 or lastProfKey ~= nil) then
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
  observeQuestProgress(quests, reason, reason == "login")
  if quests.completed ~= nil and (lastQuestCompleted == nil or quests.completed ~= lastQuestCompleted) then
    local prev = lastQuestCompleted
    lastQuestCompleted = quests.completed
    if prev ~= nil or quests.completed > 0 or (quests.in_log or 0) > 0 then
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
