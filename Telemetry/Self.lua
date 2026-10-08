setfenv(1, ForeverLAN_Env)

function readProfessions()
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

function professionsKey(list)
  local parts = {}
  for _, p in ipairs(list) do
    parts[#parts + 1] = string.format("%s:%d/%d", tostring(p.name), p.rank or 0, p.max_rank or 0)
  end
  table.sort(parts)
  return table.concat(parts, "|")
end

-- Optional /fl craftprobe: listen for craft/gather chat without enqueueing events.
craftProbeFrame = nil
craftProbeHits = nil
craftProbeStopAt = 0

function craftProbeIsSelfMessage(msg)
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

function craftProbeApiSnapshot()
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

function stopCraftProbe(reason)
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

function startCraftProbe(seconds)
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
function readQuestProgress()
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
