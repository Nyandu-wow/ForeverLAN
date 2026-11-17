-- Capture the shipping native UI's layout with the same mocks used by regression tests.
-- This is a layout approximation, not a Forever client screenshot.
VENDETTA_PREVIEW=true
local boot=assert(loadfile("tests/vendetta/run.lua"))()
local x=boot("Alice River")
x.a.trust("Bob Stone"); x.a.trust("Clara Vale")
for _,r in ipairs({
    {"Grim Reaper","Camped me three times in Stranglethorn.","AVOID"},
    {"Blood Thorn","Interrupted our quest group.","AVENGE"},
    {"Quiet Shadow","Seen following the road near our camp.","WATCH"},
    {"Iron Fang","A fair fight. Ready for a rematch.","AVENGE"},
    {"Night Walker","Travels with a group. Stay alert.","AVOID"},
    {"Dark Water","Remember this name.","WATCH"},
}) do x.a.report(r[1],r[2],r[3]) end
x.a.merge("bob stone-forever",{name="Grim Reaper",realm="Forever",note="He also ambushed our party by the river.",mode="AVENGE",rev=1,deleted=false})
x.a.store.lastReceived={ ["bob stone-forever"]=1000 }
x.a.toggle()
for _,w in ipairs(x.widgets) do if type(w.group)=="table" and w.group.name=="Grim Reaper" then w.scripts.OnClick(w); break end end
local function quote(v)
    return '"'..v:gsub('\\','\\\\'):gsub('"','\\"'):gsub('\n','\\n'):gsub('\r','\\r'):gsub('\t','\\t')..'"'
end
local function json(v)
    if type(v)=="string" then return quote(v) end
    if type(v)=="number" or type(v)=="boolean" then return tostring(v) end
    if type(v)~="table" then return "null" end
    local parts={}
    for k,val in pairs(v) do parts[#parts+1]=quote(tostring(k))..":"..json(val) end
    return "{"..table.concat(parts,",").."}"
end
local function capture(w)
    local r={kind=w.kind,text=w.text,x=w.x,y=w.y,width=w.width,height=w.height,font=w.font,template=w.template,
        shown=w.shown,color=w.color,textColor=w.textColor,enabled=w.enabled,checked=w.checked,layer=w.layer,
        isTemplateTitle=w.isTemplateTitle==true,children={}}
    for i,c in ipairs(w.children) do r.children[i]=capture(c) end
    return r
end
local scenes={}
scenes.blacklist=capture(x.env.ForeverVendettaWindow)
for _,w in ipairs(x.widgets) do if w.kind=="Button" and w.caption=="Friends" then w.scripts.OnClick(w); break end end
scenes.friends=capture(x.env.ForeverVendettaWindow)
for _,w in ipairs(x.widgets) do if w.kind=="Button" and w.caption=="Alerts" then w.scripts.OnClick(w); break end end
scenes.alerts=capture(x.env.ForeverVendettaWindow)
print(json(scenes))

