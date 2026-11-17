local _, A = ...
local unpack = unpack or table.unpack
local W, H, ROWS = 860, 590, 5
local GOLD, WHITE, MUTED = {1,.82,.35}, {.92,.92,.90}, {.62,.65,.69}
local STANCES = {
    {id="AVENGE", label="Avenge", color={1,.40,.32}, hint="You want another fight with this player."},
    {id="AVOID", label="Avoid", color={1,.73,.30}, hint="Warn your friends to give this player space."},
    {id="WATCH", label="Watch", color={.36,.77,.94}, hint="Keep an eye on this player."},
}
local panel, banner, pages, nav, ui = nil, nil, {}, {}, {}
local rows, friendRows, filters, stanceButtons = {}, {}, {}, {}
local view, page, friendPage, filter, mode = "enemies", 1, 1, "ALL", "AVENGE"
local selected, selectedRealm, filling, armedFriend, armedWithdraw
local selectEnemy, refreshEditor

local function text(parent, value, x, y, width, font, color)
    local f = parent:CreateFontString(nil, "OVERLAY", font or "GameFontHighlight")
    f:SetPoint("TOPLEFT", x, -y); f:SetWidth(width)
    f:SetJustifyH("LEFT"); f:SetJustifyV("TOP")
    f:SetTextColor(unpack(color or WHITE)); f:SetText(value)
    return f
end
local function rect(parent, x, y, w, h, color, layer)
    local t = parent:CreateTexture(nil, layer or "BACKGROUND")
    t:SetPoint("TOPLEFT", x, -y); t:SetSize(w,h); t:SetColorTexture(unpack(color))
    return t
end
local function box(parent, x, y, w, h)
    local f = CreateFrame("Frame", nil, parent)
    f:SetPoint("TOPLEFT",x,-y); f:SetSize(w,h)
    rect(f,0,0,w,h,{.035,.045,.055,.96}); rect(f,0,0,w,1,{.30,.28,.21,.8})
    return f
end
local function button(parent, value, x, y, w, callback)
    local b = CreateFrame("Button",nil,parent,"UIPanelButtonTemplate")
    b:SetPoint("TOPLEFT",x,-y); b:SetSize(w,26); b:SetText(value)
    b:SetScript("OnClick",callback); return b
end
local function tip(frame, title, body)
    frame:SetScript("OnEnter",function(self)
        if not GameTooltip then return end
        GameTooltip:SetOwner(self,"ANCHOR_RIGHT"); GameTooltip:SetText(title,unpack(GOLD))
        GameTooltip:AddLine(body,.9,.9,.9,true); GameTooltip:Show()
    end)
    frame:SetScript("OnLeave",function() if GameTooltip then GameTooltip:Hide() end end)
end
local function edit(parent,x,y,w,max,multi)
    local e = CreateFrame("EditBox",nil,parent)
    e:SetPoint("TOPLEFT",x,-y); e:SetSize(w,multi and 54 or 28)
    e:SetFontObject("GameFontHighlight"); e:SetTextInsets(8,8,5,5)
    e:SetAutoFocus(false); e:SetMaxBytes(max); e:SetMultiLine(multi == true)
    rect(e,0,0,w,multi and 54 or 28,{.015,.02,.025,1})
    local line = rect(e,0,multi and 53 or 27,w,1,{.35,.37,.40,1})
    e:SetScript("OnEditFocusGained",function() line:SetColorTexture(unpack(GOLD)) end)
    e:SetScript("OnEditFocusLost",function() line:SetColorTexture(.35,.37,.40,1) end)
    e:SetScript("OnEscapePressed",function(self) self:ClearFocus() end)
    e:SetText(""); return e
end
local function placeholder(e, value)
    local hint=text(e,value,8,7,285,"GameFontHighlightSmall",MUTED)
    local previous=e:GetScript("OnTextChanged")
    e:SetScript("OnTextChanged",function(self,user)
        hint:SetShown(self:GetText()=="")
        if previous then previous(self,user) end
    end)
end
local function fit(frame,w,h)
    frame:SetClampedToScreen(true)
    local scale = 1
    local height = A.call(UIParent and UIParent.GetHeight,UIParent)
    local width = A.call(UIParent and UIParent.GetWidth,UIParent)
    if A.plain(height,"number") and height > 160 then scale = math.min(scale,(height-40)/h) end
    if A.plain(width,"number") and width > 160 then scale = math.min(scale,(width-40)/w) end
    frame:SetScale(scale)
end
local function feedback(msg,bad)
    if ui.feedback then ui.feedback:SetTextColor(unpack(bad and STANCES[1].color or GOLD)); ui.feedback:SetText(msg) end
end
local function switch(to)
    view = to; armedFriend,armedWithdraw = nil,nil
    for id,p in pairs(pages) do p:SetShown(panel:IsShown() and id == view) end
    A.refresh()
end
-- Group presentation only. Each author's stored report remains independent.
local function groups()
    local list,lookup = {},{}
    for _,entry in ipairs(A.entries()) do
        local key = A.enemyName(entry.key)
        local g = lookup[key]
        if not g then
            g={key=key,name=entry.report.name,reports={},modes={}}
            lookup[key]=g; list[#list+1]=g
        end
        g.reports[#g.reports+1]=entry; g.modes[entry.report.mode]=true
    end
    table.sort(list,function(a,b) return a.key < b.key end)
    return list,lookup
end
local function ownReport(g)
    if g then for _,e in ipairs(g.reports) do if e.owner == A.me.key then return e.report end end end
end
local function stanceInfo(id)
    for _,s in ipairs(STANCES) do if s.id == id then return s end end
    return STANCES[1]
end
local function newReport()
    selected,selectedRealm,armedWithdraw=nil,nil,nil
    filling=true; ui.name:SetText(""); ui.note:SetText(""); filling=false; mode="AVENGE"
    ui.historyScroll:SetVerticalScroll(0)
    feedback("Enter their full name, choose a stance, and save your report.")
    A.refresh(); ui.name:SetFocus()
end
selectEnemy=function(g)
    selected,armedWithdraw=g.key,nil
    local own=ownReport(g)
    selectedRealm=own and own.realm or A.realm()
    filling=true; ui.name:SetText(g.name)
    -- Never silently copy another author's reason into your report.
    ui.note:SetText(own and own.note or ""); filling=false
    mode=own and own.mode or "AVENGE"
    ui.historyScroll:SetVerticalScroll(0)
    feedback(own and "Editing your report. Your friends' reports stay separate." or "Read your friends' reports below, then add your own if you wish.")
    A.refresh()
end
local function saveReport()
    local who=A.sender(ui.name:GetText())
    if not who or not who.name:find("%s") then
        feedback("Enter a first name and surname, or use Add target.",true); ui.name:SetFocus(); return
    end
    local ok,err=A.report(who.name,ui.note:GetText(),mode,false,selectedRealm)
    if not ok then feedback(err or "Could not save that report.",true); return end
    selected,selectedRealm=who.name:lower(),selectedRealm or who.realm; armedWithdraw=nil
    ui.name:SetText(who.name)
    ui.name:ClearFocus(); ui.note:ClearFocus()
    feedback(A.count(A.store.friends)==0 and "Report saved locally. Add friends to share it." or "Report saved. Sharing when your friends are online.")
    A.refresh()
end
local function useTarget()
    if not A.flag(UnitIsPlayer,"target") or not A.flag(UnitIsEnemy,"player","target") then
        feedback("Select an enemy player in the game, then click Add target.",true); return
    end
    local who=A.unitName("target")
    if not who then feedback("That name is unavailable. Try outside combat or enter it yourself.",true); return end
    local _,lookup=groups()
    if lookup[who.name:lower()] then selectEnemy(lookup[who.name:lower()])
    else newReport(); filling=true; ui.name:SetText(who.name); filling=false; selectedRealm=who.realm end
    switch("enemies"); ui.note:SetFocus(); feedback("Target filled in. Choose a stance and save your report.")
end
refreshEditor=function(lookup)
    local g=selected and lookup[selected]
    local own=ownReport(g)
    ui.editorTitle:SetText(own and "Edit your report" or "Add your report")
    ui.save:SetText(own and "Save changes" or "Save report")
    ui.withdraw:SetEnabled(own~=nil); ui.withdraw:SetText(armedWithdraw and "Confirm removal" or "Withdraw mine")
    for _,s in ipairs(STANCES) do
        stanceButtons[s.id]:SetText((mode==s.id and "|cffffd159" or "")..s.label..(mode==s.id and "|r" or ""))
        stanceButtons[s.id].mark:SetShown(mode==s.id)
    end
    ui.stanceHint:SetText(stanceInfo(mode).hint)
    ui.historyTitle:SetText(g and (#g.reports..(#g.reports==1 and " report on this enemy" or " reports on this enemy")) or "Your friends' reports")
    local lines={}
    if g then for _,entry in ipairs(g.reports) do
        local r=entry.report
        lines[#lines+1]="|cffffd159"..(entry.owner==A.me.key and "You" or A.personName(entry.owner))..
            "|r  -  "..stanceInfo(r.mode).label.."\n"..(r.note~="" and r.note or "No reason provided.")
    end end
    ui.history:SetText(#lines>0 and table.concat(lines,"\n\n") or "Select an enemy to read every report.\n\nYour reason stays separate from your friends' reasons.")
    local height=A.call(ui.history.GetStringHeight,ui.history)
    ui.historyChild:SetHeight(math.max(110,A.plain(height,"number") and height+8 or 110))
end
function A.refresh()
    if not panel or not panel:IsShown() then return end
    local all,lookup=groups()
    local filtered,query={},ui.search:GetText():lower()
    for _,g in ipairs(all) do
        local haystack=g.name
        for _,e in ipairs(g.reports) do haystack=haystack.." "..e.report.note.." "..A.personName(e.owner) end
        if (filter=="ALL" or g.modes[filter]) and haystack:lower():find(query,1,true) then filtered[#filtered+1]=g end
    end
    local count=math.max(1,math.ceil(#filtered/ROWS))
    page=math.max(1,math.min(page,count))
    ui.summary:SetText(#all..(#all==1 and " enemy" or " enemies").."  /  "..#A.entries().." reports  /  "..A.count(A.store.friends).." friends")
    ui.pagination:SetText(#filtered==0 and "No results" or ("Page "..page.." of "..count))
    ui.prev:SetEnabled(page>1); ui.next:SetEnabled(page<count); ui.clearSearch:SetEnabled(query~="")
    for id,b in pairs(filters) do
        b.mark:SetShown(id==filter)
        b:SetText((id==filter and "|cffffd159" or "")..b.caption..(id==filter and "|r" or ""))
    end
    for i,row in ipairs(rows) do
        local g=filtered[(page-1)*ROWS+i]
        row.group=g; row:SetShown(g~=nil)
        if g then
            row.name:SetText(g.name)
            local s=stanceInfo(g.modes.AVOID and "AVOID" or (g.modes.AVENGE and "AVENGE" or "WATCH"))
            row.tag:SetText(A.count(g.modes)>1 and "Mixed reports" or s.label)
            row.tag:SetTextColor(unpack(s.color)); row.stripe:SetColorTexture(unpack(s.color))
            row.detail:SetText(#g.reports..(#g.reports==1 and " report" or " reports")..(ownReport(g) and "  /  Includes yours" or "  /  From your friends"))
            row.bg:SetColorTexture(unpack(selected==g.key and {.21,.17,.085,1} or {.075,.085,.10,1}))
        end
    end
    ui.empty:SetShown(#filtered==0)
    ui.emptyTitle:SetText(#all==0 and "Your blacklist starts here" or "No enemies match")
    ui.emptyBody:SetText(#all==0 and "Target an enemy and click Add target.\nOr choose Add enemy to enter their full name.\n\nAdd your friends to share reports." or "Try another name or reason,\nor switch the stance filter back to All.")
    refreshEditor(lookup)
    for id,b in pairs(nav) do
        b.mark:SetShown(view==id)
        b:SetText((view==id and "|cffffd159" or "")..b.caption..(view==id and "|r" or ""))
    end
    local friends={}
    for _,peer in pairs(A.store.friends) do friends[#friends+1]=peer end
    table.sort(friends,function(a,b) return a.name < b.name end)
    local maxFriends=math.max(1,math.ceil(#friends/7))
    friendPage=math.max(1,math.min(friendPage,maxFriends))
    ui.friendPagination:SetText(#friends==0 and "No trusted friends yet" or ("Page "..friendPage.." of "..maxFriends))
    ui.friendPrev:SetEnabled(friendPage>1); ui.friendNext:SetEnabled(friendPage<maxFriends)
    ui.friendEmpty:SetShown(#friends==0)
    for i,row in ipairs(friendRows) do
        local peer=friends[(friendPage-1)*7+i]
        row.peer=peer; row:SetShown(peer~=nil)
        if peer then
            local n=0
            for _,r in pairs(A.store.reports[peer.key] or {}) do if not r.deleted then n=n+1 end end
            row.name:SetText(peer.name)
            local received=A.store.lastReceived and A.store.lastReceived[peer.key]
            row.detail:SetText(received and (n.." reports received") or "No report received yet")
            row.remove:SetText(armedFriend==peer.key and "Confirm" or "Remove")
        end
    end
    for key,c in pairs(ui.checks) do c:SetChecked(A.store.settings[key]==true) end
    ui.cooldownLabel:SetText(A.store.settings.cooldown.." seconds")
    if ui.cooldown:GetValue()~=A.store.settings.cooldown then ui.cooldown:SetValue(A.store.settings.cooldown) end
    ui.footer:SetText((A.store.settings.instances and "Alerts in all zones" or "Open-world alerts").."  /  "..A.store.settings.cooldown.."s alert cooldown")
end
local function buildEnemies()
    local p=pages.enemies
    local list=box(p,16,0,474,408)
    ui.search=edit(list,14,14,302,96)
    tip(ui.search,"Search blacklist","Find an enemy, a reporting friend, or words in a reason.")
    ui.search:SetScript("OnTextChanged",function() page=1; A.refresh() end)
    placeholder(ui.search,"Search names, friends or reasons...")
    ui.clearSearch=button(list,"Clear search",330,15,130,function() ui.search:SetText("") end)
    for i,item in ipairs({{"ALL","All"},{"AVENGE","Avenge"},{"AVOID","Avoid"},{"WATCH","Watch"}}) do
        local id,caption=item[1],item[2]
        local b=button(list,caption,14+(i-1)*113,55,107,function() filter=id; page=1; A.refresh() end)
        b.caption=caption; b.mark=rect(b,5,25,97,2,{1,.75,.22,1},"OVERLAY"); filters[id]=b
    end
    for i=1,ROWS do
        local row=CreateFrame("Button",nil,list)
        row:SetPoint("TOPLEFT",14,-94-(i-1)*54); row:SetSize(446,48)
        row.bg=rect(row,0,0,446,48,{.075,.085,.10,1})
        row.stripe=rect(row,0,0,3,48,{1,.4,.3,1},"ARTWORK")
        row:SetHighlightTexture("Interface\\QuestFrame\\UI-QuestTitleHighlight","ADD")
        row.name=text(row,"",12,7,280); row.detail=text(row,"",12,27,305,"GameFontHighlightSmall",MUTED)
        row.tag=text(row,"",316,15,120,"GameFontNormalSmall")
        row.name:SetWordWrap(false); row.detail:SetWordWrap(false); row.tag:SetWordWrap(false)
        row:SetScript("OnEnter",function(self)
            if not self.group or not GameTooltip then return end
            GameTooltip:SetOwner(self,"ANCHOR_RIGHT"); GameTooltip:SetText(self.group.name,unpack(GOLD))
            GameTooltip:AddLine("Click to read every report and edit your own.",.9,.9,.9,true); GameTooltip:Show()
        end)
        row:SetScript("OnLeave",function() if GameTooltip then GameTooltip:Hide() end end)
        row:SetScript("OnClick",function(self) if self.group then selectEnemy(self.group) end end)
        rows[i]=row
    end
    ui.empty=CreateFrame("Frame",nil,list); ui.empty:SetPoint("TOPLEFT",25,-145); ui.empty:SetSize(420,170)
    ui.emptyTitle=text(ui.empty,"",0,0,410,"GameFontNormalLarge",GOLD)
    ui.emptyBody=text(ui.empty,"",0,35,410,"GameFontHighlight",MUTED)
    ui.prev=button(list,"Previous",14,373,95,function() page=page-1; A.refresh() end)
    ui.pagination=text(list,"",130,380,165,"GameFontHighlightSmall",MUTED)
    ui.next=button(list,"Next",365,373,95,function() page=page+1; A.refresh() end)
    local e=box(p,504,0,340,408)
    ui.editorTitle=text(e,"Add your report",14,14,310,"GameFontNormalLarge",GOLD)
    text(e,"Enemy full name",14,45,310,"GameFontHighlightSmall",MUTED)
    ui.name=edit(e,14,62,312,64)
    ui.name:SetScript("OnTextChanged",function(_,user)
        if user and not filling then selected,selectedRealm,armedWithdraw=nil,nil,nil; A.refresh() end
    end)
    ui.name:SetScript("OnEnterPressed",function() ui.note:SetFocus() end)
    ui.name:SetScript("OnTabPressed",function() ui.note:SetFocus() end)
    placeholder(ui.name,"First name and surname")
    for i,s in ipairs(STANCES) do
        local b=button(e,s.label,14+(i-1)*106,104,100,function() mode=s.id; A.refresh() end)
        b.mark=rect(b,5,25,90,2,{1,.75,.22,1},"OVERLAY"); tip(b,s.label,s.hint); stanceButtons[s.id]=b
    end
    ui.stanceHint=text(e,"",14,138,312,"GameFontHighlightSmall",MUTED)
    text(e,"Reason (optional)",14,166,310,"GameFontHighlightSmall",MUTED)
    local noteScroll=CreateFrame("ScrollFrame",nil,e)
    noteScroll:SetPoint("TOPLEFT",14,-184); noteScroll:SetSize(312,54)
    rect(noteScroll,0,0,312,54,{.015,.02,.025,1})
    ui.note=edit(noteScroll,0,0,312,96,true); noteScroll:SetScrollChild(ui.note)
    ui.note:SetScript("OnTabPressed",function() ui.name:SetFocus() end)
    ui.note:SetScript("OnCursorChanged",function(_,_,y,_,height)
        local current=noteScroll:GetVerticalScroll()
        if not A.plain(current,"number") then current=0 end
        local bottom=-y+height
        if -y<current then noteScroll:SetVerticalScroll(-y)
        elseif bottom>current+54 then noteScroll:SetVerticalScroll(bottom-54) end
    end)
    ui.save=button(e,"Save report",14,249,151,saveReport)
    ui.withdraw=button(e,"Withdraw mine",175,249,151,function()
        local _,lookup=groups()
        local own=ownReport(selected and lookup[selected])
        if not own then return end
        if armedWithdraw~=selected then
            armedWithdraw=selected; feedback("Click Confirm removal to withdraw only your report."); A.refresh(); return
        end
        local ok,err=A.report(own.name,own.note,own.mode,true,own.realm)
        armedWithdraw=nil; feedback(ok and "Your report was withdrawn. Your friends' reports stay." or err,not ok)
        if ok then ui.note:SetText("") end
        A.refresh()
    end)
    tip(ui.withdraw,"Withdraw your report","Only your current character's report is removed. Friends' reports remain. Click twice to confirm.")
    ui.historyTitle=text(e,"Your friends' reports",14,291,310,"GameFontNormalSmall",GOLD)
    local scroll=CreateFrame("ScrollFrame",nil,e,"UIPanelScrollFrameTemplate")
    ui.historyScroll=scroll
    scroll:SetPoint("TOPLEFT",14,-313); scroll:SetSize(288,82)
    ui.historyChild=CreateFrame("Frame",nil,scroll); ui.historyChild:SetSize(288,110); scroll:SetScrollChild(ui.historyChild)
    ui.history=text(ui.historyChild,"",0,0,280,"GameFontHighlightSmall")
end
local function buildFriends()
    local p=pages.friends
    local list=box(p,16,0,474,408)
    text(list,"Trusted friends",14,14,430,"GameFontNormalLarge",GOLD)
    text(list,"Only these characters can exchange reports with you.",14,43,442,"GameFontHighlightSmall",MUTED)
    for i=1,7 do
        local row=CreateFrame("Frame",nil,list)
        row:SetPoint("TOPLEFT",14,-72-(i-1)*41); row:SetSize(446,37)
        rect(row,0,0,446,37,{.075,.085,.10,1})
        row.name=text(row,"",9,3,325); row.detail=text(row,"",9,21,325,"GameFontHighlightSmall",MUTED)
        row.name:SetWordWrap(false); row.detail:SetWordWrap(false)
        row.remove=button(row,"Remove",345,6,92,function()
            if not row.peer then return end
            if armedFriend~=row.peer.key then
                armedFriend=row.peer.key; feedback("Click Confirm to stop sharing and hide this friend's reports."); A.refresh(); return
            end
            local name=row.peer.name; A.untrust(name); armedFriend=nil; A.refresh()
            feedback(name.." removed from trusted friends.")
        end)
        friendRows[i]=row
    end
    ui.friendEmpty=text(list,"No trusted friends yet.\nAdd a character using the panel on the right.",20,130,430,"GameFontHighlight",MUTED)
    ui.friendPrev=button(list,"Previous",14,373,95,function() friendPage=friendPage-1; A.refresh() end)
    ui.friendPagination=text(list,"",125,380,220,"GameFontHighlightSmall",MUTED)
    ui.friendNext=button(list,"Next",365,373,95,function() friendPage=friendPage+1; A.refresh() end)
    local setup=box(p,504,0,340,408)
    text(setup,"Connect with a friend",14,14,310,"GameFontNormalLarge",GOLD)
    text(setup,"1. Enter their full character name.",14,48,310)
    ui.friendName=edit(setup,14,74,312,112)
    placeholder(ui.friendName,"Your friend's first name and surname")
    local function addFriend()
        local who=A.sender(ui.friendName:GetText())
        if not who or not who.name:find("%s") then feedback("Enter your friend's first name and surname.",true); return end
        local ok,err=A.trust(ui.friendName:GetText())
        feedback(ok and "Friend added. They must add your character too." or err,not ok)
        if ok then ui.friendName:SetText(""); ui.friendName:ClearFocus(); A.sync() end
    end
    button(setup,"Add trusted friend",14,114,312,addFriend); ui.friendName:SetScript("OnEnterPressed",addFriend)
    text(setup,"2. Ask them to add you, too:",14,164,310)
    text(setup,A.me.name,14,190,310,"GameFontNormalLarge",GOLD)
    text(setup,"Use the same character you are playing now.\nBattle.net friendship alone does not enable sharing.",14,222,310,"GameFontHighlightSmall",MUTED)
    button(setup,"Sync with friends",14,282,312,function()
        A.sync(); feedback("Sync queued. Both characters must be online and trust each other.")
    end)
    text(setup,"Reports catch up when both original characters are online. A friend who has no reports may show no received reports even when connected.",14,324,310,"GameFontHighlightSmall",MUTED)
end
local function buildAlerts()
    local p=pages.alerts
    local settings=box(p,16,0,474,408)
    text(settings,"Know when an enemy appears",18,16,434,"GameFontNormalLarge",GOLD)
    text(settings,"Choose how Vendetta gets your attention.",18,48,434,"GameFontHighlightSmall",MUTED)
    ui.checks={}
    for i,spec in ipairs({
        {"sound","Play a warning sound","Built-in raid warning on the Master channel."},
        {"banner","Show an on-screen warning","A six-second banner with the enemy and report."},
        {"instances","Also warn inside instances","Off by default. Client visibility restrictions still apply."},
    }) do
        local c=CreateFrame("CheckButton",nil,settings,"UICheckButtonTemplate")
        c:SetPoint("TOPLEFT",14,-81-(i-1)*67); c:SetSize(26,26)
        text(c,spec[2],33,3,395); text(c,spec[3],33,24,395,"GameFontHighlightSmall",MUTED)
        c:SetScript("OnClick",function(self) A.store.settings[spec[1]]=self:GetChecked()==true; A.changed() end)
        ui.checks[spec[1]]=c
    end
    text(settings,"Repeat warning for the same enemy",18,292,434)
    ui.cooldownLabel=text(settings,"",332,323,118,"GameFontNormal",GOLD)
    local slider=CreateFrame("Slider",nil,settings,"OptionsSliderTemplate")
    slider:SetPoint("TOPLEFT",25,-329); slider:SetSize(282,18)
    slider:SetMinMaxValues(10,600); slider:SetValueStep(10); slider:SetObeyStepOnDrag(true)
    slider:SetScript("OnValueChanged",function(_,value)
        local v=math.max(10,math.min(600,math.floor(value+.5)))
        if A.store.settings.cooldown~=v then A.store.settings.cooldown=v; A.changed() end
    end)
    ui.cooldown=slider
    text(settings,"10 seconds",18,360,130,"GameFontHighlightSmall",MUTED)
    text(settings,"10 minutes",232,360,120,"GameFontHighlightSmall",MUTED)
    local help=box(p,504,0,340,408)
    text(help,"Try your warning",14,16,310,"GameFontNormalLarge",GOLD)
    text(help,"Preview uses your current sound and banner settings. A chat message is always shown.",14,52,310,"GameFontHighlightSmall",MUTED)
    button(help,"Preview alert",14,112,312,function() A.testAlert(); feedback("Test alert played using your current settings.") end)
    text(help,"For the earliest warning",14,174,310,"GameFontNormal",GOLD)
    text(help,"Enable enemy nameplates and Always show nameplates in WoW's settings.\n\nVendetta also checks your target, focus, and mouseover.\n\nOnly visible, readable enemies can trigger an alert. Hidden or stealthed players cannot be revealed.",14,204,310,"GameFontHighlight",MUTED)
end
local function build()
    panel=CreateFrame("Frame","ForeverVendettaWindow",UIParent,"BasicFrameTemplateWithInset")
    panel:SetSize(W,H); panel:SetPoint("CENTER"); fit(panel,W,H); panel.TitleText:SetText("Forever Vendetta")
    panel:SetMovable(true); panel:EnableMouse(true)
    -- Drag the title bar, not the input fields.
    local drag=CreateFrame("Frame",nil,panel)
    drag:SetPoint("TOPLEFT",0,0); drag:SetSize(W-35,26); drag:EnableMouse(true); drag:RegisterForDrag("LeftButton")
    drag:SetScript("OnDragStart",function() panel:StartMoving() end)
    drag:SetScript("OnDragStop",function() panel:StopMovingOrSizing() end)
    if UISpecialFrames then table.insert(UISpecialFrames,"ForeverVendettaWindow") end
    rect(panel,7,29,W-14,H-36,{.055,.065,.08,.98})
    text(panel,"Your shared enemy blacklist",22,40,500,"GameFontNormalLarge",GOLD)
    ui.summary=text(panel,"",22,66,570,"GameFontHighlightSmall",MUTED)
    button(panel,"Add enemy",582,43,116,function() switch("enemies"); newReport() end)
    button(panel,"Add target",710,43,128,useTarget)
    for i,item in ipairs({{"enemies","Blacklist"},{"friends","Friends"},{"alerts","Alerts"}}) do
        local id,caption=item[1],item[2]
        local p=CreateFrame("Frame",id=="friends" and "ForeverVendettaFriends" or nil,panel)
        p:SetPoint("TOPLEFT",0,-130); p:SetSize(W,408); p:Hide(); pages[id]=p
        local b=button(panel,caption,18+(i-1)*134,92,126,function() switch(id) end)
        b.caption=caption; b.mark=rect(b,4,25,118,2,{1,.75,.22,1},"OVERLAY"); nav[id]=b
    end
    buildEnemies(); buildFriends(); buildAlerts()
    ui.feedback=text(panel,"Select an enemy to read reports, or add someone new.",20,546,820,"GameFontHighlightSmall",GOLD)
    ui.footer=text(panel,"",20,568,820,"GameFontHighlightSmall",MUTED)
    panel:SetScript("OnHide",function()
        for _,p in pairs(pages) do p:Hide() end; armedFriend,armedWithdraw=nil,nil
    end)
    panel:Hide()
end
function A.toggle()
    if not panel then build() end
    if panel:IsShown() then panel:Hide(); for _,p in pairs(pages) do p:Hide() end
    else panel:Show(); switch(view) end
end
function A.toggleFriends()
    if not panel then build() end
    if panel:IsShown() and view=="friends" then panel:Hide(); for _,p in pairs(pages) do p:Hide() end
    else panel:Show(); switch("friends") end
end
function A.showBanner(title,detail)
    if not banner then
        banner=CreateFrame("Frame",nil,UIParent)
        banner:SetSize(620,86); banner:SetPoint("TOP",0,-70); fit(banner,620,86)
        banner:SetFrameStrata("HIGH"); banner:EnableMouse(false)
        rect(banner,0,0,620,86,{.055,.025,.025,.96}); rect(banner,0,0,4,86,{1,.32,.22,1},"ARTWORK")
        text(banner,"BLACKLISTED ENEMY",18,9,580,"GameFontNormalSmall",GOLD)
        banner.title=text(banner,"",18,28,580,"GameFontNormalLarge",STANCES[1].color)
        banner.detail=text(banner,"",18,53,580,"GameFontHighlightSmall")
        banner.remaining=0; banner:Hide()
        banner:SetScript("OnUpdate",function(self,dt)
            self.remaining=(self.remaining or 0)-(dt or 0)
            self:SetAlpha(math.min(1,math.max(0,self.remaining/.6)))
            if self.remaining<=0 then self:Hide() end
        end)
    end
    banner.title:SetText(title); banner.detail:SetText(detail)
    banner.remaining=6; banner:SetAlpha(1); banner:Show()
end
