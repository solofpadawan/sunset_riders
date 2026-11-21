-- Record the 68k view of sprite/object RAM 0x180000-0x183fff (16 KB) every frame from power-on into SSR_OUT/spr.bin.
-- Same frame numbering as record_attract.lua (frame n = nth frame_done = record n-1).
local out=os.getenv("SSR_OUT") or "ref/attract"
local last=tonumber(os.getenv("SSR_LAST") or "7000")
local m=manager.machine local prog=m.devices[":maincpu"].spaces["program"]
local f=assert(io.open(out.."/spr.bin","wb")) local n=0
emu.register_frame_done(function() n=n+1
  local t={} for a=0x180000,0x183fff,2 do local v=prog:read_u16(a) t[#t+1]=string.char(v>>8,v&0xff) end
  f:write(table.concat(t)) if n>=last then f:close() m:exit() end end)
