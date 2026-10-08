setfenv(1, ForeverLAN_Env)

function hookJumpTelemetry()
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

function hookMapTelemetry()
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

function readMemberZone(unit, raidIndex)
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
function probePosition(unit)
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

function attachPosition(snap, unit)
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

function collectGroupMembers(opts)
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

function emitDetected(snap, reason)
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

MAX_CORPSE_RUN_SECONDS = 2 * 60 * 60

function markDeathStart(guid)
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

function corpseRunDuration(guid)
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

function emitPlaying(snap)
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

function processMemberChanges(snap)
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

function emitPartyRoster(reason, opts)
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

function checkPlayerInstanceTransition()
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
