-- Z80 (audiocpu) register trace for frames SSR_A..SSR_B into SSR_TRACE (needs -debug -debugger none).
-- Each line: totalcycles pc af bc de hl ix iy sp (hex), before each instruction. tracelog writes to the *visible* CPU's
-- trace file, so visible_cpu is set to audiocpu.
local a=tonumber(os.getenv("SSR_A") or "1") local b=tonumber(os.getenv("SSR_B") or "2")
local out=os.getenv("SSR_TRACE") or "/tmp/z80.log"
local m=manager.machine local n=0 local on=false
local fmt=os.getenv("SSR_FMT") or '{tracelog "%d %X %X %X %X %X %X %X %X\\n",totalcycles,pc,af,bc,de,hl,ix,iy,sp}'
local function start() m.debugger.visible_cpu=m.devices[":audiocpu"]
  m.debugger:command("trace "..out..",audiocpu,noloop,"..fmt) on=true end
if a<=1 then start() end
local pk=emu.register_periodic(function() m.debugger.visible_cpu=m.devices[":audiocpu"] end)
local play=nil if os.getenv("SSR_PLAY") then play=dofile(os.getenv("SSR_PLAY")) end
local function set(port,field,v) local f=m.ioport.ports[port].fields[field] if v~=0 then f:set_value(1) else f:clear_value() end end
emu.register_frame_done(function() n=n+1 m.debugger.visible_cpu=m.devices[":audiocpu"]
  if play then play(n,set,m.devices[":maincpu"].spaces["program"]) end
  if n==a-1 and not on then start() end
  if n>=b then m.debugger:command("trace off,audiocpu") m:exit() end end)
