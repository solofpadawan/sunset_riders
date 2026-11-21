-- Register trace of the 68000 for lockstep checks of web/sim (frames SSR_A..SSR_B, default 1-3) into SSR_TRACE.
-- Each line: totalcycles pc d0..d7 a0..a7 sr (hex), logged before the instruction executes.
local a=tonumber(os.getenv("SSR_A") or "1") local b=tonumber(os.getenv("SSR_B") or "3")
local out=os.getenv("SSR_TRACE") or "/tmp/regs.log"
local m=manager.machine local n=0 local on=false
local fmt='{tracelog "%d %X %X %X %X %X %X %X %X %X %X %X %X %X %X %X %X %X %X\\n",totalcycles,pc,d0,d1,d2,d3,d4,d5,d6,d7,a0,a1,a2,a3,a4,a5,a6,sp,sr}'
local function start() m.debugger:command("trace "..out..",maincpu,noloop,"..fmt) on=true end
if a<=1 then start() end
emu.register_frame_done(function() n=n+1
  if n==a-1 and not on then start() end
  if n>=b then m.debugger:command("trace off,maincpu") m:exit() end end)
