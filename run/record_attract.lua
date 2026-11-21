-- Record the full video state of EVERY frame from power-on (frame 1 = first frame_done) into SSR_OUT/state.bin
-- (fixed-size records, layout in tools/attract_state.py) + optional per-frame MAME snapshot (SSR_SNAP=1) + 68k work-RAM
-- (0x104000-0x107fff, 16KB) into SSR_OUT/wram.bin for tracing attract variables. SSR_LAST = last frame.
local out=os.getenv("SSR_OUT") or "ref/attract"
local last=tonumber(os.getenv("SSR_LAST") or "6000")
local snap=os.getenv("SSR_SNAP")
local m=manager.machine
local prog=m.devices[":maincpu"].spaces["program"]
local regs44={} for i=0,15 do regs44[i]=0 end
local function k053245_ram()
  local t={}
  for i=0,0x3ff do local off=((i&7)<<1)|((i&0x3f8)<<3) local w=prog:read_u16(0x180000+off*2) t[#t+1]=string.char(w>>8,w&0xff) end
  return table.concat(t)
end
local buf=string.rep("\0",0x800)
tap44=prog:install_write_tap(0x5a0000,0x5a001f,"k053244",function(addr,data,mask)
  local off=((addr-0x5a0000)>>1)&~1
  if mask&0xff00~=0 then regs44[off]=(data>>8)&0xff if off==6 then buf=k053245_ram() end end
  if mask&0x00ff~=0 then regs44[off+1]=data&0xff if off+1==6 then buf=k053245_ram() end if off+1==7 then buf=string.rep("\0",0x800) end end
end)
local dim_c,dim_v=0x10,0
tapdim1=prog:install_write_tap(0x1c0200,0x1c0201,"dimc",function(a,d,mk) if mk&0xff~=0 then dim_c=d&0x18 end end)
tapdim2=prog:install_write_tap(0x1c0300,0x1c0301,"dimv",function(a,d,mk) if mk&0xff~=0 then dim_v=(d>>4)&7 end end)
local function item(dev,name) return emu.item(m.devices[dev].items[name]) end
local function dumpitem(it,n) local t={} for i=0,n-1 do t[#t+1]=string.char(it:read(i)&0xff) end return table.concat(t) end
local fs=assert(io.open(out.."/state.bin","wb")) local fw=assert(io.open(out.."/wram.bin","wb"))
local i052=item(":k052109","0/m_ram") local i51=item(":k053251","0/m_ram")
-- Optional input movie (SSR_MOVIE=file): 5 bytes per frame, active-HIGH masks for P1,P2,P3,P4,COINS
-- (bit 0 left,1 right,2 up,3 down,4 button1 shoot/start,5 button2 jump; COINS bit0 coin1..bit3 coin4, bit4 service1).
-- Byte block k is applied at the k-th frame_done (k = 1..), i.e. it is seen by the game from frame k+1 on.
-- The port values MAME reports after applying are appended to SSR_OUT/ports.bin (5 bytes per frame, as read).
-- SSR_SPR=1 also writes SSR_OUT/spr.bin (68k view of 0x180000-0x183fff per frame, like record_spr.lua).
local movie=nil local fp=nil local fspr=nil
if os.getenv("SSR_MOVIE") then local mf=assert(io.open(os.getenv("SSR_MOVIE"),"rb")) movie=mf:read("a") mf:close() fp=assert(io.open(out.."/ports.bin","wb")) end
if os.getenv("SSR_SPR") then fspr=assert(io.open(out.."/spr.bin","wb")) end
local FN={{"Left","Right","Up","Down","Button 1","Button 2"}}
local function apply(k)
  local o=(k-1)*5 if not movie or o+5>#movie then return end
  for p=1,4 do local b=movie:byte(o+p) local port=m.ioport.ports[":P"..p]
    for i,nm in ipairs(FN[1]) do local f=port.fields["P"..p.." "..nm] if f then if (b>>(i-1))&1==1 then f:set_value(1) else f:clear_value() end end end end
  local c=movie:byte(o+5) local cp=m.ioport.ports[":COINS"]
  for i=1,4 do local f=cp.fields["Coin "..i] if f then if (c>>(i-1))&1==1 then f:set_value(1) else f:clear_value() end end end
  local sv=cp.fields["Service 1"] if sv then if (c>>4)&1==1 then sv:set_value(1) else sv:clear_value() end end
end
local n=0
emu.register_frame_done(function()
  n=n+1
  if fspr then local t={} for a=0x180000,0x183fff,2 do local v=prog:read_u16(a) t[#t+1]=string.char(v>>8,v&0xff) end fspr:write(table.concat(t)) end
  if movie then apply(n) local r={} for _,pn in ipairs({":P1",":P2",":P3",":P4",":COINS"}) do r[#r+1]=string.char(m.ioport.ports[pn]:read()&0xff) end fp:write(table.concat(r)) end
  local t={} local pal=m.memory.shares[":palette"] for i=0,0xfff do t[#t+1]=string.char(pal:read_u8(i ~ 1)) end
  fs:write(table.concat(t))
  fs:write(dumpitem(i052,0x6000))
  local r={}
  for _,nm in ipairs({"0/m_charrombank","0/m_charrombank_2"}) do local it=item(":k052109",nm) for i=0,3 do r[#r+1]=string.char(it:read(i)&0xff) end end
  for _,nm in ipairs({"0/m_addrmap","0/m_tileflip_enable","0/m_scrollctrl","0/m_romsubbank"}) do r[#r+1]=string.char(item(":k052109",nm):read(0)&0xff) end
  fs:write(table.concat(r))
  fs:write(dumpitem(i51,16))
  local g={} for i=0,15 do g[#g+1]=string.char(regs44[i]) end fs:write(table.concat(g))
  fs:write(buf) fs:write(string.char(dim_c,dim_v))
  local w={} for a=0x104000,0x107fff,2 do local v=prog:read_u16(a) w[#w+1]=string.char(v>>8,v&0xff) end fw:write(table.concat(w))
  if snap then m.video:snapshot() end
  if n>=last then fs:close() fw:close() if fp then fp:close() end if fspr then fspr:close() end m:exit() end
end)
