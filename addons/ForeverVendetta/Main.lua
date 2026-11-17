local addonName, A = ...
local frame = CreateFrame("Frame")
local scanTime, syncTime = 0, 0

function A.testAlert()
    A.alert("Example Enemy", { { owner = "Your friend", report = { mode = "AVOID", note = "Camped me three times in Stranglethorn" } } }, true)
end

local function help()
    A.print("/fv opens the window. The Friends tab is where you add each other.")
    A.print("/fv add Full Name; reason  |  /fv target reason  |  /fv remove Full Name")
    A.print("/fv trust Friend Fullname  |  /fv untrust Friend Fullname  |  /fv sync")
    A.print("/fv sound on/off  |  /fv banner on/off  |  /fv instances on/off")
    A.print("/fv cooldown 60  |  /fv test  |  /fv status")
end

local function command(text)
    if not A.ready then A.print("Player identity not ready. Try after entering the world."); return end
    if not A.plain(text, "string") then text = "" end
    local cmd, rest = text:match("^%s*(%S*)%s*(.-)%s*$")
    cmd = cmd:lower()
    if cmd == "" then A.toggle()
    elseif cmd == "friends" then A.toggleFriends()
    elseif cmd == "help" then help()
    elseif cmd == "test" then A.testAlert()
    elseif cmd == "sync" then A.sync(); A.print("Asking trusted friends for their latest reports. Both of you need to be online.")
    elseif cmd == "status" then
        A.print(#A.entries() .. " reports; " .. A.count(A.store.friends) .. " friends; " .. A.pendingCount() .. " queued messages.")
        A.print(A.lastSendError or "Direct friend sync; no server. Enable enemy nameplates for detection.")
    elseif cmd == "trust" then
        local ok, err = A.trust(rest); A.print(ok and "Friend trusted. They must trust you too." or err)
        if ok then A.sync() end
    elseif cmd == "untrust" then
        local ok = A.untrust(rest)
        A.print(ok and "Friend removed; their received reports are hidden." or "Enter the friend's full character name.")
    elseif cmd == "add" or cmd == "target" or cmd == "remove" then
        local ok, err
        if cmd == "target" then ok, err = A.targetReport(rest)
        elseif cmd == "remove" then ok, err = A.report(rest, "", "AVENGE", true)
        else
            local name, note = rest:match("^(.-);%s*(.*)$")
            ok, err = A.report(name or rest, note or "")
        end
        A.print(ok and "Your report saved and queued for sharing." or err)
    elseif cmd == "sound" or cmd == "banner" or cmd == "instances" then
        if rest ~= "on" and rest ~= "off" then help(); return end
        A.store.settings[cmd] = rest == "on"; A.changed(); A.print(cmd .. ": " .. rest)
    elseif cmd == "cooldown" then
        local n = tonumber(rest)
        if not n or n < 10 or n > 600 then A.print("Choose 10 to 600 seconds."); return end
        A.store.settings.cooldown = math.floor(n); A.changed(); A.print("Alert cooldown: " .. math.floor(n) .. " seconds.")
    else help() end
end

SLASH_FOREVERVENDETTA1 = "/fv"
SLASH_FOREVERVENDETTA2 = "/vendetta"
SlashCmdList.FOREVERVENDETTA = command

frame:SetScript("OnEvent", function(_, event, ...)
    if event == "ADDON_LOADED" then
        if ... ~= addonName then return end
        if C_ChatInfo and C_ChatInfo.RegisterAddonMessagePrefix then
            local ok, result = pcall(C_ChatInfo.RegisterAddonMessagePrefix, A.PREFIX)
            if not ok or result == false then A.print("Addon messaging unavailable; local blacklist still works.") end
        end
    elseif event == "PLAYER_LOGIN" or event == "PLAYER_ENTERING_WORLD" then
        if not A.ready and A.init() then A.print("Ready. /fv opens your blacklist; /fv friends sets up sharing.") end
        if A.ready then A.sync() end
    elseif event == "CHAT_MSG_ADDON" then A.receive(...)
    elseif event == "NAME_PLATE_UNIT_ADDED" then A.detect(...)
    elseif event == "PLAYER_TARGET_CHANGED" then A.detect("target")
    elseif event == "PLAYER_FOCUS_CHANGED" then A.detect("focus")
    elseif event == "UPDATE_MOUSEOVER_UNIT" then A.detect("mouseover")
    elseif event == "GROUP_ROSTER_UPDATE" then if A.ready then A.sync() end end
end)

frame:SetScript("OnUpdate", function(_, dt)
    if not A.ready then return end
    A.pump(dt)
    scanTime, syncTime = scanTime + dt, syncTime + dt
    if syncTime >= 120 then syncTime = 0; A.sync() end
    if scanTime < 1 then return end
    scanTime = 0
    -- Recheck visible units so a freshly received report can alert immediately.
    A.detect("target"); A.detect("focus"); A.detect("mouseover")
    local plates = A.call(C_NamePlate and C_NamePlate.GetNamePlates)
    if type(plates) == "table" then
        for _, plate in ipairs(plates) do
            if A.plain(plate.namePlateUnitToken, "string") then A.detect(plate.namePlateUnitToken) end
        end
    end
end)

for _, event in ipairs({ "ADDON_LOADED", "PLAYER_LOGIN", "PLAYER_ENTERING_WORLD", "CHAT_MSG_ADDON",
    "NAME_PLATE_UNIT_ADDED", "PLAYER_TARGET_CHANGED", "PLAYER_FOCUS_CHANGED", "UPDATE_MOUSEOVER_UNIT", "GROUP_ROSTER_UPDATE" }) do
    pcall(frame.RegisterEvent, frame, event)
end
