setfenv(1, ForeverLAN_Env)

-- Tiny linking pin: collect quietly, flush on click, combat log on right-click.
-- No options panel, no minimap button, no status meter - the board is elsewhere.

-- Events that re-fire every login and should not alone make the pin scream.
-- Everything else newer than last Push counts as unsaved (honest badge).
NOISE_FOR_BADGE = {
  LOGIN = true,
  LOGOUT = true,
  WORLD_ENTER = true,
  PLAYER_PLAYING = true,
  PLAYER_DETECTED = true,
  PLAYER_ONLINE = true,
  PLAYER_OFFLINE = true,
  PING = true,
}

function pendingCountForButton()
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

function pinStatusLine()
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

function inCombatNow()
  if UnitAffectingCombat and UnitAffectingCombat("player") then
    return true
  end
  if InCombatLockdown and InCombatLockdown() then
    return true
  end
  return false
end

function maybeRemindPush()
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

function maybeRemindCombatLog()
  -- Intentionally quiet. Use right-click on FL or type /combatlog once.
end

ui.doPushLan = function()
  emitPartyRoster("flush")
  -- Summarize before flush so "new since last Push" is still meaningful.
  local newCount, alreadyCount, total, breakdown = summarizePendingForPush()
  flushForPush()
  -- Do not chat() here: ReloadUI clears those lines. Persist, print after reload.
  storePushReport(buildPushReportLines(newCount, alreadyCount, total, breakdown))
  ui.refreshPushButton()
  lastPushRemindAt = now()
  lastQueueCapRemindAt = now()
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

pinBg = ui.dock:CreateTexture(nil, "BACKGROUND")
pinBg:SetAllPoints()
pinBg:SetTexture("Interface\\Buttons\\WHITE8X8")
pinBg:SetVertexColor(0.05, 0.05, 0.06, 0.85)
ui.dock.bg = pinBg

pinFs = ui.dock:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
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
combatLogClickPending = false
combatSlashSent = false

function noteCombatLogChat(msg)
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

combatWatch = CreateFrame("Frame")
combatWatch:RegisterEvent("CHAT_MSG_SYSTEM")
combatWatch:SetScript("OnEvent", function(_, _, msg)
  noteCombatLogChat(msg)
end)

function sendCombatLogSlash()
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

function finishCombatLogAttempt(_)
  combatLogClickPending = false
  if refreshCombatLogButton then
    refreshCombatLogButton()
  end
end

function requestCombatLogOnce()
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
